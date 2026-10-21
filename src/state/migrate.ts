import { CONFIG_SCHEMA_VERSION } from './schema';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Rename a key, keeping key order, unless the new key is already set. */
function renameKey(o: Obj, from: string, to: string): Obj {
  if (!(from in o) || to in o) return o;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
}

/**
 * Config migrations, keyed by the version they upgrade *from*.
 * Each takes the raw parsed JSON of version N and returns version N+1.
 */
const configMigrations: Record<number, (raw: Obj) => Obj> = {
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
};

/** Upgrade raw parsed config JSON to the current schema version (validation happens in configIO). */
export function migrateConfigJson(raw: Record<string, unknown>): Record<string, unknown> {
  let data = raw;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (version > CONFIG_SCHEMA_VERSION) {
    throw new Error(`config.json schemaVersion ${version} is newer than this app supports (${CONFIG_SCHEMA_VERSION}).`);
  }
  while (version < CONFIG_SCHEMA_VERSION) {
    const step = configMigrations[version];
    if (!step) throw new Error(`No migration from config schemaVersion ${version}.`);
    data = step(data);
    version += 1;
    data.schemaVersion = version;
  }
  return data;
}
