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

  it('rotateQuad turns a frame 90° clockwise as one undo step, inside the viewport', () => {
    const { store, ref } = makeStore();
    const start = store.getCorners(ref.quadId)!.map((p) => [...p]);
    store.rotateQuad(ref.quadId);
    const turned = store.getCorners(ref.quadId)!.map((p) => [...p]);
    expect(turned).not.toEqual(start);
    for (const [x, y] of turned) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(store.runtime.configDirty).toBe(true);
    store.undo();
    store.getCorners(ref.quadId)!.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(start[i]![0]!, 12);
      expect(p[1]).toBeCloseTo(start[i]![1]!, 12);
    });
    store.redo();
    expect(store.getCorners(ref.quadId)!.map((p) => [...p])).toEqual(turned);
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
  const item = (filepath: string) => ({ pool: 'assets.json', filepath });
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
    store.setPools([
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
    store.addToPlaylist(ref.quadId, { pool: 'other.json', filepath: 'a.jpg' });
    store.markConfigSaved();
    store.updateAsset('u1', { filepath: 'renamed.jpg' });
    expect(paths(store, ref.quadId)).toEqual(['renamed.jpg', 'a.jpg']); // other pool untouched
    expect(store.runtime.configDirty).toBe(true);
  });

  it('the wall has its own playlist, edited the same way and followed on renames', () => {
    const { store } = makeStore();
    store.setPools([{ path: 'walls.json', assets: [{ uid: 'w1', entry: { filepath: 'paper.jpg' }, present: ['filepath'], extra: {} }], error: null, warnings: [], dirty: false, extra: {} }]);
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'walls.json', filepath: 'paper.jpg' });
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'walls.json', filepath: 'other.jpg' });
    store.movePlaylistItem(WALL_QUAD_ID, 1, 0);
    expect(store.config.wallQuad.playlist.map((p) => p.filepath)).toEqual(['other.jpg', 'paper.jpg']);
    expect(store.playlistKeys(WALL_QUAD_ID)).toHaveLength(2);
    expect(store.framesUsingAsset('w1')).toEqual([WALL_QUAD_ID]);
    expect(store.framesUsingPool('walls.json')).toEqual([WALL_QUAD_ID]);
    store.updateAsset('w1', { filepath: 'renamed.jpg' });
    expect(store.config.wallQuad.playlist.map((p) => p.filepath)).toEqual(['other.jpg', 'renamed.jpg']);
    store.removePlaylistItem(WALL_QUAD_ID, 0);
    expect(store.config.wallQuad.playlist.map((p) => p.filepath)).toEqual(['renamed.jpg']);
  });

  it('sets the show type', () => {
    const { store } = makeStore();
    expect(store.config.showType).toBe('randomized');
    store.setShowType('manual');
    expect(store.config.showType).toBe('manual');
    expect(store.runtime.configDirty).toBe(true);
  });
});

describe('Store test patterns for a new show', () => {
  it('shows every test pattern, and frames added meanwhile show theirs', () => {
    const { store } = makeStore();
    expect(store.allQuadIds().some((id) => store.isTestPatternOn(id))).toBe(false);
    store.showAllTestPatterns();
    expect(store.allQuadIds().every((id) => store.isTestPatternOn(id))).toBe(true);
    expect(store.isTestPatternOn(store.addFrame())).toBe(true);
    // Loading a show resets them; frames added then start without one.
    store.replaceConfig(store.configSnapshot(), 'show');
    expect(store.allQuadIds().some((id) => store.isTestPatternOn(id))).toBe(false);
    expect(store.isTestPatternOn(store.addFrame())).toBe(false);
  });
});

describe('Store test patterns when content is added', () => {
  const rec = (uid: string) => ({ uid, entry: { filepath: `${uid}.jpg` }, present: ['filepath'], extra: {} });
  const pool = { path: 'p.json', assets: [], error: null, warnings: [], dirty: false, extra: {} };

  it('adding to a playlist turns off that quad\'s pattern only (frame or wall)', () => {
    const { store } = makeStore();
    store.showAllTestPatterns();
    const [f1, f2] = store.config.frames.map((f) => f.id);
    store.addToPlaylist(f1!, { pool: 'p.json', filepath: 'a.jpg' });
    expect([f1, f2, WALL_QUAD_ID].map((id) => store.isTestPatternOn(id!))).toEqual([false, true, true]);
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'p.json', filepath: 'a.jpg' });
    expect(store.isTestPatternOn(WALL_QUAD_ID)).toBe(false);
  });

  it('adding files to a pool turns off every frame\'s pattern in a randomized show, not the wall\'s', () => {
    const { store } = makeStore();
    store.setPools([pool]);
    store.showAllTestPatterns();
    store.addAssets('p.json', [rec('a')]);
    expect(store.config.frames.every((f) => !store.isTestPatternOn(f.id))).toBe(true);
    expect(store.isTestPatternOn(WALL_QUAD_ID)).toBe(true);
  });

  it('in a manual show, adding files to a pool leaves the patterns alone', () => {
    const { store } = makeStore();
    store.setPools([pool]);
    store.setShowType('manual');
    store.showAllTestPatterns();
    store.addAssets('p.json', [rec('a')]);
    expect(store.allQuadIds().every((id) => store.isTestPatternOn(id))).toBe(true);
  });
});

describe('Store adding and removing content', () => {
  const pool = (path: string, filepaths: string[]) => ({
    path,
    assets: filepaths.map((filepath, i) => ({ uid: `${path}#${i}`, entry: { filepath }, present: ['filepath'], extra: {} })),
    error: null,
    warnings: [],
    dirty: false,
    extra: {},
  });

  it('adds assets to a pool, marking it and the assets modified', () => {
    const { store } = makeStore();
    store.setPools([pool('art.json', ['a.jpg']), pool('video.json', [])]);
    store.addAssets('video.json', [{ uid: 'n1', entry: { filepath: 'media/v.mp4' }, present: ['filepath'], extra: {} }]);
    expect(store.pools[1]!.assets.map((a) => a.entry.filepath)).toEqual(['media/v.mp4']);
    expect(store.pools[1]!.dirty).toBe(true);
    expect(store.pools[0]!.dirty).toBe(false);
    expect(store.runtime.assetsDirty).toBe(true);
    expect(store.findAsset('n1')?.pool.path).toBe('video.json');
  });

  it('removes an asset, leaving playlist entries that used it to show as missing', () => {
    const { store, ref } = makeStore();
    store.setPools([pool('art.json', ['a.jpg', 'b.jpg'])]);
    store.addToPlaylist(ref.quadId, { pool: 'art.json', filepath: 'a.jpg' });
    expect(store.framesUsingAsset('art.json#0')).toEqual([ref.quadId]);
    expect(store.framesUsingAsset('art.json#1')).toEqual([]);
    store.setAssetError('art.json#0', 'broken');
    store.removeAsset('art.json#0');
    expect(store.pools[0]!.assets.map((a) => a.uid)).toEqual(['art.json#1']);
    expect(store.pools[0]!.dirty).toBe(true);
    expect(store.runtime.assetErrors['art.json#0']).toBeUndefined();
    expect(store.config.frames[0]!.playlist).toEqual([{ pool: 'art.json', filepath: 'a.jpg' }]);
  });

  it('removes a pool from the show and the config, keeping playlist entries (shown missing)', () => {
    const { store, ref } = makeStore();
    store.setPools([pool('art.json', ['a.jpg']), { ...pool('video.json', ['v.mp4']), dirty: true }]);
    store.replaceConfig({ ...store.configSnapshot(), assetPools: ['art.json', 'video.json'] }, 'show');
    store.addToPlaylist(ref.quadId, { pool: 'video.json', filepath: 'v.mp4' });
    store.setAssetError('video.json#0', 'broken');
    expect(store.framesUsingPool('video.json')).toEqual([ref.quadId]);
    expect(store.runtime.assetsDirty).toBe(false); // setPools clears it; mark it via an edit
    store.updateAsset('video.json#0', { title: 'x' });
    store.removePool('video.json');
    expect(store.pools.map((m) => m.path)).toEqual(['art.json']);
    expect(store.config.assetPools).toEqual(['art.json']);
    expect(store.runtime.assetErrors['video.json#0']).toBeUndefined();
    expect(store.runtime.assetsDirty).toBe(false); // the only modified pool is gone
    expect(store.runtime.configDirty).toBe(true);
    expect(store.config.frames[0]!.playlist).toEqual([{ pool: 'video.json', filepath: 'v.mp4' }]);
  });

  it('adds a pool to the show, listing it in the config', () => {
    const { store } = makeStore();
    store.markConfigSaved();
    store.addPool({ ...pool('new.json', []), dirty: true });
    expect(store.pools.map((m) => m.path)).toEqual(['new.json']);
    expect(store.config.assetPools).toEqual(['new.json']);
    expect(store.runtime.configDirty).toBe(true);
    expect(store.runtime.assetsDirty).toBe(true);
    store.addPool(pool('new.json', ['x.jpg'])); // already there: ignored
    expect(store.pools).toHaveLength(1);
  });
});

describe('Store frame timing overrides', () => {
  it("sets and clears a frame's own cycle duration and transition delay", () => {
    const { store } = makeStore();
    const id = store.config.frames[0]!.id;
    store.updateFrame(id, { cycleDuration: 20, transitionDelay: 1.5 });
    expect(store.config.frames[0]).toMatchObject({ cycleDuration: 20, transitionDelay: 1.5 });
    expect(store.runtime.configDirty).toBe(true);
    store.updateFrame(id, { cycleDuration: null });
    expect(store.config.frames[0]).toMatchObject({ cycleDuration: null, transitionDelay: 1.5 });
    expect(store.config.frames[1]).toMatchObject({ cycleDuration: null, transitionDelay: null });
  });
});
