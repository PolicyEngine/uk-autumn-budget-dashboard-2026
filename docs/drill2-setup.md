# Drill 2 setup and accepted limitations

MOCK rehearsal, 5 October 2026. No drill measures are registered before the 12:30 BST statement release.

## Immutable input contract

| Item | Pin |
|---|---|
| Dataset | `microcosm_uk_2024_25.h5` |
| Source | [policyengine/populace-uk-private](https://huggingface.co/datasets/policyengine/populace-uk-private/blob/9d4a76ba20e7cdac69ff5213614a2b90a639f9da/microcosm_uk_2024_25.h5) |
| Repository revision | `9d4a76ba20e7cdac69ff5213614a2b90a639f9da` |
| SHA-256 | `aa31bdf67c977927ea2b325567d1cf7a79d94381239bc79918a0a0fc9c9588af` |
| File bytes | 234,117,256 |
| Producer release | `microcosm-uk-2024-25-national-20261002T230158Z-5c6b3f68` |
| Dataset build model | `policyengine-uk==2.100.0` |
| Dataset build core | `policyengine-core==3.32.5` |
| Interpreter | Local Python 3.13.14; producer used 3.14.6. Only model/core are claimed to match the producer exactly. |
| Latest model at setup | `2.120.0`, deliberately not substituted |
| Input period and format | 2024; PyTables person, benefit-unit and household tables |
| Local geography | National release; no constituency identifiers or aligned weights. Constituencies unavailable. |

The producer's build and release manifests both identify these model/core versions. The downloaded bytes match the recorded hash. Keep the private H5 outside Git; credentials and raw private certification files must also remain outside Git. The pipeline verifies the exact model/core versions and H5 hash before constructing a simulation, and has no default-dataset fallback.

The installed `policyengine==6.0.0` wrapper bundles a different default (`policyengine-uk==2.90.2`). Its `managed_microsimulation` path would retain that bundled model identity while allowing a local dataset. This rehearsal therefore uses an explicit custom-release builder with `UKSingleYearDataset` and the pinned country engine. It records actual installed versions and the verified producer revision/hash. It does not claim certification by the wrapper's default bundle or modify that bundle.

## Baseline and accepted limitations

- **Local NIC mitigation applied:** both population and household drill scenarios freeze PT £241.73/week, UEL £967/week, LPL £12,570/year and UPL £50,270/year for model years 2026–2030 (tax years through 2030/31). Explicit measure overrides take precedence. Class 1 retains the old engine's 52-week annualisation (£50,284 from £967/week), so it is not exactly equivalent to the statutory annual £50,270 limit. Income dynamics can also change projected assessable pay; regression fixtures hold that pay fixed to isolate the thresholds. This addresses the missing freeze and round-threshold exposure; it does not supply every later Class 4 correction.
- **Later engine fixes accepted as absent:** see the [version-by-version inventory](drill2-engine-limitations.md). Material groups include energy double uprating; Class 4 annual maximum, mixed employment/profits, losses and pension-age rules; UC income, minimum-income-floor and claimant definitions; Housing Benefit and Council Tax Reduction; pensions and carer interactions; absolute poverty; and fiscal-year fuel duty. Their effects on this selected dataset have not been quantified. Do not present this pin as equivalent to the latest engine.
- **Fuel duty VAT basis:** accept a national VAT-inclusive household-resource result where implemented, explicitly labeled. Table 4.1's duty-only figure requires a separate duty-only comparator. Full VAT pass-through over all imputed litres includes business fuel; this can overstate the comparable VAT-inclusive national amount. Household specimens include VAT on the duty change. Do not compare the two bases without recording the difference.
- **High-value council tax surcharge on renters:** accept the old national engine's missing owner-tenure gate and label any affected measure. The household form supplies zero owned-residence value for tenants, so its incidence differs deliberately. No new national correction has been backported.
- **Fiscal years:** accept even monthly proration for calendar-year fuel/energy outputs when reconciling to April–March fiscal years. Record the method and basis in each reconciliation/scoring row; a mixed-period sum is provisional. The newer engine's fiscal fuel-duty correction is absent.
- **Geography:** national estimates only. This release excludes local-area certification and contains no constituency codes. Existing FRS constituency weight files must not be applied to these rows; the pipeline explicitly disables that path.
- **Hosted calculator:** the shared public API reports UK 2.90.2 at setup, so it cannot supply this drill's household results. `BUDGET_API_URL` must point to a backend running UK 2.100.0/core 3.32.5. The frontend verifies `/api/health` before forwarding inputs and fails closed when absent or mismatched. A locally tested backend does not establish hosted preview readiness. A localhost URL works only for a local frontend and cannot serve the Vercel preview.

## Reproduce setup

Run from the repository root, after acquiring the exact H5 with an authorized Hugging Face account:

```sh
uv sync --frozen --extra dev
bun install --frozen-lockfile
export UK_BUDGET_DATASET=/absolute/path/to/microcosm_uk_2024_25.h5
uv run python -c 'from uk_budget_data.drill_setup import verify_runtime, verify_dataset; print(verify_runtime()); print(verify_dataset())'
uv run pytest
bun run test
bun run lint
NEXT_PUBLIC_MOCK=1 bun run build
uv run python scripts/validate_published_data.py --pre-start
```

The pre-start validator checks an empty active registry and schema-only CSV files. It never approves numerical results. After release, register the locked policy list and run publication validation with `--policies <active IDs>`; use `--require-constituency` only after a separately verified local data release becomes available.

Start the backend and frontend in separate terminals:

```sh
NEXT_PUBLIC_MOCK=1 PORT=8000 uv run uk-budget-api
NEXT_PUBLIC_MOCK=1 BUDGET_API_URL=http://127.0.0.1:8000 bun run dev
```

`GET /api/health` returns actual model/core versions. `POST /api/personal-impact` with `{"employment_income":30000,"policy_ids":[]}` returns a baseline-only response before release. This is a runtime check, not a published policy estimate. The page intentionally offers no calculation until measures are registered.

After the checked setup is committed, record `git rev-parse HEAD` in the external G0 receipt or create an immutable local tag `drill2-g0-20261005`. A commit cannot contain its own final SHA. Record the separate scored/stop SHAs later. Preview deployment, authenticated UI check, and both participants' role confirmation remain separate readiness checks.
