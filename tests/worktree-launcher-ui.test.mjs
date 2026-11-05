import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { WorktreeModel } from '../mods/worktree-launcher/model.js';

// Load the real view methods without a native window; controls below record focus.
const modules = {
  'gpui-kit': 'export class View {} export const div = null;',
  'gpui-base': 'export const v_flex=null,h_flex=null,InputState=null,Input=null,Button=null,Popup=null,v_virtual_list=null,VirtualListScrollHandle=null,Scrollbar=null,TextView=null;',
  herdr: 'export const exec=null,home=null,appHome=null,readTextFile=null,writeTextFile=null,spaces=null,panes=null,machines=null,pickFolder=null,shared=null,setShared=null,run=null,theme=null,props=null,closeOverlay=null;',
};
registerHooks({
  resolve(specifier, context, next) { return Object.hasOwn(modules, specifier) ? { url: `native:${specifier}`, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url.startsWith('native:') ? { format: 'module', source: modules[url.slice(7)], shortCircuit: true } : next(url, context); },
});
const { default: Launcher } = await import('../mods/worktree-launcher/main.js');

function browseView(git) {
  const view = new Launcher(), pending = [];
  view.model = { machine: 'devbox', git, generation: 1, editable: true, root: '/saved', rootReady: true };
  view.syncedMachine = 'devbox'; view.syncedRoot = '/saved';
  view.rootRevision = 0; view.rootDraft = false;
  view.filters = {}; view.directoryGeneration = 0;
  view.scroll = { scroll_to_item() {} };
  view.inputs = Object.fromEntries(['root', 'project', 'machine'].map(field => [field, {
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
  view.inputs = Object.fromEntries(['machine', 'root', 'project', 'ref', 'name'].map(field => [field, { set_value() {}, focus() { focus.push(field); } }]));
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
  view.inputs = Object.fromEntries(['machine', 'root', 'project', 'ref', 'name'].map(field => [field, { set_value() {}, focus() { focus.push(field); } }]));
  view.buttons = { new: { focus() { focus.push('new'); } } };
  view.task = (_cx, work) => { pending.push(work()); };
  view.choose(project('slow'), {}, 'project');
  await model.selectMachine('fast');
  view.choose(project('fast'), {}, 'project'); await pending[1];
  view.inputs.name.focus(); release([]); await pending[0];
  assert.equal(model.machine, 'fast'); assert.equal(model.project.machine, 'fast');
  assert.deepEqual(focus, ['new', 'name']);
});
