import { mediaKind } from '../../content/selection';
import { validateEntry } from '../../content/validation';
import type { ImportResult } from '../../io/projectController';
import { BLEND_MODES, TRANSITION_IN_STYLES, type BlendMode, type TransitionInStyle } from '../../state/schema';
import type { ChoreoFrameSettings, EntrySettings } from '../../state/store';
import { Binder, button, checkboxRow, colorCheckRow, h, numberInput, numberRow, row, section, selectRow, showNote, sliderRow, textRow, withHelp } from '../controls';
import { dropZone } from '../dropZone';
import { entryLabel, frameLabel } from '../labels';
import { assetPicker, fileName } from './assetPicker';
import type { PanelContext } from './context';
import { ADDITIVE_HELP, convexWarning, pointRows, quadTitle, rotateButton } from './mappingSection';

/** How often the transport and the playing highlight refresh (playback doesn't emit store events). */
const TRANSPORT_POLL_MS = 250;

const ENTRY_COLOR = '#FF9F0A';
const DISABLED_COLOR = '#555555';
const BLEND_LABELS: Record<BlendMode, string> = { normal: 'Normal', add: 'Additive', alpha: 'Alpha (PNG / WebM alpha)' };
const STYLE_LABELS: Record<TransitionInStyle, string> = { noise: 'Noise Dissolve', fade: 'Simple Fade' };

/**
 * Choreographed mode: the transport, the default crossfade, and the entries, each a timed
 * scene of its own frames. Shown only in a choreographed show.
 */
export function choreographySection(ctx: PanelContext): HTMLElement {
  const { store, binder } = ctx;
  const engine = ctx.playback.choreo.engine;
  const ch = () => store.config.choreography;

  // ----- transport -----
  const nowName = h('div', { class: 'now-playing' });
  const bar = h('div', { class: 'progress' }, [h('div', { class: 'progress-fill' })]);
  const fill = bar.firstElementChild as HTMLElement;
  const prev = button('⏮ Previous', () => engine.previous(), 'small');
  prev.title = 'Crossfade to the previous entry';
  const next = button('Next ⏭', () => engine.next(), 'small');
  next.title = 'Crossfade to the next entry (N)';
  const jump = h('select', { class: 'select' });
  jump.addEventListener('change', () => {
    if (jump.value) engine.jumpTo(jump.value);
    jump.value = '';
    jump.blur();
  });
  const resume = button('Resume playlist', () => engine.resume(), 'small primary');
  resume.title = 'End the preview: the sequence continues after the previewed entry';
  const tick = () => {
    const run = engine.current;
    const i = run ? ch().entries.findIndex((e) => e.id === run.id) : -1;
    const name = store.findEntry(run?.id ?? '')?.name ?? run?.snapshot.name ?? '';
    nowName.textContent = run ? `${engine.previewId ? 'Previewing' : 'Now playing'}: ${i >= 0 ? entryLabel(i, name) : name}` : 'Nothing playable.';
    const dur = run ? engine.duration(run) : null;
    fill.style.width = run && dur ? `${Math.min(100, (run.clock / dur) * 100)}%` : '0%';
    resume.hidden = !engine.previewId;
    for (const [id, el] of entryEls) el.classList.toggle('playing', id === run?.id);
  };
  const timer = window.setInterval(() => {
    if (!nowName.isConnected) return void window.clearInterval(timer);
    if (store.runtime.panelOpen && store.config.showType === 'choreographed') tick();
  }, TRANSPORT_POLL_MS);
  binder.add(() => {
    const sig = ch().entries.map((e) => `${e.id}:${e.name}`).join('|');
    if (jump.dataset.sig === sig) return;
    jump.dataset.sig = sig;
    jump.replaceChildren(
      Object.assign(h('option', { text: 'Jump to entry…' }), { value: '' }),
      ...ch().entries.map((e, i) => Object.assign(h('option', { text: entryLabel(i, e.name) }), { value: e.id })),
    );
  });

  const transport = h('div', { class: 'transport' }, [
    nowName,
    bar,
    h('div', { class: 'button-row' }, [prev, next, resume]),
    row('Jump', jump),
  ]);

  const crossfade = withHelp(
    sliderRow(binder, 'Crossfade (s)', { get: () => ch().crossfade, set: (v) => store.setChoreography({ crossfade: v }), min: 0, step: 0.1, decimals: 1, sliderMin: 0, sliderMax: 10 }),
    'Default seconds of crossfade into each entry (an entry can set its own Fade in). The list loops, so the last entry crossfades into the first.',
  );

  // ----- entries (rebuilt when the list changes) -----
  const entriesEl = h('div', { class: 'entries' });
  const entriesBinder = new Binder();
  const entryEls = new Map<string, HTMLElement>();
  let signature = '';
  const rebuild = () => {
    const sig = ch().entries.map((e) => `${e.id}:${e.frames.map((f) => f.id).join('.')}`).join(',');
    if (sig === signature) return;
    signature = sig;
    entriesBinder.clear();
    entryEls.clear();
    entriesEl.replaceChildren(...ch().entries.map((e, i) => {
      const el = entrySection(ctx, entriesBinder, e.id, i);
      entryEls.set(e.id, el);
      return el;
    }));
    if (ch().entries.length === 0) entriesEl.append(h('div', { class: 'muted', text: 'No entries yet. Add one, then add frames to it.' }));
  };

  const add = button('+ Add entry', () => {
    const id = store.addEntry();
    ctx.openState.set(`entry:${id}`, true);
    store.setEditedEntry(id);
  }, 'wide');
  add.title = 'Add an entry at the end of the list';

  const el = section(ctx.openState, 'choreography', 'Choreography', [
    section(ctx.openState, 'transport', 'Transport', [transport], { defaultOpen: true }),
    crossfade,
    entriesEl,
    add,
  ], { defaultOpen: true });
  binder.add(() => {
    el.hidden = store.config.showType !== 'choreographed';
    if (el.hidden) return;
    rebuild();
    entriesBinder.syncAll();
  });
  return el;
}

function entrySection(ctx: PanelContext, b: Binder, id: string, index: number): HTMLElement {
  const { store } = ctx;
  const engine = ctx.playback.choreo.engine;
  const entry = () => store.findEntry(id);
  const update = (patch: EntrySettings) => store.updateEntry(id, patch);
  const last = store.config.choreography.entries.length - 1;

  const up = button('↑', () => store.moveEntry(id, index - 1), 'small');
  up.title = 'Move up (plays earlier)';
  up.disabled = index === 0;
  const down = button('↓', () => store.moveEntry(id, index + 1), 'small');
  down.title = 'Move down (plays later)';
  down.disabled = index === last;
  const dup = button('Duplicate', () => {
    const copy = store.duplicateEntry(id);
    if (copy) ctx.openState.set(`entry:${copy}`, true);
  }, 'small');
  dup.title = 'Copy this entry (with its frames) just below it';
  const remove = button('Remove', () => store.removeEntry(id), 'danger small');
  remove.title = 'Remove this entry (no confirmation)';

  const title = quadTitle(() => entryLabel(index, entry()?.name ?? ''), () => (entry()?.enabled ? ENTRY_COLOR : DISABLED_COLOR), b);
  const idRow = h('div', { class: 'quad-id', text: `ID: ${id}`, title: 'Entry id in config.json (not editable)' });

  const preview = button('Preview', () => engine.preview(id), 'small');
  preview.title = 'Jump here and keep this entry on screen, restarting it each time it ends, until Resume playlist';
  const warnings = h('div', { class: 'warning' });
  b.add(() => {
    const e = entry();
    if (!e) return;
    const v = validateEntry(
      e,
      (f) => ctx.playback.choreo.frameStatus(f),
      (i) => frameLabel(i, e.frames[i]?.title ?? ''),
      (f) => store.isQuadValid(f.id),
    );
    warnings.hidden = v.warnings.length === 0;
    warnings.replaceChildren(...v.warnings.map((w) => h('div', { text: `⚠ ${w}` })));
  });

  const el = section(ctx.openState, `entry:${id}`, title, [
    idRow,
    h('div', { class: 'button-row' }, [preview]),
    warnings,
    textRow(b, 'Name', { get: () => entry()?.name ?? '', set: (v) => update({ name: v }) }),
    withHelp(checkboxRow(b, 'Enabled', () => !!entry()?.enabled, (v) => update({ enabled: v })), 'Off: the sequence skips this entry (Preview still plays it).'),
    withHelp(
      nullableNumberRow(b, 'Hold time (s)', 'until the last frame ends', () => entry()?.holdTime ?? null, (v) => update({ holdTime: v }), 30, 1, 0.1),
      'Set: the entry lasts exactly this long; looping frames loop until then, and anything still playing is cut by the crossfade. Unset: it lasts until its last frame finishes.',
    ),
    withHelp(
      nullableNumberRow(b, 'Fade in (s)', 'choreography default', () => entry()?.fadeTime ?? null, (v) => update({ fadeTime: v }), store.config.choreography.crossfade, 0.1, 0),
      'Seconds of crossfade into this entry from the one before. Unset: the Crossfade above.',
    ),
    frameEditor(ctx, b, id),
  ], { class: 'quad entry', headerExtras: [up, down, dup, remove] });
  // The most recently opened entry is the edited one: its frames get handles.
  el.addEventListener('toggle', () => {
    if (el.open) store.setEditedEntry(id);
    else if (store.runtime.editedEntryId === id) store.setEditedEntry(null);
  });
  return el;
}

/** A number that can be unset (null): a checkbox enables it; unset shows the fallback text. */
function nullableNumberRow(
  b: Binder,
  label: string,
  unsetText: string,
  get: () => number | null,
  set: (v: number | null) => void,
  def: number,
  step: number,
  min: number,
): HTMLElement {
  const on = h('input', { type: 'checkbox' });
  on.addEventListener('change', () => {
    set(on.checked ? def : null);
    on.blur();
  });
  const num = numberInput(b, { get: () => get() ?? def, set: (v) => set(v), min, step, decimals: 2 });
  const unset = h('span', { class: 'muted', text: unsetText });
  b.add(() => {
    const v = get();
    on.checked = v !== null;
    num.hidden = v === null;
    unset.hidden = v !== null;
  });
  return row(label, on, num, unset);
}

// ---------- frames ----------

function frameEditor(ctx: PanelContext, b: Binder, entryId: string): HTMLElement {
  const { store } = ctx;
  const list = store.findEntry(entryId)?.frames ?? [];
  const add = button('+ Add frame', () => {
    const id = store.addChoreoFrame(entryId);
    if (id) ctx.openState.set(`cframe:${id}`, true);
    store.setEditedEntry(entryId);
  }, 'wide');
  add.title = 'Add a frame to this entry, centered on the canvas; it draws on top of the ones above it';
  return h('div', { class: 'choreo-frames' }, [
    h('div', { class: 'subhead', text: 'Frames (later frames draw on top)' }),
    ...list.map((f, i) => frameSection(ctx, b, f.id, i, list.length)),
    list.length === 0 ? h('div', { class: 'muted', text: 'No frames.' }) : null,
    add,
  ]);
}

function frameSection(ctx: PanelContext, b: Binder, id: string, index: number, count: number): HTMLElement {
  const { store } = ctx;
  const choreo = ctx.playback.choreo;
  const f = () => store.findChoreoFrame(id)?.frame ?? null;
  const set = (patch: ChoreoFrameSettings) => store.updateChoreoFrame(id, patch);
  const up = button('↑', () => store.moveChoreoFrame(id, index - 1), 'small');
  up.title = 'Move up (draws under the frames below it)';
  up.disabled = index === 0;
  const down = button('↓', () => store.moveChoreoFrame(id, index + 1), 'small');
  down.title = 'Move down (draws over the frames above it)';
  down.disabled = index === count - 1;
  const dup = button('Duplicate', () => {
    const copy = store.duplicateChoreoFrame(id);
    if (copy) ctx.openState.set(`cframe:${copy}`, true);
  }, 'small');
  dup.title = 'Copy this frame just below it';
  const remove = button('Remove', () => store.removeChoreoFrame(id), 'danger small');
  remove.title = 'Remove this frame (no confirmation)';
  const idRow = h('div', { class: 'quad-id', text: `ID: ${id}`, title: 'Frame id in config.json (not editable)' });

  const blend = withHelp(
    selectRow<BlendMode>(b, 'Blend', BLEND_MODES.map((m) => [m, BLEND_LABELS[m]] as const), () => f()?.blend ?? 'normal', (v) => set({ blend: v })),
    `Normal: covers what's behind it; while it fades, what's behind shows through. Additive: ${ADDITIVE_HELP} ` +
      "Alpha: covers by the asset's own transparency (a PNG, or a WebM VP9 video with alpha).",
  );
  const match = button('Match asset', () => {
    const m = choreo.frameMedia(id);
    if (m) set({ physicalAspect: Math.round(m.aspect * 10000) / 10000 });
  }, 'small');
  match.title = "Set the physical aspect to the asset's own (once it has loaded: while its entry is on screen or up next)";
  b.add(() => (match.disabled = !choreo.frameMedia(id)));
  const aspect = row('Physical aspect (w÷h)', numberInput(b, { get: () => f()?.physicalAspect ?? 1, set: (v) => set({ physicalAspect: v }), min: 0.05, max: 20, step: 0.0001, decimals: 4 }), match);

  const sec = { min: 0, step: 0.1, decimals: 2 };
  return section(ctx.openState, `cframe:${id}`, quadTitle(() => frameLabel(index, f()?.title ?? ''), () => f()?.debugColor ?? '#ffffff', b), [
    idRow,
    textRow(b, 'Title', { get: () => f()?.title ?? '', set: (v) => set({ title: v }), placeholder: 'Untitled' }),
    colorCheckRow(b, 'Debug color', () => f()?.debugColor ?? '#ffffff', (v) => set({ debugColor: v })),
    withHelp(checkboxRow(b, 'Test pattern', () => store.isTestPatternOn(id), (v) => store.setTestPattern(id, v)), 'A grid in place of the asset, for mapping: its cells should be square on the wall (if not, fix Physical aspect).'),
    blend,
    pointRows(ctx, b, id),
    rotateButton(ctx, id, false),
    aspect,
    convexWarning(ctx, b, id),
    assetSlot(ctx, b, id),
    withHelp(numberRow(b, 'Delay (s)', { ...sec, get: () => f()?.delay ?? 0, set: (v) => set({ delay: v }) }), 'Seconds after the entry starts before this frame begins.'),
    withHelp(
      nullableNumberRow(b, 'Duration (s)', 'video: its own length; image: until the entry ends', () => f()?.duration ?? null, (v) => set({ duration: v }), 10, 0.5, 0.1),
      'Unset: a video plays its own length; an image lasts until the entry ends (10 s if the entry has no Hold time).',
    ),
    withHelp(checkboxRow(b, 'Loop', () => !!f()?.loop, (v) => set({ loop: v })), "A video starts over each time it ends, until its Duration or the entry's end. Needs the entry's Hold time."),
    withHelp(numberRow(b, 'Fade in (s)', { ...sec, get: () => f()?.fadeIn ?? 0, set: (v) => set({ fadeIn: v }) }), 'How long this frame takes to appear, in its Fade-in style.'),
    withHelp(
      selectRow<TransitionInStyle>(b, 'Fade-in style', TRANSITION_IN_STYLES.map((s) => [s, STYLE_LABELS[s]] as const).reverse(), () => f()?.fadeInStyle ?? 'noise', (v) => set({ fadeInStyle: v })),
      'Noise Dissolve: appears through soft, spreading blotches (Animation → Dissolve softness and Noise Scale shape them). Simple Fade: the whole frame fades up. Its fade out is always a plain fade.',
    ),
    withHelp(numberRow(b, 'Fade out (s)', { ...sec, get: () => f()?.fadeOut ?? 0, set: (v) => set({ fadeOut: v }) }), "How long this frame fades out, ending at its end. An image that lasts until the entry's end doesn't fade out; the crossfade takes it away."),
    sliderRow(b, 'Opacity', { get: () => f()?.opacity ?? 1, set: (v) => set({ opacity: v }), min: 0, max: 1, step: 0.01, decimals: 2, sliderMin: 0, sliderMax: 1 }),
    withHelp(
      checkboxRow(b, 'Solo (draw only this frame)', () => store.runtime.soloFrameId === id, (v) => store.setSolo(v ? id : null)),
      'Hides every other choreographed frame while you map this one. Not saved: it ends on reload.',
    ),
  ], { class: 'quad', headerExtras: [up, down, dup, remove] });
}

/** One asset: thumbnail and name; clicking opens the picker. Files dropped on it import and assign. */
function assetSlot(ctx: PanelContext, b: Binder, id: string): HTMLElement {
  const { store, thumbs, project } = ctx;
  const f = () => store.findChoreoFrame(id)?.frame ?? null;
  const slot = h('button', { class: 'asset-slot', type: 'button' });
  const result = h('div', { class: 'message' });
  result.hidden = true;
  const onImport = (res: ImportResult | null) => {
    if (!res) return;
    const [first] = picker.itemsFrom(res);
    if (first) {
      store.updateChoreoFrame(id, { asset: first });
      picker.el.hidden = true;
    }
    if (res.skipped.length) showNote(result, `Skipped ${res.skipped.length}: ${res.skipped.join('; ')}`, 'warn', true);
  };
  const picker = assetPicker(ctx, b, {
    allowWallOnly: false,
    onPick: (item) => {
      store.updateChoreoFrame(id, { asset: item });
      picker.el.hidden = true;
    },
    onImport,
    importTitle: 'Choose an image or video from your computer. It joins an asset pool and this frame.',
    pickVerb: 'Choose',
  });
  picker.el.hidden = true;
  slot.title = 'Choose the asset this frame plays';
  slot.addEventListener('click', () => {
    picker.el.hidden = !picker.el.hidden;
    if (!picker.el.hidden) picker.sync();
  });
  const clear = button('×', () => store.updateChoreoFrame(id, { asset: null }), 'small danger');
  clear.title = 'Clear the asset (the frame draws nothing)';

  let sig = '';
  b.add(() => {
    const frame = f();
    if (!frame) return;
    const status = ctx.playback.choreo.frameStatus(frame);
    const next = `${frame.asset?.pool}|${frame.asset?.filepath}|${status}`;
    clear.hidden = !frame.asset;
    if (next === sig) return;
    sig = next;
    if (!frame.asset) {
      slot.replaceChildren(h('span', { class: 'thumb', text: '+' }), h('span', { class: 'asset-name', text: 'Choose asset…' }));
      return;
    }
    const asset = frame.asset;
    const found = store.pools.find((m) => m.path === asset.pool)?.assets.find((a) => a.entry.filepath === asset.filepath);
    const thumb = found ? thumbs.slot(found.uid) : h('span', { class: 'thumb', text: '?' });
    if (found) thumbs.request(found.uid);
    const BADGES = { missing: 'missing', error: 'failed', wallOnly: 'wall only' } as const;
    const badge = status === 'ok' || status === 'empty' ? null : h('span', { class: 'badge error', text: BADGES[status] });
    const kind = mediaKind(asset.filepath) ?? 'unsupported';
    const name = h('span', { class: 'asset-name', text: `${found?.entry.title?.trim() || fileName(asset.filepath)} · ${kind}`, title: `${asset.pool} → ${asset.filepath}` });
    slot.replaceChildren(thumb, name, ...(badge ? [badge] : []));
  });

  const block = h('div', { class: 'asset-block' }, [
    h('div', { class: 'subhead', text: 'Asset' }),
    h('div', { class: 'asset-slot-row' }, [slot, clear]),
    result,
    picker.el,
  ]);
  dropZone(block, (dt) => void project.importDrop(picker.targetPool(), dt).then(onImport), () => true);
  return block;
}
