const clean = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value);
const parent = path => path.slice(0, path.lastIndexOf('/')) || '/';
const basename = path => path.slice(path.lastIndexOf('/') + 1);
const inside = (path, root) => path === root || path.startsWith(root === '/' ? '/' : `${root}/`);
const pruned = ['node_modules', 'vendor', 'target', 'build', 'dist', '.next', 'coverage'];

// Run metadata checks beside the filesystem instead of crossing the app bridge per check.
// Paths are positional arguments; NUL records preserve spaces and shell metacharacters.
const discoveryScript = `
set -uo pipefail
export LC_ALL=C
root=$1
shift
inside() { [[ "$1" == "$root" || "$1" == "\${root%/}/"* ]]; }
ignored() {
  local path=$1 p=\${1%/*} code error
  [[ -n "$p" ]] || p=/
  while inside "$p"; do
    if [[ -e "$p/.git" || -L "$p/.git" ]]; then
      error=$(git --no-optional-locks -C "$p" check-ignore --quiet -- "\${path:\${#p}+1}" 2>&1)
      code=$?
      if (( code < 2 )); then return "$code"; fi
      if (( code != 128 )) || [[ "$error" != 'fatal: gitfile does not point to a valid repository:'* && "$error" != 'fatal: not a git repository:'* ]]; then
        printf 'Cannot inspect project ignore rules at %s: %s\\n' "$p" "$error" >&2
        return "$code"
      fi
    fi
    [[ "$p" != "$root" && "$p" != / ]] || break
    p=\${p%/*}
    [[ -n "$p" ]] || p=/
  done
  return 1
}
/usr/bin/find "$root" '(' -type d '(' "$@" ')' -prune ')' -o '(' -name .git -print0 -prune ')' |
while IFS= read -r -d '' marker; do
  candidate=\${marker%/*}
  [[ -n "$candidate" ]] || candidate=/
  [[ ! "$candidate" =~ [[:cntrl:]] ]] || continue
  ignored "$candidate"; code=$?
  case "$code" in 0) continue ;; 1) ;; *) exit "$code" ;; esac
  paths=$(git --no-optional-locks -C "$candidate" rev-parse --path-format=absolute --show-toplevel --git-common-dir)
  code=$?
  case "$code" in 0) ;; 128) continue ;; *) exit "$code" ;; esac
  paths=$(/bin/realpath "\${paths%%$'\\n'*}" "\${paths#*$'\\n'}") || exit $?
  top=\${paths%%$'\\n'*}
  common=\${paths#*$'\\n'}
  primary=$(git --no-optional-locks -C "$top" worktree list --porcelain -z | {
    IFS= read -r -d '' first || exit 1
    [[ "$first" == 'worktree '* ]] || exit 1
    printf '%s' "\${first#worktree }"
    cat >/dev/null
  })
  code=$?
  case "$code" in 0) ;; 128) continue ;; *) exit "$code" ;; esac
  primary=$(/bin/realpath "$primary") || exit $?
  ignored "$primary"; code=$?
  case "$code" in 0) continue ;; 1) ;; *) exit "$code" ;; esac
  origin=$(git --no-optional-locks -C "$primary" config --get remote.origin.url)
  code=$?
  case "$code" in 0|1) ;; *) exit "$code" ;; esac
  printf '%s\\0' "$candidate" "$top" "$common" "$primary" "$origin" "$code"
done
code=$?
(( code == 0 )) || exit "$code"
printf '%s\\0' worktree-launcher-scan-complete
`;

function repositoryName(path, origin) {
  if (origin === null) return basename(path);
  const url = (/^[a-z][a-z0-9+.-]*:\/\//i.test(origin) ? origin.split(/[?#]/, 1)[0] : origin).replace(/\/+$/, '');
  const name = (url.includes('/') ? basename(url) : url.slice(url.lastIndexOf(':') + 1)).replace(/\.git$/, '');
  if (!clean(name) || ['.', '..'].includes(name)) throw new Error('Origin has no safe repository name.');
  return name;
}

export async function connectGit(exec, localHome, machine = null) {
  const runner = (command, args, options) => exec(command, args, { ...options, on: machine });
  let userHome = localHome;
  if (machine) {
    const [system, result] = await Promise.all([
      runner('/usr/bin/uname', ['-s']), runner('/usr/bin/printenv', ['HOME']),
    ]);
    if (system.code !== 0 || !['Linux', 'Darwin'].includes(system.stdout.trim())) throw new Error('Remote worktrees require a connected Linux or macOS machine.');
    userHome = result.stdout.trim();
    if (result.code !== 0 || !userHome.startsWith('/') || /[\r\n]/.test(userHome)) throw new Error(`Cannot determine the home directory on ${machine}.`);
  }
  return createGit(runner, userHome, machine);
}

export function parseWorktrees(text) {
  return text.split('\0\0').filter(Boolean).map(block => Object.fromEntries(block.split('\0').filter(Boolean).map(field => {
    const at = field.indexOf(' '); return at < 0 ? [field, true] : [field.slice(0, at), field.slice(at + 1)];
  })));
}

export function createGit(runner, userHome, machine = null) {
  async function command(program, args, cwd) {
    const r = await runner(program, args, cwd ? { cwd } : {});
    if (r.code !== 0) {
      const error = new Error((r.stderr || r.stdout || `${program} failed (${r.code})`).trim());
      error.code = r.code; error.program = program; throw error;
    }
    return r.stdout ?? '';
  }
  const git = (cwd, args) => command('git', ['--no-optional-locks', ...args], cwd);
  const real = async path => (await command('/bin/realpath', [path])).trim();
  async function test(flag, path) {
    const r = await runner('/bin/test', [flag, path], {});
    if (r.code !== 0 && r.code !== 1) throw new Error(`Cannot inspect ${path}`);
    return r.code === 0;
  }
  const occupied = async path => await test('-e', path) || await test('-L', path);
  async function worktrees(path) { return parseWorktrees(await git(path, ['worktree', 'list', '--porcelain', '-z'])); }
  async function identity(path) {
    const paths = (await git(path, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])).trim().split('\n');
    const [top, id] = (await command('/bin/realpath', paths)).trim().split('\n');
    return { top, id };
  }
  async function projectIdentity(path) {
    const { top, id } = await identity(path);
    const primary = (await worktrees(top))[0];
    if (!primary?.worktree || primary.bare) throw new Error('No primary checkout.');
    const primaryPath = await real(primary.worktree);
    let origin = null;
    try {
      origin = (await git(primaryPath, ['config', '--get', 'remote.origin.url'])).trim();
    } catch (error) { if (error.code !== 1) throw error; }
    return { top, id, path: primaryPath, basename: repositoryName(primaryPath, origin) };
  }
  async function rootOf(config) {
    const root = config?.project_root;
    if (!clean(root) || !root.startsWith('/')) throw new Error('Configure project_root as one absolute, readable directory in config.json.');
    if (!(await test('-d', root))) throw new Error(`Configured project_root is unavailable or is not a directory: ${root}`);
    if (!(await test('-r', root)) || !(await test('-x', root))) throw new Error(machine
      ? `Cannot read project_root on ${machine}: ${root}. Check the directory permissions on that machine, then Refresh.`
      : `Herdr cannot read project_root: ${root}. Check its permissions. For Documents, enable Documents Folder for Herdr in System Settings → Privacy & Security → Files and Folders, then Refresh.`);
    return real(root);
  }
  async function directories(path) {
    const root = await rootOf({ project_root: path });
    const found = await command('/usr/bin/find', ['-L', root, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-print0']);
    const entries = found.split('\0').filter(clean).map(path => ({ path, label: basename(path) })).sort((a, b) => a.label.localeCompare(b.label));
    if (root !== '/') entries.unshift({ path: parent(root), label: '.. (Parent directory)' });
    return { path: root, entries };
  }
  async function ignored(path, root) {
    for (let p = parent(path); inside(p, root); p = parent(p)) {
      if (await occupied(`${p}/.git`)) {
        const r = await runner('git', ['--no-optional-locks', 'check-ignore', '--quiet', '--', path.slice(p.length + 1)], { cwd: p });
        if (r.code === 0) return true;
        if (r.code === 1) return false;
        const broken = r.code === 128 && /^fatal: (?:gitfile does not point to a valid repository:|not a git repository:)/.test(r.stderr ?? '');
        if (!broken) throw new Error(`Cannot inspect project ignore rules at ${p}: ${(r.stderr || r.stdout || `git exited ${r.code}`).trim()}`);
      }
      if (p === root || p === '/') break;
    }
    return false;
  }
  async function discover(config) {
    const root = await rootOf(config);
    const expr = pruned.flatMap((name, i) => [...(i ? ['-o'] : []), '-name', name]);
    const fields = (await command('/bin/bash', ['-c', discoveryScript, 'worktree-launcher', root, ...expr])).split('\0');
    if (fields.pop() !== '' || fields.pop() !== 'worktree-launcher-scan-complete' || fields.length % 6) throw new Error('Project scan returned incomplete metadata.');
    const repositories = [];
    for (let i = 0; i < fields.length; i += 6) {
      const [candidate, top, id, path, origin, missing] = fields.slice(i, i + 6);
      if (![candidate, top, id, path].every(clean) || !['0', '1'].includes(missing)) throw new Error('Project scan returned invalid metadata.');
      repositories.push({ top, id, path, basename: repositoryName(path, missing === '1' ? null : origin.trim()) });
    }
    const projects = new Map();
    for (const repo of repositories) {
      if (repo.path === root || !inside(repo.path, root)) continue;
      const label = repo.path.slice(root.length + (root === '/' ? 0 : 1));
      if (label.split('/').some(p => pruned.includes(p))) continue;
      projects.set(repo.id, { id: repo.id, machine, path: repo.path, root, label, basename: repo.basename });
    }
    return [...projects.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  async function validateProject(project) {
    if (!project || !clean(project.path) || !clean(project.root)) throw new Error('Select a project.');
    if ((project.machine ?? null) !== machine) throw new Error('Project belongs to another machine; select it again.');
    const root = await rootOf({ project_root: project.root });
    const current = await projectIdentity(project.path);
    if (root !== project.root || current.path !== project.path || current.top !== project.path || current.id !== project.id || !inside(current.path, root) || current.path === root || current.basename !== project.basename) throw new Error('Project identity changed; Refresh and select it again.');
    if (current.path.slice(root.length + 1).split('/').some(p => pruned.includes(p)) || await ignored(current.path, root)) throw new Error('Project is now excluded; Refresh.');
    return current;
  }
  async function remoteNames(path) { return (await git(path, ['remote'])).trim().split('\n').filter(Boolean); }
  async function remotes(project) {
    await validateProject(project);
    return (await remoteNames(project.path)).map(name => ({ name, label: name }));
  }
  async function fetch(project, remote) {
    await validateProject(project);
    if (!(await remoteNames(project.path)).includes(remote)) throw new Error('Select a configured Git remote.');
    await git(project.path, ['fetch', '--no-tags', '--no-recurse-submodules', '--', remote]);
    return choices(project);
  }
  async function choices(project) {
    await validateProject(project);
    const cwd = project.path;
    const checked = await worktrees(cwd);
    const remotes = (await remoteNames(cwd)).sort((a, b) => b.length - a.length);
    const text = await git(cwd, ['for-each-ref', '--format=%(refname)%00%(symref)%00%(upstream)', 'refs/heads', 'refs/remotes']);
    const refs = text.split('\n').filter(Boolean).map(line => {
      const [ref, symbolic, upstream] = line.split('\0');
      const local = ref.startsWith('refs/heads/');
      const short = ref.slice(local ? 11 : 13);
      const remote = local ? null : remotes.find(r => short.startsWith(`${r}/`));
      return { ref, symbolic, upstream, kind: local ? 'local' : 'remote', source: local ? 'local' : remote, name: local ? short : remote ? short.slice(remote.length + 1) : short, label: `${short} · ${local ? 'local' : 'remote'}` };
    }).filter(r => !r.symbolic);
    const locals = new Set(refs.filter(r => r.kind === 'local').map(r => r.name));
    return refs.map(r => {
      const checkout = checked.find(w => w.branch === r.ref);
      const reason = r.kind === 'local' ? (checkout?.prunable ? `Worktree is unavailable at ${checkout.worktree}. Repair it in Git, then Refresh.` : '') : !r.source ? 'Remote is no longer configured.' : locals.has(r.name) ? `A local branch named ${r.name} already exists.` : '';
      return { ...r, checkout: checkout?.worktree ?? null, reason };
    });
  }
  function destination(project, name) {
    const slug = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || slug === '.' || slug === '..' || !clean(project.basename) || ['.', '..'].includes(project.basename) || project.basename.includes('/')) throw new Error('Branch has no safe destination slug.');
    return `${userHome}/.herdr/worktrees/${project.basename}/${slug}`;
  }
  async function validateDestination(path) {
    if (await occupied(path)) throw new Error(`Destination is occupied: ${path}`);
    const home = await real(userHome);
    let p = userHome;
    for (const component of path.slice(userHome.length + 1).split('/').slice(0, -1)) {
      p += `/${component}`;
      if (await occupied(p)) {
        if (!(await test('-d', p)) || await real(p) !== `${home}${p.slice(userHome.length)}`) throw new Error(`Destination ancestor is a symlink or unavailable: ${p}`);
      }
    }
  }
  async function prepare({ project, action, ref, name = '', checkout = null }) {
    if (!['existing', 'new'].includes(action)) throw new Error('Select Existing branch or New branch.');
    const refs = await choices(project);
    const selected = refs.find(r => r.ref === ref);
    if (!selected) throw new Error('Selected branch/ref is stale; Refresh and choose again.');
    if (action === 'existing' && selected.reason) throw new Error(selected.reason);
    if (action === 'existing' && checkout && selected.checkout !== checkout) throw new Error('Existing worktree changed; Refresh and select the branch again.');
    if (action === 'new') {
      if (!clean(name) || name.startsWith('-') || name.startsWith('@{')) throw new Error('Enter a valid new branch name.');
      await git(project.path, ['check-ref-format', '--branch', name]);
      if (refs.some(r => r.name === name)) throw new Error(`A local or fetched remote branch named ${name} already exists.`);
    } else name = selected.name;
    const reuse = action === 'existing' && !!selected.checkout;
    const path = reuse ? selected.checkout : destination(project, name);
    if (!reuse) await validateDestination(path);
    const commit = (await git(project.path, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
    const request = { machine, project, action, ref, name, path, commit, reuse, upstream: action === 'existing' ? selected.kind === 'remote' ? ref : selected.upstream : '', remote: selected.kind === 'remote' };
    if (reuse) {
      const result = await inspect(request);
      if (result.kind !== 'created') throw new Error(result.error);
    }
    return request;
  }
  async function inspect(request) {
    try {
      if ((request.machine ?? null) !== machine || (request.project.machine ?? null) !== machine) throw new Error('Operation belongs to another machine.');
      const { project, path, name, commit, upstream } = request;
      if (request.reuse) await validateProject(project);
      const rows = await worktrees(project.path);
      const row = rows.find(w => w.worktree === path);
      if (row && !row.prunable && row.branch === `refs/heads/${name}` && (request.reuse || row.HEAD === commit)) {
        const actual = await identity(path);
        if (actual.id === project.id && actual.top === await real(path)
          && (request.reuse || (await git(path, ['for-each-ref', '--format=%(upstream)', `refs/heads/${name}`])).trim() === upstream)) return { kind: 'created', path, request };
      }
      if (request.reuse) return { kind: 'partial', path, request, error: `Existing worktree is unavailable or changed at ${path}. Inspect Git before opening.` };
      const branch = (await git(project.path, ['for-each-ref', '--format=%(refname)', `refs/heads/${name}`])).trim().split('\n').includes(`refs/heads/${name}`);
      if (row || await occupied(path) || (request.action === 'new' || request.remote) && branch) return { kind: 'partial', path, error: `Incomplete operation: ${branch ? 'branch already exists; ' : ''}${row || await occupied(path) ? 'destination or worktree exists; ' : ''}inspect and repair it manually.`, request };
      return { kind: 'absent', path, request };
    } catch (e) { return { kind: 'partial', path: request.path, request, error: `Cannot reconcile operation: ${e.message}. Inspect Git before retrying.` }; }
  }
  async function create(request) {
    if (request.reuse) return inspect(request);
    let error = '';
    try {
      if ((request.machine ?? null) !== machine) throw new Error('Operation belongs to another machine.');
      await validateProject(request.project);
      const refs = await choices(request.project);
      const selected = refs.find(r => r.ref === request.ref);
      if (!selected || request.action === 'existing' && selected.reason) throw new Error(selected?.reason || 'Selected ref is no longer available.');
      if (request.action === 'existing' && selected.checkout) throw new Error('Branch now has an existing worktree; Refresh to open it.');
      if (request.action === 'new' && refs.some(r => r.name === request.name)) throw new Error(`A local or fetched remote branch named ${request.name} already exists.`);
      await validateDestination(request.path);
      await command('/bin/mkdir', ['-p', parent(request.path)]);
      await validateDestination(request.path);
      // Git requires the short local branch here to attach HEAD, even with a colliding tag.
      const args = request.action === 'existing' && !request.remote
        ? ['worktree', 'add', '--no-guess-remote', '--', request.path, request.name]
        : request.action === 'existing'
          ? ['worktree', 'add', '--track', '-b', request.name, '--', request.path, request.ref]
          : ['worktree', 'add', '--no-track', '-b', request.name, '--', request.path, request.commit];
      await git(request.project.path, args);
    } catch (e) { error = e.message; }
    const result = await inspect(request);
    return { ...result, error: result.error || error || (result.kind !== 'created' ? 'Git did not create the requested checkout.' : '') };
  }
  return { machine, userHome, validateRoot: rootOf, directories, discover, choices, remotes, fetch, destination, prepare, create, inspect, identity };
}
