import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { WorktreeModel } from '../mods/worktree-launcher/model.js';
import { createConfigStore } from '../mods/worktree-launcher/config.js';

// Load the real view methods without a native window; controls below record focus.
const modules = {
  'gpui-kit': 'export class View {} export const div = () => globalThis.launcherElement();',
  'gpui-base': 'const el=()=>globalThis.launcherElement(); export const v_flex=el,h_flex=el,v_virtual_list=el,Button={new:el},Input={new:el},Popup={new:el},Scrollbar={vertical:el},TextView={html:el},VirtualListScrollHandle={new:()=>({scroll_to_item(){}})},InputState={new:()=>({handlers:{},text:"",on(event,fn){this.handlers[event]=fn;},set_value(value){this.text=value;},value(){return this.text;},focus(){}})};',
  herdr: 'export const exec=null,home=()=>"/fixture-home",appHome=()=>"/fixture-app",readTextFile=null,writeTextFile=null,spaces=()=>[],panes=null,machines=null,knownAgents=async()=>[],pickFolder=null,shared=null,setShared=null,run=null,theme=()=>({}); export const props=()=>({overlay:"fixture-overlay"}),closeOverlay=id=>globalThis.launcherClosedOverlays.push(id);',
};
registerHooks({
  resolve(specifier, context, next) { return Object.hasOwn(modules, specifier) ? { url: `native:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith('native:') ? { format: 'module', source: modules[url.slice(7)], shortCircuit: true } : next(url, context); },
});
const { default: Launcher } = await import('../mods/worktree-launcher/main.js');

function keyboardView(phase = 'editing') {
  globalThis.launcherClosedOverlays = [];
  const handlers = new Map(), bindings = [];
  globalThis.launcherElement = () => {
    const element = new Proxy({}, { get: (_target, key) => (...args) => {
      if (key === 'on_key_down' || key === 'on_key_up') handlers.set(key, args[0]);
      return element;
    } });
    return element;
  };
  const view = new Launcher(); view.task = () => {};
  const cx = { focus_handle: () => ({}), bind_keys: rows => bindings.push(...rows), stop_propagation() {}, notify() {} };
  view.init({}, cx); view.model.phase = phase; view.render();
  assert(!bindings.some(row => row.keystroke === 'escape'), 'Do not override native Escape routing');
  assert(handlers.has('on_key_down')); assert(handlers.has('on_key_up'));
  return { view, cx, pressEscape: () => handlers.get('on_key_up')({ key: 'escape' }, cx) };
}

test('Escape release closes the launcher without installing a competing native binding', () => {
  for (const field of ['machine', 'root', 'project', 'ref', 'name', null]) {
    const { view, pressEscape } = keyboardView();
    view.activeInput = field; view.openField = field;
    pressEscape();
    assert.equal(view.model.closed, true);
    assert.deepEqual(globalThis.launcherClosedOverlays, ['fixture-overlay']);
  }
});

test('Escape release preserves active saves and worktree operations', () => {
  for (const phase of ['configuring', 'creating', 'opening', 'saving-root']) {
    const { view, pressEscape } = keyboardView(phase === 'saving-root' ? 'loading' : phase);
    view.savingRoot = phase === 'saving-root';
    pressEscape();
    assert.equal(view.model.closed, false);
    assert.deepEqual(globalThis.launcherClosedOverlays, []);
  }
});

test('Enter from a completed branch name or the form invokes Create only while enabled', async () => {
  const { view, cx } = keyboardView();
  let creates = 0;
  view.model.project = {}; view.model.ref = {}; view.model.name = 'feature';
  view.model.submit = async () => { creates++; };
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
  view.model.name = 'feature'; view.model.phase = 'creating';
  view.inputs.name.handlers.submit({ secondary: false }, cx);
  assert.equal(creates, 2);
});

test('Enter selects an open picker choice and root Enter still saves configuration', () => {
  const { view, cx } = keyboardView();
  view.model.project = {}; view.model.ref = {}; view.model.name = 'feature';
  let creates = 0, choices = 0, saves = 0;
  view.model.submit = async () => { creates++; }; view.task = (_cx, work) => work();
  view.rows = () => [{ key: 'codex', label: 'Codex' }]; view.choose = () => { choices++; };
  view.saveRoot = () => { saves++; };
  view.openField = 'launch'; view.index = 0;
  view.inputs.launch.handlers.submit({ secondary: false }, cx);
  assert.equal(choices, 1); assert.equal(creates, 0);
  view.openField = null;
  view.inputs.root.handlers.submit({ secondary: false }, cx);
  assert.equal(saves, 1); assert.equal(creates, 0);
  view.inputs.name.handlers.submit({ secondary: true }, cx);
  assert.equal(creates, 1);
});

test('existing checked-out branches can be selected and opened with Enter', async () => {
  const { view, cx } = keyboardView();
  view.buttons.create.focus = () => {};
  view.model.project = {}; view.model.action = 'existing';
  const ref = { ref: 'refs/heads/feature', name: 'feature', label: 'feature · local', reason: '', checkout: '/custom/feature' };
  view.choose(ref, cx, 'ref');
  assert.equal(view.model.ref, ref); assert.equal(view.model.path, '/custom/feature');
  assert.equal(view.model.canCreate, true);
  let opens = 0; view.model.submit = async () => { opens++; }; view.task = (_cx, work) => work();
  view.inputs.ref.handlers.submit({ secondary: false }, cx);
  assert.equal(opens, 1);
});

function browseView(git) {
  const view = new Launcher(), pending = [];
  view.model = { machine: 'devbox', git, generation: 1, phase: 'editing', editable: true, root: '/saved', rootReady: true, launch: { key: 'shell', label: 'Shell' } };
  view.syncedMachine = 'devbox'; view.syncedRoot = '/saved';
  view.rootRevision = 0; view.rootDraft = false;
  view.filters = {}; view.directoryGeneration = 0;
  view.scroll = { scroll_to_item() {} };
  view.inputs = Object.fromEntries(['root', 'project', 'machine', 'launch'].map(field => [field, {
    text: field === 'root' ? '/saved' : '', value() { return this.text; }, set_value(value) { this.text = value; }, focus() {},
  }]));
  view.task = (_cx, work) => { pending.push(work()); };
  return { view, pending };
}

test('saving keeps the canonical root visible even when it matches the last synchronized value', async () => {
  const { view, pending } = browseView({});
  view.model.configureRoot = async root => {
    assert.equal(root, '/saved');
    // A refresh or input reset must not leave a successfully saved field blank.
    view.inputs.root.set_value('');
    return true;
  };
  view.saveRoot({}); await pending[0];
  assert.equal(view.inputs.root.value(), '/saved');
});

test('slow root saves preserve a newer draft and cannot steal focus after switching away and back', async () => {
  for (const change of ['draft', 'machines']) {
    let stored = '/saved', calls = 0, release;
    const slow = new Promise(resolve => { release = resolve; });
    const model = new WorktreeModel({
      machine: 'devbox', config: async () => ({ project_root: stored }),
      saveRoot: async (_machine, root) => { stored = root; }, journal: { load: async () => null },
      connect: async machine => ({ machine, validateRoot: async ({ project_root }) => project_root, discover: async () => ++calls === 2 ? slow : [] }),
    });
    await model.refresh();
    const { view } = browseView(model.git); view.model = model;
    const focus = ['name']; view.inputs.project.focus = () => focus.push('project');
    const pending = view.configureRoot('/new'); await new Promise(resolve => setImmediate(resolve));
    if (change === 'draft') { view.inputs.root.set_value('/newer-draft'); view.rootDraft = true; view.rootRevision++; }
    else {
      await model.selectMachine('other'); view.syncContext();
      await model.selectMachine('devbox'); view.syncContext();
    }
    release([]); await pending; view.syncContext();
    assert.equal(view.inputs.root.value(), change === 'draft' ? '/newer-draft' : '/new');
    assert.deepEqual(focus, ['name']);
  }
});

test('switching to a remote machine shows its saved root before slow project discovery completes', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const model = new WorktreeModel({
    config: async machine => ({ project_root: machine ? '/remote/projects' : '/local/projects' }),
    journal: { load: async () => null },
    connect: async machine => ({ machine, discover: async () => machine ? slow : [] }),
  });
  await model.refresh();
  const { view, pending } = browseView(model.git); view.model = model;
  view.syncedMachine = null; view.syncedRoot = model.root; view.inputs.root.set_value(model.root);
  for (const field of ['name', 'ref']) view.inputs[field] = { set_value() {} };
  view.task = (_cx, work) => { pending.push(work(null, () => view.syncContext())); };
  view.choose({ name: 'devbox', label: 'devbox' }, {}, 'machine');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.phase, 'loading');
  assert.equal(view.inputs.root.value(), '/remote/projects');
  release([]); await pending[0];
});

test('remote saves stay busy through discovery and reload the saved machine-specific root', async () => {
  let text = JSON.stringify({ project_root: '/local/projects', remote_project_roots: { devbox: '/saved' } });
  const config = createConfigStore(async () => text, async (_path, next, expected) => { assert.equal(text, expected); text = next; }, '/config.json');
  let slow = false, release;
  const wait = new Promise(resolve => { release = resolve; });
  const options = {
    machine: 'devbox', config: machine => config.get(machine), saveRoot: (machine, root) => config.set(machine, root),
    journal: { load: async () => null },
    connect: async machine => ({ machine, validateRoot: async ({ project_root }) => project_root, discover: async () => slow ? wait : [] }),
  };
  const model = new WorktreeModel(options); await model.refresh();
  const { view } = browseView(model.git); view.model = model;
  view.inputs.root.set_value('/remote/new'); view.rootDraft = true;
  slow = true;
  const pending = view.configureRoot('/remote/new', () => view.syncContext());
  assert.equal(view.savingRoot, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.phase, 'loading'); assert.equal(view.savingRoot, true);
  view.choose({ name: 'other', label: 'other' }, {}, 'machine');
  assert.equal(model.machine, 'devbox');
  release([]); await pending;
  assert.equal(view.savingRoot, false);
  assert.equal(view.inputs.root.value(), '/remote/new');
  slow = false;
  const reopened = new WorktreeModel(options); await reopened.refresh();
  assert.equal(reopened.root, '/remote/new');
  await reopened.selectMachine(null); assert.equal(reopened.root, '/local/projects');
  await reopened.selectMachine('devbox'); assert.equal(reopened.root, '/remote/new');
});

test('remote Browse starts at the remote home when unset, then navigates children and parent', async () => {
  const calls = [];
  const { view, pending } = browseView({ userHome: '/remote-home/fixture', directories: async path => {
    calls.push(path); return { path, entries: [{ path: `${path}/child`, label: 'child' }] };
  } });
  view.inputs.root.set_value(''); view.browseRoot({}); await pending[0];
  assert.equal(view.inputs.root.value(), '/remote-home/fixture');
  assert.equal(view.directoryLoading, false);
  view.choose(view.directoryEntries[0], {}, 'directory'); await pending[1];
  assert.deepEqual(calls, ['/remote-home/fixture', '/remote-home/fixture/child']);
  assert.equal(view.inputs.root.value(), '/remote-home/fixture/child');
});

test('late directory results cannot replace a newer navigation or edited root, or cross machines', async () => {
  for (const change of ['navigate', 'edit', 'machine', 'close']) {
    const releases = [];
    const { view, pending } = browseView({ directories: path => new Promise(resolve => releases.push(() => resolve({ path, entries: [{ label: path, path }] }))) });
    view.browseRoot({}, '/slow');
    if (change === 'navigate') {
      view.browseRoot({}, '/new'); releases[1](); await pending[1];
    } else if (change === 'edit') { view.inputs.root.set_value('/typed'); view.openField = null; }
    else if (change === 'machine') { view.model.machine = 'other'; view.model.generation++; }
    else view.model.closed = true;
    releases[0](); await pending[0];
    assert.equal(view.inputs.root.value(), change === 'navigate' ? '/new' : change === 'edit' ? '/typed' : '/saved');
    assert.deepEqual(view.directoryEntries.map(row => row.path), change === 'navigate' ? ['/new'] : []);
  }
});

test('a slow machine selection cannot steal focus after the user switches machines and continues typing', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const git = machine => ({ machine, discover: async () => [] });
  const model = new WorktreeModel({
    connect: machine => machine === 'slow' ? slow : Promise.resolve(git(machine)),
    config: async () => ({ project_root: '/projects' }), journal: { load: async () => null },
  });
  const view = new Launcher(), focus = [], pending = [];
  view.model = model; view.filters = { machine: '', project: '', ref: '' };
  view.inputs = Object.fromEntries(['machine', 'root', 'project', 'ref', 'name', 'launch'].map(field => [field, { set_value() {}, focus() { focus.push(field); } }]));
  view.task = (_cx, work) => { pending.push(work()); };
  view.choose({ id: 'slow', name: 'slow', label: 'slow' }, {}, 'machine');
  await new Promise(resolve => setImmediate(resolve));
  view.choose({ id: 'fast', name: 'fast', label: 'fast' }, {}, 'machine');
  await pending[1];
  view.inputs.name.focus();
  release(git('slow')); await pending[0];
  assert.equal(model.machine, 'fast');
  assert.deepEqual(focus, ['project', 'name']);
});

test('late branch choices cannot steal focus from a same-path project on another machine', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const project = machine => ({ id: '/projects/app/.git', machine, path: '/projects/app', root: '/projects', label: 'app' });
  const model = new WorktreeModel({
    machine: 'slow', config: async () => ({ project_root: '/projects' }), journal: { load: async () => null },
    connect: async machine => ({ machine, discover: async () => [project(machine)], choices: () => machine === 'slow' ? slow : Promise.resolve([]) }),
  });
  await model.refresh();
  const view = new Launcher(), focus = [], pending = [];
  view.model = model; view.filters = { machine: '', project: '', ref: '' };
  view.inputs = Object.fromEntries(['machine', 'root', 'project', 'ref', 'name', 'launch'].map(field => [field, { set_value() {}, focus() { focus.push(field); } }]));
  view.buttons = { new: { focus() { focus.push('new'); } } };
  view.task = (_cx, work) => { pending.push(work()); };
  view.choose(project('slow'), {}, 'project');
  await model.selectMachine('fast');
  view.choose(project('fast'), {}, 'project'); await pending[1];
  view.inputs.name.focus(); release([]); await pending[0];
  assert.equal(model.machine, 'fast'); assert.equal(model.project.machine, 'fast');
  assert.deepEqual(focus, ['new', 'name']);
});
