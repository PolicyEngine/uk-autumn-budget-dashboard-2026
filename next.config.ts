import type { NextConfig } from 'next';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkHouseholdApiEnv } from './scripts/household-api-env.mjs';

/**
 * The version uv.lock pins for a Python package, or '' if it is not there.
 * The page's replication line shows these, read at build time from the
 * lockfile this build was made from.
 */
function lockedVersion(name: string): string {
  try {
    const lock = readFileSync(join(process.cwd(), 'uv.lock'), 'utf8');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = lock.match(
      new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`),
    );
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

/**
 * The files of results by area this build ships, comma-separated. The page
 * requests only these, so a table not yet published shows as such without a
 * 404 in the console.
 */
function publishedGeography(): string {
  return ['regional.csv', 'constituency.csv']
    .filter((file) => existsSync(join(process.cwd(), 'public', 'data', file)))
    .join(',');
}

// Each Budget has an address under /uk/budgets/, so /uk/budgets can later
// become one home for every UK Budget.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH !== undefined
  ? process.env.NEXT_PUBLIC_BASE_PATH
  : '/uk/budgets/autumn-2026';

// The address until 26 October. A link to it, or to anything below it,
// redirects to the same place under the base path, with the same query
// values (Next writes a comma as %2C, which URLSearchParams reads back). A
// trailing slash comes off first, through Next's own 308. The redirect is
// temporary (307) until after the Budget, so browsers don't cache it while
// the route could still change. scripts/check-former-address.sh checks this.
const FORMER_BASE_PATH = '/uk/autumn-budget-2026';


// The Household impact tab's API URL is baked in at build time: fail a
// production build that lacks it, and every build that has it in the wrong
// form (scripts/household-api-env.mjs).
checkHouseholdApiEnv(process.env);

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_POLICYENGINE_VERSION: lockedVersion('policyengine'),
    NEXT_PUBLIC_PUBLISHED_GEOGRAPHY: publishedGeography(),
  },
  async redirects() {
    if (!basePath || basePath === FORMER_BASE_PATH) return [];
    return [
      { source: FORMER_BASE_PATH, destination: basePath, basePath: false, permanent: false },
      {
        source: `${FORMER_BASE_PATH}/:path*`,
        destination: `${basePath}/:path*`,
        basePath: false,
        permanent: false,
      },
    ];
  },
  // recharts and d3 ship CJS interop and rely on browser globals; transpiling
  // them through Next's pipeline avoids ESM/CJS mismatch errors during build.
  transpilePackages: ['recharts', 'd3'],
  // An artifact directory is named by its digest and never changes once
  // written, so the browser may keep its files; the page still checks every
  // byte against the manifest, which is always fetched fresh
  async headers() {
    return [
      {
        source: '/data/artifacts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
