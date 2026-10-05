# Latest-engine drill 2 setup and limitations

MOCK rehearsal, 5 October 2026. The user explicitly chose the latest released engine for this drill while retaining a dataset built with older versions. This is a drill-only compatibility exception intended to expose engine and data gaps. It does not establish calibration, certification or publication readiness under the new runtime. No drill measures are registered before the 12:30 BST statement release.

## Input and runtime provenance

| Item | Pin |
|---|---|
| Dataset | `microcosm_uk_2024_25.h5` |
| Source | [policyengine/populace-uk-private](https://huggingface.co/datasets/policyengine/populace-uk-private/blob/9d4a76ba20e7cdac69ff5213614a2b90a639f9da/microcosm_uk_2024_25.h5) |
| Repository revision | `9d4a76ba20e7cdac69ff5213614a2b90a639f9da` |
| SHA-256 | `aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af` |
| File bytes | 234,117,256 |
| Producer release | `microcosm-uk-2024-25-national-20261002T230158Z-5c6b3f68` |
| Dataset build model/core | `policyengine-uk==2.100.0` / `policyengine-core==3.32.5` |
| Dataset build interpreter | Python 3.14.6 |
| **Drill runtime model/core** | **`policyengine-uk==2.120.0` / `policyengine-core==3.32.17`** |
| Runtime wrapper/interpreter | Bare `policyengine==6.2.1` / Python 3.13.14 |
| Latest-release check | PyPI rechecked immediately before pinning on 5 October 2026 |
| Input period and format | 2024; PyTables person, benefit-unit and household tables |
| Local geography | National release; no constituency identifiers or aligned weights. Constituencies unavailable. |

The producer's build and release manifests still identify UK 2.100.0/core 3.32.5. The downloaded bytes match the recorded hash. Those facts do not change when the runtime changes. Keep the private H5, credentials and raw private certification files outside Git. The pipeline checks exact runtime versions and H5 hash, then records separate `runtime` and `dataset_build` identities, `dataset_model_match=false`, `calibration_validated_for_runtime=false` and `publication_ready=false`.

Wrapper 6.2.1's UK extra pins UK 2.102.3/core 3.32.10, so it cannot install the selected latest pair. The rehearsal uses the bare wrapper dependency and an explicit `UKSingleYearDataset`/country-engine loader. It does not claim certification by the wrapper's bundled default or modify that bundle.

## Baseline and remaining limitations

- **Native NIC baseline:** UK 2.120.0 supplies PT £241.73/week, UEL £966.73/week, LPL £12,570/year and UPL £50,270/year through 2030/31. The old local freeze has been removed; retaining its £967 UEL would mask a latest-engine correction. Both population and household calculations use native rules plus explicit measure overrides. Class 1 still annualises weekly thresholds by 52; income dynamics may change projected assessable pay.
- **Later fixes now installed:** the [engine change inventory](drill2-engine-limitations.md) describes fixes included since the dataset's build. Installed code does not imply that every new formula runs on this older dataset: recognized stored columns become inputs and can bypass formulas. [The gap record](drill2-engine-gaps.md) separates observed schema facts from untested effects.
- **Calibration mismatch accepted for this drill:** the dataset has not been recalibrated or certified under 2.120.0. A finite-output smoke test establishes execution only. Neither aggregate drift against the build engine nor agreement with administrative targets has been quantified.
- **Fuel duty VAT basis:** national VAT-inclusive household-resource estimates, if implemented, must be labeled. Table 4.1's duty-only figure needs a separate duty-only comparator. Full VAT pass-through on all imputed litres includes business fuel and can overstate the comparable national VAT amount. Household specimens include VAT on the duty change. Record each basis explicitly.
- **High-value council tax surcharge on renters:** the inspected 2.120.0 surcharge formula still checks England and residence value without an owner-tenure gate. National incidence may therefore differ from the household form, which sets owned-residence value to zero for tenants. The selected dataset's affected renter count has not been measured; no local formula correction is applied.
- **Fiscal years:** latest UK includes fiscal-year fuel-duty changes. Do not assume all variable outputs share that basis. For custom calendar-year fuel/energy modifiers, retain the declared even-month proration exception when reconciling to April–March, recording each method and avoiding double conversion. Mixed-period totals remain provisional.
- **Geography:** national estimates only. No constituency codes or aligned weights exist for this release. Existing FRS constituency weights must not be applied to these rows; the pipeline disables that path.
- **Hosted calculator:** the shared API reports UK 2.90.2 and cannot supply this runtime. `BUDGET_API_URL` must reach UK 2.120.0/core 3.32.17. The frontend checks actual versions before forwarding inputs and fails closed if absent or mismatched. Local testing does not verify hosted preview readiness; localhost cannot serve Vercel.

## Reproduce setup

Run from the repository root after obtaining the exact private H5 with authorized access:

```sh
uv sync --frozen --extra dev
bun install --frozen-lockfile
export UK_BUDGET_DATASET=/absolute/path/to/microcosm_uk_2024_25.h5
uv run python -c 'from uk_budget_data.drill_setup import verify_runtime, verify_dataset, drill_provenance; print(verify_runtime()); print(verify_dataset()); print(drill_provenance())'
uv run pytest
bun run test
bun run lint
NEXT_PUBLIC_MOCK=1 bun run build
uv run python scripts/validate_published_data.py --pre-start
```

The empty-start validator approves setup only. After release, register the locked statement list and run numerical publication validation with `--policies <active IDs>`, alongside G2/G3 reconciliation. The drill-only dataset/runtime exception continues to apply even after those checks pass.

Run the backend and frontend in separate terminals:

```sh
NEXT_PUBLIC_MOCK=1 PORT=8000 uv run uk-budget-api
NEXT_PUBLIC_MOCK=1 BUDGET_API_URL=http://127.0.0.1:8000 bun run dev
```

Restart both services after changing the environment. `/api/health` reports actual runtime versions and separate build provenance. A household POST with `{"employment_income":30000,"policy_ids":[]}` gives baseline-only output before release. No policy impact is implied.

After verification and commit, record the new start SHA in the external G0 receipt and a new immutable local tag `drill2-g0-latest-engine-20261005`. Preserve `drill2-g0-20261005` and its prior receipt as the historical dataset-compatible setup. A commit cannot contain its own final SHA. Record later scoring and stop SHAs separately. Hosted preview verification and participant confirmation remain operational checks.
