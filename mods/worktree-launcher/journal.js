export function createJournalStore(read, write, path) {
  let snapshot = null, operations = [];
  const machineOf = request => request.machine ?? null;
  return {
    async load(machine = null) {
      const text = await read(path);
      let records;
      try {
        const value = text ? JSON.parse(text) : null;
        records = value === null ? [] : value.version === 2 ? value.operations : [value];
        if (!Array.isArray(records) || records.some(record => !record || !record.project || typeof record.path !== 'string' || (record.machine != null && typeof record.machine !== 'string')) || new Set(records.map(machineOf)).size !== records.length) throw new Error();
      } catch { throw new Error('Recovery record is unreadable. Inspect data/worktree-launcher-operation.json before creating another worktree.'); }
      snapshot = text; operations = records;
      return records.find(record => machineOf(record) === machine) ?? null;
    },
    async save(request, machine = null) {
      if (request && machineOf(request) !== machine) throw new Error('Recovery record belongs to another machine.');
      const records = operations.filter(record => machineOf(record) !== machine);
      if (request) records.push(request);
      const next = JSON.stringify({ version: 2, operations: records });
      await write(path, next, snapshot);
      snapshot = next; operations = records;
    },
  };
}
