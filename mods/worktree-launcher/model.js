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
    async function match(identity, selectedProgram) {
      const { spaces, panes } = app.snapshot();
      const local = spaces.filter(s => (s.machine ?? null) === machine);
      // Check the likely space first, then verify its live checkout like every other candidate.
      local.sort((a, b) => Number(b.folder === identity.top) - Number(a.folder === identity.top));
      for (const space of local) {
        const tabs = new Set(space.tabs.map(t => t.id));
        const candidates = panes.filter(p => tabs.has(p.tab) && p.terminal && p.cwd);
        const locations = selectedProgram ? candidates.filter(pane => acceptsProgram(pane) && !previousTerminals.has(pane.terminal)) : [...candidates, ...(space.folder ? [{ cwd: space.folder }] : [])];
        for (const pane of locations) {
          check();
          let current;
          try { current = await git.identity(pane.cwd); } catch { check(); continue; }
          check();
          if (current.id === identity.id && current.top === identity.top) return { space, pane };
        }
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
    this.action = 'new';
    this.name = '';
    this.error = '';
    this.phase = 'loading';
    this.result = null;
  }
  get busy() { return ['configuring', 'creating', 'opening'].includes(this.phase); }
  get editable() { return !this.closed && ['editing', 'loading'].includes(this.phase); }
  get canCreate() { return this.phase === 'editing' && !!this.project && !!this.ref && (this.action === 'existing' ? !this.ref.reason : !!this.name); }
  get reusing() { return this.result ? !!this.result.request?.reuse : this.action === 'existing' && !!this.ref?.checkout; }
  get path() {
    if (this.result) return this.result.path;
    if (this.reusing) return this.ref.checkout;
    try { return this.project ? this.git.destination(this.project, this.action === 'existing' ? this.ref?.name ?? '' : this.name) : ''; }
    catch { return ''; }
  }
  resetFields() { this.refs = []; this.ref = null; this.name = ''; this.error = ''; }
  async refresh(changed = () => {}) {
    if (this.busy || this.closed) return;
    const generation = ++this.generation;
    const previousLaunch = this.launch.key;
    this.project = null; this.resetFields(); this.projects = []; this.git = null; this.result = null; this.rootReady = false; this.phase = 'loading';
    changed();
    try {
      const pending = await this.journal.load();
      if (this.closed || generation !== this.generation) return;
      if (pending) this.machine = pending.machine ?? null;
      const config = pending ? { project_root: pending.project.root } : await this.config(this.machine);
      if (this.closed || generation !== this.generation) return;
      this.root = config.project_root ?? '';
      changed();
      const programsTask = this.listAgents(this.machine).catch(() => []);
      const git = await this.connect(this.machine);
      if (this.closed || generation !== this.generation) return;
      this.git = git;
      const [contents, programs] = await Promise.all([pending ? git.inspect(pending) : this.root ? git.discover(config) : [], programsTask]);
      if (this.closed || generation !== this.generation) return;
      this.launches = launchChoices(programs);
      this.launch = this.launches.find(item => item.key === (pending ? pending.launch?.key ?? 'shell' : previousLaunch)) ?? shellLaunch;
      changed();
      if (pending) {
        const result = contents;
        this.result = result;
        this.rootReady = !!this.root;
        this.phase = result.kind === 'created' ? 'recover' : 'partial';
        this.error = result.error || (result.kind === 'created' ? pending.reuse ? 'A previous operation targeted this existing checkout. Open it without changing Git.' : 'A previous operation created this checkout. Open it without running creation again.' : 'A previous operation was interrupted. No complete checkout was observed. Inspect Git and the recovery record before another creation.');
        return;
      }
      this.projects = contents; this.result = null; this.rootReady = !!this.root; this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message; this.phase = 'editing';
    }
  }
  async selectMachine(machine, changed) {
    if (!this.editable || this.machine === machine) return false;
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
      const refs = await this.git.choices(project);
      if (this.closed || generation !== this.generation) return;
      this.refs = refs; this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message; this.phase = 'editing';
    }
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
      await this.journal.save(request);
      saved = true;
      this.result = await this.git.create(request);
      if (this.result.kind === 'created') { await this.openCreated(open); return; }
      this.error = this.result.error;
      if (this.result.kind === 'absent') { await this.journal.save(null); this.result = null; this.phase = 'editing'; }
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
      const result = await this.git.inspect(this.result.request);
      if (result.kind !== 'created') { this.result = result; this.phase = 'partial'; this.error = result.error || 'Checkout changed. Inspect Git before opening.'; return; }
      const request = { ...result.request, launch: this.launch };
      const firstOpening = request.reuse && !Array.isArray(request.previousTerminals);
      // Recovery must distinguish this attempt's terminal from tabs that were already running.
      if (firstOpening) request.previousTerminals = this.terminals();
      if (firstOpening || JSON.stringify(result.request.launch ?? shellLaunch) !== JSON.stringify(this.launch)) {
        await this.journal.save(request); this.result = { ...result, request };
      }
      await open(request);
      await this.journal.save(null);
      this.phase = 'complete';
    } catch (e) { this.error = e.message; this.phase = 'recover'; }
  }
}
