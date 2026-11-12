import { randomUUID } from 'crypto';
import { operationsConflict } from './journal.js';

const shellLaunch = { key: 'shell', label: 'Shell', argv: null };
const agentKeys = ['claude', 'pi', 'opencode', 'codex'];
function launchChoices(programs) {
  return [
    shellLaunch,
    ...agentKeys.flatMap((key) => {
      const agent = programs.find(
        (item) =>
          item.key === key &&
          item.installed &&
          Array.isArray(item.run) &&
          item.run[0] &&
          item.run.every((arg) => typeof arg === 'string' && !arg.includes('\0')),
      );
      return agent ? [{ key, label: agent.name, argv: [...agent.run] }] : [];
    }),
  ];
}

export async function openCheckout(request, backend, app) {
  if ((backend.machine ?? null) !== (request.machine ?? null)) throw new Error('Checkout belongs to another machine.');
  const deadline = app.now() + 10000;
  let expired = false;
  const unconfirmed = () =>
    new Error(
      `Opening unconfirmed after 10 seconds. Checkout preserved at ${request.path}. Retry opening the worktree.`,
    );
  const check = () => {
    if (expired || app.now() >= deadline) throw unconfirmed();
  };
  const timer = app.timeout(10000);
  async function operation() {
    const opened = await backend.open(request);
    check();
    const terminal = request.machine ? `${request.machine}/${opened.terminal}` : opened.terminal;
    let selected = '';
    while (app.now() < deadline) {
      check();
      const { spaces, panes } = app.snapshot();
      const pane = panes.find((p) => p.terminal === terminal);
      const space =
        pane &&
        spaces.find((s) => (s.machine ?? null) === (request.machine ?? null) && s.tabs.some((t) => t.id === pane.tab));
      if (space && pane) {
        if (selected !== pane.pane) {
          for (const [command, args] of [
            ['space.select', { id: space.id }],
            ['tab.select', { id: pane.tab }],
            ['pane.focus', { pane: pane.pane }],
          ]) {
            check();
            app.run(command, args);
          }
          selected = pane.pane;
        }
        const current = app.snapshot();
        if (
          current.spaces.some((s) => s.id === space.id && s.active) &&
          current.panes.some((p) => p.pane === pane.pane && p.terminal === terminal && p.focused)
        )
          return;
      }
      await app.pause();
    }
    throw unconfirmed();
  }
  try {
    await Promise.race([
      operation(),
      timer.promise.then(() => {
        expired = true;
        throw unconfirmed();
      }),
    ]);
  } finally {
    expired = true;
    timer.cancel();
  }
}

export class WorktreeModel {
  constructor({ connect, config, saveRoot, journal, open, machine = null, listAgents = async () => [] }) {
    Object.assign(this, { connect, config, saveRoot, journal, open, machine, listAgents });
    this.launches = [shellLaunch];
    this.launch = shellLaunch;
    this.git = null;
    this.root = '';
    this.rootReady = false;
    this.generation = 0;
    this.closed = false;
    this.projects = [];
    this.refs = [];
    this.project = null;
    this.ref = null;
    this.remotes = [];
    this.remote = null;
    this.fetchMessage = '';
    this.action = 'new';
    this.name = '';
    this.error = '';
    this.phase = 'loading';
    this.result = null;
    this.pending = null;
  }
  get busy() {
    return ['configuring', 'fetching', 'creating', 'opening'].includes(this.phase);
  }
  get editable() {
    return !this.closed && ['editing', 'loading'].includes(this.phase);
  }
  get canSelectMachine() {
    return !this.closed && !this.busy;
  }
  get canCreate() {
    return (
      !this.pending &&
      this.phase === 'editing' &&
      !!this.project &&
      !!this.ref &&
      (this.action === 'existing' ? !this.ref.reason : !!this.name)
    );
  }
  get reusing() {
    return this.result ? !!this.result.request?.reuse : this.action === 'existing' && !!this.ref?.checkout;
  }
  get path() {
    if (this.result) return this.result.path;
    if (this.reusing) return this.ref.checkout;
    return this.previewPath ?? '';
  }
  async preview() {
    const project = this.project,
      name = this.action === 'existing' ? (this.ref?.name ?? '') : this.name,
      action = this.action,
      generation = this.generation;
    this.previewPath = '';
    if (!project || !name) return;
    let path = '';
    try {
      path = await this.git.destination(project, name);
    } catch {}
    if (
      !this.closed &&
      generation === this.generation &&
      this.project === project &&
      this.action === action &&
      name === (action === 'existing' ? (this.ref?.name ?? '') : this.name)
    )
      this.previewPath = path;
  }
  resetFields() {
    this.previewPath = '';
    this.refs = [];
    this.ref = null;
    this.remotes = [];
    this.remote = null;
    this.fetchMessage = '';
    this.name = '';
    this.error = '';
  }
  async refresh(changed = () => {}) {
    if (this.busy || this.closed) return;
    const generation = ++this.generation;
    const previousLaunch = this.launch.key;
    this.project = null;
    this.resetFields();
    this.projects = [];
    this.git = null;
    this.result = null;
    this.pending = null;
    this.rootReady = false;
    this.phase = 'loading';
    changed();
    try {
      const config = await this.config(this.machine);
      if (this.closed || generation !== this.generation) return;
      this.root = config.project_root ?? '';
      changed();
      const programsTask = this.listAgents(this.machine).catch(() => []);
      const git = await this.connect(this.machine);
      if (this.closed || generation !== this.generation) return;
      this.git = git;
      const [contents, programs] = await Promise.all([this.root ? git.discover(config) : [], programsTask]);
      if (this.closed || generation !== this.generation) return;
      this.launches = launchChoices(programs);
      this.launch = this.launches.find((item) => item.key === previousLaunch) ?? shellLaunch;
      this.projects = contents;
      this.result = null;
      this.rootReady = !!this.root;
      this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message;
      this.phase = 'editing';
    }
  }
  async selectMachine(machine, changed) {
    if (!this.canSelectMachine) return false;
    if (this.machine === machine) return false;
    this.launch = shellLaunch;
    this.launches = [shellLaunch];
    this.machine = machine;
    this.root = '';
    await this.refresh(changed);
    return true;
  }
  async configureRoot(root, changed = () => {}) {
    if (!this.editable || !this.git) return;
    this.generation++;
    this.phase = 'configuring';
    this.error = '';
    changed();
    try {
      const canonical = await this.git.validateRoot({ project_root: root });
      await this.saveRoot(this.machine, canonical);
      this.phase = 'editing';
      const pending = this.refresh(changed),
        generation = this.generation;
      await pending;
      return !this.closed && generation === this.generation && this.rootReady && !this.error;
    } catch (error) {
      this.error = error.message;
      this.phase = 'editing';
      return false;
    }
  }
  async selectProject(project) {
    if (!this.editable) return;
    const generation = ++this.generation;
    this.project = project;
    this.resetFields();
    this.phase = 'loading';
    try {
      const [refs, remotes] = await Promise.all([this.git.choices(project), this.git.remotes(project)]);
      if (this.closed || generation !== this.generation) return;
      this.refs = refs;
      this.remotes = remotes;
      this.remote = remotes.find((row) => row.name === 'origin') ?? remotes[0] ?? null;
      this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message;
      this.phase = 'editing';
    }
  }
  selectRemote(remote) {
    if (this.closed || this.phase !== 'editing') return;
    const selected = this.remotes.find((row) => row.name === remote.name);
    if (selected) {
      this.remote = selected;
      this.error = '';
      this.fetchMessage = '';
    }
  }
  async fetchRemote(changed = () => {}) {
    if (this.closed || this.phase !== 'editing' || !this.project || !this.remote) return;
    const generation = ++this.generation,
      project = this.project,
      remote = this.remote,
      selected = this.ref;
    const current = () => !this.closed && generation === this.generation;
    this.phase = 'fetching';
    this.error = '';
    this.fetchMessage = '';
    changed();
    try {
      const refs = await this.git.fetch(project, remote.name);
      if (!current()) return;
      this.refs = refs;
      this.ref = selected ? (refs.find((row) => row.ref === selected.ref) ?? null) : null;
      this.error = '';
      this.fetchMessage = `Fetched ${remote.label}. Branches updated.`;
    } catch (error) {
      if (current()) this.error = error.message;
    } finally {
      if (current()) {
        this.phase = 'editing';
        changed();
      }
    }
  }
  setAction(action) {
    if (!this.editable || this.action === action) return false;
    this.action = action;
    this.name = '';
    this.previewPath = '';
    this.error = '';
    return true;
  }
  setName(name) {
    if (this.editable) {
      this.name = name;
      this.previewPath = '';
      this.error = '';
    }
  }
  selectRef(ref) {
    if (this.editable && (this.action === 'new' || !ref.reason)) {
      this.ref = ref;
      this.previewPath = '';
      this.error = '';
    }
  }
  selectLaunch(launch) {
    if (this.closed || !['editing', 'recover'].includes(this.phase)) return;
    const selected = this.launches.find((item) => item.key === launch.key);
    if (selected) this.launch = selected;
  }
  close() {
    if (this.busy) {
      this.error = 'The operation is finishing. This window stays open until the outcome is known.';
      return false;
    }
    this.closed = true;
    this.generation++;
    return true;
  }
  async reconcile(target) {
    for (const pending of await this.journal.load(this.machine)) {
      if (!operationsConflict(pending, target)) continue;
      const result = await this.git.inspect(pending, { recover: true });
      if (!['created', 'absent'].includes(result.kind))
        throw new Error(
          `Previous operation for ${pending.name} at ${pending.path} is unresolved. ${result.error || 'Inspect Git before retrying this worktree.'}`,
        );
      await this.journal.clear(pending);
    }
  }
  async submit(open = this.open) {
    if (!this.canCreate || this.closed) return;
    this.phase = 'creating';
    this.error = '';
    let saved = false;
    try {
      const name = this.action === 'existing' ? this.ref.name : this.name;
      const path =
        this.action === 'existing' && this.ref.checkout
          ? this.ref.checkout
          : await this.git.destination(this.project, name);
      const target = { machine: this.machine, project: this.project, name, path };
      await this.reconcile(target);
      const request = await this.git.prepare({
        project: this.project,
        action: this.action,
        ref: this.ref.ref,
        name: this.name,
        checkout: this.action === 'existing' ? this.ref.checkout : null,
      });
      if (request.path !== path) await this.reconcile({ ...request, machine: this.machine });
      request.launch = this.launch;
      request.attempt = randomUUID();
      await this.journal.save(request);
      this.pending = request;
      saved = true;
      this.result = await this.git.create(request);
      if (this.result.kind === 'created') {
        await this.openCreated(open);
        return;
      }
      this.error = this.result.error;
      if (this.result.kind === 'absent') {
        await this.journal.clear(this.pending);
        this.pending = null;
        this.result = null;
        this.phase = 'editing';
      } else this.phase = 'partial';
    } catch (e) {
      this.error = e.message;
      if (saved && ['context_missing', 'dependency_missing', 'core_unavailable'].includes(e.kind)) {
        try {
          await this.journal.clear(this.pending);
          this.pending = null;
          saved = false;
        } catch (error) {
          this.error += ` Recovery record could not be cleared: ${error.message}`;
        }
      }
      this.phase = saved ? 'partial' : 'editing';
    }
  }
  async openCreated(open = this.open) {
    if (this.closed || !this.result || this.result.kind !== 'created' || this.phase === 'opening') return;
    this.phase = 'opening';
    this.error = '';
    try {
      const result = await this.git.inspect(this.result.request, { recover: true });
      if (result.kind !== 'created') {
        this.result = result;
        this.phase = 'partial';
        this.error = result.error || 'Checkout changed. Inspect Git before opening.';
        return;
      }
      if (this.pending) {
        await this.journal.clear(this.pending);
        this.pending = null;
      }
      const request = { ...result.request, launch: this.launch };
      this.result = { ...result, request };
      await open(request);
      this.phase = 'complete';
    } catch (e) {
      this.error = e.message;
      this.phase = 'recover';
    }
  }
}
