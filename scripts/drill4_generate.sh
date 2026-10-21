#!/usr/bin/env bash
# Drill 4 (MOCK): every national run uses the pinned Microcosm national file.
# Refuses to run on any other dataset, including the bundle's default (eFRS).
#
# Usage: DRILL4_DATASET=/path/to/microcosm_uk_2024_25.h5 \
#          scripts/drill4_generate.sh --output-dir <dir> --reforms <ids...>
set -euo pipefail

PINNED_SHA256="810ba980005a8b907cb51464279fa5e0125464b7af9a4871b7f6744c30951ece"
PINNED_RELEASE="microcosm-uk-2024-25-national-20261019T083323Z-6cba5d71"

dataset="${DRILL4_DATASET:-}"
if [[ -z "$dataset" || ! -f "$dataset" ]]; then
  echo "drill4: set DRILL4_DATASET to the Microcosm national file ($PINNED_RELEASE)" >&2
  exit 2
fi
# argparse accepts unique prefixes, so --datas and --datase also mean --dataset.
for arg in "$@"; do
  if [[ "$arg" == --datas* ]]; then
    echo "drill4: do not pass --dataset (or a prefix of it); the script sets it from DRILL4_DATASET" >&2
    exit 2
  fi
done

actual="$(shasum -a 256 "$dataset" | awk '{print $1}')"
if [[ "$actual" != "$PINNED_SHA256" ]]; then
  echo "drill4: refused: $dataset has sha256 $actual, expected $PINNED_SHA256 (Microcosm $PINNED_RELEASE)" >&2
  exit 3
fi

echo "drill4: dataset OK: Microcosm $PINNED_RELEASE ($PINNED_SHA256); uncertified with this engine, label national figures unvalidated" >&2
# The checked file goes last, so it is the value argparse keeps.
exec uv run uk-budget-data generate "$@" --dataset "$dataset"
