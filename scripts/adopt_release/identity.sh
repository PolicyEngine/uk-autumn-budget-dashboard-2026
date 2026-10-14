#!/usr/bin/env bash
# The release identity, checked before anything uses it.
#
# Reads the dispatch (PAYLOAD_VERSION, PAYLOAD_BUNDLE_UK_JSON,
# PAYLOAD_QUALIFICATION_JSON) or the manual inputs (INPUT_*). Writes four
# outputs, and only once everything has passed: version, branch, and the
# bundle and qualification as JSON on one line. Both jobs of
# adopt-policyengine-release.yml run it, the second on the first's outputs.
set -euo pipefail

version="${PAYLOAD_VERSION:-${INPUT_VERSION:-}}"
# Bash matches the whole string (grep would match any one line), so a
# version with a line break cannot add outputs.
if ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "::error::the version is not a plain release version"
  exit 1
fi

bundle="${PAYLOAD_BUNDLE_UK_JSON:-}"
if [ -z "$bundle" ] || [ "$bundle" = "null" ]; then
  bundle="${INPUT_BUNDLE_UK_JSON:-}"
fi
# Only a JSON object goes through, compacted onto one line, so no input can
# add lines (and so outputs).
if ! bundle=$(printf '%s' "$bundle" | jq -cse 'if length == 1 and (.[0] | type) == "object" then .[0] else error("expected one JSON object") end'); then
  echo "::error::bundle.uk must be exactly one JSON object"
  exit 1
fi

qualification="${PAYLOAD_QUALIFICATION_JSON:-}"
if [ -z "$qualification" ] || [ "$qualification" = "null" ]; then
  qualification="${INPUT_QUALIFICATION_JSON:-null}"
fi
# Not -e: null is a valid answer here, and error() still fails.
if ! qualification=$(printf '%s' "$qualification" | jq -cs 'if length == 1 and ((.[0] | type) == "object" or .[0] == null) then .[0] else error("expected one JSON object or null") end'); then
  echo "::error::qualification must be one JSON object, or null"
  exit 1
fi

{
  echo "version=$version"
  echo "branch=adopt/policyengine-$version"
  echo "bundle=$bundle"
  echo "qualification=$qualification"
} >> "$GITHUB_OUTPUT"
