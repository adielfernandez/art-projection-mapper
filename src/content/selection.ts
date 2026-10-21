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

export interface PlayableAsset {
  uid: string;
  poolPath: string;
  entry: AssetEntry;
}

/**
 * Randomized show: every asset from every asset pool, in order, minus those flagged with
 * errors and those marked wall only (the frames never show those).
 */
export function playableAssets(
  pools: readonly { path: string; assets: readonly { uid: string; entry: AssetEntry }[] }[],
  errors: Readonly<Record<string, string>>,
): PlayableAsset[] {
  const out: PlayableAsset[] = [];
  for (const m of pools) {
    for (const a of m.assets) {
      if (errors[a.uid] === undefined && !a.entry.wallOnly) out.push({ uid: a.uid, poolPath: m.path, entry: a.entry });
    }
  }
  return out;
}

/** How a frame plays: black, one asset held, or cycling through several. */
export type FrameMode = 'empty' | 'static' | 'cycling';

/** Randomized show: the mode every frame shares, from the playable asset count vs frame count. */
export function randomizedMode(assetCount: number, frameCount: number): FrameMode {
  if (assetCount === 0 || frameCount === 0) return 'empty';
  return assetCount > frameCount ? 'cycling' : 'static';
}

/** Static mode: asset i % asset count goes to frame i (A, B with three frames → A, B, A). */
export function staticAssignments(assets: readonly string[], frameIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (assets.length === 0) return out;
  frameIds.forEach((id, i) => out.set(id, assets[i % assets.length]!));
  return out;
}
