import { View, div } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input, Button, Popup, v_virtual_list, VirtualListScrollHandle, Scrollbar, TextView } from 'gpui-base';
import { exec, home, appHome, readTextFile, writeTextFile, spaces, panes, machines, knownAgents, pickFolder, run, theme, props, closeOverlay } from 'herdr';
import { connectGit } from './git.js';
import { createConfigStore } from './config.js';
import { WorktreeModel, openCheckout } from './model.js';

function selectableText(id, text) {
  const escaped = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replaceAll('\n', '<br>');
  return TextView.html(id, escaped).selectable(true).scrollable(false);
}

export default class WorktreeLauncher extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.field = 'project';
    this.openField = null;
    this.activeInput = null;
    this.index = 0;
    this.filters = { machine: '', project: '', ref: '', launch: '' };
    this.directoryEntries = [];
    this.directoryGeneration = 0;
    this.rootRevision = 0;
    this.rootDraft = false;
    this.savingRoot = false;
    this.inputs = {};
    this.buttons = {};
    for (const key of ['new', 'existing', 'refresh', 'close', 'create', 'open-created', 'save-root', 'browse-root']) this.buttons[key] = cx.focus_handle();
    for (const [field, placeholder] of [['machine', 'Search machines'], ['root', 'Absolute project directory on this machine'], ['project', 'Search projects'], ['name', 'New branch name'], ['ref', 'Search local and fetched remote branches'], ['launch', 'Shell or installed agent']]) {
      const input = InputState.new({ placeholder });
      this.inputs[field] = input;
      input.on('change', (_e, cx) => {
        if (this.syncing) return;
        if (field === 'name') this.model.setName(input.value());
        else if (field === 'root') { this.openField = null; this.rootRevision++; this.rootDraft = true; }
        else { this.field = field; this.openField = field; this.filters[field] = input.value(); this.index = 0; this.scroll.scroll_to_item(0); }
        cx.notify();
      });
      input.on('focus', (_e, cx) => { this.activeInput = field; this.openField = field === 'root' && this.openField === 'directory' ? 'directory' : ['name', 'root'].includes(field) ? null : field; if (!['name', 'root'].includes(field)) this.field = field; this.index = 0; cx.notify(); });
      input.on('blur', (_e, cx) => { if (this.activeInput === field) this.activeInput = null; cx.notify(); });
      input.on('submit', (event, cx) => this.submitInput(field, event, cx));
    }
    const config = createConfigStore(readTextFile, writeTextFile, `${appHome()}/data/worktree-launcher-config.json`, `${appHome()}/mods/worktree-launcher/config.json`);
    const recordPath = `${appHome()}/data/worktree-launcher-operation.json`;
    let snapshot = null;
    this.model = new WorktreeModel({
      machine: spaces().find(s => s.active)?.machine ?? null,
      connect: machine => connectGit(exec, home(), machine),
      listAgents: machine => knownAgents({ on: machine }),
      terminals: () => panes().map(pane => pane.terminal).filter(Boolean),
      config: machine => config.get(machine),
      saveRoot: (machine, root) => config.set(machine, root),
      journal: {
        load: async () => {
          snapshot = await readTextFile(recordPath);
          try { return snapshot ? JSON.parse(snapshot) : null; }
          catch { throw new Error('Recovery record is unreadable. Inspect data/worktree-launcher-operation.json before creating another worktree.'); }
        },
        save: async request => {
          const next = JSON.stringify(request);
          await writeTextFile(recordPath, next, snapshot);
          snapshot = next;
        },
      },
    });
    this.showChoice('machine', this.model.machine ?? 'Local');
    this.task(cx, async (_open, changed) => {
      const pending = this.model.refresh(changed), generation = this.model.generation;
      await pending;
      if (this.model.closed || generation !== this.model.generation) return;
      this.syncContext();
      (this.model.git ? this.model.rootReady ? this.inputs.project : this.inputs.root : this.inputs.machine).focus();
    });
  }

  task(cx, work) {
    cx.spawn(async cx => {
      // This adapter belongs to this task; no callback retains its context afterwards.
      const open = request => openCheckout(request, this.model.git, {
        snapshot: () => ({ spaces: spaces(), panes: panes() }), run, now: () => Date.now(),
        pause: () => new Promise(resolve => cx.timer.after(250, () => resolve())),
        timeout: ms => {
          let task;
          const promise = new Promise(resolve => { task = cx.timer.after(ms, () => resolve()); });
          return { promise, cancel: () => task.cancel() };
        },
      });
      try {
        const changed = () => { if (!this.model.closed) { this.syncContext(); cx.notify(); } };
        const pending = work(open, changed); if (this.model.busy) this.openField = null; cx.notify(); await pending;
        this.syncContext();
        if (this.model.phase === 'complete') closeOverlay(props().overlay);
        else cx.notify();
      } catch (e) { this.model.error = String(e); cx.notify(); }
    });
  }

  syncContext() {
    const m = this.model;
    if (this.syncedLaunch !== m.launch) {
      this.showChoice('launch', m.launch.label); this.syncedLaunch = m.launch;
    }
    if (this.syncedMachine !== m.machine || this.syncedRoot !== m.root) {
      const changeMachine = this.syncedMachine !== m.machine;
      this.syncing = true;
      try {
        if (changeMachine || !this.rootDraft) { this.inputs.root.set_value(m.root); this.rootDraft = false; this.rootRevision++; }
        this.inputs.machine.set_value(m.machine ?? 'Local');
      }
      finally { this.syncing = false; }
      this.filters.machine = '';
      this.syncedMachine = m.machine; this.syncedRoot = m.root;
    }
  }

  saveRoot(cx) {
    if (this.model.phase !== 'editing' || !this.model.git || this.savingRoot) return;
    this.openField = null;
    this.task(cx, (_open, changed) => this.configureRoot(this.inputs.root.value(), changed));
  }

  async configureRoot(root, changed) {
    if (this.savingRoot) return;
    const m = this.model, revision = this.rootRevision;
    this.savingRoot = true;
    try {
      const saved = await m.configureRoot(root, changed);
      if (saved && !m.closed && revision === this.rootRevision) { this.showChoice('root', m.root); this.inputs.project.focus(); }
    } finally { this.savingRoot = false; }
  }

  browseRoot(cx, path) {
    const m = this.model;
    if (!m.editable || !m.git || !m.machine) return;
    const git = m.git, generation = m.generation, machine = m.machine, request = ++this.directoryGeneration;
    const current = () => !m.closed && m.editable && m.generation === generation && m.machine === machine && this.directoryGeneration === request && this.openField === 'directory';
    this.directoryLoading = true; this.directoryError = ''; this.directoryEntries = [];
    this.field = 'directory'; this.openField = 'directory'; this.index = 0;
    this.scroll.scroll_to_item(0); this.inputs.root.focus();
    const typed = path ?? this.inputs.root.value();
    this.task(cx, async () => {
      try {
        const result = await git.directories(typed.startsWith('/') ? typed : git.userHome);
        if (!current()) return;
        this.directoryEntries = result.entries;
        this.showChoice('root', result.path);
      } catch (error) { if (current()) this.directoryError = error.message; }
      finally { if (current()) this.directoryLoading = false; }
    });
  }

  clearInputs() {
    this.syncing = true;
    try { this.inputs.name.set_value(''); this.inputs.ref.set_value(''); this.filters.ref = ''; }
    finally { this.syncing = false; }
    this.index = 0;
  }

  rows(field = this.field) {
    const source = field === 'machine'
      ? [{ id: 'null', name: null, label: 'Local', reason: 'This computer' }, ...machines().filter(m => m.name).map(m => ({ id: JSON.stringify(m.name), name: m.name, label: m.name, reason: m.layout === 'ready' ? '' : m.layout === 'loading' ? 'Connecting…' : 'Unavailable' }))]
      : field === 'directory' ? this.directoryEntries : field === 'launch' ? this.model.launches : field === 'project' ? this.model.projects : this.model.refs;
    const filter = (this.filters[field] ?? '').toLowerCase();
    return source.filter(row => `${row.label} ${row.reason ?? ''}`.toLowerCase().includes(filter));
  }

  emptyMessage(field) {
    const m = this.model;
    if (field === 'directory') return this.directoryLoading ? 'Loading directories…' : this.directoryError || 'No subdirectories. Save selects this folder.';
    if (field === 'launch') return 'No matching installed agents';
    if (field === 'machine') return 'No matching machines';
    if (m.phase === 'loading') return 'Loading…';
    if (field !== 'project') return m.project ? 'No matching branches' : 'Select a project first';
    if (m.error) return 'Fix the configuration, then Refresh.';
    return !m.root ? 'Set a project root for this machine first' : m.projects.length ? 'No matching projects' : 'No projects found';
  }

  choose(row, cx, field = this.field) {
    if (!row || (!this.model.editable && !(field === 'launch' && this.model.phase === 'recover')) || this.savingRoot) return;
    if (field === 'launch' && !['editing', 'recover'].includes(this.model.phase)) return;
    if (field === 'directory') this.browseRoot(cx, row.path);
    else if (field === 'launch') {
      this.model.selectLaunch(row); this.showChoice('launch', this.model.launch.label); this.syncedLaunch = this.model.launch;
      this.openField = null; this.buttons[this.model.phase === 'recover' ? 'open-created' : 'create'].focus(); cx.notify();
    }
    else if (field === 'machine') {
      if (row.name !== this.model.machine) {
        this.clearInputs(); this.inputs.project.set_value(''); this.filters.project = '';
      }
      this.showChoice('machine', row.label); this.openField = null;
      this.task(cx, async (_open, changed) => {
        const pending = this.model.selectMachine(row.name, changed), generation = this.model.generation;
        await pending;
        if (this.model.closed || generation !== this.model.generation) return;
        this.syncContext();
        if (this.model.git) (this.model.rootReady ? this.inputs.project : this.inputs.root).focus();
      });
    } else if (field === 'project') {
      this.clearInputs();
      this.showChoice('project', row.label);
      this.openField = null;
      this.task(cx, async () => {
        const pending = this.model.selectProject(row), generation = this.model.generation;
        await pending;
        if (!this.model.closed && generation === this.model.generation && this.model.project?.id === row.id && this.model.phase === 'editing') this.buttons[this.model.action].focus();
      });
    } else {
      if (this.model.action === 'existing' && row.reason) return;
      this.model.selectRef(row);
      this.showChoice('ref', row.label);
      this.openField = null;
      if (this.model.action === 'new') this.inputs.name.focus();
      else this.buttons.create.focus();
      cx.notify();
    }
  }

  showChoice(field, value) {
    this.syncing = true;
    try { this.inputs[field].set_value(value); this.filters[field] = ''; }
    finally { this.syncing = false; }
    if (field === 'root') { this.rootRevision++; this.rootDraft = value !== this.model.root; }
  }

  dismiss() { if (!this.savingRoot && this.model.close()) closeOverlay(props().overlay); }
  close() { this.model.closed = true; this.model.generation++; }

  keyUp(event, cx) {
    if (event.key === 'escape') this.key(event, cx);
  }

  submitInput(field, event, cx) {
    if (this.savingRoot || this.model.busy) return;
    if (field === 'root') {
      if (!event.secondary && this.openField === 'directory' && this.directoryEntries.length) this.choose(this.directoryEntries[this.index], cx, 'directory');
      else this.saveRoot(cx);
    } else if (!event.secondary && field !== 'name' && this.openField === field) this.choose(this.rows(field)[this.index], cx, field);
    else if (this.model.canCreate) this.task(cx, open => this.model.submit(open));
  }

  key(event, cx) {
    if (this.savingRoot) { cx.stop_propagation(); return; }
    if (event.key === 'tab') {
      const rootFields = ['root', 'save-root', 'browse-root'];
      const order = ['machine', ...rootFields, 'project', 'new', 'existing', ...(this.model.project ? ['ref'] : []), ...(this.model.action === 'new' && this.model.ref ? ['name'] : []), 'launch', 'refresh', 'close', this.model.phase === 'recover' ? 'open-created' : 'create'];
      const current = this.activeInput || order.find(key => this.buttons[key]?.is_focused());
      const step = event.modifiers.shift ? -1 : 1;
      const next = order[(Math.max(0, order.indexOf(current)) + step + order.length) % order.length];
      this.openField = null; (this.inputs[next] || this.buttons[next]).focus();
      cx.stop_propagation(); cx.notify();
    }
    else if (event.key === 'escape') { cx.stop_propagation(); this.dismiss(); cx.notify(); }
    else if (event.keystroke === 'cmd-enter') { cx.stop_propagation(); if (this.activeInput === 'root') this.saveRoot(cx); else this.task(cx, open => this.model.submit(open)); }
    else if (event.key === 'enter' && this.model.canCreate && !this.openField && this.activeInput !== 'root') { cx.stop_propagation(); this.task(cx, open => this.model.submit(open)); }
    else if (['up', 'down'].includes(event.key) && (['machine', 'project', 'ref', 'launch'].includes(this.activeInput) || this.activeInput === 'root' && this.openField === 'directory')) {
      this.field = this.activeInput === 'root' ? 'directory' : this.activeInput; this.openField = this.field;
      const count = this.rows().length;
      if (count) { this.index = (this.index + (event.key === 'down' ? 1 : count - 1)) % count; this.scroll.scroll_to_item(this.index, 'center'); }
      cx.stop_propagation(); cx.notify();
    }
  }

  choiceList(field, t) {
    const rows = this.rows(field), m = this.model, isProject = field === 'project', isMachine = field === 'machine', isDirectory = field === 'directory', isLaunch = field === 'launch';
    const key = row => isDirectory ? row.path : isLaunch ? row.key : isProject || isMachine ? row.id : row.ref;
    const height = Math.min(220, Math.max(44, rows.length * 44));
    const content = v_flex().w(Math.max(240, (this.width ?? 700) - 36)).h(height).bg(t.popover).border_1().border_color(t.border).rounded(6)
      .on_mouse_down_out((_e, cx) => { if (this.openField === field) { this.openField = null; cx.notify(); } });
    if (!rows.length) return content.child(div().p(10).text_color(t.muted).child(this.emptyMessage(field)));
    return content.child(div().relative().size_full()
      .child(v_virtual_list(`worktree-${field}-choices`, rows.length, 44, i => key(rows[i]), range => rows.slice(range.start, range.end).map((row, offset) => {
        const unavailable = field === 'ref' && m.action === 'existing' && !!row.reason;
        const chosen = isDirectory ? false : isLaunch ? m.launch.key === row.key : isMachine ? m.machine === row.name : isProject ? m.project?.id === row.id : m.ref?.ref === row.ref;
        return v_flex().h(44).px(10).justify_center().rounded(5)
          .bg(range.start + offset === this.index ? t.selected : t.popover)
          .text_color(unavailable ? t.dim : t.foreground)
          .child(div().truncate().child(`${chosen ? '✓ ' : ''}${row.label}`))
          .child(div().truncate().text_size(10.5).text_color(t.muted).child(isLaunch ? row.key === 'shell' ? 'Default shell' : `Installed on ${m.machine ?? 'this computer'}` : isMachine ? row.reason : isProject || isDirectory ? row.path : row.reason || (row.checkout ? `${m.action === 'existing' ? 'Open existing worktree at' : 'Checked out at'} ${row.checkout}` : row.ref)));
      })).size_full().track_scroll(this.scroll).on_item_click((value, cx) => {
        if (this.openField === field) this.choose(this.rows(field).find(row => key(row) === value), cx, field);
      }))
      .child(Scrollbar.vertical(`worktree-${field}-choices`).absolute().inset_0()));
  }

  render() {
    const t = theme(), m = this.model;
    const button = (id, text, action, disabled = false, selected = false, tab = 0) => {
      disabled = disabled || !!this.savingRoot;
      return Button.new(id)
      .track_focus(this.buttons[id]).tab_index(tab).disabled(disabled).h(32).px(12).rounded(6).border_1()
      .border_color(selected ? t.accent : t.border).bg(selected ? t.selected : t.raised)
      .text_color(disabled ? t.dim : t.foreground).focus(s => s.border_color(t.accent))
      .on_click(action).child(text);
    };
    const label = text => div().text_size(11).text_color(t.muted).child(text);
    const editable = field => field === 'launch' ? !m.closed && ['editing', 'recover'].includes(m.phase) : m.editable;
    const input = field => Input.new(this.inputs[field]).disabled(this.savingRoot || !editable(field) || field === 'root' && !m.git || field === 'ref' && !m.project || field === 'name' && !m.ref)
      .accessibility_label(field === 'ref' ? m.action === 'new' ? 'Base branch' : 'Existing branch' : field === 'launch' ? 'Open with' : field === 'name' ? 'New branch name' : field === 'root' ? 'Project root' : field === 'machine' ? 'Machine' : 'Project')
      .h(34).px(10).rounded(6).border_1().border_color(this.activeInput === field ? t.accent : t.border)
      .bg(t.input).text_color(t.foreground);
    const picker = field => Popup.new(`worktree-${field}-picker`, div().w_full().on_click((_e, cx) => { if (this.savingRoot || !editable(field)) return; this.field = field; this.openField = field; cx.notify(); }).child(input(field)))
      .w_full().anchor('top_left').when(this.openField === field && editable(field) && !this.savingRoot, el => el.content(this.choiceList(field, t)));
    return v_flex().id('worktree-launcher').track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_key_up((e, cx) => this.keyUp(e, cx))
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
      .size_full().p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(17).font_semibold().child('Worktree Launcher'))
        .child(button('refresh', 'Refresh', (_e, cx) => { this.clearInputs(); this.inputs.project.set_value(''); this.filters.project = ''; this.field = 'project'; this.task(cx, (_open, changed) => m.refresh(changed)); }, m.busy, false, 5)))
      .child(label('Machine'))
      .child(picker('machine'))
      .child(label('Project root'))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).child(Popup.new('root-directory-picker', input('root')).w_full().anchor('top_left')
          .when(this.openField === 'directory' && m.editable, el => el.content(this.choiceList('directory', t)))))
          .child(button('save-root', this.savingRoot ? 'Saving…' : 'Save', (_e, cx) => this.saveRoot(cx), m.phase !== 'editing' || !m.git))
          .child(button('browse-root', 'Browse…', (_e, cx) => {
            if (m.machine) { this.browseRoot(cx); return; }
            this.task(cx, async (_open, changed) => {
              const generation = m.generation;
              const path = await pickFolder({ prompt: 'Choose project root' });
              if (path && !m.closed && !m.machine && m.generation === generation) { this.showChoice('root', path); await this.configureRoot(path, changed); }
            });
          }, !m.editable || !m.git)))
      .child(label('Project'))
      .child(picker('project'))
      .child(h_flex().gap(8).children(['new', 'existing'].map((action, i) => button(action, action === 'new' ? 'New branch' : 'Existing branch', (_e, cx) => { if (m.setAction(action)) this.inputs.name.set_value(''); this.openField = null; if (m.project) this.inputs.ref.focus(); cx.notify(); }, !m.editable, m.action === action, i + 1))))
      .child(label(m.action === 'new' ? 'Base branch' : 'Branch'))
      .child(picker('ref'))
      .when(m.action === 'existing' && Boolean(m.ref?.reason), el => el.child(selectableText('checkout-reason', m.ref.reason).text_size(11).text_color(t.blocked)))
      .when(m.action === 'new', el => el.child(label('New branch name')).child(input('name')))
      .child(div().flex_1())
      .child(label(m.reusing ? 'Existing worktree' : 'Destination'))
      .child(selectableText('destination', m.path || 'Select a project and branch to preview the destination.').text_size(11).text_color(t.foreground))
      .child(label('Open with'))
      .child(picker('launch'))
      .when(Boolean(m.error), el => el.child(div().max_h(100).overflow_y_scrollbar().child(selectableText('operation-error', m.error).text_color(t.blocked))))
      .when(m.phase === 'partial', el => el.child(selectableText('recovery-instructions', 'Creation is blocked until this operation is inspected. See recovery instructions in the README.').text_size(11).text_color(t.muted)))
      .child(h_flex().gap(8).justify_end()
        .child(button('close', 'Close', (_e, cx) => { this.dismiss(); cx.notify(); }, m.busy, false, 6))
        .when(m.phase === 'recover', el => el.child(button('open-created', m.reusing ? 'Open worktree' : 'Open created worktree', (_e, cx) => this.task(cx, open => m.openCreated(open)), false, true, 7)))
        .when(m.phase !== 'recover', el => el.child(button('create', ['creating', 'opening'].includes(m.phase) ? 'Finishing…' : m.reusing ? 'Open worktree' : 'Create', (_e, cx) => this.task(cx, open => m.submit(open)), !m.canCreate, true, 7))))
      .child(div().text_size(10.5).text_color(t.dim).child(this.activeInput === 'root' ? '↑↓ choose · Enter opens folder · Cmd+Enter saves root · Esc closes' : m.reusing ? '↑↓ choose · Enter selects / opens · Tab changes field · Cmd+Enter opens · Esc closes' : '↑↓ choose · Enter selects / creates · Tab changes field · Cmd+Enter creates · Esc closes'));
  }
}
