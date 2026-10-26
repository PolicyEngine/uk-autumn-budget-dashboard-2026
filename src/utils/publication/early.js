/**
 * The manifest request, started by an inline script in the document head so
 * it runs while the page's JavaScript downloads, instead of after it has
 * loaded and hydrated. The loader adopts that response once, and checks it
 * as it checks any other: this only moves the request earlier.
 */

import { MANIFEST_FILE } from "./manifest";

const GLOBAL = "__ab26EarlyManifest";

/** The manifest's URL under a base path. */
export function manifestUrl(basePath) {
  return `${basePath}/data/${MANIFEST_FILE}`;
}

/**
 * The inline script: one fetch, with the loader's own options (always
 * fresh), whose failure is left for the loader to retry.
 */
export function earlyManifestScript(basePath) {
  const url = JSON.stringify(manifestUrl(basePath));
  return (
    `(function(){try{var p=fetch(${url},{cache:"no-cache"});` +
    `p.catch(function(){});window.${GLOBAL}={url:${url},response:p};}catch(e){}})();`
  );
}

/**
 * The early response for `url`, once; null when there is none (a test, a
 * second load, a blocked script).
 */
export function takeEarlyManifest(url) {
  try {
    const early = globalThis.window?.[GLOBAL];
    if (!early || early.url !== url || !early.response) return null;
    const response = early.response;
    early.response = null;
    return response;
  } catch {
    return null;
  }
}
