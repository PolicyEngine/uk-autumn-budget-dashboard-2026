# W5 round 18 acceptance evidence

These are synthetic household probes, run offline with policyengine 6.6.0
and core 3.33.0. Their original sources are the coordinator's round 18
`reviews/r18/probes/` scripts. Nothing was run in or written to the caller's
checkout.

`direct-before-pe660.jsonl` contains the complete fifteen-case
run retained in the recovered checkpoint, using the exact base detector at
`a63a05e3f946d1e25f5e7fc03416c53c0aa2bdd1`. Its source SHA256 was verified as
`f8eb2a35a456e6ed9bd324dc2487b3fa0aaf96e7964c08a1365c077960a996d3`.
Eleven routes recorded no limit; four positive controls recorded their
existing limit. The base tree was read-only. Recovered files merely named
`before-*` were excluded because some contained evidence of intermediate
implementation states.
The fresh base run adds the `value_type=bool` positive control, giving
sixteen direct before rows. Its limited-tax values and recorded path agree
with the after run.
The publication generator, receipt module, template module and publication
test harness in the before tree were also verified against their base Git
blob hashes.

The final after run executes `run_attrs.py`, `run_attrs2.py`,
`run_attrs3.py`, the two one-sided-input and four positive-control cases
from `run_probes.py`, and `run_family1.py`. The receipt runs execute all
nine cases requested in the brief through the original `run_receipts.py`.
The wrapper adds its three missing CASES entries (`purchases_zero_input`,
`additional_zero_input`, `lbtt_nonres_zero_input`) and uses Scotland for
LBTT. Every receipt run still calculates `household_tax` under the actual
generation watch.
The logged receipt `publishable` field reflects certification and source
binding; it is not gate approval. A non-empty `receipt_limits` list makes
the publication gate require the `not_computable` level and reject figures.

Four completed direct after cases retain the original post-watch totals.
For the continuation only, the direct probe omits its redundant post-watch
`household_tax` figure to reduce repeated total calculations under load.
Detection, limited tax figures, build/read evidence, modifier binding and receipt processing
are unchanged. Completed cases were skipped on restart. The independent
metadata fingerprint check from `run_attrs.py` is recorded separately.

Commands use the pe660 interpreter under the coordinator's `w5/envs/`,
with `HF_HUB_OFFLINE=1`, `HUGGING_FACE_TOKEN` unset,
`PYTHONDONTWRITEBYTECODE=1`, and `PYTHONPATH=<tree>/src:<tree>:<probes>`.
Final auxiliary runs also set the supported
`POLICYENGINE_SKIP_COUNTRY_IMPORTS=1`, avoiding the unrelated US model.
The before receipt run uses the verified base tree; the after run uses the
assigned workspace.

The local continuation command (using the copied original scripts and the
wrapper described above) was:

```sh
W="$PWD" \
W5_SKIP_COMPLETED_CASES='nonres_defined_for_update,nonres_defined_for_set,nonres_value_type_bool,residential_defined_for_update' \
W5_OMIT_REDUNDANT_TOTAL=1 POLICYENGINE_SKIP_COUNTRY_IMPORTS=1 \
.w5-probes/envrun.sh run_requested_acceptance.py
```

The before receipt/control command is:

```sh
W="$PWD/.w5-probes/before-tree" W5_RECEIPTS_ONLY=1 \
W5_BEFORE_BOOL_CONTROL=1 POLICYENGINE_SKIP_COUNTRY_IMPORTS=1 \
.w5-probes/envrun.sh run_requested_acceptance.py
```

`W5_SKIP_COMPLETED_CASES` only skips direct `RP.probe` invocations already
completed. `W5_OMIT_REDUNDANT_TOTAL` only filters `household_tax` from the
direct probe's post-watch figures loop. Both controls are absent from the
original modifiers and the receipt process.

Completed runs: sixteen direct before rows, fifteen direct after rows,
nine before receipts, nine after receipts and one after metadata check.
All nine fresh before receipts record no data limit; all nine after
receipts record the expected limit. All direct after cases bind, with no
warnings; all positive-control paths and limited-tax figures are unchanged.
The before receipt/control and after continuation both exited 0 with empty
stderr. The extra before direct case is `mixed_band_and_nonres_end`, whose
after acceptance runs through the full receipt generator.
