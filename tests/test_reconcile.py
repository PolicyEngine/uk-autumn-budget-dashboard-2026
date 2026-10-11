"""Tests for Treasury reconciliation and reform responsiveness."""

import json

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

from uk_budget_data.publication.reconcile import (
    ACCEPTED,
    AWAITING_SOURCE,
    FAILED,
    NOT_COMPARABLE,
    PASS,
    UNSUPPORTED,
    ExceptionEntry,
    MappingRow,
    Policy,
    ReconciliationInputError,
    SourceRow,
    allowance_bn,
    fiscal_year_label,
    load_exceptions,
    load_mapping,
    load_policy,
    load_sources,
    main,
    reconcile,
    within_allowance,
)
from uk_budget_data.publication.responsiveness import (
    INERT,
    RESPONSIVE,
    UNDECLARED,
    WRONG_DIRECTION,
    ExpectedEffect,
    check_responsiveness,
)

POLICY = Policy()
DIGEST = "a" * 64
OTHER_DIGEST = "b" * 64


def source(year, value, basis="static_costing", row_id="1", source_id="S"):
    return SourceRow(source_id, row_id, fiscal_year_label(year), value, basis)


def link(measure="m", row_id="1", source_id="S", **extra):
    return MappingRow(measure, source_id, row_id, **extra)


def run(budgetary, sources, **kwargs):
    defaults = dict(
        measure_id="m",
        outputs_sha256=DIGEST,
        sources=sources,
        mapping=[link()],
        exceptions=[],
        policy=POLICY,
        expected=[],
    )
    defaults.update(kwargs)
    return reconcile(budgetary, **defaults)


def exception(year, residual, digest=DIGEST, **extra):
    fields = dict(
        measure_id="m",
        fiscal_year=fiscal_year_label(year),
        residual_bn=residual,
        explanation_class="behavioural",
        explanation="Static model; the costing includes a behavioural yield.",
        reviewer="Reviewer",
        accepted_at="2026-10-28T15:00:00Z",
        outputs_sha256=digest,
    )
    fields.update(extra)
    return ExceptionEntry(**fields)


def test_fiscal_year_label():
    assert fiscal_year_label(2027) == "2027-28"
    assert fiscal_year_label(2099) == "2099-00"
    assert fiscal_year_label(2027, 1) == "2028-29"


def test_within_ten_percent_passes_and_beyond_fails():
    result = run(
        {2027: 1.09, 2028: 1.20}, [source(2027, 1.0), source(2028, 1.0)]
    )
    statuses = {row["year"]: row["status"] for row in result["rows"]}
    assert statuses == {2027: PASS, 2028: FAILED}
    assert result["summary"]["status"] == FAILED


def test_small_costings_use_the_absolute_floor():
    # £20m against a £60m costing is 67% off but within the £50m floor.
    result = run({2027: 0.02}, [source(2027, 0.06)])
    assert result["rows"][0]["status"] == PASS
    assert result["rows"][0]["allowance_bn"] == POLICY.absolute_floor_bn


def test_zero_costing_tolerates_only_treasury_rounding():
    ok = run(
        {2027: 0.002, 2028: -1.0}, [source(2027, 0.0), source(2028, -1.0)]
    )
    assert ok["rows"][0]["status"] == PASS
    bad = run(
        {2027: 0.04, 2028: -1.0}, [source(2027, 0.0), source(2028, -1.0)]
    )
    assert bad["rows"][0]["status"] == FAILED


def test_unentered_year_is_awaiting_source():
    result = run({2027: 1.0, 2028: 1.0}, [source(2027, 1.0)])
    assert result["rows"][1]["status"] == AWAITING_SOURCE
    assert result["summary"]["status"] == AWAITING_SOURCE


def test_not_comparable_needs_reason_and_reviewer():
    with pytest.raises(ReconciliationInputError, match="reason"):
        link(status=NOT_COMPARABLE)
    mapping = [
        link(
            status=NOT_COMPARABLE,
            reason="Costing is for businesses only",
            reviewer="Reviewer",
        )
    ]
    result = run(
        {2027: 1.0},
        [],
        mapping=mapping,
        expected=[ExpectedEffect("m", "positive", 2027)],
    )
    assert result["rows"][0]["status"] == NOT_COMPARABLE
    assert result["rows"][0]["reviewer"] == "Reviewer"
    assert result["summary"]["status"] == PASS


def test_unsupported_years_are_never_passed():
    result = run(
        {2030: 1.0, 2031: 1.0},
        [source(2030, 1.0), source(2031, 1.0)],
        supported_years={2030},
    )
    statuses = {row["year"]: row["status"] for row in result["rows"]}
    assert statuses == {2030: PASS, 2031: UNSUPPORTED}


def test_post_behavioural_is_reported_alongside_and_never_gated():
    result = run(
        {2027: 1.0},
        [source(2027, 1.0), source(2027, 0.4, basis="post_behavioural")],
    )
    row = result["rows"][0]
    assert row["status"] == PASS
    assert row["alongside"]["basis"] == "post_behavioural"
    assert row["alongside"]["residual_bn"] == pytest.approx(0.6)


def test_mapped_rows_are_scaled_and_summed():
    sources = [source(2027, 1.0, row_id="1"), source(2027, 0.5, row_id="2")]
    mapping = [link(row_id="1"), link(row_id="2", scale=2.0)]
    result = run({2027: 2.0}, sources, mapping=mapping)
    assert result["rows"][0]["comparator"]["value_bn"] == pytest.approx(2.0)
    assert result["rows"][0]["status"] == PASS


def test_exception_accepts_only_the_exact_outputs():
    budgetary, sources = {2027: 1.5}, [source(2027, 1.0)]
    accepted = run(budgetary, sources, exceptions=[exception(2027, 0.5)])
    assert accepted["rows"][0]["status"] == ACCEPTED
    assert accepted["summary"]["status"] == ACCEPTED
    assert accepted["rows"][0]["exception"]["reviewer"] == "Reviewer"

    other_outputs = run(
        budgetary, sources, exceptions=[exception(2027, 0.5, OTHER_DIGEST)]
    )
    assert other_outputs["rows"][0]["status"] == FAILED


def test_exception_with_the_wrong_residual_is_rejected():
    result = run(
        {2027: 1.5}, [source(2027, 1.0)], exceptions=[exception(2027, 0.3)]
    )
    assert result["rows"][0]["status"] == FAILED
    assert "does not match" in result["rows"][0]["exception_rejected"]


def test_exception_needs_a_closed_class_reviewer_and_explanation():
    with pytest.raises(ReconciliationInputError, match="closed list"):
        exception(2027, 0.5, explanation_class="vibes")
    with pytest.raises(ReconciliationInputError, match="reviewer"):
        exception(2027, 0.5, reviewer=" ")
    with pytest.raises(ReconciliationInputError, match="explanation"):
        exception(2027, 0.5, explanation="")


# --- responsiveness -------------------------------------------------------


def test_exact_zero_against_a_real_costing_is_inert():
    result = run({2027: 0.0}, [source(2027, -3.0)])
    assert result["responsiveness"]["status"] == INERT


def test_an_exception_cannot_rescue_an_inert_measure():
    result = run(
        {2027: 0.0}, [source(2027, -3.0)], exceptions=[exception(2027, 3.0)]
    )
    assert result["summary"]["status"] == ACCEPTED
    assert result["responsiveness"]["status"] == INERT


def test_a_sliver_of_the_costing_is_inert_not_small():
    # 1% of a £3bn costing is £30m: above the absolute minimum, below 5%.
    result = run({2027: -0.03}, [source(2027, -3.0)])
    assert result["responsiveness"]["status"] == INERT


def test_wrong_sign_is_wrong_direction():
    result = run({2027: 2.0}, [source(2027, -3.0)])
    assert result["responsiveness"]["status"] == WRONG_DIRECTION


def test_no_expectation_at_all_is_undeclared():
    result = run({2027: 1.0}, [])
    assert result["responsiveness"]["status"] == UNDECLARED


def test_declared_window_applies_before_any_treasury_figure():
    expected = [ExpectedEffect("m", "negative", 2028)]
    moving = run({2027: 0.0, 2028: -1.0}, [], expected=expected)
    assert moving["responsiveness"]["status"] == RESPONSIVE
    assert [r["year"] for r in moving["responsiveness"]["rows"]] == [2028]
    inert = run({2027: 0.0, 2028: 0.0}, [], expected=expected)
    assert inert["responsiveness"]["status"] == INERT


def test_table_41_alone_sets_the_expectation():
    """Before static costings are entered, Table 4.1 still implies a sign."""
    result = run({2027: 0.0}, [source(2027, -3.0, basis="post_behavioural")])
    assert result["rows"][0]["status"] == AWAITING_SOURCE
    assert result["responsiveness"]["status"] == INERT


def test_expected_effect_validation():
    with pytest.raises(ValueError, match="direction"):
        ExpectedEffect("m", "up", 2027)
    with pytest.raises(ValueError, match="to_year"):
        ExpectedEffect("m", "positive", 2028, 2027)


# --- properties -----------------------------------------------------------

amounts = st.floats(-50, 50, allow_nan=False, allow_infinity=False)
positive = st.floats(0.01, 100, allow_nan=False, allow_infinity=False)


@given(
    treasury=amounts, fraction=st.floats(0, 2), sign=st.sampled_from([-1, 1])
)
def test_boundary_is_exactly_the_allowance(treasury, fraction, sign):
    allowance = allowance_bn(treasury, POLICY)
    pe = treasury + sign * fraction * allowance
    verdict = within_allowance(pe, treasury, POLICY)
    gap = abs(pe - treasury)
    if gap <= allowance:
        assert verdict
    elif gap > allowance + 1e-9:
        assert not verdict
    assert within_allowance(treasury, treasury, POLICY)


@given(pe=amounts, treasury=amounts)
def test_verdict_is_invariant_to_flipping_both_signs(pe, treasury):
    assert within_allowance(pe, treasury, POLICY) == within_allowance(
        -pe, -treasury, POLICY
    )


@given(pe=amounts, treasury=amounts, k=positive)
def test_verdict_is_invariant_to_rescaling_units(pe, treasury, k):
    scaled = Policy(
        absolute_floor_bn=POLICY.absolute_floor_bn * k,
        zero_tolerance_bn=POLICY.zero_tolerance_bn * k,
    )
    gap = abs(pe - treasury)
    assume(abs(gap - allowance_bn(treasury, POLICY)) > 1e-6)
    assume(abs(treasury) > 1e-6 or treasury == 0)
    assert within_allowance(pe, treasury, POLICY) == within_allowance(
        pe * k, treasury * k, scaled
    )


digests = st.text("0123456789abcdef", min_size=64, max_size=64)


@given(pe=amounts, treasury=amounts, artifact=digests, accepted_for=digests)
def test_an_exception_never_applies_to_other_outputs(
    pe, treasury, artifact, accepted_for
):
    assume(not within_allowance(pe, treasury, POLICY))
    result = run(
        {2027: pe},
        [source(2027, treasury)],
        outputs_sha256=artifact,
        exceptions=[exception(2027, pe - treasury, accepted_for)],
    )
    expected = ACCEPTED if artifact == accepted_for else FAILED
    assert result["rows"][0]["status"] == expected


@given(
    values=st.dictionaries(st.integers(2026, 2031), amounts, min_size=1),
    costings=st.dictionaries(st.integers(2026, 2031), amounts),
)
def test_responsive_means_every_expected_year_moves_the_right_way(
    values, costings
):
    result = check_responsiveness(
        values,
        measure_id="m",
        declarations=[],
        comparators_bn=costings,
        min_response_bn=POLICY.min_response_bn,
        min_response_share=POLICY.min_response_share,
        zero_tolerance_bn=POLICY.zero_tolerance_bn,
    )
    for row in result["rows"]:
        costing = costings[row["year"]]
        assert abs(costing) > POLICY.zero_tolerance_bn
    if result["status"] == RESPONSIVE:
        assert result["rows"]
        for row in result["rows"]:
            costing = costings[row["year"]]
            assert row["pe_bn"] * costing > 0
            assert abs(row["pe_bn"]) >= POLICY.min_response_share * abs(
                costing
            )
            assert abs(row["pe_bn"]) >= POLICY.min_response_bn
    # A measure that is zero wherever the Treasury expects an effect never
    # passes as responsive.
    if result["rows"] and all(values[r["year"]] == 0 for r in result["rows"]):
        assert result["status"] == INERT


# --- files and CLI --------------------------------------------------------

SOURCE_HEADER = (
    "source_id,document,table,row_id,row_label,fiscal_year,value_bn,basis,"
    "sign_convention,head,notes\n"
)


def write_inputs(tmp_path, static_2028="-2.0"):
    inputs = tmp_path / "treasury"
    (inputs / "sources").mkdir(parents=True)
    (inputs / "sources" / "S.csv").write_text(
        SOURCE_HEADER
        + "S,Budget,costings,7,Rate change,2027-28,-1.0,static_costing,"
        "exchequer_positive,tax,\n"
        f"S,Budget,costings,7,Rate change,2028-29,{static_2028},"
        "static_costing,exchequer_positive,tax,\n"
    )
    (inputs / "mapping.csv").write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer\n"
        "rate_change,S,7,,,,,\n"
    )
    (inputs / "policy.yaml").write_text(
        "relative_tolerance: 0.10\nabsolute_floor_bn: 0.05\n"
    )
    return inputs


def write_artifact(tmp_path, values):
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    lines = ["reform_id,reform_name,year,value"]
    lines += [f"rate_change,Rate change,{y},{v}" for y, v in values.items()]
    (artifact / "budgetary_impact.csv").write_text("\n".join(lines) + "\n")
    (artifact / "receipt.json").write_text(
        json.dumps(
            {
                "execution_receipt": {"outputs_sha256": DIGEST},
                "dashboard": {
                    "measure_ids": ["rate_change"],
                    "dataset_years": [2027, 2028],
                },
            }
        )
    )
    return artifact


def test_cli_writes_reconciliation_beside_the_artifact(tmp_path, capsys):
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05, 2028: -1.9})
    code = main([str(artifact), "--inputs", str(inputs)])
    assert code == 0
    written = json.loads((artifact / "reconciliation.json").read_text())
    assert written["schema"] == "uk-budget-dashboard/reconciliation/v1"
    assert written["outputs_sha256"] == DIGEST
    assert written["summary"]["status"] == PASS
    assert written["responsiveness"]["status"] == RESPONSIVE
    assert "2027-28: ours -1.050bn, Treasury -1.000bn -> pass" in (
        capsys.readouterr().out
    )


def test_cli_exits_non_zero_on_a_failed_year(tmp_path):
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05, 2028: -1.0})
    assert main([str(artifact), "--inputs", str(inputs)]) == 1


def test_cli_blank_costing_is_awaiting_source(tmp_path):
    inputs = write_inputs(tmp_path, static_2028="")
    artifact = write_artifact(tmp_path, {2027: -1.05, 2028: -1.9})
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 1
    assert not (artifact / "reconciliation.json").exists()


def test_loaders_reject_bad_inputs(tmp_path):
    inputs = write_inputs(tmp_path)
    (inputs / "policy.yaml").write_text("tolerance: 0.1\n")
    with pytest.raises(ReconciliationInputError, match="unknown keys"):
        load_policy(inputs / "policy.yaml")
    (inputs / "exceptions.yaml").write_text("- measure_id: m\n")
    with pytest.raises(ReconciliationInputError, match="missing"):
        load_exceptions(inputs / "exceptions.yaml")
    (inputs / "sources" / "bad.csv").write_text(
        SOURCE_HEADER + "S,B,t,1,x,2027-28,1.0,gross,exchequer_positive,tax,\n"
    )
    with pytest.raises(ReconciliationInputError, match="basis"):
        load_sources(inputs / "sources")
    assert load_mapping(inputs / "mapping.csv")[0].scale == 1.0
