import type { AssetEntry } from '../state/schema';

export type MediaKind = 'image' | 'video';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'webm']);

/** Media type from the file extension, or null if unsupported. */
export function mediaKind(filepath: string): MediaKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(filepath.trim());
  const ext = m?.[1]?.toLowerCase();
  if (!ext) return null;
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

export interface PoolItem {
  uid: string;
  manifestPath: string;
  entry: AssetEntry;
}

/**
 * The pool: all assets from all manifests in order, minus those flagged with errors.
 */
export function buildPool(
  manifests: readonly { path: string; assets: readonly { uid: string; entry: AssetEntry }[] }[],
  errors: Readonly<Record<string, string>>,
): PoolItem[] {
  const pool: PoolItem[] = [];
  for (const m of manifests) {
    for (const a of m.assets) {
      if (errors[a.uid] === undefined) pool.push({ uid: a.uid, manifestPath: m.path, entry: a.entry });
    }
  }
  return pool;
}

export type PoolMode = 'empty' | 'static' | 'cycling';

export function poolMode(poolSize: number, frameCount: number): PoolMode {
  if (poolSize === 0 || frameCount === 0) return 'empty';
  return poolSize > frameCount ? 'cycling' : 'static';
}

/** Static mode: asset i % pool size goes to frame i (A, B with three frames → A, B, A). */
export function staticAssignments(pool: readonly string[], frameIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (pool.length === 0) return out;
  frameIds.forEach((id, i) => out.set(id, pool[i % pool.length]!));
  return out;
}
