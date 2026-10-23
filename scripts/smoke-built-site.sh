#!/usr/bin/env bash
# Check that a served build of the dashboard answers the page, each of its
# five tabs and every data file the tabs fetch with HTTP 200.
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

# Every file a tab fetches (App.jsx, OBRComparisonTable, the income-curve
# charts, YoungPeopleSection, the Living standards view, the map).
DATA_FILES=(
  budgetary_impact.csv
  distributional_impact.csv
  winners_losers.csv
  metrics.csv
  obr_comparison.csv
  income_curve.csv
  age_impact.csv
  living_standards_outlook.json
  uk_constituencies_2024.geojson
)
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
