import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from './defaults';
import { WALL_QUAD_ID } from './schema';
import { Store, type PointRef } from './store';

const VP = { w: 1920, h: 1080 };

function makeStore() {
  const store = new Store(defaultConfig(VP.w / VP.h), VP);
  const ref: PointRef = { quadId: store.config.frames[0]!.id, index: 0 };
  return { store, ref };
}

describe('Store mapping undo', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
  afterEach(() => vi.useRealTimers());

  it('nudges are in device pixels', () => {
    const { store, ref } = makeStore();
    const [x0, y0] = store.getCorners(ref.quadId)![0];
    store.nudge(ref, 1, 0);
    store.nudge(ref, 0, 0.1);
    const [x1, y1] = store.getCorners(ref.quadId)![0];
    expect((x1 - x0) * VP.w).toBeCloseTo(1, 9);
    expect((y1 - y0) * VP.h).toBeCloseTo(0.1, 9);
  });

  it('a burst of nudges with gaps ≤ 500 ms is one undo step', () => {
    const { store, ref } = makeStore();
    const start = [...store.getCorners(ref.quadId)![0]];
    for (let i = 0; i < 5; i++) {
      store.nudge(ref, 1, 0);
      vi.advanceTimersByTime(400);
    }
    store.undo();
    expect([...store.getCorners(ref.quadId)![0]]).toEqual(start);
    expect(store.canUndo()).toBe(false);
  });

  it('a gap over 500 ms starts a new undo step', () => {
    const { store, ref } = makeStore();
    const start = [...store.getCorners(ref.quadId)![0]];
    store.nudge(ref, 1, 0);
    const mid = [...store.getCorners(ref.quadId)![0]];
    vi.advanceTimersByTime(600);
    store.nudge(ref, 1, 0);
    store.undo();
    expect([...store.getCorners(ref.quadId)![0]]).toEqual(mid);
    store.undo();
    expect([...store.getCorners(ref.quadId)![0]]).toEqual(start);
  });

  it('nudging a different point starts a new undo step', () => {
    const { store, ref } = makeStore();
    const other: PointRef = { quadId: ref.quadId, index: 1 };
    store.nudge(ref, 1, 0);
    store.nudge(other, 1, 0);
    store.undo();
    expect(store.canUndo()).toBe(true);
  });

  it('one drag is one undo step, and redo restores it', () => {
    const { store, ref } = makeStore();
    const start = [...store.getCorners(ref.quadId)![0]];
    store.beginDrag(ref);
    for (let i = 1; i <= 10; i++) store.setPoint(ref, [0.1 + i * 0.01, 0.2]);
    store.endDrag();
    const end = [...store.getCorners(ref.quadId)![0]];
    store.undo();
    expect([...store.getCorners(ref.quadId)![0]]).toEqual(start);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect([...store.getCorners(ref.quadId)![0]]).toEqual(end);
  });

  it('a whole-frame drag is one undo step for all four corners and keeps the selection', () => {
    const { store, ref } = makeStore();
    const id = ref.quadId;
    const start = store.getCorners(id)!.map((c) => [...c]);
    const other: PointRef = { quadId: WALL_QUAD_ID, index: 2 };
    store.select(other);
    store.beginDrag(id);
    for (let i = 1; i <= 5; i++) store.setCorners(id, start.map(([x, y]) => [x! + i * 0.01, y! - i * 0.01]));
    store.endDrag();
    const moved = store.getCorners(id)!.map((c) => [...c]);
    expect(moved[2]![0]).toBeCloseTo(start[2]![0]! + 0.05, 12);
    store.undo();
    expect(store.getCorners(id)!.map((c) => [...c])).toEqual(start);
    expect(store.runtime.selected).toEqual(other);
    expect(store.canUndo()).toBe(false);
    store.redo();
    expect(store.getCorners(id)!.map((c) => [...c])).toEqual(moved);
  });

  it('a click without movement records nothing', () => {
    const { store, ref } = makeStore();
    store.beginDrag(ref);
    store.endDrag();
    expect(store.canUndo()).toBe(false);
  });

  it('mapping edits mark the config dirty', () => {
    const { store, ref } = makeStore();
    expect(store.runtime.configDirty).toBe(false);
    store.nudge(ref, 1, 0);
    expect(store.runtime.configDirty).toBe(true);
  });
});

describe('Store selection cycling', () => {
  it('cycles frames in order then the wall quad, and wraps', () => {
    const { store } = makeStore();
    const [f1, f2] = store.config.frames;
    const seen: string[] = [];
    for (let i = 0; i < 13; i++) {
      store.cycleSelection(1);
      const s = store.runtime.selected!;
      seen.push(`${s.quadId}:${s.index}`);
    }
    expect(seen.slice(0, 4)).toEqual([0, 1, 2, 3].map((i) => `${f1!.id}:${i}`));
    expect(seen.slice(4, 8)).toEqual([0, 1, 2, 3].map((i) => `${f2!.id}:${i}`));
    expect(seen.slice(8, 12)).toEqual([0, 1, 2, 3].map((i) => `${WALL_QUAD_ID}:${i}`));
    expect(seen[12]).toBe(`${f1!.id}:0`);
  });

  it('cycles backward from no selection to the last wall point', () => {
    const { store } = makeStore();
    store.cycleSelection(-1);
    expect(store.runtime.selected).toEqual({ quadId: WALL_QUAD_ID, index: 3 });
  });
});

describe('Store frame and project actions', () => {
  it('addFrame centers a new frame with a new id and an unused color', () => {
    const { store } = makeStore();
    const id = store.addFrame();
    const frames = store.config.frames;
    expect(frames).toHaveLength(3);
    const f = frames[2]!;
    expect(f.id).toBe(id);
    expect(new Set(frames.map((x) => x.id)).size).toBe(3);
    expect(new Set(frames.map((x) => x.debugColor)).size).toBe(3);
    const cx = (f.corners[0][0] + f.corners[1][0]) / 2;
    const cy = (f.corners[0][1] + f.corners[3][1]) / 2;
    expect(cx).toBeCloseTo(0.5, 12);
    expect(cy).toBeCloseTo(0.5, 12);
    expect(store.runtime.configDirty).toBe(true);
  });

  it('removeFrame keeps the other frames\' ids and settings, and clears a selection on it', () => {
    const { store } = makeStore();
    const [f1, f2] = store.config.frames.map((f) => structuredClone(f));
    store.select({ quadId: f1!.id, index: 2 });
    store.removeFrame(f1!.id);
    expect(store.config.frames).toEqual([f2]);
    expect(store.runtime.selected).toBeNull();
    expect(store.runtime.configDirty).toBe(true);
  });

  it('moveFrame reorders frames (later draws on top) and ignores out-of-range moves', () => {
    const { store } = makeStore();
    store.addFrame();
    const [a, b, c] = store.config.frames.map((f) => f.id);
    store.moveFrame(c!, 0);
    expect(store.config.frames.map((f) => f.id)).toEqual([c, a, b]);
    expect(store.runtime.configDirty).toBe(true);
    store.moveFrame(c!, 1);
    expect(store.config.frames.map((f) => f.id)).toEqual([a, c, b]);
    store.moveFrame(a!, -1);
    store.moveFrame(a!, 3);
    store.moveFrame('nope', 0);
    expect(store.config.frames.map((f) => f.id)).toEqual([a, c, b]);
  });

  it('undo skips edits on removed frames', () => {
    const { store, ref } = makeStore();
    const other = { quadId: store.config.frames[1]!.id, index: 0 as const };
    const start = [...store.getCorners(other.quadId)![0]];
    store.movePoint(other, [0.1, 0.1]);
    store.movePoint(ref, [0.2, 0.2]);
    store.removeFrame(ref.quadId);
    store.undo();
    expect([...store.getCorners(other.quadId)![0]]).toEqual(start);
  });

  it('movePoint is one undo step', () => {
    const { store, ref } = makeStore();
    const start = [...store.getCorners(ref.quadId)![0]];
    store.movePoint(ref, [0.3, 0.4]);
    expect([...store.getCorners(ref.quadId)![0]]).toEqual([0.3, 0.4]);
    store.undo();
    expect([...store.getCorners(ref.quadId)![0]]).toEqual(start);
  });

  it('replaceConfig resets history, selection and the config dirty flag', () => {
    const { store, ref } = makeStore();
    store.movePoint(ref, [0.3, 0.4]);
    store.select(ref);
    const loaded = defaultConfig(VP.w / VP.h);
    store.replaceConfig(loaded, 'MyProject');
    expect(store.config).toEqual(loaded);
    expect(store.config).not.toBe(loaded); // store owns a copy
    expect(store.canUndo()).toBe(false);
    expect(store.runtime.selected).toBeNull();
    expect(store.runtime.configDirty).toBe(false);
    expect(store.runtime.folderName).toBe('MyProject');
  });

  it('isQuadValid flags a bow-tie quad', () => {
    const { store, ref } = makeStore();
    expect(store.isQuadValid(ref.quadId)).toBe(true);
    const c = store.getCorners(ref.quadId)!;
    store.setPoint({ quadId: ref.quadId, index: 0 }, [c[1][0], c[1][1]]);
    store.setPoint({ quadId: ref.quadId, index: 1 }, [c[3][0], c[3][1] - 0.6]);
    expect(store.isQuadValid(ref.quadId)).toBe(false);
  });
});

describe('Store playlists', () => {
  const item = (filepath: string) => ({ manifest: 'assets.json', filepath });
  const paths = (store: Store, id: string) => store.config.frames.find((f) => f.id === id)!.playlist.map((p) => p.filepath);

  it('adds, moves and removes entries, marking the config modified', () => {
    const { store, ref } = makeStore();
    const id = ref.quadId;
    store.addToPlaylist(id, item('a.jpg'));
    store.addToPlaylist(id, item('b.jpg'));
    store.addToPlaylist(id, item('c.jpg'));
    store.addToPlaylist(id, item('a.jpg')); // duplicates allowed
    expect(paths(store, id)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'a.jpg']);
    expect(store.runtime.configDirty).toBe(true);
    store.movePlaylistItem(id, 0, 2);
    expect(paths(store, id)).toEqual(['b.jpg', 'c.jpg', 'a.jpg', 'a.jpg']);
    store.removePlaylistItem(id, 1);
    expect(paths(store, id)).toEqual(['b.jpg', 'a.jpg', 'a.jpg']);
    store.movePlaylistItem(id, 0, 9); // out of range: ignored
    store.removePlaylistItem(id, -1);
    expect(paths(store, id)).toEqual(['b.jpg', 'a.jpg', 'a.jpg']);
  });

  it('gives each entry a stable key that follows it through moves', () => {
    const { store, ref } = makeStore();
    const id = ref.quadId;
    store.addToPlaylist(id, item('a.jpg'));
    store.addToPlaylist(id, item('a.jpg'));
    store.addToPlaylist(id, item('b.jpg'));
    const [k0, k1, k2] = store.playlistKeys(id);
    expect(new Set([k0, k1, k2]).size).toBe(3);
    store.movePlaylistItem(id, 2, 0);
    expect(store.playlistKeys(id)).toEqual([k2, k0, k1]);
    store.removePlaylistItem(id, 1);
    expect(store.playlistKeys(id)).toEqual([k2, k1]);
  });

  it('playlist entries follow an asset filepath edit', () => {
    const { store, ref } = makeStore();
    store.setManifests([
      {
        path: 'assets.json',
        assets: [{ uid: 'u1', entry: { filepath: 'a.jpg' }, present: ['filepath'], extra: {} }],
        error: null,
        warnings: [],
        dirty: false,
        extra: {},
      },
    ]);
    store.addToPlaylist(ref.quadId, item('a.jpg'));
    store.addToPlaylist(ref.quadId, { manifest: 'other.json', filepath: 'a.jpg' });
    store.markConfigSaved();
    store.updateAsset('u1', { filepath: 'renamed.jpg' });
    expect(paths(store, ref.quadId)).toEqual(['renamed.jpg', 'a.jpg']); // other manifest untouched
    expect(store.runtime.configDirty).toBe(true);
  });

  it('sets the show type', () => {
    const { store } = makeStore();
    expect(store.config.showType).toBe('randomized');
    store.setShowType('manual');
    expect(store.config.showType).toBe('manual');
    expect(store.runtime.configDirty).toBe(true);
  });
});
