import { generateEntryId, generateFrameId } from './defaults';
import { CONFIG_SCHEMA_VERSION } from './schema';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rename a key, keeping key order, unless the new key is already set. */
function renameKey(o: Obj, from: string, to: string): Obj {
  if (!(from in o) || to in o) return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
}

/** Name and hold time of the entry a Manual show is converted into. */
export const CONVERTED_ENTRY_NAME = 'Converted from Manual';
export const CONVERTED_HOLD_TIME = 60;

const fileOf = (item: unknown) => (isObj(item) && typeof item.filepath === 'string' ? item.filepath : '(invalid item)');

/**
 * v3: Manual becomes Choreographed. A manual show's frames and playlists become one entry
 * (each frame playing its playlist's first item, looping); every mapped frame loses its playlist.
 */
function toChoreographed(raw: Obj, warnings: string[]): Obj {
  const frames = Array.isArray(raw.frames) ? raw.frames : [];
  const manual = raw.showType === 'manual';
  const withoutPlaylist = (f: unknown) => (isObj(f) ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'playlist')) : f);
  const data: Obj = Array.isArray(raw.frames) ? { ...raw, frames: frames.map(withoutPlaylist) } : raw;

  if (!manual) {
    if (frames.some((f) => isObj(f) && Array.isArray(f.playlist) && f.playlist.length > 0)) {
      warnings.push('Removed the frame playlists (a Randomized show never used them).');
    }
    return data;
  }

  const ids = frames.flatMap((f) => (isObj(f) && typeof f.id === 'string' ? [f.id] : []));
  const converted = frames.flatMap((f, i) => {
    if (!isObj(f)) return [];
    const playlist = Array.isArray(f.playlist) ? f.playlist : [];
    const id = generateFrameId(ids);
    ids.push(id);
    const name = typeof f.title === 'string' && f.title.trim() ? `Frame ${i + 1} (${f.title.trim()})` : `Frame ${i + 1}`;
    if (playlist.length > 1) warnings.push(`${name}: kept ${fileOf(playlist[0])}; dropped ${playlist.slice(1).map(fileOf).join(', ')}.`);
    const first = playlist[0];
    const frame: Obj = { id, asset: isObj(first) ? { pool: first.pool, filepath: first.filepath } : null, loop: true };
    for (const key of ['title', 'corners', 'physicalAspect', 'debugColor', 'blend']) if (key in f) frame[key] = f[key];
    return [frame];
  });
  warnings.push(`Manual mode is now Choreographed: the frames became one entry, "${CONVERTED_ENTRY_NAME}", lasting ${CONVERTED_HOLD_TIME} s.`);
  const entry = { id: generateEntryId([]), name: CONVERTED_ENTRY_NAME, enabled: true, holdTime: CONVERTED_HOLD_TIME, fadeTime: null, frames: converted };
  const prev = isObj(raw.choreography) ? raw.choreography : {};
  return { ...data, showType: 'choreographed', choreography: { ...prev, entries: [entry] } };
}

/**
 * Config migrations, keyed by the version they upgrade *from*.
 * Each takes the raw parsed JSON of version N and returns version N+1, noting anything lost.
 */
const configMigrations: Record<number, (raw: Obj, warnings: string[]) => Obj> = {
  // v2: asset "manifests" were renamed to asset "pools".
  1: (raw) => {
    const data = renameKey(raw, 'assetManifests', 'assetPools');
    if (!Array.isArray(data.frames)) return data;
    return {
      ...data,
      frames: data.frames.map((f: unknown) =>
        isObj(f) && Array.isArray(f.playlist)
          ? { ...f, playlist: f.playlist.map((item: unknown) => (isObj(item) ? renameKey(item, 'manifest', 'pool') : item)) }
          : f,
      ),
    };
  },
  2: toChoreographed,
};

/** Upgrade raw parsed config JSON to the current schema version (validation happens in configIO). */
export function migrateConfigJson(raw: Record<string, unknown>): { data: Record<string, unknown>; warnings: string[] } {
  let data = raw;
  const warnings: string[] = [];
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(`config.json schemaVersion ${version} is newer than this app supports (${CONFIG_SCHEMA_VERSION}).`);
  }
  while (version < CONFIG_SCHEMA_VERSION) {
    const step = configMigrations[version];
    if (!step) throw new Error(`No migration from config schemaVersion ${version}.`);
    data = step(data, warnings);
    version += 1;
    data.schemaVersion = version;
  }
  return { data, warnings };
}
