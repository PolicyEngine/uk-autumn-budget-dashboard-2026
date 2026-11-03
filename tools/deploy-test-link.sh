#!/usr/bin/env bash
# Deploy the team's live test link (#247): the local checkout, with its
# untracked data in public/data, to the Vercel project ab2026-local-preview.
#
#   tools/deploy-test-link.sh [household-api-url]
#
# The household API URL is the first argument, else $HOUSEHOLD_API_URL, else
# the Modal test app. Run it from the repository root after each local load
# (G2 measures, the package, the area run).
#
# This is a team link, not publication. The script refuses unless the page
# would show the "Provisional" banner, and it never commits anything. It
# edits vercel.json, .env.local, .gitignore and .vercel/ only for the
# duration of the run, and restores each exactly on exit.
set -euo pipefail

PROJECT="ab2026-local-preview"
SCOPE="policy-engine"
VERCEL="vercel@48"
STABLE_URL="https://ab2026-local-preview.vercel.app/uk/autumn-budget-2026"
DEFAULT_API="https://policyengine--uk-budget-household-test-web.us-east.modal.run/api/household-impact"
PRODUCTION_MANIFESTS=(
  "https://uk-autumn-budget-2026.vercel.app/uk/autumn-budget-2026/data/manifest.json"
  "https://policyengine.org/uk/autumn-budget-2026/data/manifest.json"
)
MANIFEST="public/data/manifest.json"
API_URL="${1:-${HOUSEHOLD_API_URL:-$DEFAULT_API}}"

die() { echo "deploy-test-link: $*" >&2; exit 1; }

sha() { shasum -a 256 "$1" | awk '{print $1}'; }

# --- Where we are ---------------------------------------------------------
[ -f package.json ] && grep -q '"name": "uk-autumn-budget-dashboard-2026"' package.json \
  || die "run this from the root of the uk-autumn-budget-dashboard-2026 checkout"
[ -f vercel.json ] || die "vercel.json is missing"
# node and npx where installed; bun and bunx otherwise (some Macs here have bun only)
if command -v node >/dev/null; then JS=(node); elif command -v bun >/dev/null; then JS=(bun); else die "node or bun is required"; fi
if command -v npx >/dev/null; then VC=(npx -y "$VERCEL"); elif command -v bunx >/dev/null; then VC=(bunx "$VERCEL"); else die "npx or bunx is required"; fi
case "$API_URL" in
  https://*) ;;
  *) die "the household API URL must start with https://" ;;
esac

# --- 1. Refuse unless the page would show the Provisional banner ----------
[ -f "$MANIFEST" ] || die "$MANIFEST does not exist: load the data first"

# The page shows the banner while any displayed measure has status
# "provisional" (catalogueProvisional in src/utils/measureCatalogue.jsx).
# Combined runs live under "combined", not "measures", and are not counted.
MANIFEST_PATH="$MANIFEST" "${JS[@]}" -e '
  const fs = require("fs");
  let m;
  try { m = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8")); }
  catch (e) { console.error("deploy-test-link: the manifest is not valid JSON"); process.exit(1); }
  const measures = m && typeof m.measures === "object" && m.measures ? m.measures : {};
  const ids = Object.keys(measures).filter((id) => measures[id] && measures[id].status === "provisional");
  if (ids.length === 0) {
    console.error("deploy-test-link: no measure in the manifest is provisional, so the page would show no Provisional banner. Refusing: an all-approved page belongs on the signed path, not the test link.");
    process.exit(1);
  }
  console.log(`Manifest revision ${m.revision}: ${ids.length} provisional measure(s), so the page shows the Provisional banner.`);
'

# And it must not be the manifest production already serves.
LOCAL_SHA="$(sha "$MANIFEST")"
for url in "${PRODUCTION_MANIFESTS[@]}"; do
  remote="$(curl -fsSL --max-time 20 "$url" 2>/dev/null | shasum -a 256 | awk '{print $1}')" || true
  if [ -n "${remote:-}" ] && [ "$remote" = "$LOCAL_SHA" ]; then
    die "public/data/manifest.json is the production manifest served at $url. Refusing: the test link shows local, provisional data only."
  fi
done

# --- Backups, restored on every exit --------------------------------------
BACKUP="$(mktemp -d "${TMPDIR:-/tmp}/deploy-test-link.XXXXXX")"
had_env=0; had_vercel_dir=0
cp -p vercel.json "$BACKUP/vercel.json"
cp -p .gitignore "$BACKUP/.gitignore"
if [ -e .env.local ]; then had_env=1; cp -p .env.local "$BACKUP/.env.local"; fi
if [ -d .vercel ]; then had_vercel_dir=1; cp -Rp .vercel "$BACKUP/.vercel"; fi

restore() {
  local status=$?
  cp -p "$BACKUP/vercel.json" vercel.json
  cp -p "$BACKUP/.gitignore" .gitignore
  if [ "$had_env" = 1 ]; then cp -p "$BACKUP/.env.local" .env.local; else rm -f .env.local; fi
  rm -rf .vercel
  if [ "$had_vercel_dir" = 1 ]; then cp -Rp "$BACKUP/.vercel" .vercel; fi
  rm -rf "$BACKUP"
  echo "Restored vercel.json, .gitignore, .env.local and .vercel/." >&2
  exit "$status"
}
trap restore EXIT
trap 'exit 130' INT TERM

# --- 2. Link to the preview project ---------------------------------------
echo "Linking to $SCOPE/$PROJECT..."
"${VC[@]}" link --yes --project "$PROJECT" --scope "$SCOPE" >/dev/null
# vercel link overwrites .env.local and edits .gitignore: put both back now
cp -p "$BACKUP/.gitignore" .gitignore
if [ "$had_env" = 1 ]; then cp -p "$BACKUP/.env.local" .env.local; else rm -f .env.local; fi

# --- 3. Build without check-public-files, and deploy ----------------------
# check-public-files correctly refuses unsigned rehearsal data; it stays the
# build command for every real deploy. This edit is local and undone on exit.
"${JS[@]}" -e '
  const fs = require("fs");
  const v = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  v.buildCommand = "next build";
  fs.writeFileSync("vercel.json", JSON.stringify(v, null, 2) + "\n");
'

echo "Deploying (household API: $API_URL)..."
DEPLOY_URL="$("${VC[@]}" deploy --prod --yes --scope "$SCOPE" \
  --build-env "NEXT_PUBLIC_HOUSEHOLD_API_URL=$API_URL" \
  --build-env "NEXT_PUBLIC_HOUSEHOLD_DETAIL_API_URL=$API_URL" | tail -n 1)"
case "$DEPLOY_URL" in
  https://*) ;;
  *) die "vercel deploy did not return a deployment URL" ;;
esac

# --- 4. Check it is live --------------------------------------------------
status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$1" || echo 000; }

stable_status="000"
for _ in 1 2 3 4 5 6; do
  stable_status="$(status_of "$STABLE_URL")"
  [ "$stable_status" = 200 ] && break
  sleep 10
done
deploy_status="$(status_of "$DEPLOY_URL/uk/autumn-budget-2026")"

live_sha="$(curl -fsSL --max-time 30 "$STABLE_URL/data/manifest.json" 2>/dev/null | shasum -a 256 | awk '{print $1}')" || true

echo
echo "Stable link:  $STABLE_URL  (HTTP $stable_status)"
echo "Deployment:   $DEPLOY_URL/uk/autumn-budget-2026  (HTTP $deploy_status)"
if [ "${live_sha:-}" = "$LOCAL_SHA" ]; then
  echo "The live manifest matches public/data/manifest.json."
else
  echo "Warning: the live manifest does not match public/data/manifest.json yet." >&2
fi
echo "Team link only, not publication."

[ "$stable_status" = 200 ] || die "the stable link returned HTTP $stable_status, not 200"
