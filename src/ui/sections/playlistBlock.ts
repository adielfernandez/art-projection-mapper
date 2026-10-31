import { resolvePlaylist, type PlaylistEntry } from '../../content/playlist';
import type { ImportResult } from '../../io/projectController';
import { WALL_QUAD_ID } from '../../state/schema';
import { button, h, showNote, type Binder } from '../controls';
import { dropZone } from '../dropZone';
import { assetPicker, fileName } from './assetPicker';
import type { PanelContext } from './context';

/** How often the "now playing" highlight refreshes (playback doesn't emit store events). */
const PLAYING_POLL_MS = 400;

/**
 * The wall's wallpaper playlist (shown in both show types). One row per entry with ↑ ↓ ×,
 * plus an asset picker listing every asset in the loaded pools. Clicking an asset appends it.
 * New files can be imported from the picker, or dropped on the playlist: they join an asset
 * pool and the playlist.
 */
export function playlistBlock(ctx: PanelContext, b: Binder): HTMLElement {
  const { store, thumbs, project } = ctx;
  const id = WALL_QUAD_ID;
  const wall = () => store.config.wallQuad;
  const entries = (): PlaylistEntry[] => resolvePlaylist(wall().playlist, store.playlistKeys(id), store.pools, store.runtime.assetErrors, true);

  const list = h('div', { class: 'playlist' });
  const result = h('div', { class: 'message' });
  result.hidden = true;

  const addImported = (r: ImportResult | null) => {
    if (!r) return;
    const items = picker.itemsFrom(r);
    for (const item of items) store.addToPlaylist(id, item);
    const parts = items.length ? [`Added ${items.length} to this playlist.`] : [];
    if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.join('; ')}`);
    // Fades after a few seconds (skipped files are also listed in the Assets section).
    if (parts.length) showNote(result, parts.join(' '), r.skipped.length ? 'warn' : 'info', true);
  };
  const picker = assetPicker(ctx, b, {
    allowWallOnly: true,
    onPick: (item) => store.addToPlaylist(id, item),
    onImport: addImported,
    importTitle: 'Choose images or videos from your computer. They join an asset pool and this playlist.',
    pickVerb: 'Add',
  });
  picker.el.hidden = true;
  const addBtn = button('+ Add asset', () => {
    picker.el.hidden = !picker.el.hidden;
    addBtn.textContent = picker.el.hidden ? '+ Add asset' : 'Done adding';
    if (!picker.el.hidden) picker.sync();
  }, 'wide');

  // ----- rows -----
  let listSig: string | null = null;
  const rowsByKey = new Map<number, HTMLElement>();
  const rebuildList = () => {
    const playlist = wall().playlist;
    const es = entries();
    const label = (i: number) => {
      const e = es[i]!;
      const item = playlist[i]!;
      return e.uid ? store.findAsset(e.uid)?.entry.title?.trim() || fileName(item.filepath) : fileName(item.filepath);
    };
    const sig = es.map((e, i) => `${e.key}:${e.status}:${playlist[i]!.filepath}:${label(i)}`).join('|');
    if (sig === listSig) return;
    listSig = sig;
    rowsByKey.clear();
    if (es.length === 0) {
      list.replaceChildren(h('div', { class: 'muted', text: 'Empty: no wallpaper; the wall shows the background color.' }));
      return;
    }
    list.replaceChildren(
      ...es.map((e, i) => {
        const item = playlist[i]!;
        const thumb = e.uid ? thumbs.slot(e.uid) : h('span', { class: 'thumb', text: '?' });
        if (e.uid) thumbs.request(e.uid);
        const name = h('span', { class: 'asset-name', text: label(i), title: `${item.pool} → ${item.filepath}` });
        const BADGES = { missing: 'missing', error: 'failed', wallOnly: 'wall only' } as const;
        const badge = e.status === 'ok' ? null : h('span', { class: 'badge error', text: BADGES[e.status] });
        const up = button('↑', () => store.movePlaylistItem(id, i, i - 1), 'small');
        const down = button('↓', () => store.movePlaylistItem(id, i, i + 1), 'small');
        const remove = button('×', () => store.removePlaylistItem(id, i), 'small danger');
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
    const key = ctx.playback.playingKey(id);
    for (const [k, row] of rowsByKey) row.classList.toggle('playing', k === key);
  };
  const timer = window.setInterval(() => {
    if (!list.isConnected) return void window.clearInterval(timer); // panel rebuilt
    if (store.runtime.panelOpen) syncPlaying();
  }, PLAYING_POLL_MS);

  const block = h('div', { class: 'playlist-block' }, [
    h('div', { class: 'subhead', text: 'Wallpaper playlist' }),
    h('div', { class: 'muted playlist-note', text: 'Plays behind the frames in either show type. One item stays up; several cycle in order.' }),
    list,
    result,
    addBtn,
    picker.el,
  ]);
  dropZone(block, (dt) => void project.importDrop(picker.targetPool(), dt).then(addImported), () => true);
  b.add(rebuildList);
  return block;
}
