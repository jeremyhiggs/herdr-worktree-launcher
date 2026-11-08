import { randomUUID } from 'crypto';

const shellLaunch = { key: 'shell', label: 'Shell', argv: null };
const agentKeys = ['claude', 'pi', 'opencode', 'codex'];
function launchChoices(programs) {
  return [shellLaunch, ...agentKeys.flatMap(key => {
    const agent = programs.find(item => item.key === key && item.installed && Array.isArray(item.run) && item.run[0] && item.run.every(arg => typeof arg === 'string' && !arg.includes('\0')));
    return agent ? [{ key, label: agent.name, argv: [...agent.run] }] : [];
  })];
}

export async function openCheckout(request, git, app) {
  const machine = request.machine ?? null;
  const launch = request.launch?.key && request.launch.key !== 'shell' ? request.launch : null;
  const acceptsProgram = pane => launch ? pane.program?.key === launch.key : pane.program?.shell;
  const previousTerminals = new Set(request.reuse ? request.previousTerminals ?? [] : []);
  if ((git.machine ?? null) !== machine) throw new Error('Checkout belongs to another machine.');
  const deadline = app.now() + 10000;
  let expired = false;
  const unconfirmed = () => new Error(`Opening unconfirmed after 10 seconds. Checkout preserved at ${request.path}. Retry ${request.reuse ? 'Open worktree' : 'Open created worktree'}.`);
  const check = () => { if (expired || app.now() >= deadline) throw unconfirmed(); };
  const send = (command, args) => { check(); app.run(command, args); };
  const timer = app.timeout(10000);
  async function operation() {
    const project = await git.identity(request.project.path);
    check();
    if (project.id !== request.project.id || project.top !== request.project.path) throw new Error('Project checkout identity changed; inspect Git.');
    const target = await git.identity(request.path);
    check();
    if (target.id !== request.project.id) throw new Error('Checkout identity changed; inspect Git.');
    // Cache only within this attempt; the chosen pane is checked live before focus.
    const identities = new Map([[request.project.path, project], [request.path, target]]);
    async function match(identity, selectedProgram) {
      const { spaces, panes } = app.snapshot();
      const local = spaces.filter(s => (s.machine ?? null) === machine);
      // Check the likely space first, then verify its live checkout like every other candidate.
      local.sort((a, b) => Number(b.folder === identity.top) - Number(a.folder === identity.top));
      const rows = local.map(space => {
        const tabs = new Set(space.tabs.map(t => t.id));
        const candidates = panes.filter(p => tabs.has(p.tab) && p.terminal && p.cwd);
        const locations = selectedProgram ? candidates.filter(pane => acceptsProgram(pane) && !previousTerminals.has(pane.terminal)) : [...candidates, ...(space.folder ? [{ cwd: space.folder }] : [])];
        return { space, locations };
      });
      const missing = [...new Set(rows.flatMap(row => row.locations.map(pane => pane.cwd)))].filter(path => !identities.has(path));
      for (const { space, locations } of rows) for (const pane of locations) {
        if (!identities.has(pane.cwd)) {
          check();
          const found = await git.identities(missing);
          check();
          for (const path of missing) identities.set(path, found.get(path) ?? null);
        }
        const current = identities.get(pane.cwd);
        if (current?.id === identity.id && current.top === identity.top) return { space, pane };
      }
      return null;
    }
    async function ensure(identity, path, selectedProgram) {
      let found = await match(identity, selectedProgram);
      if (found) return found;
      const existing = selectedProgram ? await match(identity, false) : null;
      const program = selectedProgram && launch ? { argv: launch.argv } : {};
      if (existing) send('tab.new', { space: existing.space.id, folder: path, ...program, ...(launch ? { name: launch.label } : {}) });
      else send('space.new', { folder: path, machine: machine ?? '', ...program, ...(selectedProgram && launch ? { tab: launch.label } : {}) });
      while (app.now() < deadline) {
        check();
        found = await match(identity, selectedProgram);
        if (found) return found;
        await app.pause();
      }
      throw unconfirmed();
    }
    await ensure(project, request.project.path, false);
    let found = await ensure(target, request.path, true);
    let selected = '';
    while (app.now() < deadline) {
      check();
      found = await match(target, true);
      if (found) {
        const { space, pane } = found;
        if (selected !== pane.pane) {
          const current = await git.identity(pane.cwd);
          check();
          if (current.id !== target.id || current.top !== target.top) throw new Error('Checkout identity changed before focus; retry opening.');
          send('space.select', { id: space.id });
          send('tab.select', { id: pane.tab });
          send('pane.focus', { pane: pane.pane });
          selected = pane.pane;
        }
        const current = app.snapshot();
        if (current.spaces.some(s => s.id === space.id && s.active) && current.panes.some(p => p.pane === pane.pane && p.focused && p.cwd === pane.cwd && acceptsProgram(p))) return;
      }
      await app.pause();
    }
    throw unconfirmed();
  }
  try { await Promise.race([operation(), timer.promise.then(() => { expired = true; throw unconfirmed(); })]); }
  finally { expired = true; timer.cancel(); }
}

export class WorktreeModel {
  constructor({ connect, config, saveRoot, journal, open, machine = null, listAgents = async () => [], terminals = () => [] }) {
    Object.assign(this, { connect, config, saveRoot, journal, open, machine, listAgents, terminals });
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
    this.remotes = []; this.remote = null; this.fetchMessage = '';
    this.action = 'new';
    this.name = '';
    this.error = '';
    this.phase = 'loading';
    this.result = null;
    this.pending = null;
    this.journalLoaded = false;
  }
  get busy() { return ['configuring', 'fetching', 'creating', 'opening'].includes(this.phase); }
  get editable() { return !this.closed && ['editing', 'loading'].includes(this.phase); }
  get canSelectMachine() { return !this.closed && !this.busy; }
  get canCreate() { return !this.pending && this.phase === 'editing' && !!this.project && !!this.ref && (this.action === 'existing' ? !this.ref.reason : !!this.name); }
  get reusing() { return this.result ? !!this.result.request?.reuse : this.action === 'existing' && !!this.ref?.checkout; }
  get path() {
    if (this.result) return this.result.path;
    if (this.reusing) return this.ref.checkout;
    try { return this.project ? this.git.destination(this.project, this.action === 'existing' ? this.ref?.name ?? '' : this.name) : ''; }
    catch { return ''; }
  }
  resetFields() { this.refs = []; this.ref = null; this.remotes = []; this.remote = null; this.fetchMessage = ''; this.name = ''; this.error = ''; }
  async refresh(changed = () => {}) {
    if (this.busy || this.closed) return;
    const generation = ++this.generation;
    const previousLaunch = this.launch.key;
    this.project = null; this.resetFields(); this.projects = []; this.git = null; this.result = null; this.rootReady = false; this.phase = 'loading';
    changed();
    try {
      const pending = await this.journal.load();
      if (this.closed || generation !== this.generation) return;
      if (pending && !this.journalLoaded) this.machine = pending.machine ?? null;
      this.journalLoaded = true;
      this.pending = pending;
      const recovering = pending && (pending.machine ?? null) === this.machine;
      const config = recovering ? { project_root: pending.project.root } : await this.config(this.machine);
      if (this.closed || generation !== this.generation) return;
      this.root = config.project_root ?? '';
      changed();
      const programsTask = this.listAgents(this.machine).catch(() => []);
      const git = await this.connect(this.machine);
      if (this.closed || generation !== this.generation) return;
      this.git = git;
      let [contents, programs] = await Promise.all([recovering ? git.inspect(pending, { recover: true }) : this.root ? git.discover(config) : [], programsTask]);
      if (this.closed || generation !== this.generation) return;
      this.launches = launchChoices(programs);
      this.launch = this.launches.find(item => item.key === (recovering ? pending.launch?.key ?? 'shell' : previousLaunch)) ?? shellLaunch;
      changed();
      if (recovering) {
        const result = contents;
        if (!['created', 'absent'].includes(result.kind)) {
          this.result = result;
          this.rootReady = !!this.root;
          this.phase = 'partial';
          this.error = result.error || 'A previous operation was interrupted. No complete checkout was observed. Inspect Git and the recovery record before another creation.';
          return;
        }
        await this.journal.save(null);
        this.pending = null;
        if (this.closed || generation !== this.generation) return;
        contents = this.root ? await git.discover(config) : [];
        if (this.closed || generation !== this.generation) return;
      }
      this.projects = contents; this.result = null; this.rootReady = !!this.root; this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message; this.phase = 'editing';
    }
  }
  async selectMachine(machine, changed) {
    if (!this.canSelectMachine) return false;
    this.journalLoaded = true;
    if (this.machine === machine) return false;
    this.launch = shellLaunch; this.launches = [shellLaunch];
    this.machine = machine; this.root = '';
    await this.refresh(changed);
    return true;
  }
  async configureRoot(root, changed = () => {}) {
    if (!this.editable || !this.git) return;
    this.generation++;
    this.phase = 'configuring'; this.error = '';
    changed();
    try {
      const canonical = await this.git.validateRoot({ project_root: root });
      await this.saveRoot(this.machine, canonical);
      this.phase = 'editing';
      const pending = this.refresh(changed), generation = this.generation;
      await pending;
      return !this.closed && generation === this.generation && this.rootReady && !this.error;
    } catch (error) { this.error = error.message; this.phase = 'editing'; return false; }
  }
  async selectProject(project) {
    if (!this.editable) return;
    const generation = ++this.generation;
    this.project = project; this.resetFields(); this.phase = 'loading';
    try {
      const [refs, remotes] = await Promise.all([this.git.choices(project), this.git.remotes(project)]);
      if (this.closed || generation !== this.generation) return;
      this.refs = refs; this.remotes = remotes; this.remote = remotes.find(row => row.name === 'origin') ?? remotes[0] ?? null; this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message; this.phase = 'editing';
    }
  }
  selectRemote(remote) {
    if (this.closed || this.phase !== 'editing') return;
    const selected = this.remotes.find(row => row.name === remote.name);
    if (selected) { this.remote = selected; this.error = ''; this.fetchMessage = ''; }
  }
  async fetchRemote(changed = () => {}) {
    if (this.closed || this.phase !== 'editing' || !this.project || !this.remote) return;
    const generation = ++this.generation, project = this.project, remote = this.remote, selected = this.ref;
    const current = () => !this.closed && generation === this.generation;
    this.phase = 'fetching'; this.error = ''; this.fetchMessage = ''; changed();
    try {
      const refs = await this.git.fetch(project, remote.name);
      if (!current()) return;
      this.refs = refs; this.ref = selected ? refs.find(row => row.ref === selected.ref) ?? null : null;
      this.error = ''; this.fetchMessage = `Fetched ${remote.label}. Branches updated.`;
    } catch (error) { if (current()) this.error = error.message; }
    finally { if (current()) { this.phase = 'editing'; changed(); } }
  }
  setAction(action) {
    if (!this.editable || this.action === action) return false;
    this.action = action; this.name = ''; this.error = '';
    return true;
  }
  setName(name) { if (this.editable) { this.name = name; this.error = ''; } }
  selectRef(ref) { if (this.editable && (this.action === 'new' || !ref.reason)) { this.ref = ref; this.error = ''; } }
  selectLaunch(launch) {
    if (this.closed || !['editing', 'recover'].includes(this.phase)) return;
    const selected = this.launches.find(item => item.key === launch.key);
    if (selected) this.launch = selected;
  }
  close() {
    if (this.busy) { this.error = 'The operation is finishing. This window stays open until the outcome is known.'; return false; }
    this.closed = true; this.generation++; return true;
  }
  async submit(open = this.open) {
    if (!this.canCreate || this.closed) return;
    this.phase = 'creating'; this.error = '';
    let saved = false;
    try {
      const request = await this.git.prepare({ project: this.project, action: this.action, ref: this.ref.ref, name: this.name, checkout: this.action === 'existing' ? this.ref.checkout : null });
      request.launch = this.launch;
      request.attempt = randomUUID();
      await this.journal.save(request);
      this.pending = request;
      saved = true;
      this.result = await this.git.create(request);
      if (this.result.kind === 'created') { await this.openCreated(open); return; }
      this.error = this.result.error;
      if (this.result.kind === 'absent') { await this.journal.save(null); this.pending = null; this.result = null; this.phase = 'editing'; }
      else this.phase = 'partial';
    } catch (e) {
      this.error = e.message;
      this.phase = saved ? 'partial' : 'editing';
    }
  }
  async openCreated(open = this.open) {
    if (this.closed || !this.result || this.result.kind !== 'created' || this.phase === 'opening') return;
    this.phase = 'opening'; this.error = '';
    try {
      const result = await this.git.inspect(this.result.request, { recover: true });
      if (result.kind !== 'created') { this.result = result; this.phase = 'partial'; this.error = result.error || 'Checkout changed. Inspect Git before opening.'; return; }
      if (this.pending) { await this.journal.save(null); this.pending = null; }
      const request = { ...result.request, launch: this.launch };
      const firstOpening = request.reuse && !Array.isArray(request.previousTerminals);
      // An in-window retry must distinguish this attempt's terminal from older tabs.
      if (firstOpening) request.previousTerminals = this.terminals();
      this.result = { ...result, request };
      await open(request);
      this.phase = 'complete';
    } catch (e) { this.error = e.message; this.phase = 'recover'; }
  }
}
