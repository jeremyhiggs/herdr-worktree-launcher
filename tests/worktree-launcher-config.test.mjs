import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfigStore } from '../mods/worktree-launcher/config.js';

test('missing configuration supports setup and stores independent local and remote roots', async () => {
  let text = null;
  const store = createConfigStore(async () => text, async (_path, next, expected) => {
    assert.equal(expected, text); text = next;
  }, '/config.json');
  assert.deepEqual(await store.get(null), { project_root: '' });
  assert.deepEqual(await store.get('devbox'), { project_root: '' });
  await store.set(null, '/local/projects');
  await store.set('devbox', '/remote-home/fixture/projects');
  await store.set('other', '/srv/projects');
  await store.set('devbox', '/remote-home/fixture/new-projects');
  assert.equal((await store.get(null)).project_root, '/local/projects');
  assert.equal((await store.get('devbox')).project_root, '/remote-home/fixture/new-projects');
  assert.equal((await store.get('other')).project_root, '/srv/projects');
});

test('legacy local config and unrelated settings survive remote setup; malformed JSON is not overwritten', async () => {
  let text = JSON.stringify({ project_root: '/legacy/projects', personal: true });
  const store = createConfigStore(async () => text, async (_path, next) => { text = next; }, '/config.json');
  await store.set('devbox', '/remote/projects');
  assert.equal(JSON.parse(text).personal, true);
  assert.equal((await store.get(null)).project_root, '/legacy/projects');
  assert.equal((await store.get('toString')).project_root, '');
  for (const malformed of ['{broken', '[]', '{"remote_project_roots":[]}']) {
    text = malformed;
    await assert.rejects(store.get(null), /Malformed/);
    await assert.rejects(store.set(null, '/replacement'), /Malformed/);
    assert.equal(text, malformed);
  }
});

test('configuration saves use the native stale-write guard', async () => {
  const original = '{}'; let text = original;
  const store = createConfigStore(async () => text, async (_path, _next, expected) => {
    text = '{"personal":"concurrent edit"}';
    if (text !== expected) throw new Error('stale snapshot');
  }, '/config.json');
  await assert.rejects(store.set('devbox', '/remote/projects'), /stale/);
  assert.equal(text, '{"personal":"concurrent edit"}');
});
