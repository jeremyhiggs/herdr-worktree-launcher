import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const launcher = resolve('scripts/test-app.mjs');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'worktrees-launcher-'));
  const bin = join(root, 'bin'), events = join(root, 'events.jsonl');
  await mkdir(bin); await writeFile(events, '');
  const stub = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
const args = process.argv.slice(2), binary = basename(process.argv[1]);
appendFileSync(process.env.PW_TEST_EVENTS, JSON.stringify({binary,args,env:Object.fromEntries(['HOME','HERDR_APP_HOME','HC_SESSION','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_RUNTIME_DIR','HC_TERMINAL_ID'].map(k=>[k,process.env[k]??null]))})+'\\n');
if (process.env.PW_TEST_FAIL_OPEN && args[0]==='do' && args[1]==='mod.open') process.exit(1);
if (args[0]==='status') console.log(JSON.stringify({errors:[],overlays:['personal-worktrees']}));
else if (args[0]==='ls') console.log(JSON.stringify({spaces:[],terminals:[]}));
`;
  for (const name of ['herdr-app', 'hc']) await writeFile(join(bin, name), stub, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PW_TEST_EVENTS: events, HC_TERMINAL_ID: 'live-parent' };
  const records = async () => (await readFile(events, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const run = (args = [], extra = {}) => execute(process.execPath, [launcher, ...args], { env: { ...env, ...extra }, timeout: 20000 });
  const remember = output => {
    const path = output.match(/^Test directory: (.+)$/m)?.[1];
    if (path) t.after(() => rm(path, { recursive: true, force: true }));
    return path;
  };
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, bin, env, records, run, remember };
}

test('isolated launcher configures disposable discovery, fixtures, shortcut and scoped stop', async t => {
  const f = await fixture(t);
  const result = await f.run(); const root = f.remember(result.stdout);
  assert(root);
  assert.match(result.stdout, /Stop: pnpm run test:app stop /);
  const config = JSON.parse(await readFile(join(root, 'app/mods/personal-worktrees/config.json'), 'utf8'));
  assert.equal(config.project_root, join(root, 'projects'));
  const keys = JSON.parse(await readFile(join(root, 'app/keys.json'), 'utf8'));
  assert.equal(keys.global['cmd-shift-g'], 'mod.open:personal-worktrees');
  const settings = JSON.parse(await readFile(join(root, 'app/settings.json'), 'utf8'));
  assert.equal(settings.core, join(f.bin, 'hc'));
  const git = async (...args) => (await execute('git', ['-C', join(root, 'projects/demo'), ...args])).stdout.trim();
  const sourceHead = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(await git('rev-parse', 'HEAD'), sourceHead);
  assert(await git('rev-parse', '--verify', 'refs/heads/available'));
  assert(await git('rev-parse', '--verify', 'refs/remotes/origin/remote-only'));
  await f.run(['stop', root]);
  const records = await f.records();
  assert(records.some(r => r.args.join(' ') === 'do mod.open --name personal-worktrees'));
  assert(records.some(r => r.args.join(' ') === 'do app.quit'));
  assert(records.some(r => r.binary === 'hc' && r.args.join(' ') === 'server stop'));
  for (const record of records) {
    assert.equal(record.env.HOME, join(root, 'home'));
    assert.equal(record.env.HERDR_APP_HOME, join(root, 'app'));
    assert.equal(record.env.HC_SESSION, 'hw');
    assert.equal(record.env.HC_TERMINAL_ID, null);
    for (const [key, dir] of [['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data'],['XDG_STATE_HOME','state'],['XDG_RUNTIME_DIR','run']]) assert.equal(record.env[key], join(root, dir));
  }
});

test('stop refuses an unmarked directory before invoking an app or core', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(['stop', f.root]), /isolated test directory/);
  assert.deepEqual(await f.records(), []);
});

test('failed overlay opening stops only the newly prepared app and core and retains its log', async t => {
  const f = await fixture(t); let failure;
  try { await f.run([], { PW_TEST_FAIL_OPEN: '1' }); } catch (e) { failure = e; }
  assert(failure); const root = f.remember(failure.stdout); assert(root);
  assert.match(failure.stderr, /app\.log/);
  const records = await f.records();
  assert(records.some(r => r.args.join(' ') === 'do app.quit'));
  assert(records.some(r => r.binary === 'hc' && r.args.join(' ') === 'server stop'));
  assert(records.every(r => r.env.HERDR_APP_HOME === join(root, 'app')));
});

test('direct launcher invocation rejects Node older than 24 before starting any app', async t => {
  const f = await fixture(t);
  const code = `Object.defineProperty(process.versions, 'node', { value: '22.0.0' }); await import(${JSON.stringify(pathToFileURL(launcher).href)});`;
  await assert.rejects(execute(process.execPath, ['--input-type=module', '--eval', code], { env: f.env, timeout: 20000 }).then(result => { f.remember(result.stdout); return result; }), /Node.js 24 or newer/);
  assert.deepEqual(await f.records(), []);
});
