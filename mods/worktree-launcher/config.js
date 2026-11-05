const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function createConfigStore(read, write, path) {
  async function load() {
    const text = await read(path);
    let config;
    try { config = text === null ? {} : JSON.parse(text); }
    catch { throw new Error('Malformed config.json: expected a JSON object.'); }
    if (!object(config)) throw new Error('Malformed config.json: expected a JSON object.');
    if (config.remote_project_roots !== undefined && !object(config.remote_project_roots)) throw new Error('Malformed config.json: remote_project_roots must be an object.');
    return { text, config };
  }
  return {
    async get(machine) {
      const { config } = await load();
      const roots = config.remote_project_roots ?? {};
      const root = machine ? Object.hasOwn(roots, machine) ? roots[machine] : '' : config.project_root ?? '';
      if (typeof root !== 'string') throw new Error('Configured project root must be an absolute path string.');
      return { project_root: root };
    },
    async set(machine, root) {
      const { text, config } = await load();
      if (machine) config.remote_project_roots = { ...config.remote_project_roots, [machine]: root };
      else config.project_root = root;
      await write(path, `${JSON.stringify(config, null, 2)}\n`, text);
    },
  };
}
