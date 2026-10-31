import { WALL_QUAD_ID, type QuadId } from '../../state/schema';
import { CORNER_NAMES, type CornerIndex } from '../../state/store';
import { Binder, button, checkboxRow, colorCheckRow, colorRow, h, numberInput, numberRow, row, section, sliderRow, textRow, withHelp } from '../controls';
import type { PanelContext } from './context';
import { playlistBlock } from './playlistBlock';

/** Caption X offset slider spans ± this many frame widths (the number field accepts any value). */
const CAPTION_X_RANGE = 0.5;

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
  const wall = section(ctx.openState, 'wall', quadTitle(() => 'Wall quad', () => store.config.wallQuad.debugColor, binder), [
    colorCheckRow(binder, 'Debug color', () => store.config.wallQuad.debugColor, (v) => store.setWallColor(v)),
    checkboxRow(binder, 'Test pattern', () => store.isTestPatternOn(WALL_QUAD_ID), (v) => store.setTestPattern(WALL_QUAD_ID, v)),
    pointRows(ctx, binder, WALL_QUAD_ID),
    convexWarning(ctx, binder, WALL_QUAD_ID),
    playlistBlock(ctx, binder, WALL_QUAD_ID),
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
  // The panel rebuilds the frame list when the order changes, so index is current here.
  const last = store.config.frames.length - 1;
  const up = button('↑', () => store.moveFrame(id, index - 1), 'small');
  up.title = 'Move up (draws under the frames below it)';
  up.disabled = index === 0;
  const down = button('↓', () => store.moveFrame(id, index + 1), 'small');
  down.title = 'Move down (draws over the frames above it)';
  down.disabled = index === last;

  const idRow = h('div', { class: 'quad-id', text: `ID: ${id}`, title: 'Frame id in config.json (not editable)' });
  return section(ctx.openState, `frame:${id}`, quadTitle(() => frameLabel(index, frame().title), () => frame().debugColor, b), [
    idRow,
    textRow(b, 'Title', { get: () => frame().title, set: (v) => store.updateFrame(id, { title: v }), placeholder: 'Untitled' }),
    colorCheckRow(b, 'Debug color', () => frame().debugColor, (v) => store.updateFrame(id, { debugColor: v })),
    checkboxRow(b, 'Test pattern', () => store.isTestPatternOn(id), (v) => store.setTestPattern(id, v)),
    withHelp(
      checkboxRow(b, 'Additive blend', () => frame().blend === 'add', (v) => store.updateFrame(id, { blend: v ? 'add' : 'normal' })),
      "Adds this frame's light on top of what's behind it instead of covering it: black becomes see-through and bright areas glow over it. " +
        'Use it to fake transparency for content shot on black (fire, smoke, sparks). To layer, overlap this frame with another ' +
        'and move it lower in the list (↓) so it draws on top.',
    ),
    pointRows(ctx, b, id),
    rotateButton(ctx, id),
    numberRow(b, 'Physical aspect (w÷h)', {
      get: () => frame().physicalAspect, set: (v) => store.updateFrame(id, { physicalAspect: v }),
      min: 0.05, max: 20, step: 0.0001, decimals: 4,
    }),
    withHelp(
      sliderRow(b, 'Caption X offset', {
        get: () => frame().captionOffsetX, set: (v) => store.updateFrame(id, { captionOffsetX: v }),
        step: 0.001, decimals: 3, sliderMin: -CAPTION_X_RANGE, sliderMax: CAPTION_X_RANGE,
      }),
      "Shifts the captions' left edge along the frame's bottom edge, in frame widths. 0 = lined up with the bottom-left corner; negative moves left, positive right.",
    ),
    withHelp(
      sliderRow(b, 'Caption Y offset', {
        get: () => frame().captionSpacing, set: (v) => store.updateFrame(id, { captionSpacing: v }),
        step: 0.001, decimals: 3, sliderMin: 0, sliderMax: 0.3,
      }),
      "Gap between the frame's bottom edge and the captions, in frame widths.",
    ),
    convexWarning(ctx, b, id),
    playlistBlock(ctx, b, id),
    frameTiming(ctx, b, id),
  ], { class: 'quad', headerExtras: [up, down, remove] });
}

/** Manual show: this frame's own Cycle duration and Transition delay, each optional. */
function frameTiming(ctx: PanelContext, b: Binder, id: QuadId): HTMLElement {
  const block = h('div', { class: 'frame-timing' }, [
    h('div', { class: 'subhead', text: 'Timing (seconds)' }),
    timingOverride(ctx, b, id, 'cycleDuration', 'Cycle duration', 0.5,
      'How long each artwork in this playlist holds, fully visible. Tick to set it for this frame; unticked, it uses Cycle duration from the Animation section (shown greyed out).'),
    timingOverride(ctx, b, id, 'transitionDelay', 'Transition delay', 0,
      'How long this frame stays black after one artwork fades out, before the next one appears. Tick to set it for this frame; unticked, it uses Transition delay from the Animation section (shown greyed out).'),
  ]);
  // Frame playlists (and so their timing) only play in a manual show.
  b.add(() => (block.hidden = ctx.store.config.showType !== 'manual'));
  return block;
}

function timingOverride(
  ctx: PanelContext,
  b: Binder,
  id: QuadId,
  key: 'cycleDuration' | 'transitionDelay',
  label: string,
  min: number,
  help: string,
): HTMLElement {
  const { store } = ctx;
  const own = () => store.config.frames.find((f) => f.id === id)?.[key] ?? null;
  const global = () => store.config.animation[key];
  const toggle = h('input', { type: 'checkbox', class: 'override' });
  toggle.title = 'Use a value just for this frame';
  toggle.addEventListener('change', () => {
    // Turning it on starts from the Animation value, so nothing jumps until it's edited.
    store.updateFrame(id, { [key]: toggle.checked ? global() : null });
    toggle.blur();
  });
  const input = numberInput(b, { get: () => own() ?? global(), set: (v) => store.updateFrame(id, { [key]: v }), min, step: 0.1, decimals: 2 });
  const source = h('span', { class: 'muted timing-source' });
  b.add(() => {
    const set = own() !== null;
    toggle.checked = set;
    input.disabled = !set;
    source.textContent = set ? 'own' : 'Animation';
  });
  return withHelp(row(label, toggle, input, source), help);
}

/** Turns the frame 90° clockwise about its center (content and captions turn with it). */
function rotateButton(ctx: PanelContext, id: QuadId): HTMLElement {
  const rotate = withHelp(
    button('↻ Rotate 90° clockwise', () => ctx.store.rotateQuad(id), 'wide'),
    "Turns this frame 90° clockwise around its center, so its picture and captions turn with it. If that pushes a corner off screen, the frame is slid back on screen. Ctrl+Z undoes it.",
  );
  return h('div', { class: 'rotate-row' }, [rotate]);
}

/** "Frame 3: The Nightmare" (just "Frame 3" when the title is blank). index is 0-based. */
export function frameLabel(index: number, title: string): string {
  const t = title.trim();
  return t ? `Frame ${index + 1}: ${t}` : `Frame ${index + 1}`;
}

/** Section title: color swatch and name, both kept current. */
function quadTitle(text: () => string, color: () => string, b: Binder): HTMLElement {
  const swatch = h('span', { class: 'swatch' });
  const name = h('span', { class: 'quad-name' });
  b.add(() => {
    swatch.style.background = color();
    name.textContent = text();
  });
  return h('span', { class: 'title' }, [swatch, name]);
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
    // Rows are rebuilt when frames are added or reordered; the first sync only marks the
    // selection, so an already-selected point doesn't pop its frame open.
    let synced = false;
    b.add(() => {
      const sel = store.runtime.selected;
      const isSel = !!sel && sel.quadId === quadId && sel.index === index;
      const wasSel = row.classList.contains('selected');
      row.classList.toggle('selected', isSel);
      const first = !synced;
      synced = true;
      if (isSel && !wasSel && !first) {
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
