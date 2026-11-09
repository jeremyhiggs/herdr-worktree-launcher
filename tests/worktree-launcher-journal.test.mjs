import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournalStore } from '../mods/worktree-launcher/journal.js';

const request = (machine, name = 'feature') => ({ machine, project: { id: '/projects/repo/.git', root: '/projects' }, name, path: `/worktrees/${name}`, attempt: `${machine}-${name}-attempt` });
function setup(initial = null) {
  let text = initial;
  const read = async () => text;
  const write = async (_path, next, expected) => {
    if (text !== expected) throw new Error('stale snapshot');
    text = next;
  };
  return { store: () => createJournalStore(read, write, '/operation.json'), get text() { return text; } };
}

test('legacy recovery migrates without losing independent worktrees on the same machine', async () => {
  const remote = request('devbox'); delete remote.attempt;
  const f = setup(JSON.stringify(remote)), store = f.store();
  assert.deepEqual(await store.load(null), []);
  assert.equal(f.text, JSON.stringify(remote), 'Reading must preserve the legacy record');
  const local = request(null), unrelated = request('devbox', 'other');
  await store.save(local); await store.save(unrelated);
  assert.deepEqual(await store.load('devbox'), [remote, unrelated]);
  await store.clear(remote);
  assert.deepEqual(await store.load('devbox'), [unrelated]);
  assert.deepEqual(await store.load(null), [local]);
  await store.clear(local);
  assert.deepEqual(await store.load(null), []);
  assert.deepEqual(await store.load('devbox'), [unrelated]);
});

test('an older launcher cannot clear a replacement, but can save unrelated work without losing it', async () => {
  const f = setup(), older = f.store(), newer = f.store();
  const original = request(null);
  await older.save(original);
  const [stale] = await older.load(null);
  await newer.clear(original);
  const replacement = { ...original, attempt: 'newer' };
  await newer.save(replacement);
  await assert.rejects(older.clear(stale), /changed/);
  const unrelated = request(null, 'other');
  await older.save(unrelated);
  assert.deepEqual(await newer.load(null), [replacement, unrelated]);
  await assert.rejects(older.save({ ...replacement, path: '/another/path' }), /conflicting/);
  await assert.rejects(older.save({ ...request(null, 'third'), project: { id: '/different/repo/.git' }, path: replacement.path }), /conflicting/);
});

test('native stale-write protection preserves records added during a journal write', async () => {
  const original = request(null), newer = request(null, 'other');
  let text = JSON.stringify({ version: 2, operations: [original] });
  const store = createJournalStore(async () => text, async (_path, _next, expected) => {
    text = JSON.stringify({ version: 2, operations: [original, newer] });
    if (text !== expected) throw new Error('stale snapshot');
  }, '/operation.json');
  await assert.rejects(store.clear(original), /stale snapshot/);
  assert.deepEqual(await store.load(null), [original, newer]);
});

test('malformed recovery is refused without replacing records', async () => {
  for (const text of ['{broken', '[]', '{"version":2,"operations":{}}', '{"version":2,"operations":[null]}']) {
    const f = setup(text);
    await assert.rejects(f.store().load(null), /unreadable/);
    await assert.rejects(f.store().save(request(null)), /unreadable/);
    assert.equal(f.text, text);
  }
});
