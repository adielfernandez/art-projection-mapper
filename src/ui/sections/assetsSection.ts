import type { ConfirmFn } from '../../io/projectController';
import { WALL_QUAD_ID } from '../../state/schema';
import { Binder, button, checkboxRow, h, section, showNote, textRow, withHelp } from '../controls';
import { dropZone } from '../dropZone';
import type { Thumbnails } from '../thumbnails';
import type { PanelContext } from './context';

/**
 * Assets: asset pools (grouped), each asset editable live. Files can be added with a picker
 * or by dropping them on a pool, and removed with ×. Each pool has its own Save; "Save All
 * Assets" appears when there are several. Nothing is written otherwise.
 */
export function assetsSection(ctx: PanelContext): HTMLElement {
  const { store, project, binder } = ctx;

  const saveAll = button('Save All Assets', () => void project.saveAllAssets(ctx.confirmAt(saveAllRow)), 'primary');
  saveAll.title = 'Save every modified asset pool, copying in any new files';
  const saveAllRow: HTMLElement = h('div', { class: 'button-row' }, [saveAll]);
  const message = h('div', { class: 'message' });
  message.hidden = true;
  let shownMessage: typeof store.runtime.assetMessage | undefined;
  const list = h('div', { class: 'pools' });
  const listBinder = new Binder();
  const { thumbs } = ctx;
  let signature: string | null = null; // null: not drawn yet (an empty list must draw too)

  const rebuild = () => {
    const sig = store.pools.map((m) => `${m.path}:${m.error ?? ''}:${m.assets.map((a) => a.uid).join('.')}`).join('|');
    if (sig === signature) return;
    signature = sig;
    listBinder.clear();
    if (store.pools.length === 0) {
      // A new show: content can be added straight away; it goes into a new "assets.json" pool.
      const add = button('+ Add files…', () => void project.pickAndImport(null), 'wide');
      add.title = 'Choose images or videos to add to this show';
      list.replaceChildren(
        h('div', { class: 'muted', text: 'No content yet. Add images or videos and they go into a new asset pool, assets.json. To name your own pools, add them below first.' }),
        add,
        h('div', { class: 'muted drop-hint', text: 'Or drag files from your computer onto this section.' }),
      );
      return;
    }
    list.replaceChildren(...store.pools.map((m) => poolGroup(ctx, listBinder, thumbs, m.path)));
  };

  // ----- add an asset pool -----
  const poolName = h('input', { type: 'text', class: 'text' });
  poolName.placeholder = 'Asset pool name';
  poolName.spellcheck = false;
  const addPool = async () => {
    const err = await project.addPool(poolName.value);
    if (err) store.setAssetMessage({ kind: 'warn', text: err });
    else poolName.value = '';
  };
  poolName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addPool();
  });
  const addPoolBtn = withHelp(
    button('+ Add asset pool', () => void addPool()),
    'Adds an asset pool (a list of content) to this show. If a pool file with this name is already in the project folder, it is added as is; otherwise a new, empty one is created.',
  );
  const addPoolRow = h('div', { class: 'button-row add-pool' }, [poolName, addPoolBtn]);

  binder.add(() => {
    const rt = store.runtime;
    saveAllRow.hidden = store.pools.length < 2;
    saveAll.disabled = !rt.assetsDirty;
    saveAll.classList.toggle('attention', rt.assetsDirty);
    // A new message shows; info ("Added…", "Saved…") fades after a few seconds, warnings and errors stay.
    const m = rt.assetMessage;
    if (m !== shownMessage) {
      shownMessage = m;
      if (m) showNote(message, m.text, m.kind, m.kind === 'info');
      else message.hidden = true;
    }
    rebuild();
    listBinder.syncAll();
  });

  const el = section(ctx.openState, 'assets', 'Assets', [saveAllRow, message, list, addPoolRow]);
  // With no pool to drop onto, the whole section takes files (into the default pool).
  dropZone(el, (dt) => void project.importDrop(null, dt), () => !store.pools.some((m) => !m.error));
  return el;
}

/** "Frame 2", or "the wall" for the wallpaper playlist. */
function quadName(id: string, frames: readonly { id: string }[]): string {
  return id === WALL_QUAD_ID ? 'the wall' : `Frame ${frames.findIndex((f) => f.id === id) + 1}`;
}

function poolGroup(ctx: PanelContext, b: Binder, thumbs: Thumbnails, path: string): HTMLElement {
  const { store, project } = ctx;
  const pool = () => store.pools.find((m) => m.path === path);
  const m = pool()!;
  const editable = () => !pool()?.error;

  const count = h('span', { class: 'badge' });
  const modified = h('span', { class: 'badge modified', text: 'modified' });
  const failed = h('span', { class: 'badge error' });
  // Confirmations for this pool appear right under its header (set once the section exists).
  let header: HTMLElement | null = null;
  const confirmHere: ConfirmFn = (message, label) => (header ? ctx.confirmAt(header) : ctx.confirm)(message, label);
  const save = button('Save Asset Pool', () => void project.savePool(path, confirmHere), 'small primary');
  save.title = `Write ${path}, copying any new files into the project folder`;
  const remove = withHelp(button('×', () => {
    const cur = pool();
    // Only ask when something would be lost: unsaved changes to a pool that lists assets.
    // (A new, empty pool counts as modified only because its file doesn't exist yet.)
    if (!cur?.dirty || cur.assets.length === 0) return store.removePool(path);
    void confirmHere(`${path} has unsaved changes. Remove it from the show anyway?`, 'Remove').then((ok) => ok && store.removePool(path));
  }, 'small danger'), '');
  b.add(() => {
    const cur = pool();
    if (!cur) return;
    const errs = cur.assets.filter((a) => store.runtime.assetErrors[a.uid] !== undefined).length;
    count.textContent = `${cur.assets.length}`;
    modified.hidden = !cur.dirty;
    failed.hidden = !cur.error && errs === 0;
    failed.textContent = cur.error ? 'error' : `${errs} failed`;
    save.hidden = !!cur.error;
    save.disabled = !cur.dirty;
    save.classList.toggle('attention', cur.dirty);
    // The last pool can't be removed (a show without pools has nothing to add content to).
    remove.hidden = store.pools.length < 2;
    const frames = store.config.frames;
    const users = store.framesUsingPool(path).map((id) => quadName(id, frames));
    remove.dataset.help = [
      `Remove ${path} from the show. The file and its media stay on disk.`,
      users.length ? `Its assets are in the playlist of ${users.join(', ')}; those entries will show as missing.` : '',
    ].join(' ').trim();
  });

  const body: HTMLElement[] = [];
  if (m.error) body.push(h('div', { class: 'warning', text: `Asset pool not loaded: ${m.error}` }));
  if (m.warnings.length) {
    body.push(h('div', { class: 'message warn' }, [
      h('div', { text: 'Some entries had problems:' }),
      h('ul', {}, m.warnings.map((w) => h('li', { text: w }))),
    ]));
  }
  for (const a of m.assets) body.push(assetItem(ctx, b, thumbs, a.uid));
  if (!m.error && m.assets.length === 0) body.push(h('div', { class: 'muted', text: 'No assets yet.' }));
  if (!m.error) {
    const add = button('+ Add files…', () => {
      void project.pickAndImport(path).then((r) => {
        if (r?.added) ctx.openState.set(`pool:${path}`, true);
      });
    }, 'wide');
    add.title = 'Choose images or videos to add to this asset pool';
    body.push(add, h('div', { class: 'muted drop-hint', text: 'Or drag files from your computer onto this pool.' }));
  }

  const details = section(ctx.openState, `pool:${path}`, h('span', { class: 'title' }, [h('span', { class: 'asset-name', text: path })]), body, {
    headerExtras: [failed, modified, count, save, remove],
    class: m.error ? 'pool broken' : 'pool',
  });
  header = details.querySelector(':scope > summary');
  dropZone(details, (dt) => {
    ctx.openState.set(`pool:${path}`, true);
    details.open = true;
    void project.importDrop(path, dt);
  }, editable);
  // Thumbnails load lazily, when the group is first opened.
  const requestThumbs = () => {
    if (details.open) for (const a of m.assets) thumbs.request(a.uid);
  };
  details.addEventListener('toggle', requestThumbs);
  requestThumbs();
  return details;
}

function assetItem(ctx: PanelContext, b: Binder, thumbs: Thumbnails, uid: string): HTMLElement {
  const { store, project } = ctx;
  const entry = () => store.findAsset(uid)?.entry;
  const thumb = thumbs.slot(uid);
  const name = h('span', { class: 'asset-name' });
  const err = h('span', { class: 'badge error', text: 'failed' });
  const fresh = h('span', { class: 'badge live', text: 'new' });
  fresh.title = 'Added from outside the project folder. It is copied into the folder when you save this asset pool.';
  const errText = h('div', { class: 'warning' });
  const remove = withHelp(button('×', () => store.removeAsset(uid), 'small danger'), '');

  b.add(() => {
    const e = entry();
    if (!e) return;
    const file = e.filepath.split(/[\\/]/).pop() ?? e.filepath;
    name.textContent = e.title?.trim() || file;
    name.title = e.filepath;
    const error = store.runtime.assetErrors[uid];
    err.hidden = error === undefined;
    errText.hidden = error === undefined;
    errText.textContent = error ? `⚠ ${error}` : '';
    const staged = project.isStaged(uid);
    fresh.hidden = !staged;
    // Hover note: what × does, and which playlists would lose this asset.
    const frames = store.config.frames;
    const users = store.framesUsingAsset(uid).map((id) => quadName(id, frames));
    remove.dataset.help = [
      staged
        ? 'Remove from the show. This file was never copied into the project folder, so nothing changes on disk.'
        : 'Remove from the show. The file stays on disk.',
      users.length ? `It is in the playlist of ${users.join(', ')}; those entries will show as missing.` : '',
    ].join(' ').trim();
  });

  const text = (label: string, key: 'title' | 'artist' | 'year') =>
    textRow(b, label, { get: () => entry()?.[key] ?? '', set: (v) => store.updateAsset(uid, { [key]: v }) });

  return section(ctx.openState, `asset:${uid}`, h('span', { class: 'title' }, [thumb, name]), [
    text('Title', 'title'),
    text('Artist', 'artist'),
    text('Year', 'year'),
    textRow(b, 'File path', {
      get: () => entry()?.filepath ?? '',
      set: (v) => {
        if (v.trim() === '') return; // filepath is required
        store.updateAsset(uid, { filepath: v.trim() });
        thumbs.request(uid, true);
      },
      commitOnChange: true,
    }),
    checkboxRow(b, 'Zoom', () => !!entry()?.zoom, (v) => store.updateAsset(uid, { zoom: v })),
    checkboxRow(b, 'Pan', () => !!entry()?.pan, (v) => store.updateAsset(uid, { pan: v })),
    withHelp(
      checkboxRow(b, 'Wall only', () => !!entry()?.wallOnly, (v) => store.updateAsset(uid, { wallOnly: v })),
      "Only the wall's wallpaper playlist can use this asset. The frames skip it in both show types: it's left out of the Randomized shuffle, and a frame's playlist marks it \"wall only\" and plays the rest.",
    ),
    errText,
  ], { class: 'asset', headerExtras: [err, fresh, remove] });
}
