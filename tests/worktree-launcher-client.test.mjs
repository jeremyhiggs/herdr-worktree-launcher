import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectCLI } from '../mods/worktree-launcher/cli.js';

test('UI routes JSON arguments to the selected machine and retains machine provenance', async () => {
  const calls = [],
    project = { id: 'repo', path: '/code/sample' };
  const exec = async (command, args, options) => {
    const value = JSON.parse(args[2]);
    calls.push({ command, args, options, value });
    const result =
      value.operation === 'context'
        ? { protocol: 1, userHome: '/fixture-home', core_id: 'app-core' }
        : value.operation === 'discover'
          ? [project]
          : value.operation === 'selection'
            ? { project, ref: 'refs/heads/feature/current' }
            : value.operation === 'prepare'
              ? { ...value, path: '/worktree' }
              : value.operation === 'create'
                ? { kind: 'created', request: value.request, path: value.request.path }
                : { terminal: 't42' };
    return { code: 0, stdout: JSON.stringify(result) };
  };
  const api = await connectCLI(exec, 'devbox');
  const [selected] = await api.discover({ project_root: '/code' });
  const suggestion = await api.selection('/code/sample/src', { project_root: '/code' });
  assert.equal(suggestion.project.machine, 'devbox');
  assert.equal(suggestion.ref, 'refs/heads/feature/current');
  assert.equal(calls.find((c) => c.value.operation === 'selection').value.path, '/code/sample/src');
  assert.deepEqual(calls.find((c) => c.value.operation === 'selection').value.config, { project_root: '/code' });
  const prepared = await api.prepare({ project: selected, name: "feature/quote's", action: 'new' });
  const result = await api.create({ ...prepared, core_id: 'stale-core' });
  await api.open({ ...result.request, core_id: 'stale-core' });
  assert.equal(api.userHome, '/fixture-home');
  assert.equal(result.request.machine, 'devbox');
  assert.equal(result.request.project.machine, 'devbox');
  for (const call of calls) {
    assert.equal(call.command, 'herdr-worktree-launcher');
    assert.equal(call.options.on, 'devbox');
    assert.equal(call.args.length, 3);
  }
  assert.equal(calls.find((c) => c.value.operation === 'prepare').value.name, "feature/quote's");
  assert.equal(prepared.core_id, 'app-core');
  for (const operation of ['create', 'open'])
    assert.equal(calls.find((c) => c.value.operation === operation).value.request.core_id, 'app-core');
});

test('fetch and creation allow long operations within the native execution limit', async () => {
  const calls = [];
  const api = await connectCLI(async (_command, args, options) => {
    const value = JSON.parse(args[2]);
    calls.push({ operation: value.operation, options });
    return {
      code: 0,
      stdout: JSON.stringify(value.operation === 'context' ? { protocol: 1 } : { request: value.request }),
    };
  });
  await api.fetch({}, 'origin');
  await api.create({ project: {} });
  await api.choices({});
  for (const { operation, options } of calls) {
    if (['fetch', 'create'].includes(operation)) {
      assert(options.timeout > 30000, `${operation} must outlast the native default`);
      assert(options.timeout <= 600000, `${operation} must fit the native cap`);
    } else assert.equal(options.timeout, undefined);
  }
});

test('UI passes prompts to capable local and remote CLIs and refuses older CLIs before creation', async () => {
  for (const machine of [null, 'devbox']) {
    for (const supported of [true, false]) {
      const calls = [];
      const api = await connectCLI(async (_command, args) => {
        const call = JSON.parse(args[2]);
        calls.push(call);
        return {
          code: 0,
          stdout: JSON.stringify(
            call.operation === 'context'
              ? { protocol: 1, initial_prompt: supported }
              : { kind: 'created', request: call.request },
          ),
        };
      }, machine);
      const request = { project: {}, launch: { key: 'codex', prompt: 'Review "quotes"\nand tests.' } };
      if (supported) {
        const result = await api.create(request);
        assert.equal(result.request.launch.prompt, request.launch.prompt);
        assert.equal(calls[1].request.launch.prompt, request.launch.prompt);
      } else {
        await assert.rejects(api.create(request), { kind: 'launch_invalid' });
        assert.equal(calls.length, 1, 'No create call may silently drop the prompt');
      }
    }
  }
});

test('UI preserves CLI dependency/context errors and rejects incompatible or missing executables', async () => {
  await assert.rejects(
    connectCLI(async () => ({
      code: 1,
      stdout: JSON.stringify({ error: { kind: 'context', message: 'Missing Herdr context.', hint: 'Set HC_SOCKET.' } }),
    })),
    /Missing Herdr context.*HC_SOCKET/,
  );
  await assert.rejects(
    connectCLI(async () => ({ code: 127, stdout: '', stderr: '' })),
    /Install herdr-worktree-launcher/,
  );
  await assert.rejects(
    connectCLI(async () => ({ code: 0, stdout: '{"protocol":2}' })),
    /unsupported API version/,
  );
});

test('UI retries share an outstanding CLI open; a changed program waits for it to settle', async () => {
  let resolve,
    calls = 0;
  const gate = new Promise((done) => {
    resolve = done;
  });
  const api = await connectCLI(async (_command, args) => {
    const request = JSON.parse(args[2]);
    if (request.operation === 'context') return { code: 0, stdout: '{"protocol":1}' };
    calls++;
    if (calls === 1) await gate;
    return { code: 0, stdout: JSON.stringify({ terminal: `t${calls}` }) };
  });
  const request = { attempt: 'attempt', launch: { key: 'shell' } };
  const first = api.open(request),
    retry = api.open({ ...request });
  assert.equal(first, retry);
  assert.equal(calls, 1);
  const changed = api.open({ ...request, launch: { key: 'codex' } });
  assert.equal(calls, 1);
  resolve();
  assert.equal((await first).terminal, 't1');
  assert.equal((await retry).terminal, 't1');
  assert.equal((await changed).terminal, 't2');
  assert.equal(calls, 2);
});
