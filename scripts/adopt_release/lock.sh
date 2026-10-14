#!/usr/bin/env bash
# Pin policyengine $VERSION in pyproject.toml and uv.lock without building or
# running any package: --no-build resolves from wheel metadata alone.
#
# Writes the two files' SHA-256s as outputs. Where EXPECT_LOCK_SHA256 and
# EXPECT_PYPROJECT_SHA256 are set (the propose job sets them from the
# validate job's outputs), it stops unless the files are exactly the ones
# the validate job installed and checked; set but empty never matches.
set -euo pipefail

perl -pi -e 's/"policyengine\[uk\]>=[0-9.]+"/"policyengine[uk]>=$ENV{VERSION}"/' pyproject.toml
grep -qF "\"policyengine[uk]>=$VERSION\"" pyproject.toml
uv lock --no-build --upgrade-package "policyengine==$VERSION"

lock=$(shasum -a 256 uv.lock | cut -d' ' -f1)
pyproject=$(shasum -a 256 pyproject.toml | cut -d' ' -f1)
if [ -n "${EXPECT_LOCK_SHA256+set}${EXPECT_PYPROJECT_SHA256+set}" ]; then
  if [ "$lock" != "${EXPECT_LOCK_SHA256:-}" ] \
    || [ "$pyproject" != "${EXPECT_PYPROJECT_SHA256:-}" ]; then
    echo "::error::these are not the files the validate job checked: uv.lock $lock (checked: ${EXPECT_LOCK_SHA256:-none}), pyproject.toml $pyproject (checked: ${EXPECT_PYPROJECT_SHA256:-none})"
    exit 1
  fi
fi
{
  echo "lock_sha256=$lock"
  echo "pyproject_sha256=$pyproject"
} >> "$GITHUB_OUTPUT"
