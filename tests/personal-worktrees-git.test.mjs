import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGit } from '../mods/personal-worktrees/git.js';

const execute = promisify(execFile);
const runner = async (command, args, options) => {
  try { const r = await execute(command, args, { ...options, maxBuffer: 8 * 1024 * 1024 }); return { code: 0, ...r }; }
  catch (e) { if (typeof e.code !== 'number') throw e; return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
};
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'personal-worktrees-')));
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
      const bare = join(dir, `${relative.replaceAll('/', '-')}-${remote}.git`);
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
  for (const config of [null, {}, { project_root: '.' }, { project_root: join(f.root, 'missing') }]) await assert.rejects(f.api.discover(config), /project_root/);
  await mkdir(join(f.dir, 'empty')); assert.deepEqual(await f.api.discover({ project_root: join(f.dir, 'empty') }), []);
});

test('refs keep identities, availability reasons and both remotes; bases include checked out branches', async t => {
  const f = await fixture(t); const p = await f.repo('app'); const project = await f.project(p);
  const refs = await f.api.choices(project);
  assert.equal(refs.find(x => x.ref === 'refs/heads/main').reason, `Checked out at ${p}`);
  assert.equal(refs.filter(x => x.name === 'feature/a').length, 2);
  assert(!refs.some(x => x.ref.endsWith('/HEAD')));
  assert.match(refs.find(x => x.ref === 'refs/remotes/origin/free').reason, /local branch/);
  assert(refs.some(x => x.ref === 'refs/heads/main'));
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
  await assert.rejects(f.api.prepare({ project, action: 'existing', ref: 'refs/heads/free' }), /Checked out/);
  await assert.rejects(f.api.prepare({ project: { ...project, id: 'replaced' }, action: 'new', ref: 'refs/heads/main', name: 'stale' }), /identity|project/i);
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
