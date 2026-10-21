import { describe, expect, it } from 'vitest';
import { parseManifest, resolveMediaPath, serializeManifest } from './manifestIO';

describe('manifest parse/serialize', () => {
  it('round-trips the brief example unchanged', () => {
    const raw = {
      schemaVersion: 1,
      assets: [
        { title: 'The Starry Night', artist: 'Vincent van Gogh', year: '1889', filepath: 'media/starry-night.jpg', zoom: true, pan: false },
        { filepath: 'media/clip.mp4' },
      ],
    };
    const m = parseManifest(raw, 'pools/paintings.json');
    expect(m.warnings).toEqual([]);
    expect(JSON.parse(serializeManifest(m))).toEqual(raw);
  });

  it('keeps unknown fields and edits round-trip', () => {
    const raw = { schemaVersion: 1, note: 'keep me', assets: [{ filepath: 'a.jpg', custom: 42 }] };
    const m = parseManifest(raw, 'm.json');
    m.assets[0]!.entry.title = 'New title';
    m.assets[0]!.entry.zoom = true;
    expect(JSON.parse(serializeManifest(m))).toEqual({
      schemaVersion: 1,
      note: 'keep me',
      assets: [{ title: 'New title', filepath: 'a.jpg', zoom: true, custom: 42 }],
    });
  });

  it('clearing a field that was present writes an empty string (same meaning, same keys)', () => {
    const m = parseManifest({ assets: [{ title: 'X', filepath: 'a.jpg', pan: true }] }, 'm.json');
    m.assets[0]!.entry.title = '';
    m.assets[0]!.entry.pan = false;
    expect(JSON.parse(serializeManifest(m)).assets[0]).toEqual({ title: '', filepath: 'a.jpg', pan: false });
  });

  it('skips entries without filepath and warns on bad types', () => {
    const m = parseManifest({ assets: [{ title: 'no path' }, 5, { filepath: 'b.png', zoom: 'yes', year: 1889 }] }, 'm.json');
    expect(m.assets).toHaveLength(1);
    expect(m.assets[0]!.entry).toEqual({ filepath: 'b.png', year: '1889' });
    expect(m.warnings).toHaveLength(3);
  });

  it('gives duplicate entries distinct uids', () => {
    const m = parseManifest({ assets: [{ filepath: 'a.jpg' }, { filepath: 'a.jpg' }] }, 'm.json');
    expect(m.assets[0]!.uid).not.toBe(m.assets[1]!.uid);
  });

  it('rejects malformed manifests', () => {
    expect(() => parseManifest([], 'm.json')).toThrow();
    expect(() => parseManifest({}, 'm.json')).toThrow(/assets/);
    expect(() => parseManifest({ schemaVersion: 9, assets: [] }, 'm.json')).toThrow();
  });
});

describe('resolveMediaPath', () => {
  it('resolves media relative to the manifest location', () => {
    expect(resolveMediaPath('pools/paintings.json', 'media/a.jpg')).toBe('pools/media/a.jpg');
    expect(resolveMediaPath('paintings.json', 'media/a.jpg')).toBe('media/a.jpg');
    expect(resolveMediaPath('pools/p.json', '../shared/a.jpg')).toBe('pools/../shared/a.jpg');
  });
});
