import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../state/defaults';
import { parseConfig, serializeConfig } from './configIO';
import { splitPath } from './projectFolder';

const ASPECT = 16 / 9;

describe('parseConfig', () => {
  it('round-trips a config exactly, including full-precision corner values', () => {
    const cfg = defaultConfig(ASPECT);
    cfg.frames[0]!.corners[0] = [0.1234567890123456, 0.98765432109876];
    cfg.frames[1]!.corners[2] = [1 / 3, 2 / 7];
    cfg.wallQuad.corners[1] = [0.9999999999999, 0.0000001];
    cfg.animation.transitionInStyle = 'fade';
    cfg.wallQuad.playlist = [{ pool: 'walls.json', filepath: 'media/damask.jpg' }];
    const { config, warnings } = parseConfig(JSON.parse(serializeConfig(cfg)), ASPECT);
    expect(warnings).toEqual([]);
    expect(config).toEqual(cfg);
  });

  it('parses the example config from the brief', () => {
    const raw = {
      schemaVersion: 2,
      assetPools: ['pools/paintings.json', 'pools/videos.json'],
      ui: { panelSide: 'left' },
      global: { backgroundColor: '#000000', debug: { strokeWidth: 2, pointRadius: 14, crosshairSize: 22 } },
      wallQuad: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], debugColor: '#0A84FF' },
      frames: [
        {
          id: 'f_8k2j1',
          corners: [[0.2, 0.15], [0.38, 0.15], [0.38, 0.75], [0.2, 0.75]],
          physicalAspect: 0.6571,
          debugColor: '#FF453A',
          captionSpacing: 0.05,
          inset: { top: 0, right: 0, bottom: 0, left: 0 }, // no longer used: ignored
        },
      ],
    };
    const { config, warnings } = parseConfig(raw, ASPECT);
    expect(warnings).toEqual([]);
    expect(config.frames).toHaveLength(1);
    expect(config.frames[0]!.id).toBe('f_8k2j1');
    expect(config.assetPools).toEqual(raw.assetPools);
    // Missing sections fall back to defaults silently.
    expect(config.animation).toEqual(defaultConfig(ASPECT).animation);
  });

  it('falls back to defaults with warnings for invalid fields', () => {
    const { config, warnings } = parseConfig(
      {
        schemaVersion: 2,
        global: { backgroundColor: 'red', debug: { strokeWidth: -1 } },
        frames: [
          { id: 'a', corners: [[0, 0]], physicalAspect: 'tall' },
          { id: 'a', corners: [[0, 0], [1, 0], [1, 1], [0, 1]] },
          42,
        ],
      },
      ASPECT,
    );
    expect(config.global.backgroundColor).toBe('#000000');
    expect(config.global.debug.strokeWidth).toBe(2);
    expect(config.frames).toHaveLength(2);
    expect(config.frames[0]!.physicalAspect).toBe(0.6571);
    expect(config.frames[1]!.id).not.toBe('a'); // duplicate id replaced
    expect(config.frames[1]!.corners).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(warnings.length).toBeGreaterThanOrEqual(5);
  });

  it('fills transitionDelay and the dissolve settings for configs saved before they existed', () => {
    const old = { cycleDuration: 8, transitionInDuration: 2, transitionOutDuration: 1, frameStagger: 3 };
    const { config, warnings } = parseConfig({ schemaVersion: 2, animation: old }, ASPECT);
    expect(warnings).toEqual([]);
    expect(config.animation.cycleDuration).toBe(8);
    expect(config.animation.transitionDelay).toBe(0.5);
    expect(config.animation.dissolveSoftness).toBe(0.5);
    expect(config.animation.dissolveNoiseScale).toBe(1);

    const parsed = parseConfig(
      { schemaVersion: 2, animation: { transitionDelay: 0, dissolveSoftness: 0, dissolveNoiseScale: -2 } },
      ASPECT,
    );
    expect(parsed.config.animation.transitionDelay).toBe(0); // no black hold is valid
    expect(parsed.config.animation.dissolveSoftness).toBe(0.5); // must be positive
    expect(parsed.config.animation.dissolveNoiseScale).toBe(1); // must be positive
    expect(parsed.warnings).toHaveLength(2);
  });

  it('parses showType, frame playlists and blend, defaulting them when missing', () => {
    const cfg = defaultConfig(ASPECT);
    cfg.showType = 'manual';
    cfg.frames[1]!.blend = 'add';
    cfg.frames[0]!.title = 'The Nightmare';
    cfg.frames[0]!.playlist = [
      { pool: 'assets.json', filepath: 'media/a.jpg' },
      { pool: 'assets.json', filepath: 'media/a.jpg' }, // duplicates are allowed
    ];
    const round = parseConfig(JSON.parse(serializeConfig(cfg)), ASPECT);
    expect(round.warnings).toEqual([]);
    expect(round.config).toEqual(cfg);

    const old = parseConfig({ schemaVersion: 2, frames: [{ id: 'x' }] }, ASPECT);
    expect(old.warnings).toEqual([]);
    expect(old.config.showType).toBe('randomized');
    expect(old.config.frames[0]!.playlist).toEqual([]);
    expect(old.config.frames[0]!.blend).toBe('normal');
    expect(old.config.frames[0]!.title).toBe('Untitled');
  });

  it("parses a frame's own cycle duration and transition delay, with null (or missing) meaning unset", () => {
    const cfg = defaultConfig(ASPECT);
    cfg.frames[0]!.cycleDuration = 25;
    cfg.frames[0]!.transitionDelay = 0;
    const round = parseConfig(JSON.parse(serializeConfig(cfg)), ASPECT);
    expect(round.warnings).toEqual([]);
    expect(round.config).toEqual(cfg);

    const old = parseConfig({ schemaVersion: 2, frames: [{ id: 'x' }] }, ASPECT);
    expect(old.config.frames[0]).toMatchObject({ cycleDuration: null, transitionDelay: null });

    const bad = parseConfig({ schemaVersion: 2, frames: [{ id: 'x', cycleDuration: 0, transitionDelay: -1 }, { id: 'y', cycleDuration: '5' }] }, ASPECT);
    expect(bad.config.frames.map((f) => [f.cycleDuration, f.transitionDelay])).toEqual([[null, null], [null, null]]);
    expect(bad.warnings).toEqual([
      'frames[0].cycleDuration is invalid; using the Animation setting.',
      'frames[0].transitionDelay is invalid; using the Animation setting.',
      'frames[1].cycleDuration is invalid; using the Animation setting.',
    ]);
  });

  it('falls back to "Untitled" with a warning for a non-string title', () => {
    const { config, warnings } = parseConfig({ schemaVersion: 2, frames: [{ id: 'x', title: 7 }] }, ASPECT);
    expect(config.frames[0]!.title).toBe('Untitled');
    expect(warnings).toEqual(['frames[0].title must be a string; using "Untitled".']);
  });

  it('falls back with warnings for an invalid showType, blend and malformed playlist entries', () => {
    const { config, warnings } = parseConfig(
      {
        schemaVersion: 2,
        showType: 'shuffle',
        frames: [
          { id: 'a', playlist: [{ pool: 'm.json', filepath: 'x.jpg' }, { filepath: 'y.jpg' }, 'z.jpg'] },
          { id: 'b', playlist: 'nope', blend: 'screen' },
        ],
      },
      ASPECT,
    );
    expect(config.showType).toBe('randomized');
    expect(config.frames[0]!.playlist).toEqual([{ pool: 'm.json', filepath: 'x.jpg' }]);
    expect(config.frames[1]!.playlist).toEqual([]);
    expect(config.frames[1]!.blend).toBe('normal');
    expect(warnings).toHaveLength(5);
  });

  it('migrates v1 configs: assetManifests → assetPools and playlist "manifest" → "pool"', () => {
    const { config, warnings } = parseConfig(
      {
        schemaVersion: 1,
        assetManifests: ['art.json', 'videos.json'],
        frames: [
          { id: 'a', playlist: [{ manifest: 'art.json', filepath: 'media/a.jpg' }, { manifest: 'videos.json', filepath: 'media/b.mp4' }] },
          { id: 'b' },
        ],
      },
      ASPECT,
    );
    expect(warnings).toEqual([]);
    expect(config.assetPools).toEqual(['art.json', 'videos.json']);
    expect(config.frames[0]!.playlist).toEqual([
      { pool: 'art.json', filepath: 'media/a.jpg' },
      { pool: 'videos.json', filepath: 'media/b.mp4' },
    ]);
    const saved = JSON.parse(serializeConfig(config));
    expect(saved.schemaVersion).toBe(2);
    expect(saved.assetManifests).toBeUndefined();
    expect(saved.assetPools).toEqual(['art.json', 'videos.json']);
  });

  it('defaults the transition-in style and wall playlist, and warns on bad values', () => {
    const old = parseConfig({ schemaVersion: 2, effects: { back: { type: 'x', params: {} } } }, ASPECT);
    expect(old.warnings).toEqual([]); // the old "effects" section is ignored
    expect(old.config.animation.transitionInStyle).toBe('noise');
    expect(old.config.wallQuad.playlist).toEqual([]);
    expect('effects' in old.config).toBe(false);
    const bad = parseConfig(
      { schemaVersion: 2, animation: { transitionInStyle: 'wipe' }, wallQuad: { playlist: [{ pool: 'a.json', filepath: 'x.jpg' }, 7] } },
      ASPECT,
    );
    expect(bad.config.animation.transitionInStyle).toBe('noise');
    expect(bad.config.wallQuad.playlist).toEqual([{ pool: 'a.json', filepath: 'x.jpg' }]);
    expect(bad.warnings).toHaveLength(2);
  });

  it('accepts an empty frame list', () => {
    expect(parseConfig({ schemaVersion: 2, frames: [] }, ASPECT).config.frames).toEqual([]);
  });

  it('rejects non-objects and newer schema versions', () => {
    expect(() => parseConfig([], ASPECT)).toThrow();
    expect(() => parseConfig({ schemaVersion: 99 }, ASPECT)).toThrow(/newer/);
  });
});

describe('defaultConfig', () => {
  it('has two frames side by side, centered vertically, 50% tall, shaped by physicalAspect', () => {
    const cfg = defaultConfig(ASPECT);
    expect(cfg.frames).toHaveLength(2);
    for (const f of cfg.frames) {
      const [tl, tr, br] = f.corners;
      expect(br[1] - tl[1]).toBeCloseTo(0.5, 12);
      expect((tl[1] + br[1]) / 2).toBeCloseTo(0.5, 12);
      // On-screen aspect (in px) equals the physical aspect.
      expect(((tr[0] - tl[0]) * ASPECT) / (br[1] - tl[1])).toBeCloseTo(f.physicalAspect, 12);
    }
    expect(cfg.frames[0]!.corners[0][0]).toBeLessThan(cfg.frames[1]!.corners[0][0]);
    expect(cfg.frames[0]!.debugColor).not.toBe(cfg.frames[1]!.debugColor);
    expect(cfg.frames[0]!.id).not.toBe(cfg.frames[1]!.id);
  });
});

describe('splitPath', () => {
  it('splits relative paths and resolves dot segments', () => {
    expect(splitPath('pools/paintings.json')).toEqual({ dirs: ['pools'], name: 'paintings.json' });
    expect(splitPath('./a/../b\\c.json')).toEqual({ dirs: ['b'], name: 'c.json' });
  });

  it('rejects paths that escape the folder or have no file name', () => {
    expect(() => splitPath('../x.json')).toThrow();
    expect(() => splitPath('a/')).toThrow();
  });
});
