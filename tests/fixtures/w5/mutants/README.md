# W5 mutation evidence

Each `*-mutants.json` is the coordinator runner's required JSON map of
mutation name to `[file, old, new]`. Each `old` must occur exactly once.
`mutation-targets.json` names the test or node id used for each mutation.
`results.json` records the observed result and failing tests. `results.txt`
preserves the coordinator runner's result lines, including repeat runs.

Run from a disposable checkout containing the final W5 sources. The runner
temporarily edits the named files and restores their original bytes.

```sh
export W5_MUTANT_PYTHON="$HOME/PolicyEngine/_drafts/continuous-budget-ci/w5/envs/pe660/bin/python"
export HF_HUB_OFFLINE=1 POLICYENGINE_SKIP_COUNTRY_IMPORTS=1
unset HUGGING_FACE_TOKEN
export PYTHONPATH=src:.
export PYTEST_ADDOPTS="--basetemp=$TMPDIR/w5-mutants"

"$W5_MUTANT_PYTHON" "$HOME/PolicyEngine/_drafts/continuous-budget-ci/w5/scripts/mutants_files.py" \
  "$PWD/tests/fixtures/w5/mutants/serial_python.py" \
  tests/fixtures/w5/mutants/detector-mutants.json \
  tests/test_data_limits_hardening_unit.py
```

For another group, supply its map, the target from `mutation-targets.json`
and the mutation name. The coordinator runner remains unchanged;
`serial_python.py` changes its `-n 2` argument to `-n 0` and executes the
chosen environment's Python. This avoids duplicate model imports on the
shared machine. The first two input mutations ran with the runner's original
two workers and were repeated serially on the final source; subsequent
mutations ran serially.

The installed wrapper's supported `POLICYENGINE_SKIP_COUNTRY_IMPORTS=1`
avoids loading unused country wrappers. The World baseline tests explicitly
import the UK model. The isolated unit tests load the actual source modules
and control unrelated dependencies, while the World-based and Hypothesis
tests retain coverage of complete receipt and publication behaviour.

All three fast unit files passed on the unmodified sources before mutation.
An earlier parallel baseline was interrupted during shared-machine memory
pressure and is not counted as a successful baseline.

The final evidence contains 40 unique mutants: 14 detector, 9 template,
13 gate, 2 attestation-input and 2 path-provenance mutations. All were
killed; none survived or remained unrun. The final detector mutations
were repeated after the bracket-read, cached-ancestor and empty-registry
corrections.
The source SHA-256 values in `results.json` match the unmodified snapshot
and the final project sources. Earlier completed repeat attempts are
retained; an interrupted pre-final detector repeat is not a completed
mutation result.

The final unmodified baseline passed 53 tests on both pe660 and pe6100:
14 in `test_data_limits_hardening_unit.py`, 33 in
`test_publication_hardening_unit.py`, and 6 in `test_attestation_paths.py`.
Two complete World-based publication targets also passed on pe660 before
the corresponding mutations. Baseline JUnit counts and durations are
included in `results.json`.
