import type { ImportResult } from '../../io/projectController';
import type { PlaylistItem } from '../../state/schema';
import { h, type Binder } from '../controls';
import type { PanelContext } from './context';

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export interface AssetPicker {
  el: HTMLElement;
  /** The pool new files go into (null: none yet; the import creates "assets.json"). */
  targetPool(): string | null;
  /** Rebuild now, even if the pools haven't changed (call when showing it). */
  sync(): void;
  /** Turn an import result into asset references (skipping files that didn't make it). */
  itemsFrom(r: ImportResult): PlaylistItem[];
}

/**
 * The asset picker: assets grouped by pool, with an "Import new files…" tile and, when there
 * are several pools, an "Into asset pool" chooser. Clicking a tile picks that asset. Only
 * the wallpaper offers assets marked wall only.
 */
export function assetPicker(
  ctx: PanelContext,
  b: Binder,
  opts: { allowWallOnly: boolean; onPick(item: PlaylistItem): void; onImport(r: ImportResult | null): void; importTitle: string; pickVerb: string },
): AssetPicker {
  const { store, thumbs, project } = ctx;
  const el = h('div', { class: 'picker' });

  const usablePools = () => store.pools.filter((m) => !m.error);
  let chosenPool: string | null = null;
  const targetPool = () => {
    const pools = usablePools();
    return pools.find((m) => m.path === chosenPool)?.path ?? pools[0]?.path ?? null;
  };
  const poolSelect = h('select', { class: 'pool-select' });
  poolSelect.addEventListener('change', () => (chosenPool = poolSelect.value));
  const intoRow = h('div', { class: 'import-into' }, [h('span', { class: 'muted', text: 'Into asset pool' }), poolSelect]);
  const importNote = h('div', { class: 'muted', text: 'New files go into a new asset pool, assets.json.' });
  const importTile = h('button', { class: 'picker-tile import-tile', type: 'button' }, [
    h('span', { class: 'thumb', text: '+' }),
    h('span', { class: 'picker-name', text: 'Import new files…' }),
  ]);
  importTile.title = opts.importTitle;
  importTile.addEventListener('click', () => void project.pickAndImport(targetPool()).then(opts.onImport));

  const syncImport = () => {
    const pools = usablePools();
    importNote.hidden = pools.length > 0;
    intoRow.hidden = pools.length < 2;
    const sig = pools.map((m) => m.path).join('|');
    if (poolSelect.dataset.sig !== sig) {
      poolSelect.dataset.sig = sig;
      poolSelect.replaceChildren(...pools.map((m) => Object.assign(h('option', { text: m.path }), { value: m.path })));
    }
    const target = targetPool();
    if (target) poolSelect.value = target;
  };

  let sig: string | null = null;
  const rebuild = () => {
    syncImport();
    if (el.hidden) return;
    const next = store.pools
      .map((m) => `${m.path}:${m.assets.map((a) => `${a.uid}.${a.entry.filepath}.${a.entry.title ?? ''}.${!!a.entry.wallOnly}`).join(',')}`)
      .join('|');
    if (next === sig) return;
    sig = next;
    const importer = [h('div', { class: 'subhead', text: 'New files' }), intoRow, importNote, h('div', { class: 'picker-grid' }, [importTile])];
    // Frames can't use wall-only assets, so their pickers leave them out.
    const usable = (a: { entry: { wallOnly?: boolean } }) => opts.allowWallOnly || !a.entry.wallOnly;
    const groups = store.pools.filter((m) => m.assets.some(usable));
    if (groups.length === 0) {
      el.replaceChildren(...importer, h('div', { class: 'muted', text: 'No assets loaded yet.' }));
      return;
    }
    el.replaceChildren(
      ...importer,
      ...groups.flatMap((m) => [
        h('div', { class: 'subhead', text: m.path }),
        h(
          'div',
          { class: 'picker-grid' },
          m.assets.filter(usable).map((a) => {
            const name = a.entry.title?.trim() || fileName(a.entry.filepath);
            const tile = h('button', { class: 'picker-tile', type: 'button', title: `${opts.pickVerb} "${name}" (${a.entry.filepath})` }, [
              thumbs.slot(a.uid),
              h('span', { class: 'picker-name', text: name }),
            ]);
            tile.addEventListener('click', () => opts.onPick({ pool: m.path, filepath: a.entry.filepath }));
            thumbs.request(a.uid);
            return tile;
          }),
        ),
      ]),
    );
  };
  b.add(rebuild);

  return {
    el,
    targetPool,
    sync: () => {
      sig = null;
      rebuild();
    },
    itemsFrom: (r) =>
      r.uids.flatMap((uid) => {
        const found = store.findAsset(uid);
        return found ? [{ pool: found.pool.path, filepath: found.entry.filepath }] : [];
      }),
  };
}
