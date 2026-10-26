#!/usr/bin/env bash
# Check that links to the dashboard's former address, /uk/autumn-budget-2026,
# still work on a served build (next.config.ts, `redirects`):
#   - each answers a temporary redirect (307) to the same path under
#     /uk/budgets/autumn-2026, with the same query values;
#   - with a trailing slash, Next first strips the slash (its own 308, as on
#     every Next site), then the 307 follows, so following the redirects
#     still ends at the same place;
#   - wherever the redirects end answers 200.
# Query values are compared decoded: Next writes a comma as %2C, which the
# page reads back with URLSearchParams (src/App.jsx).
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

# Each case is "<tail of the former address>|<tail it should end at>". The
# page, a tab with a measure selection, the Young people sub-tab, a data file,
# and the two trailing-slash forms. A fragment is never sent, so none is here.
CASES=(
  "|"
  "?tab=personal&policies=fuel_duty_rise_deferral,road_fuel_vat_cut|?tab=personal&policies=fuel_duty_rise_deferral,road_fuel_vat_cut"
  "?tab=young|?tab=young"
  "/data/living_standards_outlook.json|/data/living_standards_outlook.json"
  "/|"
  "/data/living_standards_outlook.json/|/data/living_standards_outlook.json"
)

# Whether two URLs have the same origin and path, and the same query values
# in the same order once decoded.
same_place() {
  python3 - "$1" "$2" <<'PY'
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

a, b = (urlsplit(url) for url in sys.argv[1:3])
same = (a.scheme, a.netloc, unquote(a.path)) == (b.scheme, b.netloc, unquote(b.path)) and (
    parse_qsl(a.query, keep_blank_values=True) == parse_qsl(b.query, keep_blank_values=True)
)
sys.exit(0 if same else 1)
PY
}

# curl's --write-out line for one request. curl writes that line even when the
# transfer fails part-way (a 200 whose body is cut off), so its exit status
# decides: on any failure this prints "000 (curl exit N)" instead.
fetch() {
  local out rc=0
  out="$(curl --silent --output /dev/null --max-time 60 ${EXTRA[@]+"${EXTRA[@]}"} "$@")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$out"
  else
    echo "000 (curl exit $rc)"
  fi
}

failures=0
fail() {
  echo "FAIL $1"
  failures=$((failures + 1))
}
for case in "${CASES[@]}"; do
  sent="${case%%|*}"
  expected="$ORIGIN$CURRENT${case#*|}"
  url="$ORIGIN$FORMER$sent"

  # The first answer: a 307 straight to the new address, unless the slash
  # comes off first.
  read -r code location <<<"$(fetch --write-out '%{http_code} %{redirect_url}\n' "$url")"
  if [ "${sent: -1}" = "/" ]; then
    [ "$code" = 308 ] || [ "$code" = 307 ] || { fail "$url: HTTP $code $location, expected 308 or 307"; continue; }
  elif [ "$code" != 307 ]; then
    fail "$url: HTTP $code${location:+ $location}, expected 307"
    continue
  elif ! same_place "$location" "$expected"; then
    fail "$url: redirects to $location, expected $expected"
    continue
  fi

  # Where following the redirects ends.
  read -r final landed <<<"$(fetch --location --max-redirs 5 --write-out '%{http_code} %{url_effective}\n' "$url")"
  if [ "$final" = 000 ]; then
    fail "$url: following the redirects failed $landed"
  elif [ "$final" != 200 ]; then
    fail "$url: ends at $landed with HTTP $final"
  elif ! same_place "$landed" "$expected"; then
    fail "$url: ends at $landed, expected $expected"
  else
    echo "ok   $url -> ${landed#"$ORIGIN"}"
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "${#CASES[@]} links to the former address end at the same place under $CURRENT."
