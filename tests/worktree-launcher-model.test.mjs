import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorktreeModel, openCheckout } from '../mods/worktree-launcher/model.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const noTimeout = () => ({ promise: new Promise(() => {}), cancel: () => {} });
const a = { id: 'A', path: '/projects/A', label: 'A', basename: 'A' };
const b = { id: 'B', path: '/projects/B', label: 'B', basename: 'B' };
const ref = { ref: 'refs/heads/main', name: 'main', label: 'main · local', reason: '' };
function setup(overrides = {}) {
  let saved = null, mutations = 0, opens = 0;
  const request = { project: a, action: 'new', ref: ref.ref, name: 'feature', path: '/fixture/worktree', commit: 'abc', upstream: '' };
  const git = {
    machine: null, userHome: '/fixture-home', validateRoot: async config => config.project_root,
    discover: async () => [a, b], choices: async () => [ref], destination: () => request.path,
    prepare: async () => request, create: async () => { mutations++; return { kind: 'created', path: request.path, request }; },
    inspect: async r => ({ kind: 'created', path: r.path, request: r }), ...overrides.git,
  };
  const model = new WorktreeModel({ connect: async () => git, config: async () => ({ project_root: '/projects' }), saveRoot: async () => {}, journal: { load: async () => saved, save: async r => { saved = r; } }, open: async () => { opens++; }, ...overrides });
  return { model, git, request, get mutations() { return mutations; }, get opens() { return opens; }, get saved() { return saved; } };
}
async function fill(model) { await model.refresh(); await model.selectProject(a); model.setName('feature'); model.selectRef(ref); }

test('launch choices include Shell and only supported agents installed on the selected machine', async () => {
  const seen = [];
  const f = setup({ listAgents: async machine => {
    seen.push(machine);
    return [
      { key: 'pi', name: 'Pi', installed: machine === 'devbox', run: ['pi'] },
      { key: 'codex', name: 'Codex', installed: machine === null, run: ['custom-codex', '--fixture'] },
      { key: 'unrelated', name: 'Unrelated', installed: true, run: ['unrelated'] },
    ];
  }, connect: async machine => ({ ...setup().git, machine }) });
  await f.model.refresh();
  assert.deepEqual(f.model.launches.map(item => item.key), ['shell', 'codex']);
  assert.equal(f.model.launch.key, 'shell');
  f.model.selectLaunch(f.model.launches[1]);
  assert.deepEqual(f.model.launch.argv, ['custom-codex', '--fixture']);
  await f.model.selectMachine('devbox');
  assert.deepEqual(f.model.launches.map(item => item.key), ['shell', 'pi']);
  assert.equal(f.model.launch.key, 'shell');
  assert.deepEqual(seen, [null, 'devbox']);
});

test('the selected agent is recorded before creation and preserved for open-only retry', async () => {
  const f = setup({ listAgents: async () => [{ key: 'codex', name: 'Codex', installed: true, run: ['custom-codex'] }] });
  await fill(f.model); f.model.selectLaunch(f.model.launches.find(item => item.key === 'codex'));
  let opened;
  await f.model.submit(async request => { opened = request; throw new Error('opening failed'); });
  assert.equal(f.saved.launch.key, 'codex'); assert.deepEqual(f.saved.launch.argv, ['custom-codex']);
  assert.equal(opened.launch.key, 'codex'); assert.equal(f.model.phase, 'recover');
  await f.model.openCreated(async request => { assert.equal(request.launch.key, 'codex'); });
  assert.equal(f.model.phase, 'complete'); assert.equal(f.mutations, 1);
});

test('recovery can switch to Shell and records that choice before opening without another Git mutation', async () => {
  const f = setup({ listAgents: async () => [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }] });
  await fill(f.model); f.model.selectLaunch(f.model.launches[1]);
  await f.model.submit(async () => { throw new Error('opening failed'); });
  f.model.selectLaunch(f.model.launches[0]);
  await f.model.openCreated(async request => {
    assert.equal(request.launch.key, 'shell'); assert.equal(f.saved.launch.key, 'shell');
  });
  assert.equal(f.mutations, 1); assert.equal(f.model.phase, 'complete');
});

test('agent detection runs alongside project discovery and a failed check leaves Shell available', async () => {
  const agents = deferred(); let discovered = false;
  const f = setup({ listAgents: () => agents.promise, git: { discover: async () => { discovered = true; return [a]; } } });
  const refresh = f.model.refresh(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(discovered, true); agents.resolve([]); await refresh;
  assert.deepEqual(f.model.launches.map(item => item.key), ['shell']);
  f.model.listAgents = async () => { throw new Error('availability failed'); };
  await f.model.refresh();
  assert.equal(f.model.phase, 'editing'); assert.deepEqual(f.model.launches.map(item => item.key), ['shell']);
});

test('late agent detection cannot install choices from a previously selected machine', async () => {
  const late = deferred();
  const f = setup({ listAgents: machine => machine === null ? late.promise : Promise.resolve([{ key: 'pi', name: 'Pi', installed: true, run: ['pi'] }]), connect: async machine => ({ ...setup().git, machine }) });
  const first = f.model.refresh(); await new Promise(resolve => setImmediate(resolve));
  await f.model.selectMachine('devbox');
  late.resolve([{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }]); await first;
  assert.equal(f.model.machine, 'devbox'); assert.deepEqual(f.model.launches.map(item => item.key), ['shell', 'pi']);
});

test('late choices and closed overlays cannot replace current form; selections reset', async () => {
  const late = deferred(); const f = setup({ git: { choices: p => p === a ? late.promise : Promise.resolve([ref]) } });
  await f.model.refresh(); const first = f.model.selectProject(a); await f.model.selectProject(b);
  f.model.setName('branch'); f.model.selectRef(ref); late.resolve([{ ...ref, name: 'wrong' }]); await first;
  assert.equal(f.model.project, b); assert.equal(f.model.refs[0].name, 'main');
  assert.equal(f.model.setAction('new'), false); assert.equal(f.model.name, 'branch'); assert.equal(f.model.ref, ref);
  assert.equal(f.model.setAction('existing'), true); assert.equal(f.model.ref, ref); assert.equal(f.model.name, '');
  assert.equal(f.model.canCreate, true);
  const closed = deferred(); f.model.git.choices = () => closed.promise;
  const load = f.model.selectProject(a); assert.equal(f.model.close(), true); closed.resolve([ref]); await load;
  assert.equal(f.model.refs.length, 0);
});

test('a checked-out branch previews its existing folder and remains selectable across action changes', async () => {
  const f = setup(); await fill(f.model);
  const checkedOut = { ...ref, checkout: '/projects/A' };
  f.model.selectRef(checkedOut);
  assert.equal(f.model.canCreate, true);
  f.model.setAction('existing');
  assert.equal(f.model.ref, checkedOut); assert.equal(f.model.canCreate, true);
  assert.equal(f.model.reusing, true); assert.equal(f.model.path, '/projects/A');
  f.model.selectRef({ ...ref, reason: 'unavailable' }); assert.equal(f.model.ref, checkedOut);
  f.model.selectRef(ref); assert.equal(f.model.canCreate, true);
  f.model.setAction('new');
  assert.equal(f.model.ref, ref); assert.equal(f.model.canCreate, false);
  f.model.selectRef(checkedOut); f.model.setName('another-branch');
  assert.equal(f.model.canCreate, true);
});

test('an existing-checkout session preserves its folder and program through opening recovery', async () => {
  const f = setup({ listAgents: async () => [{ key: 'codex', name: 'Codex', installed: true, run: ['codex'] }] });
  await fill(f.model); f.model.setAction('existing');
  const checkout = '/custom/existing'; f.model.selectRef({ ...ref, checkout });
  f.model.selectLaunch(f.model.launches[1]);
  f.git.prepare = async options => {
    assert.equal(options.checkout, checkout);
    return { ...f.request, action: 'existing', name: 'main', path: checkout, reuse: true };
  };
  f.git.create = async request => ({ kind: 'created', path: request.path, request });
  await f.model.submit(async request => {
    assert.equal(request.path, checkout); assert.equal(request.launch.key, 'codex');
    throw new Error('opening failed');
  });
  assert.equal(f.model.phase, 'recover'); assert.equal(f.saved.reuse, true);
  await f.model.refresh();
  assert.equal(f.model.phase, 'recover'); assert.equal(f.model.reusing, true); assert.equal(f.model.path, checkout);
  await f.model.openCreated(async request => { assert.equal(request.path, checkout); });
  assert.equal(f.model.phase, 'complete'); assert.equal(f.saved, null);
});

test('double submit admits one mutation; Escape keeps pending operation open', async () => {
  const gate = deferred(); let mutations = 0;
  const f = setup({ git: { create: async r => { mutations++; await gate.promise; return { kind: 'created', path: r.path, request: r }; } } });
  await fill(f.model); const pending = f.model.submit(); await f.model.submit();
  assert.equal(f.model.close(), false); assert.match(f.model.error, /finishing/);
  gate.resolve(); await pending; assert.equal(mutations, 1); assert.equal(f.model.phase, 'complete');
});

test('cancel before submit has no external effects', async () => {
  const f = setup(); await fill(f.model); assert(f.model.close()); await f.model.submit(); assert.equal(f.mutations, 0);
});

test('open failure retains created path and open-only retry never repeats Git', async () => {
  let opens = 0; const f = setup({ open: async () => { if (++opens === 1) throw new Error('Opening unconfirmed'); } });
  await fill(f.model); await f.model.submit(); assert.equal(f.model.phase, 'recover'); assert.equal(f.saved.path, f.request.path);
  assert.match(f.model.error, /Opening unconfirmed/); await f.model.submit(); assert.equal(f.mutations, 1);
  await f.model.openCreated(); assert.equal(opens, 2); assert.equal(f.mutations, 1); assert.equal(f.saved, null);
});

test('reopening reconciles journal before allowing mutation, including incomplete artifacts', async () => {
  for (const kind of ['created', 'partial', 'absent']) {
    const f = setup(); let mutation = 0;
    f.model.journal.load = async () => f.request;
    f.git.inspect = async r => ({ kind, path: r.path, request: r, error: kind === 'partial' ? 'branch already exists' : '' });
    f.git.create = async () => { mutation++; };
    await f.model.refresh(); assert.equal(f.model.phase, kind === 'created' ? 'recover' : 'partial');
    await f.model.submit(); assert.equal(mutation, 0);
  }
});

test('invalid config, failed preparation and journal failure block creation', async () => {
  const invalid = setup({ config: async () => { throw new Error('Malformed config.json'); } });
  await invalid.model.refresh(); assert.match(invalid.model.error, /Malformed/); assert.equal(invalid.model.projects.length, 0);
  for (const failure of ['prepare', 'journal']) {
    const f = setup(); await fill(f.model);
    if (failure === 'prepare') f.model.git.prepare = async () => { throw new Error('stale ref'); };
    else f.model.journal.save = async () => { throw new Error('journal unavailable'); };
    await f.model.submit(); assert.equal(f.mutations, 0); assert.equal(f.model.phase, 'editing');
  }
});

test('space matching uses live checkout identity, ignores remote and nested repos, and focuses matching shell', async () => {
  const request = { path: '/worktree', project: { id: 'A', path: '/project' } };
  const calls = [];
  const state = {
    spaces: [{ id: 'project', machine: null, tabs: [{ id: 'project-tab' }] }, { id: 'nested', machine: null, tabs: [{ id: 'nested-tab' }] }, { id: 'remote', machine: 'remote', tabs: [{ id: 'remote-tab' }] }, { id: 'correct', machine: null, tabs: [{ id: 'correct-tab' }] }],
    panes: [{ pane: 'project-pane', tab: 'project-tab', cwd: '/project/subdir', terminal: 'tp', program: { agent: true } }, { pane: 'n', tab: 'nested-tab', cwd: '/worktree/nested', terminal: 'tn', program: { shell: true } }, { pane: 'r', tab: 'remote-tab', cwd: '/worktree', terminal: 'tr', program: { shell: true } }, { pane: 'c', tab: 'correct-tab', cwd: '/worktree/subdir', terminal: 'tc', program: { shell: true }, focused: false }],
  };
  const git = { identity: async p => ({ top: p.startsWith('/project') ? '/project' : p.includes('nested') ? '/worktree/nested' : '/worktree', id: p.includes('nested') ? 'B' : 'A' }) };
  await openCheckout(request, git, { snapshot: () => state, pause: async () => {}, timeout: noTimeout, now: () => 0, run: (name, args) => {
    calls.push([name, args]);
    if (name === 'space.select') state.spaces.find(s => s.id === args.id).active = true;
    if (name === 'pane.focus') state.panes.find(p => p.pane === args.pane).focused = true;
  } });
  assert(!calls.some(([n]) => n === 'space.new')); assert(calls.some(([n, a]) => n === 'space.select' && a.id === 'correct'));
});

test('opening creates and observes the project space before the worktree space', async () => {
  const calls = [], state = { spaces: [], panes: [] };
  const request = { path: '/worktree', project: { id: 'A', path: '/project' } };
  await openCheckout(request, { identity: async path => ({ id: 'A', top: path }) }, {
    snapshot: () => state, pause: async () => {}, timeout: noTimeout, now: () => 0,
    run: (command, args) => {
      calls.push([command, args]);
      if (command === 'space.new') {
        const id = String(state.spaces.length);
        state.spaces.push({ id, tabs: [{ id }], machine: null, active: false });
        state.panes.push({ pane: id, tab: id, terminal: id, cwd: args.folder, program: { shell: true }, focused: false });
      }
      if (command === 'space.select') state.spaces.forEach(s => { s.active = s.id === args.id; });
      if (command === 'pane.focus') state.panes.forEach(p => { p.focused = p.pane === args.pane; });
    },
  });
  assert.deepEqual(calls.filter(([command]) => command === 'space.new'), [['space.new', { folder: '/project', machine: '' }], ['space.new', { folder: '/worktree', machine: '' }]]);
  assert.equal(state.panes.find(p => p.focused).cwd, '/worktree');
});

test('selected agents launch in the worktree on the correct machine and reuse their existing pane on retry', async () => {
  for (const machine of [null, 'devbox']) for (const existing of [false, true]) {
    const prefix = machine ? 'devbox/' : '';
    const state = { spaces: [], panes: [] }, calls = [];
    function addPane(space, folder, program) {
      const tab = `${prefix}tab-${state.panes.length}`, pane = `${prefix}pane-${state.panes.length}`;
      space.tabs.push({ id: tab });
      state.panes.push({ pane, tab, cwd: folder, terminal: pane, program, focused: false });
    }
    const primary = { id: `${prefix}primary`, machine, folder: '/project', tabs: [] };
    state.spaces.push(primary); addPane(primary, '/project', { shell: true });
    if (existing) {
      const worktree = { id: `${prefix}worktree`, machine, folder: '/worktree', tabs: [] };
      state.spaces.push(worktree); addPane(worktree, '/worktree', { shell: true });
    }
    let time = 0;
    const request = { machine, path: '/worktree', project: { id: 'A', path: '/project' }, launch: { key: 'codex', label: 'Codex', argv: ['custom-codex', '--config', 'value with spaces'] } };
    const app = { snapshot: () => state, now: () => time, pause: async () => { time += 250; }, timeout: noTimeout,
      run: (command, args) => {
        calls.push([command, args]);
        if (command === 'space.new') {
          const space = { id: `${prefix}worktree`, machine: args.machine || null, folder: args.folder, tabs: [] };
          state.spaces.push(space); addPane(space, args.folder, { key: 'codex', agent: true });
        }
        if (command === 'tab.new') addPane(state.spaces.find(space => space.id === args.space), args.folder, { key: 'codex', agent: true });
        if (command === 'space.select') state.spaces.forEach(space => { space.active = space.id === args.id; });
        if (command === 'pane.focus') state.panes.forEach(pane => { pane.focused = pane.pane === args.pane; });
      },
    };
    const git = { machine, identity: async path => ({ id: 'A', top: path }) };
    await openCheckout(request, git, app);
    const launches = calls.filter(([command]) => ['space.new', 'tab.new'].includes(command));
    assert.equal(launches.length, 1); assert.equal(launches[0][0], existing ? 'tab.new' : 'space.new');
    assert.deepEqual(launches[0][1].argv, request.launch.argv); assert.equal(launches[0][1].folder, '/worktree');
    if (existing) assert.equal(launches[0][1].space, `${prefix}worktree`);
    else assert.equal(launches[0][1].machine, machine ?? '');
    assert.equal(state.panes.find(pane => pane.focused).program.key, 'codex');
    await openCheckout(request, git, app);
    assert.equal(calls.filter(([command]) => ['space.new', 'tab.new'].includes(command)).length, 1);
  }
});

test('an unobserved project space prevents opening an ungrouped worktree space', async () => {
  let time = 0; const calls = [];
  await assert.rejects(openCheckout({ path: '/worktree', project: { id: 'A', path: '/project' } }, { identity: async path => ({ id: 'A', top: path }) }, {
    snapshot: () => ({ spaces: [], panes: [] }), run: (...args) => calls.push(args), now: () => time, pause: async () => { time += 1000; }, timeout: noTimeout,
  }), /unconfirmed/i);
  assert.deepEqual(calls, [['space.new', { folder: '/project', machine: '' }]]);
});

test('an existing project space with no terminal cwd is reused by its folder', async () => {
  const created = [], state = { spaces: [{ id: 'project', folder: '/project', machine: null, tabs: [] }], panes: [] };
  await openCheckout({ path: '/worktree', project: { id: 'A', path: '/project' } }, { identity: async path => ({ id: 'A', top: path }) }, {
    snapshot: () => state, pause: async () => {}, timeout: noTimeout, now: () => 0,
    run: (command, args) => {
      if (command === 'space.new') {
        created.push(args.folder); const id = String(state.spaces.length);
        state.spaces.push({ id, folder: args.folder, machine: null, tabs: [{ id }] });
        state.panes.push({ pane: id, tab: id, terminal: id, cwd: args.folder, program: { shell: true } });
      }
      if (command === 'space.select') state.spaces.forEach(s => { s.active = s.id === args.id; });
      if (command === 'pane.focus') state.panes.forEach(p => { p.focused = p.pane === args.pane; });
    },
  });
  assert.deepEqual(created, ['/worktree']);
});

test('opening expires during a slow identity probe and never sends a late app command', { timeout: 1000 }, async () => {
  const probe = deferred(), timeout = deferred(); const calls = [];
  const operation = openCheckout({ path: '/worktree', project: { id: 'A' } }, { identity: () => probe.promise }, {
    snapshot: () => ({ spaces: [], panes: [] }), run: (...args) => calls.push(args), now: () => 0,
    pause: async () => {}, timeout: () => ({ promise: timeout.promise, cancel: () => {} }),
  });
  timeout.resolve();
  await assert.rejects(operation, /unconfirmed/i);
  probe.resolve({ id: 'A', top: '/worktree' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, []);
});

test('open-only retry refuses a checkout that changed after its first inspection', async () => {
  const f = setup({ open: async () => { throw new Error('injected opening failure'); } });
  await fill(f.model); await f.model.submit();
  let opens = 0;
  f.model.open = async () => { opens++; };
  f.model.git.inspect = async request => ({ kind: 'partial', path: request.path, request, error: 'checkout changed' });
  await f.model.openCreated(); await f.model.submit();
  assert.equal(f.model.phase, 'partial'); assert.equal(opens, 0); assert.equal(f.mutations, 1);
  assert.equal(f.saved.path, f.request.path);
});

test('journal-clear failure preserves open-only recovery after a successful opening', async () => {
  const f = setup(); await fill(f.model);
  const save = f.model.journal.save;
  f.model.journal.save = async request => { if (request === null) throw new Error('cannot clear journal'); await save(request); };
  await f.model.submit();
  assert.equal(f.model.phase, 'recover'); assert.equal(f.opens, 1); assert.equal(f.mutations, 1);
  assert.equal(f.saved.path, f.request.path);
  f.model.journal.save = save; await f.model.openCreated();
  assert.equal(f.model.phase, 'complete'); assert.equal(f.saved, null);
  assert.equal(f.opens, 2); assert.equal(f.mutations, 1);
});

test('failure without any artifact clears the journal and waits for an explicit retry', async () => {
  let attempts = 0;
  const f = setup({ git: { create: async request => ({ kind: ++attempts === 1 ? 'absent' : 'created', request, path: request.path, error: 'injected failure' }) } });
  await fill(f.model); await f.model.submit();
  assert.equal(f.model.phase, 'editing'); assert.equal(f.saved, null); assert.equal(attempts, 1);
  assert.equal(f.opens, 0); assert.match(f.model.error, /injected failure/);
  await f.model.submit();
  assert.equal(f.model.phase, 'complete'); assert.equal(attempts, 2); assert.equal(f.opens, 1);
});

test('machine changes invalidate late discovery and clear dependent selections', async () => {
  const late = deferred();
  const local = setup().git, remote = { ...local, machine: 'devbox', userHome: '/remote-home/fixture', discover: async () => [{ ...b, machine: 'devbox' }] };
  local.discover = () => late.promise;
  const f = setup({ connect: async machine => machine ? remote : local });
  const loading = f.model.refresh();
  await new Promise(resolve => setImmediate(resolve));
  await f.model.selectMachine('devbox');
  late.resolve([a]); await loading;
  assert.equal(f.model.machine, 'devbox'); assert.equal(f.model.git, remote);
  assert.deepEqual(f.model.projects.map(p => p.id), ['B']);
  assert.equal(f.model.project, null); assert.equal(f.model.ref, null); assert.equal(f.model.name, '');
});

test('an unset root can be validated and saved on the selected machine without Git mutation', async () => {
  const roots = new Map(), validated = [], saved = [];
  const f = setup({ machine: 'devbox',
    config: async machine => ({ project_root: roots.get(machine) ?? '' }),
    saveRoot: async (machine, root) => { roots.set(machine, root); saved.push([machine, root]); },
    git: { machine: 'devbox', validateRoot: async config => {
      validated.push(config.project_root);
      if (!config.project_root.startsWith('/')) throw new Error('Use an absolute directory.');
      return config.project_root;
    } },
  });
  await f.model.refresh(); assert.equal(f.model.rootReady, false); assert.equal(f.model.canCreate, false);
  await f.model.configureRoot('relative'); assert.match(f.model.error, /absolute/); assert.equal(saved.length, 0);
  await f.model.configureRoot('/remote-home/fixture/projects');
  assert.deepEqual(saved, [['devbox', '/remote-home/fixture/projects']]);
  assert.equal(f.model.rootReady, true); assert.equal(f.model.projects.length, 2); assert.equal(f.mutations, 0);
  assert.deepEqual(validated, ['relative', '/remote-home/fixture/projects']);
});

test('recovery pins its saved machine and cannot silently switch to local creation', async () => {
  const connected = [], f = setup({ machine: null });
  const request = { ...f.request, machine: 'devbox', project: { ...a, machine: 'devbox', root: '/remote/projects' } };
  f.model.connect = async machine => { connected.push(machine); return { ...f.git, machine }; };
  f.model.journal.load = async () => request;
  await f.model.refresh();
  assert.equal(f.model.machine, 'devbox'); assert.deepEqual(connected, ['devbox']);
  assert.equal(f.model.phase, 'recover'); assert.equal(await f.model.selectMachine(null), false);
  await f.model.openCreated(); assert.equal(f.opens, 1); assert.equal(f.mutations, 0);
});

test('remote space matching ignores identical local paths and uses namespaced remote IDs', async () => {
  const calls = [], state = { spaces: [], panes: [] };
  for (const machine of [null, 'other', 'devbox']) for (const path of ['/project', '/worktree']) {
    const id = `${machine ?? 'local'}${path}`;
    state.spaces.push({ id, machine, folder: path, tabs: [{ id }], active: false });
    state.panes.push({ pane: id, tab: id, terminal: id, cwd: path, program: { shell: true }, focused: false });
  }
  await openCheckout({ machine: 'devbox', path: '/worktree', project: { id: 'A', path: '/project' } }, { machine: 'devbox', identity: async path => ({ id: 'A', top: path }) }, {
    snapshot: () => state, pause: async () => {}, timeout: noTimeout, now: () => 0,
    run: (command, args) => {
      calls.push([command, args]);
      if (command === 'space.select') state.spaces.forEach(s => { s.active = s.id === args.id; });
      if (command === 'pane.focus') state.panes.forEach(p => { p.focused = p.pane === args.pane; });
    },
  });
  assert(!calls.some(([command]) => command === 'space.new'));
  assert(calls.some(([command, args]) => command === 'space.select' && args.id === 'devbox/worktree'));
  assert(!state.spaces.some(s => s.machine !== 'devbox' && s.active));
});

test('remote opening sends the machine on every new project/worktree space and rejects a wrong adapter', async () => {
  const calls = [], state = { spaces: [], panes: [] };
  const request = { machine: 'devbox', path: '/worktree', project: { id: 'A', path: '/project' } };
  const app = { snapshot: () => state, pause: async () => {}, timeout: noTimeout, now: () => 0,
    run: (command, args) => {
      calls.push([command, args]);
      if (command === 'space.new') {
        const id = `devbox/${state.spaces.length}`;
        state.spaces.push({ id, machine: args.machine, folder: args.folder, tabs: [{ id }] });
        state.panes.push({ pane: id, tab: id, terminal: id, cwd: args.folder, program: { shell: true } });
      }
      if (command === 'space.select') state.spaces.forEach(s => { s.active = s.id === args.id; });
      if (command === 'pane.focus') state.panes.forEach(p => { p.focused = p.pane === args.pane; });
    },
  };
  await assert.rejects(openCheckout(request, { machine: null }, app), /another machine/);
  assert.deepEqual(calls, []);
  await openCheckout(request, { machine: 'devbox', identity: async path => ({ id: 'A', top: path }) }, app);
  assert.deepEqual(calls.filter(([command]) => command === 'space.new'), [
    ['space.new', { folder: '/project', machine: 'devbox' }], ['space.new', { folder: '/worktree', machine: 'devbox' }],
  ]);
});
