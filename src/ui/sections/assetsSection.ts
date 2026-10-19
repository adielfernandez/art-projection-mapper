import { mediaKind } from '../../content/assetPool';
import { makeThumbnail } from '../../content/mediaLoader';
import type { ProjectController } from '../../io/projectController';
import type { Store } from '../../state/store';
import { Binder, button, checkboxRow, h, section, textRow } from '../controls';
import type { PanelContext } from './context';

const THUMB_PX = 96;

/**
 * Assets: manifests (grouped), each asset editable live. Save overwrites every
 * modified manifest; nothing is written otherwise.
 */
export function assetsSection(ctx: PanelContext): HTMLElement {
  const { store, project, binder } = ctx;

  const save = button('Save', () => void project.saveAssets(), 'primary');
  save.title = 'Overwrite every modified manifest file';
  const message = h('div', { class: 'message' });
  const list = h('div', { class: 'manifests' });
  const listBinder = new Binder();
  const thumbs = new ThumbnailQueue(store, project);
  let signature = '';

  const rebuild = () => {
    const sig = store.manifests.map((m) => `${m.path}:${m.error ?? ''}:${m.assets.map((a) => a.uid).join('.')}`).join('|');
    if (sig === signature) return;
    signature = sig;
    listBinder.clear();
    thumbs.clear();
    if (store.manifests.length === 0) {
      const hint = store.runtime.folderName
        ? 'No asset manifests are listed in config.json ("assetManifests").'
        : 'Open a project folder to load its asset manifests.';
      list.replaceChildren(h('div', { class: 'muted', text: hint }));
      return;
    }
    list.replaceChildren(...store.manifests.map((m) => manifestGroup(ctx, listBinder, thumbs, m.path)));
  };

  binder.add(() => {
    const rt = store.runtime;
    save.disabled = !rt.assetsDirty;
    save.classList.toggle('attention', rt.assetsDirty);
    const m = rt.assetMessage;
    message.hidden = !m;
    message.className = `message ${m?.kind ?? ''}`;
    message.textContent = m?.text ?? '';
    rebuild();
    listBinder.syncAll();
  });

  return section(ctx.openState, 'assets', 'Assets', [h('div', { class: 'button-row' }, [save]), message, list]);
}

function manifestGroup(ctx: PanelContext, b: Binder, thumbs: ThumbnailQueue, path: string): HTMLElement {
  const { store } = ctx;
  const manifest = () => store.manifests.find((m) => m.path === path);
  const m = manifest()!;

  const count = h('span', { class: 'badge' });
  const modified = h('span', { class: 'badge modified', text: 'modified' });
  const failed = h('span', { class: 'badge error' });
  b.add(() => {
    const cur = manifest();
    if (!cur) return;
    const errs = cur.assets.filter((a) => store.runtime.assetErrors[a.uid] !== undefined).length;
    count.textContent = `${cur.assets.length}`;
    modified.hidden = !cur.dirty;
    failed.hidden = !cur.error && errs === 0;
    failed.textContent = cur.error ? 'error' : `${errs} failed`;
  });

  const body: HTMLElement[] = [];
  if (m.error) body.push(h('div', { class: 'warning', text: `Manifest not loaded: ${m.error}` }));
  if (m.warnings.length) {
    body.push(h('div', { class: 'message warn' }, [
      h('div', { text: 'Some entries had problems:' }),
      h('ul', {}, m.warnings.map((w) => h('li', { text: w }))),
    ]));
  }
  for (const a of m.assets) body.push(assetItem(ctx, b, thumbs, a.uid));
  if (!m.error && m.assets.length === 0) body.push(h('div', { class: 'muted', text: 'No assets.' }));

  const details = section(ctx.openState, `manifest:${path}`, h('span', { class: 'title' }, [h('span', { class: 'asset-name', text: path })]), body, {
    headerExtras: [failed, modified, count],
    class: m.error ? 'manifest broken' : 'manifest',
  });
  // Thumbnails load lazily, when the group is first opened.
  const requestThumbs = () => {
    if (details.open) for (const a of m.assets) thumbs.request(a.uid);
  };
  details.addEventListener('toggle', requestThumbs);
  requestThumbs();
  return details;
}

function assetItem(ctx: PanelContext, b: Binder, thumbs: ThumbnailQueue, uid: string): HTMLElement {
  const { store } = ctx;
  const entry = () => store.findAsset(uid)?.entry;
  const thumb = thumbs.slot(uid);
  const name = h('span', { class: 'asset-name' });
  const err = h('span', { class: 'badge error', text: 'failed' });
  const errText = h('div', { class: 'warning' });

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
    errText,
  ], { class: 'asset', headerExtras: [err] });
}

/** Generates thumbnails one at a time (decoding happens in the worker). */
class ThumbnailQueue {
  private slots = new Map<string, HTMLElement>();
  private done = new Set<string>();
  private queue: string[] = [];
  private running = false;
  private generation = 0;

  constructor(
    private store: Store,
    private project: ProjectController,
  ) {}

  slot(uid: string): HTMLElement {
    const el = h('span', { class: 'thumb' });
    this.slots.set(uid, el);
    return el;
  }

  clear(): void {
    this.generation++;
    this.slots.clear();
    this.done.clear();
    this.queue.length = 0;
  }

  request(uid: string, force = false): void {
    if (force) this.done.delete(uid);
    if (this.done.has(uid) || this.queue.includes(uid)) return;
    this.queue.push(uid);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    while (this.queue.length && gen === this.generation) {
      const uid = this.queue.shift()!;
      this.done.add(uid);
      const el = this.slots.get(uid);
      if (!el) continue;
      const found = this.store.findAsset(uid);
      const kind = found ? mediaKind(found.entry.filepath) : null;
      if (!found || !kind) {
        el.replaceChildren('?');
        continue;
      }
      try {
        const file = await this.project.getMediaFile(found.manifest.path, found.entry.filepath);
        const canvas = await makeThumbnail(file, kind, THUMB_PX);
        if (gen === this.generation) el.replaceChildren(canvas);
      } catch {
        if (gen === this.generation) el.replaceChildren('✕');
      }
    }
    this.running = false;
    if (this.queue.length) void this.pump();
  }
}
