import './panel.css';
import type { ProjectController } from '../io/projectController';
import type { Store } from '../state/store';
import { Binder, button, h } from './controls';
import { attachHelpTooltips } from './helpTooltip';
import { animationSection } from './sections/animationSection';
import { appControls, showControls } from './sections/appControls';
import { assetsSection } from './sections/assetsSection';
import { configSection } from './sections/configSection';
import type { PanelContext, PlaybackInfo } from './sections/context';
import { mappingSection } from './sections/mappingSection';
import { Thumbnails } from './thumbnails';

/**
 * Side panel. Overlays the canvas without resizing it. Reads state via store
 * subscription and changes it only through store actions.
 */
export class Panel {
  readonly el: HTMLElement;
  private binder = new Binder();
  private confirmBar: HTMLElement;
  private pendingConfirm: ((ok: boolean) => void) | null = null;

  constructor(
    private store: Store,
    project: ProjectController,
    playback: PlaybackInfo,
  ) {
    this.confirmBar = h('div', { class: 'confirm-bar' });
    this.confirmBar.hidden = true;

    const ctx: PanelContext = {
      store,
      project,
      confirm: (message, label) => this.confirm(message, label),
      openState: new Map(),
      binder: this.binder,
      // Created before the panel subscribes, so a project load clears it before sections rebuild.
      thumbs: new Thumbnails(store, project),
      playback,
    };

    this.el = h('aside', { class: 'panel' }, [
      showControls(ctx),
      appControls(ctx),
      this.confirmBar,
      h('div', { class: 'panel-body' }, [
        configSection(ctx),
        mappingSection(ctx),
        assetsSection(ctx),
        animationSection(ctx),
      ]),
    ]);
    // Keep pointer/keyboard events in the panel from reaching the canvas handlers.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    attachHelpTooltips(this.el);

    store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { panelOpen } = this.store.runtime;
    this.el.hidden = !panelOpen;
    this.el.classList.toggle('right', this.store.config.ui.panelSide === 'right');
    if (!panelOpen && this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (panelOpen) this.binder.syncAll();
  }

  /** Inline confirmation (the panel never uses native dialogs). */
  private confirm(message: string, confirmLabel: string): Promise<boolean> {
    this.pendingConfirm?.(false);
    this.store.setPanelOpen(true);
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        if (this.pendingConfirm !== finish) return;
        this.pendingConfirm = null;
        this.confirmBar.hidden = true;
        this.confirmBar.replaceChildren();
        resolve(ok);
      };
      this.pendingConfirm = finish;
      this.confirmBar.replaceChildren(
        h('div', { class: 'confirm-text', text: message }),
        h('div', { class: 'button-row' }, [
          button('Cancel', () => finish(false)),
          button(confirmLabel, () => finish(true), 'danger'),
        ]),
      );
      this.confirmBar.hidden = false;
    });
  }
}
