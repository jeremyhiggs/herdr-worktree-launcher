import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installer = resolve('scripts/install-mod.mjs');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'worktree-launcher-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'app home'), projects = join(root, "projects ; 'literal'"), bin = join(root, 'bin');
  await Promise.all([app, projects, bin].map(path => mkdir(path)));
  await writeFile(join(bin, 'herdr-app'), `#!/usr/bin/env node
const { appendFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.WL_EVENTS, JSON.stringify(args) + '\\n');
if (args[0] === 'check') {
  if (!existsSync(join(args[1], 'main.js')) || !existsSync(join(args[1], 'config.json'))) process.exit(2);
  if (process.env.WL_FAIL_CHECK) { console.error('injected native failure'); process.exit(1); }
}
`, { mode: 0o755 });
  const env = { ...process.env, HOME: join(root, 'home'), HERDR_APP_HOME: app, PATH: `${bin}:${process.env.PATH}`, WL_EVENTS: join(root, 'events') };
  const run = (args = [], extra = {}) => execute(process.execPath, [installer, ...args], { cwd: root, env: { ...env, ...extra }, timeout: 10000 });
  return { root, app, projects, env, run, target: join(app, 'mods/worktree-launcher'), keys: join(app, 'keys.json') };
}

test('install copies a standalone mod, merges and backs up keys, and checks without app/core commands', async t => {
  const f = await fixture(t);
  const original = '{"global":{"cmd-k":"app.palette"},"terminal":{"alt-x":"custom"}}\n';
  await writeFile(f.keys, original);
  await mkdir(join(f.app, 'data'));
  const recovery = join(f.app, 'data/worktree-launcher-operation.json');
  await writeFile(recovery, 'preserve recovery');
  await f.run(['--project-root', f.projects]);
  assert.equal(JSON.parse(await readFile(join(f.target, 'config.json'))).project_root, f.projects);
  assert.deepEqual(JSON.parse(await readFile(f.keys)), { global: { 'cmd-k': 'app.palette', 'cmd-shift-g': 'mod.open:worktree-launcher' }, terminal: { 'alt-x': 'custom' } });
  const backup = (await readdir(f.app)).find(name => name.endsWith('.bak'));
  assert.equal(await readFile(join(f.app, backup), 'utf8'), original);
  assert.equal(await readFile(recovery, 'utf8'), 'preserve recovery');
  assert.deepEqual((await readFile(f.env.WL_EVENTS, 'utf8')).trim().split('\n').map(JSON.parse), [['--version'], ['check', f.target]]);
  assert.deepEqual((await readdir(f.target)).sort(), ['README.md', 'config.example.json', 'config.json', 'git.js', 'keys.json', 'main.js', 'mod.json', 'model.js'].sort());
});

test('update is explicit, preserves config and keys byte-for-byte, and can change only the requested root', async t => {
  const f = await fixture(t); await f.run(['--project-root', f.projects]);
  const configPath = join(f.target, 'config.json');
  const config = JSON.stringify({ project_root: f.projects, personal: 'keep' });
  await writeFile(configPath, config);
  const keys = await readFile(f.keys, 'utf8');
  await writeFile(join(f.target, 'main.js'), 'old code');
  await assert.rejects(f.run(['--project-root', f.projects]), /already exists/);
  assert.equal(await readFile(join(f.target, 'main.js'), 'utf8'), 'old code');
  await f.run(['--update']);
  assert.notEqual(await readFile(join(f.target, 'main.js'), 'utf8'), 'old code');
  assert.equal(await readFile(configPath, 'utf8'), config);
  assert.equal(await readFile(f.keys, 'utf8'), keys);
  const next = join(f.root, 'next'); await mkdir(next);
  await f.run(['--update', '--project-root', next]);
  assert.deepEqual(JSON.parse(await readFile(configPath)), { project_root: next, personal: 'keep' });
});

test('invalid roots, keybinding conflicts, and malformed keys fail before mod files are copied', async t => {
  for (const scenario of ['missing root', 'relative root', 'conflicting key', 'malformed keys']) {
    const f = await fixture(t);
    const keys = scenario === 'malformed keys' ? '{invalid' : JSON.stringify({ global: { 'cmd-shift-g': 'app.palette' } });
    await writeFile(f.keys, keys);
    const args = scenario === 'missing root' ? [] : ['--project-root', scenario === 'relative root' ? '.' : f.projects];
    await assert.rejects(f.run(args), /project-root|already assigned|Invalid JSON/);
    await assert.rejects(readdir(f.target), { code: 'ENOENT' });
    assert.equal(await readFile(f.keys, 'utf8'), keys);
  }
});

test('no-shortcut preserves an existing binding and native check failures do not alter keys', async t => {
  const f = await fixture(t);
  const original = '{"global":{"cmd-shift-g":"app.palette"}}';
  await writeFile(f.keys, original);
  await f.run(['--project-root', f.projects, '--no-shortcut']);
  assert.equal(await readFile(f.keys, 'utf8'), original);
  await writeFile(f.keys, '{}');
  await assert.rejects(f.run(['--update'], { WL_FAIL_CHECK: '1' }), /Native check failed.*[\s\S]*shortcut was not changed.*[\s\S]*injected native failure/);
  assert.equal(await readFile(f.keys, 'utf8'), '{}');
});

test('default installation home follows HOME, and symlinked destinations are refused', async t => {
  const f = await fixture(t);
  const env = { ...f.env }; delete env.HERDR_APP_HOME;
  await execute(process.execPath, [installer, '--project-root', f.projects], { env, timeout: 10000 });
  assert.equal(JSON.parse(await readFile(join(env.HOME, '.config/herdr-app/mods/worktree-launcher/config.json'))).project_root, f.projects);
  await mkdir(join(f.app, 'mods'));
  await symlink(join(env.HOME, '.config/herdr-app/mods/worktree-launcher'), f.target);
  await assert.rejects(f.run(['--update', '--project-root', f.projects]), /Refusing to replace/);
});
