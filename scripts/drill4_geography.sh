#!/usr/bin/env bash
# Drill 4 (MOCK): results by region and constituency on the Microcosm pair.
# Regions come from the pinned national file and seats from the pinned local
# file, both through the disclosure layer. Refuses any other file.
#
# Usage: DRILL4_DATASET=/path/to/microcosm_uk_2024_25.h5 \
#        DRILL4_LOCAL_DATASET=/path/to/microcosm_uk_2024_25_dense.h5 \
#        UK_BUDGET_DISCLOSURE_AUDIT_DIR=/private/folder/outside/any/repo \
#          scripts/drill4_geography.sh --reforms <ids...> \
#            --package <id>_combined --years <years...>
#
# --package publishes the package and every measure by seat. Without it,
# pass --seat-reforms with the measures to publish by seat.
#
# Writes public/data/regional.csv and public/data/constituency.csv only when
# both runs succeed, then prints their review rows.
set -euo pipefail

NATIONAL_SHA256="810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece"
NATIONAL_RELEASE="microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71"
LOCAL_SHA256="8e10e130d0260e0b52e2e29902f0502ebdff76a14a3e57d2c876bf4cd8db5872"
LOCAL_RELEASE="microcosm-uk-2024-25-dense-20261019T000432Z-ee5c2dbe"
OUT_DIR="${DRILL4_GEOGRAPHY_OUT_DIR:-public/data}"

# Only these options pass through, spelled in full: the script sets every
# other one, so neither run can be pointed at another file or folder.
for arg in "$@"; do
  if [[ "$arg" == -* && "$arg" != --reforms && "$arg" != --package \
        && "$arg" != --seat-reforms && "$arg" != --years ]]; then
    echo "drill4: only --reforms, --package, --seat-reforms and --years may be passed (got $arg); the script sets the rest" >&2
    exit 2
  fi
done

check() {
  local label="$1" path="$2" expected="$3" release="$4" actual
  if [[ -z "$path" || ! -f "$path" ]]; then
    echo "drill4: set the $label file's path (Microcosm $release)" >&2
    exit 2
  fi
  actual="$(shasum -a 256 "$path" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    echo "drill4: refused: $path has sha256 $actual, expected $expected (Microcosm $release)" >&2
    exit 3
  fi
  echo "drill4: dataset OK: $label Microcosm $release ($expected)" >&2
}
check national "${DRILL4_DATASET:-}" "$NATIONAL_SHA256" "$NATIONAL_RELEASE"
check local "${DRILL4_LOCAL_DATASET:-}" "$LOCAL_SHA256" "$LOCAL_RELEASE"
audit="${UK_BUDGET_DISCLOSURE_AUDIT_DIR:?drill4: set UK_BUDGET_DISCLOSURE_AUDIT_DIR to a private folder outside any repository}"

run_id="drill4-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d "${TMPDIR:-/tmp}/drill4-geography.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
start=$SECONDS

echo "drill4: regions on the national file (run $run_id)" >&2
uv run uk-budget-data geography "$@" \
  --dataset-kind microcosm-national --levels region \
  --run-id "$run_id" --out-dir "$stage" --dataset "$DRILL4_DATASET"
echo "drill4: regions done in $((SECONDS - start)) s; seats on the local file" >&2
uv run uk-budget-data geography "$@" \
  --dataset-kind microcosm --levels constituency \
  --run-id "$run_id" --out-dir "$stage" \
  --prior-regional "$stage/regional.csv" \
  --compare-with "$audit/geography/$run_id/microcosm-national" \
  --allow-demotions --dataset "$DRILL4_LOCAL_DATASET"

cp "$stage/regional.csv" "$stage/constituency.csv" "$OUT_DIR/"
echo "drill4: wrote $OUT_DIR/regional.csv and $OUT_DIR/constituency.csv in $((SECONDS - start)) s (run $run_id)" >&2

day="$(date -u +%Y-%m-%d)"
echo "drill4: review rows for data_inputs/public_data_review.csv; each replaces any row for the same path:" >&2
for name in regional constituency; do
  sha="$(shasum -a 256 "$OUT_DIR/$name.csv" | awk '{print $1}')"
  if [[ "$name" == regional ]]; then
    basis="MOCK drill 4: change in household net income by region on Microcosm national ${NATIONAL_SHA256:0:8}; disclosure controlled; no survey records"
  else
    basis="MOCK drill 4: change in household net income by constituency on Microcosm local ${LOCAL_SHA256:0:8}; disclosure controlled; no survey records"
  fi
  echo "public/data/$name.csv,disclosure_table,$sha,vahid-ahmadi (drill 4; MOCK),$day,,$basis"
done
