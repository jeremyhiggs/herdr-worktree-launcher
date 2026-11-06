import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath, rename, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGit, connectGit } from '../mods/worktree-launcher/git.js';

const execute = promisify(execFile);
const runner = async (command, args, options) => {
  try { const r = await execute(command, args, { ...options, maxBuffer: 8 * 1024 * 1024 }); return { code: 0, ...r }; }
  catch (e) { if (typeof e.code !== 'number') throw e; return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worktree-launcher-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'projects'), home = join(dir, 'home');
  await mkdir(root); await mkdir(home);
  async function repo(relative) {
    const p = join(root, relative); await mkdir(p, { recursive: true });
    git(p, 'init', '-b', 'main'); git(p, 'config', 'user.name', 'Fixture'); git(p, 'config', 'user.email', 'fixture@example.invalid');
    git(p, 'commit', '--allow-empty', '-m', 'first'); const first = git(p, 'rev-parse', 'HEAD');
    git(p, 'branch', 'free'); git(p, 'commit', '--allow-empty', '-m', 'second');
    git(p, 'branch', 'base'); git(p, 'tag', 'free');
    for (const remote of ['origin', 'upstream']) {
      const bare = join(dir, `${relative.replaceAll('/', '-')}-${remote}`, `${relative.split('/').at(-1)}.git`);
      git(dir, 'init', '--bare', bare); git(p, 'remote', 'add', remote, bare);
      git(p, 'push', remote, 'refs/heads/main', 'refs/heads/free'); git(p, 'update-ref', `refs/remotes/${remote}/feature/a`, remote === 'origin' ? first : git(p, 'rev-parse', 'HEAD'));
    }
    git(p, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    return p;
  }
  const api = createGit(runner, home);
  return { dir, root, home, repo, api, project: async p => (await api.discover({ project_root: root })).find(x => x.path === p) };
}

test('discovery distinguishes basenames, prunes build/ignored/bare/JJ and deduplicates worktrees', async t => {
  const f = await fixture(t); const a = await f.repo('one/app'); await f.repo('two/app');
  await f.repo('node_modules/hidden'); await f.repo('one/app/ignored'); await writeFile(join(a, '.gitignore'), 'ignored/\n');
  await mkdir(join(f.root, 'native-jj', '.jj'), { recursive: true }); git(f.root, 'init', '--bare', 'bare.git');
  git(a, 'worktree', 'add', join(f.root, 'linked'), 'free');
  const projects = await f.api.discover({ project_root: f.root });
  assert.deepEqual(projects.map(p => p.label), ['one/app', 'two/app']);
  await mkdir(join(a, 'subdir'));
  assert.deepEqual(await f.api.identity(join(a, 'subdir')), { top: a, id: join(a, '.git') });
  assert.deepEqual(await f.api.identity(join(f.root, 'linked')), { top: join(f.root, 'linked'), id: join(a, '.git') });
  for (const config of [null, {}, { project_root: '.' }, { project_root: join(f.root, 'missing') }]) await assert.rejects(f.api.discover(config), /project_root/);
  await mkdir(join(f.dir, 'empty')); assert.deepEqual(await f.api.discover({ project_root: join(f.dir, 'empty') }), []);
});

test('broken submodule gitfiles do not prevent finding healthy repositories on either machine', async t => {
  const f = await fixture(t); const healthy = await f.repo('healthy');
  const nested = await f.repo('archived/broken-parent/valid');
  const broken = join(f.root, 'archived/broken-parent');
  await mkdir(join(broken, 'lib/child'), { recursive: true });
  await writeFile(join(broken, '.git'), 'gitdir: ../../missing-metadata\n');
  await writeFile(join(broken, 'lib/child/.git'), 'gitdir: ../../missing-child-metadata\n');
  for (const machine of [null, 'devbox']) {
    const api = createGit(runner, f.home, machine);
    const projects = await api.discover({ project_root: f.root });
    assert.deepEqual(projects.map(project => project.path).sort(), [healthy, nested].sort());
  }
});

test('ignore-rule errors other than invalid repository metadata still stop discovery with details', async t => {
  const f = await fixture(t); const outer = await f.repo('outer'); await f.repo('outer/child');
  const config = join(outer, '.git/config'); await chmod(config, 0);
  try { await assert.rejects(f.api.discover({ project_root: f.root }), /Cannot inspect project ignore rules at .*Permission denied/); }
  finally { await chmod(config, 0o600); }
});

test('local and remote discovery batch metadata without changing discovery rules or literal paths', async t => {
  const f = await fixture(t); const p = await f.repo("one ; 'literal'/app");
  const other = await f.repo('two/app'); await f.repo('node_modules/hidden');
  await f.repo("one ; 'literal'/app/ignored"); await writeFile(join(p, '.gitignore'), 'ignored/\n');
  git(p, 'worktree', 'add', join(f.root, 'linked'), 'free');
  await mkdir(join(f.root, 'native-jj/.jj'), { recursive: true }); git(f.root, 'init', '--bare', 'bare.git');
  for (const machine of [null, 'devbox']) {
    const calls = [];
    const api = createGit((command, args, options) => { calls.push(command); return runner(command, args, options); }, f.home, machine);
    const projects = await api.discover({ project_root: f.root });
    assert.deepEqual(projects, [p, other].map(path => ({ id: join(path, '.git'), machine, path, root: f.root, label: path.slice(f.root.length + 1), basename: 'app' })));
    assert(calls.length <= 5, `Expected one scan plus root validation, got ${calls.length} calls`);
    assert.equal(calls.filter(command => command === '/bin/bash').length, 1);
    const nested = await api.discover({ project_root: join(f.root, "one ; 'literal'") });
    assert.equal(nested.length, 1); assert.equal(nested[0].path, p);
  }
});

test('remote discovery rejects failed scans instead of exposing a partial project list', async t => {
  const f = await fixture(t); await f.repo('app');
  const blocked = join(f.root, 'unreadable'); await mkdir(blocked); await chmod(blocked, 0);
  try {
    const remote = createGit(runner, f.home, 'devbox');
    await assert.rejects(remote.discover({ project_root: f.root }), /Permission denied/);
  } finally { await chmod(blocked, 0o700); }
  const truncated = createGit((command, args, options) => command === '/bin/bash'
    ? Promise.resolve({ code: 0, stdout: ['/candidate', '/top', '/id', '/project', 'origin', '0', ''].join('\0'), stderr: '' })
    : runner(command, args, options), f.home, 'devbox');
  await assert.rejects(truncated.discover({ project_root: f.root }), /incomplete metadata/);
});

test('fetch updates only the selected remote branch refs and preserves the primary checkout on either machine', async t => {
  const f = await fixture(t); const p = await f.repo('app');
  await writeFile(join(p, 'tracked'), 'original'); git(p, 'add', 'tracked'); git(p, 'commit', '-m', 'tracked');
  await writeFile(join(p, 'tracked'), 'staged'); git(p, 'add', 'tracked');
  await writeFile(join(p, 'tracked'), 'unstaged'); await writeFile(join(p, 'untracked'), 'keep');
  const before = [git(p, 'rev-parse', 'HEAD'), git(p, 'status', '--porcelain'), git(p, 'diff'), git(p, 'diff', '--cached')];
  const origin = git(p, 'remote', 'get-url', 'origin'), upstream = git(p, 'remote', 'get-url', 'upstream');
  for (const machine of [null, 'devbox']) {
    const api = createGit(runner, f.home, machine), project = (await api.discover({ project_root: f.root }))[0];
    const name = machine ? 'fetch-remote' : 'fetch-local';
    git(origin, 'branch', name, 'main'); git(upstream, 'branch', `${name}-other`, 'main');
    assert.deepEqual((await api.remotes(project)).map(row => row.name).sort(), ['origin', 'upstream']);
    assert(!(await api.choices(project)).some(row => row.name === name));
    const refs = await api.fetch(project, 'origin');
    assert(refs.some(row => row.ref === `refs/remotes/origin/${name}`));
    assert(!refs.some(row => row.ref === `refs/remotes/upstream/${name}-other`));
    await assert.rejects(api.fetch(project, '--all'), /remote/i);
    await assert.rejects(api.fetch({ ...project, id: 'replaced' }, 'origin'), /identity/i);
  }
  assert.deepEqual([git(p, 'rev-parse', 'HEAD'), git(p, 'status', '--porcelain'), git(p, 'diff'), git(p, 'diff', '--cached')], before);
  assert.equal(await readFile(join(p, 'untracked'), 'utf8'), 'keep');
  git(p, 'remote', 'set-url', 'upstream', join(f.dir, 'unavailable.git'));
  await assert.rejects(f.api.fetch(await f.project(p), 'upstream'), /repository|access|exist/i);
});

test('directory browsing lists immediate folders and symlinks with literal names, plus the parent', async t => {
  const f = await fixture(t);
  const names = ['one', 'two words', 'literal<&>$(echo nope)'];
  for (const name of names) await mkdir(join(f.root, name, 'nested'), { recursive: true });
  await writeFile(join(f.root, 'file'), 'excluded');
  await symlink(join(f.root, 'one'), join(f.root, 'linked'));
  const result = await f.api.directories(f.root);
  assert.equal(result.path, f.root);
  assert.deepEqual(result.entries[0], { path: f.dir, label: '.. (Parent directory)' });
  assert.deepEqual(result.entries.slice(1).map(row => row.label).sort(), [...names, 'linked'].sort());
  assert(result.entries.slice(1).every(row => row.path === join(f.root, row.label)));
  assert.equal((await f.api.directories(join(f.root, 'linked'))).path, join(f.root, 'one'));
  await assert.rejects(f.api.directories(join(f.root, 'missing')), /project_root/);
});

test('branch-named primary checkouts use the origin repository name for destinations', async t => {
  const f = await fixture(t); const p = await f.repo('OlympusDAO/coingecko-api/master');
  git(p, 'branch', '-m', 'master');
  git(p, 'remote', 'set-url', 'origin', 'git@code.example.invalid:OlympusDAO/coingecko-api.git');
  const project = await f.project(p);
  assert.equal(project.basename, 'coingecko-api');
  const request = await f.api.prepare({ project, action: 'new', ref: 'refs/heads/master', name: 'test' });
  assert.equal(request.path, join(f.home, '.herdr/worktrees/coingecko-api/test'));
  assert.equal((await f.api.create(request)).kind, 'created');
  assert.equal(git(request.path, 'symbolic-ref', 'HEAD'), 'refs/heads/test');
  git(p, 'checkout', 'base');
  assert.equal((await f.project(p)).basename, 'coingecko-api');
  git(p, 'remote', 'set-url', 'origin', 'git@code.example.invalid:OlympusDAO/renamed.git');
  await assert.rejects(f.api.prepare({ project, action: 'new', ref: 'refs/heads/base', name: 'stale-name' }), /identity changed/);
});

test('repository names support origin URL forms and fall back to the checkout folder without origin', async t => {
  const f = await fixture(t); const p = await f.repo('checkout-folder');
  for (const url of ['https://code.example.invalid/team/repository.git', 'ssh://git@code.example.invalid/team/repository.git/', 'git@code.example.invalid:repository.git', '/srv/git/repository.git', 'https://code.example.invalid/team/repository.git?transport=fixture']) {
    git(p, 'remote', 'set-url', 'origin', url);
    assert.equal((await f.project(p)).basename, 'repository');
  }
  git(p, 'remote', 'remove', 'origin');
  assert.equal((await f.project(p)).basename, 'checkout-folder');
});

test('refs keep identities, availability reasons and both remotes; bases include checked out branches', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  const refs = await f.api.choices(project);
  assert.equal(refs.find(x => x.ref === 'refs/heads/main').checkout, p);
  assert.equal(refs.find(x => x.ref === 'refs/heads/main').reason, '');
  assert.equal(refs.filter(x => x.name === 'feature/a').length, 2);
  assert(!refs.some(x => x.ref.endsWith('/HEAD')));
  assert.match(refs.find(x => x.ref === 'refs/remotes/origin/free').reason, /local branch/);
  assert(refs.some(x => x.ref === 'refs/heads/main'));
});

test('an app-context read denial names the project root and explains the macOS folder permission', async t => {
  const f = await fixture(t);
  const denied = createGit((command, args, options) => command === '/bin/test' && args[0] === '-r' && args[1] === f.root
    ? Promise.resolve({ code: 1, stdout: '', stderr: '' }) : runner(command, args, options), f.home);
  await assert.rejects(denied.discover({ project_root: f.root }), error => {
    assert(error.message.includes(f.root));
    assert.match(error.message, /Herdr/);
    assert.match(error.message, /Files and Folders/);
    return true;
  });
});

test('remote connections route every command to one machine, use its home, and refuse cross-machine requests', async t => {
  const f = await fixture(t); const p = await f.repo('app');
  const calls = [];
  const remote = await connectGit(async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === '/usr/bin/uname') return { code: 0, stdout: 'Linux\n', stderr: '' };
    if (command === '/usr/bin/printenv') return { code: 0, stdout: `${f.home}\n`, stderr: '' };
    return runner(command, args, options);
  }, '/wrong-local-home', 'devbox');
  const project = (await remote.discover({ project_root: f.root })).find(x => x.path === p);
  assert.equal(project.machine, 'devbox'); assert.equal(remote.userHome, f.home);
  const request = await remote.prepare({ project, action: 'new', ref: 'refs/heads/main', name: 'remote-test' });
  assert.equal(request.machine, 'devbox'); assert(request.path.startsWith(f.home));
  assert.equal((await remote.create(request)).kind, 'created');
  assert(calls.every(call => call.options.on === 'devbox'));
  const before = calls.length;
  assert.equal((await remote.create({ ...request, machine: null })).kind, 'partial');
  assert.equal(calls.length, before);
  await assert.rejects(remote.prepare({ project: { ...project, machine: null }, action: 'new', ref: 'refs/heads/main', name: 'wrong' }), /another machine/);
  assert.equal(calls.length, before);
});

test('unsupported or disconnected remote machines do not fall back to local commands', async () => {
  const calls = [];
  await assert.rejects(connectGit(async (command, _args, options) => {
    calls.push([command, options]); return { code: 0, stdout: command.endsWith('uname') ? 'Windows_NT' : '/remote-home/fixture', stderr: '' };
  }, '/local', 'devbox'), /Linux or macOS/);
  assert(calls.every(([, options]) => options.on === 'devbox'));
  await assert.rejects(connectGit(async () => { throw new Error('machine unreachable'); }, '/local', 'devbox'), /unreachable/);
});

for (const [action, ref, name, expected, upstream] of [
  ['existing', 'refs/heads/free', '', 'free', 'origin/free'],
  ['existing', 'refs/remotes/upstream/feature/a', '', 'feature/a', 'upstream/feature/a'],
  ['new', 'refs/heads/free', 'local-new', 'local-new', ''],
  ['new', 'refs/remotes/origin/feature/a', 'remote-new', 'remote-new', ''],
  ['new', 'refs/heads/main', 'checked-base', 'checked-base', ''],
]) test(`${action}: ${ref} creates attached ${expected} with correct tip/upstream and preserves dirty primary`, async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  git(p, 'branch', '--set-upstream-to=origin/free', 'free'); git(p, 'config', 'branch.autoSetupMerge', 'always');
  await writeFile(join(p, 'tracked'), 'original'); git(p, 'add', 'tracked'); git(p, 'commit', '-m', 'tracked');
  await writeFile(join(p, 'tracked'), 'dirty'); await writeFile(join(p, 'untracked'), 'keep');
  const before = [git(p, 'rev-parse', 'HEAD'), git(p, 'diff'), git(p, 'diff', '--cached'), git(p, 'status', '--porcelain')];
  const tip = git(p, 'rev-parse', ref);
  const request = await f.api.prepare({ project, action, ref, name });
  const result = await f.api.create(request); assert.equal(result.kind, 'created', result.error);
  assert.equal(git(result.path, 'symbolic-ref', 'HEAD'), `refs/heads/${expected}`);
  assert.equal(git(result.path, 'rev-parse', 'HEAD'), tip);
  assert.equal(git(p, 'for-each-ref', '--format=%(upstream:short)', `refs/heads/${expected}`), upstream);
  assert.deepEqual([git(p, 'rev-parse', 'HEAD'), git(p, 'diff'), git(p, 'diff', '--cached'), git(p, 'status', '--porcelain')], before);
  assert.equal(await readFile(join(p, 'untracked'), 'utf8'), 'keep');
});

test('submission validates names, stale ref/project, changed eligibility and current base tip', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  for (const name of ['', 'bad name', '-bad', '@{-1}', 'main', 'feature/a']) await assert.rejects(f.api.prepare({ project, action: 'new', ref: 'refs/heads/free', name }));
  git(p, 'update-ref', 'refs/heads/free', git(p, 'rev-parse', 'main'));
  const req = await f.api.prepare({ project, action: 'new', ref: 'refs/heads/free', name: 'advanced' });
  assert.equal(req.commit, git(p, 'rev-parse', 'main'));
  git(p, 'branch', '-D', 'free'); await assert.rejects(f.api.prepare({ project, action: 'new', ref: 'refs/heads/free', name: 'stale' }), /ref|branch/i);
  git(p, 'branch', 'free'); git(p, 'worktree', 'add', join(f.dir, 'occupied-branch'), 'free');
  const existing = await f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free' });
  assert.equal(existing.path, join(f.dir, 'occupied-branch')); assert.equal(existing.reuse, true);
  await assert.rejects(f.api.prepare({ project: { ...project, id: 'replaced' }, action: 'new', ref: 'refs/heads/main', name: 'stale' }), /identity|project/i);
});

test('existing checkouts open in place on either machine without Git or filesystem mutation', async t => {
  const f = await fixture(t); const p = await f.repo('app');
  const linked = join(f.dir, "custom checkouts ; 'literal'/free");
  git(p, 'worktree', 'add', linked, 'free');
  git(p, 'branch', '--set-upstream-to=origin/free', 'free');
  await writeFile(join(linked, 'tracked'), 'original'); git(linked, 'add', 'tracked'); git(linked, 'commit', '-m', 'tracked');
  await writeFile(join(linked, 'tracked'), 'staged'); git(linked, 'add', 'tracked');
  await writeFile(join(linked, 'tracked'), 'unstaged'); await writeFile(join(linked, 'untracked'), 'keep');
  const snapshot = path => [git(path, 'rev-parse', 'HEAD'), git(path, 'status', '--porcelain'), git(path, 'diff'), git(path, 'diff', '--cached')];
  const before = snapshot(linked), primary = snapshot(p), worktrees = git(p, 'worktree', 'list', '--porcelain');
  for (const machine of [null, 'devbox']) {
    const calls = [];
    const api = createGit((command, args, options) => { calls.push([command, args]); return runner(command, args, options); }, f.home, machine);
    const project = (await api.discover({ project_root: f.root }))[0];
    for (const [ref, path] of [['refs/heads/free', linked], ['refs/heads/main', p]]) {
      const request = await api.prepare({ project, action: 'existing', ref, checkout: path });
      assert.equal(request.path, path); assert.equal(request.reuse, true); assert.equal(request.machine, machine);
      assert.equal((await api.create(request)).kind, 'created');
      assert.equal((await api.inspect(request)).kind, 'created');
    }
    assert(!calls.some(([command, args]) => command === '/bin/mkdir' || command === 'git' && args.includes('add')));
  }
  assert.deepEqual(snapshot(linked), before); assert.deepEqual(snapshot(p), primary);
  assert.equal(git(p, 'worktree', 'list', '--porcelain'), worktrees);
  assert.equal(git(linked, 'for-each-ref', '--format=%(upstream)', 'refs/heads/free'), 'refs/remotes/origin/free');
  assert.equal(await readFile(join(linked, 'untracked'), 'utf8'), 'keep');
  const pending = await f.api.prepare({ project: await f.project(p), action: 'existing', ref: 'refs/heads/free', checkout: linked });
  git(linked, 'commit', '-m', 'Advance existing branch'); git(linked, 'branch', '--unset-upstream', 'free');
  const advanced = snapshot(linked);
  assert.equal((await f.api.create(pending)).kind, 'created');
  assert.equal((await f.api.inspect(pending)).kind, 'created');
  assert.deepEqual(snapshot(linked), advanced);
  assert.equal(git(linked, 'for-each-ref', '--format=%(upstream)', 'refs/heads/free'), '');
});

test('an existing checkout that moves or changes branch never falls back to creating a checkout', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  const linked = join(f.dir, 'linked'), moved = join(f.dir, 'moved');
  git(p, 'worktree', 'add', linked, 'free');
  const request = await f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free', checkout: linked });
  git(p, 'worktree', 'move', linked, moved);
  await assert.rejects(f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free', checkout: linked }), /changed|Refresh/);
  assert.notEqual((await f.api.create(request)).kind, 'created');
  const current = await f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free', checkout: moved });
  git(moved, 'checkout', 'base');
  assert.notEqual((await f.api.create(current)).kind, 'created');
  assert.notEqual((await f.api.inspect(current)).kind, 'created');
  assert.equal(git(moved, 'symbolic-ref', '--short', 'HEAD'), 'base');
  assert.equal(git(p, 'worktree', 'list', '--porcelain').split('worktree ').length - 1, 2);
  const fresh = await f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free' });
  git(p, 'worktree', 'add', linked, 'free');
  assert.equal((await f.api.create(fresh)).kind, 'absent');
  await assert.rejects(realpath(fresh.path));
  assert.equal(git(linked, 'symbolic-ref', 'HEAD'), 'refs/heads/free');
  await rm(linked, { recursive: true });
  assert.match((await f.api.choices(project)).find(ref => ref.ref === 'refs/heads/free').reason, /unavailable/);
  await assert.rejects(f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free' }), /unavailable/);
});

test('argv stays literal and paths reject slug, basename, occupied and symlink collisions', async t => {
  const f = await fixture(t); const p = await f.repo("space ; $(literal)/app"); const project = await f.project(p);
  const name = 'feature/$(literal);safe';
  const req = await f.api.prepare({ project, action: 'new', ref: 'refs/heads/main', name });
  assert.equal((await f.api.create(req)).kind, 'created');
  await assert.rejects(f.api.prepare({ project, action: 'new', ref: 'refs/heads/main', name: 'feature/literal-safe' }), /occupied|collision/i);
  const p2 = await f.repo('other/app');
  await assert.rejects(f.api.prepare({ project: await f.project(p2), action: 'new', ref: 'refs/heads/main', name }), /occupied|collision/i);
  for (const name of ['---', '.', '..']) assert.throws(() => f.api.destination(project, name), /destination|slug/i);
  const occupied = f.api.destination(project, 'occupied'); await mkdir(occupied, { recursive: true });
  await assert.rejects(f.api.prepare({ project, action: 'new', ref: 'refs/heads/main', name: 'occupied' }), /occupied|collision/i);
  const escape = join(f.home, '.herdr', 'worktrees', 'escape'); await symlink(f.dir, escape);
  await assert.rejects(f.api.prepare({ project: { ...project, basename: 'escape' }, action: 'new', ref: 'refs/heads/main', name: 'outside' }));
});

test('failure/timeout after mutation reconciles checkout or branch artifact without deleting it', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  for (const mode of ['nonzero', 'timeout', 'branch-only']) {
    const wrapped = createGit(async (command, args, options) => {
      if (command === 'git' && args.includes('add') && args.includes('worktree')) {
        if (mode === 'branch-only') { git(p, 'branch', mode, 'main'); return { code: 1, stderr: 'injected failure', stdout: '' }; }
        await runner(command, args, options);
        if (mode === 'timeout') throw new Error('timed out');
        return { code: 1, stderr: 'injected failure', stdout: '' };
      }
      return runner(command, args, options);
    }, f.home);
    const req = await wrapped.prepare({ project, action: 'new', ref: 'refs/heads/main', name: mode });
    const result = await wrapped.create(req);
    assert.equal(result.kind, mode === 'branch-only' ? 'partial' : 'created');
    if (mode !== 'branch-only') assert.equal(git(result.path, 'rev-parse', 'HEAD'), req.commit);
    else assert.match(result.error, /branch.*exists/i);
  }
});

test('canonical revalidation rejects a project replaced by an outside symlink and symlinked destination ancestors', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  await rename(p, join(f.dir, 'outside')); await symlink(join(f.dir, 'outside'), p);
  await assert.rejects(f.api.prepare({ project, action: 'new', ref: 'refs/heads/main', name: 'escape' }), /identity|project/i);
  const q = await f.repo('trap'); const trap = await f.project(q);
  await mkdir(join(f.home, '.herdr', 'worktrees'), { recursive: true });
  await symlink(f.dir, join(f.home, '.herdr', 'worktrees', 'trap'));
  await assert.rejects(f.api.prepare({ project: trap, action: 'new', ref: 'refs/heads/main', name: 'escape' }), /symlink/);
  await mkdir(join(f.dir, 'unreadable')); await chmod(join(f.dir, 'unreadable'), 0);
  t.after(() => chmod(join(f.dir, 'unreadable'), 0o700).catch(() => {}));
  await assert.rejects(f.api.discover({ project_root: join(f.dir, 'unreadable') }), /unreadable/);
});

test('discovery reports scan failures and live Git timeouts rather than returning a partial list', async t => {
  const f = await fixture(t); const path = await f.repo('app'); const project = await f.project(path);
  for (const program of ['/bin/bash', 'git']) {
    const api = createGit(async (command, args, options) => {
      if (command === program) throw new Error('injected output/time limit');
      return runner(command, args, options);
    }, f.home);
    await assert.rejects(program === 'git' ? api.choices(project) : api.discover({ project_root: f.root }), /limit/);
  }
});

test('a ref namespace conflict reports no artifact when only a longer branch already exists', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  git(p, 'branch', 'feature/existing');
  const request = await f.api.prepare({ project, action: 'new', ref: 'refs/heads/main', name: 'feature' });
  const result = await f.api.create(request);
  assert.equal(result.kind, 'absent');
  assert.match(result.error, /cannot lock ref|exists/);
  assert.equal(git(p, 'rev-parse', 'refs/heads/feature/existing'), git(p, 'rev-parse', 'HEAD'));
});
