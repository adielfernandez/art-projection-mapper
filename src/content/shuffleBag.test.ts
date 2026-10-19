import { describe, expect, it } from 'vitest';
import { buildPool, mediaKind, poolMode, staticAssignments } from './assetPool';
import { ShuffleBag } from './shuffleBag';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

describe('ShuffleBag', () => {
  it('draws every item once per round', () => {
    const bag = new ShuffleBag(rng(1));
    bag.setItems(ids(7));
    for (let round = 0; round < 20; round++) {
      const drawn = Array.from({ length: 7 }, () => bag.next());
      expect(new Set(drawn).size).toBe(7);
    }
  });

  it('never repeats back to back across a reshuffle', () => {
    for (const n of [2, 3, 5, 9]) {
      for (let seed = 0; seed < 50; seed++) {
        const bag = new ShuffleBag(rng(seed));
        bag.setItems(ids(n));
        let prev = bag.next();
        for (let i = 0; i < n * 30; i++) {
          const cur = bag.next();
          expect(cur).not.toBe(prev);
          prev = cur;
        }
      }
    }
  });

  it('never shows the same asset in two frames at once when pool > frames', () => {
    // Simulate frames that each display one asset and preload another, in random order.
    for (const [frames, poolSize] of [[2, 3], [2, 5], [3, 4], [4, 12], [6, 7]] as const) {
      for (let seed = 0; seed < 30; seed++) {
        const r = rng(seed * 101 + frames);
        const bag = new ShuffleBag(r);
        bag.setItems(ids(poolSize));
        const shown: (string | null)[] = Array(frames).fill(null);
        const loading: (string | null)[] = Array(frames).fill(null);
        for (let step = 0; step < 500; step++) {
          const f = Math.floor(r() * frames);
          const exclude = new Set([...shown, ...loading].filter((x): x is string => x !== null));
          if (loading[f] === null) {
            loading[f] = bag.next(exclude); // may be null: deferred, retried later
          } else {
            shown[f] = loading[f]!;
            loading[f] = null;
          }
          const visible = shown.filter((x) => x !== null);
          expect(new Set(visible).size).toBe(visible.length);
          const all = [...visible, ...loading.filter((x) => x !== null)];
          expect(new Set(all).size).toBe(all.length);
        }
      }
    }
  });

  it('returns null when every item is excluded', () => {
    const bag = new ShuffleBag(rng(3));
    bag.setItems(['a', 'b']);
    expect(bag.next(new Set(['a', 'b']))).toBeNull();
    expect(bag.next(new Set(['a']))).toBe('b');
  });

  it('drops removed items and adds new ones to the current round', () => {
    const bag = new ShuffleBag(rng(4));
    bag.setItems(['a', 'b', 'c']);
    const first = bag.next()!;
    bag.setItems(['a', 'b', 'c', 'd'].filter((x) => x !== 'c' || first === 'c'));
    const rest = [bag.next(), bag.next(), bag.next()];
    const round = new Set([first, ...rest]);
    expect(round.has('d')).toBe(true);
    if (first !== 'c') expect(round.has('c')).toBe(false);
  });
});

describe('pool mode and static assignment', () => {
  it('selects mode from pool size vs frame count', () => {
    expect(poolMode(0, 2)).toBe('empty');
    expect(poolMode(3, 0)).toBe('empty');
    expect(poolMode(1, 2)).toBe('static');
    expect(poolMode(2, 2)).toBe('static');
    expect(poolMode(3, 2)).toBe('cycling');
  });

  it('wraps assets in list order when pool < frames', () => {
    const m = staticAssignments(['A', 'B'], ['f1', 'f2', 'f3']);
    expect([...m.values()]).toEqual(['A', 'B', 'A']);
  });

  it('assigns asset i to frame i when pool = frames', () => {
    const m = staticAssignments(['A', 'B', 'C'], ['f1', 'f2', 'f3']);
    expect([...m.entries()]).toEqual([['f1', 'A'], ['f2', 'B'], ['f3', 'C']]);
  });

  it('builds the pool in manifest order, skipping assets with errors, keeping duplicates', () => {
    const entry = (filepath: string) => ({ filepath });
    const pool = buildPool(
      [
        { path: 'p1.json', assets: [{ uid: 'u1', entry: entry('a.jpg') }, { uid: 'u2', entry: entry('b.jpg') }] },
        { path: 'p2.json', assets: [{ uid: 'u3', entry: entry('a.jpg') }, { uid: 'u4', entry: entry('c.mp4') }] },
      ],
      { u2: 'missing' },
    );
    expect(pool.map((p) => p.uid)).toEqual(['u1', 'u3', 'u4']);
  });

  it('infers media kind from the extension', () => {
    expect(mediaKind('media/x.JPG')).toBe('image');
    expect(mediaKind('a.avif')).toBe('image');
    expect(mediaKind('v.webm')).toBe('video');
    expect(mediaKind('v.mov')).toBeNull();
    expect(mediaKind('noext')).toBeNull();
  });
});
