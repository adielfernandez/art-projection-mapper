/**
 * Manual show: per-frame playlists. Pure functions; the scheduler owns playback state.
 */
import type { AssetEntry, PlaylistItem } from '../state/schema';
import type { PoolMode } from './assetPool';

export type EntryStatus = 'ok' | 'missing' | 'error';

export interface PlaylistEntry {
  /** Runtime key of the playlist entry (stable through reorders). */
  key: number;
  /** Asset uid, or null when the entry can't be played. */
  uid: string | null;
  status: EntryStatus;
}

/**
 * Resolve playlist items to assets: by manifest path, then the first asset with that filepath.
 * Items whose asset is not found are 'missing'; assets that failed to load are 'error'.
 */
export function resolvePlaylist(
  items: readonly Readonly<PlaylistItem>[],
  keys: readonly number[],
  manifests: readonly { path: string; assets: readonly { uid: string; entry: Readonly<AssetEntry> }[] }[],
  errors: Readonly<Record<string, string>>,
): PlaylistEntry[] {
  return items.map((item, i) => {
    const key = keys[i] ?? -1 - i;
    const asset = manifests.find((m) => m.path === item.manifest)?.assets.find((a) => a.entry.filepath === item.filepath);
    if (!asset) return { key, uid: null, status: 'missing' };
    if (errors[asset.uid] !== undefined) return { key, uid: null, status: 'error' };
    return { key, uid: asset.uid, status: 'ok' };
  });
}

/** A frame's mode from its playable entries: none → black, one → static, more → cycle in order. */
export function playlistMode(entries: readonly PlaylistEntry[]): PoolMode {
  const playable = entries.reduce((n, e) => n + (e.uid ? 1 : 0), 0);
  if (playable === 0) return 'empty';
  return playable === 1 ? 'static' : 'cycling';
}

/**
 * Where a frame is in its playlist: the entry it last started (key), and that entry's index.
 * Before anything has played, key is null and index is -1, so playback starts at the top.
 */
export interface Anchor {
  key: number | null;
  index: number;
}

export const START_ANCHOR: Anchor = { key: null, index: -1 };

/**
 * Re-find the anchor after the playlist changed. If its entry moved, follow it. If it was
 * removed, step back one so the entry that took its place plays next; the anchor then stays
 * put (key null) until the next entry starts.
 */
export function relocateAnchor(entries: readonly PlaylistEntry[], anchor: Anchor): Anchor {
  if (anchor.key === null) return anchor;
  const j = entries.findIndex((e) => e.key === anchor.key);
  return j >= 0 ? { key: anchor.key, index: j } : { key: null, index: anchor.index - 1 };
}

/** Index of the first playable entry after the anchor, wrapping around; -1 if none can play. */
export function nextEntry(entries: readonly PlaylistEntry[], anchor: Anchor): number {
  const n = entries.length;
  for (let step = 1; step <= n; step++) {
    const i = (((anchor.index + step) % n) + n) % n;
    if (entries[i]!.uid) return i;
  }
  return -1;
}
