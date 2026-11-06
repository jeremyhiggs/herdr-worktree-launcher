import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectGit, createGit } from '../mods/worktree-launcher/git.js';

const execute = promisify(execFile);
const machine = process.env.WORKTREE_TEST_MACHINE;

test('live remote discovery and all branch flows use only disposable repositories on the selected machine', { skip: !machine, timeout: 120000 }, async t => {
  const runner = async (command, args, options = {}) => {
    assert.equal(options.on, machine);
    const argv = ['exec', '--on', machine, '--timeout', '20', ...(options.cwd ? ['--cwd', options.cwd] : []), '--', command, ...args];
    try { return { code: 0, ...await execute('hc', argv, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }) }; }
    catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  const run = async (command, args, cwd) => {
    const result = await runner(command, args, { cwd, on: machine });
    assert.equal(result.code, 0, result.stderr); return result.stdout.trim();
  };
  const connected = await connectGit(runner, '/unused-local-home', machine);
  assert(connected.userHome.startsWith('/')); assert.equal(connected.machine, machine);
  const root = await run('/usr/bin/mktemp', ['-d', '/tmp/worktree-launcher-test-XXXXXX']);
  assert.match(root, /^\/tmp\/worktree-launcher-test-[A-Za-z0-9]+$/);
  t.diagnostic(`Disposable remote fixture: ${root}`);
  t.after(async () => { await run('/bin/rm', ['-rf', '--', root]); });
  const projects = `${root}/projects`, repo = `${projects}/app`, userHome = `${root}/home`;
  await run('/bin/mkdir', ['-p', repo, userHome]);
  const git = (...args) => run('git', args, repo);
  await git('init', '-b', 'main');
  await git('config', 'core.hooksPath', '/dev/null');
  await git('-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'first');
  const first = await git('rev-parse', 'HEAD');
  await git('branch', 'available');
  await git('-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'second');
  const second = await git('rev-parse', 'HEAD');
  await git('init', '--bare', `${root}/origin.git`);
  await git('remote', 'add', 'origin', `${root}/origin.git`);
  await git('push', 'origin', 'main', 'available:remote-only');
  const api = createGit((command, args, options) => runner(command, args, { ...options, on: machine }), userHome, machine);
  const folders = await api.directories(projects);
  assert.equal(folders.path, projects);
  assert.deepEqual(folders.entries.map(row => row.path), [root, repo]);
  const [project] = await api.discover({ project_root: projects });
  assert.equal(project.machine, machine); assert.equal(project.path, repo);
  await run('git', ['--git-dir', `${root}/origin.git`, 'branch', 'fetched-from-server', 'main']);
  assert(!(await api.choices(project)).some(ref => ref.name === 'fetched-from-server'));
  assert.deepEqual((await api.remotes(project)).map(row => row.name), ['origin']);
  assert((await api.fetch(project, 'origin')).some(ref => ref.ref === 'refs/remotes/origin/fetched-from-server'));
  for (const [action, ref, name, commit, upstream] of [
    ['existing', 'refs/heads/available', '', first, ''],
    ['existing', 'refs/remotes/origin/remote-only', '', first, 'refs/remotes/origin/remote-only'],
    ['existing', 'refs/remotes/origin/fetched-from-server', '', second, 'refs/remotes/origin/fetched-from-server'],
    ['new', 'refs/heads/main', 'new-local-base', second, ''],
    ['new', 'refs/remotes/origin/remote-only', 'new-remote-base', first, ''],
  ]) {
    const request = await api.prepare({ project, action, ref, name });
    assert(request.path.startsWith(`${userHome}/.herdr/worktrees/`));
    const result = await api.create(request); assert.equal(result.kind, 'created', result.error);
    assert.equal(await run('git', ['symbolic-ref', 'HEAD'], request.path), `refs/heads/${request.name}`);
    assert.equal(await run('git', ['rev-parse', 'HEAD'], request.path), commit);
    assert.equal(await run('git', ['for-each-ref', '--format=%(upstream)', `refs/heads/${request.name}`], request.path), upstream);
    assert.equal((await api.inspect(request)).kind, 'created');
    const reopen = await api.prepare({ project, action: 'existing', ref: `refs/heads/${request.name}`, checkout: request.path });
    assert.equal(reopen.reuse, true); assert.equal(reopen.path, request.path);
    assert.equal((await api.create(reopen)).kind, 'created');
  }
  assert.equal(await git('rev-parse', 'HEAD'), second);
  assert.equal(await git('status', '--porcelain'), '');
});
