/**
 * Choreography entry validation, shown inline in each entry's section. Pure: the caller
 * supplies each frame's asset status and whether its quad is valid.
 */
import type { ChoreoFrameConfig, EntryConfig } from '../state/schema';
import type { DeepReadonly } from '../state/store';
import { IMAGE_FALLBACK_DURATION } from './choreographyEngine';
import { mediaKind } from './selection';

/** 'empty': no asset chosen. The others match a playlist entry's status. */
export type FrameAssetStatus = 'ok' | 'empty' | 'missing' | 'error' | 'wallOnly';

const STATUS_TEXT: Record<Exclude<FrameAssetStatus, 'ok' | 'empty'>, string> = {
  missing: 'asset missing',
  error: 'asset failed to load',
  wallOnly: 'asset is marked wall only',
};

export interface EntryValidation {
  /** The sequence will skip the entry. */
  skipped: boolean;
  warnings: string[];
}

export function validateEntry(
  entry: DeepReadonly<EntryConfig>,
  status: (f: DeepReadonly<ChoreoFrameConfig>) => FrameAssetStatus,
  frameName: (index: number) => string,
  quadValid: (f: DeepReadonly<ChoreoFrameConfig>) => boolean,
): EntryValidation {
  const warnings: string[] = [];
  let playable = 0;
  entry.frames.forEach((f, i) => {
    const s = status(f);
    const name = frameName(i);
    if (s === 'ok') playable++;
    else if (s === 'empty') warnings.push(`${name}: no asset; skipped.`);
    else warnings.push(`${name}: ${STATUS_TEXT[s]}; skipped.`);
    if (entry.holdTime === null && f.loop) warnings.push(`${name}: loops, but the entry has no hold time, so it plays once.`);
    if (entry.holdTime === null && f.duration === null && f.asset && mediaKind(f.asset.filepath) === 'image') {
      warnings.push(`${name}: an image with no duration in an entry with no hold time; it lasts ${IMAGE_FALLBACK_DURATION} s.`);
    }
    if (!quadValid(f)) warnings.push(`${name}: quad is not convex; the last valid mapping is used.`);
  });
  if (playable === 0) warnings.unshift('No playable frame: this entry is skipped.');

  const overlap = maxConcurrentVideos(entry.frames, entry.holdTime);
  if (overlap > 2) warnings.push(`${overlap} video frames play at once; more than two may stutter.`);

  return { skipped: !entry.enabled || playable === 0, warnings };
}

/**
 * Most video frames whose time spans overlap. A video with no set duration is assumed to run
 * until the entry ends (its own length isn't known here).
 */
export function maxConcurrentVideos(frames: readonly DeepReadonly<ChoreoFrameConfig>[], holdTime: number | null): number {
  const spans = frames
    .filter((f) => f.asset && mediaKind(f.asset.filepath) === 'video')
    .map((f) => [f.delay, f.duration !== null ? f.delay + f.duration : (holdTime ?? Infinity)] as const);
  let best = 0;
  for (const [start] of spans) {
    const n = spans.filter(([s, e]) => s <= start && start < e).length;
    best = Math.max(best, n);
  }
  return best;
}
