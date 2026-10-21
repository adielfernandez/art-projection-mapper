/**
 * Project folder access via the File System Access API. All reads and writes go
 * through the folder's directory handle, using paths relative to the folder root.
 */

export function isFileSystemAccessSupported(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

/** Prompt the user for a project folder. Returns null if they cancel. */
export async function pickProjectFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ id: 'art-projection-project', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/** A file to import: a handle (from the picker or a drop) or a plain File (drop fallback). */
export type ImportSource = FileSystemFileHandle | File;

const IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const VIDEO_TYPES = ['.mp4', '.webm'];

/** Prompt for images and videos, starting in the project folder. Returns [] if cancelled. */
export async function pickMediaFiles(startIn?: FileSystemDirectoryHandle): Promise<FileSystemFileHandle[]> {
  try {
    return await window.showOpenFilePicker({
      id: 'art-projection-media',
      multiple: true,
      ...(startIn ? { startIn } : {}),
      types: [{ description: 'Images and videos', accept: { 'image/*': IMAGE_TYPES, 'video/*': VIDEO_TYPES } }],
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return [];
    throw err;
  }
}

/**
 * Files dropped from the OS. Call synchronously inside the drop handler: the browser only
 * hands out the items during the event. Folders are skipped and named in `skipped`.
 */
export function sourcesFromDrop(dt: DataTransfer): Promise<{ sources: ImportSource[]; skipped: string[] }> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const pending = items.map((item) => {
    const file = item.getAsFile();
    const handle = item.getAsFileSystemHandle?.() ?? Promise.resolve(null);
    return { file, handle };
  });
  return (async () => {
    const sources: ImportSource[] = [];
    const skipped: string[] = [];
    for (const { file, handle } of pending) {
      const h = await handle.catch(() => null);
      if (h?.kind === 'directory') skipped.push(`${h.name}: folders can't be added; drop the files inside it`);
      else if (h?.kind === 'file') sources.push(h as FileSystemFileHandle);
      else if (file) sources.push(file);
    }
    return { sources, skipped };
  })();
}

/** Ensure read/write permission; must be called from a user gesture if not already granted. */
export async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

/** Split a relative path into directory segments and a file name, resolving `.` and `..`. */
export function splitPath(path: string): { dirs: string[]; name: string } {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.endsWith('/')) throw new Error(`Invalid file path: "${path}"`);
  const parts: string[] = [];
  for (const seg of normalized.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) throw new Error(`Path escapes the project folder: ${path}`);
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const name = parts.pop();
  if (!name) throw new Error(`Invalid file path: "${path}"`);
  return { dirs: parts, name };
}

export async function getFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const { dirs, name } = splitPath(path);
  let dir = root;
  for (const d of dirs) dir = await dir.getDirectoryHandle(d, { create });
  return dir.getFileHandle(name, { create });
}

/** Read and parse a JSON file, or return null if it does not exist. */
export async function readJsonIfExists(root: FileSystemDirectoryHandle, path: string): Promise<unknown> {
  let handle: FileSystemFileHandle;
  try {
    handle = await getFileHandle(root, path);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')) return null;
    throw err;
  }
  const text = await (await handle.getFile()).text();
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}

export async function fileExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    await getFileHandle(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Write text to a file, creating it (and parent folders) if needed. Only call from an explicit Save. */
export async function writeText(root: FileSystemDirectoryHandle, path: string, text: string): Promise<void> {
  await writeData(root, path, text);
}

/** Write text or file contents, creating the file (and parent folders) if needed. Only call from an explicit Save. */
export async function writeData(root: FileSystemDirectoryHandle, path: string, data: string | Blob): Promise<void> {
  const handle = await getFileHandle(root, path, true);
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } catch (err) {
    await writable.abort(); // leave the existing file untouched
    throw err;
  }
  await writable.close();
}
