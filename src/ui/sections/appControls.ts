import { button, h } from '../controls';
import type { PanelContext } from './context';

/** Header bar: title, unsaved indicators, left/right switch, close button. Always visible. */
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
    h('div', { class: 'app-title', text: 'Projection Mapper' }),
    h('div', { class: 'indicators' }, [
      indicator('Config', () => store.runtime.configDirty),
      indicator('Assets', () => store.runtime.assetsDirty),
    ]),
    h('div', { class: 'segmented' }, [left, right]),
    close,
  ]);
}
