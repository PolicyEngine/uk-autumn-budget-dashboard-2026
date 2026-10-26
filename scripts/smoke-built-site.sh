#!/usr/bin/env bash
# Check that a served build of the dashboard answers the page, each of its
# four tabs, Young people sub-tab and required independent data files with HTTP 200.
#
# The vitest smoke (src/tabsSmoke.test.jsx) renders each tab on these files
# in jsdom; this checks the built site actually serves them, under the base
# path, as `next start` (or a deployment) does.
#
# Usage: scripts/smoke-built-site.sh [site URL]
#   default http://127.0.0.1:3000/uk/autumn-budget-2026
# Extra curl arguments (for example a Vercel protection-bypass header) can
# be passed in SMOKE_CURL_ARGS.
set -euo pipefail

SITE="${1:-http://127.0.0.1:3000/uk/autumn-budget-2026}"
SITE="${SITE%/}"
read -r -a EXTRA <<<"${SMOKE_CURL_ARGS:-}"

# Every independent file a tab fetches that every build carries: the Living
# standards view and the map's boundaries. The 2025 OBR comparison is unavailable
# and must not be required as a current Budget input. Budget
# figures come only from manifest.json, its artifacts and release-index.json,
# which exist only once results are published; src/tabsSmoke.test.jsx renders
# each tab on the verified publication fixture.
DATA_FILES=(
  living_standards_outlook.json
  uk_constituencies_2024.geojson
)
# Results by area, once published: the build ships whichever of them
# public/data holds (next.config.ts), and the area views fetch them, with
# the area run's record of what they were made from.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for file in regional.csv constituency.csv area_provenance.json; do
  if [ -f "$ROOT/public/data/$file" ]; then
    DATA_FILES+=("$file")
  fi
done
TABS=("" "?tab=personal" "?tab=young" "?tab=living" "?tab=methodology")

failures=0
status() {
  curl --silent --show-error --output "$2" --write-out '%{http_code}' \
    --max-time 60 ${EXTRA[@]+"${EXTRA[@]}"} "$1" || echo "000"
}
body=$(mktemp)
trap 'rm -f "$body"' EXIT

for tab in "${TABS[@]}"; do
  url="$SITE$tab"
  code=$(status "$url" "$body")
  if [ "$code" != 200 ]; then
    echo "FAIL $url: HTTP $code"
    failures=$((failures + 1))
  elif ! grep -q "UK Autumn Budget 2026" "$body"; then
    echo "FAIL $url: the page title is missing"
    failures=$((failures + 1))
  else
    echo "ok   $url"
  fi
done

for file in "${DATA_FILES[@]}"; do
  url="$SITE/data/$file"
  code=$(status "$url" "$body")
  if [ "$code" != 200 ] || [ ! -s "$body" ]; then
    echo "FAIL $url: HTTP $code"
    failures=$((failures + 1))
  else
    echo "ok   $url"
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "The page, its five tabs and ${#DATA_FILES[@]} data files answer 200."
