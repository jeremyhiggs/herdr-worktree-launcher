import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournalStore } from '../mods/worktree-launcher/journal.js';

const request = machine => ({ machine, project: { root: '/projects' }, path: '/worktree', attempt: `${machine}-attempt` });
function setup(initial = null) {
  let text = initial;
  const read = async () => text;
  const write = async (_path, next, expected) => {
    if (text !== expected) throw new Error('stale snapshot');
    text = next;
  };
  return { store: () => createJournalStore(read, write, '/operation.json'), get text() { return text; } };
}

test('legacy recovery migrates on save and local and remote operations clear independently', async () => {
  const remote = request('devbox'); delete remote.attempt;
  const f = setup(JSON.stringify(remote)), store = f.store();
  assert.equal(await store.load(null), null);
  assert.equal(f.text, JSON.stringify(remote), 'Reading must preserve the legacy record');
  const local = request(null);
  await store.save(local, null);
  assert.deepEqual(await store.load('devbox'), remote);
  await store.save(null, 'devbox');
  assert.deepEqual(await store.load(null), local);
  await store.save(null, null);
  assert.equal(await store.load('devbox'), null);
  assert.equal(await store.load(null), null);
});

test('an older launcher cannot overwrite or clear a newer recovery record', async () => {
  const f = setup(), older = f.store(), newer = f.store();
  await older.load(null); await newer.load(null);
  const local = request(null);
  await newer.save(local, null);
  await assert.rejects(older.save(null, null), /stale snapshot/);
  await assert.rejects(older.save(request('devbox'), 'devbox'), /stale snapshot/);
  assert.deepEqual(await newer.load(null), local);
  await older.load('devbox');
  await older.save(request('devbox'), 'devbox');
  assert.deepEqual(await newer.load(null), local);
});

test('malformed recovery and cross-machine writes are refused without replacing records', async () => {
  for (const text of ['{broken', '[]', '{"version":2,"operations":{}}', JSON.stringify({ version: 2, operations: [request(null), request(null)] })]) {
    const f = setup(text);
    await assert.rejects(f.store().load(null), /unreadable/);
    assert.equal(f.text, text);
  }
  const f = setup(), store = f.store();
  await store.load(null);
  await assert.rejects(store.save(request('devbox'), null), /another machine/);
  assert.equal(f.text, null);
});
