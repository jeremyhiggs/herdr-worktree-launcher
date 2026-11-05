import { access, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

if (Number.parseInt(process.versions.node, 10) < 24) {
  console.error('Node.js 24 or newer is required for the isolated test launcher.');
  process.exit(1);
}

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = '.worktree-launcher-test.json';
const environment = root => {
  const env = { ...process.env, HOME: join(root, 'home'), HERDR_APP_HOME: join(root, 'app'), HC_SESSION: 'hw', HC_SOCKET: join(root, 'run/herdr-core/hw.sock'), ZDOTDIR: join(root, 'shell'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'), XDG_RUNTIME_DIR: join(root, 'run') };
  for (const key of ['HC_TERMINAL_ID', 'HERDR_SPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID']) delete env[key];
  return env;
};
const run = async (root, binary, args, timeout = 30000) => (await execute(binary, args, { env: environment(root), cwd: root, timeout, maxBuffer: 8 * 1024 * 1024 })).stdout;
async function waitForStatus(root, app, ready, message) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    let status;
    try { status = JSON.parse(await run(root, app, ['status'], 1000)); }
    catch { await delay(100); continue; }
    if (status.errors?.length) throw new Error(JSON.stringify(status.errors));
    if (ready(status)) return;
    await delay(100);
  }
  throw new Error(message);
}
async function stop(root, binaries) {
  const errors = [];
  for (const [binary, args] of [[binaries.app, ['do', 'app.quit']], [binaries.core, ['server', 'stop']]]) {
    try { await run(root, binary, args, 5000); }
    catch (error) { errors.push(error.message); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}
async function binary(name) {
  const path = (await execute('/usr/bin/which', [name])).stdout.trim();
  await access(path, constants.X_OK);
  return path;
}
async function start() {
  const binaries = { app: await binary('herdr-app'), core: await binary('hc') };
  // A short path leaves room for macOS's Unix socket limit.
  const root = await realpath(await mkdtemp('/tmp/hw-'));
  console.log(`Test directory: ${root}`);
  await writeFile(join(root, marker), JSON.stringify({ kind: 'worktree-launcher-test', ...binaries }));
  let launched = false;
  try {
    const mod = join(root, 'app/mods/worktree-launcher');
    await Promise.all(['home', 'shell', 'projects', 'config', 'data', 'state', 'run', 'app/mods/worktree-launcher'].map(path => mkdir(join(root, path), { recursive: true })));
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const restore = ['HOME', 'ZDOTDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR'].map(key => process.env[key] === undefined ? `unset ${key}` : `export ${key}=${quote(process.env[key])}`);
    const startup = join(process.env.ZDOTDIR ?? process.env.HOME, '.zshenv');
    restore.push(`if [[ -r ${quote(startup)} ]]; then source ${quote(startup)}; fi`, `export HC_SOCKET=${quote(join(root, 'run/herdr-core/hw.sock'))}`);
    await writeFile(join(root, 'shell/.zshenv'), `${restore.join('\n')}\n`, { mode: 0o600 });
    for (const name of ['main.js', 'model.js', 'git.js', 'config.js', 'mod.json', 'config.example.json', 'keys.json', 'README.md']) await copyFile(join(repository, 'mods/worktree-launcher', name), join(mod, name));
    await copyFile(join(mod, 'keys.json'), join(root, 'app/keys.json'));
    await writeFile(join(root, 'app/settings.json'), JSON.stringify({ core: binaries.core, telemetry: false }));
    await writeFile(join(root, 'app/shared.json'), JSON.stringify({ 'frame.welcomed': 'skipped' }));
    await writeFile(join(mod, 'config.json'), JSON.stringify({ project_root: join(root, 'projects') }, null, 2));

    await run(root, 'git', ['clone', '--quiet', '--no-hardlinks', repository, join(root, 'seed')]);
    const seed = join(root, 'seed');
    const base = (await run(root, 'git', ['-C', seed, 'rev-list', '--max-count=2', 'HEAD'])).trim().split('\n').at(-1);
    for (const name of ['available', 'remote-only']) await run(root, 'git', ['-C', seed, 'branch', '--no-track', name, base]);
    for (const name of ['demo', 'other-demo']) {
      const project = join(root, 'projects', name);
      await run(root, 'git', ['clone', '--quiet', '--no-hardlinks', seed, project]);
      await run(root, 'git', ['-C', project, 'branch', '--no-track', 'available', 'refs/remotes/origin/available']);
    }
    await run(root, binaries.app, ['check', mod]);
    const log = await open(join(root, 'app.log'), 'a');
    try {
      const child = spawn(binaries.app, [], { env: environment(root), cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref(); launched = true;
    } finally { await log.close(); }
    await waitForStatus(root, binaries.app, status => Array.isArray(status.errors), 'The isolated window did not become ready within 30 seconds.');
    const spaces = JSON.parse(await run(root, binaries.app, ['ls']));
    const terminals = JSON.parse(await run(root, binaries.core, ['ls']));
    if (spaces.spaces?.length !== 0 || terminals.terminals?.length !== 0) throw new Error('Expected an empty isolated app and core.');
    await run(root, binaries.app, ['do', 'mod.open', '--name', 'worktree-launcher']);
    await waitForStatus(root, binaries.app, status => status.overlays?.includes('worktree-launcher'), 'The Worktree Launcher overlay did not open within 30 seconds.');
    console.log(`Repository discovery root: ${join(root, 'projects')}`);
    console.log(`Configuration: ${join(mod, 'config.json')}`);
    console.log('Test zsh uses your normal startup files, history and cache; Herdr state and worktrees stay temporary.');
    console.log('Try demo → New branch → base available → test/new → Cmd+Enter.');
    console.log('Existing-branch choices include local available and remote origin/remote-only.');
    console.log(`Stop: pnpm run test:app stop ${root}`);
    console.log(`Log: ${join(root, 'app.log')}`);
  } catch (error) {
    if (launched) {
      try { await stop(root, binaries); } catch (cleanup) { console.error(`Test shutdown: ${cleanup.message}`); }
    }
    throw new Error(`${error.message}\nTest files preserved. Log: ${join(root, 'app.log')}`);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 0) await start();
  else if (args.length === 2 && args[0] === 'stop') {
    const root = resolve(args[1]);
    let metadata;
    try {
      const info = await lstat(root);
      if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid()) throw new Error();
      let record;
      try { record = await readFile(join(root, marker), 'utf8'); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        record = await readFile(join(root, '.personal-worktrees-test.json'), 'utf8');
      }
      metadata = JSON.parse(record);
      if (!['worktree-launcher-test', 'personal-worktrees-test'].includes(metadata.kind)) throw new Error();
    } catch { throw new Error('Not an owned isolated test directory. Use the path printed by test:app.'); }
    await stop(root, metadata);
    console.log(`Stopped isolated test app/core. Test files preserved at ${root}`);
  } else throw new Error('Usage: pnpm run test:app [stop TEST_DIRECTORY]');
} catch (error) { console.error(error.message); process.exitCode = 1; }
