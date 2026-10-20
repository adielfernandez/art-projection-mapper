import { describe, expect, it } from 'vitest';
import { applyHomography, quadNormToNdc, rectToQuad, type Mat3, type Quad } from '../math/homography';
import { defaultConfig } from '../state/defaults';
import { captionText, layoutCaption, lineAnim, lineBlockOrigin, lineBlocks, placeCaption, LINE_HEIGHT, type Measure } from './captionLayout';

const cfg = defaultConfig(16 / 9).captions; // titleSize 0.045, lineTwoSize 0.032, lineGap 0.012
/** Fake metrics: every character is 0.5 em wide. */
const measure: Measure = (text) => text.length * 0.5;
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('captionText', () => {
  it('builds title and "artist, year"', () => {
    expect(captionText({ filepath: 'x', title: 'Starry Night', artist: 'Van Gogh', year: '1889' })).toEqual({
      title: 'Starry Night',
      second: 'Van Gogh, 1889',
    });
  });

  it('renders one of artist/year alone without a comma', () => {
    expect(captionText({ filepath: 'x', artist: 'Van Gogh' })?.second).toBe('Van Gogh');
    expect(captionText({ filepath: 'x', year: '1889' })?.second).toBe('1889');
  });

  it('omits line 2 when neither exists, and never adds quotation marks', () => {
    expect(captionText({ filepath: 'x', title: 'Untitled' })).toEqual({ title: 'Untitled', second: null });
  });

  it('treats empty and whitespace-only values as no data', () => {
    expect(captionText({ filepath: 'x', title: '', artist: '', year: '' })).toBeNull();
    expect(captionText({ filepath: 'x' })).toBeNull();
    expect(captionText({ filepath: 'x', title: '   ', artist: 'A' })).toEqual({ title: null, second: 'A' });
  });

  it('collapses internal whitespace', () => {
    expect(captionText({ filepath: 'x', title: '  Two   words ' })?.title).toBe('Two words');
  });
});

describe('layoutCaption', () => {
  it('keeps a short title on one line at full size', () => {
    const l = layoutCaption({ title: 'Short', second: 'A, 1900' }, cfg, measure);
    expect(l.title).toEqual(['Short']);
    expect(l.scale).toBe(1);
    expect(l.titleSize).toBe(cfg.titleSize);
  });

  it('wraps a long title into two balanced lines when that fits', () => {
    // 30 chars × 0.5em × 0.045 = 0.675 fits; 60 chars = 1.35 does not.
    const title = 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll';
    const l = layoutCaption({ title, second: null }, cfg, measure);
    expect(l.title).toHaveLength(2);
    expect(l.title.join(' ')).toBe(title);
    expect(Math.abs(l.title[0]!.length - l.title[1]!.length)).toBeLessThanOrEqual(5);
    expect(l.scale).toBe(1);
  });

  it('scales both lines down uniformly when two lines still overflow', () => {
    const title = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const l = layoutCaption({ title, second: 'Artist' }, cfg, measure);
    expect(l.title).toHaveLength(2);
    expect(l.scale).toBeLessThan(1);
    const widest = Math.max(...l.title.map((t) => measure(t, 'title') * l.titleSize));
    close(widest, 1, 1e-9);
    close(l.secondSize / l.titleSize, cfg.lineTwoSize / cfg.titleSize);
    close(l.gap, cfg.lineGap * l.scale);
  });

  it('scales a single unbreakable word that is too wide', () => {
    const l = layoutCaption({ title: 'x'.repeat(100), second: null }, cfg, measure);
    expect(l.title).toEqual(['x'.repeat(100)]);
    close(measure(l.title[0]!, 'title') * l.titleSize, 1);
  });

  it('scales when line 2 alone is too wide', () => {
    const second = 'y'.repeat(200);
    const l = layoutCaption({ title: 'T', second }, cfg, measure);
    close(measure(second, 'second') * l.secondSize, 1);
  });

  it('respects maxWidth', () => {
    const l = layoutCaption({ title: 'x'.repeat(40), second: null }, cfg, measure, 0.5);
    close(measure(l.title[0]!, 'title') * l.titleSize, 0.5);
  });
});

describe('lineBlocks', () => {
  it('stacks line 2 below the title with the gap', () => {
    const l = layoutCaption({ title: 'Title', second: 'A' }, cfg, measure);
    const b = lineBlocks(l);
    expect(b.title).toEqual({ top: 0, height: cfg.titleSize * LINE_HEIGHT });
    close(b.second!.top, cfg.titleSize * LINE_HEIGHT + cfg.lineGap);
  });

  it("puts line 2 in line 1's position when there is no title", () => {
    const b = lineBlocks(layoutCaption({ title: null, second: 'A, 1900' }, cfg, measure));
    expect(b.title).toBeNull();
    expect(b.second!.top).toBe(0);
  });
});

describe('placeCaption', () => {
  // Wall quad = full canvas: wall-local (1 × 9/16) maps to the whole canvas.
  const fullWall = (): Mat3 => rectToQuad(1, 9 / 16, quadNormToNdc([[0, 0], [1, 0], [1, 1], [0, 1]]))!;

  it('anchors at the bottom-edge midpoint, pointing away (down) from an upright frame', () => {
    const corners: Quad = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.8], [0.2, 0.8]];
    const p = placeCaption(fullWall(), corners)!;
    close(p.mid[0], 0.3);
    close(p.mid[1], (1 - 0.8) * (9 / 16)); // wall-local is y-up
    close(p.along[0], 1);
    close(p.along[1], 0);
    close(p.away[0], 0);
    close(p.away[1], -1);
    close(p.length, 0.2);
  });

  it('follows a tilted bottom edge', () => {
    // BL lower than BR on screen: the edge rises to the right in y-up wall space.
    const corners: Quad = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.7], [0.2, 0.8]];
    const p = placeCaption(fullWall(), corners)!;
    const angle = Math.atan2(p.along[1], p.along[0]);
    close(angle, Math.atan2(0.1 * (9 / 16), 0.2));
    // Perpendicular and pointing below the edge.
    close(p.along[0] * p.away[0] + p.along[1] * p.away[1], 0);
    expect(p.away[1]).toBeLessThan(0);
  });

  it('measures in wall space through a non-identity wall mapping', () => {
    const wallCorners: Quad = [[0.1, 0.05], [0.95, 0.1], [0.9, 0.95], [0.05, 0.9]];
    const wallH = rectToQuad(1, 9 / 16, quadNormToNdc(wallCorners))!;
    // Place a frame whose bottom edge is a known wall-space segment.
    const toNorm = (x: number, y: number): [number, number] => {
      const [nx, ny] = applyHomography(wallH, [x, y]);
      return [(nx + 1) / 2, (1 - ny) / 2];
    };
    const corners: Quad = [toNorm(0.3, 0.4), toNorm(0.5, 0.4), toNorm(0.5, 0.2), toNorm(0.3, 0.2)];
    const p = placeCaption(wallH, corners)!;
    close(p.length, 0.2, 1e-9);
    close(p.mid[0], 0.4, 1e-9);
    close(p.mid[1], 0.2, 1e-9);
  });

  it('returns null for a degenerate edge', () => {
    expect(placeCaption(fullWall(), [[0, 0], [1, 0], [0.5, 0.5], [0.5, 0.5]])).toBeNull();
  });
});

describe('lineBlockOrigin', () => {
  const fullWall = (): Mat3 => rectToQuad(1, 9 / 16, quadNormToNdc([[0, 0], [1, 0], [1, 1], [0, 1]]))!;
  const corners: Quad = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.8], [0.2, 0.8]];
  const edgeY = (1 - 0.8) * (9 / 16);

  it('puts the text left edge at the BL corner with zero offset', () => {
    const p = placeCaption(fullWall(), corners)!;
    const o = lineBlockOrigin(p, 0.05, 0.1, 0, 0);
    close(o[0], 0.2); // BL x
    close(o[1], edgeY - (0.05 + 0.1) * 0.2); // below the edge by top + height frame widths
  });

  it('shifts along the edge by offsetX frame widths, either way, and leaves room for padding', () => {
    const p = placeCaption(fullWall(), corners)!;
    close(lineBlockOrigin(p, 0, 0.1, 0.1, 0)[0], 0.2 + 0.1 * 0.2);
    close(lineBlockOrigin(p, 0, 0.1, -0.25, 0)[0], 0.2 - 0.25 * 0.2);
    close(lineBlockOrigin(p, 0, 0.1, 0, 0.04)[0], 0.2 - 0.04 * 0.2);
  });

  it('follows a tilted edge', () => {
    const tilted: Quad = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.7], [0.2, 0.8]];
    const p = placeCaption(fullWall(), tilted)!;
    const o = lineBlockOrigin(p, 0, 0, 0.5, 0); // halfway along the edge, on it
    close(o[0], p.mid[0]);
    close(o[1], p.mid[1]);
  });
});

describe('lineAnim', () => {
  it('is hidden during the in-transition and fully shown after fadeDuration', () => {
    expect(lineAnim({ sinceIn: -0.5, fade: 1 }, cfg, 0)).toEqual({ opacity: 0, offset: cfg.riseDistance });
    const done = lineAnim({ sinceIn: cfg.fadeDuration, fade: 1 }, cfg, 0);
    expect(done.opacity).toBe(1);
    expect(done.offset).toBe(0);
  });

  it('rises toward the frame while fading in', () => {
    const mid = lineAnim({ sinceIn: cfg.fadeDuration / 2, fade: 1 }, cfg, 0);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.offset).toBeGreaterThan(0);
    expect(mid.offset).toBeLessThan(cfg.riseDistance);
    close(mid.offset, (1 - mid.opacity) * cfg.riseDistance);
  });

  it('delays line 2 by lineTwoDelay', () => {
    const t = { sinceIn: cfg.lineTwoDelay, fade: 1 };
    expect(lineAnim(t, cfg, cfg.lineTwoDelay).opacity).toBe(0);
    expect(lineAnim(t, cfg, 0).opacity).toBeGreaterThan(0);
  });

  it('fades out with the artwork', () => {
    expect(lineAnim({ sinceIn: 100, fade: 0.25 }, cfg, 0).opacity).toBe(0.25);
  });

  it('shows static-mode captions without animation', () => {
    expect(lineAnim({ sinceIn: null, fade: 1 }, cfg, cfg.lineTwoDelay)).toEqual({ opacity: 1, offset: 0 });
  });
});
