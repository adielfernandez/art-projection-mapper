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

describe('Store wallpaper playlist', () => {
  const item = (filepath: string) => ({ pool: 'assets.json', filepath });
  const paths = (store: Store) => store.config.wallQuad.playlist.map((p) => p.filepath);

  it('adds, moves and removes entries, marking the config modified', () => {
    const { store } = makeStore();
    const id = WALL_QUAD_ID;
    store.addToPlaylist(id, item('a.jpg'));
    store.addToPlaylist(id, item('b.jpg'));
    store.addToPlaylist(id, item('c.jpg'));
    store.addToPlaylist(id, item('a.jpg')); // duplicates allowed
    expect(paths(store)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'a.jpg']);
    expect(store.runtime.configDirty).toBe(true);
    store.movePlaylistItem(id, 0, 2);
    expect(paths(store)).toEqual(['b.jpg', 'c.jpg', 'a.jpg', 'a.jpg']);
    store.removePlaylistItem(id, 1);
    expect(paths(store)).toEqual(['b.jpg', 'a.jpg', 'a.jpg']);
    store.movePlaylistItem(id, 0, 9); // out of range: ignored
    store.removePlaylistItem(id, -1);
    expect(paths(store)).toEqual(['b.jpg', 'a.jpg', 'a.jpg']);
  });

  it('gives each entry a stable key that follows it through moves', () => {
    const { store } = makeStore();
    const id = WALL_QUAD_ID;
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

  it('mapped frames have no playlist', () => {
    const { store, ref } = makeStore();
    store.addToPlaylist(ref.quadId, item('a.jpg'));
    expect(store.playlistKeys(ref.quadId)).toEqual([]);
    expect(store.runtime.configDirty).toBe(false);
  });

  it('follows renames, and reports who uses an asset or pool', () => {
    const { store } = makeStore();
    store.setPools([{ path: 'walls.json', assets: [{ uid: 'w1', entry: { filepath: 'paper.jpg' }, present: ['filepath'], extra: {} }], error: null, warnings: [], dirty: false, extra: {} }]);
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'walls.json', filepath: 'paper.jpg' });
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'other.json', filepath: 'paper.jpg' });
    expect(store.framesUsingAsset('w1')).toEqual([WALL_QUAD_ID]);
    expect(store.framesUsingPool('walls.json')).toEqual([WALL_QUAD_ID]);
    store.markConfigSaved();
    store.updateAsset('w1', { filepath: 'renamed.jpg' });
    expect(paths(store)).toEqual(['renamed.jpg', 'paper.jpg']); // other pool untouched
    expect(store.runtime.configDirty).toBe(true);
  });

  it('sets the show type', () => {
    const { store } = makeStore();
    expect(store.config.showType).toBe('randomized');
    store.setShowType('choreographed');
    expect(store.config.showType).toBe('choreographed');
    expect(store.runtime.configDirty).toBe(true);
  });
});

describe('Store choreography', () => {
  const pool = { path: 'p.json', assets: [{ uid: 'a1', entry: { filepath: 'a.jpg' }, present: ['filepath'], extra: {} }], error: null, warnings: [], dirty: false, extra: {} };
  const choreo = () => {
    const { store } = makeStore();
    store.setShowType('choreographed');
    store.markConfigSaved();
    return store;
  };
  const entryIds = (store: Store) => store.config.choreography.entries.map((e) => e.id);
  const frameIds = (store: Store, entryId: string) => store.findEntry(entryId)!.frames.map((f) => f.id);

  it('adds, duplicates, moves and removes entries, marking the config modified', () => {
    const store = choreo();
    const a = store.addEntry();
    expect(store.runtime.configDirty).toBe(true);
    const b = store.addEntry();
    store.addChoreoFrame(a);
    const copy = store.duplicateEntry(a)!;
    expect(entryIds(store)).toEqual([a, copy, b]);
    expect(store.findEntry(copy)!.name).toBe('Entry copy');
    // The copy's frames get new ids, unique across the show.
    expect(frameIds(store, copy)).toHaveLength(1);
    expect(frameIds(store, copy)[0]).not.toBe(frameIds(store, a)[0]);
    store.moveEntry(b, 0);
    expect(entryIds(store)).toEqual([b, a, copy]);
    store.moveEntry(b, 7); // out of range: ignored
    store.updateEntry(a, { name: 'Triptych', holdTime: 40 });
    expect(store.findEntry(a)).toMatchObject({ name: 'Triptych', holdTime: 40 });
    store.removeEntry(a);
    expect(entryIds(store)).toEqual([b, copy]);
  });

  it('adds frames with the Add new frame geometry, ids unique across mapped and choreographed frames, colours distinct within an entry', () => {
    const store = choreo();
    const e = store.addEntry();
    const ids = [store.addChoreoFrame(e)!, store.addChoreoFrame(e)!, store.addChoreoFrame(e)!];
    const all = store.allFrameIds();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([...store.config.frames.map((f) => f.id), ...ids]);
    const frames = store.findEntry(e)!.frames;
    expect(new Set(frames.map((f) => f.debugColor)).size).toBe(3);
    const [tl, , br] = frames[0]!.corners;
    expect((tl[0] + br[0]) / 2).toBeCloseTo(0.5, 9);
    expect((tl[1] + br[1]) / 2).toBeCloseTo(0.5, 9);
    expect(frames[0]).toMatchObject({ asset: null, blend: 'normal', delay: 0, duration: null, loop: false, fadeIn: 0.5, fadeInStyle: 'noise', fadeOut: 0.5, opacity: 1 });
  });

  it('duplicates, moves, updates and removes frames', () => {
    const store = choreo();
    const e = store.addEntry();
    const f1 = store.addChoreoFrame(e)!;
    const f2 = store.addChoreoFrame(e)!;
    store.updateChoreoFrame(f1, { title: 'Left', delay: 2 });
    const copy = store.duplicateChoreoFrame(f1)!;
    expect(frameIds(store, e)).toEqual([f1, copy, f2]);
    const c = store.findChoreoFrame(copy)!.frame;
    expect(c).toMatchObject({ title: 'Left', delay: 2 });
    expect(c.debugColor).not.toBe(store.findChoreoFrame(f1)!.frame.debugColor);
    store.moveChoreoFrame(f2, 0);
    expect(frameIds(store, e)).toEqual([f2, f1, copy]);
    store.select({ quadId: copy, index: 0 });
    store.setSolo(copy);
    store.removeChoreoFrame(copy);
    expect(frameIds(store, e)).toEqual([f2, f1]);
    expect(store.runtime.soloFrameId).toBeNull();
  });

  it('only the edited entry\'s frames get handles and Tab stops; closing it clears them', () => {
    const store = choreo();
    const a = store.addEntry();
    const b = store.addEntry();
    const fa = store.addChoreoFrame(a)!;
    const fb = store.addChoreoFrame(b)!;
    store.setEditedEntry(null);
    expect(store.allQuadIds()).toEqual([WALL_QUAD_ID]); // the mapped frames are for Randomized mode
    store.setEditedEntry(a);
    expect(store.allQuadIds()).toEqual([fa, WALL_QUAD_ID]);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      store.cycleSelection(1);
      seen.push(store.runtime.selected!.quadId);
    }
    expect(seen).toEqual([fa, fa, fa, fa, WALL_QUAD_ID, WALL_QUAD_ID, WALL_QUAD_ID, WALL_QUAD_ID]);
    store.select({ quadId: fa, index: 2 });
    store.setEditedEntry(b);
    expect(store.allQuadIds()).toEqual([fb, WALL_QUAD_ID]);
    expect(store.runtime.selected).toBeNull(); // its quad no longer has handles
    // Choreographed frames are mapped like any quad, with undo.
    const before = store.getCorners(fb)![0][0];
    store.nudge({ quadId: fb, index: 0 }, 10, 0);
    expect(store.getCorners(fb)![0][0]).toBeGreaterThan(before);
    store.undo();
    expect(store.getCorners(fb)![0][0]).toBe(before);
    store.setShowType('randomized');
    expect(store.allQuadIds()).toEqual([...store.config.frames.map((f) => f.id), WALL_QUAD_ID]);
  });

  it('test patterns: a new frame starts with its pattern on while any is on; assigning an asset turns it off', () => {
    const store = choreo();
    const e = store.addEntry();
    store.setEditedEntry(e);
    expect(store.isTestPatternOn(store.addChoreoFrame(e)!)).toBe(false);
    store.showAllTestPatterns();
    const f = store.addChoreoFrame(e)!;
    expect(store.isTestPatternOn(f)).toBe(true);
    store.updateChoreoFrame(f, { delay: 1 });
    expect(store.isTestPatternOn(f)).toBe(true);
    store.updateChoreoFrame(f, { asset: { pool: 'p.json', filepath: 'a.jpg' } });
    expect(store.isTestPatternOn(f)).toBe(false);
  });

  it('frame assets follow a filepath edit, are reported as users, and stay (missing) when the asset goes', () => {
    const store = choreo();
    store.setPools([pool]);
    const e = store.addEntry();
    const f = store.addChoreoFrame(e)!;
    store.updateChoreoFrame(f, { asset: { pool: 'p.json', filepath: 'a.jpg' } });
    expect(store.framesUsingAsset('a1')).toEqual([f]);
    expect(store.framesUsingPool('p.json')).toEqual([f]);
    store.markConfigSaved();
    store.updateAsset('a1', { filepath: 'media/a.jpg' });
    expect(store.findChoreoFrame(f)!.frame.asset).toEqual({ pool: 'p.json', filepath: 'media/a.jpg' });
    expect(store.runtime.configDirty).toBe(true);
    store.removeAsset('a1');
    expect(store.findChoreoFrame(f)!.frame.asset).toEqual({ pool: 'p.json', filepath: 'media/a.jpg' });
  });

  it('replaceConfig keeps the edited entry only if it still exists, and clears solo', () => {
    const store = choreo();
    const e = store.addEntry();
    store.setEditedEntry(e);
    store.setSolo(store.addChoreoFrame(e));
    store.replaceConfig(store.configSnapshot(), 'show');
    expect(store.runtime.editedEntryId).toBe(e);
    expect(store.runtime.soloFrameId).toBeNull();
    store.replaceConfig(defaultConfig(VP.w / VP.h), 'other');
    expect(store.runtime.editedEntryId).toBeNull();
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

  it('adding to the wallpaper turns off the wall\'s pattern only', () => {
    const { store } = makeStore();
    store.showAllTestPatterns();
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'p.json', filepath: 'a.jpg' });
    expect(store.isTestPatternOn(WALL_QUAD_ID)).toBe(false);
    expect(store.config.frames.every((f) => store.isTestPatternOn(f.id))).toBe(true);
  });

  it('adding files to a pool turns off every frame\'s pattern in a randomized show, not the wall\'s', () => {
    const { store } = makeStore();
    store.setPools([pool]);
    store.showAllTestPatterns();
    store.addAssets('p.json', [rec('a')]);
    expect(store.config.frames.every((f) => !store.isTestPatternOn(f.id))).toBe(true);
    expect(store.isTestPatternOn(WALL_QUAD_ID)).toBe(true);
  });

  it('in a choreographed show, adding files to a pool leaves the patterns alone', () => {
    const { store } = makeStore();
    store.setPools([pool]);
    store.setShowType('choreographed');
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
    const { store } = makeStore();
    store.setPools([pool('art.json', ['a.jpg', 'b.jpg'])]);
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'art.json', filepath: 'a.jpg' });
    expect(store.framesUsingAsset('art.json#0')).toEqual([WALL_QUAD_ID]);
    expect(store.framesUsingAsset('art.json#1')).toEqual([]);
    store.setAssetError('art.json#0', 'broken');
    store.removeAsset('art.json#0');
    expect(store.pools[0]!.assets.map((a) => a.uid)).toEqual(['art.json#1']);
    expect(store.pools[0]!.dirty).toBe(true);
    expect(store.runtime.assetErrors['art.json#0']).toBeUndefined();
    expect(store.config.wallQuad.playlist).toEqual([{ pool: 'art.json', filepath: 'a.jpg' }]);
  });

  it('removes a pool from the show and the config, keeping playlist entries (shown missing)', () => {
    const { store } = makeStore();
    store.setPools([pool('art.json', ['a.jpg']), { ...pool('video.json', ['v.mp4']), dirty: true }]);
    store.replaceConfig({ ...store.configSnapshot(), assetPools: ['art.json', 'video.json'] }, 'show');
    store.addToPlaylist(WALL_QUAD_ID, { pool: 'video.json', filepath: 'v.mp4' });
    store.setAssetError('video.json#0', 'broken');
    expect(store.framesUsingPool('video.json')).toEqual([WALL_QUAD_ID]);
    expect(store.runtime.assetsDirty).toBe(false); // setPools clears it; mark it via an edit
    store.updateAsset('video.json#0', { title: 'x' });
    store.removePool('video.json');
    expect(store.pools.map((m) => m.path)).toEqual(['art.json']);
    expect(store.config.assetPools).toEqual(['art.json']);
    expect(store.runtime.assetErrors['video.json#0']).toBeUndefined();
    expect(store.runtime.assetsDirty).toBe(false); // the only modified pool is gone
    expect(store.runtime.configDirty).toBe(true);
    expect(store.config.wallQuad.playlist).toEqual([{ pool: 'video.json', filepath: 'v.mp4' }]);
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
