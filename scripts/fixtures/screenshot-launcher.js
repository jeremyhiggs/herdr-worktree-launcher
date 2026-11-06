// Drives the real launcher in the disposable screenshot profile only.
import Launcher from './launcher.js';
import { openCheckout } from './model.js';
import { appHome, readTextFile, writeTextFile, nextCommand, spaces, panes, run, props, closeOverlay } from 'herdr';

export default class ScreenshotLauncher extends Launcher {
  init(properties, cx) {
    super.init(properties, cx);
    cx.spawn(async cx => {
      const path = `${appHome()}/data/screenshot-state.json`;
      let previous = await readTextFile(path);
      const pause = ms => new Promise(resolve => cx.timer.after(ms, resolve));
      for (;;) {
        const scene = await nextCommand();
        try {
          const deadline = Date.now() + 30000;
          while (this.model.phase === 'loading' && Date.now() < deadline) await pause(100);
          if (this.model.phase !== 'editing') throw new Error(this.model.error || `Not ready: ${this.model.phase}`);
          const m = this.model;
          const project = m.projects.find(item => item.label === 'acme/sample-api');
          if (!project) throw new Error('Sample project not discovered.');
          await m.selectProject(project);
          this.showChoice('project', project.label);
          if (scene === 'fetch') {
            if (m.refs.some(row => row.ref === 'refs/remotes/origin/feature/from-remote')) throw new Error('Server-only branch was already cached.');
            await m.fetchRemote(() => { this.syncContext(); cx.notify(); });
            if (m.error || !m.refs.some(row => row.ref === 'refs/remotes/origin/feature/from-remote')) throw new Error(m.error || 'Fetch did not discover the server branch.');
          }
          const existing = ['existing', 'reuse', 'reuse-again'].includes(scene);
          m.setAction(existing ? 'existing' : 'new');
          const ref = m.refs.find(item => item.ref === (scene === 'fetch' ? 'refs/remotes/origin/feature/from-remote' : existing ? 'refs/heads/feature/pagination' : 'refs/heads/main'));
          if (!ref) throw new Error('Sample branch not discovered.');
          m.selectRef(ref); this.showChoice('ref', ref.label);
          m.setName('feature/rate-limits'); this.showChoice('name', m.name);
          this.syncContext(); this.index = 0; this.openField = null;
          if (scene === 'existing') { this.inputs.ref.focus(); this.field = 'ref'; this.openField = 'ref'; }
          else if (scene === 'agents') { this.inputs.launch.focus(); this.field = 'launch'; this.openField = 'launch'; }
          else if (scene === 'fetch') { this.inputs.ref.focus(); this.field = 'ref'; this.openField = 'ref'; this.filters.ref = 'from-remote'; }
          else this.inputs.name.focus();
          if (['create', 'reuse', 'reuse-again'].includes(scene)) {
            await m.submit(request => openCheckout(request, m.git, {
              snapshot: () => ({ spaces: spaces(), panes: panes() }), run, now: () => Date.now(), pause: () => pause(100),
              timeout: ms => {
                let timer;
                const promise = new Promise(resolve => { timer = cx.timer.after(ms, resolve); });
                return { promise, cancel: () => timer.cancel() };
              },
            }));
            if (m.phase !== 'complete') throw new Error(m.error || `Creation stopped: ${m.phase}`);
          }
          window.activate_window(); cx.notify();
          const active = spaces().find(space => space.active), focused = panes().find(pane => pane.focused);
          const state = JSON.stringify({ scene, phase: m.phase, projects: m.projects.length, launchers: m.launches.map(item => item.label), fetched: m.fetchMessage, result: m.result?.path ?? null, space: active?.id, tabs: active?.tabs.length, terminal: focused?.terminal });
          await writeTextFile(path, state, previous); previous = state;
          if (['create', 'reuse', 'reuse-again'].includes(scene)) closeOverlay(props().overlay);
        } catch (error) {
          const state = JSON.stringify({ scene, error: String(error) });
          await writeTextFile(path, state, previous); previous = state;
        }
      }
    });
  }
}
