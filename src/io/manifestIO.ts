import { MANIFEST_SCHEMA_VERSION, type AssetEntry, type AssetRecord, type ManifestRecord } from '../state/schema';
import { getFileHandle, readJsonIfExists, splitPath, writeText } from './projectFolder';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const KNOWN_ASSET_KEYS = ['title', 'artist', 'year', 'filepath', 'zoom', 'pan'] as const;

let uidCounter = 0;
/** Runtime-only identity for an asset entry (never saved). */
export function newAssetUid(): string {
  return `a${++uidCounter}`;
}

/**
 * Validate parsed manifest JSON. Entries without a usable `filepath` are skipped with a
 * warning; unknown fields are kept so saving does not lose them.
 */
export function parseManifest(raw: unknown, path: string): ManifestRecord {
  if (!isObj(raw)) throw new Error('Manifest must contain a JSON object.');
  const version = raw.schemaVersion ?? 1;
  if (typeof version !== 'number' || version > MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported manifest schemaVersion ${String(version)}.`);
  }
  if (!Array.isArray(raw.assets)) throw new Error('Manifest is missing an "assets" array.');

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
    for (const k of ['zoom', 'pan'] as const) {
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
export function serializeManifest(m: ManifestRecord): string {
  const assets = m.assets.map((a) => {
    const out: Obj = {};
    const keep = (k: string, has: boolean) => has || a.present.includes(k);
    for (const k of ['title', 'artist', 'year'] as const) {
      const v = a.entry[k] ?? '';
      if (keep(k, v !== '')) out[k] = v;
    }
    out.filepath = a.entry.filepath;
    for (const k of ['zoom', 'pan'] as const) {
      const v = a.entry[k] ?? false;
      if (keep(k, v)) out[k] = v;
    }
    return { ...out, ...a.extra };
  });
  return JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, ...m.extra, assets }, null, 2) + '\n';
}

/** Path of a media file relative to the project root, given its manifest's path. */
export function resolveMediaPath(manifestPath: string, filepath: string): string {
  const { dirs } = splitPath(manifestPath);
  return [...dirs, filepath.trim()].join('/');
}

/** Load every manifest listed in config. A missing or invalid manifest becomes an error record. */
export async function loadManifests(root: FileSystemDirectoryHandle, paths: readonly string[]): Promise<ManifestRecord[]> {
  return Promise.all(
    paths.map(async (path): Promise<ManifestRecord> => {
      try {
        const raw = await readJsonIfExists(root, path);
        if (raw === null) throw new Error('File not found.');
        return parseManifest(raw, path);
      } catch (err) {
        return { path, assets: [], error: (err as Error).message, warnings: [], dirty: false, extra: {} };
      }
    }),
  );
}

export async function saveManifest(root: FileSystemDirectoryHandle, m: ManifestRecord): Promise<void> {
  await writeText(root, m.path, serializeManifest(m));
}

export async function getMediaFile(root: FileSystemDirectoryHandle, manifestPath: string, filepath: string): Promise<File> {
  const handle = await getFileHandle(root, resolveMediaPath(manifestPath, filepath));
  return handle.getFile();
}
