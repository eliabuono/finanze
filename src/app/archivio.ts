/** Archivio locale (IndexedDB): i file di dati come testo, più alcune informazioni di servizio. */
const DB = "finanze";
const STORE = "file";

let dbP: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbP ??= new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  return dbP;
}

function tx<T>(modo: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((ok, ko) => {
    const t = d.transaction(STORE, modo);
    const r = f(t.objectStore(STORE));
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }));
}

export const leggi = <T = string>(k: string) => tx<T | undefined>("readonly", (s) => s.get(k) as IDBRequest<T | undefined>);
export const scrivi = (k: string, v: unknown) => tx("readwrite", (s) => s.put(v, k));
export const cancella = (k: string) => tx("readwrite", (s) => s.delete(k));
export const chiavi = () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());

/** Chiede al browser di non cancellare i dati quando lo spazio scarseggia. */
export async function persistente() {
  try { await navigator.storage?.persist?.(); } catch { /* facoltativo */ }
}
