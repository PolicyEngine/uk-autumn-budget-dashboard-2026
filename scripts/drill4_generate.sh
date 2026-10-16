#!/usr/bin/env bash
# Drill 4 (MOCK): every national run uses the pinned Microcosm national file.
# Refuses to run on any other dataset, including the bundle's default (eFRS).
#
# Usage: DRILL4_DATASET=/path/to/microcosm_uk_2024_25.h5 \
#          scripts/drill4_generate.sh --output-dir <dir> --reforms <ids...>
set -euo pipefail

PINNED_SHA256="04a496f2b2c01019f5ac277c28e7fc989e12e6e3f050d062315c390ba8b79094"
PINNED_RELEASE="microcosm-uk-2024-25-national-20261014T214443Z-d12ff9b3"

dataset="${DRILL4_DATASET:-}"
if [[ -z "$dataset" || ! -f "$dataset" ]]; then
  echo "drill4: set DRILL4_DATASET to the Microcosm national file ($PINNED_RELEASE)" >&2
  exit 2
fi
for arg in "$@"; do
  if [[ "$arg" == "--dataset" || "$arg" == --dataset=* ]]; then
    echo "drill4: do not pass --dataset; the script sets it from DRILL4_DATASET" >&2
    exit 2
  fi
done

actual="$(shasum -a 256 "$dataset" | awk '{print $1}')"
if [[ "$actual" != "$PINNED_SHA256" ]]; then
  echo "drill4: refused: $dataset has sha256 $actual, expected $PINNED_SHA256 (Microcosm $PINNED_RELEASE)" >&2
  exit 3
fi

echo "drill4: dataset OK: Microcosm $PINNED_RELEASE ($PINNED_SHA256); uncertified with this engine, label national figures unvalidated" >&2
exec uv run uk-budget-data generate --dataset "$dataset" "$@"
