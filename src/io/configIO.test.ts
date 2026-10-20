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
    cfg.effects.back.params = { speed: 0.5, mode: 'soft', on: true };
    const { config, warnings } = parseConfig(JSON.parse(serializeConfig(cfg)), ASPECT);
    expect(warnings).toEqual([]);
    expect(config).toEqual(cfg);
  });

  it('parses the example config from the brief', () => {
    const raw = {
      schemaVersion: 1,
      assetManifests: ['pools/paintings.json', 'pools/videos.json'],
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
          inset: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      ],
    };
    const { config, warnings } = parseConfig(raw, ASPECT);
    expect(warnings).toEqual([]);
    expect(config.frames).toHaveLength(1);
    expect(config.frames[0]!.id).toBe('f_8k2j1');
    expect(config.assetManifests).toEqual(raw.assetManifests);
    // Missing sections fall back to defaults silently.
    expect(config.animation).toEqual(defaultConfig(ASPECT).animation);
  });

  it('falls back to defaults with warnings for invalid fields', () => {
    const { config, warnings } = parseConfig(
      {
        schemaVersion: 1,
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
    const { config, warnings } = parseConfig({ schemaVersion: 1, animation: old }, ASPECT);
    expect(warnings).toEqual([]);
    expect(config.animation.cycleDuration).toBe(8);
    expect(config.animation.transitionDelay).toBe(0.5);
    expect(config.animation.dissolveSoftness).toBe(0.5);
    expect(config.animation.dissolveNoiseScale).toBe(1);

    const parsed = parseConfig(
      { schemaVersion: 1, animation: { transitionDelay: 0, dissolveSoftness: 0, dissolveNoiseScale: -2 } },
      ASPECT,
    );
    expect(parsed.config.animation.transitionDelay).toBe(0); // no black hold is valid
    expect(parsed.config.animation.dissolveSoftness).toBe(0.5); // must be positive
    expect(parsed.config.animation.dissolveNoiseScale).toBe(1); // must be positive
    expect(parsed.warnings).toHaveLength(2);
  });

  it('accepts an empty frame list', () => {
    expect(parseConfig({ schemaVersion: 1, frames: [] }, ASPECT).config.frames).toEqual([]);
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
