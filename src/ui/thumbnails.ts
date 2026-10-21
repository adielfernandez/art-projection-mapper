import { mediaKind } from '../content/selection';
import { makeThumbnail } from '../content/mediaLoader';
import type { ProjectController } from '../io/projectController';
import type { Store } from '../state/store';
import { h } from './controls';

const THUMB_PX = 96;

/**
 * Asset thumbnails shared by the whole panel. Each asset is decoded once (one at a time, in
 * the worker) and copied into every slot showing it. Loading a project clears the cache.
 */
export class Thumbnails {
  private cache = new Map<string, HTMLCanvasElement | null>();
  private slots = new Map<string, Set<HTMLElement>>();
  private queue: string[] = [];
  private running = false;
  private generation = 0;
  private pools: unknown;

  constructor(
    private store: Store,
    private project: ProjectController,
  ) {
    this.pools = store.pools;
    store.subscribe((e) => {
      // A project load replaces the pool list; live edits change it in place.
      if (e.assets && store.pools !== this.pools) {
        this.pools = store.pools;
        this.clear();
      }
    });
  }

  /** A new thumbnail element for an asset. Filled now if cached, else once request()ed. */
  slot(uid: string): HTMLElement {
    const el = h('span', { class: 'thumb' });
    let set = this.slots.get(uid);
    if (!set) this.slots.set(uid, (set = new Set()));
    // Drop slots from panel rebuilds that are no longer on the page.
    for (const old of set) if (!old.isConnected && old.dataset.filled) set.delete(old);
    set.add(el);
    if (this.cache.has(uid)) this.fill(el, this.cache.get(uid)!);
    return el;
  }

  /** Generate an asset's thumbnail if it isn't cached; force regenerates (e.g. after a filepath edit). */
  request(uid: string, force = false): void {
    if (force) this.cache.delete(uid);
    if (this.cache.has(uid) || this.queue.includes(uid)) return;
    this.queue.push(uid);
    void this.pump();
  }

  private clear(): void {
    this.generation++;
    this.cache.clear();
    this.slots.clear();
    this.queue.length = 0;
  }

  private fill(el: HTMLElement, src: HTMLCanvasElement | null): void {
    el.dataset.filled = '1';
    if (!src) return void el.replaceChildren('✕');
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
    el.replaceChildren(c);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      const uid = this.queue.shift()!;
      const found = this.store.findAsset(uid);
      const kind = found ? mediaKind(found.entry.filepath) : null;
      let canvas: HTMLCanvasElement | null = null;
      if (found && kind) {
        try {
          const file = await this.project.getMediaFile(found.pool.path, found.entry.filepath);
          canvas = await makeThumbnail(file, kind, THUMB_PX);
        } catch {
          canvas = null;
        }
      }
      if (gen !== this.generation) break;
      this.cache.set(uid, canvas);
      for (const el of this.slots.get(uid) ?? []) this.fill(el, canvas);
    }
    this.running = false;
    if (this.queue.length) void this.pump();
  }
}
