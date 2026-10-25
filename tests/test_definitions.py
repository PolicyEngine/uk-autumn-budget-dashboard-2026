"""Each measure's definition as its receipt binds it (uk_budget_data.definitions).

The household API recomputes a measure's receipt identities at the approved
receipt's commit from its own code, and the page compares them with the
receipt. These tests hold the properties that comparison relies on:

- the definition is the receipt's own identity function at that commit
  (the oracle), for every registered measure and any commit;
- content-bound sides don't depend on the commit, and code-bound sides do;
- it is deterministic, and the same in another process;
- generation's configuration and the household calculation's give the
  same identities;
- a changed parameter, an edited modifier module or another module source
  is a difference, and nothing else is.
"""

import json
import os
import subprocess
import sys
import textwrap
import uuid

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from uk_budget_data import definitions, household_impact
from uk_budget_data.models import DataConfig, Reform
from uk_budget_data.publication import receipt
from uk_budget_data.reforms import get_reform

MEASURES = household_impact.measure_ids()
COMMIT = "0123456789abcdef" * 2 + "01234567"
OTHER = "fedcba9876543210" * 2 + "76543210"

commits = st.one_of(
    st.text("0123456789abcdef", min_size=40, max_size=40),
    st.text("0123456789abcdef", min_size=64, max_size=64),
)


@pytest.fixture(autouse=True)
def _fresh_cache():
    definitions._definition.cache_clear()
    yield
    definitions._definition.cache_clear()


def _oracle(reform, git_sha, config=None):
    baseline, own = receipt.measure_identities(
        reform, config or DataConfig(), receipt.CodeRevision(git_sha, True)
    )
    return {
        "git_sha": git_sha,
        "baseline": definitions.identity_core(baseline),
        "reform": definitions.identity_core(own),
    }


def test_the_fields_compared_are_the_receipt_gates():
    assert definitions.IDENTITY_FIELDS == receipt._IDENTITY_FIELDS


def test_every_registered_measure_can_be_bound():
    for measure_id in MEASURES:
        definition = definitions.measure_definition(measure_id, COMMIT)
        assert "error" not in definition, (measure_id, definition)
        assert definition["git_sha"] == COMMIT


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(measure_id=st.sampled_from(MEASURES), git_sha=commits)
def test_the_definition_is_the_receipts_identity_at_that_commit(
    measure_id, git_sha
):
    assert definitions.measure_definition(measure_id, git_sha) == _oracle(
        get_reform(measure_id), git_sha
    )


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(measure_id=st.sampled_from(MEASURES), one=commits, two=commits)
def test_only_code_bound_sides_depend_on_the_commit(measure_id, one, two):
    first = definitions.measure_definition(measure_id, one)
    second = definitions.measure_definition(measure_id, two)
    for side in ("baseline", "reform"):
        if first[side]["binding"] == "content":
            assert first[side] == second[side]
        elif one != two:
            assert (
                first[side]["reform_sha256"] != second[side]["reform_sha256"]
            )
        else:
            assert first[side] == second[side]


def test_some_measures_are_code_bound_and_some_by_content():
    # Otherwise the property above would hold vacuously for one kind.
    bindings = {
        definitions.measure_definition(m, COMMIT)["reform"]["binding"]
        for m in MEASURES
    }
    assert bindings == {"content", "code_revision"}


def test_it_is_deterministic_and_a_copy():
    first = definitions.measure_definition(MEASURES[0], COMMIT)
    first["reform"]["reform_sha256"] = "tampered"
    second = definitions.measure_definition(MEASURES[0], COMMIT)
    assert second["reform"]["reform_sha256"] != "tampered"
    definitions._definition.cache_clear()
    assert definitions.measure_definition(MEASURES[0], COMMIT) == second


def test_it_is_the_same_in_another_process(tmp_path):
    """No dependence on the working directory, hash seed or import order:
    a fresh interpreter elsewhere gives the same definitions."""
    script = textwrap.dedent(
        f"""
        import json
        from uk_budget_data import definitions, household_impact
        print(json.dumps({{
            m: definitions.measure_definition(m, {COMMIT!r})
            for m in household_impact.measure_ids()
        }}, sort_keys=True))
        """
    )
    output = subprocess.run(
        [sys.executable, "-c", script],
        cwd=tmp_path,
        env={**os.environ, "PYTHONHASHSEED": "12345"},
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    here = {m: definitions.measure_definition(m, COMMIT) for m in MEASURES}
    assert json.loads(output.strip().splitlines()[-1]) == here


def test_generations_configuration_gives_the_same_identities(tmp_path):
    """The CLI's DataConfig sets paths and years; only a configured
    baseline would reach an identity, and neither sets one."""
    generation = DataConfig(
        output_dir=tmp_path / "out",
        data_dir=tmp_path / "data",
        data_inputs_dir=tmp_path / "inputs",
        years=[2027, 2028],
    )
    for measure_id in MEASURES:
        assert definitions.measure_definition(measure_id, COMMIT) == _oracle(
            get_reform(measure_id), COMMIT, generation
        )


def test_a_configured_baseline_is_a_different_definition():
    """The negative of the above: if generation ever configured a
    baseline, the API's default would not reproduce it, and the page
    would show the measure unavailable rather than compare it wrongly."""
    measure = next(
        get_reform(m)
        for m in MEASURES
        if not get_reform(m).has_custom_baseline()
    )
    configured = DataConfig(
        baseline_parameter_changes={
            "gov.hmrc.income_tax.allowances.personal_allowance.amount": {
                "2027": 13_000
            }
        }
    )
    approved = _oracle(measure, COMMIT, configured)
    reported = definitions.measure_definition(measure.id, COMMIT)
    assert any(
        "baseline" in problem
        for problem in definitions.differences(approved, reported)
    )


@settings(
    max_examples=40,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(measure_id=st.sampled_from(MEASURES), git_sha=commits)
def test_a_definition_compared_with_itself_has_no_differences(
    measure_id, git_sha
):
    definition = definitions.measure_definition(measure_id, git_sha)
    assert definitions.differences(definition, definition) == []


@settings(
    max_examples=60,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(
    measure_id=st.sampled_from(MEASURES),
    side=st.sampled_from(["baseline", "reform"]),
    field=st.sampled_from(definitions.IDENTITY_FIELDS),
    value=st.one_of(st.none(), st.text(max_size=8)),
)
def test_any_one_changed_field_is_a_difference(measure_id, side, field, value):
    approved = definitions.measure_definition(measure_id, COMMIT)
    reported = definitions.measure_definition(measure_id, COMMIT)
    if reported[side][field] == value:
        return
    reported[side][field] = value
    assert definitions.differences(approved, reported) == [
        f"its {side} {field} differs"
    ]


def test_a_missing_errored_or_other_commit_report_is_a_difference():
    approved = definitions.measure_definition(MEASURES[0], COMMIT)
    assert definitions.differences(approved, None)
    assert definitions.differences(
        approved, {"git_sha": COMMIT, "error": "cannot bind"}
    )
    elsewhere = definitions.measure_definition(MEASURES[0], OTHER)
    assert any(
        "commit" in problem
        for problem in definitions.differences(approved, elsewhere)
    )
    assert definitions.differences(approved, {"git_sha": COMMIT}) == [
        "no baseline identity reported",
        "no reform identity reported",
    ]


def test_a_changed_parameter_value_is_a_different_definition(monkeypatch):
    measure = next(
        get_reform(m) for m in MEASURES if get_reform(m).parameter_changes
    )
    approved = definitions.measure_definition(measure.id, COMMIT)
    path, values = next(iter(measure.parameter_changes.items()))
    period, value = next(iter(values.items()))
    changed = measure.model_copy(
        update={
            "parameter_changes": {
                **measure.parameter_changes,
                path: {**values, period: value + 1},
            }
        }
    )
    monkeypatch.setattr(definitions, "get_reform", lambda _id: changed)
    definitions._definition.cache_clear()
    reported = definitions.measure_definition(measure.id, COMMIT)
    assert "its reform reform_sha256 differs" in definitions.differences(
        approved, reported
    )


def _modifier_module(tmp_path, monkeypatch, body: str):
    name = f"definitions_mutant_{uuid.uuid4().hex}"
    path = tmp_path / f"{name}.py"
    path.write_text(body)
    monkeypatch.syspath_prepend(str(tmp_path))
    module = __import__(name)
    monkeypatch.setitem(sys.modules, name, module)
    return module, path


MODIFIER = """RATE = 0.2


def modifier(sim):
    return sim
"""


def _bind(monkeypatch, module):
    reform = Reform(
        id="mutant", name="Mutant", simulation_modifier=module.modifier
    )
    monkeypatch.setattr(definitions, "get_reform", lambda _id: reform)
    definitions._definition.cache_clear()
    return definitions.measure_definition("mutant", COMMIT)


def test_a_modifier_module_edited_after_import_cannot_be_bound(
    tmp_path, monkeypatch
):
    module, path = _modifier_module(tmp_path, monkeypatch, MODIFIER)
    bound = _bind(monkeypatch, module)
    assert bound["reform"]["binding"] == "code_revision"
    path.write_text(MODIFIER.replace("0.2", "0.25"))
    edited = _bind(monkeypatch, module)
    assert "error" in edited
    assert definitions.differences(bound, edited)


def test_another_module_source_is_a_different_definition(
    tmp_path, monkeypatch
):
    """A constant changed elsewhere in the modifier's module, the function
    itself untouched, changes the identity: the receipt binds the whole
    module (so a fix anywhere in budget_measures.py changes every measure
    with a modifier there)."""
    first, _ = _modifier_module(tmp_path, monkeypatch, MODIFIER)
    second, _ = _modifier_module(
        tmp_path, monkeypatch, MODIFIER.replace("0.2", "0.25")
    )
    one, two = _bind(monkeypatch, first), _bind(monkeypatch, second)
    assert "error" not in one and "error" not in two
    assert one["reform"]["reform_sha256"] != two["reform"]["reform_sha256"]


@given(pairs=st.dictionaries(st.sampled_from(MEASURES), commits, max_size=5))
def test_requests_parse_back_to_what_was_named(pairs):
    values = [f"{m}:{sha}" for m, sha in pairs.items()]
    assert definitions.parse_requested(values, MEASURES) == pairs


@pytest.mark.parametrize(
    "value",
    [
        "",
        MEASURES[0],
        f"{MEASURES[0]}:",
        f":{COMMIT}",
        f"{MEASURES[0]}:{COMMIT[:-1]}",
        f"{MEASURES[0]}:{COMMIT}0",
        f"{MEASURES[0]}:{COMMIT.upper()}",
        f"{MEASURES[0]}: {COMMIT}",
        f"no_such_measure:{COMMIT}",
        f"autumn_budget_2026_combined:{COMMIT}",
    ],
)
def test_a_malformed_request_is_refused(value):
    with pytest.raises(ValueError):
        definitions.parse_requested([value], MEASURES)


def test_a_measure_named_twice_is_refused():
    with pytest.raises(ValueError, match="named twice"):
        definitions.parse_requested(
            [f"{MEASURES[0]}:{COMMIT}", f"{MEASURES[0]}:{COMMIT}"], MEASURES
        )
