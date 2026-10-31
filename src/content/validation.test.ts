import { describe, expect, it } from 'vitest';
import { newChoreoFrame, newEntry } from '../state/defaults';
import type { ChoreoFrameConfig, EntryConfig } from '../state/schema';
import { maxConcurrentVideos, validateEntry, type FrameAssetStatus } from './validation';

const frame = (id: string, file: string | null, fields: Partial<ChoreoFrameConfig> = {}): ChoreoFrameConfig => ({
  ...newChoreoFrame(0.5, 0.5, 16 / 9, [], []),
  id,
  asset: file ? { pool: 'p.json', filepath: file } : null,
  ...fields,
});
const entry = (holdTime: number | null, frames: ChoreoFrameConfig[], fields: Partial<EntryConfig> = {}): EntryConfig => ({ ...newEntry([]), holdTime, frames, ...fields });
const name = (i: number) => `Frame ${i + 1}`;
const valid = () => true;

describe('validateEntry', () => {
  it('flags frame asset problems and skips an entry with nothing playable', () => {
    const statuses: Record<string, FrameAssetStatus> = { a: 'missing', b: 'error', c: 'wallOnly', d: 'empty' };
    const e = entry(10, [frame('a', 'a.mp4'), frame('b', 'b.mp4'), frame('c', 'c.jpg'), frame('d', null)]);
    const r = validateEntry(e, (x) => statuses[x.id]!, name, valid);
    expect(r.skipped).toBe(true);
    expect(r.warnings).toEqual([
      'No playable frame: this entry is skipped.',
      'Frame 1: asset missing; skipped.',
      'Frame 2: asset failed to load; skipped.',
      'Frame 3: asset is marked wall only; skipped.',
      'Frame 4: no asset; skipped.',
    ]);
  });

  it('warns about loops and image durations when the entry has no hold time', () => {
    const e = entry(null, [frame('a', 'a.mp4', { loop: true }), frame('b', 'b.png'), frame('c', 'c.png', { duration: 4 })]);
    const r = validateEntry(e, () => 'ok', name, valid);
    expect(r.skipped).toBe(false);
    expect(r.warnings).toEqual([
      'Frame 1: loops, but the entry has no hold time, so it plays once.',
      'Frame 2: an image with no duration in an entry with no hold time; it lasts 10 s.',
    ]);
    expect(validateEntry(entry(20, e.frames), () => 'ok', name, valid).warnings).toEqual([]);
  });

  it('flags non-convex quads', () => {
    const e = entry(10, [frame('a', 'a.mp4')]);
    expect(validateEntry(e, () => 'ok', name, () => false).warnings).toEqual(['Frame 1: quad is not convex; the last valid mapping is used.']);
  });

  it('warns when more than two video frames play at once', () => {
    const e = entry(30, [frame('a', 'a.mp4'), frame('b', 'b.webm', { delay: 2 }), frame('c', 'c.mp4', { delay: 5 })]);
    expect(validateEntry(e, () => 'ok', name, valid).warnings).toEqual(['3 video frames play at once; more than two may stutter.']);
  });

  it('a disabled entry is skipped', () => {
    expect(validateEntry(entry(10, [frame('a', 'a.mp4')], { enabled: false }), () => 'ok', name, valid)).toEqual({ skipped: true, warnings: [] });
  });
});

describe('maxConcurrentVideos', () => {
  it('counts overlaps from delays and durations; images do not count', () => {
    const fs = [
      frame('a', 'a.mp4', { duration: 4 }),
      frame('b', 'b.mp4', { delay: 4, duration: 4 }),
      frame('c', 'c.mp4', { delay: 3, duration: 2 }),
      frame('d', 'd.jpg'),
    ];
    expect(maxConcurrentVideos(fs, 20)).toBe(2);
  });

  it('a video with no duration runs to the entry end (or forever without a hold time)', () => {
    const fs = [frame('a', 'a.mp4'), frame('b', 'b.mp4', { delay: 50 }), frame('c', 'c.mp4', { delay: 60 })];
    expect(maxConcurrentVideos(fs, 55)).toBe(2);
    expect(maxConcurrentVideos(fs, null)).toBe(3);
  });
});
