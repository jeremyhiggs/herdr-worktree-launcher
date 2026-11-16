import { copyFile, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { clearGitEnvironment, pinSampleCLI } from './sample-cli.mjs';

if (Number.parseInt(process.versions.node, 10) < 24) throw new Error('Node.js 24 or newer is required.');
const repository = fileURLToPath(new URL('..', import.meta.url));
const execute = promisify(execFile);
const { values } = parseArgs({ options: { output: { type: 'string' } } });
const root = await realpath(await mkdtemp('/tmp/wld-'));
const output = resolve(values.output ?? join(repository, 'docs/screenshots'));
const env = {
  ...process.env,
  PATH: `${join(repository, 'dist')}:${process.env.PATH}`,
  HOME: join(root, 'home'),
  HERDR_APP_HOME: join(root, 'app'),
  HC_SESSION: 'docs',
  HC_SOCKET: join(root, 'run/herdr-core/docs.sock'),
  ZDOTDIR: join(root, 'shell'),
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_DATA_HOME: join(root, 'data'),
  XDG_STATE_HOME: join(root, 'state'),
  XDG_RUNTIME_DIR: join(root, 'run'),
};
await clearGitEnvironment(env);
for (const key of ['HC_TERMINAL_ID', 'HERDR_SPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID', 'HERDR_WORKTREE_ROOT'])
  delete env[key];
const run = async (binary, args, timeout = 30000) =>
  (await execute(binary, args, { cwd: root, env, timeout, maxBuffer: 8 * 1024 * 1024 })).stdout;
const app = (args, timeout) => run('herdr-app', args, timeout);
const status = () => app(['status'], 2000).then(JSON.parse);
async function waitFor(read, predicate, label) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (predicate(value)) return value;
    } catch (error) {
      if (error.message.startsWith('Screenshot:')) throw error;
    }
    await delay(150);
  }
  throw new Error(`Timed out: ${label}`);
}
let launched = false,
  sampleApp;
try {
  await Promise.all(
    ['home', 'shell', 'projects/acme', 'remotes', 'config', 'data', 'state', 'run', 'app/data'].map((path) =>
      mkdir(join(root, path), { recursive: true }),
    ),
  );
  await mkdir(output, { recursive: true });
  await writeFile(join(root, 'shell/.zshenv'), 'export PROMPT="%1~ %# "\nexport RPROMPT=""\n');
  await writeFile(join(root, 'shell/.zshrc'), 'PROMPT="%1~ %# "\nRPROMPT=""\n');
  const core = (await execute('/usr/bin/which', ['hc'])).stdout.trim();
  await writeFile(
    join(root, 'app/settings.json'),
    JSON.stringify({ core, telemetry: false, appearance: 'dark', font_size: 13, ui_font_size: 13 }),
  );
  await writeFile(join(root, 'app/shared.json'), JSON.stringify({ 'frame.welcomed': 'skipped' }));
  await writeFile(join(root, 'app/window.json'), JSON.stringify({ state: 'windowed', bounds: [0, 0, 1040, 880] }));
  for (const name of ['sample-api', 'website']) {
    const project = join(root, 'projects/acme', name),
      remote = join(root, 'remotes', `${name}.git`);
    await mkdir(project);
    const git = (...args) =>
      run('git', ['-C', project, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args]);
    await git('init', '-b', 'main');
    await writeFile(
      join(project, 'README.md'),
      `# ${name}\n\nA disposable project for Worktree Launcher screenshots.\n`,
    );
    await git('add', 'README.md');
    await git('-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-m', 'Create sample project');
    await git('branch', 'feature/pagination');
    await git('branch', 'develop');
    await run('git', ['init', '--bare', remote]);
    await git('remote', 'add', 'origin', remote);
    await git('push', 'origin', 'main', 'develop');
    await git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    if (name === 'sample-api') {
      await git('worktree', 'add', join(root, 'checkouts/sample-api-pagination'), 'feature/pagination');
      await run('git', ['--git-dir', remote, 'branch', 'feature/from-remote', 'main']);
    }
  }
  await run(process.execPath, [join(repository, 'scripts/install-mod.mjs'), '--project-root', join(root, 'projects')]);
  const version = (await app(['--version'])).trim().split(' ').at(-1);
  await writeFile(join(root, 'app/update-notes.json'), JSON.stringify({ last_run: version, presented: [version] }));
  const mod = join(root, 'app/mods/worktree-launcher');
  await pinSampleCLI(mod, join(repository, 'dist/herdr-worktree-launcher'));
  await copyFile(join(mod, 'main.js'), join(mod, 'launcher.js'));
  await copyFile(join(repository, 'scripts/fixtures/screenshot-launcher.js'), join(mod, 'main.js'));
  await app(['check', mod]);
  const log = await open(join(root, 'app.log'), 'a');
  try {
    const child = spawn('herdr-app', [], { cwd: root, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
    sampleApp = child;
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    launched = true;
  } finally {
    await log.close();
  }
  await waitFor(status, (value) => Array.isArray(value.errors), 'sample app startup');
  // The native sample mod activates its own window before each capture.
  await delay(1000);
  await waitFor(
    async () => {
      const state = await status();
      for (const id of state.overlays ?? []) await app(['do', 'overlay.close', '--id', id]);
      return state;
    },
    (state) => !state.overlays?.length,
    'dismiss sample startup overlays',
  );
  const spaces = JSON.parse(await app(['ls'])),
    terminals = JSON.parse(await run('hc', ['ls']));
  if (spaces.spaces.length || terminals.terminals.length) throw new Error('Expected an empty sample app/core.');
  await app(['do', 'mod.open', '--name', 'worktree-launcher']);
  const before = await run('git', ['-C', join(root, 'projects/acme/sample-api'), 'worktree', 'list', '--porcelain']);
  let firstOpening;
  for (const [scene, filename] of [
    ['new', 'new-branch.png'],
    ['fetch', 'fetch-remote.png'],
    ['existing', 'existing-branch.png'],
    ['agents', 'open-with.png'],
    ['prompt', 'initial-prompt.png'],
    ['reuse', null],
    ['reuse-again', 'fresh-tab.png'],
    ['create', 'worktree-opened.png'],
    ['current', 'current-space.png'],
  ]) {
    if (scene === 'current') {
      const state = JSON.parse(await app(['ls']));
      const primary = state.spaces.find(
        (space) => space.folder === join(root, 'projects/acme/sample-api') && !space.machine,
      );
      if (!primary) throw new Error('Primary sample space missing.');
      await app(['do', 'space.select', '--id', primary.id]);
      await app([
        'do',
        'tab.new',
        '--name',
        'Live checkout',
        '--space',
        primary.id,
        '--folder',
        join(root, 'home/.herdr/worktrees/sample-api/feature-rate-limits'),
      ]);
    }
    if (['reuse-again', 'create', 'current'].includes(scene))
      await app(['do', 'mod.open', '--name', 'worktree-launcher']);
    await app(['do', `worktree-launcher.${scene}`]);
    const result = await waitFor(
      async () => {
        const value = JSON.parse(await readFile(join(root, 'app/data/screenshot-state.json'), 'utf8'));
        if (value.error) throw new Error(`Screenshot: ${value.error}`);
        return value;
      },
      (value) => value.scene === scene,
      scene,
    );
    const state = await status();
    if (state.errors.length) throw new Error(JSON.stringify(state.errors));
    await delay(800);
    const screenshot = filename ?? `${scene}-opened.png`;
    await app(['shot', filename ? join(output, filename) : join(root, screenshot)]);
    await delay(300);
    if (scene.startsWith('reuse')) {
      const after = await run('git', ['-C', join(root, 'projects/acme/sample-api'), 'worktree', 'list', '--porcelain']);
      if (before !== after || result.result !== join(root, 'checkouts/sample-api-pagination'))
        throw new Error('Existing worktree was not reused in place.');
      if (scene === 'reuse') firstOpening = result;
      else if (
        result.space !== firstOpening.space ||
        result.tabs !== firstOpening.tabs + 1 ||
        result.terminal === firstOpening.terminal
      )
        throw new Error('Existing session did not receive a fresh terminal tab.');
    }
    console.log(`${screenshot}${filename ? '' : ' (sample only)'}: ${JSON.stringify(result)}`);
  }
  await writeFile(
    join(root, 'capture.json'),
    JSON.stringify({ source: repository, captured: new Date().toISOString(), output }, null, 2),
  );
  console.log(`Sample profile and logs: ${root}`);
} finally {
  if (launched) {
    for (const [binary, args] of [
      ['herdr-app', ['do', 'app.quit']],
      ['hc', ['server', 'stop']],
    ]) {
      try {
        await run(binary, args, 5000);
      } catch (error) {
        console.error(`Sample shutdown: ${error.message}`);
        if (binary === 'herdr-app') sampleApp.kill('SIGTERM');
      }
    }
  }
  console.log(`Sample files preserved: ${root}`);
}
