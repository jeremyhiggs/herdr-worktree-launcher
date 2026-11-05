import { View, div } from 'gpui-kit';
import { v_flex, h_flex, InputState, Input, Button, Popup, v_virtual_list, VirtualListScrollHandle, Scrollbar, TextView } from 'gpui-base';
import { exec, home, appHome, readTextFile, writeTextFile, spaces, panes, run, theme, props, closeOverlay } from 'herdr';
import { createGit } from './git.js';
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
    this.openField = 'project';
    this.activeInput = 'project';
    this.index = 0;
    this.filters = { project: '', ref: '' };
    this.inputs = {};
    this.buttons = {};
    for (const key of ['new', 'existing', 'refresh', 'close', 'create', 'open-created']) this.buttons[key] = cx.focus_handle();
    for (const [field, placeholder] of [['project', 'Search projects'], ['name', 'New branch name'], ['ref', 'Search local and fetched remote branches']]) {
      const input = InputState.new({ placeholder });
      this.inputs[field] = input;
      input.on('change', (_e, cx) => {
        if (this.syncing) return;
        if (field === 'name') this.model.setName(input.value());
        else { this.field = field; this.openField = field; this.filters[field] = input.value(); this.index = 0; this.scroll.scroll_to_item(0); }
        cx.notify();
      });
      input.on('focus', (_e, cx) => { this.activeInput = field; this.openField = field === 'name' ? null : field; if (field !== 'name') this.field = field; this.index = 0; cx.notify(); });
      input.on('blur', (_e, cx) => { if (this.activeInput === field) this.activeInput = null; cx.notify(); });
      input.on('submit', (event, cx) => {
        if (event.secondary) this.task(cx, open => this.model.submit(open));
        else if (field !== 'name' && this.openField === field) this.choose(this.rows(field)[this.index], cx, field);
      });
    }
    const git = createGit(exec, home());
    const configPath = `${appHome()}/mods/worktree-launcher/config.json`;
    const recordPath = `${appHome()}/data/worktree-launcher-operation.json`;
    let snapshot = null;
    this.model = new WorktreeModel({
      git,
      config: async () => {
        const text = await readTextFile(configPath);
        if (text === null) throw new Error('Missing config.json: set project_root to an absolute, readable directory. See the mod README.');
        try { return JSON.parse(text); } catch { throw new Error('Malformed config.json: expected JSON with a project_root setting.'); }
      },
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
    this.task(cx, () => this.model.refresh());
    this.inputs.project.focus();
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
        const pending = work(open); if (this.model.busy) this.openField = null; cx.notify(); await pending;
        if (this.model.phase === 'complete') closeOverlay(props().overlay);
        else cx.notify();
      } catch (e) { this.model.error = String(e); cx.notify(); }
    });
  }

  clearInputs() {
    this.syncing = true;
    try { this.inputs.name.set_value(''); this.inputs.ref.set_value(''); this.filters.ref = ''; }
    finally { this.syncing = false; }
    this.index = 0;
  }

  rows(field = this.field) {
    const source = field === 'project' ? this.model.projects : this.model.refs;
    const filter = this.filters[field].toLowerCase();
    return source.filter(row => `${row.label} ${row.reason ?? ''}`.toLowerCase().includes(filter));
  }

  emptyMessage(field) {
    const m = this.model;
    if (m.phase === 'loading') return 'Loading…';
    if (field !== 'project') return m.project ? 'No matching branches' : 'Select a project first';
    if (m.error) return 'Fix the configuration, then Refresh.';
    return m.projects.length ? 'No matching projects' : 'No projects found';
  }

  choose(row, cx, field = this.field) {
    if (!row || !this.model.editable) return;
    if (field === 'project') {
      this.clearInputs();
      this.showChoice('project', row.label);
      this.openField = null;
      this.task(cx, async () => {
        await this.model.selectProject(row);
        if (!this.model.closed && this.model.project?.id === row.id && this.model.phase === 'editing') this.buttons[this.model.action].focus();
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
  }

  dismiss() { if (this.model.close()) closeOverlay(props().overlay); }
  close() { this.model.closed = true; this.model.generation++; }

  key(event, cx) {
    if (event.key === 'tab') {
      const order = ['project', 'new', 'existing', ...(this.model.project ? ['ref'] : []), ...(this.model.action === 'new' && this.model.ref ? ['name'] : []), 'refresh', 'close', this.model.phase === 'recover' ? 'open-created' : 'create'];
      const current = this.activeInput || order.find(key => this.buttons[key]?.is_focused());
      const step = event.modifiers.shift ? -1 : 1;
      const next = order[(Math.max(0, order.indexOf(current)) + step + order.length) % order.length];
      this.openField = null; (this.inputs[next] || this.buttons[next]).focus();
      cx.stop_propagation(); cx.notify();
    }
    else if (event.key === 'escape') { cx.stop_propagation(); this.dismiss(); cx.notify(); }
    else if (event.keystroke === 'cmd-enter') { cx.stop_propagation(); this.task(cx, open => this.model.submit(open)); }
    else if (['up', 'down'].includes(event.key) && ['project', 'ref'].includes(this.activeInput)) {
      this.field = this.activeInput; this.openField = this.activeInput;
      const count = this.rows().length;
      if (count) { this.index = (this.index + (event.key === 'down' ? 1 : count - 1)) % count; this.scroll.scroll_to_item(this.index, 'center'); }
      cx.stop_propagation(); cx.notify();
    }
  }

  choiceList(field, t) {
    const rows = this.rows(field), m = this.model, isProject = field === 'project';
    const key = row => isProject ? row.id : row.ref;
    const height = Math.min(220, Math.max(44, rows.length * 44));
    const content = v_flex().w(Math.max(240, (this.width ?? 700) - 36)).h(height).bg(t.popover).border_1().border_color(t.border).rounded(6)
      .on_mouse_down_out((_e, cx) => { if (this.openField === field) { this.openField = null; cx.notify(); } });
    if (!rows.length) return content.child(div().p(10).text_color(t.muted).child(this.emptyMessage(field)));
    return content.child(div().relative().size_full()
      .child(v_virtual_list(`worktree-${field}-choices`, rows.length, 44, i => key(rows[i]), range => rows.slice(range.start, range.end).map((row, offset) => {
        const unavailable = !isProject && m.action === 'existing' && !!row.reason;
        const chosen = isProject ? m.project?.id === row.id : m.ref?.ref === row.ref;
        return v_flex().h(44).px(10).justify_center().rounded(5)
          .bg(range.start + offset === this.index ? t.selected : t.popover)
          .text_color(unavailable ? t.dim : t.foreground)
          .child(div().truncate().child(`${chosen ? '✓ ' : ''}${row.label}`))
          .child(div().truncate().text_size(10.5).text_color(t.muted).child(isProject ? row.path : unavailable ? row.reason : row.ref));
      })).size_full().track_scroll(this.scroll).on_item_click((value, cx) => {
        if (this.openField === field) this.choose(this.rows(field).find(row => key(row) === value), cx, field);
      }))
      .child(Scrollbar.vertical(`worktree-${field}-choices`).absolute().inset_0()));
  }

  render() {
    const t = theme(), m = this.model;
    const button = (id, text, action, disabled = false, selected = false, tab = 0) => Button.new(id)
      .track_focus(this.buttons[id]).tab_index(tab).disabled(disabled).h(32).px(12).rounded(6).border_1()
      .border_color(selected ? t.accent : t.border).bg(selected ? t.selected : t.raised)
      .text_color(disabled ? t.dim : t.foreground).focus(s => s.border_color(t.accent))
      .on_click(action).child(text);
    const label = text => div().text_size(11).text_color(t.muted).child(text);
    const input = field => Input.new(this.inputs[field]).disabled(!m.editable || field === 'ref' && !m.project || field === 'name' && !m.ref)
      .accessibility_label(field === 'ref' ? m.action === 'new' ? 'Base branch' : 'Existing branch' : field === 'name' ? 'New branch name' : 'Project')
      .h(34).px(10).rounded(6).border_1().border_color(this.activeInput === field ? t.accent : t.border)
      .bg(t.input).text_color(t.foreground);
    const picker = field => Popup.new(`worktree-${field}-picker`, div().w_full().on_click((_e, cx) => { this.field = field; this.openField = field; cx.notify(); }).child(input(field)))
      .w_full().anchor('top_left').when(this.openField === field && m.editable, el => el.content(this.choiceList(field, t)));
    return v_flex().id('worktree-launcher').track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { if (this.width !== size.width) { this.width = size.width; cx.notify(); } })
      .on_mouse_down('left', (_e, cx) => cx.stop_propagation())
      .size_full().p(18).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(17).font_semibold().child('Worktree Launcher'))
        .child(button('refresh', 'Refresh', (_e, cx) => { this.clearInputs(); this.inputs.project.set_value(''); this.filters.project = ''; this.field = 'project'; this.task(cx, () => m.refresh()); }, m.busy, false, 5)))
      .child(label('Project'))
      .child(picker('project'))
      .child(h_flex().gap(8).children(['new', 'existing'].map((action, i) => button(action, action === 'new' ? 'New branch' : 'Existing branch', (_e, cx) => { if (m.setAction(action)) this.inputs.name.set_value(''); this.openField = null; if (m.project) this.inputs.ref.focus(); cx.notify(); }, !m.editable, m.action === action, i + 1))))
      .child(label(m.action === 'new' ? 'Base branch' : 'Branch'))
      .child(picker('ref'))
      .when(m.action === 'existing' && Boolean(m.ref?.reason), el => el.child(selectableText('checkout-reason', m.ref.reason).text_size(11).text_color(t.blocked)))
      .when(m.action === 'new', el => el.child(label('New branch name')).child(input('name')))
      .child(div().flex_1())
      .child(label('Destination'))
      .child(selectableText('destination', m.path || 'Select a project and branch to preview the destination.').text_size(11).text_color(t.foreground))
      .when(Boolean(m.error), el => el.child(div().max_h(100).overflow_y_scrollbar().child(selectableText('operation-error', m.error).text_color(t.blocked))))
      .when(m.phase === 'partial', el => el.child(selectableText('recovery-instructions', 'Creation is blocked until this operation is inspected. See recovery instructions in the README.').text_size(11).text_color(t.muted)))
      .child(h_flex().gap(8).justify_end()
        .child(button('close', 'Close', (_e, cx) => { this.dismiss(); cx.notify(); }, m.busy, false, 6))
        .when(m.phase === 'recover', el => el.child(button('open-created', 'Open created worktree', (_e, cx) => this.task(cx, open => m.openCreated(open)), false, true, 7)))
        .when(m.phase !== 'recover', el => el.child(button('create', m.busy ? 'Finishing…' : 'Create', (_e, cx) => this.task(cx, open => m.submit(open)), !m.canCreate, true, 7))))
      .child(div().text_size(10.5).text_color(t.dim).child('↑↓ choose · Enter selects · Tab changes field · Cmd+Enter creates · Esc closes'));
  }
}
