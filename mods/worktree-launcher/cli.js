// Execution stays on the selected machine. The executable never routes between hosts.
async function call(exec, machine, operation, args = {}) {
  const result = await exec('herdr-worktree-launcher', ['api', '--request', JSON.stringify({ operation, ...args })], {
    on: machine,
  });
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      [
        result.stderr?.trim(),
        'Worktree Launcher CLI is unavailable. Install herdr-worktree-launcher on the selected machine and ensure it is on PATH.',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
  if (value?.error && typeof value.error === 'object') {
    const error = new Error([value.error.message, value.error.hint].filter(Boolean).join(' '));
    error.kind = value.error.kind;
    throw error;
  }
  if (result.code !== 0) throw new Error(result.stderr?.trim() || 'Worktree Launcher CLI failed.');
  return value;
}

export const listCLIPrograms = (exec, machine, agents) => call(exec, machine, 'programs', { agents });

export async function connectCLI(exec, machine = null) {
  const invoke = (operation, args) => call(exec, machine, operation, args);
  const opening = new Map();
  function open(request) {
    if (!request.attempt) return invoke('open', { request });
    const current = opening.get(request.attempt),
      program = JSON.stringify(request.launch);
    if (current)
      return current.program === program
        ? current.promise
        : current.promise.then(
            () => open(request),
            () => open(request),
          );
    const promise = invoke('open', { request }).finally(() => opening.delete(request.attempt));
    opening.set(request.attempt, { program, promise });
    return promise;
  }
  const context = await invoke('context');
  if (context.protocol !== 1)
    throw new Error('Update herdr-worktree-launcher on the selected machine: unsupported API version.');
  const project = (value) => ({ ...value, machine });
  const request = (value) => ({ ...value, core_id: context.core_id, machine, project: project(value.project) });
  const result = (value) => ({ ...value, request: request(value.request) });
  return {
    machine,
    userHome: context.userHome,
    validateRoot: (config) => invoke('validateRoot', { config }),
    directories: (path) => invoke('directories', { path }),
    discover: async (config) => (await invoke('discover', { config })).map(project),
    project: async (path) => project(await invoke('project', { path })),
    selection: async (path) => {
      const value = await invoke('selection', { path });
      return { ...value, project: project(value.project) };
    },
    choices: (project) => invoke('choices', { project }),
    remotes: (project) => invoke('remotes', { project }),
    fetch: (project, remote) => invoke('fetch', { project, remote }),
    destination: (project, name) => invoke('destination', { project, name }),
    prepare: async (args) => request(await invoke('prepare', args)),
    create: async (value) => result(await invoke('create', { request: request(value) })),
    inspect: async (request, options = {}) => result(await invoke('inspect', { request, ...options })),
    open: (value) => open(request(value)),
  };
}
