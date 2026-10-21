/**
 * Shared shuffle bag over asset ids. Each round draws every item once in random
 * order; callers pass the ids currently displayed or loading so they are skipped.
 */
export class ShuffleBag {
  private items: string[] = [];
  private bag: string[] = [];
  /** Items drawn in the current round (so items added mid-round aren't double counted). */
  private drawn = new Set<string>();
  private last: string | null = null;
  /** True until the first draw after a reshuffle. */
  private fresh = false;

  constructor(private rng: () => number = Math.random) {}

  /** Update the items. Removed items leave the bag; new items join the current round at random positions. */
  setItems(items: readonly string[]): void {
    this.items = [...items];
    const set = new Set(items);
    this.bag = this.bag.filter((i) => set.has(i));
    for (const d of [...this.drawn]) if (!set.has(d)) this.drawn.delete(d);
    for (const it of items) {
      if (!this.bag.includes(it) && !this.drawn.has(it)) {
        this.bag.splice(Math.floor(this.rng() * (this.bag.length + 1)), 0, it);
      }
    }
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * Draw the next item not in `exclude`. Reshuffles when the bag has nothing usable left.
   * The first draw of a new bag never repeats the last draw of the previous one
   * (unless it is the only candidate). Returns null if every item is excluded.
   */
  next(exclude: ReadonlySet<string> = new Set()): string | null {
    let i = this.findCandidate(exclude);
    if (i < 0) {
      this.reshuffle();
      i = this.findCandidate(exclude);
      if (i < 0) return null;
    }
    const item = this.bag.splice(i, 1)[0]!;
    this.drawn.add(item);
    this.last = item;
    this.fresh = false;
    return item;
  }

  private findCandidate(exclude: ReadonlySet<string>): number {
    if (this.fresh && this.last !== null) {
      const i = this.bag.findIndex((x) => !exclude.has(x) && x !== this.last);
      if (i >= 0) return i;
    }
    return this.bag.findIndex((x) => !exclude.has(x));
  }

  private reshuffle(): void {
    const b = [...this.items];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [b[i], b[j]] = [b[j]!, b[i]!];
    }
    this.bag = b;
    this.drawn.clear();
    this.fresh = true;
  }
}
