import { defaultConfig, generateEntryId, generateFrameId, newChoreoFrame, newEntry, newFrame } from '../state/defaults';
import { migrateConfigJson } from '../state/migrate';
import {
  CONFIG_SCHEMA_VERSION,
  type ChoreoFrameConfig,
  type Config,
  type Corners,
  type EntryConfig,
  type FrameConfig,
  type NormPoint,
  type PlaylistItem,
  SHOW_TYPES,
  TRANSITION_IN_STYLES,
  type TransitionInStyle,
  BLEND_MODES,
  FRAME_BLEND_MODES,
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
  const migrated = migrateConfigJson(raw);
  const data = migrated.data;
  const d = defaultConfig(canvasAspect);
  const warnings: string[] = [...migrated.warnings];

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
  /** One of `allowed`, or `def` with a warning. */
  const oneOf = <T extends string>(o: Obj, key: string, allowed: readonly T[], def: T, path: string): T => {
    const v = o[key];
    if (v === undefined) return def;
    if (allowed.includes(v as T)) return v as T;
    warnings.push(`${path}.${key} must be ${allowed.map((t) => `"${t}"`).join(' or ')}; using "${def}".`);
    return def;
  };
  const str = (o: Obj, key: string, def: string, path: string): string => {
    const v = o[key];
    if (typeof v === 'string') return v;
    if (v !== undefined) warnings.push(`${path}.${key} must be a string; using "${def}".`);
    return def;
  };
  const bool = (o: Obj, key: string, def: boolean, path: string): boolean => {
    const v = o[key];
    if (typeof v === 'boolean') return v;
    if (v !== undefined) warnings.push(`${path}.${key} must be true or false; using ${def}.`);
    return def;
  };
  /** Seconds, or null (unset). Missing: `def`. */
  const nullableNum = (o: Obj, key: string, def: number | null, path: string, opts: { positive?: boolean } = {}): number | null => {
    const v = o[key];
    if (v === undefined) return def;
    if (v === null) return null;
    if (!isNum(v) || v < 0 || (opts.positive && v <= 0)) {
      warnings.push(`${path}.${key} is invalid; using ${def ?? 'unset'}.`);
      return def;
    }
    return v;
  };
  /** Every frame id so far, mapped and choreographed: ids are unique across the show. */
  const frameIds = new Set<string>();
  const frameId = (v: unknown, path: string): string => {
    if (typeof v === 'string' && v !== '' && !frameIds.has(v)) {
      frameIds.add(v);
      return v;
    }
    const id = generateFrameId([...frameIds]);
    frameIds.add(id);
    warnings.push(`${path}.id missing or duplicate; assigned ${id}.`);
    return id;
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

  /** The wall's playlist: an array of { pool, filepath }; bad entries are skipped. */
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
        frames.push({
          id: frameId(rawFrame.id, path),
          title: str(rawFrame, 'title', fallback.title, path),
          corners: corners(rawFrame.corners, fallback.corners, `${path}.corners`),
          physicalAspect: num(rawFrame, 'physicalAspect', fallback.physicalAspect, path, { positive: true }),
          debugColor: color(rawFrame, 'debugColor', fallback.debugColor, path),
          captionSpacing: num(rawFrame, 'captionSpacing', fallback.captionSpacing, path),
          captionOffsetX: num(rawFrame, 'captionOffsetX', fallback.captionOffsetX, path),
          // Alpha is for choreographed frames only.
          blend: oneOf<BlendMode>(rawFrame, 'blend', FRAME_BLEND_MODES, fallback.blend, path),
        });
      });
    }
  }

  // The default frames (no frames key) count too, so choreographed ids never collide with them.
  if (data.frames === undefined) for (const fr of frames) frameIds.add(fr.id);

  // choreography
  const choreoFrame = (raw: Obj, path: string, entryColors: string[]): ChoreoFrameConfig => {
    const fallback = newChoreoFrame(0.5, 0.5, canvasAspect, [...frameIds], entryColors);
    let asset: PlaylistItem | null = null;
    if (isObj(raw.asset) && typeof raw.asset.pool === 'string' && typeof raw.asset.filepath === 'string') {
      asset = { pool: raw.asset.pool, filepath: raw.asset.filepath };
    } else if (raw.asset !== undefined && raw.asset !== null) {
      warnings.push(`${path}.asset must be { "pool": string, "filepath": string } or null; using none.`);
    }
    let opacity = num(raw, 'opacity', fallback.opacity, path, { min: 0 });
    if (opacity > 1) {
      warnings.push(`${path}.opacity must be 0 to 1; using 1.`);
      opacity = 1;
    }
    return {
      id: frameId(raw.id, path),
      title: str(raw, 'title', fallback.title, path),
      corners: corners(raw.corners, fallback.corners, `${path}.corners`),
      physicalAspect: num(raw, 'physicalAspect', fallback.physicalAspect, path, { positive: true }),
      debugColor: color(raw, 'debugColor', fallback.debugColor, path),
      asset,
      blend: oneOf<BlendMode>(raw, 'blend', BLEND_MODES, fallback.blend, path),
      delay: num(raw, 'delay', fallback.delay, path, { min: 0 }),
      duration: nullableNum(raw, 'duration', fallback.duration, path, { positive: true }),
      loop: bool(raw, 'loop', fallback.loop, path),
      fadeIn: num(raw, 'fadeIn', fallback.fadeIn, path, { min: 0 }),
      fadeInStyle: oneOf<TransitionInStyle>(raw, 'fadeInStyle', TRANSITION_IN_STYLES, fallback.fadeInStyle, path),
      fadeOut: num(raw, 'fadeOut', fallback.fadeOut, path, { min: 0 }),
      opacity,
    };
  };
  const ch = obj(data, 'choreography', 'config');
  const entries: EntryConfig[] = [];
  if (ch.entries !== undefined && !Array.isArray(ch.entries)) warnings.push('choreography.entries must be an array; using no entries.');
  (Array.isArray(ch.entries) ? ch.entries : []).forEach((rawEntry: unknown, i) => {
    const path = `choreography.entries[${i}]`;
    if (!isObj(rawEntry)) {
      warnings.push(`${path} is not an object; skipped.`);
      return;
    }
    const fallback = newEntry(entries.map((e) => e.id));
    let id = rawEntry.id;
    if (typeof id !== 'string' || id === '' || entries.some((e) => e.id === id)) {
      id = generateEntryId(entries.map((e) => e.id));
      warnings.push(`${path}.id missing or duplicate; assigned ${id}.`);
    }
    const entryFrames: ChoreoFrameConfig[] = [];
    if (rawEntry.frames !== undefined && !Array.isArray(rawEntry.frames)) warnings.push(`${path}.frames must be an array; using no frames.`);
    (Array.isArray(rawEntry.frames) ? rawEntry.frames : []).forEach((rawFrame: unknown, j) => {
      const fpath = `${path}.frames[${j}]`;
      if (isObj(rawFrame)) entryFrames.push(choreoFrame(rawFrame, fpath, entryFrames.map((fr) => fr.debugColor)));
      else warnings.push(`${fpath} is not an object; skipped.`);
    });
    entries.push({
      id: id as string,
      name: str(rawEntry, 'name', fallback.name, path),
      enabled: bool(rawEntry, 'enabled', fallback.enabled, path),
      holdTime: nullableNum(rawEntry, 'holdTime', fallback.holdTime, path, { positive: true }),
      fadeTime: nullableNum(rawEntry, 'fadeTime', fallback.fadeTime, path),
      frames: entryFrames,
    });
  });
  const choreography: Config['choreography'] = {
    crossfade: num(ch, 'crossfade', d.choreography.crossfade, 'choreography', { min: 0 }),
    entries,
  };

  // animation
  const a = obj(data, 'animation', 'config');
  const da = d.animation;
  const animation: Config['animation'] = {
    transitionInStyle: oneOf<TransitionInStyle>(a, 'transitionInStyle', TRANSITION_IN_STYLES, da.transitionInStyle, 'animation'),
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
      choreography,
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
