#!/usr/bin/env bash
# Commit the pinned files, push the branch and open the draft pull request.
#
# Runs in the propose job only, after lock.sh has rebuilt exactly the files
# the validate job checked, with VERSION, BRANCH, ORPHAN (a branch sha to
# replace, or empty), BUNDLE_UK_JSON, QUALIFICATION_JSON, GH_TOKEN and
# RUNNER_TEMP. The token reaches git only in the environment of each push.
set -euo pipefail

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$BRANCH"
git add pyproject.toml uv.lock
git commit -m "Adopt policyengine $VERSION"
auth=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
echo "::add-mask::$auth"
push() {
  GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $auth" \
    git push "$@"
}
if [ -n "$ORPHAN" ]; then
  # Replace only the incomplete branch the dedupe step saw.
  push --force-with-lease="refs/heads/$BRANCH:$ORPHAN" origin "$BRANCH"
else
  push origin "$BRANCH"
fi
# The release page is built from the validated version, never taken
# from the dispatch. JSON evidence goes in a fenced block with every
# backtick escaped (still the same JSON), so it cannot end the fence.
release_url="https://github.com/PolicyEngine/policyengine.py/releases/tag/$VERSION"
{
  echo "**Draft, opened automatically. Do not merge until every published measure is regenerated and re-gated on this release.**"
  echo
  echo "policyengine.py released \`$VERSION\` ($release_url). The installed wheel's bundle was checked against the release dispatch and matches:"
  echo
  echo '```json'
  printf '%s\n' "$BUNDLE_UK_JSON" | sed 's/`/\\u0060/g'
  echo '```'
  echo
  echo "Qualification reported by the dispatch, and checked:"
  echo
  echo '```json'
  printf '%s\n' "$QUALIFICATION_JSON" | sed 's/`/\\u0060/g'
  echo '```'
  echo
  echo "## Before merging"
  echo
  echo "- [ ] CI is green on this branch (run the CI workflow manually if it did not start)."
  echo "- [ ] Every published measure and combined run is regenerated on this release and staged with \`publish stage --adopt-execution\`."
  echo "- [ ] Reconciliation and responsiveness are re-run for each regenerated artifact."
  echo "- [ ] Approvals are renewed where outputs changed (identical outputs keep theirs)."
  echo "- [ ] The household API is redeployed on this release and the household checks pass on the deployed route."
  echo "- [ ] \`publish check\` passes."
  echo
  echo "If this cannot finish before a publication deadline, stay on the current release. Mixing releases is refused by the publication gate."
} > "$RUNNER_TEMP/body.md"
gh pr create --draft --base main --head "$BRANCH" \
  --title "Adopt policyengine $VERSION" \
  --body-file "$RUNNER_TEMP/body.md"
