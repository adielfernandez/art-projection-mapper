import { describe, expect, it } from 'vitest';
import { newChoreoFrame, newEntry } from '../state/defaults';
import type { ChoreoFrameConfig, EntryConfig } from '../state/schema';
import { ChoreographyEngine, IMAGE_FALLBACK_DURATION, REGION_LOAD_TIMEOUT, type EngineEnv, type MediaStatus } from './choreographyEngine';

interface Media {
  status: MediaStatus;
  /** Video length; null for images. */
  duration: number | null;
}

function setup(entries: EntryConfig[], opts: { crossfade?: number; media?: Record<string, Media> } = {}) {
  const state = { entries, media: opts.media ?? {} };
  const env: EngineEnv = {
    entries: () => state.entries,
    crossfade: () => opts.crossfade ?? 2,
    framePlayable: (f) => f.asset !== null && state.media[f.id]?.status !== 'failed',
    mediaStatus: (id) => state.media[id]?.status ?? 'ready',
    mediaDuration: (id) => state.media[id]?.duration ?? null,
  };
  const engine = new ChoreographyEngine(env);
  /** Advance in small steps, like the rAF loop. */
  const run = (seconds: number, step = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += step) engine.update(Math.min(step, seconds - t));
  };
  return { engine, run, state };
}

function frame(id: string, fields: Partial<ChoreoFrameConfig> = {}): ChoreoFrameConfig {
  return { ...newChoreoFrame(0.5, 0.5, 16 / 9, [], []), id, asset: { pool: 'p.json', filepath: `${id}.mp4` }, ...fields };
}
function entry(id: string, holdTime: number | null, frames: ChoreoFrameConfig[] = [frame(`${id}-f`)], fields: Partial<EntryConfig> = {}): EntryConfig {
  return { ...newEntry([]), id, holdTime, frames, ...fields };
}

describe('sequencing and crossfades', () => {
  it('starts on the first entry, fading in from black over its fade time', () => {
    const { engine, run } = setup([entry('a', 10), entry('b', 5)]);
    run(1);
    const layers = engine.layers();
    expect(layers.map((l) => l.run.id)).toEqual(['a']);
    expect(layers[0]!.alpha).toBeCloseTo(0.5, 2);
  });

  it("lasts holdTime, then crossfades over the incoming entry's fade time", () => {
    const { engine, run } = setup([entry('a', 10), entry('b', 5, undefined, { fadeTime: 4 })]);
    run(10.5);
    let layers = engine.layers();
    expect(layers.map((l) => l.run.id)).toEqual(['a', 'b']);
    expect(layers[0]!.alpha).toBeCloseTo(1 - 0.5 / 4, 1);
    expect(layers[1]!.alpha).toBeCloseTo(0.5 / 4, 1);
    run(4);
    layers = engine.layers();
    expect(layers.map((l) => l.run.id)).toEqual(['b']);
  });

  it('the outgoing entry keeps playing what has started, but nothing new starts in it', () => {
    const late = frame('late', { delay: 10.5 });
    const { engine, run } = setup([entry('a', 10, [frame('early'), late]), entry('b', 5)], { crossfade: 2 });
    run(11);
    const out = engine.outgoing[0]!;
    expect(out.id).toBe('a');
    expect(engine.frameRun(out, 'early')!.state).toBe('playing');
    expect(engine.frameRun(out, 'late')!.state).toBe('pending');
  });

  it('loops, skipping disabled and unplayable entries', () => {
    const missing = entry('v', 10, [frame('r1', { asset: null })]);
    const { engine, run } = setup([entry('a', 3), entry('off', 3, undefined, { enabled: false }), missing, entry('b', 3)], { crossfade: 0.5 });
    const seen: string[] = [];
    for (let i = 0; i < 400; i++) {
      run(0.1);
      const id = engine.current?.id;
      if (id && seen[seen.length - 1] !== id) seen.push(id);
    }
    expect(seen.slice(0, 6)).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  });

  it('a single playable entry crossfades into itself each time it ends', () => {
    const { engine, run } = setup([entry('a', 5)], { crossfade: 1 });
    run(5.5);
    expect(engine.layers().map((l) => l.run.id)).toEqual(['a', 'a']);
    expect(engine.current!.serial).toBe(2);
  });

  it('with nothing playable, the entry on screen fades to black', () => {
    const { engine, run, state } = setup([entry('a', 3)], { crossfade: 1 });
    run(1);
    state.entries = [entry('a', 3, [frame('x', { asset: null })])];
    run(2.5); // a ends at 3 s; nothing to play next
    expect(engine.current).toBeNull();
    expect(engine.layers()[0]!.alpha).toBeCloseTo(0.5, 1);
    run(1);
    expect(engine.layers()).toEqual([]);
  });
});

describe('frames', () => {
  it('without holdTime, lasts until its last frame finishes (delay + video length)', () => {
    const v = entry('v', null, [frame('r1', { fadeIn: 0, fadeOut: 0 }), frame('r2', { delay: 2 })]);
    const { engine, run } = setup([v, entry('p', 5)], { media: { r1: { status: 'ready', duration: 4 }, r2: { status: 'ready', duration: 5 } } });
    run(0.1);
    expect(engine.duration(engine.current!)).toBeCloseTo(7, 6);
    run(6.8);
    expect(engine.current!.id).toBe('v');
    run(0.3);
    expect(engine.current!.id).toBe('p');
  });

  it('frames start after their delay and fade in and out on their own envelope', () => {
    const { engine, run } = setup([entry('v', 30, [frame('r1', { delay: 1, fadeIn: 1, fadeOut: 1 })])], { media: { r1: { status: 'ready', duration: 6 } } });
    run(0.5);
    const cur = () => engine.current!;
    expect(engine.frameAlpha(cur(), 'r1')).toBe(0);
    run(1.0); // 0.5 s into the frame
    expect(engine.frameAlpha(cur(), 'r1')).toBeCloseTo(0.5, 1);
    run(2); // 2.5 s in
    expect(engine.frameAlpha(cur(), 'r1')).toBe(1);
    run(3); // 5.5 s in: 0.5 s left
    expect(engine.frameAlpha(cur(), 'r1')).toBeCloseTo(0.5, 1);
    expect(engine.fadeParts(cur(), 'r1')).toMatchObject({ in: 1 });
    run(1);
    expect(cur().frames[0]!.state).toBe('done');
  });

  it('with holdTime, a looping frame plays until the entry ends; an image too', () => {
    const { engine, run } = setup([entry('v', 12, [frame('r1', { loop: true }), frame('img', { asset: { pool: 'p.json', filepath: 'a.jpg' } })]), entry('p', 5)], {
      media: { r1: { status: 'ready', duration: 3 } },
    });
    run(11);
    expect(engine.current!.frames.map((r) => [r.state, r.end])).toEqual([['playing', null], ['playing', null]]);
    expect(engine.fadeParts(engine.current!, 'img')!.out).toBe(1); // an open end doesn't fade out
    run(1.1);
    expect(engine.current!.id).toBe('p');
  });

  it('with no holdTime, a looping video plays once and an image lasts the fallback', () => {
    const { engine, run } = setup([entry('v', null, [frame('r1', { loop: true }), frame('img', { asset: { pool: 'p.json', filepath: 'a.jpg' } })])], {
      media: { r1: { status: 'ready', duration: 3 } },
    });
    run(0.1);
    expect(engine.current!.frames.map((r) => r.end)).toEqual([3, IMAGE_FALLBACK_DURATION]);
  });

  it('a frame waits for its media, and is dropped if it fails or never loads', () => {
    const media: Record<string, Media> = { r1: { status: 'loading', duration: null }, r2: { status: 'loading', duration: null }, r3: { status: 'loading', duration: null } };
    const { engine, run } = setup([entry('v', 60, [frame('r1'), frame('r2'), frame('r3')])], { media });
    run(1);
    expect(engine.current!.frames.map((r) => r.state)).toEqual(['pending', 'pending', 'pending']);
    media.r1 = { status: 'ready', duration: 4 };
    media.r3 = { status: 'failed', duration: null };
    run(0.1);
    expect(engine.current!.frames.map((r) => r.state)).toEqual(['playing', 'pending', 'done']);
    run(REGION_LOAD_TIMEOUT);
    expect(engine.current!.frames[1]!.state).toBe('done');
  });

  it("timing edits apply from the entry's next start", () => {
    const a = entry('a', 10);
    const { engine, run, state } = setup([a, entry('b', 2)], { crossfade: 0 });
    run(1);
    state.entries = [{ ...a, holdTime: 3 }, entry('b', 2)];
    run(5);
    expect(engine.current!.id).toBe('a'); // still on the old 10 s
    run(5);
    expect(engine.current!.id).toBe('b');
    run(2.1);
    expect(engine.current!.snapshot.holdTime).toBe(3);
  });
});

describe('live edits and transport', () => {
  it('follows the entry on screen through a reorder', () => {
    const entries = [entry('a', 5), entry('b', 5), entry('c', 5)];
    const { engine, run, state } = setup(entries, { crossfade: 0 });
    run(6); // on b
    expect(engine.current!.id).toBe('b');
    state.entries = [entries[1]!, entries[0]!, entries[2]!]; // b moved to the top
    run(5);
    expect(engine.current!.id).toBe('a'); // the entry after b's new position
  });

  it("continues with the entry that took the removed entry's place", () => {
    const entries = [entry('a', 5), entry('b', 5), entry('c', 5), entry('d', 5)];
    const { engine, run, state } = setup(entries, { crossfade: 0 });
    run(6); // on b
    state.entries = [entries[0]!, entries[2]!, entries[3]!];
    run(5);
    expect(engine.current!.id).toBe('c');
  });

  it('next, previous and jump crossfade immediately', () => {
    const { engine, run } = setup([entry('a', 50), entry('b', 50), entry('c', 50)]);
    run(1);
    engine.next();
    run(0.1);
    expect(engine.current!.id).toBe('b');
    engine.previous();
    run(0.1);
    expect(engine.current!.id).toBe('a');
    engine.jumpTo('c');
    run(0.1);
    expect(engine.current!.id).toBe('c');
  });

  it('preview holds an entry, restarting it each time it ends, until resume', () => {
    const { engine, run } = setup([entry('a', 3), entry('b', 3), entry('c', 3)], { crossfade: 0 });
    engine.preview('b');
    run(10);
    expect(engine.current!.id).toBe('b');
    expect(engine.current!.serial).toBeGreaterThan(3);
    engine.resume();
    run(3);
    expect(engine.current!.id).toBe('c');
  });

  it('upcoming is the next playable entry, or the previewed one (what to preload)', () => {
    const { engine, run } = setup([entry('a', 3), entry('x', 3, undefined, { enabled: false }), entry('b', 3)]);
    run(0.1);
    expect(engine.upcomingId()).toBe('b');
    engine.preview('x');
    expect(engine.upcomingId()).toBe('x');
  });

  it('restart starts over from the first playable entry', () => {
    const { engine, run } = setup([entry('a', 3), entry('b', 3)], { crossfade: 0 });
    run(4);
    expect(engine.current!.id).toBe('b');
    engine.restart();
    run(0.1);
    expect(engine.current!.id).toBe('a');
  });
});
