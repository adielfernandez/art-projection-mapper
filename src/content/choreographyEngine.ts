/**
 * The choreography engine (Choreographed mode). Pure logic, no DOM: it sequences entries,
 * runs each entry's clock and frame timelines, and crossfades between entries. Media and
 * rendering read its state each tick. Ported from Ossuary Wall's playlist engine.
 *
 * The entry clock drives holdTime and frame delays. It runs in real time and freezes only
 * while the show is paused (the scheduler then stops calling update()).
 */
import type { ChoreoFrameConfig, EntryConfig } from '../state/schema';

/** A frame's media status, from the media layer. */
export type MediaStatus = 'ready' | 'loading' | 'failed';

export interface EngineEnv {
  /** The live entry list. Position is tracked by entry id. */
  entries(): readonly EntryConfig[];
  /** Default crossfade (seconds) for entries without their own fadeTime. */
  crossfade(): number;
  /** Whether a frame can play at all (a resolvable, loadable asset). */
  framePlayable(frame: ChoreoFrameConfig): boolean;
  mediaStatus(frameId: string): MediaStatus;
  /** Seconds of the frame's video, or null for an image / unknown. */
  mediaDuration(frameId: string): number | null;
}

/** Give up on a frame whose media is still loading this long after it was due. */
export const REGION_LOAD_TIMEOUT = 15;
/** An image frame with no duration in an entry with no holdTime lasts this long (with a warning). */
export const IMAGE_FALLBACK_DURATION = 10;

export type FrameState = 'pending' | 'playing' | 'done';

export interface FrameRun {
  id: string;
  state: FrameState;
  /** Seconds since the frame started playing. */
  t: number;
  /** Seconds the frame lasts once started; null = until the entry ends, or not known yet. */
  end: number | null;
  /** Seconds it has been due but not ready. */
  waited: number;
}

export interface EntryRun {
  /** Increments for every start, so two runs of one entry are told apart. */
  serial: number;
  id: string;
  /** Config as it was when the entry started: its timing applies until the next start. */
  snapshot: EntryConfig;
  /** Entry clock: seconds since the entry started. */
  clock: number;
  /** Seconds of crossfade (in for the current entry, out for an outgoing one). */
  fadeDur: number;
  fadeT: number;
  fading: 'in' | 'out' | 'none';
  /** The playable frames when it started, in draw order. */
  frames: FrameRun[];
  ended: boolean;
}

export interface EngineLayer {
  run: EntryRun;
  /** Entry crossfade alpha, 0..1. */
  alpha: number;
}

/** An entry can play: enabled, with at least one playable frame. */
export function entryPlayable(entry: EntryConfig, framePlayable: (f: ChoreoFrameConfig) => boolean): boolean {
  return entry.enabled && entry.frames.some(framePlayable);
}

export class ChoreographyEngine {
  current: EntryRun | null = null;
  outgoing: EntryRun[] = [];
  /** Preview: entry id held on screen, restarting each time it ends. */
  previewId: string | null = null;
  /** Index of the current entry when it started, for relocating after edits. */
  private index = -1;
  private serial = 0;
  private pendingJump: string | null = null;

  constructor(private env: EngineEnv) {}

  // ---------- control ----------

  /** Crossfade to an entry now (it plays even if disabled). */
  jumpTo(id: string): void {
    this.pendingJump = id;
  }

  next(): void {
    const target = this.followingId(1);
    if (target) this.jumpTo(target);
  }

  previous(): void {
    const target = this.followingId(-1);
    if (target) this.jumpTo(target);
  }

  /** Jump to an entry and keep it on screen until resume(). */
  preview(id: string): void {
    this.previewId = id;
    this.jumpTo(id);
  }

  /** End a preview; the sequence continues after the previewed entry. */
  resume(): void {
    this.previewId = null;
  }

  /** Start over from the first playable entry (project load, show type switch). */
  restart(): void {
    this.current = null;
    this.outgoing = [];
    this.index = -1;
    this.pendingJump = null;
    this.previewId = null;
  }

  // ---------- queries ----------

  /** The entry that would play after the current one, for preloading. */
  upcomingId(): string | null {
    if (this.previewId) return this.previewId;
    return this.followingId(1);
  }

  /** Seconds the entry lasts on its entry clock, if known. */
  duration(run: EntryRun): number | null {
    const e = run.snapshot;
    if (e.holdTime !== null) return e.holdTime;
    let end = 0;
    for (const f of e.frames) {
      const fr = run.frames.find((x) => x.id === f.id);
      if (!fr || (fr.state === 'done' && fr.end === null)) continue; // never played
      const len = fr.end ?? this.frameLength(f, false);
      if (len === null) return null;
      end = Math.max(end, f.delay + len);
    }
    return end;
  }

  /** Entries to draw, outgoing first, each with its crossfade alpha. */
  layers(): EngineLayer[] {
    const out = this.outgoing.map((run) => ({ run, alpha: fadeAlpha(run) }));
    if (this.current) out.push({ run: this.current, alpha: fadeAlpha(this.current) });
    return out;
  }

  /** The frame's run in an entry run, if it is part of it. */
  frameRun(run: EntryRun, frameId: string): FrameRun | null {
    return run.frames.find((r) => r.id === frameId) ?? null;
  }

  /** Frame envelope (its own fade in and out), 0..1. Pending and done frames are 0. */
  frameAlpha(run: EntryRun, frameId: string): number {
    const p = this.fadeParts(run, frameId);
    return p ? Math.min(p.in, p.out) : 0;
  }

  /** The two halves of a playing frame's envelope: fade-in progress and fade-out level, each 0..1. */
  fadeParts(run: EntryRun, frameId: string): { in: number; out: number } | null {
    const fr = this.frameRun(run, frameId);
    const cfg = run.snapshot.frames.find((f) => f.id === frameId);
    if (!fr || !cfg || fr.state !== 'playing') return null;
    const fin = cfg.fadeIn > 0 ? Math.min(1, fr.t / cfg.fadeIn) : 1;
    let fout = 1;
    if (fr.end !== null) fout = cfg.fadeOut > 0 ? Math.max(0, Math.min(1, (fr.end - fr.t) / cfg.fadeOut)) : 1;
    return { in: Math.max(0, fin), out: fout };
  }

  // ---------- tick ----------

  update(dt: number): void {
    if (this.pendingJump) {
      const id = this.pendingJump;
      this.pendingJump = null;
      const entries = this.env.entries();
      const i = entries.findIndex((e) => e.id === id);
      if (i >= 0) this.startEntry(entries[i]!, i);
    }
    if (!this.current) {
      const first = this.findFrom(-1, 1);
      if (first) this.startEntry(first.entry, first.index);
    }

    for (const run of this.outgoing) this.advance(run, dt);
    this.outgoing = this.outgoing.filter((run) => run.fadeT < run.fadeDur);

    const run = this.current;
    if (run) {
      this.advance(run, dt);
      if (run.ended) this.transition();
    }
  }

  // ---------- internals ----------

  private advance(run: EntryRun, dt: number): void {
    if (run.fading !== 'none') {
      run.fadeT += dt;
      if (run.fading === 'in' && run.fadeT >= run.fadeDur) run.fading = 'none';
    }
    // An outgoing entry keeps playing what has started, but nothing new starts in it.
    const live = run.fading !== 'out';
    if (live) run.clock += dt;
    const e = run.snapshot;

    for (const fr of run.frames) {
      const cfg = e.frames.find((f) => f.id === fr.id)!;
      if (fr.state === 'pending') {
        if (!live || run.clock < cfg.delay) continue;
        const status = this.env.mediaStatus(fr.id);
        if (status === 'failed') {
          fr.state = 'done';
          continue;
        }
        if (status === 'loading') {
          fr.waited += dt;
          if (fr.waited > REGION_LOAD_TIMEOUT) fr.state = 'done';
          continue;
        }
        fr.state = 'playing';
        fr.t = 0;
        fr.end = this.frameLength(cfg, e.holdTime !== null);
        continue;
      }
      if (fr.state === 'playing') {
        fr.t += dt;
        // A video's own length becomes known once it has loaded.
        if (fr.end === null) fr.end = this.frameLength(cfg, e.holdTime !== null);
        if (fr.end !== null && fr.t >= fr.end) fr.state = 'done';
      }
    }

    if (!live || run.ended) return;
    run.ended = e.holdTime !== null ? run.clock >= e.holdTime : run.frames.every((r) => r.state === 'done');
  }

  /**
   * Seconds a frame lasts once started. Null: until the entry ends (a loop, or an image,
   * when the entry has a holdTime), or a video whose length isn't known yet.
   */
  private frameLength(cfg: ChoreoFrameConfig, entryHasHold: boolean): number | null {
    if (cfg.duration !== null) return cfg.duration;
    const dur = this.env.mediaDuration(cfg.id);
    const isVideo = dur !== null;
    if (entryHasHold) return cfg.loop || !isVideo ? null : dur;
    // No holdTime: loop is treated as false; an image falls back to a fixed length.
    if (isVideo) return dur;
    return this.env.mediaStatus(cfg.id) === 'ready' ? IMAGE_FALLBACK_DURATION : null;
  }

  private transition(): void {
    const cur = this.current;
    if (!cur) return;
    if (this.previewId) {
      const entries = this.env.entries();
      const i = entries.findIndex((e) => e.id === this.previewId);
      if (i >= 0) {
        this.startEntry(entries[i]!, i);
        return;
      }
      this.previewId = null;
    }
    const next = this.following(1);
    if (next) this.startEntry(next.entry, next.index);
    else {
      // Nothing playable: let the current one go dark.
      cur.fading = 'out';
      cur.fadeT = 0;
      cur.fadeDur = this.env.crossfade();
      this.outgoing.push(cur);
      this.current = null;
    }
  }

  private startEntry(entry: EntryConfig, index: number): void {
    const fadeDur = entry.fadeTime ?? this.env.crossfade();
    const prev = this.current;
    if (prev) {
      prev.fading = 'out';
      prev.fadeT = 0;
      prev.fadeDur = fadeDur;
      this.outgoing.push(prev);
    }
    const snapshot = structuredClone(entry) as EntryConfig;
    this.current = {
      serial: ++this.serial,
      id: entry.id,
      snapshot,
      clock: 0,
      fadeDur,
      fadeT: 0,
      fading: fadeDur > 0 ? 'in' : 'none',
      frames: snapshot.frames
        .filter((f) => this.env.framePlayable(f))
        .map((f) => ({ id: f.id, state: 'pending' as FrameState, t: 0, end: null, waited: 0 })),
      ended: false,
    };
    this.index = index;
  }

  /** Where the current entry is now: its index if still listed, else the slot it left. */
  private anchorIndex(): number {
    const entries = this.env.entries();
    if (!this.current) return this.index;
    const i = entries.findIndex((e) => e.id === this.current!.id);
    // Removed: step back one so the entry that took its place plays next.
    return i >= 0 ? i : this.index - 1;
  }

  private following(dir: 1 | -1): { entry: EntryConfig; index: number } | null {
    return this.findFrom(this.anchorIndex(), dir);
  }

  private followingId(dir: 1 | -1): string | null {
    return this.following(dir)?.entry.id ?? null;
  }

  /** First playable entry after index `from` in direction `dir`, wrapping (may return the same entry). */
  private findFrom(from: number, dir: 1 | -1): { entry: EntryConfig; index: number } | null {
    const entries = this.env.entries();
    const n = entries.length;
    for (let step = 1; step <= n; step++) {
      const i = (((from + dir * step) % n) + n) % n;
      const e = entries[i]!;
      if (entryPlayable(e, (f) => this.env.framePlayable(f))) return { entry: e, index: i };
    }
    return null;
  }
}

function fadeAlpha(run: EntryRun): number {
  if (run.fading === 'none') return 1;
  const p = run.fadeDur > 0 ? Math.min(1, run.fadeT / run.fadeDur) : 1;
  return run.fading === 'in' ? p : 1 - p;
}
