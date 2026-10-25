import { defaultConfig, generateFrameId, newFrame } from '../state/defaults';
import { migrateConfigJson } from '../state/migrate';
import {
  CONFIG_SCHEMA_VERSION,
  type Config,
  type Corners,
  type FrameConfig,
  type NormPoint,
  type PlaylistItem,
  SHOW_TYPES,
  TRANSITION_IN_STYLES,
  type TransitionInStyle,
  BLEND_MODES,
  type BlendMode,
  type ShowType,
} from '../state/schema';
import { readJsonIfExists, writeText } from './projectFolder';

export const CONFIG_PATH = 'config.json';

export interface ParseResult {
  config: Config;
  /** Fields that were missing or invalid and fell back to defaults. */
  warnings: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Validate parsed config JSON against the schema. Missing or invalid fields fall back
 * to defaults with a warning rather than failing the whole load.
 */
export function parseConfig(raw: unknown, canvasAspect: number): ParseResult {
  if (!isObj(raw)) throw new Error('config.json must contain a JSON object.');
  const data = migrateConfigJson(raw);
  const d = defaultConfig(canvasAspect);
  const warnings: string[] = [];

  const num = (o: Obj, key: string, def: number, path: string, opts: { min?: number; positive?: boolean } = {}): number => {
    const v = o[key];
    if (v === undefined) return def;
    if (!isNum(v) || (opts.positive && v <= 0) || (opts.min !== undefined && v < opts.min)) {
      warnings.push(`${path}.${key} is invalid; using ${def}.`);
      return def;
    }
    return v;
  };
  const color = (o: Obj, key: string, def: string, path: string): string => {
    const v = o[key];
    if (v === undefined) return def;
    if (typeof v !== 'string' || !HEX.test(v)) {
      warnings.push(`${path}.${key} must be a #RRGGBB color; using ${def}.`);
      return def;
    }
    return v;
  };
  const obj = (o: Obj, key: string, path: string): Obj => {
    const v = o[key];
    if (v === undefined) return {};
    if (!isObj(v)) {
      warnings.push(`${path}.${key} must be an object; using defaults.`);
      return {};
    }
    return v;
  };
  const corners = (v: unknown, def: Corners, path: string): Corners => {
    const ok =
      Array.isArray(v) &&
      v.length === 4 &&
      v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
    if (!ok) {
      if (v !== undefined) warnings.push(`${path} must be four [x, y] points; using defaults.`);
      return def.map((p) => [...p]) as Corners;
    }
    return (v as number[][]).map((p) => [p[0]!, p[1]!] as NormPoint) as Corners;
  };

  // assetPools
  let assetPools = d.assetPools;
  if (data.assetPools !== undefined) {
    if (Array.isArray(data.assetPools) && data.assetPools.every((p) => typeof p === 'string')) {
      assetPools = data.assetPools as string[];
    } else {
      warnings.push('assetPools must be an array of paths; ignoring.');
    }
  }

  // showType
  let showType = d.showType;
  if (data.showType !== undefined) {
    if (SHOW_TYPES.includes(data.showType as ShowType)) showType = data.showType as ShowType;
    else warnings.push(`showType must be ${SHOW_TYPES.map((t) => `"${t}"`).join(' or ')}; using "${d.showType}".`);
  }

  // ui
  const ui = obj(data, 'ui', 'config');
  let panelSide = d.ui.panelSide;
  if (ui.panelSide !== undefined) {
    if (ui.panelSide === 'left' || ui.panelSide === 'right') panelSide = ui.panelSide;
    else warnings.push('ui.panelSide must be "left" or "right".');
  }

  // global
  const g = obj(data, 'global', 'config');
  const gd = obj(g, 'debug', 'global');
  const global: Config['global'] = {
    backgroundColor: color(g, 'backgroundColor', d.global.backgroundColor, 'global'),
    debug: {
      strokeWidth: num(gd, 'strokeWidth', d.global.debug.strokeWidth, 'global.debug', { positive: true }),
      pointRadius: num(gd, 'pointRadius', d.global.debug.pointRadius, 'global.debug', { positive: true }),
      crosshairSize: num(gd, 'crosshairSize', d.global.debug.crosshairSize, 'global.debug', { min: 0 }),
    },
  };

  /** A frame's or the wall's playlist: an array of { pool, filepath }; bad entries are skipped. */
  const playlistOf = (raw: unknown, path: string): PlaylistItem[] => {
    const playlist: PlaylistItem[] = [];
    if (raw === undefined) return playlist;
    if (!Array.isArray(raw)) {
      warnings.push(`${path}.playlist must be an array; using an empty playlist.`);
      return playlist;
    }
    raw.forEach((item, j) => {
      if (isObj(item) && typeof item.pool === 'string' && typeof item.filepath === 'string') {
        playlist.push({ pool: item.pool, filepath: item.filepath });
      } else {
        warnings.push(`${path}.playlist[${j}] must be { "pool": string, "filepath": string }; skipped.`);
      }
    });
    return playlist;
  };

  // wallQuad
  const w = obj(data, 'wallQuad', 'config');
  const wallQuad: Config['wallQuad'] = {
    corners: corners(w.corners, d.wallQuad.corners, 'wallQuad.corners'),
    debugColor: color(w, 'debugColor', d.wallQuad.debugColor, 'wallQuad'),
    playlist: playlistOf(w.playlist, 'wallQuad'),
  };

  // frames
  let frames: FrameConfig[] = d.frames;
  if (data.frames !== undefined) {
    if (!Array.isArray(data.frames)) {
      warnings.push('frames must be an array; using the default frames.');
    } else {
      frames = [];
      data.frames.forEach((rawFrame, i) => {
        const path = `frames[${i}]`;
        if (!isObj(rawFrame)) {
          warnings.push(`${path} is not an object; skipped.`);
          return;
        }
        const fallback = newFrame(0.5, 0.5, canvasAspect, frames);
        let id = rawFrame.id;
        if (typeof id !== 'string' || id === '' || frames.some((f) => f.id === id)) {
          id = generateFrameId(frames.map((f) => f.id));
          warnings.push(`${path}.id missing or duplicate; assigned ${id}.`);
        }
        const playlist = playlistOf(rawFrame.playlist, path);
        let blend: BlendMode = fallback.blend;
        if (rawFrame.blend !== undefined) {
          if (BLEND_MODES.includes(rawFrame.blend as BlendMode)) blend = rawFrame.blend as BlendMode;
          else warnings.push(`${path}.blend must be ${BLEND_MODES.map((t) => `"${t}"`).join(' or ')}; using "${fallback.blend}".`);
        }
        let title = fallback.title;
        if (typeof rawFrame.title === 'string') title = rawFrame.title;
        else if (rawFrame.title !== undefined) warnings.push(`${path}.title must be a string; using "${fallback.title}".`);
        frames.push({
          id: id as string,
          title,
          corners: corners(rawFrame.corners, fallback.corners, `${path}.corners`),
          physicalAspect: num(rawFrame, 'physicalAspect', fallback.physicalAspect, path, { positive: true }),
          debugColor: color(rawFrame, 'debugColor', fallback.debugColor, path),
          captionSpacing: num(rawFrame, 'captionSpacing', fallback.captionSpacing, path),
          captionOffsetX: num(rawFrame, 'captionOffsetX', fallback.captionOffsetX, path),
          playlist,
          blend,
        });
      });
    }
  }

  // animation
  const a = obj(data, 'animation', 'config');
  const da = d.animation;
  let transitionInStyle = da.transitionInStyle;
  if (a.transitionInStyle !== undefined) {
    if (TRANSITION_IN_STYLES.includes(a.transitionInStyle as TransitionInStyle)) transitionInStyle = a.transitionInStyle as TransitionInStyle;
    else warnings.push(`animation.transitionInStyle must be ${TRANSITION_IN_STYLES.map((t) => `"${t}"`).join(' or ')}; using "${da.transitionInStyle}".`);
  }
  const animation: Config['animation'] = {
    transitionInStyle,
    cycleDuration: num(a, 'cycleDuration', da.cycleDuration, 'animation', { positive: true }),
    transitionInDuration: num(a, 'transitionInDuration', da.transitionInDuration, 'animation', { min: 0 }),
    transitionOutDuration: num(a, 'transitionOutDuration', da.transitionOutDuration, 'animation', { min: 0 }),
    transitionDelay: num(a, 'transitionDelay', da.transitionDelay, 'animation', { min: 0 }),
    dissolveSoftness: num(a, 'dissolveSoftness', da.dissolveSoftness, 'animation', { positive: true }),
    dissolveNoiseScale: num(a, 'dissolveNoiseScale', da.dissolveNoiseScale, 'animation', { positive: true }),
    frameStagger: num(a, 'frameStagger', da.frameStagger, 'animation', { min: 0 }),
    zoomStart: num(a, 'zoomStart', da.zoomStart, 'animation', { positive: true }),
    panSpeed: num(a, 'panSpeed', da.panSpeed, 'animation', { positive: true }),
    panAspectThreshold: num(a, 'panAspectThreshold', da.panAspectThreshold, 'animation', { positive: true }),
    maxHoldDuration: num(a, 'maxHoldDuration', da.maxHoldDuration, 'animation', { positive: true }),
  };

  // captions
  const c = obj(data, 'captions', 'config');
  const dc = d.captions;
  const captions: Config['captions'] = {
    titleSize: num(c, 'titleSize', dc.titleSize, 'captions', { positive: true }),
    lineTwoSize: num(c, 'lineTwoSize', dc.lineTwoSize, 'captions', { positive: true }),
    lineGap: num(c, 'lineGap', dc.lineGap, 'captions', { min: 0 }),
    color: color(c, 'color', dc.color, 'captions'),
    fadeDuration: num(c, 'fadeDuration', dc.fadeDuration, 'captions', { min: 0 }),
    riseDistance: num(c, 'riseDistance', dc.riseDistance, 'captions'),
    lineTwoDelay: num(c, 'lineTwoDelay', dc.lineTwoDelay, 'captions', { min: 0 }),
  };

  return {
    config: {
      schemaVersion: CONFIG_SCHEMA_VERSION,
      assetPools,
      showType,
      ui: { panelSide },
      global,
      wallQuad,
      frames,
      animation,
      captions,
    },
    warnings,
  };
}

export function serializeConfig(config: Config): string {
  return JSON.stringify(config, null, 2) + '\n';
}

/** Load config.json from the project folder, or null if the folder has none. */
export async function loadConfig(root: FileSystemDirectoryHandle, canvasAspect: number): Promise<ParseResult | null> {
  const raw = await readJsonIfExists(root, CONFIG_PATH);
  if (raw === null) return null;
  return parseConfig(raw, canvasAspect);
}

export async function saveConfig(root: FileSystemDirectoryHandle, config: Config): Promise<void> {
  await writeText(root, CONFIG_PATH, serializeConfig(config));
}
