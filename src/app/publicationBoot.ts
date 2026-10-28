/**
 * The publication, verified once at build time, for the page's first paint.
 *
 * The build reads the files this deployment serves from public/data and runs
 * them through the page's own loader (utils/loadDashboard.js
 * loadDashboardParts): the manifest's checks, every receipt check and every
 * file's SHA-256 against its receipt, exactly as the browser does. The
 * verified tables are baked into the static HTML, so the landing page and
 * every view's figures need no request before they paint.
 *
 * The browser still checks: once the opened view's code is in, App.jsx
 * loads the live manifest and every artifact through the same loader and
 * compares the result with what the build verified. A figure that differs,
 * or a check that fails, withdraws the build's figures (App.jsx
 * reverifyBoot). With no manifest, or one the build cannot verify, nothing
 * is baked in and the page loads as before.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { loadDashboardParts } from '@/utils/publication/parts';

const DATA = join(process.cwd(), 'public', 'data');
const PREFIX = '/data/';

// The files under public/data, served as the page's fetch would get them
async function readPublished(url: string): Promise<Response> {
  if (!url.startsWith(PREFIX)) return new Response(null, { status: 404 });
  const path = resolve(DATA, decodeURIComponent(url.slice(PREFIX.length)));
  if (!path.startsWith(DATA + sep)) return new Response(null, { status: 404 });
  try {
    return new Response(await readFile(path), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}

// The loader keys its results on objects with no prototype; a Client
// Component's props must be plain objects. Values are kept as they are.
function plain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, plain(member)]));
  }
  return value;
}

export type PublicationBoot = Awaited<ReturnType<typeof loadDashboardParts>>;

let boot: Promise<PublicationBoot | null> | null = null;

/** The build-verified publication, or null for none (the page then loads it). */
export function publicationBoot(): Promise<PublicationBoot | null> {
  if (process.env.AB26_NO_BOOT === '1') return Promise.resolve(null);
  boot ??= loadDashboardParts('', { fetchImpl: readPublished as typeof fetch }).then(
    (parts) => (parts.status === 'ready' ? (plain(parts) as PublicationBoot) : null),
    (error) => {
      // A manifest the build cannot verify is left for the page to report
      console.warn(`publication boot: not baked in (${error?.message ?? error})`);
      return null;
    },
  );
  return boot;
}
