import { POOL_SCHEMA_VERSION, type AssetEntry, type AssetRecord, type PoolRecord } from '../state/schema';
import { getFileHandle, readJsonIfExists, splitPath, writeText } from './projectFolder';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const KNOWN_ASSET_KEYS = ['title', 'artist', 'year', 'filepath', 'zoom', 'pan', 'wallOnly'] as const;
const FLAG_KEYS = ['zoom', 'pan', 'wallOnly'] as const;

let uidCounter = 0;
/** Runtime-only identity for an asset entry (never saved). */
export function newAssetUid(): string {
  return `a${++uidCounter}`;
}

/**
 * Validate parsed pool JSON. Entries without a usable `filepath` are skipped with a
 * warning; unknown fields are kept so saving does not lose them.
 */
export function parsePool(raw: unknown, path: string): PoolRecord {
  if (!isObj(raw)) throw new Error('An asset pool must contain a JSON object.');
  const version = raw.schemaVersion ?? 1;
  if (typeof version !== 'number' || version > POOL_SCHEMA_VERSION) {
    throw new Error(`Unsupported asset pool schemaVersion ${String(version)}.`);
  }
  if (!Array.isArray(raw.assets)) throw new Error('Asset pool is missing an "assets" array.');

  const warnings: string[] = [];
  const assets: AssetRecord[] = [];
  raw.assets.forEach((a, i) => {
    if (!isObj(a)) {
      warnings.push(`assets[${i}] is not an object; skipped.`);
      return;
    }
    if (typeof a.filepath !== 'string' || a.filepath.trim() === '') {
      warnings.push(`assets[${i}] has no filepath; skipped.`);
      return;
    }
    const entry: AssetEntry = { filepath: a.filepath };
    for (const k of ['title', 'artist', 'year'] as const) {
      const v = a[k];
      if (typeof v === 'string') entry[k] = v;
      else if (typeof v === 'number') entry[k] = String(v);
      else if (v !== undefined && v !== null) warnings.push(`assets[${i}].${k} must be text; ignored.`);
    }
    for (const k of FLAG_KEYS) {
      const v = a[k];
      if (typeof v === 'boolean') entry[k] = v;
      else if (v !== undefined) warnings.push(`assets[${i}].${k} must be true or false; ignored.`);
    }
    const extra: Obj = {};
    for (const [k, v] of Object.entries(a)) if (!(KNOWN_ASSET_KEYS as readonly string[]).includes(k)) extra[k] = v;
    assets.push({ uid: newAssetUid(), entry, present: Object.keys(a).filter((k) => (KNOWN_ASSET_KEYS as readonly string[]).includes(k)), extra });
  });

  const extra: Obj = {};
  for (const [k, v] of Object.entries(raw)) if (k !== 'schemaVersion' && k !== 'assets') extra[k] = v;
  return { path, assets, error: null, warnings, dirty: false, extra };
}

/** Serialize, keeping unknown fields and the original presence of optional keys. */
export function serializePool(m: PoolRecord): string {
  const assets = m.assets.map((a) => {
    const out: Obj = {};
    const keep = (k: string, has: boolean) => has || a.present.includes(k);
    for (const k of ['title', 'artist', 'year'] as const) {
      const v = a.entry[k] ?? '';
      if (keep(k, v !== '')) out[k] = v;
    }
    out.filepath = a.entry.filepath;
    for (const k of FLAG_KEYS) {
      const v = a.entry[k] ?? false;
      if (keep(k, v)) out[k] = v;
    }
    return { ...out, ...a.extra };
  });
  return JSON.stringify({ schemaVersion: POOL_SCHEMA_VERSION, ...m.extra, assets }, null, 2) + '\n';
}

/** A new asset entry for a file. `zoom`, `pan` and `wallOnly` are written even when false; text fields once filled in. */
export function newAssetRecord(filepath: string): AssetRecord {
  return {
    uid: newAssetUid(),
    entry: { filepath, zoom: false, pan: false, wallOnly: false },
    present: ['filepath', 'zoom', 'pan', 'wallOnly'],
    extra: {},
  };
}

/** A new, empty asset pool (not yet on disk, so modified). */
export function newPoolRecord(path: string): PoolRecord {
  return { path, assets: [], error: null, warnings: [], dirty: true, extra: {} };
}

/**
 * Pool file path for a name typed in the panel: "Paintings" → "Paintings.json", at the
 * project root. Throws with a user-facing message if the name can't be a file name.
 */
export function poolPathFromName(name: string): string {
  const base = name.trim().replace(/\.json$/i, '').trim();
  if (base === '') throw new Error('Enter a name for the asset pool.');
  if (/[\\/:*?"<>|]/.test(base) || base.startsWith('.')) {
    throw new Error('Asset pool names can\'t contain / \\ : * ? " < > | or start with a dot.');
  }
  return `${base}.json`;
}

/**
 * Media path for a file inside the project folder, relative to the pool that lists it.
 * `segments` is the file's path from the project root (from FileSystemDirectoryHandle.resolve).
 */
export function relativeMediaPath(poolPath: string, segments: readonly string[]): string {
  const { dirs } = splitPath(poolPath);
  let common = 0;
  while (common < dirs.length && common < segments.length - 1 && dirs[common] === segments[common]) common++;
  return [...dirs.slice(common).map(() => '..'), ...segments.slice(common)].join('/');
}

/** File name for copy n of a file: 1 → "flame.mp4", 2 → "flame (2).mp4". */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/** Path of a media file relative to the project root, given its pool's path. */
export function resolveMediaPath(poolPath: string, filepath: string): string {
  const { dirs } = splitPath(poolPath);
  return [...dirs, filepath.trim()].join('/');
}

/** Load every pool listed in config. A missing or invalid pool becomes an error record. */
export async function loadPools(root: FileSystemDirectoryHandle, paths: readonly string[]): Promise<PoolRecord[]> {
  return Promise.all(
    paths.map(async (path): Promise<PoolRecord> => {
      try {
        const raw = await readJsonIfExists(root, path);
        if (raw === null) throw new Error('File not found.');
        return parsePool(raw, path);
      } catch (err) {
        return { path, assets: [], error: (err as Error).message, warnings: [], dirty: false, extra: {} };
      }
    }),
  );
}

export async function savePool(root: FileSystemDirectoryHandle, m: PoolRecord): Promise<void> {
  await writeText(root, m.path, serializePool(m));
}

export async function getMediaFile(root: FileSystemDirectoryHandle, poolPath: string, filepath: string): Promise<File> {
  const handle = await getFileHandle(root, resolveMediaPath(poolPath, filepath));
  return handle.getFile();
}
