import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorktreeModel, openCheckout as openCheckoutWithGit } from '../mods/worktree-launcher/model.js';
import { createJournalStore } from '../mods/worktree-launcher/journal.js';

const openCheckout = openCheckoutWithGit;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const noTimeout = () => ({ promise: new Promise(() => {}), cancel: () => {} });
const a = { id: 'A', path: '/projects/A', label: 'A', basename: 'A' };
const b = { id: 'B', path: '/projects/B', label: 'B', basename: 'B' };
const ref = { ref: 'refs/heads/main', name: 'main', label: 'main · local', reason: '' };
function setup(overrides = {}) {
  let saved = null,
    mutations = 0,
    opens = 0;
  const request = {
    project: a,
    action: 'new',
    ref: ref.ref,
    name: 'feature',
    path: '/fixture/worktree',
    commit: 'abc',
    upstream: '',
  };
  const git = {
    machine: null,
    userHome: '/fixture-home',
    validateRoot: async (config) => config.project_root,
    discover: async () => [a, b],
    choices: async () => [ref],
    remotes: async () => [],
    destination: () => request.path,
    prepare: async () => request,
    create: async () => {
      mutations++;
      return { kind: 'created', path: request.path, request };
    },
    inspect: async (r) => ({ kind: 'created', path: r.path, request: r }),
    ...overrides.git,
  };
  const model = new WorktreeModel({
    connect: async () => git,
    config: async () => ({ project_root: '/projects' }),
    saveRoot: async () => {},
    journal: {
      load: async () => (saved ? [saved] : []),
      save: async (r) => {
        saved = r;
      },
      clear: async () => {
        saved = null;
      },
    },
    open: async () => {
      opens++;
    },
    ...overrides,
  });
  return {
    model,
    git,
    request,
    get mutations() {
      return mutations;
    },
    get opens() {
      return opens;
    },
    get saved() {
      return saved;
    },
  };
}
async function fill(model) {
  await model.refresh();
  await model.selectProject(a);
  model.setName('feature');
  model.selectRef(ref);
}

test('deferred project scans are cached, preserve editing, report errors locally, and ignore stale machine results', async () => {
  for (const outcome of ['success', 'failure', 'machine', 'close']) {
    const gate = deferred();
    let scans = 0;
    const f = setup({
      git: {
        discover: async () => {
          scans++;
          return gate.promise;
        },
      },
    });
    await f.model.refresh(() => {}, true);
    assert.equal(scans, 0);
    await f.model.selectProject(a);
    f.model.selectRef(ref);
    f.model.setName('draft');
    f.model.setPrompt('Keep this task.');
    const pending = f.model.loadProjects();
    await f.model.loadProjects();
    assert.equal(scans, 1);
    assert.equal(f.model.canCreate, true);
    if (outcome === 'failure') {
      // A discovery failure must not affect the selected repository.
      gate.reject(new Error('scan failed'));
      await pending;
      assert.equal(f.model.projectsError, 'scan failed');
      assert.equal(f.model.error, '');
      f.git.discover = async () => [a, b];
      await f.model.loadProjects();
      assert.deepEqual(f.model.projects, [a, b]);
      assert.equal(f.model.projectsError, '');
    } else {
      if (outcome === 'machine') {
        f.model.connect = async (machine) => ({ ...f.git, machine, discover: async () => [b] });
        await f.model.selectMachine('devbox');
      } else if (outcome === 'close') f.model.close();
      gate.resolve([a]);
      await pending;
    }
    if (outcome === 'machine') assert.deepEqual(f.model.projects, [b]);
    else if (outcome === 'close') assert.deepEqual(f.model.projects, []);
    else {
      assert.equal(f.model.project, a);
      assert.equal(f.model.ref, ref);
      assert.equal(f.model.name, 'draft');
      assert.equal(f.model.prompt, 'Keep this task.');
      assert.equal(f.model.canCreate, true);
      if (outcome === 'success') {
        await f.model.loadProjects();
        assert.equal(scans, 1);
      }
    }
  }
});

test('recovery guards only the requested repository branch or destination, without blocking the form', async () => {
  for (const [label, project, name, path, conflict] of [
    ['unrelated worktree in the same repo', a, 'other', '/other/worktree', false],
    ['same branch name in another repo', b, 'feature', '/other/worktree', false],
    [
      'same branch through another checkout of the repo',
      { ...a, path: '/linked/checkout' },
      'feature',
      '/other/worktree',
      true,
    ],
    ['same destination in another repo', b, 'other', '/fixture/worktree', true],
  ]) {
    const f = setup();
    const pending = { ...f.request, project, name, path, attempt: 'older' };
    let text = JSON.stringify(pending),
      inspected = 0;
    f.model.journal = createJournalStore(
      async () => text,
      async (_path, next, expected) => {
        assert.equal(expected, text);
        text = next;
      },
      '/operation.json',
    );
    f.git.inspect = async (request) => {
      if (request.attempt === 'older') {
        inspected++;
        return { kind: 'partial', request, path: request.path, error: 'uncertain Git result' };
      }
      return { kind: 'created', request, path: request.path };
    };
    await fill(f.model);
    assert.equal(f.model.phase, 'editing', label);
    assert.equal(f.model.canCreate, true, label);
    assert.equal(inspected, 0, 'Discovery must not inspect unrelated operations');
    await f.model.submit();
    assert.equal(inspected, conflict ? 1 : 0, label);
    assert.equal(f.mutations, conflict ? 0 : 1, label);
    assert.equal(f.model.phase, conflict ? 'editing' : 'complete', label);
    if (conflict) assert.match(f.model.error, /uncertain Git result/);
    const value = JSON.parse(text);
    assert.deepEqual(value.operations ?? [value], [pending], label);
  }
});

test('project remotes default to origin; fetching refreshes branches and retains a still-valid selection', async () => {
  const gate = deferred(),
    seen = [],
    refreshed = { ...ref, checkout: '/existing/main' };
  const f = setup({
    git: {
      remotes: async () => [
        { name: 'upstream', label: 'upstream' },
        { name: 'origin', label: 'origin' },
      ],
      fetch: async (project, remote) => {
        seen.push([project, remote]);
        await gate.promise;
        return [refreshed, { ...ref, ref: 'refs/remotes/origin/new', name: 'new' }];
      },
    },
  });
  await fill(f.model);
  assert.equal(f.model.remote.name, 'origin');
  const pending = f.model.fetchRemote();
  assert.equal(f.model.phase, 'fetching');
  assert.equal(f.model.canCreate, false);
  await f.model.fetchRemote();
  await f.model.submit();
  assert.equal(f.model.close(), false);
  assert.equal(f.mutations, 0);
  gate.resolve();
  await pending;
  assert.deepEqual(seen, [[a, 'origin']]);
  assert.equal(f.model.phase, 'editing');
  assert.equal(f.model.ref, refreshed);
  assert.equal(f.model.name, 'feature');
  assert.equal(f.model.refs.length, 2);
  assert.match(f.model.fetchMessage, /origin/);
  f.model.selectRemote(f.model.remotes[0]);
  assert.equal(f.model.remote.name, 'upstream');
});

test('fetch removes stale selections, reports errors, and does nothing without a configured remote', async () => {
  const f = setup({ git: { remotes: async () => [{ name: 'upstream', label: 'upstream' }], fetch: async () => [] } });
  await fill(f.model);
  assert.equal(f.model.remote.name, 'upstream');
  await f.model.fetchRemote();
  assert.equal(f.model.ref, null);
  assert.equal(f.model.canCreate, false);
  f.git.fetch = async () => {
    throw new Error('remote authentication failed');
  };
  await f.model.fetchRemote();
  assert.match(f.model.error, /authentication failed/);
  assert.equal(f.model.phase, 'editing');
  assert.equal(f.model.fetchMessage, '');
  f.git.remotes = async () => [];
  await f.model.selectProject(b);
  await f.model.fetchRemote();
  assert.equal(f.model.remote, null);
  assert.deepEqual(f.model.remotes, []);
});

test('late fetch results cannot repopulate a closed launcher', async () => {
  const gate = deferred();
  const f = setup({ git: { remotes: async () => [{ name: 'origin', label: 'origin' }], fetch: () => gate.promise } });
  await fill(f.model);
  const pending = f.model.fetchRemote();
  f.model.closed = true;
  f.model.generation++;
  gate.resolve([{ ...ref, name: 'late' }]);
  await pending;
  assert(!f.model.refs.some((row) => row.name === 'late'));
});

test('launch choices include Shell and only supported agents installed on the selected machine', async () => {
  const seen = [];
  const f = setup({
    listAgents: async (machine) => {
      seen.push(machine);
      return [
        { key: 'pi', name: 'Pi', installed: machine === 'devbox', run: ['pi'] },
        { key: 'codex', name: 'Codex', installed: machine === null, run: ['custom-codex', '--fixture'] },
        { key: 'unrelated', name: 'Unrelated', installed: true, run: ['unrelated'] },
      ];
    },
    connect: async (machine) => ({ ...setup().git, machine }),
  });
  await f.model.refresh();
  assert.deepEqual(
    f.model.launches.map((item) => item.key),
    ['shell', 'codex'],
  );
  assert.equal(f.model.launch.key, 'shell');
  f.model.selectLaunch(f.model.launches[1]);
  assert.deepEqual(f.model.launch.argv, ['custom-codex', '--fixture']);
  await f.model.selectMachine('devbox');
  assert.deepEqual(
    f.model.launches.map((item) => item.key),
    ['shell', 'pi'],
  );
  assert.equal(f.model.launch.key, 'shell');
  assert.deepEqual(seen, [null, 'devbox']);
});

test('the selected agent is recorded before creation and preserved for open-only retry', async () => {
  const f = setup({
    listAgents: async () => [{ key: 'codex', name: 'Codex', installed: true, run: ['custom-codex'] }],
  });
  await fill(f.model);
  f.model.selectLaunch(f.model.launches.find((item) => item.key === 'codex'));
  f.model.setPrompt('Review the checkout and explain the tests.');
  const create = f.git.create;
  f.git.create = async (request) => {
    assert.equal(f.saved.launch.key, 'codex');
    assert.equal(f.saved.launch.prompt, 'Review the checkout and explain the tests.');
    return create(request);
  };
  let opened;
  await f.model.submit(async (request) => {
    opened = request;
    throw new Error('opening failed');
  });
  assert.equal(f.saved, null);
  assert.deepEqual(f.model.result.request.launch.argv, ['custom-codex']);
  assert.equal(opened.launch.key, 'codex');
  assert.equal(f.model.phase, 'recover');
  await f.model.openCreated(async (request) => {
    assert.equal(request.launch.key, 'codex');
    assert.equal(request.launch.prompt, 'Review the checkout and explain the tests.');
  });
  assert.equal(f.model.phase, 'complete');
  assert.equal(f.mutations, 1);
});

test('an in-window opening retry can switch to Shell without another Git mutation', async () => {
  const f = setup({ listAgents: async () => [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }] });
  await fill(f.model);
  f.model.selectLaunch(f.model.launches[1]);
  f.model.setPrompt('Review this project.');
  await f.model.submit(async () => {
    throw new Error('opening failed');
  });
  f.model.selectLaunch(f.model.launches[0]);
  await f.model.openCreated(async (request) => {
    assert.equal(request.launch.key, 'shell');
    assert.equal(request.launch.prompt, '');
    assert.equal(f.saved, null);
  });
  assert.equal(f.mutations, 1);
  assert.equal(f.model.phase, 'complete');
});

test('agent detection runs alongside project discovery and a failed check leaves Shell available', async () => {
  const agents = deferred();
  let discovered = false;
  const f = setup({
    listAgents: () => agents.promise,
    git: {
      discover: async () => {
        discovered = true;
        return [a];
      },
    },
  });
  const refresh = f.model.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(discovered, true);
  agents.resolve([]);
  await refresh;
  assert.deepEqual(
    f.model.launches.map((item) => item.key),
    ['shell'],
  );
  f.model.listAgents = async () => {
    throw new Error('availability failed');
  };
  await f.model.refresh();
  assert.equal(f.model.phase, 'editing');
  assert.deepEqual(
    f.model.launches.map((item) => item.key),
    ['shell'],
  );
});

test('late agent detection cannot install choices from a previously selected machine', async () => {
  const late = deferred();
  const f = setup({
    listAgents: (machine) =>
      machine === null ? late.promise : Promise.resolve([{ key: 'pi', name: 'Pi', installed: true, run: ['pi'] }]),
    connect: async (machine) => ({ ...setup().git, machine }),
  });
  const first = f.model.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  await f.model.selectMachine('devbox');
  late.resolve([{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }]);
  await first;
  assert.equal(f.model.machine, 'devbox');
  assert.deepEqual(
    f.model.launches.map((item) => item.key),
    ['shell', 'pi'],
  );
});

test('late choices and closed overlays cannot replace current form; selections reset', async () => {
  const late = deferred();
  const f = setup({ git: { choices: (p) => (p === a ? late.promise : Promise.resolve([ref])) } });
  await f.model.refresh();
  const first = f.model.selectProject(a);
  await f.model.selectProject(b);
  f.model.setName('branch');
  f.model.selectRef(ref);
  late.resolve([{ ...ref, name: 'wrong' }]);
  await first;
  assert.equal(f.model.project, b);
  assert.equal(f.model.refs[0].name, 'main');
  assert.equal(f.model.setAction('new'), false);
  assert.equal(f.model.name, 'branch');
  assert.equal(f.model.ref, ref);
  assert.equal(f.model.setAction('existing'), true);
  assert.equal(f.model.ref, ref);
  assert.equal(f.model.name, '');
  assert.equal(f.model.canCreate, true);
  const closed = deferred();
  f.model.git.choices = () => closed.promise;
  const load = f.model.selectProject(a);
  assert.equal(f.model.close(), true);
  closed.resolve([ref]);
  await load;
  assert.equal(f.model.refs.length, 0);
});

test('a checked-out branch previews its existing folder and remains selectable across action changes', async () => {
  const f = setup();
  await fill(f.model);
  const checkedOut = { ...ref, checkout: '/projects/A' };
  f.model.selectRef(checkedOut);
  assert.equal(f.model.canCreate, true);
  f.model.setAction('existing');
  assert.equal(f.model.ref, checkedOut);
  assert.equal(f.model.canCreate, true);
  assert.equal(f.model.reusing, true);
  assert.equal(f.model.path, '/projects/A');
  f.model.selectRef({ ...ref, reason: 'unavailable' });
  assert.equal(f.model.ref, checkedOut);
  f.model.selectRef(ref);
  assert.equal(f.model.canCreate, true);
  f.model.setAction('new');
  assert.equal(f.model.ref, ref);
  assert.equal(f.model.canCreate, false);
  f.model.selectRef(checkedOut);
  f.model.setName('another-branch');
  assert.equal(f.model.canCreate, true);
});

test('an existing-checkout session preserves its folder and program through opening recovery', async () => {
  const f = setup({
    terminals: () => ['old-terminal'],
    listAgents: async () => [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }],
  });
  await fill(f.model);
  f.model.setAction('existing');
  const checkout = '/custom/existing';
  f.model.selectRef({ ...ref, checkout });
  f.model.selectLaunch(f.model.launches[1]);
  f.git.prepare = async (options) => {
    assert.equal(options.checkout, checkout);
    return { ...f.request, action: 'existing', name: 'main', path: checkout, reuse: true };
  };
  f.git.create = async (request) => ({ kind: 'created', path: request.path, request });
  await f.model.submit(async (request) => {
    assert.equal(request.path, checkout);
    assert.equal(request.launch.key, 'codex');
    assert(request.attempt);
    assert.equal(f.saved, null);
    throw new Error('opening failed');
  });
  assert.equal(f.model.phase, 'recover');
  assert.equal(f.saved, null);
  const attempt = f.model.result.request.attempt;
  f.model.terminals = () => ['old-terminal', 'new-terminal'];
  assert.equal(f.model.reusing, true);
  assert.equal(f.model.path, checkout);
  await f.model.openCreated(async (request) => {
    assert.equal(request.path, checkout);
    assert.equal(request.attempt, attempt);
  });
  assert.equal(f.model.phase, 'complete');
  assert.equal(f.saved, null);
});

test('double submit admits one mutation; Escape keeps pending operation open', async () => {
  const gate = deferred();
  let mutations = 0;
  const f = setup({
    git: {
      create: async (r) => {
        mutations++;
        await gate.promise;
        return { kind: 'created', path: r.path, request: r };
      },
    },
  });
  await fill(f.model);
  const pending = f.model.submit();
  await f.model.submit();
  assert.equal(f.model.close(), false);
  assert.match(f.model.error, /finishing/);
  gate.resolve();
  await pending;
  assert.equal(mutations, 1);
  assert.equal(f.model.phase, 'complete');
});

test('cancel before submit has no external effects', async () => {
  const f = setup();
  await fill(f.model);
  assert(f.model.close());
  await f.model.submit();
  assert.equal(f.mutations, 0);
});

test('open failure retains created path and open-only retry never repeats Git', async () => {
  let opens = 0;
  const f = setup({
    open: async () => {
      if (++opens === 1) throw new Error('Opening unconfirmed');
    },
  });
  await fill(f.model);
  await f.model.submit();
  assert.equal(f.model.phase, 'recover');
  assert.equal(f.saved, null);
  assert.match(f.model.error, /Opening unconfirmed/);
  await f.model.submit();
  assert.equal(f.mutations, 1);
  await f.model.openCreated();
  assert.equal(opens, 2);
  assert.equal(f.mutations, 1);
  assert.equal(f.saved, null);
});

test('unavailable remote recovery cannot redirect or block local creation, and its record survives', async () => {
  const f = setup();
  const pending = { ...f.request, machine: 'devbox' };
  let text = JSON.stringify(pending);
  f.model.journal = createJournalStore(
    async () => text,
    async (_path, next, expected) => {
      assert.equal(expected, text);
      text = next;
    },
    '/operation.json',
  );
  const connected = [];
  f.model.connect = async (machine) => {
    connected.push(machine);
    if (machine === 'devbox') throw new Error('devbox needs a login');
    return f.git;
  };
  await f.model.refresh();
  assert.deepEqual(connected, [null]);
  assert.equal(f.model.machine, null);
  assert.deepEqual(f.model.projects, [a, b]);
  await f.model.selectProject(a);
  f.model.selectRef(ref);
  f.model.setName('another');
  assert.equal(f.model.canCreate, true);
  await f.model.submit();
  assert.equal(f.mutations, 1);
  assert.deepEqual(JSON.parse(text).operations, [pending]);
  await f.model.selectMachine('devbox');
  assert.match(f.model.error, /login/);
  assert.equal(f.model.pending, null);
  assert.deepEqual(await f.model.journal.load('devbox'), [pending]);
  await f.model.selectMachine(null);
  await f.model.refresh();
  assert.equal(f.model.machine, null);
  assert.equal(f.model.pending, null);
  assert.deepEqual(f.model.projects, [a, b]);
});

test('discovery never reads old recovery records or changes the initial machine', async () => {
  const f = setup();
  f.model.journal.load = async () => {
    throw new Error('unreadable journal');
  };
  await fill(f.model);
  assert.equal(f.model.machine, null);
  assert.equal(f.model.canCreate, true);
  await f.model.submit();
  assert.match(f.model.error, /unreadable journal/);
  assert.equal(f.mutations, 0);
});

test('an opening failure leaves no journal and the next launcher run shows projects', async () => {
  const f = setup({
    open: async () => {
      assert.equal(f.saved, null);
      throw new Error('opening failed');
    },
  });
  await fill(f.model);
  await f.model.submit();
  assert.equal(f.model.phase, 'recover');
  assert.equal(f.saved, null);
  await f.model.refresh();
  assert.equal(f.model.phase, 'editing');
  assert.deepEqual(f.model.projects, [a, b]);
  assert.equal(f.model.result, null);
  assert.equal(f.mutations, 1);
});

test('matching recovery is inspected before preparation and only settled operations are cleared', async () => {
  for (const kind of ['created', 'partial', 'absent']) {
    const f = setup();
    let clears = 0,
      inspections = 0,
      prepared = 0;
    const pending = { ...f.request, attempt: 'older' };
    f.model.journal.load = async () => [pending];
    f.model.journal.clear = async (request) => {
      if (request.attempt === 'older') clears++;
    };
    f.git.inspect = async (r, options) => {
      assert.deepEqual(options, { recover: true });
      if (r.attempt !== 'older') return { kind: 'created', request: r, path: r.path };
      inspections++;
      return { kind, path: r.path, request: r, error: 'uncertain operation' };
    };
    const prepare = f.git.prepare;
    f.git.prepare = async (options) => {
      prepared++;
      assert.equal(clears, 1);
      return prepare(options);
    };
    await fill(f.model);
    assert.equal(inspections, 0);
    await f.model.submit();
    assert.equal(inspections, 1);
    assert.equal(clears, kind === 'partial' ? 0 : 1);
    assert.equal(prepared, kind === 'partial' ? 0 : 1);
    assert.equal(f.mutations, kind === 'partial' ? 0 : 1);
    assert.equal(f.model.phase, kind === 'partial' ? 'editing' : 'complete');
  }
});

test('a prepared existing-checkout destination is checked when it differs from the initial preview', async () => {
  const f = setup();
  const pending = { ...f.request, project: b, name: 'other', path: '/newly-observed/checkout', attempt: 'older' };
  let text = JSON.stringify(pending);
  f.model.journal = createJournalStore(
    async () => text,
    async (_path, next, expected) => {
      assert.equal(expected, text);
      text = next;
    },
    '/operation.json',
  );
  f.git.prepare = async () => ({ ...f.request, path: pending.path, reuse: true });
  f.git.inspect = async (request) => ({
    kind: 'partial',
    request,
    path: request.path,
    error: 'destination still uncertain',
  });
  await fill(f.model);
  f.model.setAction('existing');
  await f.model.submit();
  assert.match(f.model.error, /destination still uncertain/);
  assert.equal(f.mutations, 0);
  assert.equal(text, JSON.stringify(pending));
});

test('invalid config, failed preparation and journal failure block creation', async () => {
  const invalid = setup({
    config: async () => {
      throw new Error('Malformed config.json');
    },
  });
  await invalid.model.refresh();
  assert.match(invalid.model.error, /Malformed/);
  assert.equal(invalid.model.projects.length, 0);
  for (const failure of ['prepare', 'journal']) {
    const f = setup();
    await fill(f.model);
    if (failure === 'prepare')
      f.model.git.prepare = async () => {
        throw new Error('stale ref');
      };
    else
      f.model.journal.save = async () => {
        throw new Error('journal unavailable');
      };
    await f.model.submit();
    assert.equal(f.mutations, 0);
    assert.equal(f.model.phase, 'editing');
  }
});

test('open-only retry refuses a checkout that changed after its first inspection', async () => {
  const f = setup({
    open: async () => {
      throw new Error('injected opening failure');
    },
  });
  await fill(f.model);
  await f.model.submit();
  let opens = 0;
  f.model.open = async () => {
    opens++;
  };
  f.model.git.inspect = async (request) => ({
    kind: 'partial',
    path: request.path,
    request,
    error: 'checkout changed',
  });
  await f.model.openCreated();
  await f.model.submit();
  assert.equal(f.model.phase, 'partial');
  assert.equal(opens, 0);
  assert.equal(f.mutations, 1);
  assert.equal(f.saved, null);
  assert.equal(f.model.result.path, f.request.path);
});

test('journal-clear failure preserves recovery and prevents app opening', async () => {
  const f = setup();
  await fill(f.model);
  const clear = f.model.journal.clear;
  f.model.journal.clear = async () => {
    throw new Error('cannot clear journal');
  };
  await f.model.submit();
  assert.equal(f.model.phase, 'recover');
  assert.equal(f.opens, 0);
  assert.equal(f.mutations, 1);
  assert.equal(f.saved.path, f.request.path);
  f.model.journal.clear = clear;
  await f.model.openCreated();
  assert.equal(f.model.phase, 'complete');
  assert.equal(f.saved, null);
  assert.equal(f.opens, 1);
  assert.equal(f.mutations, 1);
});

test('failure without any artifact clears the journal and waits for an explicit retry', async () => {
  let attempts = 0;
  const f = setup({
    git: {
      create: async (request) => ({
        kind: ++attempts === 1 ? 'absent' : 'created',
        request,
        path: request.path,
        error: 'injected failure',
      }),
    },
  });
  await fill(f.model);
  await f.model.submit();
  assert.equal(f.model.phase, 'editing');
  assert.equal(f.saved, null);
  assert.equal(attempts, 1);
  assert.equal(f.opens, 0);
  assert.match(f.model.error, /injected failure/);
  await f.model.submit();
  assert.equal(f.model.phase, 'complete');
  assert.equal(attempts, 2);
  assert.equal(f.opens, 1);
});

test('machine changes invalidate late discovery and clear dependent selections', async () => {
  const late = deferred();
  const local = setup().git,
    remote = {
      ...local,
      machine: 'devbox',
      userHome: '/remote-home/fixture',
      discover: async () => [{ ...b, machine: 'devbox' }],
    };
  local.discover = () => late.promise;
  const f = setup({ connect: async (machine) => (machine ? remote : local) });
  const loading = f.model.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  await f.model.selectMachine('devbox');
  late.resolve([a]);
  await loading;
  assert.equal(f.model.machine, 'devbox');
  assert.equal(f.model.git, remote);
  assert.deepEqual(
    f.model.projects.map((p) => p.id),
    ['B'],
  );
  assert.equal(f.model.project, null);
  assert.equal(f.model.ref, null);
  assert.equal(f.model.name, '');
});

test('an unset root can be validated and saved on the selected machine without Git mutation', async () => {
  const roots = new Map(),
    validated = [],
    saved = [];
  const f = setup({
    machine: 'devbox',
    config: async (machine) => ({ project_root: roots.get(machine) ?? '' }),
    saveRoot: async (machine, root) => {
      roots.set(machine, root);
      saved.push([machine, root]);
    },
    git: {
      machine: 'devbox',
      validateRoot: async (config) => {
        validated.push(config.project_root);
        if (!config.project_root.startsWith('/')) throw new Error('Use an absolute directory.');
        return config.project_root;
      },
    },
  });
  await f.model.refresh();
  assert.equal(f.model.rootReady, false);
  assert.equal(f.model.canCreate, false);
  await f.model.configureRoot('relative');
  assert.match(f.model.error, /absolute/);
  assert.equal(saved.length, 0);
  await f.model.configureRoot('/remote-home/fixture/projects');
  assert.deepEqual(saved, [['devbox', '/remote-home/fixture/projects']]);
  assert.equal(f.model.rootReady, true);
  assert.equal(f.model.projects.length, 2);
  assert.equal(f.mutations, 0);
  assert.deepEqual(validated, ['relative', '/remote-home/fixture/projects']);
});

test('incomplete recovery stays on its saved machine when browsing other machines', async () => {
  const connected = [],
    f = setup({ machine: 'devbox' });
  const request = { ...f.request, machine: 'devbox', project: { ...a, machine: 'devbox', root: '/remote/projects' } };
  f.model.connect = async (machine) => {
    connected.push(machine);
    return machine
      ? { ...f.git, machine, inspect: async (request) => ({ kind: 'partial', request, path: request.path }) }
      : f.git;
  };
  let text = JSON.stringify(request);
  f.model.journal = createJournalStore(
    async () => text,
    async (_path, next, expected) => {
      assert.equal(expected, text);
      text = next;
    },
    '/operation.json',
  );
  await f.model.refresh();
  assert.equal(f.model.machine, 'devbox');
  assert.deepEqual(connected, ['devbox']);
  assert.equal(f.model.phase, 'editing');
  assert.equal(await f.model.selectMachine(null), true);
  await f.model.selectProject(a);
  f.model.selectRef(ref);
  f.model.setName('local');
  assert.equal(f.model.canCreate, true);
  await f.model.submit();
  assert.equal(f.mutations, 1);
  assert.deepEqual(JSON.parse(text).operations, [request]);
  await f.model.selectMachine('devbox');
  assert.equal(f.model.phase, 'editing');
  await f.model.selectProject(a);
  f.model.selectRef(ref);
  f.model.setName('feature');
  await f.model.submit();
  assert.match(f.model.error, /unresolved/);
  assert.equal(f.opens, 1);
  assert.equal(f.mutations, 1);
});

test('opening delegates session creation and focuses only the returned terminal on the selected machine', async () => {
  for (const machine of [null, 'devbox']) {
    const terminal = machine ? 'devbox/t42' : 't42',
      calls = [];
    const state = {
      spaces: [{ id: 'space', machine, tabs: [{ id: 'tab' }] }],
      panes: [{ pane: 'pane', tab: 'tab', terminal }],
    };
    const request = { machine, path: '/worktree' };
    const backend = {
      machine,
      open: async (value) => {
        assert.equal(value, request);
        return { terminal: 't42' };
      },
    };
    await openCheckout(request, backend, {
      snapshot: () => state,
      now: () => 0,
      timeout: noTimeout,
      pause: async () => {},
      run: (command) => {
        calls.push(command);
        if (command === 'space.select') state.spaces[0].active = true;
        if (command === 'pane.focus') state.panes[0].focused = true;
      },
    });
    assert.deepEqual(calls, ['space.select', 'tab.select', 'pane.focus']);
  }
});

test('opening never sends late focus commands after its deadline or uses another machine', async () => {
  const gate = deferred(),
    timer = deferred(),
    calls = [];
  const app = {
    now: () => 0,
    timeout: () => ({ promise: timer.promise, cancel() {} }),
    run: (...args) => calls.push(args),
  };
  const request = { machine: 'devbox', path: '/worktree' };
  await assert.rejects(openCheckout(request, { machine: null }, app), /another machine/);
  const pending = openCheckout(request, { machine: 'devbox', open: () => gate.promise }, app);
  timer.resolve();
  await assert.rejects(pending, /unconfirmed/);
  gate.resolve({ terminal: 't42' });
  await Promise.resolve();
  assert.deepEqual(calls, []);
});

test('destination previews discard stale responses', async () => {
  const gate = deferred();
  const f = setup();
  await fill(f.model);
  f.git.destination = () => gate.promise;
  const preview = f.model.preview();
  f.model.setName('changed');
  gate.resolve('/old');
  await preview;
  assert.equal(f.model.path, '');
  f.git.destination = async () => '/new';
  await f.model.preview();
  assert.equal(f.model.path, '/new');
});

test('known pre-creation failures clear recovery while unknown creation outcomes remain guarded', async () => {
  for (const kind of ['context_missing', 'dependency_missing', 'core_unavailable', 'launch_invalid', undefined]) {
    const f = setup({
      git: {
        create: async () => {
          throw Object.assign(new Error('creation unavailable'), { kind });
        },
      },
    });
    await fill(f.model);
    await f.model.submit();
    assert.equal(f.model.phase, kind ? 'editing' : 'partial');
    assert.equal(f.saved === null, !!kind);
    assert.equal(f.model.pending === null, !!kind);
    assert.equal(f.opens, 0);
    assert.match(f.model.error, /creation unavailable/);
  }
});

test('a failed recovery-record clear keeps known pre-creation failures guarded', async () => {
  const f = setup({
    git: {
      create: async () => {
        throw Object.assign(new Error('core unavailable'), { kind: 'core_unavailable' });
      },
    },
  });
  f.model.journal.clear = async () => {
    throw new Error('record changed');
  };
  await fill(f.model);
  await f.model.submit();
  assert.equal(f.model.phase, 'partial');
  assert(f.saved);
  assert(f.model.pending);
  assert.match(f.model.error, /record changed/);
  assert.equal(f.opens, 0);
});
