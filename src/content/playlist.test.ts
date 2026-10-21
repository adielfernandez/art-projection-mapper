import { describe, expect, it } from 'vitest';
import { nextEntry, playlistMode, relocateAnchor, resolvePlaylist, START_ANCHOR, type PlaylistEntry } from './playlist';

const pools = [
  {
    path: 'assets.json',
    assets: [
      { uid: 'a', entry: { filepath: 'a.jpg' } },
      { uid: 'b', entry: { filepath: 'b.jpg' } },
      { uid: 'dup', entry: { filepath: 'a.jpg' } }, // same filepath: the first one wins
    ],
  },
  { path: 'more.json', assets: [{ uid: 'c', entry: { filepath: 'a.jpg' } }] },
];
const item = (pool: string, filepath: string) => ({ pool, filepath });
/** Entries with keys 1..n; null uid = unplayable. */
const entries = (...uids: (string | null)[]): PlaylistEntry[] =>
  uids.map((uid, i) => ({ key: i + 1, uid, status: uid ? 'ok' : 'missing' }));

describe('resolvePlaylist', () => {
  it('finds assets by pool and filepath, flagging missing and errored ones', () => {
    const r = resolvePlaylist(
      [item('assets.json', 'a.jpg'), item('more.json', 'a.jpg'), item('assets.json', 'nope.jpg'), item('gone.json', 'a.jpg'), item('assets.json', 'b.jpg')],
      [10, 11, 12, 13, 14],
      pools,
      { b: 'decode failed' },
    );
    expect(r).toEqual([
      { key: 10, uid: 'a', status: 'ok' },
      { key: 11, uid: 'c', status: 'ok' },
      { key: 12, uid: null, status: 'missing' },
      { key: 13, uid: null, status: 'missing' },
      { key: 14, uid: null, status: 'error' },
    ]);
  });
});

describe('resolvePlaylist and wall-only assets', () => {
  const pools = [
    {
      path: 'p.json',
      assets: [
        { uid: 'w', entry: { filepath: 'paper.jpg', wallOnly: true } },
        { uid: 'x1', entry: { filepath: 'dup.jpg', wallOnly: true } },
        { uid: 'x2', entry: { filepath: 'dup.jpg' } },
        { uid: 'a', entry: { filepath: 'a.jpg' } },
      ],
    },
  ];
  const items = [item('p.json', 'paper.jpg'), item('p.json', 'dup.jpg'), item('p.json', 'a.jpg')];

  it('a frame skips wall-only assets, using an unmarked copy of the same file if there is one', () => {
    expect(resolvePlaylist(items, [1, 2, 3], pools, {})).toEqual([
      { key: 1, uid: null, status: 'wallOnly' },
      { key: 2, uid: 'x2', status: 'ok' },
      { key: 3, uid: 'a', status: 'ok' },
    ]);
  });

  it('the wall may use any asset', () => {
    expect(resolvePlaylist(items, [1, 2, 3], pools, {}, true).map((e) => e.uid)).toEqual(['w', 'x1', 'a']);
  });
});

describe('playlistMode', () => {
  it('is black with nothing playable, static with one, cycling with more', () => {
    expect(playlistMode([])).toBe('empty');
    expect(playlistMode(entries(null, null))).toBe('empty');
    expect(playlistMode(entries(null, 'a', null))).toBe('static');
    expect(playlistMode(entries('a', 'a'))).toBe('cycling'); // a duplicate still cycles
    expect(playlistMode(entries('a', 'b'))).toBe('cycling');
  });
});

describe('nextEntry', () => {
  it('starts at the top, steps in order and loops', () => {
    const e = entries('a', 'b', 'c');
    expect(nextEntry(e, START_ANCHOR)).toBe(0);
    expect(nextEntry(e, { key: 1, index: 0 })).toBe(1);
    expect(nextEntry(e, { key: 3, index: 2 })).toBe(0);
  });

  it('skips entries that cannot play', () => {
    const e = entries(null, 'b', null, 'd');
    expect(nextEntry(e, START_ANCHOR)).toBe(1);
    expect(nextEntry(e, { key: 2, index: 1 })).toBe(3);
    expect(nextEntry(e, { key: 4, index: 3 })).toBe(1);
    expect(nextEntry(entries(null, null), START_ANCHOR)).toBe(-1);
    expect(nextEntry([], START_ANCHOR)).toBe(-1);
  });

  it('copes with an anchor index past the end', () => {
    expect(nextEntry(entries('a', 'b'), { key: null, index: 5 })).toBe(0);
  });
});

describe('relocateAnchor', () => {
  it('follows a moved entry', () => {
    const moved: PlaylistEntry[] = [
      { key: 3, uid: 'c', status: 'ok' },
      { key: 1, uid: 'a', status: 'ok' },
      { key: 2, uid: 'b', status: 'ok' },
    ];
    const a = relocateAnchor(moved, { key: 1, index: 0 });
    expect(a).toEqual({ key: 1, index: 1 });
    expect(moved[nextEntry(moved, a)]!.key).toBe(2); // still plays b after a
  });

  it('plays the entry that took a removed entry\'s place, and stays put on later relocations', () => {
    // Was [a(1), b(2), c(3)] showing b; b removed.
    const e: PlaylistEntry[] = [
      { key: 1, uid: 'a', status: 'ok' },
      { key: 3, uid: 'c', status: 'ok' },
    ];
    const a = relocateAnchor(e, { key: 2, index: 1 });
    expect(a).toEqual({ key: null, index: 0 });
    expect(relocateAnchor(e, a)).toEqual(a);
    expect(e[nextEntry(e, a)]!.uid).toBe('c');
  });

  it('removing the first entry while it shows plays the new first entry next', () => {
    const e = entries('b', 'c');
    const a = relocateAnchor(e, { key: 99, index: 0 });
    expect(e[nextEntry(e, a)]!.uid).toBe('b');
  });

  it('tells duplicates apart by key', () => {
    const e: PlaylistEntry[] = [
      { key: 1, uid: 'a', status: 'ok' },
      { key: 2, uid: 'b', status: 'ok' },
      { key: 3, uid: 'a', status: 'ok' },
      { key: 4, uid: 'c', status: 'ok' },
    ];
    expect(e[nextEntry(e, relocateAnchor(e, { key: 3, index: 2 }))]!.uid).toBe('c');
  });
});
