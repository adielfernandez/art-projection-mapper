import { button, h } from '../controls';
import type { PanelContext } from './context';

/** Full-width Pause/Resume Show toggle, pinned at the very top of the panel. */
export function showControls(ctx: PanelContext): HTMLElement {
  const { store, binder } = ctx;
  const toggle = button('Pause Show', () => store.setPaused(!store.runtime.paused), 'pause-toggle');
  binder.add(() => {
    const paused = store.runtime.paused;
    toggle.textContent = paused ? '▶  Resume Show' : '❚❚  Pause Show';
    toggle.classList.toggle('paused', paused);
    toggle.title = paused
      ? 'Resume all animation and video from where it stopped (Space)'
      : 'Freeze all animation and video. Settings stay editable and update live. (Space)';
  });
  // Leave the button after a click so arrow keys keep nudging points.
  toggle.addEventListener('pointerup', () => toggle.blur());
  return h('div', { class: 'show-controls' }, [toggle]);
}

/** Header: title, unsaved indicators and close button; below them the left/right switch. Always visible. */
export function appControls(ctx: PanelContext): HTMLElement {
  const { store, binder } = ctx;

  const indicator = (label: string, dirty: () => boolean) => {
    const el = h('span', { class: 'dirty', text: label });
    binder.add(() => {
      const d = dirty();
      el.classList.toggle('on', d);
      el.title = d ? `${label}: unsaved changes` : `${label}: saved`;
    });
    return el;
  };

  const left = button('L', () => store.setPanelSide('left'), 'seg');
  const right = button('R', () => store.setPanelSide('right'), 'seg');
  left.title = 'Dock panel left';
  right.title = 'Dock panel right';
  binder.add(() => {
    const side = store.config.ui.panelSide;
    left.classList.toggle('active', side === 'left');
    right.classList.toggle('active', side === 'right');
  });

  const close = button('✕', () => store.setPanelOpen(false), 'icon');
  close.title = 'Close panel (X)';

  return h('header', { class: 'app-controls' }, [
    h('div', { class: 'app-controls-row' }, [
      h('div', { class: 'app-title', text: 'Art Projection Mapper' }),
      h('div', { class: 'indicators' }, [
        indicator('Config', () => store.runtime.configDirty),
        indicator('Assets', () => store.runtime.assetsDirty),
      ]),
      close,
    ]),
    h('div', { class: 'app-controls-row' }, [
      h('span', { class: 'muted', text: 'Panel Alignment:' }),
      h('div', { class: 'segmented' }, [left, right]),
    ]),
  ]);
}
