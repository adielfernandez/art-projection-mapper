/**
 * Remembers the last project folder's directory handle in IndexedDB.
 * This is a pointer to the folder only, not saved project state.
 */

const DB_NAME = 'art-projection-mapper';
const STORE = 'handles';
const KEY = 'lastProjectFolder';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const h = await withStore<unknown>('readonly', (s) => s.get(KEY));
    return h instanceof FileSystemDirectoryHandle ? h : null;
  } catch {
    return null;
  }
}

export async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(handle, KEY));
  } catch (err) {
    console.warn('Could not remember project folder', err);
  }
}
