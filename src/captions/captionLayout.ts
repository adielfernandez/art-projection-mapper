/**
 * Caption text, wrapping, placement and timing (brief §5.5). Pure functions; the
 * renderer supplies text measurement and draws the result.
 *
 * Units: one "frame width" L = the frame's bottom-edge length in wall space. All
 * sizes here are in L unless noted.
 */
import { applyHomography, invert3, normToNdc, type Mat3, type Vec2 } from '../math/homography';
import type { AssetEntry, CaptionConfig } from '../state/schema';

/** Line advance as a multiple of font size. Glyphs are drawn centered in this slot. */
export const LINE_HEIGHT = 1.25;
/** Title wraps to at most this many lines before scaling down. */
const MAX_TITLE_LINES = 2;

// ---------- text ----------

export interface CaptionText {
  /** Title (Source Serif 4 Italic), or null. */
  title: string | null;
  /** "artist, year" (Public Sans), or null. */
  second: string | null;
}

const clean = (s: string | undefined): string | null => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

/** Caption lines for an asset, or null when it has no text data. */
export function captionText(entry: Readonly<AssetEntry>): CaptionText | null {
  const title = clean(entry.title);
  const parts = [clean(entry.artist), clean(entry.year)].filter((p): p is string => p !== null);
  const second = parts.length ? parts.join(', ') : null;
  return title || second ? { title, second } : null;
}

// ---------- wrapping and sizing ----------

/** Width of `text` set at font size 1 in the given face. */
export type Measure = (text: string, face: 'title' | 'second') => number;

export interface CaptionLines {
  /** 0, 1 or 2 title lines. */
  title: string[];
  second: string | null;
  /** Uniform scale applied to both lines (≤ 1) so everything fits within maxWidth. */
  scale: number;
  titleSize: number;
  secondSize: number;
  gap: number;
}

/** Split into at most two lines, choosing the split with the narrowest widest line. */
function wrapTitle(text: string, measure: Measure): { lines: string[]; width: number } {
  const words = text.split(' ');
  let best = { lines: [text], width: measure(text, 'title') };
  if (MAX_TITLE_LINES < 2 || words.length < 2) return best;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const width = Math.max(measure(a, 'title'), measure(b, 'title'));
    if (width < best.width) best = { lines: [a, b], width };
  }
  return best;
}

/**
 * Lay out caption lines within `maxWidth` (normally 1 = the bottom-edge length).
 * The title stays on one line when it fits; otherwise it wraps to two balanced lines;
 * if those still overflow, both lines scale down together.
 */
export function layoutCaption(text: CaptionText, cfg: Readonly<CaptionConfig>, measure: Measure, maxWidth = 1): CaptionLines {
  let title: string[] = [];
  let widest = 0;
  if (text.title) {
    const single = measure(text.title, 'title') * cfg.titleSize;
    if (single <= maxWidth) {
      title = [text.title];
      widest = single;
    } else {
      const wrapped = wrapTitle(text.title, measure);
      title = wrapped.lines;
      widest = wrapped.width * cfg.titleSize;
    }
  }
  if (text.second) widest = Math.max(widest, measure(text.second, 'second') * cfg.lineTwoSize);
  const scale = widest > maxWidth ? maxWidth / widest : 1;
  return {
    title,
    second: text.second,
    scale,
    titleSize: cfg.titleSize * scale,
    secondSize: cfg.lineTwoSize * scale,
    gap: cfg.lineGap * scale,
  };
}

/** Vertical extents (L units, measured away from the frame) of the two line blocks. */
export function lineBlocks(l: CaptionLines): { title: { top: number; height: number } | null; second: { top: number; height: number } | null } {
  const titleH = l.title.length * l.titleSize * LINE_HEIGHT;
  const title = l.title.length ? { top: 0, height: titleH } : null;
  // With no title, line 2 takes line 1's position.
  const second = l.second ? { top: title ? titleH + l.gap : 0, height: l.secondSize * LINE_HEIGHT } : null;
  return { title, second };
}

// ---------- placement ----------

export interface CaptionPlacement {
  /** Bottom-edge midpoint in wall-local space. */
  mid: Vec2;
  /** Unit vector along the bottom edge, BL → BR (text baseline direction). */
  along: Vec2;
  /** Unit vector perpendicular to the edge, pointing away from the frame. */
  away: Vec2;
  /** Bottom-edge length in wall-local units (one frame width, L). */
  length: number;
}

/**
 * Map a frame's bottom edge into wall-local space via the inverse wall homography.
 * `wallH` maps wall-local → NDC; corners are canvas-normalized [TL, TR, BR, BL].
 * Returns null if the wall homography is not invertible or the edge is degenerate.
 */
export function placeCaption(wallH: Mat3, frameCorners: readonly (readonly [number, number])[]): CaptionPlacement | null {
  const inv = invert3(wallH);
  const br = frameCorners[2];
  const bl = frameCorners[3];
  if (!inv || !br || !bl) return null;
  const a = applyHomography(inv, normToNdc(bl));
  const b = applyHomography(inv, normToNdc(br));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) return null;
  const along: Vec2 = [dx / length, dy / length];
  // Wall-local is y-up and the frame lies to the left of BL → BR, so "away" is the clockwise normal.
  // This also keeps the text basis right-handed, so captions never render mirrored.
  const away: Vec2 = [along[1], -along[0]];
  return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], along, away, length };
}

/**
 * Bottom-left corner, in wall space, of a left-aligned line block. The text's left edge sits
 * `offsetX` frame widths along the edge from the BL corner; the block starts `pad` frame widths
 * before that (room for glyph overhang). `top` and `height` are in frame widths below the edge.
 */
export function lineBlockOrigin(p: CaptionPlacement, top: number, height: number, offsetX: number, pad: number): Vec2 {
  const s = (offsetX - 0.5 - pad) * p.length; // from the edge midpoint along the edge
  const d = (top + height) * p.length; // away from the frame
  return [p.mid[0] + p.along[0] * s + p.away[0] * d, p.mid[1] + p.along[1] * s + p.away[1] * d];
}

// ---------- timing ----------

export interface CaptionTiming {
  /**
   * Seconds since the artwork's in-transition ended (negative while it is still
   * dissolving in). null = static mode: show fully, no animation.
   */
  sinceIn: number | null;
  /** Artwork out-fade, 1 = visible .. 0 = black. */
  fade: number;
}

export interface LineAnim {
  opacity: number;
  /** Offset away from the frame, in L units (rises toward the frame as it fades in). */
  offset: number;
}

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

/** Opacity and rise for one line, starting `delay` seconds after the in-transition ends. */
export function lineAnim(t: CaptionTiming, cfg: Readonly<CaptionConfig>, delay: number): LineAnim {
  if (t.sinceIn === null) return { opacity: 1, offset: 0 };
  const x = cfg.fadeDuration > 0 ? (t.sinceIn - delay) / cfg.fadeDuration : t.sinceIn >= delay ? 1 : 0;
  const p = easeOutCubic(Math.min(1, Math.max(0, x)));
  return { opacity: p * t.fade, offset: (1 - p) * cfg.riseDistance };
}
