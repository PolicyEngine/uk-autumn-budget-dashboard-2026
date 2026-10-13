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
    {"path": "policies.rate_change.years[2].impact", "value": 123.45}
  ],
  "source": "hand calculation, <name>, <date>"
}
```

`path` is a dotted path into the JSON response, with `[i]` for list elements. A fixture with `"draft": true` documents a request shape whose answers are not yet independent. Drafts are skipped unless `--include-drafts` is passed, and a run with no non-draft fixture never passes.
