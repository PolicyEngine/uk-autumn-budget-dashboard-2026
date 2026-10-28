"""Whether publishing needs people's sign-off: one switch, off.

Off (``REQUIRED = False``, from Budget day, 28 October 2026), a pull request
merges once ``main``'s required checks pass, with no signing step (its ruleset
requires no approving review unless an admin raises it):

- no file under ``public/`` needs a row in
  ``data_inputs/public_data_review.csv``, and no row fails anything, whether
  its file has changed since, its pending date has passed or it is malformed
  (``scripts/check_public_data.py``, ``scripts/check-public-files.mjs``);
- no hand-written modifier is held for a two-person attestation
  (``publication.attestations``), in the publication gates or on the page;
- in place of the review rows, a file under ``public/data/artifacts/`` must
  be one the page lists: a listed entry's receipt, or a file it binds.

Every automated check blocks whatever the switch says: record-level
identifiers, the floor of survey households and the cells it withholds, the
disclosure layer's ``validate_public``, the area-code guard, file digests,
certification, completeness, reconciliation and combined-run membership. The
area-code guard still lets a file carry many area codes only where a review
row of kind ``reference_geography``, or a ``pending`` row before its expiry
date, names its exact bytes. That row is the guard's record that the file is
reference geography, so a changed boundary file needs a new one.

On (``True``), as before Budget day: every public file needs a current review
row, and while a data limit is active a hand-written modifier is held until
two people attest its exact receipt. To turn it on, set ``REQUIRED`` to True
and regenerate the page's contract, which carries the switch to the browser
and to the build's check (a test fails until they agree)::

    uv run python -m uk_budget_data.publication.contract \\
        > src/utils/publication/contract.json

Then add the review rows and attestations the checks ask for (``uk-budget-data
publish review-rows``, ``scripts/draft_attestation.py``), and restage any
entry staged without its attestation.
"""

REQUIRED = False
