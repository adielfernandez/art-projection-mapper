import { defaultConfig } from '../state/defaults';
import type { Store } from '../state/store';
import { mediaKind } from '../content/assetPool';
import type { Config, ManifestRecord } from '../state/schema';
import { CONFIG_PATH, loadConfig, saveConfig } from './configIO';
import { getMediaFile, loadManifests, saveManifest } from './manifestIO';
import { loadStoredHandle, storeHandle } from './handleStore';
import { ensurePermission, fileExists, isFileSystemAccessSupported, pickProjectFolder } from './projectFolder';

/** Asks the user to confirm a risky action; resolves true to proceed. */
export type ConfirmFn = (message: string, confirmLabel: string) => Promise<boolean>;

/**
 * Project folder lifecycle: open, reopen and save. Holds the directory handle;
 * all state changes go through store actions. Disk writes happen only in save().
 */
export class ProjectController {
  private root: FileSystemDirectoryHandle | null = null;
  private stored: FileSystemDirectoryHandle | null = null;
  /** Identifies the latest folder load; an older one that finishes later is discarded. */
  private loadToken = 0;

  constructor(private store: Store) {}

  get supported(): boolean {
    return isFileSystemAccessSupported();
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
        root = await pickProjectFolder();
        if (!root) return;
        if (
          (await fileExists(root, CONFIG_PATH)) &&
          !(await confirm(`"${root.name}" already has a ${CONFIG_PATH}. Overwrite it with the current setup?`, 'Overwrite'))
        ) {
          return;
        }
      } else if (!(await ensurePermission(root))) {
        this.store.setIoMessage({ kind: 'warn', text: 'Write permission was not granted; nothing saved.' });
        return;
      }
      await saveConfig(root, this.store.configSnapshot());
    } catch (err) {
      this.fail('Save failed', err);
      return;
    }
    if (this.root !== root) {
      this.root = root;
      this.stored = root;
      await storeHandle(root);
      this.store.setFolderName(root.name);
      this.store.setReopenName(root.name);
    }
    this.store.markConfigSaved();
    this.store.setIoMessage({ kind: 'info', text: `Saved ${CONFIG_PATH} at ${new Date().toLocaleTimeString()}.` });
  }

  /** Overwrite every modified manifest file. */
  async saveAssets(): Promise<void> {
    const root = this.root;
    if (!root) {
      this.store.setAssetMessage({ kind: 'warn', text: 'No project folder is open.' });
      return;
    }
    const dirty = this.store.manifests.filter((m) => m.dirty && !m.error).map((m) => m.path);
    if (dirty.length === 0) return;
    try {
      if (!(await ensurePermission(root))) {
        this.store.setAssetMessage({ kind: 'warn', text: 'Write permission was not granted; nothing saved.' });
        return;
      }
      for (const path of dirty) {
        const snap = this.store.manifestSnapshot(path);
        if (!snap) continue;
        await saveManifest(root, snap);
        this.store.markManifestSaved(path);
      }
      this.store.setAssetMessage({ kind: 'info', text: `Saved ${dirty.join(', ')} at ${new Date().toLocaleTimeString()}.` });
    } catch (err) {
      console.error('Asset save failed', err);
      this.store.setAssetMessage({ kind: 'error', text: `Save failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** Media file for an asset, resolved relative to its manifest. */
  async getMediaFile(manifestPath: string, filepath: string): Promise<File> {
    if (!this.root) throw new Error('No project folder is open.');
    try {
      return await getMediaFile(this.root, manifestPath, filepath);
    } catch (err) {
      throw mediaFileError(err, filepath);
    }
  }

  /** Read every manifest and flag missing files and unsupported types, without touching the store. */
  private async readAssets(root: FileSystemDirectoryHandle, config: Config): Promise<{ manifests: ManifestRecord[]; errors: Map<string, string> }> {
    const manifests = await loadManifests(root, config.assetManifests);
    const errors = new Map<string, string>();
    await Promise.all(
      manifests.flatMap((m) =>
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
    return { manifests, errors };
  }

  private async loadFrom(handle: FileSystemDirectoryHandle): Promise<void> {
    const { w, h } = this.store.runtime.viewport;
    const token = ++this.loadToken;
    try {
      // Read everything first: switching the folder before the new manifests are in would let
      // the scheduler load the previous project's assets from the new folder.
      const result = await loadConfig(handle, w / h);
      const config = result?.config ?? defaultConfig(w / h);
      const assets = await this.readAssets(handle, config);
      await storeHandle(handle);
      if (token !== this.loadToken) return; // another folder was opened meanwhile

      // Apply in one tick, so subscribers see config and assets change together.
      this.root = handle;
      this.stored = handle;
      this.store.setReopenName(handle.name);
      this.store.replaceConfig(config, handle.name);
      this.store.setIoMessage(
        !result
          ? { kind: 'info', text: `No ${CONFIG_PATH} yet; showing the default project. Save creates it.` }
          : result.warnings.length
            ? { kind: 'warn', text: `Loaded with ${result.warnings.length} problem(s); defaults were used for:`, details: result.warnings }
            : { kind: 'info', text: `Loaded ${CONFIG_PATH}.` },
      );
      this.store.setManifests(assets.manifests);
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
