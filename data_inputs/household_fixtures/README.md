# Household fixtures

Each `*.json` file here is one household checked through the **deployed** household route by:

```sh
uv run python -m uk_budget_data.household_route \
  --base-url https://<deployed household API> \
  --fixtures data_inputs/household_fixtures \
  --manifest public/data/manifest.json \
  --out household-receipt.json
```

The checker:

- reads `/api/version` and fails if the API is not running the model and core versions the published national figures were produced on;
- posts each fixture to its `route`;
- compares every expected value within `tolerance` (default £0.01);
- writes a receipt;
- exits non-zero on any mismatch.

**Expected values must be computed independently of the API**, by hand or from a statutory answer key, and `source` must say how and by whom. Never paste the API's own output in as the expectation; that checks nothing.

```json
{
  "name": "single earner, basic-rate change",
  "route": "/api/personal-impact",
  "request": {"employment_income": 30000},
  "expect": [
    {"path": "policies.threshold_freeze_extension.years.2028.net_income_change", "value": -123.45}
  ],
  "source": "hand calculation, <name>, <date>"
}
```

`path` is a dotted path into the JSON response, with `[i]` for list elements. In `/api/personal-impact`'s response, each policy's change in a year is at `policies.<policy id>.years.<year>.net_income_change`: `years` is keyed by year, not a list. A fixture with `"draft": true` documents a request shape whose answers are not yet independent. Drafts are skipped unless `--include-drafts` is passed, and a run with no non-draft fixture never passes.

## The plumbing fixture

`plumbing-single-12k-no-measure-applies.json` is a **plumbing check, not an accuracy check**. Its household is a single employee on £12,000 with nothing else. By statute, and by each measure's own definition, seven of the eight registered measures change its net income by exactly £0 in every year, and it gets no Universal Credit. Its `reasoning` gives one line per measure.

It shows that the deployed route answers on the bundle's versions, with the response's shape, and that no measure reaches a household it can't affect. It checks no non-zero answer. The salary sacrifice cap's net income change, and so the total, are left out: policyengine-uk spreads the cap's employer NI over every worker's pay, which moves this household's income. The cap's Universal Credit is checked, on both sides in every year: it stays nil.

A run passes with this fixture alone, so G0 can pass. The accuracy check is a set of specimen households with independently computed, non-zero answers.

`tests/test_household_fixtures.py` runs every non-draft fixture against the calculator the route serves, in CI. A model change that moves an answer, or that makes this household eligible for Universal Credit, fails there first.
