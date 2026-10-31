import { CONFIG_SCHEMA_VERSION, type ChoreoFrameConfig, type Config, type Corners, type EntryConfig, type FrameConfig } from './schema';

export const DEFAULT_PHYSICAL_ASPECT = 0.6571; // 23" × 35"
export const DEFAULT_FRAME_TITLE = 'Untitled';
/** Default frame height as a fraction of canvas height. */
export const DEFAULT_FRAME_HEIGHT = 0.5;
export const DEFAULT_ENTRY_NAME = 'Entry';
export const DEFAULT_CROSSFADE = 2;

export const FRAME_COLORS = [
  '#FF453A', '#30D158', '#FFD60A', '#BF5AF2',
  '#FF9F0A', '#64D2FF', '#FF375F', '#AC8E68',
];

/** First palette color not used by an existing frame (cycles if all are used). */
export function nextFrameColor(used: readonly string[]): string {
  const lower = new Set(used.map((c) => c.toLowerCase()));
  const free = FRAME_COLORS.find((c) => !lower.has(c.toLowerCase()));
  return free ?? FRAME_COLORS[used.length % FRAME_COLORS.length]!;
}

function generateId(prefix: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  for (;;) {
    const id = prefix + Math.random().toString(36).slice(2, 7).padEnd(5, '0');
    if (!taken.has(id)) return id;
  }
}

/** A frame id not in `existing` (pass every frame id in the show, mapped and choreographed). */
export function generateFrameId(existing: readonly string[]): string {
  return generateId('f_', existing);
}

export function generateEntryId(existing: readonly string[]): string {
  return generateId('e_', existing);
}

/** Axis-aligned corners for a frame of the given physical aspect, centered at (cx, cy). */
export function frameCorners(
  cx: number,
  cy: number,
  physicalAspect: number,
  canvasAspect: number,
  height = DEFAULT_FRAME_HEIGHT,
): Corners {
  const w = (height * physicalAspect) / canvasAspect;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function newFrame(
  cx: number,
  cy: number,
  canvasAspect: number,
  existing: readonly FrameConfig[],
): FrameConfig {
  return {
    id: generateFrameId(existing.map((f) => f.id)),
    title: DEFAULT_FRAME_TITLE,
    corners: frameCorners(cx, cy, DEFAULT_PHYSICAL_ASPECT, canvasAspect),
    physicalAspect: DEFAULT_PHYSICAL_ASPECT,
    debugColor: nextFrameColor(existing.map((f) => f.debugColor)),
    captionSpacing: 0.05,
    captionOffsetX: 0,
    blend: 'normal',
  };
}

/** A choreography entry with no frames. */
export function newEntry(existingIds: readonly string[]): EntryConfig {
  return { id: generateEntryId(existingIds), name: DEFAULT_ENTRY_NAME, enabled: true, holdTime: null, fadeTime: null, frames: [] };
}

/**
 * A choreographed frame with the "Add new frame" geometry, centered at (cx, cy).
 * `allFrameIds`: every frame id in the show; `entryColors`: colors used in its entry.
 */
export function newChoreoFrame(
  cx: number,
  cy: number,
  canvasAspect: number,
  allFrameIds: readonly string[],
  entryColors: readonly string[],
): ChoreoFrameConfig {
  return {
    id: generateFrameId(allFrameIds),
    title: DEFAULT_FRAME_TITLE,
    corners: frameCorners(cx, cy, DEFAULT_PHYSICAL_ASPECT, canvasAspect),
    physicalAspect: DEFAULT_PHYSICAL_ASPECT,
    debugColor: nextFrameColor(entryColors),
    asset: null,
    blend: 'normal',
    delay: 0,
    duration: null,
    loop: false,
    fadeIn: 0.5,
    fadeInStyle: 'noise',
    fadeOut: 0.5,
    opacity: 1,
  };
}

/** Default project: two frames side by side, centered vertically. */
export function defaultConfig(canvasAspect: number): Config {
  const frames: FrameConfig[] = [];
  frames.push(newFrame(1 / 3, 0.5, canvasAspect, frames));
  frames.push(newFrame(2 / 3, 0.5, canvasAspect, frames));
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    assetPools: [],
    showType: 'randomized',
    ui: { panelSide: 'left' },
    global: {
      backgroundColor: '#000000',
      debug: { strokeWidth: 2, pointRadius: 14, crosshairSize: 22 },
    },
    wallQuad: {
      corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
      debugColor: '#0A84FF',
      playlist: [],
    },
    frames,
    choreography: { crossfade: DEFAULT_CROSSFADE, entries: [] },
    animation: {
      transitionInStyle: 'noise',
      cycleDuration: 12,
      transitionInDuration: 1.5,
      transitionOutDuration: 1.0,
      transitionDelay: 0.5,
      dissolveSoftness: 0.5,
      dissolveNoiseScale: 1,
      frameStagger: 3,
      zoomStart: 1.15,
      panSpeed: 0.03,
      panAspectThreshold: 1.15,
      maxHoldDuration: 30,
    },
    captions: {
      titleSize: 0.045,
      lineTwoSize: 0.032,
      lineGap: 0.012,
      color: '#F0EBE3',
      fadeDuration: 1.2,
      riseDistance: 0.02,
      lineTwoDelay: 0.5,
    },
  };
}
