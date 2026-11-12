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
  const app = join(root, 'app home'),
    projects = join(root, "projects ; 'literal'"),
    bin = join(root, 'bin');
  await Promise.all([app, projects, bin].map((path) => mkdir(path)));
  await writeFile(
    join(bin, 'herdr-app'),
    `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.WL_EVENTS, JSON.stringify(args) + '\\n');
if (args[0] === '--version' && process.env.WL_CONFIG_DURING_VERSION) {
  mkdirSync(join(process.env.HERDR_APP_HOME, 'data'), { recursive: true });
  writeFileSync(join(process.env.HERDR_APP_HOME, 'data/worktree-launcher-config.json'), process.env.WL_CONFIG_DURING_VERSION);
}
if (args[0] === 'check') {
  if (!existsSync(join(args[1], 'main.js')) || !existsSync(join(process.env.HERDR_APP_HOME || join(process.env.HOME, '.config/herdr-app'), 'data/worktree-launcher-config.json'))) process.exit(2);
  if (process.env.WL_FAIL_CHECK) { console.error('injected native failure'); process.exit(1); }
}
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    HOME: join(root, 'home'),
    HERDR_APP_HOME: app,
    PATH: `${bin}:${process.env.PATH}`,
    WL_EVENTS: join(root, 'events'),
  };
  const run = (args = [], extra = {}) =>
    execute(process.execPath, [installer, ...args], { cwd: root, env: { ...env, ...extra }, timeout: 10000 });
  return { root, app, projects, env, run, target: join(app, 'mods/worktree-launcher'), keys: join(app, 'keys.json') };
}

test('install copies a standalone mod, merges and backs up keys, and checks without app/core commands', async (t) => {
  const f = await fixture(t);
  const original = '{"global":{"cmd-k":"app.palette"},"terminal":{"alt-x":"custom"}}\n';
  await writeFile(f.keys, original);
  await mkdir(join(f.app, 'data'));
  const recovery = join(f.app, 'data/worktree-launcher-operation.json');
  await writeFile(recovery, 'preserve recovery');
  await f.run(['--project-root', f.projects]);
  assert.equal(JSON.parse(await readFile(join(f.app, 'data/worktree-launcher-config.json'))).project_root, f.projects);
  assert.deepEqual(JSON.parse(await readFile(f.keys)), {
    global: { 'cmd-k': 'app.palette', 'cmd-shift-g': 'mod.open:worktree-launcher' },
    terminal: { 'alt-x': 'custom' },
  });
  const backup = (await readdir(f.app)).find((name) => name.endsWith('.bak'));
  assert.equal(await readFile(join(f.app, backup), 'utf8'), original);
  assert.equal(await readFile(recovery, 'utf8'), 'preserve recovery');
  assert.deepEqual((await readFile(f.env.WL_EVENTS, 'utf8')).trim().split('\n').map(JSON.parse), [
    ['--version'],
    ['check', f.target],
  ]);
  assert.deepEqual(
    (await readdir(f.target)).sort(),
    [
      'README.md',
      'config.example.json',
      'config.js',
      'cli.js',
      'journal.js',
      'keys.json',
      'main.js',
      'mod.json',
      'model.js',
    ].sort(),
  );
});

test('repeated installation updates code, preserves config and keys byte-for-byte, and can change only the requested root', async (t) => {
  const f = await fixture(t);
  await f.run(['--project-root', f.projects]);
  const configPath = join(f.app, 'data/worktree-launcher-config.json');
  const config = JSON.stringify({ project_root: f.projects, personal: 'keep' });
  await writeFile(configPath, config);
  const keys = await readFile(f.keys, 'utf8');
  await writeFile(join(f.target, 'main.js'), 'old code');
  await f.run();
  assert.notEqual(await readFile(join(f.target, 'main.js'), 'utf8'), 'old code');
  assert.equal(await readFile(configPath, 'utf8'), config);
  assert.equal(await readFile(f.keys, 'utf8'), keys);
  const next = join(f.root, 'next');
  await mkdir(next);
  await f.run(['--project-root', next]);
  assert.deepEqual(JSON.parse(await readFile(configPath)), { project_root: next, personal: 'keep' });
});

test('invalid roots, keybinding conflicts, and malformed keys fail before mod files are copied', async (t) => {
  for (const scenario of ['relative root', 'conflicting key', 'malformed keys']) {
    const f = await fixture(t);
    const keys =
      scenario === 'malformed keys' ? '{invalid' : JSON.stringify({ global: { 'cmd-shift-g': 'app.palette' } });
    await writeFile(f.keys, keys);
    const args = ['--project-root', scenario === 'relative root' ? '.' : f.projects];
    await assert.rejects(f.run(args), /project-root|already assigned|Invalid JSON/);
    await assert.rejects(readdir(f.target), { code: 'ENOENT' });
    assert.equal(await readFile(f.keys, 'utf8'), keys);
  }
});

test('ordinary installation preserves an unrelated occupied mod directory', async (t) => {
  for (const manifest of [null, '{"title":"Another mod"}']) {
    const f = await fixture(t);
    await mkdir(f.target, { recursive: true });
    await writeFile(join(f.target, 'main.js'), 'unrelated code');
    if (manifest !== null) await writeFile(join(f.target, 'mod.json'), manifest);
    await assert.rejects(f.run(), /not an installed Worktree Launcher/);
    assert.equal(await readFile(join(f.target, 'main.js'), 'utf8'), 'unrelated code');
    assert.deepEqual((await readdir(f.target)).sort(), manifest === null ? ['main.js'] : ['main.js', 'mod.json']);
    await assert.rejects(readFile(f.keys), { code: 'ENOENT' });
  }
});

test('updates reject internal symlinks and directories before overwriting any bundled file', async (t) => {
  for (const kind of ['symlink', 'directory']) {
    const f = await fixture(t);
    await f.run();
    const configPath = join(f.app, 'data/worktree-launcher-config.json');
    const config = await readFile(configPath, 'utf8');
    const keys = await readFile(f.keys, 'utf8');
    const destination = join(f.target, 'model.js');
    const external = join(f.root, 'external.js');
    await writeFile(join(f.target, 'main.js'), 'preserve existing code');
    await rm(destination);
    await writeFile(external, 'preserve external file');
    if (kind === 'symlink') await symlink(external, destination);
    else await mkdir(destination);
    await assert.rejects(f.run(), /expected a regular file/);
    assert.equal(await readFile(join(f.target, 'main.js'), 'utf8'), 'preserve existing code');
    assert.equal(await readFile(external, 'utf8'), 'preserve external file');
    assert.equal(await readFile(configPath, 'utf8'), config);
    assert.equal(await readFile(f.keys, 'utf8'), keys);
  }
});

test('installation without a project root supports UI setup, and update preserves remote-only configuration', async (t) => {
  const f = await fixture(t);
  await f.run();
  const configPath = join(f.app, 'data/worktree-launcher-config.json');
  assert.deepEqual(JSON.parse(await readFile(configPath)), {});
  const config = JSON.stringify({ remote_project_roots: { devbox: '/remote/projects' } });
  await writeFile(configPath, config);
  await f.run();
  assert.equal(await readFile(configPath, 'utf8'), config);
});

test('no-shortcut preserves an existing binding and native check failures do not alter keys', async (t) => {
  const f = await fixture(t);
  const original = '{"global":{"cmd-shift-g":"app.palette"}}';
  await writeFile(f.keys, original);
  await f.run(['--project-root', f.projects, '--no-shortcut']);
  assert.equal(await readFile(f.keys, 'utf8'), original);
  await writeFile(f.keys, '{}');
  await assert.rejects(
    f.run([], { WL_FAIL_CHECK: '1' }),
    /Native check failed.*[\s\S]*shortcut was not changed.*[\s\S]*injected native failure/,
  );
  assert.equal(await readFile(f.keys, 'utf8'), '{}');
});

test('default installation home follows HOME, and symlinked destinations are refused', async (t) => {
  const f = await fixture(t);
  const env = { ...f.env };
  delete env.HERDR_APP_HOME;
  await execute(process.execPath, [installer, '--project-root', f.projects], { env, timeout: 10000 });
  assert.equal(
    JSON.parse(await readFile(join(env.HOME, '.config/herdr-app/data/worktree-launcher-config.json'))).project_root,
    f.projects,
  );
  await mkdir(join(f.app, 'mods'));
  await symlink(join(env.HOME, '.config/herdr-app/mods/worktree-launcher'), f.target);
  await assert.rejects(f.run(['--project-root', f.projects]), /Refusing to replace/);
});

test('update migrates legacy settings once and preserves every machine root and unrelated field', async (t) => {
  const f = await fixture(t);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'mod.json'), await readFile(resolve('mods/worktree-launcher/mod.json')));
  const legacyPath = join(f.target, 'config.json');
  const config = { project_root: f.projects, remote_project_roots: { devbox: '/remote/projects' }, personal: true };
  const original = JSON.stringify(config);
  await writeFile(legacyPath, original);
  await f.run();
  const nextPath = join(f.app, 'data/worktree-launcher-config.json');
  assert.deepEqual(JSON.parse(await readFile(nextPath)), config);
  assert.equal(await readFile(legacyPath, 'utf8'), original);
  config.remote_project_roots.devbox = '/remote/next';
  await writeFile(nextPath, JSON.stringify(config));
  await f.run();
  assert.deepEqual(JSON.parse(await readFile(nextPath)), config);
});

test('migration preserves settings saved by the running UI after the installer first reads config', async (t) => {
  const f = await fixture(t);
  await mkdir(f.target, { recursive: true });
  await writeFile(join(f.target, 'mod.json'), await readFile(resolve('mods/worktree-launcher/mod.json')));
  await writeFile(join(f.target, 'config.json'), JSON.stringify({ project_root: '/old/projects' }));
  const current = JSON.stringify({
    project_root: '/new/projects',
    remote_project_roots: { devbox: '/new/remote' },
    savedByUi: true,
  });
  await assert.rejects(f.run([], { WL_CONFIG_DURING_VERSION: current }), /settings changed during installation/);
  assert.equal(await readFile(join(f.app, 'data/worktree-launcher-config.json'), 'utf8'), current);
});
