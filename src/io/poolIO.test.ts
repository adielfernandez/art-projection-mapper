import { describe, expect, it } from 'vitest';
import { newAssetRecord, newPoolRecord, numberedName, parsePool, poolPathFromName, relativeMediaPath, resolveMediaPath, serializePool } from './poolIO';

describe('pool parse/serialize', () => {
  it('round-trips the brief example unchanged', () => {
    const raw = {
      schemaVersion: 1,
      assets: [
        { title: 'The Starry Night', artist: 'Vincent van Gogh', year: '1889', filepath: 'media/starry-night.jpg', zoom: true, pan: false },
        { filepath: 'media/clip.mp4' },
      ],
    };
    const m = parsePool(raw, 'pools/paintings.json');
    expect(m.warnings).toEqual([]);
    expect(JSON.parse(serializePool(m))).toEqual(raw);
  });

  it('keeps unknown fields and edits round-trip', () => {
    const raw = { schemaVersion: 1, note: 'keep me', assets: [{ filepath: 'a.jpg', custom: 42 }] };
    const m = parsePool(raw, 'm.json');
    m.assets[0]!.entry.title = 'New title';
    m.assets[0]!.entry.zoom = true;
    expect(JSON.parse(serializePool(m))).toEqual({
      schemaVersion: 1,
      note: 'keep me',
      assets: [{ title: 'New title', filepath: 'a.jpg', zoom: true, custom: 42 }],
    });
  });

  it('clearing a field that was present writes an empty string (same meaning, same keys)', () => {
    const m = parsePool({ assets: [{ title: 'X', filepath: 'a.jpg', pan: true }] }, 'm.json');
    m.assets[0]!.entry.title = '';
    m.assets[0]!.entry.pan = false;
    expect(JSON.parse(serializePool(m)).assets[0]).toEqual({ title: '', filepath: 'a.jpg', pan: false });
  });

  it('skips entries without filepath and warns on bad types', () => {
    const m = parsePool({ assets: [{ title: 'no path' }, 5, { filepath: 'b.png', zoom: 'yes', year: 1889 }] }, 'm.json');
    expect(m.assets).toHaveLength(1);
    expect(m.assets[0]!.entry).toEqual({ filepath: 'b.png', year: '1889' });
    expect(m.warnings).toHaveLength(3);
  });

  it('parses wallOnly, writing it only when set or already present', () => {
    const raw = { schemaVersion: 1, assets: [{ filepath: 'a.jpg', wallOnly: true }, { filepath: 'b.jpg' }] };
    const m = parsePool(raw, 'm.json');
    expect(m.warnings).toEqual([]);
    expect(m.assets.map((a) => a.entry.wallOnly)).toEqual([true, undefined]);
    expect(JSON.parse(serializePool(m))).toEqual(raw);
    m.assets[0]!.entry.wallOnly = false;
    expect(JSON.parse(serializePool(m)).assets[0]).toEqual({ filepath: 'a.jpg', wallOnly: false });
    expect(parsePool({ assets: [{ filepath: 'c.jpg', wallOnly: 'yes' }] }, 'm.json').warnings).toHaveLength(1);
  });

  it('gives duplicate entries distinct uids', () => {
    const m = parsePool({ assets: [{ filepath: 'a.jpg' }, { filepath: 'a.jpg' }] }, 'm.json');
    expect(m.assets[0]!.uid).not.toBe(m.assets[1]!.uid);
  });

  it('rejects malformed pools', () => {
    expect(() => parsePool([], 'm.json')).toThrow();
    expect(() => parsePool({}, 'm.json')).toThrow(/assets/);
    expect(() => parsePool({ schemaVersion: 9, assets: [] }, 'm.json')).toThrow();
  });
});

describe('resolveMediaPath', () => {
  it('resolves media relative to the pool location', () => {
    expect(resolveMediaPath('pools/paintings.json', 'media/a.jpg')).toBe('pools/media/a.jpg');
    expect(resolveMediaPath('paintings.json', 'media/a.jpg')).toBe('media/a.jpg');
    expect(resolveMediaPath('pools/p.json', '../shared/a.jpg')).toBe('pools/../shared/a.jpg');
  });
});

describe('adding content', () => {
  it('writes the filepath, zoom and pan (even when false) for a new asset; a new pool starts modified and empty', () => {
    const pool = newPoolRecord('Paintings.json');
    expect(pool).toMatchObject({ path: 'Paintings.json', assets: [], error: null, dirty: true });
    pool.assets.push(newAssetRecord('media/a.jpg'), newAssetRecord('media/b.mp4'));
    expect(pool.assets[0]!.uid).not.toBe(pool.assets[1]!.uid);
    expect(JSON.parse(serializePool(pool))).toEqual({
      schemaVersion: 1,
      assets: [
        { filepath: 'media/a.jpg', zoom: false, pan: false, wallOnly: false },
        { filepath: 'media/b.mp4', zoom: false, pan: false, wallOnly: false },
      ],
    });
    pool.assets[0]!.entry.zoom = true;
    pool.assets[0]!.entry.title = 'Night';
    expect(JSON.parse(serializePool(pool)).assets[0]).toEqual({ title: 'Night', filepath: 'media/a.jpg', zoom: true, pan: false, wallOnly: false });
  });

  it('turns a typed name into a pool file name, rejecting unusable names', () => {
    expect(poolPathFromName('  Paintings ')).toBe('Paintings.json');
    expect(poolPathFromName('videos.json')).toBe('videos.json');
    expect(poolPathFromName('Late night set')).toBe('Late night set.json');
    for (const bad of ['', '   ', '.json', 'a/b', 'a\\b', 'what?', '.hidden']) expect(() => poolPathFromName(bad)).toThrow();
  });

  it('makes paths of files inside the project relative to the pool', () => {
    expect(relativeMediaPath('art.json', ['media', 'a.jpg'])).toBe('media/a.jpg');
    expect(relativeMediaPath('pools/art.json', ['pools', 'media', 'a.jpg'])).toBe('media/a.jpg');
    expect(relativeMediaPath('pools/art.json', ['media', 'a.jpg'])).toBe('../media/a.jpg');
    expect(relativeMediaPath('pools/sub/art.json', ['pools', 'other', 'a.jpg'])).toBe('../other/a.jpg');
    expect(relativeMediaPath('pools/art.json', ['a.jpg'])).toBe('../a.jpg');
    // The result resolves back to the same project path.
    expect(resolveMediaPath('pools/sub/art.json', '../other/a.jpg')).toBe('pools/sub/../other/a.jpg');
  });

  it('numbers copies of a file name before the extension', () => {
    expect(numberedName('flame.mp4', 1)).toBe('flame.mp4');
    expect(numberedName('flame.mp4', 2)).toBe('flame (2).mp4');
    expect(numberedName('my.art.jpg', 3)).toBe('my.art (3).jpg');
    expect(numberedName('noext', 2)).toBe('noext (2)');
  });
});
