# Drill 5: the 15 most probable measures, Monday 26 October 2026 (MOCK DATA, do not merge)

The last rehearsal before the Budget on Wednesday 28 October. Unlike drills
1–4, the measures are chosen openly: the fifteen most probable Autumn Budget
2026 measures PolicyEngine UK can model on policyengine 6.10.2
(policyengine-uk 2.132.6), ranked by the Manifold markets on the
[UK Autumn Budget 2026 topic](https://manifold.markets/topic/uk-autumn-budget-2026)
(probabilities as of 25 October) and reporting up to 25 October. Values marked
"mock" are drill choices where reporting gives no figure.

Run the drill set with `UK_BUDGET_MEASURE_SET=drill5`. Without it, `main`'s
nine candidates are unchanged. The State Pension protection extension is an
alternative to the base protection, so the combined run leaves it out (14
members).

On 26 October the base protection (`state_pension_income_tax_protection`)
took the design reported that day (BBC; The Times): the allowance of the full
new State Pension only for people whose only income is the State Pension
(savings interest aside). Same id; the earlier tapered design stays as a
switch (`STATE_PENSION_PROTECTION_DESIGNS`), as on #182.

## Engine and data

From 26 October the drill runs on the Budget pair's model and national data,
ahead of their release: `policyengine` 6.11.0 is built from
PolicyEngine/policyengine.py@324ecad6 (branch
`uk-certify-microcosm-pair-2151`, the draft certification of the pair), which
pins policyengine-uk 2.151.0 (policyengine-core 3.33.3) and certifies the
Microcosm national `microcosm-uk-2024-25-national-20261025T091414Z-a6299504`
as the bundle's default dataset. `pe.uk.managed_microsimulation()` resolves
it from the bundle, as for a release. The wheel is vendored in `vendor/` and
installed from there (`[tool.uv.sources]`), because policyengine certifies a
receipt only for an index or archive install; from a git source every
receipt is uncertified, so nothing could be staged provisional or approved.

That commit is national-only: it routes no constituency or local-authority
regions. When the local-area cut from the same spine is published (around
13:30), the certification adds it and this branch re-pins to that commit for
G4. Budget day uses the released bundle instead; this branch never merges.

## Goals

1. Run #104's approval path end to end on fifteen measures: G2
   (`generate --artifacts`), staging with expected effects and attestations,
   approval, G3 (combined) and G4 (results by area). Time every step.
2. If the `uk-budget-2026-hf-token` Modal secret exists, run G2 and G4 on
   Modal (#139, #142) and compare the times and cost with the local run.
3. Exercise the "provisional" path: the UC measure reads the lagged CPI
   uprating index, which the model flags as provisional (pe-uk #2533).

Measures, specifics and sources are in the drill issue.
