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
  const root = await mkdtemp(join(tmpdir(), 'worktree-launcher-'));
  const bin = join(root, 'bin'), events = join(root, 'events.jsonl');
  await mkdir(bin); await writeFile(events, '');
  const userHome = join(root, "user's home"); await mkdir(userHome);
  await writeFile(join(userHome, '.zshenv'), 'export PW_TEST_USER_INIT=loaded\n');
  await writeFile(join(userHome, '.zshrc'), "alias pw_custom='printf custom'\n");
  const stub = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const args = process.argv.slice(2), binary = basename(process.argv[1]);
appendFileSync(process.env.PW_TEST_EVENTS, JSON.stringify({binary,args,env:Object.fromEntries(['HOME','HERDR_APP_HOME','HC_SESSION','HC_SOCKET','ZDOTDIR','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_RUNTIME_DIR','HC_TERMINAL_ID'].map(k=>[k,process.env[k]??null]))})+'\\n');
if (process.env.PW_TEST_FAIL_OPEN && args[0]==='do' && args[1]==='mod.open') process.exit(1);
const state=join(process.env.HERDR_APP_HOME,'overlay-polls');
if (process.env.PW_TEST_DELAY_OVERLAY && args[0]==='do' && args[1]==='mod.open') writeFileSync(state,'0');
if (args[0]==='status') {
 let visible=true;
 if (process.env.PW_TEST_DELAY_OVERLAY) {
  visible=existsSync(state) && Number(readFileSync(state,'utf8'))>0;
  if (existsSync(state)) writeFileSync(state,String(Number(readFileSync(state,'utf8'))+1));
 }
 console.log(JSON.stringify({errors:[],overlays:visible?['worktree-launcher']:[]}));
}
else if (args[0]==='ls') console.log(JSON.stringify({spaces:[],terminals:[]}));
`;
  for (const name of ['herdr-app', 'hc']) await writeFile(join(bin, name), stub, { mode: 0o755 });
  const env = { ...process.env, HOME: userHome, XDG_CONFIG_HOME: join(root, 'user-config'), HC_SOCKET: join(root, 'live.sock'), PATH: `${bin}:${process.env.PATH}`, PW_TEST_EVENTS: events, HC_TERMINAL_ID: 'live-parent' };
  delete env.ZDOTDIR;
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
  const config = JSON.parse(await readFile(join(root, 'app/data/worktree-launcher-config.json'), 'utf8'));
  assert.equal(config.project_root, join(root, 'projects'));
  const keys = JSON.parse(await readFile(join(root, 'app/keys.json'), 'utf8'));
  assert.equal(keys.global['cmd-shift-g'], 'mod.open:worktree-launcher');
  const settings = JSON.parse(await readFile(join(root, 'app/settings.json'), 'utf8'));
  assert.equal(settings.core, join(f.bin, 'hc'));
  const git = async (...args) => (await execute('git', ['-C', join(root, 'projects/demo'), ...args])).stdout.trim();
  const sourceHead = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(await git('rev-parse', 'HEAD'), sourceHead);
  assert(await git('rev-parse', '--verify', 'refs/heads/available'));
  assert(await git('rev-parse', '--verify', 'refs/remotes/origin/remote-only'));
  await f.run(['stop', root]);
  const records = await f.records();
  assert(records.some(r => r.args.join(' ') === 'do mod.open --name worktree-launcher'));
  assert(records.some(r => r.args.join(' ') === 'do app.quit'));
  assert(records.some(r => r.binary === 'hc' && r.args.join(' ') === 'server stop'));
  for (const record of records) {
    assert.equal(record.env.HOME, join(root, 'home'));
    assert.equal(record.env.HERDR_APP_HOME, join(root, 'app'));
    assert.equal(record.env.HC_SESSION, 'hw');
    assert.equal(record.env.HC_SOCKET, join(root, 'run/herdr-core/hw.sock'));
    assert.equal(record.env.ZDOTDIR, join(root, 'shell'));
    assert.equal(record.env.HC_TERMINAL_ID, null);
    for (const [key, dir] of [['XDG_CONFIG_HOME','config'],['XDG_DATA_HOME','data'],['XDG_STATE_HOME','state'],['XDG_RUNTIME_DIR','run']]) assert.equal(record.env[key], join(root, dir));
  }
});

test('stop refuses an unmarked directory before invoking an app or core', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run(['stop', f.root]), /isolated test directory/);
  assert.deepEqual(await f.records(), []);
});

test('renamed launcher can still stop an isolated session created under the old project name', async t => {
  const f = await fixture(t); const result = await f.run(); const root = f.remember(result.stdout);
  const marker = join(root, '.worktree-launcher-test.json');
  const metadata = JSON.parse(await readFile(marker, 'utf8'));
  await writeFile(join(root, '.personal-worktrees-test.json'), JSON.stringify({ ...metadata, kind: 'personal-worktrees-test' }));
  await rm(marker);
  await f.run(['stop', root]);
  const records = await f.records();
  assert(records.some(r => r.args.join(' ') === 'do app.quit'));
  assert(records.some(r => r.binary === 'hc' && r.args.join(' ') === 'server stop'));
  assert(records.every(r => r.env.HERDR_APP_HOME === join(root, 'app')));
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

test('test zsh loads personal startup files while hc stays pinned to the isolated socket', async t => {
  const f = await fixture(t); const result = await f.run(); const root = f.remember(result.stdout);
  const launch = (await f.records()).find(record => record.binary === 'herdr-app' && !record.args.length);
  const env = { ...f.env, ...Object.fromEntries(Object.entries(launch.env).filter(([, value]) => value !== null)), PW_EXPECTED_HOME: f.env.HOME, PW_EXPECTED_CONFIG: f.env.XDG_CONFIG_HOME };
  const probe = '[[ $HOME == $PW_EXPECTED_HOME && $XDG_CONFIG_HOME == $PW_EXPECTED_CONFIG ]] || exit 11; [[ $PW_TEST_USER_INIT == loaded ]] || exit 12; (( $+aliases[pw_custom] )) || exit 13; print -r -- "$HC_SOCKET"';
  const shell = await execute('/bin/zsh', ['-ic', probe], { env, timeout: 20000 });
  assert.equal(shell.stdout.trim(), join(root, 'run/herdr-core/hw.sock'));
  await f.run(['stop', root]);
});

test('launcher waits for the overlay to appear after the open command returns', async t => {
  const f = await fixture(t); const result = await f.run([], { PW_TEST_DELAY_OVERLAY: '1' });
  const root = f.remember(result.stdout); assert(root);
  const records = await f.records();
  assert.equal(records.filter(r => r.args.join(' ') === 'do mod.open --name worktree-launcher').length, 1);
  assert(records.filter(r => r.args.join(' ') === 'status').length >= 3);
  await f.run(['stop', root]);
});
