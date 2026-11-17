import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { WorktreeModel } from '../mods/worktree-launcher/model.js';
import { createConfigStore } from '../mods/worktree-launcher/config.js';

// Load the real view methods without a native window; controls below record focus.
const modules = {
  'gpui-kit': 'export class View {} export const div = () => globalThis.launcherElement();',
  'gpui-base':
    'const el=()=>globalThis.launcherElement(); export const v_flex=el,h_flex=el,v_virtual_list=el,Button={new:id=>globalThis.launcherElement(id)},Input={new:state=>globalThis.launcherElement(state)},Textarea={new:state=>globalThis.launcherElement(state)},Popup={new:el},Scrollbar={vertical:el},TextView={html:el},VirtualListScrollHandle={new:()=>({scroll_to_item(){}})},InputState={new:()=>({handlers:{},text:"",on(event,fn){this.handlers[event]=fn;},set_value(value){this.text=value;},value(){return this.text;},focus(){}})}; export const TextareaState=InputState;',
  herdr:
    'export const exec=null,home=()=>"/fixture-home",appHome=()=>"/fixture-app",readTextFile=null,writeTextFile=null,spaces=()=>globalThis.launcherSpaces,panes=()=>globalThis.launcherPanes,focused=()=>globalThis.launcherFocused,machines=null,knownAgents=async()=>[],pickFolder=null,shared=null,setShared=null,run=null,theme=()=>({}); export const props=()=>({overlay:"fixture-overlay"}),closeOverlay=id=>globalThis.launcherClosedOverlays.push(id);',
};
registerHooks({
  resolve(specifier, context, next) {
    return Object.hasOwn(modules, specifier)
      ? { url: `native:${specifier}`, shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith('native:')
      ? { format: 'module', source: modules[url.slice(7)], shortCircuit: true }
      : next(url, context);
  },
});
const { default: Launcher } = await import('../mods/worktree-launcher/main.js');

function keyboardView(phase = 'editing', spaces = [], { panes = [], focused = null } = {}) {
  globalThis.launcherClosedOverlays = [];
  globalThis.launcherSpaces = spaces;
  globalThis.launcherPanes = panes;
  globalThis.launcherFocused = focused;
  const handlers = new Map(),
    bindings = [],
    opacities = [],
    focus = [],
    disabled = new Map(),
    labels = [];
  const nativeWindow = {
    active: false,
    activations: 0,
    activate_window() {
      this.active = true;
      this.activations++;
    },
    is_window_active() {
      return this.active;
    },
  };
  globalThis.window = nativeWindow;
  globalThis.launcherElement = (id) => {
    const element = new Proxy(
      {},
      {
        get:
          (_target, key) =>
          (...args) => {
            if (key === 'on_key_down' || key === 'on_key_up') handlers.set(key, args[0]);
            if (key === 'opacity') opacities.push(args[0]);
            if (key === 'disabled') disabled.set(id, !!args[0]);
            if (key === 'child' && typeof args[0] === 'string') labels.push(args[0]);
            if (key === 'when' && args[0]) return args[1](element);
            return element;
          },
      },
    );
    return element;
  };
  const view = new Launcher();
  let initialWork;
  view.task = (_cx, work) => {
    initialWork = work;
  };
  let focusedHandle;
  const cx = {
    focus_handle: () => {
      const handle = {
        focus() {
          focus.push('handle');
          focusedHandle = handle;
        },
        is_focused: () => focusedHandle === handle,
      };
      return handle;
    },
    bind_keys: (rows) => bindings.push(...rows),
    stop_propagation() {},
    notify() {},
  };
  view.init({}, cx);
  view.model.phase = phase;
  if (phase !== 'loading') view.initializing = false;
  view.render();
  assert(!bindings.some((row) => row.keystroke === 'escape'), 'Do not override native Escape routing');
  assert(handlers.has('on_key_down'));
  assert(handlers.has('on_key_up'));
  return {
    view,
    cx,
    focus,
    nativeWindow,
    opacities,
    disabled,
    labels,
    initialWork,
    pressEscape: () => handlers.get('on_key_up')({ key: 'escape' }, cx),
  };
}

test('startup resolves the current checkout without discovery; opening the project picker scans once without blocking editing', {
  timeout: 2000,
}, async () => {
  const gate = () => {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const discovery = gate(),
    selection = gate(),
    selected = gate(),
    branches = gate(),
    choosing = gate();
  const { view, initialWork, cx, disabled, labels } = keyboardView('loading', [{ active: true, folder: '/checkout' }]);
  const project = { id: 'repo', path: '/projects/app', label: 'app' },
    ref = { ref: 'refs/heads/main', label: 'main' };
  let scans = 0;
  view.model.config = async () => ({ project_root: '/projects' });
  view.model.listAgents = async () => [];
  view.model.connect = async () => ({
    discover: () => {
      scans++;
      return discovery.promise;
    },
    selection: () => {
      selected.resolve();
      return selection.promise;
    },
    choices: () => {
      choosing.resolve();
      return branches.promise;
    },
    remotes: async () => [],
  });
  const pending = initialWork(null, () => {});
  let actions = 0;
  view.task = () => {
    actions++;
  };
  const assertLoading = () => {
    disabled.clear();
    labels.length = 0;
    view.render();
    for (const field of [
      'machine',
      'root',
      'project',
      'ref',
      'name',
      'launch',
      ...(view.model.project ? ['remote'] : []),
    ])
      assert.equal(disabled.get(view.inputs[field]), true, field);
    for (const id of ['refresh', 'save-root', 'browse-root', 'new', 'existing', 'create'])
      assert.equal(disabled.get(id), true, id);
    assert.equal(disabled.get('close'), false, 'Closing stays available');
    assert(
      labels.some((text) => /Loading/.test(text)),
      'Show why the form is disabled',
    );
    view.choose(project, cx, 'project');
    view.choose({ name: 'other', label: 'other' }, cx, 'machine');
    view.submitInput('root', {}, cx);
    view.submitInput('name', {}, cx);
    view.key({ key: 'enter', keystroke: 'cmd-enter' }, cx);
    assert.equal(actions, 0, 'Clicks and Enter cannot start work during initialization');
  };
  assertLoading();
  await selected.promise;
  assertLoading();
  selection.resolve({ project, ref: ref.ref });
  await choosing.promise;
  assertLoading();
  branches.resolve([ref]);
  await pending;
  disabled.clear();
  labels.length = 0;
  view.model.setName('feature');
  view.render();
  assert.equal(view.model.ref, ref);
  for (const field of ['machine', 'project', 'ref', 'name'])
    assert.equal(disabled.get(view.inputs[field]), false, field);
  assert.equal(disabled.get('create'), false);
  assert(!labels.some((text) => /Loading/.test(text)));
  assert.equal(scans, 0, 'The current checkout must not wait for a project-root scan');
  let pendingScan;
  view.task = (_cx, work) => {
    pendingScan = work(null, () => {});
  };
  view.inputs.project.handlers.focus({}, cx);
  view.inputs.project.handlers.change({}, cx);
  assert.equal(scans, 1, 'Focus and typing share the scan');
  assert.equal(view.emptyMessage('project'), 'Loading projects…');
  assert.equal(view.model.canCreate, true, 'A project scan cannot block the current checkout');
  discovery.resolve([project]);
  await pendingScan;
  assert.deepEqual(view.model.projects, [project]);
  assert.equal(view.model.ref, ref);
  assert.equal(view.model.name, 'feature');
});

test('opening focuses and activates the launcher before slow project loading, so Escape can close it', async () => {
  const { view, focus, nativeWindow, initialWork, pressEscape } = keyboardView('loading');
  let release;
  view.model.refresh = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = initialWork(null, () => {});
  assert.equal(focus.length, 1, 'The launcher handle receives focus immediately');
  assert.equal(nativeWindow.activations, 1, 'Activate before awaiting projects');
  pressEscape();
  assert.equal(view.model.closed, true);
  release();
  await pending;
  assert.equal(view.initializing, false);
  assert.deepEqual(globalThis.launcherClosedOverlays, ['fixture-overlay']);
});

test('startup errors restore editing and Tab then Enter can close a loading form', async () => {
  const { view, initialWork, disabled } = keyboardView('loading');
  view.model.config = async () => {
    throw new Error('Configuration unavailable');
  };
  await initialWork(null, () => {});
  view.render();
  assert.equal(view.initializing, false);
  assert.match(view.model.error, /Configuration unavailable/);
  assert.equal(disabled.get(view.inputs.machine), false);
  assert.equal(disabled.get('refresh'), false);
  const loading = keyboardView('loading');
  loading.view.key({ key: 'tab' }, loading.cx);
  assert.equal(loading.view.buttons.close.is_focused(), true);
  loading.view.key({ key: 'enter' }, loading.cx);
  assert.equal(loading.view.model.closed, true);
});

test('opening preselects the active space repository and checkout branch on its machine', async () => {
  for (const machine of [null, 'devbox']) {
    const { view, initialWork } = keyboardView('loading', [
      { active: true, machine, folder: '/checkouts/feature/src' },
    ]);
    const project = { id: '/projects/app/.git', path: '/projects/app', label: 'team/app', machine };
    const base = { ref: 'refs/heads/feature/current', name: 'feature/current', label: 'feature/current · local' };
    const calls = [],
      focused = [];
    view.model.config = async (on) => {
      assert.equal(on, machine);
      return { project_root: '/projects' };
    };
    view.model.listAgents = async () => [];
    view.model.connect = async (on) => {
      assert.equal(on, machine);
      return {
        discover: async () => {
          throw new Error('Startup must not scan all projects');
        },
        selection: async (path) => {
          calls.push(path);
          return { project, ref: base.ref };
        },
        choices: async () => [base],
        remotes: async () => [],
      };
    };
    for (const field of ['project', 'ref', 'name']) view.inputs[field].focus = () => focused.push(field);
    await initialWork(null, () => {});
    assert.equal(view.model.project, project, 'Use the resolved current repository directly');
    assert.equal(view.model.ref, base);
    assert.equal(view.inputs.project.value(), 'team/app');
    assert.equal(view.inputs.ref.value(), base.label);
    assert.deepEqual(calls, ['/checkouts/feature/src']);
    assert.deepEqual(focused, ['name']);
    assert.equal(view.model.name, '');
    assert.equal(view.model.canCreate, false);
    view.model.selectRef(null); // The selection remains an editable suggestion.
    assert.equal(view.model.ref, null);
  }
});

test('opening uses the live terminal checkout rather than the space starting folder', async () => {
  for (const machine of [null, 'devbox']) {
    for (const source of ['focused', 'active-tab', 'mod-pane', 'other-space']) {
      const space = {
        id: 'current-space',
        active: true,
        machine,
        folder: '/starting-folder',
        tabs: [
          { id: 'current-tab', active: true },
          { id: 'old-tab', active: false },
        ],
      };
      const current = { tab: 'current-tab', cwd: '/checkouts/feature/src', terminal: 't1' };
      const context = {
        focused:
          source === 'focused'
            ? { space: space.id, cwd: current.cwd, pane: null }
            : source === 'mod-pane'
              ? { space: space.id, cwd: null }
              : source === 'other-space'
                ? { space: 'other-space', cwd: '/unrelated/repo' }
                : null,
        panes: [
          { tab: 'foreign-tab', cwd: '/another/machine' },
          { tab: 'old-tab', cwd: '/old/checkout' },
          ...(source === 'focused' ? [] : [{ tab: 'current-tab', cwd: null }, current]),
        ],
      };
      const { view, initialWork } = keyboardView('loading', [space], context);
      const project = { id: 'repo', path: '/projects/app', label: 'app', machine };
      const ref = { ref: 'refs/heads/feature/current', label: 'feature/current · local' };
      const calls = [];
      view.model.config = async () => ({ project_root: '/projects' });
      view.model.listAgents = async () => [];
      view.model.connect = async (on) => {
        assert.equal(on, machine);
        return {
          discover: async () => [project],
          choices: async () => [ref],
          remotes: async () => [],
          selection: async (path) => {
            calls.push(path);
            if (path !== current.cwd) throw new Error('Not a repository');
            return { project, ref: ref.ref };
          },
        };
      };
      // Focus can move while discovery runs; use the context captured on opening.
      globalThis.launcherFocused = { space: 'other-space', cwd: '/changed/after-opening' };
      await initialWork(null, () => {});
      assert.deepEqual(calls, [current.cwd], `${machine ?? 'local'}: ${source}`);
      assert.equal(view.model.project, project);
      assert.equal(view.model.ref, ref);
      assert.equal(view.inputs.project.value(), project.label);
      assert.equal(view.inputs.ref.value(), ref.label);
    }
  }
});

test('unavailable, excluded, and detached active checkouts leave manual choices available', async () => {
  for (const scenario of ['unavailable', 'excluded', 'detached']) {
    const { view, initialWork } = keyboardView('loading', [{ active: true, machine: null, folder: '/checkout' }]);
    const project = { id: 'repo', path: '/projects/app', label: 'app' };
    view.model.config = async () => ({ project_root: '/projects' });
    view.model.listAgents = async () => [];
    view.model.connect = async () => ({
      discover: async () => [project],
      choices: async () => [],
      remotes: async () => [],
      selection: async () => {
        if (scenario === 'unavailable') throw new Error('Not a Git repository');
        if (scenario === 'excluded') throw new Error('Current project is excluded');
        return { project, ref: '' };
      },
    });
    await initialWork(null, () => {});
    assert.equal(view.model.project, scenario === 'detached' ? project : null);
    assert.equal(view.model.ref, null);
    assert.equal(view.model.error, '');
    assert.equal(view.model.phase, 'editing');
  }
});

test('late initial checkout suggestions cannot replace manual choices, cross machines, or reopen a closed form', async () => {
  for (const change of ['project', 'machine', 'close']) {
    const { view, initialWork } = keyboardView('loading', [{ active: true, machine: null, folder: '/checkout' }]);
    const project = { id: 'repo', path: '/projects/app', label: 'app' },
      other = { id: 'other', path: '/projects/other', label: 'other' };
    let release, started;
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    view.model.config = async () => ({ project_root: '/projects' });
    view.model.listAgents = async () => [];
    view.model.connect = async () => ({
      discover: async () => [project, other],
      choices: async () => [],
      remotes: async () => [],
      selection: () => {
        started();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const pending = initialWork(null, () => {});
    await waiting;
    if (change === 'project') await view.model.selectProject(other);
    else if (change === 'machine') await view.model.selectMachine('other-machine');
    else view.model.close();
    release({ project, ref: 'refs/heads/main' });
    await pending;
    assert.equal(view.model.project, change === 'project' ? other : null);
    assert.equal(view.model.ref, null);
    assert.equal(view.model.machine, change === 'machine' ? 'other-machine' : null);
    assert.equal(view.model.closed, change === 'close');
  }
});

test('inactive launcher windows dim and regain full opacity without stealing focus', () => {
  const { view, nativeWindow, opacities } = keyboardView();
  assert(opacities.at(-1) < 1 && opacities.at(-1) >= 0.75);
  nativeWindow.active = true;
  view.render();
  assert.equal(opacities.at(-1), 1);
  nativeWindow.active = false;
  view.render();
  assert(opacities.at(-1) < 1);
  assert.equal(nativeWindow.activations, 0, 'Rendering must not reactivate the window');
});

test('launcher dims when a terminal has focus, while its inputs and buttons stay fully opaque', () => {
  const { view, nativeWindow, opacities, cx } = keyboardView();
  nativeWindow.active = true;
  const terminal = cx.focus_handle();
  terminal.focus();
  view.render();
  assert(opacities.at(-1) < 1, 'An active app does not mean the launcher has focus');
  view.buttons.close.focus();
  view.render();
  assert.equal(opacities.at(-1), 1);
  terminal.focus();
  view.activeInput = 'name';
  view.render();
  assert.equal(opacities.at(-1), 1);
  view.activeInput = null;
  view.handle.focus();
  view.render();
  assert.equal(opacities.at(-1), 1);
});

test('Escape release closes the launcher without installing a competing native binding', () => {
  for (const field of ['machine', 'root', 'project', 'ref', 'name', null]) {
    const { view, pressEscape } = keyboardView();
    view.activeInput = field;
    view.openField = field;
    pressEscape();
    assert.equal(view.model.closed, true);
    assert.deepEqual(globalThis.launcherClosedOverlays, ['fixture-overlay']);
  }
});

test('Escape release preserves active saves and worktree operations', () => {
  for (const phase of ['configuring', 'fetching', 'creating', 'opening', 'saving-root']) {
    const { view, pressEscape } = keyboardView(phase === 'saving-root' ? 'loading' : phase);
    view.savingRoot = phase === 'saving-root';
    pressEscape();
    assert.equal(view.model.closed, false);
    assert.deepEqual(globalThis.launcherClosedOverlays, []);
  }
});

test('Git remote Enter selects a remote, then the focused Fetch button fetches instead of creating', async () => {
  const { view, cx } = keyboardView();
  assert(view.inputs.remote, 'Project controls include a Git remote picker');
  let fetches = 0,
    creates = 0,
    focused = false;
  view.buttons.fetch.focus = () => {
    focused = true;
  };
  view.buttons.fetch.is_focused = () => focused;
  view.model.project = {};
  view.model.ref = {};
  view.model.name = 'feature';
  view.model.remotes = [
    { name: 'origin', label: 'origin' },
    { name: 'upstream', label: 'upstream' },
  ];
  view.model.remote = view.model.remotes[0];
  view.index = 1;
  view.openField = 'remote';
  view.model.fetchRemote = async () => {
    fetches++;
  };
  view.model.submit = async () => {
    creates++;
  };
  const pending = [];
  view.task = (_cx, work) => {
    pending.push(work(null, () => {}));
  };
  view.inputs.remote.handlers.submit({ secondary: false }, cx);
  assert.equal(view.model.remote.name, 'upstream');
  assert.equal(fetches, 0);
  view.key({ key: 'enter' }, cx);
  await Promise.all(pending);
  assert.equal(fetches, 1);
  assert.equal(creates, 0);
});

test('Enter from a completed branch name or the form invokes Create only while enabled', async () => {
  const { view, cx } = keyboardView();
  let creates = 0;
  view.model.project = {};
  view.model.ref = {};
  view.model.name = 'feature';
  view.model.submit = async () => {
    creates++;
  };
  view.task = (_cx, work) => work();
  view.openField = null;
  view.inputs.name.handlers.submit({ secondary: false }, cx);
  assert.equal(creates, 1);
  view.activeInput = null;
  view.key({ key: 'enter' }, cx);
  assert.equal(creates, 2);
  view.model.name = '';
  view.inputs.name.handlers.submit({ secondary: false }, cx);
  view.key({ key: 'enter' }, cx);
  assert.equal(creates, 2);
  view.model.name = 'feature';
  view.model.phase = 'creating';
  view.inputs.name.handlers.submit({ secondary: false }, cx);
  assert.equal(creates, 2);
});

test('the initial prompt is agent-only, editable, keyboard reachable, and submits without opening a picker', () => {
  const { view, cx, disabled, labels } = keyboardView();
  assert(!labels.includes('Initial prompt (optional)'));
  const agent = { key: 'codex', label: 'Codex', argv: ['codex'] };
  view.model.launches.push(agent);
  view.model.selectLaunch(agent);
  labels.length = 0;
  view.render();
  assert(labels.includes('Initial prompt (optional)'));
  assert.equal(disabled.get(view.inputs.prompt), false);
  view.inputs.prompt.set_value('Explain the checkout.\nThen run the tests.');
  view.inputs.prompt.handlers.change({}, cx);
  assert.equal(view.model.prompt, 'Explain the checkout.\nThen run the tests.');
  view.inputs.prompt.handlers.focus({}, cx);
  assert.equal(view.openField, null);
  let focused = false;
  view.inputs.prompt.focus = () => {
    focused = true;
  };
  view.activeInput = 'launch';
  view.key({ key: 'tab', modifiers: {} }, cx);
  assert(focused);
  view.model.project = {};
  view.model.ref = {};
  view.model.name = 'feature';
  let created = 0;
  view.model.submit = () => {
    created++;
  };
  view.task = (_cx, work) => work();
  view.activeInput = 'prompt';
  view.key({ key: 'enter' }, cx);
  view.inputs.prompt.handlers.submit({}, cx);
  assert.equal(created, 0, 'Plain Enter must remain a newline, not create a worktree');
  view.inputs.prompt.handlers.submit({ secondary: true }, cx);
  assert.equal(created, 1);
  view.key({ key: 'enter', keystroke: 'cmd-enter' }, cx);
  assert.equal(created, 2, 'Cmd+Enter still submits');
  view.model.phase = 'creating';
  view.render();
  assert.equal(disabled.get(view.inputs.prompt), true);
});

test('Enter on secondary buttons never creates a worktree', () => {
  const { view, cx } = keyboardView();
  let creates = 0;
  view.model.project = {};
  view.model.ref = {};
  view.model.name = 'feature';
  view.model.submit = async () => {
    creates++;
  };
  view.task = (_cx, work) => work();
  view.openField = null;
  view.activeInput = null;
  for (const key of ['save-root', 'browse-root', 'refresh', 'close', 'new', 'existing']) {
    view.buttons[key].focus();
    view.key({ key: 'enter' }, cx);
    assert.equal(creates, 0, `Enter on ${key} must retain its own action`);
  }
  view.buttons.create.focus();
  view.key({ key: 'enter' }, cx);
  assert.equal(creates, 1);
});

test('Enter selects an open picker choice and root Enter still saves configuration', () => {
  const { view, cx } = keyboardView();
  view.model.project = {};
  view.model.ref = {};
  view.model.name = 'feature';
  let creates = 0,
    choices = 0,
    saves = 0;
  view.model.submit = async () => {
    creates++;
  };
  view.task = (_cx, work) => work();
  view.rows = () => [{ key: 'codex', label: 'Codex' }];
  view.choose = () => {
    choices++;
  };
  view.saveRoot = () => {
    saves++;
  };
  view.openField = 'launch';
  view.index = 0;
  view.inputs.launch.handlers.submit({ secondary: false }, cx);
  assert.equal(choices, 1);
  assert.equal(creates, 0);
  view.openField = null;
  view.inputs.root.handlers.submit({ secondary: false }, cx);
  assert.equal(saves, 1);
  assert.equal(creates, 0);
  view.inputs.name.handlers.submit({ secondary: true }, cx);
  assert.equal(creates, 1);
});

test('existing checked-out branches can be selected and opened with Enter', async () => {
  const { view, cx } = keyboardView();
  view.buttons.create.focus = () => {};
  view.model.project = {};
  view.model.action = 'existing';
  const ref = {
    ref: 'refs/heads/feature',
    name: 'feature',
    label: 'feature · local',
    reason: '',
    checkout: '/custom/feature',
  };
  view.choose(ref, cx, 'ref');
  assert.equal(view.model.ref, ref);
  assert.equal(view.model.path, '/custom/feature');
  assert.equal(view.model.canCreate, true);
  let opens = 0;
  view.model.submit = async () => {
    opens++;
  };
  view.task = (_cx, work) => work();
  view.inputs.ref.handlers.submit({ secondary: false }, cx);
  assert.equal(opens, 1);
});

function browseView(git) {
  const view = new Launcher(),
    pending = [];
  view.model = {
    machine: 'devbox',
    git,
    generation: 1,
    phase: 'editing',
    editable: true,
    root: '/saved',
    rootReady: true,
    remotes: [],
    remote: null,
    launch: { key: 'shell', label: 'Shell' },
  };
  view.syncedMachine = 'devbox';
  view.syncedRoot = '/saved';
  view.rootRevision = 0;
  view.rootDraft = false;
  view.filters = {};
  view.directoryGeneration = 0;
  view.scroll = { scroll_to_item() {} };
  view.inputs = Object.fromEntries(
    ['root', 'project', 'machine', 'launch', 'remote', 'prompt'].map((field) => [
      field,
      {
        text: field === 'root' ? '/saved' : '',
        value() {
          return this.text;
        },
        set_value(value) {
          this.text = value;
        },
        focus() {},
      },
    ]),
  );
  view.task = (_cx, work) => {
    pending.push(work());
  };
  return { view, pending };
}

test('saving keeps the canonical root visible even when it matches the last synchronized value', async () => {
  const { view, pending } = browseView({});
  view.model.configureRoot = async (root) => {
    assert.equal(root, '/saved');
    // A refresh or input reset must not leave a successfully saved field blank.
    view.inputs.root.set_value('');
    return true;
  };
  view.saveRoot({});
  await pending[0];
  assert.equal(view.inputs.root.value(), '/saved');
});

test('slow root saves preserve a newer draft and cannot steal focus after switching away and back', async () => {
  for (const change of ['draft', 'machines']) {
    let stored = '/saved',
      calls = 0,
      release;
    const slow = new Promise((resolve) => {
      release = resolve;
    });
    const model = new WorktreeModel({
      machine: 'devbox',
      config: async () => ({ project_root: stored }),
      saveRoot: async (_machine, root) => {
        stored = root;
      },
      journal: { load: async () => null },
      connect: async (machine) => ({
        machine,
        validateRoot: async ({ project_root }) => project_root,
        discover: async () => (++calls === 2 ? slow : []),
      }),
    });
    await model.refresh();
    const { view } = browseView(model.git);
    view.model = model;
    const focus = ['name'];
    view.inputs.project.focus = () => focus.push('project');
    const pending = view.configureRoot('/new');
    await new Promise((resolve) => setImmediate(resolve));
    if (change === 'draft') {
      view.inputs.root.set_value('/newer-draft');
      view.rootDraft = true;
      view.rootRevision++;
    } else {
      await model.selectMachine('other');
      view.syncContext();
      await model.selectMachine('devbox');
      view.syncContext();
    }
    release([]);
    await pending;
    view.syncContext();
    assert.equal(view.inputs.root.value(), change === 'draft' ? '/newer-draft' : '/new');
    assert.deepEqual(focus, ['name']);
  }
});

test('switching to a remote machine shows its saved root before slow project discovery completes', async () => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const model = new WorktreeModel({
    config: async (machine) => ({ project_root: machine ? '/remote/projects' : '/local/projects' }),
    journal: { load: async () => null },
    connect: async (machine) => ({ machine, discover: async () => (machine ? slow : []) }),
  });
  await model.refresh();
  const { view, pending } = browseView(model.git);
  view.model = model;
  view.syncedMachine = null;
  view.syncedRoot = model.root;
  view.inputs.root.set_value(model.root);
  for (const field of ['name', 'ref']) view.inputs[field] = { set_value() {} };
  view.task = (_cx, work) => {
    pending.push(work(null, () => view.syncContext()));
  };
  view.choose({ name: 'devbox', label: 'devbox' }, {}, 'machine');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(model.phase, 'loading');
  assert.equal(view.inputs.root.value(), '/remote/projects');
  release([]);
  await pending[0];
});

test('remote saves stay busy through discovery and reload the saved machine-specific root', async () => {
  let text = JSON.stringify({ project_root: '/local/projects', remote_project_roots: { devbox: '/saved' } });
  const config = createConfigStore(
    async () => text,
    async (_path, next, expected) => {
      assert.equal(text, expected);
      text = next;
    },
    '/config.json',
  );
  let slow = false,
    release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const options = {
    machine: 'devbox',
    config: (machine) => config.get(machine),
    saveRoot: (machine, root) => config.set(machine, root),
    journal: { load: async () => null },
    connect: async (machine) => ({
      machine,
      validateRoot: async ({ project_root }) => project_root,
      discover: async () => (slow ? wait : []),
    }),
  };
  const model = new WorktreeModel(options);
  await model.refresh();
  const { view } = browseView(model.git);
  view.model = model;
  view.inputs.root.set_value('/remote/new');
  view.rootDraft = true;
  slow = true;
  const pending = view.configureRoot('/remote/new', () => view.syncContext());
  assert.equal(view.savingRoot, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(model.phase, 'loading');
  assert.equal(view.savingRoot, true);
  view.choose({ name: 'other', label: 'other' }, {}, 'machine');
  assert.equal(model.machine, 'devbox');
  release([]);
  await pending;
  assert.equal(view.savingRoot, false);
  assert.equal(view.inputs.root.value(), '/remote/new');
  slow = false;
  const reopened = new WorktreeModel(options);
  await reopened.refresh();
  assert.equal(reopened.root, '/remote/new');
  await reopened.selectMachine(null);
  assert.equal(reopened.root, '/local/projects');
  await reopened.selectMachine('devbox');
  assert.equal(reopened.root, '/remote/new');
});

test('remote Browse starts at the remote home when unset, then navigates children and parent', async () => {
  const calls = [];
  const { view, pending } = browseView({
    userHome: '/remote-home/fixture',
    directories: async (path) => {
      calls.push(path);
      return { path, entries: [{ path: `${path}/child`, label: 'child' }] };
    },
  });
  view.inputs.root.set_value('');
  view.browseRoot({});
  await pending[0];
  assert.equal(view.inputs.root.value(), '/remote-home/fixture');
  assert.equal(view.directoryLoading, false);
  view.choose(view.directoryEntries[0], {}, 'directory');
  await pending[1];
  assert.deepEqual(calls, ['/remote-home/fixture', '/remote-home/fixture/child']);
  assert.equal(view.inputs.root.value(), '/remote-home/fixture/child');
});

test('late directory results cannot replace a newer navigation or edited root, or cross machines', async () => {
  for (const change of ['navigate', 'edit', 'machine', 'close']) {
    const releases = [];
    const { view, pending } = browseView({
      directories: (path) =>
        new Promise((resolve) => releases.push(() => resolve({ path, entries: [{ label: path, path }] }))),
    });
    view.browseRoot({}, '/slow');
    if (change === 'navigate') {
      view.browseRoot({}, '/new');
      releases[1]();
      await pending[1];
    } else if (change === 'edit') {
      view.inputs.root.set_value('/typed');
      view.openField = null;
    } else if (change === 'machine') {
      view.model.machine = 'other';
      view.model.generation++;
    } else view.model.closed = true;
    releases[0]();
    await pending[0];
    assert.equal(view.inputs.root.value(), change === 'navigate' ? '/new' : change === 'edit' ? '/typed' : '/saved');
    assert.deepEqual(
      view.directoryEntries.map((row) => row.path),
      change === 'navigate' ? ['/new'] : [],
    );
  }
});

test('a slow machine selection cannot steal focus after the user switches machines and continues typing', async () => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const git = (machine) => ({ machine, discover: async () => [] });
  const model = new WorktreeModel({
    connect: (machine) => (machine === 'slow' ? slow : Promise.resolve(git(machine))),
    config: async () => ({ project_root: '/projects' }),
    journal: { load: async () => null },
  });
  const view = new Launcher(),
    focus = [],
    pending = [];
  view.model = model;
  view.filters = { machine: '', project: '', ref: '' };
  view.inputs = Object.fromEntries(
    ['machine', 'root', 'project', 'remote', 'ref', 'name', 'launch', 'prompt'].map((field) => [
      field,
      {
        set_value() {},
        focus() {
          focus.push(field);
        },
      },
    ]),
  );
  view.task = (_cx, work) => {
    pending.push(work());
  };
  view.choose({ id: 'slow', name: 'slow', label: 'slow' }, {}, 'machine');
  await new Promise((resolve) => setImmediate(resolve));
  view.choose({ id: 'fast', name: 'fast', label: 'fast' }, {}, 'machine');
  await pending[1];
  view.inputs.name.focus();
  release(git('slow'));
  await pending[0];
  assert.equal(model.machine, 'fast');
  assert.deepEqual(focus, ['project', 'name']);
});

test('late branch choices cannot steal focus from a same-path project on another machine', async () => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const project = (machine) => ({
    id: '/projects/app/.git',
    machine,
    path: '/projects/app',
    root: '/projects',
    label: 'app',
  });
  const model = new WorktreeModel({
    machine: 'slow',
    config: async () => ({ project_root: '/projects' }),
    journal: { load: async () => null },
    connect: async (machine) => ({
      machine,
      discover: async () => [project(machine)],
      choices: () => (machine === 'slow' ? slow : Promise.resolve([])),
      remotes: async () => [],
    }),
  });
  await model.refresh();
  const view = new Launcher(),
    focus = [],
    pending = [];
  view.model = model;
  view.filters = { machine: '', project: '', ref: '' };
  view.inputs = Object.fromEntries(
    ['machine', 'root', 'project', 'remote', 'ref', 'name', 'launch', 'prompt'].map((field) => [
      field,
      {
        set_value() {},
        focus() {
          focus.push(field);
        },
      },
    ]),
  );
  view.buttons = {
    new: {
      focus() {
        focus.push('new');
      },
    },
  };
  view.task = (_cx, work) => {
    pending.push(work());
  };
  view.choose(project('slow'), {}, 'project');
  await model.selectMachine('fast');
  view.choose(project('fast'), {}, 'project');
  await pending[1];
  view.inputs.name.focus();
  release([]);
  await pending[0];
  assert.equal(model.machine, 'fast');
  assert.equal(model.project.machine, 'fast');
  assert.deepEqual(focus, ['new', 'name']);
});
