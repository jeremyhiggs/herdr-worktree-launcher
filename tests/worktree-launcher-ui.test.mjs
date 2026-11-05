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
