import './panel.css';
import type { ProjectController } from '../io/projectController';
import type { Store } from '../state/store';
import { Binder, button, h } from './controls';
import { blockStrayDrops } from './dropZone';
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
      confirmAt: (anchor) => (message, label) => this.confirm(message, label, anchor),
      openState: new Map(),
      binder: this.binder,
      // Created before the panel subscribes, so a project load clears it before sections rebuild.
      thumbs: new Thumbnails(store, project),
      playback,
    };

    const resizer = h('div', { class: 'panel-resizer', title: 'Drag to resize the panel. Double-click for the default width.' });
    this.el = h('aside', { class: 'panel' }, [
      resizer,
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
    attachResizer(this.el, resizer);
    // A file dropped outside a drop zone must not replace the show with the file.
    blockStrayDrops();
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

  /**
   * Inline confirmation (the panel never uses native dialogs). With an anchor it appears right
   * below it, where the user is looking; otherwise in the bar at the top of the panel.
   */
  private confirm(message: string, confirmLabel: string, anchor?: HTMLElement): Promise<boolean> {
    this.pendingConfirm?.(false);
    this.store.setPanelOpen(true);
    const bar = anchor ? h('div', { class: 'confirm-bar inline' }) : this.confirmBar;
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        if (this.pendingConfirm !== finish) return;
        this.pendingConfirm = null;
        if (anchor) {
          bar.remove();
        } else {
          bar.hidden = true;
          bar.replaceChildren();
        }
        resolve(ok);
      };
      this.pendingConfirm = finish;
      bar.replaceChildren(
        h('div', { class: 'confirm-text', text: message }),
        h('div', { class: 'button-row' }, [
          button('Cancel', () => finish(false)),
          button(confirmLabel, () => finish(true), 'danger'),
        ]),
      );
      if (anchor) {
        // Below a section header, the section must be open for the bar to show.
        if (anchor.tagName === 'SUMMARY' && anchor.parentElement instanceof HTMLDetailsElement) {
          anchor.parentElement.open = true;
        }
        anchor.after(bar);
      }
      bar.hidden = false;
      bar.scrollIntoView({ block: 'nearest' });
    });
  }
}

/** Panel width in rem (rem scales with the screen, so the panel keeps its proportions at FHD and 4K). */
const DEFAULT_WIDTH_REM = 27;
const MIN_WIDTH_REM = DEFAULT_WIDTH_REM * 0.9;
/** Never wider than this share of the screen, so the stage stays usable. */
const MAX_WIDTH_SHARE = 0.6;

/**
 * Drag the panel's inner edge to change its width (the edge facing the stage, on either
 * side). Double-click restores the default. The width lasts until the page is reloaded.
 */
function attachResizer(panel: HTMLElement, handle: HTMLElement): void {
  const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const setWidth = (rem: number) => {
    const max = Math.max(MIN_WIDTH_REM, (window.innerWidth * MAX_WIDTH_SHARE) / remPx());
    panel.style.setProperty('--panel-width', `${Math.min(max, Math.max(MIN_WIDTH_REM, rem))}rem`);
  };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    panel.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      const r = panel.getBoundingClientRect();
      const px = panel.classList.contains('right') ? r.right - ev.clientX : ev.clientX - r.left;
      setWidth(px / remPx());
    };
    const up = () => {
      panel.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => panel.style.removeProperty('--panel-width'));
  // Keep a dragged width within bounds when the window changes size.
  window.addEventListener('resize', () => {
    const cur = panel.style.getPropertyValue('--panel-width');
    if (cur) setWidth(parseFloat(cur));
  });
}
