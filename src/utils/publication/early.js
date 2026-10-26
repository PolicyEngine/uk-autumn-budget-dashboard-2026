/**
 * The manifest request, started by an inline script in the document head so
 * it runs while the page's JavaScript downloads, instead of after it has
 * loaded and hydrated. The loader adopts that response once, and checks it
 * as it checks any other: this only moves the request earlier.
 */

import contract from "./contract.json";
import { DISPLAYABLE, MANIFEST_FILE, RECEIPT_FILE } from "./manifest";

// The files every view's first chart reads (load.js CATALOGUE_TABLES; the
// script requests each only if the receipt lists it)
export const EARLY_FILES = ["budgetary_impact", "distributional_impact", "winners_losers", "metrics", "poverty_inequality"].map((table) => contract.tables[table].file);
// A link to Young people or Pensioners also needs the age table at once
const AGE_FILE = contract.tables.age_impact.file;
const AGE_VIEWS = ["young", "pensioners"];
// A link to Household impact: its example households' precomputed answers
// (householdPresets.js), an unverified file it reads as before
export const PRESETS_URL_FILE = "household_presets.json";

const GLOBAL = "__ab26EarlyManifest";
const RECEIPTS = "__ab26EarlyReceipts";
// The artifact paths the head script will request a receipt under
export const EARLY_ARTIFACT = /^artifacts\/[A-Za-z0-9_.+-]+\/[0-9a-f]{16}$/;
// More combined runs than this and only the measures' receipts go early
const MAX_EARLY_COMBINED = 4;

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
  const data = JSON.stringify(`${basePath}/data/`);
  // Once the manifest is in, the receipts of the artifacts it shows are
  // requested too (a receipt is always the first file of an artifact read).
  // Nothing here is checked or shown: the loader adopts these responses and
  // checks them as it checks its own (takeEarlyResponse)
  return (
    `(function(){try{var p=fetch(${url},{cache:"no-cache"});` +
    `p.catch(function(){});window.${GLOBAL}={url:${url},response:p};` +
    `var r=window.${RECEIPTS}={},q=new URLSearchParams(location.search);` +
    `if(q.get("tab")==="household"){var h=${data}+${JSON.stringify(PRESETS_URL_FILE)};r[h]=fetch(h);r[h].catch(function(){});}` +
    `p.then(function(x){return x.ok?x.clone().json():null}).then(function(m){` +
    `if(!m)return;var ok=${JSON.stringify(DISPLAYABLE)},re=${EARLY_ARTIFACT.toString()},want=${JSON.stringify(EARLY_FILES)};` +
    `if(${JSON.stringify(AGE_VIEWS)}.indexOf(q.get("sub"))>=0)want=want.concat([${JSON.stringify(AGE_FILE)}]);` +
    // The first chart's files the receipt lists, while the page's code is
    // still loading: requested, never read, until the loader has checked
    // the receipt and hashes them against it
    `var files=function(b,q){q.then(function(x){return x.ok?x.clone().json():null}).then(function(c){` +
    `var l=c&&c.dashboard&&c.dashboard.files;if(!l)return;for(var i=0;i<want.length;i++){var f=want[i];` +
    `if(Object.prototype.hasOwnProperty.call(l,f)&&!r[b+f]){r[b+f]=fetch(b+f);r[b+f].catch(function(){});}}}).catch(function(){})};` +
    `var go=function(es){for(var k in es){var e=es[k];if(e&&ok.indexOf(e.status)>=0&&typeof e.artifact==="string"&&re.test(e.artifact)){` +
    `var b=${data}+e.artifact+"/",u=b+${JSON.stringify(RECEIPT_FILE)};if(!r[u]){r[u]=fetch(u);r[u].catch(function(){});files(b,r[u]);}}}};` +
    `go(m.measures);if(m.combined&&Object.keys(m.combined).length<=${MAX_EARLY_COMBINED})go(m.combined);` +
    `}).catch(function(){});}catch(e){}})();`
  );
}

/**
 * A response the head script requested for `url` (a receipt or one of the
 * first chart's files), once; null otherwise. The caller checks it as its
 * own: a receipt through every receipt check, a file against the digest
 * its verified receipt names.
 */
export function takeEarlyResponse(url) {
  try {
    const early = globalThis.window?.[RECEIPTS];
    if (!early || !Object.hasOwn(early, url) || !early[url]) return null;
    const response = early[url];
    early[url] = null;
    return response;
  } catch {
    return null;
  }
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
