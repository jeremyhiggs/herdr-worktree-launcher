import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, rm, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execute = promisify(execFile),
  installer = resolve('scripts/install-cli.sh');
let buildRoot, cli;
before(async () => {
  buildRoot = await mkdtemp('/tmp/wl-cli-build-');
  cli = join(buildRoot, 'herdr-worktree-launcher');
  await execute('/bin/sh', [resolve('scripts/build-cli.sh'), '--output', cli], { timeout: 60000 });
});
after(async () => {
  if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
});
async function fixture(t) {
  const dir = await realpath(await mkdtemp('/tmp/wl-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'),
    bin = join(dir, 'bin'),
    project = join(dir, "projects/sample's checkout"),
    elsewhere = join(dir, 'elsewhere');
  for (const path of [home, bin, project, elsewhere]) await mkdir(path, { recursive: true });
  await symlink(process.execPath, join(bin, 'node'));
  for (const command of ['git', 'wt']) {
    await symlink((await execute('/usr/bin/which', [command])).stdout.trim(), join(bin, command));
  }
  const state = join(dir, 'core.json');
  await writeFile(state, JSON.stringify({ terminals: [], calls: [] }));
  await writeFile(
    join(bin, 'hc'),
    `#!/usr/bin/env node
const fs=require('node:fs'), readline=require('node:readline');
const file=process.env.WL_TEST_CORE;
if(process.argv[2]==='--version'){console.log('hc 0.1.18');process.exit(0)}
if(process.argv[2]==='server'&&process.argv[3]==='status'){console.log(JSON.stringify({pid:123,core:{id:'fixture'}}));process.exit(0)}
if(process.argv[2]!=='connect')throw Error('Unexpected hc command');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const req=JSON.parse(line),state=JSON.parse(fs.readFileSync(file,'utf8'));state.calls.push(req);
 let result;
 if(req.method==='terminal.list')result={terminals:state.terminals};
 else if(req.method==='terminal.run'){
  if(process.env.WL_TEST_FAIL_RUN){console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,error:{message:'spawn_failed',data:{message:'fixture spawn failed'}}}));return;}
  result={address:'t'+(state.terminals.length+1),state:'live',cwd:req.params.cwd,foreground:{cwd:req.params.cwd},labels:req.params.labels,argv:req.params.argv};
  state.terminals.push(result);
 }else throw Error('Unexpected method');
 fs.writeFileSync(file,JSON.stringify(state));console.log(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));
});
`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    HERDR_WORKTREE_ROOT: '',
    PATH: `${bin}:/usr/bin:/bin`,
    WL_TEST_CORE: state,
    HC_SOCKET: join(dir, 'core.sock'),
    WORKTRUNK_CONFIG_PATH: join(dir, 'worktrunk.toml'),
  };
  await writeFile(env.WORKTRUNK_CONFIG_PATH, '');
  delete env.HERDR_WORKTREE_LAUNCHER_CHECKOUT;
  const git = async (...args) =>
    (
      await execute('git', ['-C', project, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args])
    ).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('commit', '--allow-empty', '-m', 'fixture');
  await git('remote', 'add', 'origin', 'https://code.example.invalid/team/sample.git');
  const run = (args, extra = {}) => execute(cli, args, { cwd: elsewhere, env: { ...env, ...extra }, timeout: 15000 });
  return {
    dir,
    home,
    bin,
    project,
    elsewhere,
    env,
    git,
    run,
    state,
    core: async () => JSON.parse(await readFile(state, 'utf8')),
  };
}

test('CLI runs from elsewhere, preserves the canonical checkout and adds fresh tabs to the existing worktree space', async (t) => {
  const f = await fixture(t);
  const hostGit = await execute('git', ['--version']);
  const fixtureGit = await execute('git', ['--version'], { env: f.env });
  assert.equal(fixtureGit.stdout, hostGit.stdout, 'Restricted fixture PATH must preserve the selected Git version');
  await writeFile(join(f.project, 'untracked.txt'), 'keep');
  const before = await f.git('status', '--porcelain');
  const first = JSON.parse(
    (await f.run(['new', 'feature/example', '--checkout', f.project, '--base', 'main', '--json'])).stdout,
  );
  assert.equal(first.path, join(f.home, '.herdr/worktrees/sample/feature-example'));
  assert.equal(first.program, 'shell');
  assert.equal(await f.git('status', '--porcelain'), before);
  assert.equal(await f.git('symbolic-ref', 'HEAD'), 'refs/heads/main');
  const second = JSON.parse((await f.run(['open', 'feature/example', '--checkout', f.project, '--json'])).stdout);
  assert.equal(second.path, first.path);
  assert.equal(second.space, first.space);
  assert.notEqual(second.tab, first.tab);
  assert.notEqual(second.terminal, first.terminal);
  const core = await f.core();
  assert.equal(core.terminals.length, 3);
  assert.equal(core.terminals.filter((t) => t.cwd === f.project).length, 1);
  for (const call of core.calls) {
    assert.equal(call.params.on, undefined);
    if (call.method === 'terminal.run') assert.equal(call.params.no_parent, true);
  }
});

test('explicit CLI checkouts ignore remote or stale terminal locations', async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.state,
    JSON.stringify({
      calls: [],
      terminals: [
        { address: 'devbox/t1', state: 'live', cwd: f.project, labels: { 'herdr.space': 'remote-space' } },
        {
          address: 't2',
          state: 'live',
          cwd: f.project,
          foreground: { cwd: f.elsewhere },
          labels: { 'herdr.space': 'stale-space' },
        },
        {
          address: 't3',
          state: 'live',
          cwd: f.elsewhere,
          foreground: { cwd: f.project },
          labels: { 'herdr.space': 'correct-space' },
        },
      ],
    }),
  );
  const result = JSON.parse(
    (
      await f.run(['open', 'main', '--checkout', f.project, '--json'], {
        HERDR_WORKTREE_LAUNCHER_CHECKOUT: join(f.dir, 'unused-default'),
      })
    ).stdout,
  );
  assert.equal(result.path, f.project);
  assert.equal(result.space, 'correct-space');
  assert.equal((await f.core()).terminals.length, 4);
});

test('CLI rejects cross-machine flags and unavailable agents before creating branches', async (t) => {
  const f = await fixture(t);
  for (const args of [
    ['new', 'bad', '--machine', 'devbox'],
    ['new', 'bad', '--on', 'devbox'],
    ['new', 'bad', '--execute', 'pi'],
  ]) {
    await assert.rejects(f.run([...args, '--checkout', f.project]), /Unknown option|unknown option|not installed/);
  }
  assert.equal(await f.git('branch', '--list', 'bad'), '');
  assert.equal((await f.core()).terminals.length, 0);
});

test('CLI detects a local agent and preserves a created checkout when terminal startup fails', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const agent = JSON.parse(
    (await f.run(['open', 'main', '--checkout', f.project, '--execute', 'codex', '--json'])).stdout,
  );
  assert.equal(agent.program, 'codex');
  const call = (await f.core()).calls.find((call) => call.method === 'terminal.run');
  assert.deepEqual(call.params.argv, [join(f.bin, 'codex'), '--no-daemon']);
  await assert.rejects(f.run(['new', 'preserved', '--checkout', f.project], { WL_TEST_FAIL_RUN: '1' }), (error) => {
    assert.match(error.stderr, /fixture spawn failed/);
    assert(error.stderr.includes(join(f.home, '.herdr/worktrees/sample/preserved')));
    return true;
  });
  assert.match(await f.git('worktree', 'list', '--porcelain'), /refs\/heads\/preserved/);
});

test('CLI installer produces an executable usable without the source checkout', async (t) => {
  const f = await fixture(t),
    prefix = join(f.dir, 'install');
  await execute('/bin/sh', [installer, '--prefix', prefix, '--binary', cli], { env: f.env });
  const installed = join(prefix, 'bin/herdr-worktree-launcher');
  await execute('/bin/sh', [installer, '--prefix', prefix, '--binary', cli], { env: f.env });
  const help = await execute(installed, ['--help'], { cwd: f.elsewhere, env: { ...f.env, PATH: f.elsewhere } });
  assert.match(help.stdout, /--checkout/);
  assert.match(help.stdout, /--fetch REMOTE/);
  assert.match(help.stdout, /--execute NAME/);
  assert.doesNotMatch(help.stdout, /--program/);
  await assert.rejects(f.run(['new', 'unused', '--program', 'shell']), /Unknown option: --program/);
  const opened = await execute(installed, ['open', 'main', '--checkout', f.project, '--json'], {
    cwd: f.elsewhere,
    env: f.env,
  });
  assert.equal(JSON.parse(opened.stdout).path, f.project);
});

test('CLI installation refuses unrelated commands and installation folders', async (t) => {
  const f = await fixture(t);
  const prefix = join(f.dir, 'install'),
    command = join(prefix, 'bin/herdr-worktree-launcher');
  await mkdir(join(prefix, 'bin'), { recursive: true });
  await writeFile(command, 'unrelated command');
  await assert.rejects(
    execute('/bin/sh', [installer, '--prefix', prefix, '--binary', cli], { env: f.env }),
    /unrelated command/,
  );
  assert.equal(await readFile(command, 'utf8'), 'unrelated command');
  await rm(command);
  await mkdir(command);
  await assert.rejects(
    execute('/bin/sh', [installer, '--prefix', prefix, '--binary', cli, '--update'], { env: f.env }),
    /Refusing to replace a directory/,
  );
});

test('packaged CLI installation finds the bundled binary without Go or --binary', async (t) => {
  const f = await fixture(t),
    packaged = join(f.dir, 'package'),
    prefix = join(f.dir, 'prebuilt-install');
  await mkdir(join(packaged, 'scripts'), { recursive: true });
  await copyFile(installer, join(packaged, 'scripts/install-cli.sh'));
  await copyFile(cli, join(packaged, 'herdr-worktree-launcher'));
  await execute('/bin/sh', [join(packaged, 'scripts/install-cli.sh'), '--prefix', prefix], {
    env: { ...f.env, PATH: '/usr/bin:/bin' },
  });
  const version = await execute(join(prefix, 'bin/herdr-worktree-launcher'), ['--version'], {
    env: { ...f.env, PATH: f.elsewhere },
  });
  assert.match(version.stdout, /^herdr-worktree-launcher /);
});

test('CLI dry-run previews creation, fetch and existing-worktree reuse without invoking wt or hc', async (t) => {
  const f = await fixture(t),
    marker = join(f.dir, 'unexpected-runtime-call');
  for (const command of ['wt', 'hc']) {
    await rm(join(f.bin, command));
    await writeFile(join(f.bin, command), '#!/bin/sh\n: > "$WL_TEST_MARKER"\nexit 1\n', { mode: 0o755 });
  }
  await writeFile(join(f.bin, 'codex'), '#!/bin/sh\n: > "$WL_TEST_MARKER"\nexit 1\n', { mode: 0o755 });
  await f.git('branch', 'available');
  await writeFile(join(f.project, 'staged.txt'), 'staged');
  await f.git('add', 'staged.txt');
  await writeFile(join(f.project, 'staged.txt'), 'unstaged');
  await writeFile(join(f.project, 'untracked.txt'), 'keep');
  const snapshot = () =>
    Promise.all([
      f.git('rev-parse', 'HEAD'),
      f.git('for-each-ref'),
      f.git('worktree', 'list', '--porcelain'),
      f.git('status', '--porcelain'),
      f.git('diff'),
      f.git('diff', '--cached'),
    ]);
  const before = await snapshot(),
    env = { HC_SOCKET: '', HC_SESSION: '', WL_TEST_MARKER: marker };
  const plan = JSON.parse(
    (
      await f.run(
        [
          'new',
          'feature/preview',
          '--checkout',
          f.project,
          '--execute=codex',
          '--fetch',
          'origin',
          '--dry-run',
          '--json',
        ],
        env,
      )
    ).stdout,
  );
  assert.equal(plan.dry_run, true);
  assert.equal(plan.checkout, f.project);
  assert.equal(plan.project, f.project);
  assert.equal(plan.action, 'new');
  assert.equal(plan.branch, 'feature/preview');
  assert.equal(plan.ref, 'refs/heads/main');
  assert.equal(plan.commit, await f.git('rev-parse', 'main'));
  assert.equal(plan.path, join(f.home, '.herdr/worktrees/sample/feature-preview'));
  assert.equal(plan.worktree_action, 'create');
  assert.equal(plan.program, 'codex');
  assert.equal(plan.fetch, 'origin');
  assert.equal(plan.session_action, 'new_terminal_and_tab');
  assert.equal(plan.ensure_primary_space, true);
  assert.equal(plan.core_checked, false);
  const opened = JSON.parse(
    (await f.run(['open', 'main', '--checkout', f.project, '--dry-run', '--json'], env)).stdout,
  );
  assert.equal(opened.worktree_action, 'reuse');
  assert.equal(opened.path, f.project);
  assert.equal(opened.ensure_primary_space, false);
  const available = JSON.parse(
    (await f.run(['open', 'available', '--checkout', f.project, '--dry-run', '--json'], env)).stdout,
  );
  assert.equal(available.worktree_action, 'create');
  assert.equal(available.branch, 'available');
  const text = (await f.run(['new', 'feature/preview', '--checkout', f.project, '--dry-run'], env)).stdout;
  for (const value of ['Dry run', 'refs/heads/main', 'feature/preview', plan.path, 'fresh terminal and tab'])
    assert(text.includes(value), value);
  await assert.rejects(f.run(['api', '--dry-run', '--request', '{"operation":"open"}'], env), /dry-run.*new.*open/i);
  await assert.rejects(
    f.run(
      ['new', 'valid', '--checkout', f.project, '--base', 'origin/server-only', '--fetch', 'origin', '--dry-run'],
      env,
    ),
    /Dry-run did not fetch.*local refs/,
  );
  await assert.rejects(f.run(['new', 'valid', '--dry-run=true'], env), /takes no value/);
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.home, '.herdr')), { code: 'ENOENT' });
  assert.equal((await f.core()).terminals.length, 0);
  await rm(join(f.bin, 'wt'));
  await assert.rejects(
    f.run(['new', 'valid', '--checkout', f.project, '--dry-run'], { ...env, PATH: f.bin }),
    /wt is not on PATH/,
  );
});

test('CLI normal and dry-run commands reject invalid refs, branch collisions and unavailable destinations before mutation', async (t) => {
  const f = await fixture(t),
    occupied = join(f.home, '.herdr/worktrees/sample/occupied'),
    missing = join(f.dir, 'missing-worktree');
  await mkdir(occupied, { recursive: true });
  await f.git('remote', 'add', 'upstream', 'https://code.example.invalid/upstream/sample.git');
  for (const remote of ['origin', 'upstream']) await f.git('update-ref', `refs/remotes/${remote}/ambiguous`, 'main');
  await f.git('worktree', 'add', '-b', 'missing', missing, 'main');
  await rm(missing, { recursive: true });
  const snapshot = () =>
    Promise.all([f.git('for-each-ref'), f.git('worktree', 'list', '--porcelain'), f.git('status', '--porcelain')]);
  const before = await snapshot();
  for (const flag of [[], ['--dry-run']]) {
    for (const [args, error] of [
      [['open', 'unknown'], /unavailable/],
      [['open', 'ambiguous'], /ambiguous/],
      [['new', 'valid', '--base', 'unknown'], /unavailable/],
      [['new', 'valid', '--base', 'ambiguous'], /ambiguous/],
      [['new', 'bad name'], /valid branch name|not a valid branch name/],
      [['new', 'main'], /already exists/],
      [['new', 'ambiguous'], /already exists/],
      [['new', 'occupied'], /occupied/],
      [['open', 'missing'], /unavailable/],
      [['new', 'valid', '--fetch', 'unknown-remote'], /configured Git remote/],
      [['new', 'valid', '--execute', 'pi'], /not installed/],
    ])
      await assert.rejects(f.run([...args, '--checkout', f.project, ...flag]), error);
    assert.deepEqual(await snapshot(), before);
  }
  assert.equal((await f.core()).terminals.length, 0);
});

test('CLI fetches only the requested remote before resolving a new base or existing branch', async (t) => {
  for (const action of ['new', 'open']) {
    const f = await fixture(t),
      origin = join(f.dir, 'origin.git'),
      upstream = join(f.dir, 'upstream.git');
    for (const remote of [origin, upstream]) {
      await execute('git', ['clone', '--bare', f.project, remote]);
      await execute('git', ['-C', remote, 'branch', 'fresh', 'main']);
    }
    await f.git('remote', 'set-url', 'origin', origin);
    await f.git('remote', 'add', 'upstream', upstream);
    await writeFile(join(f.project, 'local.txt'), 'staged');
    await f.git('add', 'local.txt');
    await writeFile(join(f.project, 'local.txt'), 'unstaged');
    await writeFile(join(f.project, 'untracked.txt'), 'keep');
    const snapshot = async () =>
      Promise.all([
        f.git('rev-parse', 'HEAD'),
        f.git('status', '--porcelain'),
        f.git('diff'),
        f.git('diff', '--cached'),
      ]);
    const before = await snapshot();
    await assert.rejects(f.git('rev-parse', '--verify', 'refs/remotes/origin/fresh'));
    const args = action === 'new' ? ['new', 'after-fetch', '--base', 'origin/fresh'] : ['open', 'origin/fresh'];
    const fetchArgs = action === 'new' ? ['--fetch', 'origin'] : ['--fetch=origin'];
    const result = JSON.parse((await f.run([...args, '--checkout', f.project, ...fetchArgs, '--json'])).stdout);
    const head = (await execute('git', ['-C', result.path, 'rev-parse', 'HEAD'])).stdout.trim();
    assert.equal(head, await f.git('rev-parse', 'refs/remotes/origin/fresh'));
    const tracking = (
      await execute('git', [
        '-C',
        result.path,
        'for-each-ref',
        '--format=%(upstream)',
        `refs/heads/${action === 'new' ? 'after-fetch' : 'fresh'}`,
      ])
    ).stdout.trim();
    assert.equal(tracking, action === 'new' ? '' : 'refs/remotes/origin/fresh');
    await assert.rejects(f.git('rev-parse', '--verify', 'refs/remotes/upstream/fresh'));
    assert.deepEqual(await snapshot(), before);
  }
});

test('CLI fetch errors stop before Worktrunk or session creation', async (t) => {
  const f = await fixture(t),
    marker = join(f.dir, 'wt-called');
  await rm(join(f.bin, 'wt'));
  await writeFile(join(f.bin, 'wt'), '#!/bin/sh\n: > "$WL_TEST_WT_MARKER"\nexit 1\n', { mode: 0o755 });
  await f.git('remote', 'set-url', 'origin', join(f.dir, 'missing.git'));
  const before = await f.git('worktree', 'list', '--porcelain');
  await assert.rejects(
    f.run(['api', '--request', '{"operation":"context"}', '--fetch', 'origin']),
    /use the fetch operation/,
  );
  for (const remote of ['upstream', '--all', '', 'origin']) {
    await assert.rejects(
      f.run(['new', 'blocked', '--checkout', f.project, '--fetch', remote], { WL_TEST_WT_MARKER: marker }),
      /configured Git remote|does not appear to be a git repository/,
    );
    assert.equal(await f.git('branch', '--list', 'blocked'), '');
  }
  assert.equal(await f.git('worktree', 'list', '--porcelain'), before);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  assert.equal((await f.core()).terminals.length, 0);
});

test('CLI infers the current checkout, accepts overrides, and ignores the old environment default', async (t) => {
  const f = await fixture(t),
    other = join(f.dir, 'another-project'),
    nested = join(f.project, 'src');
  await execute('git', ['clone', f.project, other]);
  await mkdir(nested);
  const run = (args, cwd, legacyDefault = other) =>
    execute(cli, args, {
      cwd,
      env: { ...f.env, HERDR_WORKTREE_LAUNCHER_CHECKOUT: legacyDefault },
      timeout: 15000,
    });
  for (const cwd of [f.project, nested]) {
    const opened = JSON.parse((await run(['open', 'main', '--json'], cwd)).stdout);
    assert.equal(opened.path, f.project);
  }
  const overridden = JSON.parse((await run(['open', 'main', '--checkout', other, '--json'], f.project)).stdout);
  assert.equal(overridden.path, other);
  const created = JSON.parse((await run(['new', 'inferred', '--base', 'main', '--json'], nested)).stdout);
  assert.equal(created.path, join(f.home, '.herdr/worktrees/sample/inferred'));
  assert.equal(await f.git('symbolic-ref', 'HEAD'), 'refs/heads/main');
  assert.equal((await execute('git', ['-C', other, 'branch', '--list', 'inferred'])).stdout.trim(), '');
  await execute('git', [
    '-C',
    created.path,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-m',
    'linked checkout tip',
  ]);
  const tip = (await execute('git', ['-C', created.path, 'rev-parse', 'HEAD'])).stdout.trim();
  const linkedNested = join(created.path, 'src');
  await mkdir(linkedNested);
  const selection = JSON.parse(
    (await run(['api', '--request', JSON.stringify({ operation: 'selection', path: linkedNested })], f.elsewhere))
      .stdout,
  );
  assert.equal(selection.project.path, f.project);
  assert.equal(selection.ref, 'refs/heads/inferred');
  for (const [name, cwd, flags, expected] of [
    ['from-current', linkedNested, [], tip],
    ['from-override', f.elsewhere, ['--checkout', linkedNested], tip],
    ['explicit-base', linkedNested, ['--base', 'main'], await f.git('rev-parse', 'main')],
  ]) {
    const result = JSON.parse((await run(['new', name, ...flags, '--json'], cwd)).stdout);
    assert.equal((await execute('git', ['-C', result.path, 'rev-parse', 'HEAD'])).stdout.trim(), expected);
  }
  await execute('git', ['-C', created.path, 'checkout', '--detach']);
  const detached = JSON.parse(
    (await run(['api', '--request', JSON.stringify({ operation: 'selection', path: linkedNested })], f.elsewhere))
      .stdout,
  );
  assert.equal(detached.project.id, selection.project.id);
  assert.equal(detached.ref, '');
  await assert.rejects(run(['new', 'detached-base', '--json'], linkedNested), /detached.*--base/i);
  const count = (await f.core()).terminals.length;
  await assert.rejects(run(['open', 'main', '--json'], f.elsewhere, f.project), /not a git repository/i);
  await assert.rejects(run(['open', 'main', '--checkout=', '--json'], f.project), /--checkout PATH/);
  assert.equal((await f.core()).terminals.length, count);
});
