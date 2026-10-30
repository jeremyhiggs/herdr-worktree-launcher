import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorktreeModel, openCheckout } from '../mods/personal-worktrees/model.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const a = { id: 'A', path: '/projects/A', label: 'A', basename: 'A' };
const b = { id: 'B', path: '/projects/B', label: 'B', basename: 'B' };
const ref = { ref: 'refs/heads/main', name: 'main', label: 'main · local', reason: '' };
function setup(overrides = {}) {
  let saved = null, mutations = 0, opens = 0;
  const request = { project: a, action: 'new', ref: ref.ref, name: 'feature', path: '/fixture/worktree', commit: 'abc', upstream: '' };
  const git = {
    discover: async () => [a, b], choices: async () => [ref], destination: () => request.path,
    prepare: async () => request, create: async () => { mutations++; return { kind: 'created', path: request.path, request }; },
    inspect: async r => ({ kind: 'created', path: r.path, request: r }), ...overrides.git,
  };
  const model = new WorktreeModel({ config: async () => ({}), journal: { load: async () => saved, save: async r => { saved = r; } }, open: async () => { opens++; }, ...overrides, git });
  return { model, request, get mutations() { return mutations; }, get opens() { return opens; }, get saved() { return saved; } };
}
async function fill(model) { await model.refresh(); await model.selectProject(a); model.setName('feature'); model.selectRef(ref); }

test('late choices and closed overlays cannot replace current form; selections reset', async () => {
  const late = deferred(); const f = setup({ git: { choices: p => p === a ? late.promise : Promise.resolve([ref]) } });
  await f.model.refresh(); const first = f.model.selectProject(a); await f.model.selectProject(b);
  f.model.setName('branch'); f.model.selectRef(ref); late.resolve([{ ...ref, name: 'wrong' }]); await first;
  assert.equal(f.model.project, b); assert.equal(f.model.refs[0].name, 'main');
  f.model.setAction('existing'); assert.equal(f.model.ref, null); assert.equal(f.model.name, '');
  const closed = deferred(); f.model.git.choices = () => closed.promise;
  const load = f.model.selectProject(a); assert.equal(f.model.close(), true); closed.resolve([ref]); await load;
  assert.equal(f.model.refs.length, 0);
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
    f.model.git.inspect = async r => ({ kind, path: r.path, request: r, error: kind === 'partial' ? 'branch already exists' : '' });
    f.model.git.create = async () => { mutation++; };
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
  const request = { path: '/worktree', project: { id: 'A' } };
  const calls = [];
  const state = {
    spaces: [{ id: 'nested', machine: null, tabs: [{ id: 'nested-tab' }] }, { id: 'remote', machine: 'remote', tabs: [{ id: 'remote-tab' }] }, { id: 'correct', machine: null, tabs: [{ id: 'correct-tab' }] }],
    panes: [{ pane: 'n', tab: 'nested-tab', cwd: '/worktree/nested', terminal: 'tn', program: { shell: true } }, { pane: 'r', tab: 'remote-tab', cwd: '/worktree', terminal: 'tr', program: { shell: true } }, { pane: 'c', tab: 'correct-tab', cwd: '/worktree/subdir', terminal: 'tc', program: { shell: true }, focused: false }],
  };
  const git = { identity: async p => ({ top: p.includes('nested') ? '/worktree/nested' : '/worktree', id: p.includes('nested') ? 'B' : 'A' }) };
  await openCheckout(request, git, { snapshot: () => state, pause: async () => {}, now: () => 0, run: (name, args) => {
    calls.push([name, args]);
    if (name === 'space.select') state.spaces.find(s => s.id === args.id).active = true;
    if (name === 'pane.focus') state.panes.find(p => p.pane === args.pane).focused = true;
  } });
  assert(!calls.some(([n]) => n === 'space.new')); assert(calls.some(([n, a]) => n === 'space.select' && a.id === 'correct'));
});

test('space creation is unnamed, starts a shell, and requires observed cwd and focus', async () => {
  let time = 0; const calls = [];
  await assert.rejects(openCheckout({ path: '/worktree', project: { id: 'A' } }, { identity: async () => ({ id: 'A', top: '/worktree' }) }, {
    snapshot: () => ({ spaces: [], panes: [] }), run: (...args) => calls.push(args), now: () => time, pause: async () => { time += 1000; },
  }), /unconfirmed/i);
  assert.deepEqual(calls, [['space.new', { folder: '/worktree' }]]);
});
