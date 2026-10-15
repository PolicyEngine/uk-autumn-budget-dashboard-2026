#!/usr/bin/env bash
# Stop unless this release is newer than the one main pins and has never
# been proposed.
#
# Runs in a checkout of main, with VERSION, BRANCH, GH_TOKEN (read access
# is enough), GITHUB_REPOSITORY and GITHUB_OUTPUT. Writes current (main's
# pinned version), skip, and orphan: the sha of a branch left by a run that
# pushed but could not open its pull request, which the next run rebuilds
# with a lease on exactly that sha.
set -euo pipefail

# Whether plain version $1 is newer than plain version $2.
newer() {
  local IFS=.
  local -a a=($1) b=($2)
  local i
  for i in 0 1 2; do
    if (( 10#${a[i]} > 10#${b[i]} )); then return 0; fi
    if (( 10#${a[i]} < 10#${b[i]} )); then return 1; fi
  done
  return 1
}

current=$(grep -A1 '^name = "policyengine"$' uv.lock | sed -n 's/^version = "\(.*\)"$/\1/p')
if ! [[ "$current" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "::error::uv.lock does not pin a plain policyengine version"
  exit 1
fi
echo "current=$current" >> "$GITHUB_OUTPUT"
if ! newer "$VERSION" "$current"; then
  echo "uv.lock pins policyengine $current; $VERSION is not newer, so nothing to do."
  echo "skip=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Every pull request ever opened from this repository's branch of that
# name, open or closed, whether or not the branch still exists: closing the
# bot's draft rejects the release, and deleting the branch does not undo
# that. The API's head filter names the owner, which leaves out other
# people's forks; every page is read, and only this repository counts.
owner="${GITHUB_REPOSITORY%%/*}"
proposals=$(gh api --paginate \
  "repos/$GITHUB_REPOSITORY/pulls?state=all&per_page=100&head=$owner:$BRANCH" \
  | jq -rs --arg repo "$GITHUB_REPOSITORY" '[.[][] | select(.head.repo.full_name == $repo) | "#\(.number) (\(if .merged_at then "merged" else .state end))"] | join(", ")')
if [ -n "$proposals" ]; then
  echo "Release $VERSION was already proposed in $proposals; nothing to do."
  echo "skip=true" >> "$GITHUB_OUTPUT"
  exit 0
fi

# Exactly this ref: ls-remote matches a pattern against the end of any ref,
# so refs/heads/zz/$BRANCH would match too. The repository is public, so
# this needs no token.
ref="refs/heads/$BRANCH"
listing=$(git ls-remote origin "$ref")
shas=$(printf '%s\n' "$listing" | awk -v ref="$ref" '$2 == ref {print $1}')
count=$(printf '%s' "$shas" | awk 'END {print NR}')
if [ "$count" -gt 1 ]; then
  echo "::error::$ref is listed more than once"
  exit 1
fi
orphan=""
if [ "$count" -eq 1 ]; then
  orphan="$shas"
  echo "::warning::$BRANCH exists with no pull request from this repository, left by an incomplete run; rebuilding it"
fi
{
  echo "skip=false"
  echo "orphan=$orphan"
} >> "$GITHUB_OUTPUT"
