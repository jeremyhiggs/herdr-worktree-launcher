export async function openCheckout(request, git, app) {
  const deadline = app.now() + 10000;
  let expired = false;
  const unconfirmed = () => new Error(`Opening unconfirmed after 10 seconds. Checkout preserved at ${request.path}. Retry Open created worktree.`);
  const check = () => { if (expired || app.now() >= deadline) throw unconfirmed(); };
  const send = (command, args) => { check(); app.run(command, args); };
  const timer = app.timeout(10000);
  async function operation() {
    const target = await git.identity(request.path);
    check();
    if (target.id !== request.project.id) throw new Error('Created checkout identity changed; inspect Git.');
    async function match() {
      const { spaces, panes } = app.snapshot();
      for (const space of spaces.filter(s => !s.machine)) {
        const tabs = new Set(space.tabs.map(t => t.id));
        for (const pane of panes.filter(p => tabs.has(p.tab) && p.terminal && p.cwd && p.program?.shell)) {
          check();
          let identity;
          try { identity = await git.identity(pane.cwd); } catch { check(); continue; }
          check();
          if (identity.id === target.id && identity.top === target.top) return { space, pane };
        }
      }
      return null;
    }
    let found = await match();
    if (!found) send('space.new', { folder: request.path });
    let selected = '';
    while (app.now() < deadline) {
      check();
      found = await match();
      if (found) {
        const { space, pane } = found;
        if (selected !== pane.pane) {
          send('space.select', { id: space.id });
          send('tab.select', { id: pane.tab });
          send('pane.focus', { pane: pane.pane });
          selected = pane.pane;
        }
        const current = app.snapshot();
        if (current.spaces.some(s => s.id === space.id && s.active) && current.panes.some(p => p.pane === pane.pane && p.focused && p.cwd === pane.cwd && p.program?.shell)) return;
      }
      await app.pause();
    }
    throw unconfirmed();
  }
  try { await Promise.race([operation(), timer.promise.then(() => { expired = true; throw unconfirmed(); })]); }
  finally { expired = true; timer.cancel(); }
}

export class WorktreeModel {
  constructor({ git, config, journal, open }) {
    Object.assign(this, { git, config, journal, open });
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
  get busy() { return ['creating', 'opening'].includes(this.phase); }
  get editable() { return !this.closed && ['editing', 'loading'].includes(this.phase); }
  get canCreate() { return this.phase === 'editing' && !!this.project && !!this.ref && (this.action === 'existing' ? !this.ref.reason : !!this.name); }
  get path() {
    if (this.result) return this.result.path;
    try { return this.project ? this.git.destination(this.project, this.action === 'existing' ? this.ref?.name ?? '' : this.name) : ''; }
    catch { return ''; }
  }
  resetFields() { this.refs = []; this.ref = null; this.name = ''; this.error = ''; }
  async refresh() {
    if (this.busy || this.closed) return;
    const generation = ++this.generation;
    this.project = null; this.resetFields(); this.projects = []; this.phase = 'loading';
    try {
      const pending = await this.journal.load();
      if (pending) {
        const result = await this.git.inspect(pending);
        if (this.closed || generation !== this.generation) return;
        this.result = result;
        this.phase = result.kind === 'created' ? 'recover' : 'partial';
        this.error = result.error || (result.kind === 'created' ? 'A previous operation created this checkout. Open it without running creation again.' : 'A previous operation was interrupted. No complete checkout was observed. Inspect Git and the recovery record before another creation.');
        return;
      }
      const projects = await this.git.discover(await this.config());
      if (this.closed || generation !== this.generation) return;
      this.projects = projects; this.result = null; this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message; this.phase = 'editing';
    }
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
    this.action = action; this.ref = null; this.name = ''; this.error = '';
    return true;
  }
  setName(name) { if (this.editable) { this.name = name; this.error = ''; } }
  selectRef(ref) { if (this.editable && (this.action === 'new' || !ref.reason)) { this.ref = ref; this.error = ''; } }
  close() {
    if (this.busy) { this.error = 'The operation is finishing. This window stays open until the outcome is known.'; return false; }
    this.closed = true; this.generation++; return true;
  }
  async submit(open = this.open) {
    if (!this.canCreate || this.closed) return;
    this.phase = 'creating'; this.error = '';
    let saved = false;
    try {
      const request = await this.git.prepare({ project: this.project, action: this.action, ref: this.ref.ref, name: this.name });
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
      if (result.kind !== 'created') { this.result = result; this.phase = 'partial'; this.error = result.error || 'Created checkout changed. Inspect Git before opening.'; return; }
      await open(result.request);
      await this.journal.save(null);
      this.phase = 'complete';
    } catch (e) { this.error = e.message; this.phase = 'recover'; }
  }
}
