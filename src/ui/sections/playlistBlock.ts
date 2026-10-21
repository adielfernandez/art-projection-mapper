import { resolvePlaylist, type PlaylistEntry } from '../../content/playlist';
import type { ImportResult } from '../../io/projectController';
import { WALL_QUAD_ID, type QuadId } from '../../state/schema';
import { button, h, showNote, type Binder } from '../controls';
import { dropZone } from '../dropZone';
import type { PanelContext } from './context';

/** How often the "now playing" highlight refreshes (playback doesn't emit store events). */
const PLAYING_POLL_MS = 400;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * A playlist: a frame's (shown in a manual show) or the wall's wallpaper (always shown).
 * One row per entry with ↑ ↓ ×, plus an asset picker
 * listing every asset in the loaded pools. Clicking an asset appends it. New files can be
 * imported from the picker, or dropped on the playlist: they join an asset pool and the playlist.
 */
export function playlistBlock(ctx: PanelContext, b: Binder, frameId: QuadId): HTMLElement {
  const { store, thumbs, project } = ctx;
  const isWall = frameId === WALL_QUAD_ID;
  const frame = () => (isWall ? store.config.wallQuad : store.config.frames.find((f) => f.id === frameId));
  /** The wall plays its playlist in every show type; frames only in a manual show. */
  const active = () => isWall || store.config.showType === 'manual';
  const entries = (): PlaylistEntry[] => {
    const f = frame();
    return f ? resolvePlaylist(f.playlist, store.playlistKeys(frameId), store.pools, store.runtime.assetErrors, isWall) : [];
  };

  const list = h('div', { class: 'playlist' });
  const picker = h('div', { class: 'picker' });
  picker.hidden = true;
  const addBtn = button('+ Add asset', () => {
    picker.hidden = !picker.hidden;
    addBtn.textContent = picker.hidden ? '+ Add asset' : 'Done adding';
    if (!picker.hidden) {
      pickerSig = null;
      rebuildPicker();
    }
  }, 'wide');

  // ----- rows -----
  let listSig: string | null = null;
  const rowsByKey = new Map<number, HTMLElement>();
  const rebuildList = () => {
    const f = frame();
    if (!f) return;
    const es = entries();
    const label = (i: number) => {
      const e = es[i]!;
      const item = f.playlist[i]!;
      return e.uid ? store.findAsset(e.uid)?.entry.title?.trim() || fileName(item.filepath) : fileName(item.filepath);
    };
    const sig = es.map((e, i) => `${e.key}:${e.status}:${f.playlist[i]!.filepath}:${label(i)}`).join('|');
    if (sig === listSig) return;
    listSig = sig;
    rowsByKey.clear();
    if (es.length === 0) {
      const empty = isWall ? 'Empty: no wallpaper; the wall shows the background color.' : 'Empty: this frame stays black in a manual show.';
      list.replaceChildren(h('div', { class: 'muted', text: empty }));
      return;
    }
    list.replaceChildren(
      ...es.map((e, i) => {
        const item = f.playlist[i]!;
        const thumb = e.uid ? thumbs.slot(e.uid) : h('span', { class: 'thumb', text: '?' });
        if (e.uid) thumbs.request(e.uid);
        const name = h('span', { class: 'asset-name', text: label(i), title: `${item.pool} → ${item.filepath}` });
        const BADGES = { missing: 'missing', error: 'failed', wallOnly: 'wall only' } as const;
        const badge = e.status === 'ok' ? null : h('span', { class: 'badge error', text: BADGES[e.status] });
        if (e.status === 'wallOnly') badge!.title = 'Marked "Wall only" in the Assets section, so this frame skips it.';
        const up = button('↑', () => store.movePlaylistItem(frameId, i, i - 1), 'small');
        const down = button('↓', () => store.movePlaylistItem(frameId, i, i + 1), 'small');
        const remove = button('×', () => store.removePlaylistItem(frameId, i), 'small danger');
        up.disabled = i === 0;
        down.disabled = i === es.length - 1;
        up.title = 'Move up';
        down.title = 'Move down';
        remove.title = 'Remove from playlist';
        const row = h('div', { class: 'playlist-row' }, [
          h('span', { class: 'playlist-index', text: String(i + 1) }),
          thumb,
          name,
          badge,
          h('span', { class: 'playlist-buttons' }, [up, down, remove]),
        ]);
        rowsByKey.set(e.key, row);
        return row;
      }),
    );
    syncPlaying();
  };

  const syncPlaying = () => {
    const key = active() ? ctx.playback.playingKey(frameId) : null;
    for (const [k, row] of rowsByKey) row.classList.toggle('playing', k === key);
  };
  const timer = window.setInterval(() => {
    if (!list.isConnected) return void window.clearInterval(timer); // frame removed / panel rebuilt
    if (store.runtime.panelOpen) syncPlaying();
  }, PLAYING_POLL_MS);

  // ----- import new files: into an asset pool, then onto this playlist -----
  const usablePools = () => store.pools.filter((m) => !m.error);
  let chosenPool: string | null = null;
  /** The chosen pool; null when there is none yet (the import then creates "assets.json"). */
  const targetPool = () => {
    const pools = usablePools();
    return pools.find((m) => m.path === chosenPool)?.path ?? pools[0]?.path ?? null;
  };
  const poolSelect = h('select', { class: 'pool-select' });
  poolSelect.addEventListener('change', () => (chosenPool = poolSelect.value));
  const intoRow = h('div', { class: 'import-into' }, [h('span', { class: 'muted', text: 'Into asset pool' }), poolSelect]);
  const importNote = h('div', { class: 'muted' });
  const importTile = h('button', { class: 'picker-tile import-tile', type: 'button' }, [
    h('span', { class: 'thumb', text: '+' }),
    h('span', { class: 'picker-name', text: 'Import new files…' }),
  ]);
  importTile.title = 'Choose images or videos from your computer. They join an asset pool and this playlist.';
  const result = h('div', { class: 'message' });
  result.hidden = true;

  const addImported = (r: ImportResult | null) => {
    if (!r) return;
    let added = 0;
    for (const uid of r.uids) {
      const found = store.findAsset(uid);
      if (!found) continue;
      store.addToPlaylist(frameId, { pool: found.pool.path, filepath: found.entry.filepath });
      added++;
    }
    const parts = added ? [`Added ${added} to this playlist.`] : [];
    if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.join('; ')}`);
    // Fades after a few seconds (skipped files are also listed in the Assets section).
    if (parts.length) showNote(result, parts.join(' '), r.skipped.length ? 'warn' : 'info', true);
  };
  importTile.addEventListener('click', () => void project.pickAndImport(targetPool()).then(addImported));
  const syncImport = () => {
    const pools = usablePools();
    importNote.hidden = pools.length > 0;
    importNote.textContent = 'New files go into a new asset pool, assets.json.';
    intoRow.hidden = pools.length < 2;
    const sig = pools.map((m) => m.path).join('|');
    if (poolSelect.dataset.sig !== sig) {
      poolSelect.dataset.sig = sig;
      poolSelect.replaceChildren(...pools.map((m) => Object.assign(h('option', { text: m.path }), { value: m.path })));
    }
    const target = targetPool();
    if (target) poolSelect.value = target;
  };

  // ----- picker -----
  let pickerSig: string | null = null;
  const rebuildPicker = () => {
    if (picker.hidden) return;
    const sig = store.pools
      .map((m) => `${m.path}:${m.assets.map((a) => `${a.uid}.${a.entry.filepath}.${a.entry.title ?? ''}.${!!a.entry.wallOnly}`).join(',')}`)
      .join('|');
    if (sig === pickerSig) return;
    pickerSig = sig;
    const importer = [h('div', { class: 'subhead', text: 'New files' }), intoRow, importNote, h('div', { class: 'picker-grid' }, [importTile])];
    // Frames can't use wall-only assets, so their pickers leave them out.
    const usable = (a: { entry: { wallOnly?: boolean } }) => isWall || !a.entry.wallOnly;
    const groups = store.pools.filter((m) => m.assets.some(usable));
    if (groups.length === 0) {
      picker.replaceChildren(...importer, h('div', { class: 'muted', text: 'No assets loaded yet.' }));
      return;
    }
    picker.replaceChildren(
      ...importer,
      ...groups.flatMap((m) => [
        h('div', { class: 'subhead', text: m.path }),
        h(
          'div',
          { class: 'picker-grid' },
          m.assets.filter(usable).map((a) => {
            const name = a.entry.title?.trim() || fileName(a.entry.filepath);
            const tile = h('button', { class: 'picker-tile', type: 'button', title: `Add "${name}" (${a.entry.filepath})` }, [
              thumbs.slot(a.uid),
              h('span', { class: 'picker-name', text: name }),
            ]);
            tile.addEventListener('click', () => store.addToPlaylist(frameId, { pool: m.path, filepath: a.entry.filepath }));
            thumbs.request(a.uid);
            return tile;
          }),
        ),
      ]),
    );
  };

  const block = h('div', { class: 'playlist-block' }, [
    h('div', { class: 'subhead', text: isWall ? 'Wallpaper playlist' : 'Playlist' }),
    isWall
      ? h('div', { class: 'muted playlist-note', text: 'Plays behind the frames in either show type. One item stays up; several cycle in order.' })
      : null,
    list,
    result,
    addBtn,
    picker,
  ]);
  dropZone(block, (dt) => void project.importDrop(targetPool(), dt).then(addImported), active);

  b.add(() => {
    // Frame playlists are kept but hidden in a randomized show; the wallpaper always shows.
    block.hidden = !active();
    if (block.hidden) return;
    syncImport();
    rebuildList();
    rebuildPicker();
  });

  return block;
}
