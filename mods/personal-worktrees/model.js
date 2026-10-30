export async function openCheckout(request, git, app) {
  const target = await git.identity(request.path);
  if (target.id !== request.project.id) throw new Error('Created checkout identity changed; inspect Git.');
  const deadline = app.now() + 10000;
  async function match() {
    const { spaces, panes } = app.snapshot();
    for (const space of spaces.filter(s => !s.machine)) {
      const tabs = new Set(space.tabs.map(t => t.id));
      for (const pane of panes.filter(p => tabs.has(p.tab) && p.terminal && p.cwd && p.program?.shell)) {
        let identity;
        try { identity = await git.identity(pane.cwd); } catch { continue; }
        if (identity.id === target.id && identity.top === target.top) return { space, pane };
      }
    }
    return null;
  }
  let found = await match();
  if (!found) app.run('space.new', { folder: request.path });
  let selected = '';
  while (app.now() < deadline) {
    found = await match();
    if (found) {
      const { space, pane } = found;
      if (selected !== pane.pane) {
        app.run('space.select', { id: space.id });
        app.run('tab.select', { id: pane.tab });
        app.run('pane.focus', { pane: pane.pane });
        selected = pane.pane;
      }
      const current = app.snapshot();
      if (current.spaces.some(s => s.id === space.id && s.active) && current.panes.some(p => p.pane === pane.pane && p.focused && p.cwd === pane.cwd && p.program?.shell)) return;
    }
    await app.pause();
  }
  throw new Error(`Opening unconfirmed after 10 seconds. Checkout preserved at ${request.path}. Retry Open created worktree.`);
}

export class WorktreeModel {
  constructor({ git, config, journal, open, changed = () => {} }) {
    Object.assign(this, { git, config, journal, open, changed });
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
  update() { if (!this.closed) this.changed(); }
  resetFields() { this.refs = []; this.ref = null; this.name = ''; this.error = ''; }
  async refresh() {
    if (this.busy || this.closed) return;
    const generation = ++this.generation;
    this.project = null; this.resetFields(); this.projects = []; this.phase = 'loading'; this.update();
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
    } finally { if (generation === this.generation) this.update(); }
  }
  async selectProject(project) {
    if (!this.editable) return;
    const generation = ++this.generation;
    this.project = project; this.resetFields(); this.phase = 'loading'; this.update();
    try {
      const refs = await this.git.choices(project);
      if (this.closed || generation !== this.generation) return;
      this.refs = refs; this.phase = 'editing';
    } catch (e) {
      if (this.closed || generation !== this.generation) return;
      this.error = e.message; this.phase = 'editing';
    } finally { if (generation === this.generation) this.update(); }
  }
  setAction(action) {
    if (!this.editable || this.action === action) return;
    this.action = action; this.ref = null; this.name = ''; this.error = ''; this.update();
  }
  setName(name) { if (this.editable) { this.name = name; this.error = ''; this.update(); } }
  selectRef(ref) { if (this.editable && (this.action === 'new' || !ref.reason)) { this.ref = ref; this.error = ''; this.update(); } }
  close() {
    if (this.busy) { this.error = 'The operation is finishing. This window stays open until the outcome is known.'; this.update(); return false; }
    this.closed = true; this.generation++; return true;
  }
  async submit() {
    if (!this.canCreate || this.closed) return;
    this.phase = 'creating'; this.error = ''; this.update();
    let saved = false;
    try {
      const request = await this.git.prepare({ project: this.project, action: this.action, ref: this.ref.ref, name: this.name });
      await this.journal.save(request);
      saved = true;
      this.result = await this.git.create(request);
      if (this.result.kind === 'created') { await this.openCreated(); return; }
      this.error = this.result.error;
      if (this.result.kind === 'absent') { await this.journal.save(null); this.result = null; this.phase = 'editing'; }
      else this.phase = 'partial';
    } catch (e) {
      this.error = e.message;
      // If creation was interrupted after saving the intent, Refresh must inspect it.
      this.phase = saved ? 'partial' : 'editing';
    }
    this.update();
  }
  async openCreated() {
    if (this.closed || !this.result || this.result.kind !== 'created' || this.phase === 'opening') return;
    this.phase = 'opening'; this.error = ''; this.update();
    try {
      const result = await this.git.inspect(this.result.request);
      if (result.kind !== 'created') { this.result = result; this.phase = 'partial'; this.error = result.error || 'Created checkout changed. Inspect Git before opening.'; return; }
      await this.open(result.request);
      await this.journal.save(null);
      this.phase = 'complete';
    } catch (e) { this.error = e.message; this.phase = 'recover'; }
    finally { this.update(); }
  }
}
