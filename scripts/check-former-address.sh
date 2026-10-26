#!/usr/bin/env bash
# Check that links to the dashboard's former address, /uk/autumn-budget-2026,
# still work on a served build: each answers a temporary redirect (307) to the
# same path and query under /uk/budgets/autumn-2026, and that address answers
# 200 (next.config.ts, `redirects`).
#
# Usage: scripts/check-former-address.sh [origin]
#   default http://127.0.0.1:3000
# Extra curl arguments (for example a Vercel protection-bypass header) can
# be passed in SMOKE_CURL_ARGS.
set -euo pipefail

ORIGIN="${1:-http://127.0.0.1:3000}"
ORIGIN="${ORIGIN%/}"
FORMER=/uk/autumn-budget-2026
CURRENT=/uk/budgets/autumn-2026
read -r -a EXTRA <<<"${SMOKE_CURL_ARGS:-}"

# The page, a tab with a measure selection, the Young people sub-tab and a
# data file: everything below the former address moves as it is.
TAILS=(
  ""
  "?tab=personal&policies=fuel_duty_rise_deferral,road_fuel_vat_cut"
  "?tab=young#young-people"
  "/data/living_standards_outlook.json"
)

failures=0
for tail in "${TAILS[@]}"; do
  sent="${tail%%#*}"
  url="$ORIGIN$FORMER$sent"
  read -r code location < <(
    curl --silent --output /dev/null --max-time 60 ${EXTRA[@]+"${EXTRA[@]}"} \
      --write-out '%{http_code} %{redirect_url}\n' "$url" || echo "000 -"
  )
  expected="$ORIGIN$CURRENT$sent"
  if [ "$code" != 307 ]; then
    echo "FAIL $url: HTTP $code, expected 307"
    failures=$((failures + 1))
  elif [ "$location" != "$expected" ]; then
    echo "FAIL $url: redirects to $location, expected $expected"
    failures=$((failures + 1))
  else
    final=$(curl --silent --output /dev/null --max-time 60 ${EXTRA[@]+"${EXTRA[@]}"} \
      --write-out '%{http_code}' "$expected" || echo "000")
    if [ "$final" != 200 ]; then
      echo "FAIL $expected: HTTP $final"
      failures=$((failures + 1))
    else
      echo "ok   $url -> $CURRENT$sent"
    fi
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "The former address redirects ${#TAILS[@]} links to the same place under $CURRENT."
