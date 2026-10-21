import { defaultConfig } from '../state/defaults';
import type { Store } from '../state/store';
import { mediaKind } from '../content/selection';
import type { AssetRecord, Config, PoolRecord } from '../state/schema';
import { CONFIG_PATH, loadConfig, saveConfig } from './configIO';
import {
  getMediaFile,
  loadPools,
  newAssetRecord,
  newPoolRecord,
  numberedName,
  poolPathFromName,
  relativeMediaPath,
  resolveMediaPath,
  savePool,
} from './poolIO';
import { loadStoredHandle, storeHandle } from './handleStore';
import {
  ensurePermission,
  fileExists,
  isFileSystemAccessSupported,
  pickMediaFiles,
  pickProjectFolder,
  sourcesFromDrop,
  writeData,
  type ImportSource,
} from './projectFolder';

/** Asks the user to confirm a risky action; resolves true to proceed. */
export type ConfirmFn = (message: string, confirmLabel: string) => Promise<boolean>;

/** Outcome of adding files to an asset pool. */
export interface ImportResult {
  /** Asset uids for the files, in order: new assets, or existing ones already listing that file. */
  uids: string[];
  added: number;
  /** Files the pool already listed, so no new asset was made. */
  reused: number;
  /** Files that were not added, with the reason. */
  skipped: string[];
}

/** Media files copy into this folder, next to the pool file that lists them. */
const MEDIA_DIR = 'media';
/** New files go into this pool when the show has none yet. */
const DEFAULT_POOL_NAME = 'assets';

/**
 * Project folder lifecycle: open, reopen and save. Holds the directory handle;
 * all state changes go through store actions. Disk writes happen only in save().
 */
export class ProjectController {
  private root: FileSystemDirectoryHandle | null = null;
  private stored: FileSystemDirectoryHandle | null = null;
  /** Identifies the latest folder load; an older one that finishes later is discarded. */
  private loadToken = 0;
  /**
   * Files added from outside the project folder, by asset uid. They play from memory and
   * are copied into the folder when their pool is saved (never before: disk writes only on Save).
   */
  private staged = new Map<string, File>();

  constructor(private store: Store) {}

  get supported(): boolean {
    return isFileSystemAccessSupported();
  }

  /** The asset's file was added from outside the folder and is copied on the next pool save. */
  isStaged(uid: string): boolean {
    return this.staged.has(uid);
  }

  /** On launch: look up the remembered folder so the panel can offer "Reopen". */
  async init(): Promise<void> {
    if (!this.supported) {
      this.store.setIoMessage({ kind: 'error', text: 'This browser lacks the File System Access API. Use desktop Chrome.' });
      return;
    }
    this.stored = await loadStoredHandle();
    this.store.setReopenName(this.stored?.name ?? null);
  }

  /** Reopen the remembered folder. Must run from a user gesture (permission prompt). */
  async reopen(confirm: ConfirmFn): Promise<void> {
    if (this.stored) await this.openHandle(this.stored, confirm);
  }

  /** Open a specific folder handle (requests permission if needed). */
  async openHandle(handle: FileSystemDirectoryHandle, confirm: ConfirmFn): Promise<void> {
    if (!(await this.confirmDiscard(confirm))) return;
    try {
      if (!(await ensurePermission(handle))) {
        this.store.setIoMessage({ kind: 'warn', text: `Permission to "${handle.name}" was not granted.` });
        return;
      }
    } catch (err) {
      this.fail('Could not reopen the folder', err);
      return;
    }
    await this.loadFrom(handle);
  }

  /** Pick a project folder and load it. Must run from a user gesture. */
  async open(confirm: ConfirmFn): Promise<void> {
    if (!(await this.confirmDiscard(confirm))) return;
    let handle: FileSystemDirectoryHandle | null;
    try {
      handle = await pickProjectFolder();
    } catch (err) {
      this.fail('Could not open the folder', err);
      return;
    }
    if (handle) await this.loadFrom(handle);
  }

  /** Write config.json. With no folder open, asks for one first. */
  async save(confirm: ConfirmFn): Promise<void> {
    let root = this.root;
    try {
      if (!root) {
        root = await this.chooseFolder(confirm, [CONFIG_PATH]);
        if (!root) return;
      } else if (!(await ensurePermission(root))) {
        this.store.setIoMessage({ kind: 'warn', text: 'Write permission was not granted; nothing saved.' });
        return;
      }
      await saveConfig(root, this.store.configSnapshot());
    } catch (err) {
      this.fail('Save failed', err);
      return;
    }
    await this.adoptFolder(root);
    this.store.markConfigSaved();
    const pending = this.store.runtime.assetsDirty ? ' Content changes are not saved yet: use Save Asset Pool in the Assets section.' : '';
    this.store.setIoMessage({ kind: 'info', text: `Saved ${CONFIG_PATH} at ${new Date().toLocaleTimeString()}.${pending}` });
  }

  /**
   * A new show has no folder yet: ask for one on its first save, confirming before
   * overwriting any of `paths` that already exist there.
   */
  private async chooseFolder(confirm: ConfirmFn, paths: readonly string[]): Promise<FileSystemDirectoryHandle | null> {
    const root = await pickProjectFolder();
    if (!root) return null;
    const taken: string[] = [];
    for (const p of paths) if (await fileExists(root, p)) taken.push(p);
    if (taken.length && !(await confirm(`"${root.name}" already has ${taken.join(', ')}. Overwrite with this show's version?`, 'Overwrite'))) {
      return null;
    }
    return root;
  }

  /** Make a folder chosen while saving the show's folder from now on (and the one offered by Reopen Show). */
  private async adoptFolder(root: FileSystemDirectoryHandle): Promise<void> {
    if (this.root === root) return;
    this.root = root;
    this.stored = root;
    await storeHandle(root);
    this.store.setFolderName(root.name);
    this.store.setReopenName(root.name);
  }

  /** Save every modified asset pool ("Save All Assets"). */
  async saveAllAssets(confirm: ConfirmFn): Promise<void> {
    await this.savePools(this.store.pools.filter((m) => m.dirty && !m.error).map((m) => m.path), confirm);
  }

  /** Save one asset pool ("Save Asset Pool"): copy its new files into the folder, then write the pool file. */
  async savePool(path: string, confirm: ConfirmFn): Promise<void> {
    await this.savePools([path], confirm);
  }

  private async savePools(paths: readonly string[], confirm: ConfirmFn): Promise<void> {
    if (paths.length === 0) return;
    let root = this.root;
    try {
      if (!root) {
        root = await this.chooseFolder(confirm, paths);
        if (!root) return;
        await this.adoptFolder(root);
      } else if (!(await ensurePermission(root))) {
        this.store.setAssetMessage({ kind: 'warn', text: 'Write permission was not granted; nothing saved.' });
        return;
      }
      let copied = 0;
      for (const path of paths) {
        await this.renameTakenStaged(root, path);
        const snap = this.store.poolSnapshot(path);
        if (!snap) continue;
        copied += await this.copyStaged(root, snap);
        await savePool(root, snap);
        this.store.markPoolSaved(path);
      }
      const files = copied ? ` and copied ${copied} file${copied === 1 ? '' : 's'}` : '';
      const show = this.store.runtime.configDirty ? ' Use Save Show to save the rest of the show.' : '';
      this.store.setAssetMessage({ kind: 'info', text: `Saved ${paths.join(', ')}${files} at ${new Date().toLocaleTimeString()}.${show}` });
    } catch (err) {
      console.error('Asset save failed', err);
      this.store.setAssetMessage({ kind: 'error', text: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /**
   * A staged file whose path is already taken in the folder (chosen after it was added, or
   * changed meanwhile) gets the next free numbered name; playlists follow the rename.
   */
  private async renameTakenStaged(root: FileSystemDirectoryHandle, poolPath: string): Promise<void> {
    const pool = this.store.pools.find((m) => m.path === poolPath);
    for (const a of pool?.assets ?? []) {
      if (!this.staged.has(a.uid) || !(await fileExists(root, resolveMediaPath(poolPath, a.entry.filepath)))) continue;
      const slash = a.entry.filepath.lastIndexOf('/');
      const dir = slash >= 0 ? a.entry.filepath.slice(0, slash) : '';
      const name = a.entry.filepath.slice(slash + 1);
      this.store.updateAsset(a.uid, { filepath: await this.freeMediaPath(root, poolPath, dir, name, [], a.uid) });
    }
  }

  /** Copy a pool's staged files to their paths. Never overwrites an existing file. */
  private async copyStaged(root: FileSystemDirectoryHandle, pool: PoolRecord): Promise<number> {
    let copied = 0;
    for (const a of pool.assets) {
      const file = this.staged.get(a.uid);
      if (!file) continue;
      const dest = resolveMediaPath(pool.path, a.entry.filepath);
      if (await fileExists(root, dest)) throw new Error(`${dest} already exists; nothing was overwritten.`);
      await writeData(root, dest, file);
      this.staged.delete(a.uid);
      copied++;
    }
    // Drop files for assets that were removed before being saved.
    for (const uid of [...this.staged.keys()]) if (!this.store.findAsset(uid)) this.staged.delete(uid);
    return copied;
  }

  /** Choose files with the browser's file picker and add them to a pool (null: the default pool). */
  async pickAndImport(poolPath: string | null): Promise<ImportResult | null> {
    let handles: FileSystemFileHandle[];
    try {
      handles = await pickMediaFiles(this.root ?? undefined);
    } catch (err) {
      this.store.setAssetMessage({ kind: 'error', text: `Could not open the file picker: ${err instanceof Error ? err.message : String(err)}` });
      return null;
    }
    if (!handles.length) return null;
    const target = poolPath ?? (await this.defaultPool());
    return target ? this.importFiles(target, handles) : null;
  }

  /** Add files dropped from the OS to a pool (null: the default pool). Call synchronously from the drop handler. */
  importDrop(poolPath: string | null, dt: DataTransfer): Promise<ImportResult | null> {
    const dropped = sourcesFromDrop(dt);
    return (async () => {
      const { sources, skipped } = await dropped;
      const target = poolPath ?? (await this.defaultPool());
      return target ? this.importFiles(target, sources, skipped) : null;
    })();
  }

  /** Where new files go when no pool was chosen: the first usable pool, or a new "assets.json". */
  private async defaultPool(): Promise<string | null> {
    const usable = () => this.store.pools.find((m) => !m.error)?.path ?? null;
    if (usable()) return usable();
    const err = await this.addPool(DEFAULT_POOL_NAME);
    if (err) this.store.setAssetMessage({ kind: 'warn', text: err });
    return usable();
  }

  /**
   * Add files to a pool. A file already inside the project folder is listed by its path; any
   * other file is held in memory under `media/` next to the pool and copied there on save.
   * A file the pool already lists is reused instead of added twice.
   */
  async importFiles(poolPath: string, sources: readonly ImportSource[], skipped: readonly string[] = []): Promise<ImportResult> {
    const result: ImportResult = { uids: [], added: 0, reused: 0, skipped: [...skipped] };
    const root = this.root; // null for a new show: every file is staged
    const pool = this.store.pools.find((m) => m.path === poolPath);
    if (!pool || pool.error) {
      result.skipped.push(`Asset pool ${poolPath} can't be edited.`);
      return this.reportImport(poolPath, result);
    }
    const records: AssetRecord[] = [];
    const listed = (filepath: string) =>
      pool.assets.find((a) => a.entry.filepath === filepath)?.uid ?? records.find((r) => r.entry.filepath === filepath)?.uid;
    for (const src of sources) {
      try {
        const file = src instanceof File ? src : await src.getFile();
        if (!mediaKind(file.name)) {
          result.skipped.push(`${file.name}: not a supported image or video (.jpg .jpeg .png .webp .avif .mp4 .webm)`);
          continue;
        }
        const inside = src instanceof File || !root ? null : await root.resolve(src);
        if (inside) {
          const filepath = relativeMediaPath(poolPath, inside);
          const existing = listed(filepath);
          if (existing) {
            result.uids.push(existing);
            result.reused++;
            continue;
          }
          const rec = newAssetRecord(filepath);
          records.push(rec);
          result.uids.push(rec.uid);
        } else {
          const rec = newAssetRecord(await this.freeMediaPath(root, poolPath, MEDIA_DIR, file.name, records));
          records.push(rec);
          result.uids.push(rec.uid);
          this.staged.set(rec.uid, file);
        }
        result.added++;
      } catch (err) {
        result.skipped.push(`${src.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.store.addAssets(poolPath, records);
    return this.reportImport(poolPath, result);
  }

  /** A `<dir>/<name>` path (relative to the pool) that no file on disk or other pending copy uses. */
  private async freeMediaPath(
    root: FileSystemDirectoryHandle | null,
    poolPath: string,
    dir: string,
    name: string,
    batch: readonly AssetRecord[],
    exceptUid?: string,
  ): Promise<string> {
    // Compared without case: on Windows and macOS "A.png" and "a.png" are the same file.
    const key = (pool: string, filepath: string) => resolveMediaPath(pool, filepath).toLowerCase();
    const pendingPaths = new Set(batch.map((r) => key(poolPath, r.entry.filepath)));
    for (const uid of this.staged.keys()) {
      const found = uid === exceptUid ? null : this.store.findAsset(uid);
      if (found) pendingPaths.add(key(found.pool.path, found.entry.filepath));
    }
    for (let n = 1; ; n++) {
      const filepath = `${dir ? `${dir}/` : ''}${numberedName(name, n)}`;
      if (pendingPaths.has(key(poolPath, filepath))) continue;
      if (!root || !(await fileExists(root, resolveMediaPath(poolPath, filepath)))) return filepath;
    }
  }

  private reportImport(poolPath: string, r: ImportResult): ImportResult {
    const parts: string[] = [];
    if (r.added) parts.push(`Added ${r.added} file${r.added === 1 ? '' : 's'} to ${poolPath}. Save the asset pool to keep ${r.added === 1 ? 'it' : 'them'}.`);
    if (r.reused) parts.push(`${r.reused} ${r.reused === 1 ? 'was' : 'were'} already in ${poolPath}.`);
    if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.join('; ')}`);
    if (parts.length) this.store.setAssetMessage({ kind: r.skipped.length ? 'warn' : 'info', text: parts.join(' ') });
    return r;
  }

  /**
   * Add an asset pool to the show by name. An existing file of that name is loaded; otherwise
   * a new empty pool is created (written on its first save). Returns an error message, or null.
   */
  async addPool(name: string): Promise<string | null> {
    const root = this.root; // null for a new show: the pool is created and written on its first save
    let path: string;
    try {
      path = poolPathFromName(name);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    // Windows and macOS file names ignore case, so "Art.json" and "art.json" are one file.
    const same = this.store.pools.find((m) => m.path.toLowerCase() === path.toLowerCase());
    if (same) return `${same.path} is already in this show.`;
    try {
      if (root && (await fileExists(root, path))) {
        const [loaded] = await loadPools(root, [path]);
        if (!loaded || loaded.error) return `${path} exists but could not be read: ${loaded?.error ?? 'unknown error'}`;
        this.store.addPool(loaded);
        this.store.setAssetMessage({ kind: 'info', text: `Added the existing ${path}. Save Show to keep it in the show.` });
      } else {
        this.store.addPool(newPoolRecord(path));
        this.store.setAssetMessage({ kind: 'info', text: `Created ${path}. Save Asset Pool to write it, and Save Show to keep it in the show.` });
      }
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    return null;
  }

  /** Media file for an asset, resolved relative to its pool. Files not yet copied come from memory. */
  async getMediaFile(poolPath: string, filepath: string): Promise<File> {
    for (const [uid, file] of this.staged) {
      const found = this.store.findAsset(uid);
      if (found && found.pool.path === poolPath && found.entry.filepath === filepath) return file;
    }
    if (!this.root) throw new Error('No project folder is open.');
    try {
      return await getMediaFile(this.root, poolPath, filepath);
    } catch (err) {
      throw mediaFileError(err, filepath);
    }
  }

  /** Read every pool and flag missing files and unsupported types, without touching the store. */
  private async readAssets(root: FileSystemDirectoryHandle, config: Config): Promise<{ pools: PoolRecord[]; errors: Map<string, string> }> {
    const pools = await loadPools(root, config.assetPools);
    const errors = new Map<string, string>();
    await Promise.all(
      pools.flatMap((m) =>
        m.assets.map(async (a) => {
          if (!mediaKind(a.entry.filepath)) {
            errors.set(a.uid, 'Unsupported file type. Use .jpg .jpeg .png .webp .avif .mp4 .webm.');
            return;
          }
          try {
            await getMediaFile(root, m.path, a.entry.filepath);
          } catch (err) {
            errors.set(a.uid, mediaFileError(err, a.entry.filepath).message);
          }
        }),
      ),
    );
    return { pools, errors };
  }

  private async loadFrom(handle: FileSystemDirectoryHandle): Promise<void> {
    const { w, h } = this.store.runtime.viewport;
    const token = ++this.loadToken;
    try {
      // Read everything first: switching the folder before the new pools are in would let
      // the scheduler load the previous project's assets from the new folder.
      const result = await loadConfig(handle, w / h);
      const config = result?.config ?? defaultConfig(w / h);
      const assets = await this.readAssets(handle, config);
      await storeHandle(handle);
      if (token !== this.loadToken) return; // another folder was opened meanwhile

      // Apply in one tick, so subscribers see config and assets change together.
      this.staged.clear();
      this.root = handle;
      this.stored = handle;
      this.store.setReopenName(handle.name);
      this.store.replaceConfig(config, handle.name);
      if (!result) this.store.showAllTestPatterns(); // no config.json yet: a new show, ready for mapping
      this.store.setIoMessage(
        !result
          ? { kind: 'info', text: `No ${CONFIG_PATH} yet; showing the default project. Save creates it.` }
          : result.warnings.length
            ? { kind: 'warn', text: `Loaded with ${result.warnings.length} problem(s); defaults were used for:`, details: result.warnings }
            : { kind: 'info', text: `Loaded ${CONFIG_PATH}.` },
      );
      this.store.setPools(assets.pools);
      for (const [uid, msg] of assets.errors) this.store.setAssetError(uid, msg);
    } catch (err) {
      if (token === this.loadToken) this.fail(`Could not load "${handle.name}"`, err);
    }
  }

  private async confirmDiscard(confirm: ConfirmFn): Promise<boolean> {
    const { configDirty, assetsDirty } = this.store.runtime;
    if (!configDirty && !assetsDirty) return true;
    const what = configDirty && assetsDirty ? 'config and assets have' : configDirty ? 'config has' : 'assets have';
    return confirm(`The current ${what} unsaved changes. Discard them?`, 'Discard');
  }

  private fail(what: string, err: unknown): void {
    console.error(what, err);
    const msg = err instanceof Error ? err.message : String(err);
    this.store.setIoMessage({ kind: 'error', text: `${what}: ${msg}` });
  }
}

/** User-facing error for a media file that could not be opened. */
function mediaFileError(err: unknown, filepath: string): Error {
  if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) {
    return new Error(`File not found: ${filepath}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
