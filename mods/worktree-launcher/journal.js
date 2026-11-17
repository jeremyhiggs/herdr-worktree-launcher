const machineOf = (request) => request.machine ?? null;

export function operationsConflict(left, right) {
  return (
    machineOf(left) === machineOf(right) &&
    (left.path === right.path ||
      Boolean(left.project.id && left.project.id === right.project.id && left.name && left.name === right.name))
  );
}

export function createJournalStore(read, write, path) {
  async function load() {
    const text = await read(path);
    let operations;
    try {
      const value = text ? JSON.parse(text) : null;
      operations = value === null ? [] : value.version === 2 ? value.operations : [value];
      if (
        !Array.isArray(operations) ||
        operations.some(
          (record) =>
            !record ||
            !record.project ||
            typeof record.path !== 'string' ||
            (record.machine != null && typeof record.machine !== 'string'),
        )
      )
        throw new Error();
    } catch {
      throw new Error(
        'Recovery record is unreadable. Inspect data/worktree-launcher-operation.json before creating another worktree.',
      );
    }
    return { text, operations };
  }
  const persist = (operations, expected) => write(path, JSON.stringify({ version: 2, operations }), expected);
  return {
    async load(machine = null) {
      return (await load()).operations.filter((record) => machineOf(record) === machine);
    },
    async save(request) {
      const { text, operations } = await load();
      if (operations.some((record) => operationsConflict(record, request)))
        throw new Error('A conflicting operation needs inspection. Retry this request to inspect it.');
      await persist([...operations, request], text);
    },
    async clear(request) {
      const { text, operations } = await load();
      const index = operations.findIndex((record) => JSON.stringify(record) === JSON.stringify(request));
      if (index === -1) throw new Error('Recovery record changed. Refresh before retrying.');
      operations.splice(index, 1);
      await persist(operations, text);
    },
  };
}
