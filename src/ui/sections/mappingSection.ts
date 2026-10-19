import { WALL_QUAD_ID, type QuadId } from '../../state/schema';
import { CORNER_NAMES, type CornerIndex } from '../../state/store';
import { Binder, button, checkboxRow, colorRow, h, numberInput, numberRow, section, sliderRow } from '../controls';
import type { PanelContext } from './context';

const INSET_MAX = 0.2;

export function mappingSection(ctx: PanelContext): HTMLElement {
  const { store, binder } = ctx;

  // ----- Global -----
  const g = () => store.config.global;
  const globalBody = [
    colorRow(binder, 'Background', () => g().backgroundColor, (v) => store.setBackgroundColor(v)),
    sliderRow(binder, 'Stroke width', {
      get: () => g().debug.strokeWidth, set: (v) => store.setDebugStyle({ strokeWidth: v }),
      min: 0.5, step: 0.5, decimals: 1, sliderMin: 0.5, sliderMax: 10,
    }),
    sliderRow(binder, 'Point radius', {
      get: () => g().debug.pointRadius, set: (v) => store.setDebugStyle({ pointRadius: v }),
      min: 2, step: 1, decimals: 0, sliderMin: 4, sliderMax: 80,
    }),
    sliderRow(binder, 'Crosshair size', {
      get: () => g().debug.crosshairSize, set: (v) => store.setDebugStyle({ crosshairSize: v }),
      min: 0, step: 1, decimals: 0, sliderMin: 0, sliderMax: 160,
    }),
  ];

  // ----- Wall quad -----
  const wall = section(ctx.openState, 'wall', quadTitle('Wall quad', () => store.config.wallQuad.debugColor, binder), [
    pointRows(ctx, binder, WALL_QUAD_ID),
    colorRow(binder, 'Debug color', () => store.config.wallQuad.debugColor, (v) => store.setWallColor(v)),
    checkboxRow(binder, 'Test pattern', () => store.isTestPatternOn(WALL_QUAD_ID), (v) => store.setTestPattern(WALL_QUAD_ID, v)),
    convexWarning(ctx, binder, WALL_QUAD_ID),
  ], { class: 'quad' });

  // ----- Frames (rebuilt when the frame list changes) -----
  const framesEl = h('div', { class: 'frames' });
  const framesBinder = new Binder();
  let signature = '';
  const rebuildFrames = () => {
    const sig = store.config.frames.map((f) => f.id).join(',');
    if (sig === signature) return;
    signature = sig;
    framesBinder.clear();
    framesEl.replaceChildren(
      ...store.config.frames.map((f, i) => frameSection(ctx, framesBinder, f.id, i)),
    );
    if (store.config.frames.length === 0) framesEl.append(h('div', { class: 'muted', text: 'No frames.' }));
  };
  binder.add(() => {
    rebuildFrames();
    framesBinder.syncAll();
  });

  const add = button('+ Add new frame', () => {
    const id = store.addFrame();
    ctx.openState.set(`frame:${id}`, true);
  }, 'wide');

  return section(ctx.openState, 'mapping', 'Mapping', [
    section(ctx.openState, 'global', 'Global', globalBody, { defaultOpen: true }),
    wall,
    framesEl,
    add,
  ], { defaultOpen: true });
}

function frameSection(ctx: PanelContext, b: Binder, id: QuadId, index: number): HTMLElement {
  const { store } = ctx;
  const frame = () => store.config.frames.find((f) => f.id === id)!;
  const remove = button('Remove', () => store.removeFrame(id), 'danger small');
  remove.title = 'Remove this frame (no confirmation)';

  const insetRow = (edge: 'top' | 'right' | 'bottom' | 'left', label: string) =>
    sliderRow(b, label, {
      get: () => frame().inset[edge],
      set: (v) => store.updateFrame(id, { inset: { ...frame().inset, [edge]: v } }),
      min: 0, step: 0.001, decimals: 4, sliderMin: 0, sliderMax: INSET_MAX,
    });

  return section(ctx.openState, `frame:${id}`, quadTitle(`Frame ${index + 1}`, () => frame().debugColor, b), [
    pointRows(ctx, b, id),
    colorRow(b, 'Debug color', () => frame().debugColor, (v) => store.updateFrame(id, { debugColor: v })),
    numberRow(b, 'Physical aspect (w÷h)', {
      get: () => frame().physicalAspect, set: (v) => store.updateFrame(id, { physicalAspect: v }),
      min: 0.05, max: 20, step: 0.0001, decimals: 4,
    }),
    sliderRow(b, 'Caption spacing', {
      get: () => frame().captionSpacing, set: (v) => store.updateFrame(id, { captionSpacing: v }),
      step: 0.001, decimals: 3, sliderMin: 0, sliderMax: 0.3,
    }),
    h('div', { class: 'subhead', text: 'Inset (frame widths)' }),
    insetRow('top', 'Top'),
    insetRow('right', 'Right'),
    insetRow('bottom', 'Bottom'),
    insetRow('left', 'Left'),
    checkboxRow(b, 'Test pattern', () => store.isTestPatternOn(id), (v) => store.setTestPattern(id, v)),
    convexWarning(ctx, b, id),
  ], { class: 'quad', headerExtras: [remove] });
}

function quadTitle(text: string, color: () => string, b: Binder): HTMLElement {
  const swatch = h('span', { class: 'swatch' });
  b.add(() => (swatch.style.background = color()));
  return h('span', { class: 'title' }, [swatch, text]);
}

/** X/Y inputs in device pixels for each corner. Clicking the corner name selects that point. */
function pointRows(ctx: PanelContext, b: Binder, quadId: QuadId): HTMLElement {
  const { store } = ctx;
  const rows = ([0, 1, 2, 3] as CornerIndex[]).map((index) => {
    const ref = { quadId, index };
    const corner = () => store.getCorners(quadId)?.[index] ?? [0, 0];
    const vp = () => store.runtime.viewport;
    const name = button(CORNER_NAMES[index], () => store.select(ref), 'corner');
    name.title = 'Select this point';
    const x = numberInput(b, {
      get: () => corner()[0] * vp().w,
      set: (v) => store.movePoint(ref, [v / vp().w, corner()[1]]),
      step: 0.1, decimals: 2,
    });
    const y = numberInput(b, {
      get: () => corner()[1] * vp().h,
      set: (v) => store.movePoint(ref, [corner()[0], v / vp().h]),
      step: 0.1, decimals: 2,
    });
    const row = h('div', { class: 'point-row' }, [name, h('span', { class: 'axis', text: 'X' }), x, h('span', { class: 'axis', text: 'Y' }), y]);
    b.add(() => {
      const sel = store.runtime.selected;
      const isSel = !!sel && sel.quadId === quadId && sel.index === index;
      const wasSel = row.classList.contains('selected');
      row.classList.toggle('selected', isSel);
      if (isSel && !wasSel) {
        // Reveal the newly selected point: expand its enclosing sections and scroll to it.
        for (let d = row.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
        row.scrollIntoView({ block: 'nearest' });
      }
    });
    return row;
  });
  return h('div', { class: 'points' }, [h('div', { class: 'subhead', text: 'Control points (device px)' }), ...rows]);
}

function convexWarning(ctx: PanelContext, b: Binder, quadId: QuadId): HTMLElement {
  const el = h('div', { class: 'warning', text: '⚠ Quad is not convex. Showing the last valid mapping.' });
  b.add(() => (el.hidden = ctx.store.isQuadValid(quadId)));
  return el;
}
