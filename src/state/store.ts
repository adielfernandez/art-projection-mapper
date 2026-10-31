import { quadIsValid, rotateQuadClockwise } from '../math/geometry';
import type { Quad } from '../math/homography';
import { generateEntryId, generateFrameId, newChoreoFrame, newEntry, newFrame, nextFrameColor } from './defaults';
import {
  WALL_QUAD_ID,
  type AnimationConfig,
  type AssetEntry,
  type AssetRecord,
  type CaptionConfig,
  type ChoreoFrameConfig,
  type ChoreographyConfig,
  type Config,
  type Corners,
  type DebugStyle,
  type EntryConfig,
  type FrameConfig,
  type PoolRecord,
  type NormPoint,
  type PanelSide,
  type PlaylistItem,
  type QuadId,
  type ShowType,
} from './schema';

export type CornerIndex = 0 | 1 | 2 | 3;
export const CORNER_NAMES = ['TL', 'TR', 'BR', 'BL'] as const;

export interface PointRef {
  quadId: QuadId;
  index: CornerIndex;
}

/** Runtime-only state. Never saved. */
export interface RuntimeState {
  selected: PointRef | null;
  debugVisible: boolean;
  panelOpen: boolean;
  /** Show paused: the animation clock and videos stop; rendering and edits continue. */
  paused: boolean;
  /** Per-quad test pattern toggles; missing entries use TEST_PATTERN_DEFAULT. */
  testPattern: Record<QuadId, boolean>;
  configDirty: boolean;
  assetsDirty: boolean;
  /** Canvas size in device pixels. */
  viewport: { w: number; h: number };
  /** Name of the open project folder, or null when none is open. */
  folderName: string | null;
  /** Name of the remembered folder that can be reopened, or null. */
  reopenName: string | null;
  /** Latest project I/O status for the Config section. */
  ioMessage: IoMessage | null;
  /** Latest asset save status for the Assets section. */
  assetMessage: IoMessage | null;
  /** Media load errors by asset uid. Flagged assets are never played. */
  assetErrors: Record<string, string>;
  /** Choreographed mode: the most recently opened entry section. Only its frames get handles. */
  editedEntryId: string | null;
  /** Choreographed mode: draw only this frame (while mapping it). */
  soloFrameId: string | null;
}

export interface IoMessage {
  kind: 'info' | 'warn' | 'error';
  text: string;
  /** Extra lines, e.g. config validation warnings. */
  details?: string[];
}

/** Test patterns are off unless toggled on in the panel. */
export const TEST_PATTERN_DEFAULT = false;

export interface StoreEvent {
  /** Quads whose corners changed. */
  corners: ReadonlySet<QuadId>;
  /** Frame lists (mapped or choreographed), entries, or their non-corner settings changed. */
  frames: boolean;
  /** Any other config change (global, animation, ...). */
  config: boolean;
  runtime: boolean;
  viewport: boolean;
  /** Pools, asset entries or asset errors changed. */
  assets: boolean;
}

export type Listener = (e: StoreEvent) => void;

/** Homomorphic, so tuples (e.g. corner points) stay tuples. */
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type FrameSettings = Partial<Pick<FrameConfig, 'title' | 'physicalAspect' | 'debugColor' | 'captionSpacing' | 'captionOffsetX' | 'blend'>>;
export type ChoreoFrameSettings = Partial<Omit<ChoreoFrameConfig, 'id' | 'corners'>>;
export type EntrySettings = Partial<Omit<EntryConfig, 'id' | 'frames'>>;

/** A choreographed frame with its entry and positions. */
export interface ChoreoFrameRef {
  entry: DeepReadonly<EntryConfig>;
  frame: DeepReadonly<ChoreoFrameConfig>;
  /** Positions in the entry list and in the entry's frames. */
  entryIndex: number;
  index: number;
}

interface PointChange {
  index: CornerIndex;
  before: NormPoint;
  after: NormPoint;
}

/** One undo step: a single point, or all four corners of a whole-quad move. */
interface MappingEdit {
  quadId: QuadId;
  points: PointChange[];
  kind: 'drag' | 'nudge' | 'set';
  /** performance.now() of the last change merged into this edit. */
  time: number;
}

type PendingEvent = { corners: Set<QuadId>; frames: boolean; config: boolean; runtime: boolean; viewport: boolean; assets: boolean };

const NUDGE_MERGE_MS = 500;
const MAX_HISTORY = 500;

function samePoint(a: PointRef | null, b: PointRef | null): boolean {
  return !!a && !!b && a.quadId === b.quadId && a.index === b.index;
}

export class Store {
  private _config: Config;
  private _runtime: RuntimeState;
  private _pools: PoolRecord[] = [];
  private listeners = new Set<Listener>();
  private undoStack: MappingEdit[] = [];
  private redoStack: MappingEdit[] = [];
  /** Corners of the quad being dragged (one point or the whole quad), as they were at drag start. */
  private drag: { quadId: QuadId; before: NormPoint[] } | null = null;
  private pending: PendingEvent | null = null;
  /**
   * Runtime-only identity for each playlist entry, parallel to frame.playlist. Lets the
   * scheduler follow an entry through reorders, and tell duplicate entries apart.
   */
  private playlistKeyMap = new Map<QuadId, number[]>();
  private nextPlaylistKey = 1;

  constructor(config: Config, viewport: { w: number; h: number }) {
    this._config = config;
    this._runtime = {
      selected: null,
      debugVisible: true,
      panelOpen: false,
      paused: false,
      testPattern: {},
      configDirty: false,
      assetsDirty: false,
      viewport: { ...viewport },
      folderName: null,
      reopenName: null,
      ioMessage: null,
      assetMessage: null,
      assetErrors: {},
      editedEntryId: null,
      soloFrameId: null,
    };
  }

  get config(): DeepReadonly<Config> {
    return this._config;
  }

  get runtime(): DeepReadonly<RuntimeState> {
    return this._runtime;
  }

  /** Pool portion of the project state. */
  get pools(): DeepReadonly<PoolRecord[]> {
    return this._pools;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---------- queries ----------

  /**
   * Quads with handles, outlines and Tab stops, in order, then the wall quad. Randomized: the
   * mapped frames. Choreographed: the edited entry's frames.
   */
  allQuadIds(): QuadId[] {
    return [...this.handledFrames().map((f) => f.id), WALL_QUAD_ID];
  }

  /** The frames on the canvas for mapping (see allQuadIds), in draw order. */
  handledFrames(): readonly DeepReadonly<{ id: string; title: string; corners: Corners; debugColor: string }>[] {
    if (this._config.showType === 'randomized') return this._config.frames;
    return this.editedEntry()?.frames ?? [];
  }

  /** The edited entry (Choreographed mode), if any. */
  editedEntry(): DeepReadonly<EntryConfig> | null {
    const id = this._runtime.editedEntryId;
    return id ? this.findEntry(id) : null;
  }

  findEntry(id: string): DeepReadonly<EntryConfig> | null {
    return this._config.choreography.entries.find((e) => e.id === id) ?? null;
  }

  findChoreoFrame(id: string): ChoreoFrameRef | null {
    const entries = this._config.choreography.entries;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const entry = entries[entryIndex]!;
      const index = entry.frames.findIndex((f) => f.id === id);
      if (index >= 0) return { entry, frame: entry.frames[index]!, entryIndex, index };
    }
    return null;
  }

  /** Every frame id in the show, mapped and choreographed (ids are unique across both). */
  allFrameIds(): string[] {
    return [...this._config.frames.map((f) => f.id), ...this._config.choreography.entries.flatMap((e) => e.frames.map((f) => f.id))];
  }

  getCorners(quadId: QuadId): DeepReadonly<Corners> | null {
    return this.mutableCorners(quadId);
  }

  /** Convex and non-degenerate at the current viewport. Invalid quads keep their last valid mapping. */
  isQuadValid(quadId: QuadId): boolean {
    const c = this.mutableCorners(quadId);
    return !!c && quadIsValid(c as unknown as Quad, this._runtime.viewport);
  }

  isTestPatternOn(quadId: QuadId): boolean {
    return this._runtime.testPattern[quadId] ?? TEST_PATTERN_DEFAULT;
  }

  frameIndex(id: QuadId): number {
    return this._config.frames.findIndex((f) => f.id === id);
  }

  /** Runtime keys of a frame's playlist entries, index-aligned with frame.playlist. */
  playlistKeys(frameId: QuadId): readonly number[] {
    return this.mutablePlaylistKeys(frameId) ?? [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  findAsset(uid: string): { pool: DeepReadonly<PoolRecord>; entry: DeepReadonly<AssetEntry> } | null {
    for (const m of this._pools) {
      const a = m.assets.find((x) => x.uid === uid);
      if (a) return { pool: m, entry: a.entry };
    }
    return null;
  }

  /** Choreographed frames (by id) and the wall (WALL_QUAD_ID) that use this asset, by pool and filepath. */
  framesUsingAsset(uid: string): QuadId[] {
    const found = this.findAsset(uid);
    if (!found) return [];
    return this.assetRefs()
      .filter((o) => o.items.some((item) => item.pool === found.pool.path && item.filepath === found.entry.filepath))
      .map((o) => o.id);
  }

  /** Every asset reference: each choreographed frame's asset, then the wallpaper playlist (WALL_QUAD_ID). */
  private assetRefs(): { id: QuadId; items: PlaylistItem[] }[] {
    const out: { id: QuadId; items: PlaylistItem[] }[] = [];
    for (const e of this._config.choreography.entries) for (const f of e.frames) if (f.asset) out.push({ id: f.id, items: [f.asset] });
    out.push({ id: WALL_QUAD_ID, items: this._config.wallQuad.playlist });
    return out;
  }

  /** Snapshot of one pool, for saving. */
  poolSnapshot(path: string): PoolRecord | null {
    const m = this._pools.find((x) => x.path === path);
    return m ? structuredClone(m) : null;
  }

  /** Snapshot of the persisted config, for saving. */
  configSnapshot(): Config {
    return structuredClone(this._config);
  }

  // ---------- project actions ----------

  /** Replace the whole config (project load / default project). Clears undo history and the config dirty flag. */
  replaceConfig(config: Config, folderName: string | null): void {
    this._config = structuredClone(config);
    this.playlistKeyMap.clear();
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.drag = null;
    this._runtime.selected = null;
    this._runtime.testPattern = {};
    this._runtime.soloFrameId = null;
    if (this._runtime.editedEntryId && !this.findEntry(this._runtime.editedEntryId)) this._runtime.editedEntryId = null;
    this._runtime.configDirty = false;
    this._runtime.folderName = folderName;
    this.emit((e) => {
      for (const id of [...this.allFrameIds(), WALL_QUAD_ID]) e.corners.add(id);
      e.frames = e.config = e.runtime = true;
    });
  }

  setFolderName(name: string | null): void {
    if (this._runtime.folderName === name) return;
    this._runtime.folderName = name;
    this.emit((e) => (e.runtime = true));
  }

  setReopenName(name: string | null): void {
    if (this._runtime.reopenName === name) return;
    this._runtime.reopenName = name;
    this.emit((e) => (e.runtime = true));
  }

  setIoMessage(msg: IoMessage | null): void {
    this._runtime.ioMessage = msg;
    this.emit((e) => (e.runtime = true));
  }

  // ---------- asset actions ----------

  /** Replace all pools (project load). Clears asset errors and the assets dirty flag. */
  setPools(pools: PoolRecord[]): void {
    this._pools = structuredClone(pools);
    this._runtime.assetErrors = {};
    this._runtime.assetsDirty = false;
    this._runtime.assetMessage = null;
    this.emit((e) => (e.assets = e.runtime = true));
  }

  /**
   * Live edit of an asset entry. Marks its pool modified. A new filepath clears the asset's
   * error, and frames and playlist entries pointing at the old filepath follow it (marking the config modified).
   */
  updateAsset(uid: string, patch: Partial<AssetEntry>): void {
    for (const m of this._pools) {
      const a = m.assets.find((x) => x.uid === uid);
      if (!a) continue;
      const oldPath = a.entry.filepath;
      const pathChanged = patch.filepath !== undefined && patch.filepath !== oldPath;
      Object.assign(a.entry, patch);
      m.dirty = true;
      if (pathChanged) {
        delete this._runtime.assetErrors[uid];
        let followed = false;
        for (const ref of this.assetRefs()) {
          for (const item of ref.items) {
            if (item.pool === m.path && item.filepath === oldPath) {
              item.filepath = a.entry.filepath;
              followed = true;
            }
          }
        }
        if (followed) {
          this.markConfigDirty();
          this.emit((e) => (e.frames = true));
        }
      }
      this._runtime.assetsDirty = true;
      this.emit((e) => (e.assets = e.runtime = true));
      return;
    }
  }

  /** Append new assets to a pool (marking it modified). */
  addAssets(poolPath: string, records: readonly AssetRecord[]): void {
    const m = this._pools.find((x) => x.path === poolPath);
    if (!m || records.length === 0) return;
    m.assets.push(...structuredClone(records as AssetRecord[]));
    m.dirty = true;
    this._runtime.assetsDirty = true;
    // In a randomized show the frames play the pools directly, so their test patterns go off.
    // (The wall only plays its own playlist.)
    if (this._config.showType === 'randomized') this.hideTestPatterns(this._config.frames.map((f) => f.id));
    this.emit((e) => (e.assets = e.runtime = true));
  }

  /**
   * Remove an asset from its pool (marking it modified). The media file is not touched.
   * Frames and playlist entries that pointed at it are kept and show as missing.
   */
  removeAsset(uid: string): void {
    for (const m of this._pools) {
      const i = m.assets.findIndex((x) => x.uid === uid);
      if (i < 0) continue;
      m.assets.splice(i, 1);
      m.dirty = true;
      delete this._runtime.assetErrors[uid];
      this._runtime.assetsDirty = true;
      this.emit((e) => (e.assets = e.runtime = true));
      return;
    }
  }

  /** Add an asset pool to the show: listed in config.assetPools (config modified) and loaded. */
  addPool(pool: PoolRecord): void {
    if (this._pools.some((x) => x.path === pool.path)) return;
    this._pools.push(structuredClone(pool));
    if (!this._config.assetPools.includes(pool.path)) this._config.assetPools.push(pool.path);
    if (pool.dirty) this._runtime.assetsDirty = true;
    this.markConfigDirty();
    this.emit((e) => (e.assets = e.config = e.runtime = true));
  }

  /**
   * Remove an asset pool from the show (dropped from config.assetPools; config modified).
   * The pool file and its media stay on disk. Playlist entries that used it show as missing.
   */
  removePool(path: string): void {
    const i = this._pools.findIndex((x) => x.path === path);
    if (i < 0) return;
    const [removed] = this._pools.splice(i, 1);
    for (const a of removed!.assets) delete this._runtime.assetErrors[a.uid];
    this._config.assetPools = this._config.assetPools.filter((p) => p !== path);
    this._runtime.assetsDirty = this._pools.some((x) => x.dirty);
    this.markConfigDirty();
    this.emit((e) => (e.assets = e.config = e.runtime = true));
  }

  /** Choreographed frames (by id) and the wall (WALL_QUAD_ID) that use any asset of this pool. */
  framesUsingPool(path: string): QuadId[] {
    return this.assetRefs().filter((o) => o.items.some((item) => item.pool === path)).map((o) => o.id);
  }

  setAssetError(uid: string, message: string | null): void {
    const cur = this._runtime.assetErrors[uid];
    if (message === null ? cur === undefined : cur === message) return;
    if (message === null) delete this._runtime.assetErrors[uid];
    else this._runtime.assetErrors[uid] = message;
    this.emit((e) => (e.assets = e.runtime = true));
  }

  markPoolSaved(path: string): void {
    const m = this._pools.find((x) => x.path === path);
    if (m) m.dirty = false;
    this._runtime.assetsDirty = this._pools.some((x) => x.dirty);
    this.emit((e) => (e.assets = e.runtime = true));
  }

  setAssetMessage(msg: IoMessage | null): void {
    this._runtime.assetMessage = msg;
    this.emit((e) => (e.runtime = true));
  }

  markConfigSaved(): void {
    if (!this._runtime.configDirty) return;
    this._runtime.configDirty = false;
    this.emit((e) => (e.runtime = true));
  }

  // ---------- mapping actions ----------

  /** Set a point directly (no undo entry unless inside a drag, which records on endDrag). */
  setPoint(ref: PointRef, p: NormPoint): void {
    const corners = this.mutableCorners(ref.quadId);
    if (!corners) return;
    const cur = corners[ref.index];
    if (cur[0] === p[0] && cur[1] === p[1]) return;
    corners[ref.index] = [p[0], p[1]];
    this.markConfigDirty();
    this.emit((e) => e.corners.add(ref.quadId));
  }

  /** Set all four corners at once (whole-quad drag; no undo entry, recorded on endDrag). */
  setCorners(quadId: QuadId, points: readonly NormPoint[]): void {
    const corners = this.mutableCorners(quadId);
    if (!corners) return;
    let changed = false;
    for (const i of [0, 1, 2, 3] as CornerIndex[]) {
      const p = points[i];
      if (!p || (corners[i][0] === p[0] && corners[i][1] === p[1])) continue;
      corners[i] = [p[0], p[1]];
      changed = true;
    }
    if (!changed) return;
    this.markConfigDirty();
    this.emit((e) => e.corners.add(quadId));
  }

  /** Turn a quad 90° clockwise about its center, kept inside the viewport. One undo step. */
  rotateQuad(quadId: QuadId): void {
    const corners = this.mutableCorners(quadId);
    if (!corners) return;
    const before = corners.map((p) => [p[0], p[1]] as NormPoint);
    const after = rotateQuadClockwise(before, this._runtime.viewport) as NormPoint[];
    this.drag = null;
    this.setCorners(quadId, after);
    const points: PointChange[] = before.map((b, i) => ({ index: i as CornerIndex, before: b, after: after[i]! }));
    this.pushEdit({ quadId, points, kind: 'set', time: performance.now() });
  }

  /** Set a point as its own undo step (numeric input). */
  movePoint(ref: PointRef, p: NormPoint): void {
    const cur = this.mutableCorners(ref.quadId)?.[ref.index];
    if (!cur || (cur[0] === p[0] && cur[1] === p[1])) return;
    this.pushEdit({ quadId: ref.quadId, points: [{ index: ref.index, before: [cur[0], cur[1]], after: [p[0], p[1]] }], kind: 'set', time: performance.now() });
    this.setPoint(ref, p);
  }

  /** Start a drag of one point, or of the whole quad. endDrag() records whatever moved as one undo step. */
  beginDrag(ref: PointRef): void;
  beginDrag(quadId: QuadId): void;
  beginDrag(target: PointRef | QuadId): void {
    const quadId = typeof target === 'string' ? target : target.quadId;
    const corners = this.mutableCorners(quadId);
    if (!corners) return;
    this.drag = { quadId, before: corners.map((c) => [c[0], c[1]] as NormPoint) };
  }

  endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const now = this.mutableCorners(d.quadId);
    if (!now) return;
    const points: PointChange[] = [];
    d.before.forEach((before, i) => {
      const after = now[i]!;
      if (after[0] !== before[0] || after[1] !== before[1]) {
        points.push({ index: i as CornerIndex, before, after: [after[0], after[1]] });
      }
    });
    if (points.length) this.pushEdit({ quadId: d.quadId, points, kind: 'drag', time: performance.now() });
  }

  /** Move a point by a delta in device pixels. Bursts on the same point merge into one undo step. */
  nudge(ref: PointRef, dxPx: number, dyPx: number): void {
    const corners = this.mutableCorners(ref.quadId);
    if (!corners) return;
    const { w, h } = this._runtime.viewport;
    const before: NormPoint = [...corners[ref.index]];
    const after: NormPoint = [before[0] + dxPx / w, before[1] + dyPx / h];
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    const topPoint = top?.points.length === 1 ? { quadId: top.quadId, index: top.points[0]!.index } : null;
    if (top && top.kind === 'nudge' && samePoint(topPoint, ref) && now - top.time <= NUDGE_MERGE_MS && this.redoStack.length === 0) {
      top.points[0]!.after = after;
      top.time = now;
    } else {
      this.pushEdit({ quadId: ref.quadId, points: [{ index: ref.index, before, after }], kind: 'nudge', time: now });
    }
    this.setPoint(ref, after);
  }

  undo(): void {
    this.drag = null;
    for (;;) {
      const edit = this.undoStack.pop();
      if (!edit) return;
      if (!this.mutableCorners(edit.quadId)) continue; // quad was removed
      this.redoStack.push(edit);
      this.applyEdit(edit, 'before');
      return;
    }
  }

  redo(): void {
    this.drag = null;
    for (;;) {
      const edit = this.redoStack.pop();
      if (!edit) return;
      if (!this.mutableCorners(edit.quadId)) continue;
      edit.time = 0; // never merge further nudges into a redone edit
      this.undoStack.push(edit);
      this.applyEdit(edit, 'after');
      return;
    }
  }

  /** Apply one side of an edit. Single-point edits also select that point; whole-quad moves leave selection alone. */
  private applyEdit(edit: MappingEdit, side: 'before' | 'after'): void {
    for (const pt of edit.points) this.setPoint({ quadId: edit.quadId, index: pt.index }, pt[side]);
    if (edit.points.length === 1) this.select({ quadId: edit.quadId, index: edit.points[0]!.index });
  }

  // ---------- frame actions ----------

  /** Add a frame centered on the canvas at the default size. Returns its id. */
  addFrame(): string {
    const { w, h } = this._runtime.viewport;
    // While setting up with test patterns showing, a new frame shows its pattern too.
    const patterns = this.allQuadIds().some((id) => this.isTestPatternOn(id));
    const f = newFrame(0.5, 0.5, w / h, this._config.frames);
    f.id = generateFrameId(this.allFrameIds());
    this._config.frames.push(f);
    if (patterns) this._runtime.testPattern[f.id] = true;
    this.markConfigDirty();
    this.emit((e) => {
      e.frames = true;
      e.runtime = patterns;
      e.corners.add(f.id);
    });
    return f.id;
  }

  /** Remove a frame immediately. Not undoable; only the config dirty flag records it. */
  removeFrame(id: QuadId): void {
    const i = this.frameIndex(id);
    if (i < 0) return;
    this._config.frames.splice(i, 1);
    this.forgetQuad(id);
    this.markConfigDirty();
    this.emit((e) => (e.frames = e.runtime = true));
  }

  /** Move a frame to another position in the list. Later frames draw on top. Not undoable. */
  moveFrame(id: QuadId, to: number): void {
    const from = this.frameIndex(id);
    const n = this._config.frames.length;
    if (from < 0 || from === to || to < 0 || to >= n) return;
    this._config.frames.splice(to, 0, ...this._config.frames.splice(from, 1));
    this.markConfigDirty();
    this.emit((e) => (e.frames = true));
  }

  updateFrame(id: QuadId, patch: FrameSettings): void {
    const f = this._config.frames.find((fr) => fr.id === id);
    if (!f) return;
    if (patch.title !== undefined) f.title = patch.title;
    if (patch.physicalAspect !== undefined) f.physicalAspect = patch.physicalAspect;
    if (patch.debugColor !== undefined) f.debugColor = patch.debugColor;
    if (patch.captionSpacing !== undefined) f.captionSpacing = patch.captionSpacing;
    if (patch.captionOffsetX !== undefined) f.captionOffsetX = patch.captionOffsetX;
    if (patch.blend !== undefined) f.blend = patch.blend;
    this.markConfigDirty();
    this.emit((e) => (e.frames = true));
  }

  // ---------- choreography actions ----------

  setChoreography(patch: Partial<Omit<ChoreographyConfig, 'entries'>>): void {
    Object.assign(this._config.choreography, patch);
    this.configChanged();
  }

  /** Add an entry at the end of the list. Returns its id. */
  addEntry(): string {
    const entries = this._config.choreography.entries;
    const e = newEntry(entries.map((x) => x.id));
    entries.push(e);
    this.playlistChanged();
    return e.id;
  }

  /** Copy an entry (and its frames) right below it, with new ids. Returns the copy's id. */
  duplicateEntry(id: string): string | null {
    const entries = this._config.choreography.entries;
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const copy = structuredClone(entries[i]!);
    copy.id = generateEntryId(entries.map((e) => e.id));
    copy.name = `${copy.name} copy`;
    const ids = this.allFrameIds();
    for (const f of copy.frames) {
      f.id = generateFrameId(ids);
      ids.push(f.id);
    }
    entries.splice(i + 1, 0, copy);
    this.markConfigDirty();
    this.emit((e) => {
      e.frames = true;
      for (const f of copy.frames) e.corners.add(f.id);
    });
    return copy.id;
  }

  /** Remove an entry immediately (no confirmation, as for frames). */
  removeEntry(id: string): void {
    const entries = this._config.choreography.entries;
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [removed] = entries.splice(i, 1);
    for (const f of removed!.frames) this.forgetQuad(f.id);
    if (this._runtime.editedEntryId === id) this._runtime.editedEntryId = null;
    this.playlistChanged(true);
  }

  /** Move an entry to another position in the play order. */
  moveEntry(id: string, to: number): void {
    const entries = this._config.choreography.entries;
    const from = entries.findIndex((e) => e.id === id);
    if (from < 0 || from === to || to < 0 || to >= entries.length) return;
    entries.splice(to, 0, ...entries.splice(from, 1));
    this.playlistChanged();
  }

  /** Change an entry's own fields (not its frames). */
  updateEntry(id: string, patch: EntrySettings): void {
    const e = this._config.choreography.entries.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    this.playlistChanged();
  }

  /** Mark the most recently opened entry section: its frames get handles and Tab stops. */
  setEditedEntry(id: string | null): void {
    if (this._runtime.editedEntryId === id) return;
    this._runtime.editedEntryId = id;
    this.dropHiddenSelection();
    this.emit((e) => (e.runtime = e.frames = true));
  }

  /** Add a frame to an entry with the "Add new frame" geometry. Returns its id. */
  addChoreoFrame(entryId: string): string | null {
    const e = this.mutableEntry(entryId);
    if (!e) return null;
    const { w, h } = this._runtime.viewport;
    // While setting up with test patterns showing, a new frame shows its pattern too.
    const patterns = this.allQuadIds().some((id) => this.isTestPatternOn(id));
    const f = newChoreoFrame(0.5, 0.5, w / h, this.allFrameIds(), e.frames.map((x) => x.debugColor));
    e.frames.push(f);
    if (patterns) this._runtime.testPattern[f.id] = true;
    this.markConfigDirty();
    this.emit((ev) => {
      ev.frames = true;
      ev.runtime = patterns;
      ev.corners.add(f.id);
    });
    return f.id;
  }

  /** Copy a choreographed frame right below it, with a new id and colour. Returns the copy's id. */
  duplicateChoreoFrame(id: string): string | null {
    const found = this.mutableChoreoFrame(id);
    if (!found) return null;
    const { entry, frame } = found;
    const copy: ChoreoFrameConfig = {
      ...structuredClone(frame),
      id: generateFrameId(this.allFrameIds()),
      debugColor: nextFrameColor(entry.frames.map((x) => x.debugColor)),
    };
    entry.frames.splice(entry.frames.indexOf(frame) + 1, 0, copy);
    this.markConfigDirty();
    this.emit((e) => {
      e.frames = true;
      e.corners.add(copy.id);
    });
    return copy.id;
  }

  /** Remove a choreographed frame immediately. Not undoable; only the config dirty flag records it. */
  removeChoreoFrame(id: string): void {
    const found = this.mutableChoreoFrame(id);
    if (!found) return;
    found.entry.frames.splice(found.entry.frames.indexOf(found.frame), 1);
    this.forgetQuad(id);
    this.playlistChanged(true);
  }

  /** Move a choreographed frame within its entry. Later frames draw on top. Not undoable. */
  moveChoreoFrame(id: string, to: number): void {
    const found = this.mutableChoreoFrame(id);
    if (!found) return;
    const list = found.entry.frames;
    const from = list.indexOf(found.frame);
    if (from === to || to < 0 || to >= list.length) return;
    list.splice(to, 0, ...list.splice(from, 1));
    this.playlistChanged();
  }

  updateChoreoFrame(id: string, patch: ChoreoFrameSettings): void {
    const found = this.mutableChoreoFrame(id);
    if (!found) return;
    Object.assign(found.frame, patch);
    // Content is arriving: the test pattern would hide it.
    if (patch.asset) this.hideTestPatterns([id]);
    this.playlistChanged();
  }

  setSolo(frameId: string | null): void {
    if (this._runtime.soloFrameId === frameId) return;
    this._runtime.soloFrameId = frameId;
    this.emit((e) => (e.runtime = true));
  }

  // ---------- wallpaper playlist actions ----------

  /** Insert an asset into a frame's playlist (at the end by default). */
  addToPlaylist(frameId: QuadId, item: PlaylistItem, index?: number): void {
    const f = this.mutableFrame(frameId);
    const keys = this.mutablePlaylistKeys(frameId);
    if (!f || !keys) return;
    const at = index === undefined ? f.playlist.length : Math.max(0, Math.min(f.playlist.length, index));
    f.playlist.splice(at, 0, { pool: item.pool, filepath: item.filepath });
    keys.splice(at, 0, this.nextPlaylistKey++);
    // Content is arriving: the test pattern would hide it.
    this.hideTestPatterns([frameId]);
    this.playlistChanged();
  }

  /** Move a playlist entry from one position to another. */
  movePlaylistItem(frameId: QuadId, from: number, to: number): void {
    const f = this.mutableFrame(frameId);
    const keys = this.mutablePlaylistKeys(frameId);
    const n = f?.playlist.length ?? 0;
    if (!f || !keys || from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    f.playlist.splice(to, 0, ...f.playlist.splice(from, 1));
    keys.splice(to, 0, ...keys.splice(from, 1));
    this.playlistChanged();
  }

  removePlaylistItem(frameId: QuadId, index: number): void {
    const f = this.mutableFrame(frameId);
    const keys = this.mutablePlaylistKeys(frameId);
    if (!f || !keys || index < 0 || index >= f.playlist.length) return;
    f.playlist.splice(index, 1);
    keys.splice(index, 1);
    this.playlistChanged();
  }

  // ---------- global config actions ----------

  setShowType(type: ShowType): void {
    if (this._config.showType === type) return;
    this._config.showType = type;
    this.dropHiddenSelection();
    this.configChanged(true);
    this.emit((e) => (e.runtime = true));
  }

  setWallColor(color: string): void {
    this._config.wallQuad.debugColor = color;
    this.configChanged(true);
  }

  setBackgroundColor(color: string): void {
    this._config.global.backgroundColor = color;
    this.configChanged();
  }

  setDebugStyle(patch: Partial<DebugStyle>): void {
    Object.assign(this._config.global.debug, patch);
    this.configChanged();
  }

  setPanelSide(side: PanelSide): void {
    if (this._config.ui.panelSide === side) return;
    this._config.ui.panelSide = side;
    this.configChanged();
  }

  setAnimation(patch: Partial<AnimationConfig>): void {
    Object.assign(this._config.animation, patch);
    this.configChanged();
  }

  setCaptions(patch: Partial<CaptionConfig>): void {
    Object.assign(this._config.captions, patch);
    this.configChanged();
  }

  // ---------- runtime actions ----------

  select(ref: PointRef | null): void {
    if (samePoint(ref, this._runtime.selected) || (!ref && !this._runtime.selected)) return;
    this._runtime.selected = ref ? { ...ref } : null;
    this.emit((e) => (e.runtime = true));
  }

  /** Cycle selection through the handled frames' control points in order, then the wall quad's. */
  cycleSelection(dir: 1 | -1): void {
    const refs: PointRef[] = [];
    for (const id of this.allQuadIds()) {
      for (const index of [0, 1, 2, 3] as const) refs.push({ quadId: id, index });
    }
    if (refs.length === 0) return;
    const sel = this._runtime.selected;
    const i = sel ? refs.findIndex((r) => samePoint(r, sel)) : -1;
    const next = i < 0 ? (dir > 0 ? 0 : refs.length - 1) : (i + dir + refs.length) % refs.length;
    this.select(refs[next]!);
  }

  setDebugVisible(v: boolean): void {
    if (this._runtime.debugVisible === v) return;
    this._runtime.debugVisible = v;
    this.emit((e) => (e.runtime = true));
  }

  setPaused(paused: boolean): void {
    if (this._runtime.paused === paused) return;
    this._runtime.paused = paused;
    this.emit((e) => (e.runtime = true));
  }

  setPanelOpen(open: boolean): void {
    if (this._runtime.panelOpen === open) return;
    this._runtime.panelOpen = open;
    // Debug visuals follow the panel; `D` can still override afterwards.
    this._runtime.debugVisible = open;
    this.emit((e) => (e.runtime = true));
  }

  /** Turn these quads' test patterns off (content was added to them). */
  private hideTestPatterns(ids: readonly QuadId[]): void {
    let changed = false;
    for (const id of ids) {
      if (!this.isTestPatternOn(id)) continue;
      this._runtime.testPattern[id] = false;
      changed = true;
    }
    if (changed) this.emit((e) => (e.runtime = true));
  }

  /** Turn on every quad's test pattern (a new show starts this way, ready for mapping). */
  showAllTestPatterns(): void {
    for (const id of this.allQuadIds()) this._runtime.testPattern[id] = true;
    this.emit((e) => (e.runtime = true));
  }

  setTestPattern(quadId: QuadId, on: boolean): void {
    this._runtime.testPattern[quadId] = on;
    this.emit((e) => (e.runtime = true));
  }

  setViewport(w: number, h: number): void {
    const vp = this._runtime.viewport;
    if (vp.w === w && vp.h === h) return;
    this._runtime.viewport = { w, h };
    this.emit((e) => (e.viewport = true));
  }

  // ---------- internals ----------

  /** Corners of the wall, a mapped frame or a choreographed frame. */
  private mutableCorners(quadId: QuadId): Corners | null {
    if (quadId === WALL_QUAD_ID) return this._config.wallQuad.corners;
    return this._config.frames.find((f) => f.id === quadId)?.corners ?? this.mutableChoreoFrame(quadId)?.frame.corners ?? null;
  }

  private mutableEntry(id: string): EntryConfig | null {
    return this._config.choreography.entries.find((e) => e.id === id) ?? null;
  }

  private mutableChoreoFrame(id: string): { entry: EntryConfig; frame: ChoreoFrameConfig } | null {
    for (const entry of this._config.choreography.entries) {
      const frame = entry.frames.find((f) => f.id === id);
      if (frame) return { entry, frame };
    }
    return null;
  }

  /** The playlist owner for an id: only the wall (WALL_QUAD_ID) has a playlist. */
  private mutableFrame(id: QuadId): { playlist: PlaylistItem[] } | null {
    return id === WALL_QUAD_ID ? this._config.wallQuad : null;
  }

  /** A removed quad: forget its runtime state. */
  private forgetQuad(id: string): void {
    delete this._runtime.testPattern[id];
    if (this._runtime.selected?.quadId === id) this._runtime.selected = null;
    if (this._runtime.soloFrameId === id) this._runtime.soloFrameId = null;
  }

  /** A selected point whose quad no longer has handles is deselected. */
  private dropHiddenSelection(): void {
    const sel = this._runtime.selected;
    if (sel && !this.allQuadIds().includes(sel.quadId)) this._runtime.selected = null;
  }

  /** Playlist keys for a frame, created on first use (or if they fell out of step with the playlist). */
  private mutablePlaylistKeys(frameId: QuadId): number[] | null {
    const f = this.mutableFrame(frameId);
    if (!f) return null;
    let keys = this.playlistKeyMap.get(frameId);
    if (!keys || keys.length !== f.playlist.length) {
      keys = f.playlist.map(() => this.nextPlaylistKey++);
      this.playlistKeyMap.set(frameId, keys);
    }
    return keys;
  }

  private playlistChanged(runtime = false): void {
    this.markConfigDirty();
    this.emit((e) => {
      e.frames = true;
      if (runtime) e.runtime = true;
    });
  }

  private pushEdit(edit: MappingEdit): void {
    this.undoStack.push(edit);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private configChanged(affectsQuads = false): void {
    this.markConfigDirty();
    this.emit((e) => {
      e.config = true;
      if (affectsQuads) e.frames = true;
    });
  }

  private markConfigDirty(): void {
    if (this._runtime.configDirty) return;
    this._runtime.configDirty = true;
    this.emit((e) => (e.runtime = true));
  }

  /** Accumulate changes and notify listeners once per microtask. */
  private emit(mut: (e: PendingEvent) => void): void {
    if (!this.pending) {
      this.pending = { corners: new Set(), frames: false, config: false, runtime: false, viewport: false, assets: false };
      queueMicrotask(() => {
        const e = this.pending!;
        this.pending = null;
        for (const fn of this.listeners) {
          // One failing subscriber must not starve the others (e.g. the panel).
          try {
            fn(e);
          } catch (err) {
            console.error('Store listener failed', err);
          }
        }
      });
    }
    mut(this.pending);
  }
}
