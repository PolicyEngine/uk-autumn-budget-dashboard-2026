#!/usr/bin/env bash
# Open ONE draft data pull request with what stage-artifacts staged (#105).
#
# Run from the checkout the artifacts were generated at, after
# `uk-budget-data stage-artifacts`. Commits public/data (the new artifacts
# and the manifest) and the review list on a branch of its own (one per
# workflow run, so two runs never write to one branch), pushes it, and opens
# a draft PR against main whose body is the summary. Opens nothing when
# nothing changed. It never merges, approves or signs: the Reconciler
# approves and writes the review rows on the PR (`uk-budget-data
# sign-measures --by NAME --reviewer HANDLE`).
#
# Environment: GH_TOKEN, BRANCH, TITLE, SUMMARY (a markdown file).
set -euo pipefail

# New artifact directories are untracked, so ask git status, not git diff.
if [ -z "$(git status --porcelain -- public/data data_inputs/public_data_review.csv)" ]; then
  echo "No public file changed; no data pull request."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$BRANCH"
# reconciliation.json never goes in the commit (the gates recompute it).
find public/data/artifacts -name reconciliation.json -delete 2>/dev/null || true
git add public/data data_inputs/public_data_review.csv
git commit -q -m "$TITLE"
# The checkout keeps no credentials; the token reaches git only here.
git push -q "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH"

{
  cat "$SUMMARY"
  echo
  echo "Review rows are pending. Nothing is approved: the Reconciler approves and signs on this branch before merge."
  echo
  echo "Opened by the \`${GITHUB_WORKFLOW}\` workflow, run ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}. Refs #105."
} > pr-body.md

gh pr create --draft --base main --head "$BRANCH" --title "$TITLE" --body-file pr-body.md
