/**
 * Bytes the page has already verified, kept by digest for this page and,
 * where the browser allows it, in IndexedDB for the next visit.
 *
 * A cache is only a faster source of bytes: whatever it returns goes through
 * every check a network response does. A file is kept under the SHA-256 the
 * receipt names for it and is hashed again when read, so a stored copy that
 * differs is dropped, never shown. A receipt is kept under the artifact
 * digest the manifest names for it, and every receipt check is run on the
 * cached copy as on a fetched one. Nothing unverified is stored, and the
 * manifest is never stored. Storage that is missing, full, blocked or slow
 * is skipped silently: the page then fetches as it would without it.
 */

import { sha256Hex } from "./digest";

const DB_NAME = "uk-autumn-budget-2026-verified";
const STORE = "bytes";
// Entries older than this are dropped on a later visit; a file still in use
// is fetched and kept again
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A store that has not opened by then is treated as missing
const OPEN_TIMEOUT_MS = 400;

// Kept in memory per source of bytes (the fetch the page loads with), so a
// test's stand-in server, or a second one, never reads another's copies
let memories = new WeakMap();
const GLOBAL_SCOPE = {};
function memoryFor(scope) {
  const key = scope !== null && (typeof scope === "object" || typeof scope === "function") ? scope : GLOBAL_SCOPE;
  if (!memories.has(key)) memories.set(key, new Map());
  return memories.get(key);
}
let opening = null;
let enabled = true;

function openStore() {
  if (!enabled) return Promise.resolve(null);
  if (opening) return opening;
  opening = new Promise((resolve) => {
    let settled = false;
    const done = (db) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return done(null);
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        try {
          request.result.createObjectStore(STORE);
        } catch {
          // An existing store: nothing to do
        }
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
      setTimeout(() => done(null), OPEN_TIMEOUT_MS);
    } catch {
      done(null);
    }
  });
  return opening;
}

function storeRequest(mode, act) {
  return openStore().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = act(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value);
  return null;
}

async function storedBytes(scope, key) {
  const memory = memoryFor(scope);
  if (memory.has(key)) return memory.get(key);
  const record = await storeRequest("readonly", (store) => store.get(key));
  return asBytes(record?.bytes);
}

function keep(scope, key, bytes) {
  memoryFor(scope).set(key, bytes);
  storeRequest("readwrite", (store) => store.put({ bytes: bytes.slice().buffer, stored: Date.now() }, key));
}

/**
 * A file's bytes kept under its SHA-256, hashed again before they are
 * returned; null when none are kept or the kept ones differ.
 */
export async function cachedFile(digest, scope) {
  try {
    const bytes = await storedBytes(scope, `file:${digest}`);
    if (!bytes) return null;
    if ((await sha256Hex(bytes)) === digest) {
      memoryFor(scope).set(`file:${digest}`, bytes);
      return bytes;
    }
    forget(`file:${digest}`, scope);
  } catch {
    // Unreadable storage: fetch instead
  }
  return null;
}

/** Keep a file's bytes, already checked against `digest`. */
export function rememberFile(digest, bytes, scope) {
  try {
    keep(scope, `file:${digest}`, bytes);
  } catch {
    // Storage is a convenience only
  }
}

/**
 * The receipt bytes kept for an artifact digest, or null. The caller runs
 * every receipt check on them, as on a fetched receipt.
 */
export async function cachedReceipt(artifactDigest, scope) {
  try {
    return await storedBytes(scope, `receipt:${artifactDigest}`);
  } catch {
    return null;
  }
}

/** Keep a receipt's bytes once every check on it has passed. */
export function rememberReceipt(artifactDigest, bytes, scope) {
  try {
    keep(scope, `receipt:${artifactDigest}`, bytes);
  } catch {
    // Storage is a convenience only
  }
}

/** Drop a kept entry (a receipt or file that failed its checks). */
export function forget(key, scope) {
  memoryFor(scope).delete(key);
  storeRequest("readwrite", (store) => store.delete(key)).catch(() => {});
}

/** Drop a receipt kept for an artifact digest. */
export function forgetReceipt(artifactDigest, scope) {
  forget(`receipt:${artifactDigest}`, scope);
}

/** Drop stored entries older than a month, when the page is idle. */
export function pruneVerifiedCache(now = Date.now()) {
  return openStore().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(0);
        let dropped = 0;
        try {
          const transaction = db.transaction(STORE, "readwrite");
          const cursorRequest = transaction.objectStore(STORE).openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            if (!(now - (cursor.value?.stored ?? 0) < MAX_AGE_MS)) {
              cursor.delete();
              dropped += 1;
            }
            cursor.continue();
          };
          transaction.oncomplete = () => resolve(dropped);
          transaction.onerror = () => resolve(dropped);
          transaction.onabort = () => resolve(dropped);
        } catch {
          resolve(dropped);
        }
      }),
  );
}

/**
 * Forget everything kept in memory and stop using IndexedDB until the next
 * call (tests, which tamper with bytes under the same digests).
 */
export function resetVerifiedCache({ storage = false } = {}) {
  memories = new WeakMap();
  opening = null;
  enabled = storage;
}
