#!/usr/bin/env bash
# Open ONE draft data pull request with the rows apply-rows wrote (#105).
#
# Run from a checkout of main after `uk-budget-data apply-rows`. Commits
# public/data and the review list on a branch of its own (one per workflow
# run, so two runs never write to one branch), pushes it, and opens a draft
# PR against main whose body is the summary. Opens nothing when nothing
# changed. It never merges and never signs a review row: the Reconciler
# signs on the PR (`uk-budget-data sign-pending --reviewer NAME`).
#
# Environment: GH_TOKEN, BRANCH, TITLE, SUMMARY (a markdown file).
set -euo pipefail

if git diff --quiet -- public/data data_inputs/public_data_review.csv; then
  echo "No public file changed; no data pull request."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -c "$BRANCH"
git add public/data data_inputs/public_data_review.csv
git commit -q -m "$TITLE"
# The checkout keeps no credentials; the token reaches git only here.
git push -q "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BRANCH"

{
  cat "$SUMMARY"
  echo
  echo "Review rows are pending; the Reconciler signs before merge."
  echo
  echo "Opened by the \`${GITHUB_WORKFLOW}\` workflow, run ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}. Refs #105."
} > pr-body.md

gh pr create --draft --base main --head "$BRANCH" --title "$TITLE" --body-file pr-body.md
