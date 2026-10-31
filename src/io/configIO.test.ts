import { describe, expect, it } from 'vitest';
import { defaultConfig, newChoreoFrame } from '../state/defaults';
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

  it('parses showType and blend, defaulting them when missing', () => {
    const cfg = defaultConfig(ASPECT);
    cfg.frames[1]!.blend = 'add';
    cfg.frames[0]!.title = 'The Nightmare';
    const round = parseConfig(JSON.parse(serializeConfig(cfg)), ASPECT);
    expect(round.warnings).toEqual([]);
    expect(round.config).toEqual(cfg);

    const old = parseConfig({ schemaVersion: 3, frames: [{ id: 'x' }] }, ASPECT);
    expect(old.warnings).toEqual([]);
    expect(old.config.showType).toBe('randomized');
    expect(old.config.frames[0]!.blend).toBe('normal');
    expect(old.config.frames[0]!.title).toBe('Untitled');
    expect(old.config.choreography).toEqual({ crossfade: 2, entries: [] });
  });

  it('falls back to "Untitled" with a warning for a non-string title', () => {
    const { config, warnings } = parseConfig({ schemaVersion: 3, frames: [{ id: 'x', title: 7 }] }, ASPECT);
    expect(config.frames[0]!.title).toBe('Untitled');
    expect(warnings).toEqual(['frames[0].title must be a string; using "Untitled".']);
  });

  it('falls back with warnings for an invalid showType and blend (alpha is for choreographed frames only)', () => {
    const { config, warnings } = parseConfig(
      { schemaVersion: 3, showType: 'manual', frames: [{ id: 'a', blend: 'alpha' }, { id: 'b', blend: 'screen' }] },
      ASPECT,
    );
    expect(config.showType).toBe('randomized');
    expect(config.frames.map((f) => f.blend)).toEqual(['normal', 'normal']);
    expect(warnings).toHaveLength(3);
  });

  it('migrates v1 configs: assetManifests → assetPools', () => {
    const { config, warnings } = parseConfig({ schemaVersion: 1, assetManifests: ['art.json', 'videos.json'], frames: [{ id: 'a' }] }, ASPECT);
    expect(warnings).toEqual([]);
    expect(config.assetPools).toEqual(['art.json', 'videos.json']);
    const saved = JSON.parse(serializeConfig(config));
    expect(saved.schemaVersion).toBe(3);
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

describe('parseConfig: choreography', () => {
  const frame = (id: string, fields: Record<string, unknown> = {}) => ({ id, asset: { pool: 'p.json', filepath: `${id}.jpg` }, ...fields });

  it('a version 3 file round-trips unchanged', () => {
    const cfg = defaultConfig(ASPECT);
    cfg.showType = 'choreographed';
    cfg.choreography = {
      crossfade: 3,
      entries: [
        {
          id: 'e_k2j9a', name: 'Triptych', enabled: true, holdTime: 40, fadeTime: null,
          frames: [
            { ...newChoreoFrame(0.3, 0.5, ASPECT, cfg.frames.map((f) => f.id), []), id: 'f_a1b2c', title: 'Left', asset: { pool: 'pools/paintings.json', filepath: 'media/nightmare.jpg' }, fadeIn: 1.5, fadeOut: 1 },
            { ...newChoreoFrame(0.5, 0.5, ASPECT, [], ['#FF453A']), id: 'f_d3e4f', title: 'Smoke', corners: [[0, 0], [1, 0], [1, 1], [0, 1]], physicalAspect: 1.7778, asset: { pool: 'pools/videos.json', filepath: 'media/smoke.mp4' }, blend: 'add', delay: 4, duration: 20, loop: true, fadeIn: 2, fadeInStyle: 'fade', fadeOut: 2, opacity: 0.8 },
          ],
        },
        { id: 'e_off00', name: 'Off', enabled: false, holdTime: null, fadeTime: 0.5, frames: [] },
      ],
    };
    const text = serializeConfig(cfg);
    const round = parseConfig(JSON.parse(text), ASPECT);
    expect(round.warnings).toEqual([]);
    expect(round.config).toEqual(cfg);
    expect(serializeConfig(round.config)).toBe(text);
  });

  it('fills defaults for missing fields; save writes every field', () => {
    const { config, warnings } = parseConfig({ schemaVersion: 3, choreography: { entries: [{ id: 'e1', frames: [{ id: 'f1' }] }] } }, ASPECT);
    expect(warnings).toEqual([]);
    expect(config.choreography.crossfade).toBe(2);
    const e = config.choreography.entries[0]!;
    expect(e).toMatchObject({ id: 'e1', name: 'Entry', enabled: true, holdTime: null, fadeTime: null });
    expect(e.frames[0]).toMatchObject({
      id: 'f1', title: 'Untitled', physicalAspect: 0.6571, asset: null, blend: 'normal',
      delay: 0, duration: null, loop: false, fadeIn: 0.5, fadeInStyle: 'noise', fadeOut: 0.5, opacity: 1,
    });
    expect(Object.keys(JSON.parse(serializeConfig(config)).choreography.entries[0].frames[0]).sort()).toEqual(
      ['asset', 'blend', 'corners', 'debugColor', 'delay', 'duration', 'fadeIn', 'fadeInStyle', 'fadeOut', 'id', 'loop', 'opacity', 'physicalAspect', 'title'],
    );
  });

  it('warns on invalid values, falls back on an unknown fadeInStyle, and accepts alpha', () => {
    const { config, warnings } = parseConfig(
      {
        schemaVersion: 3,
        choreography: {
          crossfade: -1,
          entries: [
            { id: 'e1', holdTime: 0, fadeTime: 'x', enabled: 'yes', frames: [frame('f1', { fadeInStyle: 'wipe', blend: 'alpha', opacity: 2, duration: -3, delay: -1, asset: 'a.jpg' }), 'nope'] },
            'nope',
          ],
        },
      },
      ASPECT,
    );
    const e = config.choreography.entries[0]!;
    expect(config.choreography.crossfade).toBe(2);
    expect(config.choreography.entries).toHaveLength(1);
    expect(e).toMatchObject({ holdTime: null, fadeTime: null, enabled: true });
    expect(e.frames).toHaveLength(1);
    expect(e.frames[0]).toMatchObject({ fadeInStyle: 'noise', blend: 'alpha', opacity: 1, duration: null, delay: 0, asset: null });
    expect(warnings).toContain('choreography.entries[0].frames[0].fadeInStyle must be "fade" or "noise"; using "noise".');
    expect(warnings).toHaveLength(11);
  });

  it('ids missing or duplicated (across mapped and choreographed frames) get fresh ones', () => {
    const { config, warnings } = parseConfig(
      { schemaVersion: 3, frames: [{ id: 'f_same' }], choreography: { entries: [{ id: 'e1', frames: [frame('f_same'), frame('')] }, { id: 'e1' }] } },
      ASPECT,
    );
    const ids = [...config.frames.map((f) => f.id), ...config.choreography.entries.flatMap((e) => e.frames.map((f) => f.id))];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('f_same');
    expect(config.choreography.entries.map((e) => e.id)[0]).toBe('e1');
    expect(config.choreography.entries[1]!.id).not.toBe('e1');
    expect(warnings).toHaveLength(3);
  });
});

describe('migration from schemaVersion 2', () => {
  const v2Frame = (id: string, playlist: { pool: string; filepath: string }[], fields: Record<string, unknown> = {}) => ({
    id, title: `T-${id}`, corners: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.8], [0.1, 0.8]], physicalAspect: 0.8, debugColor: '#30D158',
    captionSpacing: 0.07, captionOffsetX: 0, blend: 'add', playlist, ...fields,
  });

  it('a manual show becomes one choreographed entry: one frame per mapped frame, playing its first item', () => {
    const { config, warnings } = parseConfig(
      {
        schemaVersion: 2,
        showType: 'manual',
        frames: [
          v2Frame('a', [{ pool: 'p.json', filepath: 'media/1.jpg' }, { pool: 'p.json', filepath: 'media/2.jpg' }, { pool: 'p.json', filepath: 'media/3.mp4' }]),
          v2Frame('b', [], { title: '' }),
        ],
      },
      ASPECT,
    );
    expect(config.showType).toBe('choreographed');
    expect(config.frames.map((f) => f.id)).toEqual(['a', 'b']); // kept for Randomized mode
    expect(config.choreography.entries).toHaveLength(1);
    const e = config.choreography.entries[0]!;
    expect(e).toMatchObject({ name: 'Converted from Manual', enabled: true, holdTime: 60, fadeTime: null });
    expect(e.id).toMatch(/^e_[a-z0-9]{5}$/);
    expect(e.frames).toHaveLength(2);
    const [fa, fb] = e.frames;
    expect(fa).toMatchObject({
      title: 'T-a', corners: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.8], [0.1, 0.8]], physicalAspect: 0.8, debugColor: '#30D158', blend: 'add',
      asset: { pool: 'p.json', filepath: 'media/1.jpg' }, loop: true, delay: 0, duration: null, fadeIn: 0.5, fadeInStyle: 'noise', fadeOut: 0.5, opacity: 1,
    });
    expect(fb!.asset).toBeNull();
    // New ids, unique across the show.
    expect(new Set(['a', 'b', fa!.id, fb!.id]).size).toBe(4);
    expect(warnings).toEqual([
      'Frame 1 (T-a): kept media/1.jpg; dropped media/2.jpg, media/3.mp4.',
      'Manual mode is now Choreographed: the frames became one entry, "Converted from Manual", lasting 60 s.',
    ]);
    const saved = JSON.parse(serializeConfig(config));
    expect(saved.schemaVersion).toBe(3);
    expect(saved.frames.every((f: object) => !('playlist' in f))).toBe(true);
  });

  it('a randomized show keeps its frames and drops their playlists', () => {
    const { config, warnings } = parseConfig(
      { schemaVersion: 2, showType: 'randomized', frames: [v2Frame('a', [{ pool: 'p.json', filepath: 'x.jpg' }]), v2Frame('b', [])] },
      ASPECT,
    );
    expect(config.showType).toBe('randomized');
    expect(config.frames.map((f) => [f.id, f.title, f.blend, f.captionSpacing])).toEqual([['a', 'T-a', 'add', 0.07], ['b', 'T-b', 'add', 0.07]]);
    expect(config.choreography.entries).toEqual([]);
    expect(warnings).toEqual(['Removed the frame playlists (a Randomized show never used them).']);
    expect(parseConfig({ schemaVersion: 2, frames: [v2Frame('a', [])] }, ASPECT).warnings).toEqual([]);
  });

  it('a v1 manual show migrates all the way, with "manifest" playlist items', () => {
    const { config } = parseConfig(
      { schemaVersion: 1, showType: 'manual', assetManifests: ['art.json'], frames: [{ id: 'a', playlist: [{ manifest: 'art.json', filepath: 'media/a.jpg' }] }] },
      ASPECT,
    );
    expect(config.assetPools).toEqual(['art.json']);
    expect(config.choreography.entries[0]!.frames[0]!.asset).toEqual({ pool: 'art.json', filepath: 'media/a.jpg' });
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
