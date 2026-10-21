import { resolvePlaylist, type PlaylistEntry } from '../../content/playlist';
import type { QuadId } from '../../state/schema';
import { button, h, type Binder } from '../controls';
import type { PanelContext } from './context';

/** How often the "now playing" highlight refreshes (playback doesn't emit store events). */
const PLAYING_POLL_MS = 400;

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * A frame's playlist (manual show): one row per entry with ↑ ↓ ×, plus an asset picker
 * listing every asset in the loaded manifests. Clicking an asset appends it.
 */
export function playlistBlock(ctx: PanelContext, b: Binder, frameId: QuadId): HTMLElement {
  const { store, thumbs } = ctx;
  const frame = () => store.config.frames.find((f) => f.id === frameId);
  const entries = (): PlaylistEntry[] => {
    const f = frame();
    return f ? resolvePlaylist(f.playlist, store.playlistKeys(frameId), store.manifests, store.runtime.assetErrors) : [];
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
      list.replaceChildren(h('div', { class: 'muted', text: 'Empty: this frame stays black in a manual show.' }));
      return;
    }
    list.replaceChildren(
      ...es.map((e, i) => {
        const item = f.playlist[i]!;
        const thumb = e.uid ? thumbs.slot(e.uid) : h('span', { class: 'thumb', text: '?' });
        if (e.uid) thumbs.request(e.uid);
        const name = h('span', { class: 'asset-name', text: label(i), title: `${item.manifest} → ${item.filepath}` });
        const badge = e.status === 'ok' ? null : h('span', { class: 'badge error', text: e.status === 'missing' ? 'missing' : 'failed' });
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
    const key = store.config.showType === 'manual' ? ctx.playback.playingKey(frameId) : null;
    for (const [k, row] of rowsByKey) row.classList.toggle('playing', k === key);
  };
  const timer = window.setInterval(() => {
    if (!list.isConnected) return void window.clearInterval(timer); // frame removed / panel rebuilt
    if (store.runtime.panelOpen) syncPlaying();
  }, PLAYING_POLL_MS);

  // ----- picker -----
  let pickerSig: string | null = null;
  const rebuildPicker = () => {
    if (picker.hidden) return;
    const sig = store.manifests
      .map((m) => `${m.path}:${m.assets.map((a) => `${a.uid}.${a.entry.filepath}.${a.entry.title ?? ''}`).join(',')}`)
      .join('|');
    if (sig === pickerSig) return;
    pickerSig = sig;
    const groups = store.manifests.filter((m) => m.assets.length > 0);
    if (groups.length === 0) {
      picker.replaceChildren(h('div', { class: 'muted', text: 'No assets loaded. Open a project with asset manifests.' }));
      return;
    }
    picker.replaceChildren(
      ...groups.flatMap((m) => [
        h('div', { class: 'subhead', text: m.path }),
        h(
          'div',
          { class: 'picker-grid' },
          m.assets.map((a) => {
            const name = a.entry.title?.trim() || fileName(a.entry.filepath);
            const tile = h('button', { class: 'picker-tile', type: 'button', title: `Add "${name}" (${a.entry.filepath})` }, [
              thumbs.slot(a.uid),
              h('span', { class: 'picker-name', text: name }),
            ]);
            tile.addEventListener('click', () => store.addToPlaylist(frameId, { manifest: m.path, filepath: a.entry.filepath }));
            thumbs.request(a.uid);
            return tile;
          }),
        ),
      ]),
    );
  };

  const block = h('div', { class: 'playlist-block' }, [
    h('div', { class: 'subhead', text: 'Playlist' }),
    list,
    addBtn,
    picker,
  ]);

  b.add(() => {
    // Playlists are kept but hidden in a randomized show.
    block.hidden = store.config.showType !== 'manual';
    if (block.hidden) return;
    rebuildList();
    rebuildPicker();
  });

  return block;
}
