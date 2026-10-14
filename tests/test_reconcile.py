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
    budgetary_from_rows,
    comparison_sha256,
    fiscal_year_label,
    load_exceptions,
    load_expected,
    load_mapping,
    load_policy,
    load_sources,
    main,
    reconcile,
    within_allowance,
)
from uk_budget_data.publication.responsiveness import (
    INERT,
    MISSING,
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
        years=sorted(budgetary),
    )
    defaults.update(kwargs)
    return reconcile(budgetary, **defaults)


# Stands in for a comparison digest where none is compared.
NO_COMPARISON = "c" * 64


def exception(
    year, residual, digest=DIGEST, sources=None, mapping=None, **extra
):
    """A reviewed exception. Given the sources, it names the comparison
    they make, as a reviewer copies it from ``reconciliation.json``."""
    comparator = None
    if sources is not None:
        comparator = comparison_sha256(
            "m",
            year,
            sources,
            mapping or [link()],
            extra.pop("policy", POLICY),
        )
    fields = dict(
        measure_id="m",
        fiscal_year=fiscal_year_label(year),
        residual_bn=residual,
        explanation_class="behavioural",
        explanation="Static model; the costing includes a behavioural yield.",
        reviewer="Reviewer",
        accepted_at="2026-10-28T15:00:00Z",
        outputs_sha256=digest,
        comparator_sha256=comparator or NO_COMPARISON,
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
        expected=[ExpectedEffect("m", "positive", 2027, reviewer="R")],
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
    mapping = [
        link(row_id="1"),
        link(row_id="2", scale=2.0, reason="Two years in one", reviewer="R"),
    ]
    result = run({2027: 2.0}, sources, mapping=mapping)
    assert result["rows"][0]["comparator"]["value_bn"] == pytest.approx(2.0)
    assert result["rows"][0]["status"] == PASS


def test_exception_accepts_only_the_exact_outputs():
    budgetary, sources = {2027: 1.5}, [source(2027, 1.0)]
    accepted = run(
        budgetary, sources, exceptions=[exception(2027, 0.5, sources=sources)]
    )
    assert accepted["rows"][0]["status"] == ACCEPTED
    assert accepted["summary"]["status"] == ACCEPTED
    assert accepted["rows"][0]["exception"]["reviewer"] == "Reviewer"

    other_outputs = run(
        budgetary,
        sources,
        exceptions=[exception(2027, 0.5, OTHER_DIGEST, sources=sources)],
    )
    assert other_outputs["rows"][0]["status"] == FAILED


def test_exception_with_the_wrong_residual_is_rejected():
    sources = [source(2027, 1.0)]
    result = run(
        {2027: 1.5},
        sources,
        exceptions=[exception(2027, 0.3, sources=sources)],
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
    sources = [source(2027, -3.0)]
    result = run(
        {2027: 0.0},
        sources,
        exceptions=[exception(2027, 3.0, sources=sources)],
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
    expected = [ExpectedEffect("m", "negative", 2028, reviewer="R")]
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
        ExpectedEffect("m", "up", 2027, reviewer="R")
    with pytest.raises(ValueError, match="to_year"):
        ExpectedEffect("m", "positive", 2028, 2027, reviewer="R")


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
    sources = [source(2027, treasury)]
    result = run(
        {2027: pe},
        sources,
        outputs_sha256=artifact,
        exceptions=[
            exception(2027, pe - treasury, accepted_for, sources=sources)
        ],
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


def write_artifact(tmp_path, values, years=None, rows=None):
    artifact = tmp_path / "artifact"
    artifact.mkdir()
    lines = ["reform_id,reform_name,year,value"]
    lines += rows or [
        f"rate_change,Rate change,{y},{v}" for y, v in values.items()
    ]
    (artifact / "budgetary_impact.csv").write_text("\n".join(lines) + "\n")
    (artifact / "receipt.json").write_text(
        json.dumps(
            {
                "execution_receipt": {
                    "outputs_sha256": DIGEST,
                    "years": sorted(values) if years is None else years,
                },
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


# --- review findings (12 October) -----------------------------------------


def test_a_partly_entered_comparator_is_awaiting_not_passed():
    """Two mapped rows, one entered: the partial sum must never pass."""
    result = run(
        {2027: 1.0},
        [source(2027, 1.0, row_id="1")],
        mapping=[link(row_id="1"), link(row_id="2")],
        expected=[ExpectedEffect("m", "positive", 2027, reviewer="R")],
    )
    row = result["rows"][0]
    assert row["status"] == AWAITING_SOURCE
    assert row["missing"] == [
        {"source_id": "S", "row_id": "2", "fiscal_year": "2027-28"}
    ]
    assert result["summary"]["status"] == AWAITING_SOURCE


def test_a_missing_comparable_row_beside_an_excluded_one_is_awaiting():
    result = run(
        {2027: 1.0},
        [],
        mapping=[
            link(row_id="1"),
            link(
                row_id="2",
                status=NOT_COMPARABLE,
                reason="Scottish rates",
                reviewer="Reviewer",
            ),
        ],
        expected=[ExpectedEffect("m", "positive", 2027, reviewer="R")],
    )
    assert result["rows"][0]["status"] == AWAITING_SOURCE
    assert result["summary"]["status"] == AWAITING_SOURCE


def test_excluded_rows_leave_the_comparable_ones_gated():
    result = run(
        {2027: 1.0},
        [source(2027, 1.0, row_id="1"), source(2027, 9.0, row_id="2")],
        mapping=[
            link(row_id="1"),
            link(
                row_id="2",
                status=NOT_COMPARABLE,
                reason="Scottish rates",
                reviewer="Reviewer",
            ),
        ],
    )
    row = result["rows"][0]
    assert row["status"] == PASS
    assert row["comparator"]["value_bn"] == 1.0
    assert row["excluded"] == [{"row_id": "2", "reason": "Scottish rates"}]


def test_the_same_figure_entered_twice_is_refused(tmp_path):
    sheet = tmp_path / "sources"
    sheet.mkdir()
    header = (
        "source_id,document,table,row_id,row_label,fiscal_year,value_bn,"
        "basis,sign_convention,head,notes\n"
    )
    line = "S,Doc,T,1,Row,2027-28,1.0,static_costing,exchequer_positive,tax,\n"
    (sheet / "a.csv").write_text(header + line)
    (sheet / "b.csv").write_text(header + line)
    with pytest.raises(ReconciliationInputError, match="entered twice"):
        load_sources(sheet)


def test_duplicate_figures_reaching_reconcile_are_refused():
    with pytest.raises(ReconciliationInputError, match="2 static_costing"):
        run({2027: 2.0}, [source(2027, 1.0), source(2027, 1.0)])


def test_a_row_mapped_twice_is_refused(tmp_path):
    path = tmp_path / "mapping.csv"
    path.write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,"
        "reviewer\nm,S,1,,,,,\nm,S,1,,,,,\n"
    )
    with pytest.raises(ReconciliationInputError, match="mapped twice"):
        load_mapping(path)


@pytest.mark.parametrize(
    "field,value",
    [
        ("min_response_bn", 0),
        ("min_response_bn", float("inf")),
        ("relative_tolerance", float("inf")),
        ("absolute_floor_bn", float("nan")),
        ("zero_tolerance_bn", -1),
    ],
)
def test_thresholds_must_be_finite_and_the_floor_positive(field, value):
    with pytest.raises(ReconciliationInputError):
        Policy(**{field: value})


@given(
    st.floats(min_value=1e-9, max_value=10),
    st.sampled_from(["positive", "negative"]),
)
def test_an_exact_zero_is_inert_whatever_the_floor(floor, direction):
    result = check_responsiveness(
        {2027: 0.0},
        measure_id="m",
        declarations=[ExpectedEffect("m", direction, 2027, reviewer="R")],
        comparators_bn={2027: None},
        min_response_bn=floor,
        min_response_share=0.0,
        zero_tolerance_bn=0.0,
    )
    assert result["status"] == INERT


def test_a_comparator_summing_to_zero_is_not_a_printed_zero():
    """+£1bn and -£1bn printed: a correct +£4m net gets the ordinary floor."""
    result = run(
        {2027: 0.004},
        [source(2027, 1.0, row_id="1"), source(2027, -1.0, row_id="2")],
        mapping=[link(row_id="1"), link(row_id="2")],
    )
    row = result["rows"][0]
    assert row["allowance_bn"] == POLICY.absolute_floor_bn
    assert row["status"] == PASS


def test_a_printed_zero_keeps_its_rounding_tolerance():
    result = run({2027: 0.004}, [source(2027, 0.0)])
    row = result["rows"][0]
    assert row["allowance_bn"] == POLICY.zero_tolerance_bn
    assert row["status"] == FAILED


# --- round 3: reviewed inputs must actually be reviewed --------------------

EXCEPTION = """- measure_id: m
  fiscal_year: 2027-28
  residual_bn: -0.5
  explanation_class: behavioural
  explanation: The costing includes a behavioural yield.
  reviewer: Reviewer
  accepted_at: 2026-10-28T15:00:00Z
  outputs_sha256: abc
  comparator_sha256: def
"""


@pytest.mark.parametrize(
    "field",
    [
        "explanation",
        "reviewer",
        "accepted_at",
        "explanation_class",
        "comparator_sha256",
    ],
)
@pytest.mark.parametrize("blank", ["", " ''", " null", " []", " 3"])
def test_an_exception_with_a_blank_review_field_is_refused(
    tmp_path, field, blank
):
    """Review round 3: YAML read a blank field as null, and str(None) made
    it the reviewed text "None", so an unreviewed exception was accepted."""
    lines = [
        f"  {field}:{blank}" if line.strip().startswith(f"{field}:") else line
        for line in EXCEPTION.splitlines()
    ]
    path = tmp_path / "exceptions.yaml"
    path.write_text("\n".join(lines) + "\n")
    with pytest.raises(ReconciliationInputError, match=field):
        load_exceptions(path)


def test_a_complete_exception_loads_with_its_timestamp(tmp_path):
    path = tmp_path / "exceptions.yaml"
    path.write_text(EXCEPTION)
    (entry,) = load_exceptions(path)
    assert entry.reviewer == "Reviewer"
    assert entry.accepted_at.startswith("2026-10-28T15:00:00")
    assert entry.residual_bn == -0.5


EXPECTED_HEADER = "measure_id,direction,from_year,to_year,reviewer,note\n"


def test_an_expected_effect_needs_its_reviewer(tmp_path):
    """Review round 3: an unreviewed declaration overrode the Treasury's
    sign and let a wrong-direction measure through."""
    path = tmp_path / "expected_effects.csv"
    path.write_text(EXPECTED_HEADER + "m,positive,2027,,,\n")
    with pytest.raises(ReconciliationInputError, match="reviewer"):
        load_expected(path)


@pytest.mark.parametrize(
    "rows",
    [
        ["m,positive,2027,,A,", "m,negative,2027,,B,"],
        ["m,positive,2027,,A,", "m,negative,2029,2030,B,"],
        ["m,negative,2028,2029,A,", "m,positive,2026,2028,B,"],
        ["m,positive,2027,2028,A,", "m,positive,2028,,B,"],
    ],
)
def test_overlapping_expected_effects_are_refused(tmp_path, rows):
    """Review round 3: with two declarations for a year, the first in the
    file won, so reordering the file changed the verdict."""
    for order in (rows, rows[::-1]):
        path = tmp_path / "expected_effects.csv"
        path.write_text(EXPECTED_HEADER + "\n".join(order) + "\n")
        with pytest.raises(ReconciliationInputError, match="already has"):
            load_expected(path)


def test_separate_years_and_measures_may_each_have_an_expectation(tmp_path):
    path = tmp_path / "expected_effects.csv"
    path.write_text(
        EXPECTED_HEADER
        + "m,positive,2026,2027,A,\nm,negative,2028,,B,\nn,negative,2027,,C,\n"
    )
    assert [e.direction for e in load_expected(path)] == [
        "positive",
        "negative",
        "negative",
    ]


@pytest.mark.parametrize("direction", ["positive", "negative"])
def test_an_exact_zero_is_inert_even_with_no_floor(direction):
    """Review round 3: every sampled floor was positive, so the property
    above passed with the explicit zero guard removed."""
    result = check_responsiveness(
        {2027: 0.0},
        measure_id="m",
        declarations=[ExpectedEffect("m", direction, 2027, reviewer="R")],
        comparators_bn={2027: None},
        min_response_bn=0.0,
        min_response_share=0.0,
        zero_tolerance_bn=0.0,
    )
    assert result["status"] == INERT


# --- confirmation review of #17 -------------------------------------------


def _declared_both_years():
    return [ExpectedEffect("m", "positive", 2027, 2028, reviewer="R")]


def test_a_year_the_artifact_reports_without_a_model_output_fails():
    """Review finding 1: both gates looked only at the years with a model
    output, so a missing year passed unchecked."""
    result = run(
        {2027: 1.0},
        [source(2027, 1.0), source(2028, 3.0)],
        years=[2027, 2028],
        supported_years={2027, 2028},
        expected=_declared_both_years(),
    )
    statuses = {row["year"]: row["status"] for row in result["rows"]}
    assert statuses == {2027: PASS, 2028: FAILED}
    assert "No model output" in result["rows"][1]["reason"]
    assert result["summary"]["status"] == FAILED
    assert result["responsiveness"]["status"] == MISSING


def test_no_exception_accepts_a_year_with_no_model_output():
    sources = [source(2027, 1.0), source(2028, 3.0)]
    result = run(
        {2027: 1.0},
        sources,
        years=[2027, 2028],
        exceptions=[exception(2028, -3.0, sources=sources)],
    )
    assert result["rows"][1]["status"] == FAILED


def test_a_missing_year_the_dataset_does_not_support_is_unsupported():
    result = run(
        {2030: 1.0},
        [source(2030, 1.0), source(2031, 1.0)],
        years=[2030, 2031],
        supported_years={2030},
    )
    statuses = {row["year"]: row["status"] for row in result["rows"]}
    assert statuses == {2030: PASS, 2031: UNSUPPORTED}
    assert result["responsiveness"]["status"] == RESPONSIVE


def test_a_model_output_for_a_year_the_artifact_does_not_report_is_refused():
    with pytest.raises(ReconciliationInputError, match="does not report"):
        run({2027: 1.0, 2028: 1.0}, [source(2027, 1.0)], years=[2027])


def test_the_cli_fails_a_year_the_receipt_reports_with_no_output(tmp_path):
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05}, years=[2027, 2028])
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 1


def _without_receipt_years(artifact):
    receipt = json.loads((artifact / "receipt.json").read_text())
    del receipt["execution_receipt"]["years"]
    (artifact / "receipt.json").write_text(json.dumps(receipt))


def test_the_cli_needs_the_artifact_years(tmp_path):
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05, 2028: -1.9})
    _without_receipt_years(artifact)
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 2
    assert (
        main(
            [
                str(artifact),
                "--inputs",
                str(inputs),
                "--no-write",
                "--years",
                "2027",
                "2028",
            ]
        )
        == 0
    )


@pytest.mark.parametrize("first, second", [("100", "1"), ("1", "100")])
def test_two_model_rows_for_one_year_are_refused_in_either_order(
    tmp_path, first, second
):
    """Review finding 2: the later row silently replaced the earlier one,
    so the verdict depended on the order of the rows."""
    rows = [
        f"rate_change,Rate change,2027,{first}",
        f"rate_change,Rate change,2027,{second}",
    ]
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: 1}, rows=rows)
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 2


@given(
    years=st.lists(st.integers(2026, 2031), min_size=1, max_size=8),
    data=st.data(),
)
def test_model_outputs_are_one_per_year_whatever_the_order(years, data):
    """Property: a set of rows with distinct years reads as exactly those
    values, in any order; any repeated year is refused, in any order."""
    values = data.draw(
        st.lists(amounts, min_size=len(years), max_size=len(years))
    )
    rows = [
        {"reform_id": "m", "year": year, "value": value}
        for year, value in zip(years, values)
    ]
    rows += [{"reform_id": "other", "year": 2026, "value": 9.0}]
    order = data.draw(st.permutations(rows))
    if len(set(years)) == len(years):
        assert budgetary_from_rows(order, "m", "rows") == dict(
            zip(years, values)
        )
    else:
        with pytest.raises(ReconciliationInputError, match="two"):
            budgetary_from_rows(order, "m", "rows")


@pytest.mark.parametrize("value", ["nan", "inf", "-inf"])
def test_a_non_finite_model_output_is_refused(tmp_path, value):
    """Review finding 3: NaN passed the minimum-size check and took a sign,
    and a not-comparable mapping skipped the numerical check altogether."""
    inputs = write_inputs(tmp_path)
    (inputs / "mapping.csv").write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer\n"
        "rate_change,S,7,,,not_comparable,Outside comparator coverage,R\n"
    )
    artifact = write_artifact(tmp_path, {2027: value})
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 2
    number = float(value)
    with pytest.raises(ReconciliationInputError, match="finite"):
        run(
            {2027: number},
            [],
            mapping=[
                link(status=NOT_COMPARABLE, reason="Outside", reviewer="R")
            ],
            expected=[ExpectedEffect("m", "negative", 2027, reviewer="R")],
        )
    with pytest.raises(ValueError, match="finite"):
        check_responsiveness(
            {2027: number},
            measure_id="m",
            declarations=[ExpectedEffect("m", "positive", 2027, reviewer="R")],
            comparators_bn={},
            min_response_bn=POLICY.min_response_bn,
            min_response_share=POLICY.min_response_share,
            zero_tolerance_bn=POLICY.zero_tolerance_bn,
        )


def _accepted_then_changed(sources, mapping, changed_sources, changed_mapping):
    """An exception approved against one comparison, then reconciled
    against another with the same aggregate."""
    entry = exception(2027, 0.5, sources=sources, mapping=mapping)
    before = run({2027: 1.5}, sources, mapping=mapping, exceptions=[entry])
    after = run(
        {2027: 1.5},
        changed_sources,
        mapping=changed_mapping,
        exceptions=[entry],
    )
    return before, after


def test_an_exception_lapses_when_the_figures_behind_it_change():
    """Review finding 4: acceptance bound the residual but not the Treasury
    figures, so two figures changing with the same sum kept it accepted."""
    mapping = [link(row_id="1"), link(row_id="2")]
    before, after = _accepted_then_changed(
        [source(2027, 2.0, row_id="1"), source(2027, -1.0, row_id="2")],
        mapping,
        [source(2027, 200.0, row_id="1"), source(2027, -199.0, row_id="2")],
        mapping,
    )
    assert before["rows"][0]["status"] == ACCEPTED
    assert after["rows"][0]["comparator"]["value_bn"] == pytest.approx(1.0)
    assert after["rows"][0]["status"] == FAILED
    assert "has changed" in after["rows"][0]["exception_rejected"]


def test_an_exception_lapses_when_its_mapping_changes():
    sources = [source(2027, 1.0, row_id="1"), source(2027, 1.0, row_id="2")]
    before, after = _accepted_then_changed(
        sources, [link(row_id="1")], sources, [link(row_id="2")]
    )
    assert before["rows"][0]["status"] == ACCEPTED
    assert after["rows"][0]["status"] == FAILED


def test_an_exception_lapses_when_the_comparator_basis_changes():
    sources = [
        source(2027, 1.0),
        source(2027, 1.0, basis="post_behavioural"),
    ]
    entry = exception(2027, 0.5, sources=sources)
    static = run({2027: 1.5}, sources, exceptions=[entry])
    other = run(
        {2027: 1.5},
        sources,
        exceptions=[entry],
        policy=Policy(comparator_basis="post_behavioural"),
    )
    assert static["rows"][0]["status"] == ACCEPTED
    assert other["rows"][0]["comparator"]["value_bn"] == pytest.approx(1.0)
    assert other["rows"][0]["status"] == FAILED


@given(
    pe=amounts,
    treasury=amounts,
    same_outputs=st.booleans(),
    same_comparison=st.booleans(),
)
def test_an_exception_applies_only_to_its_outputs_and_comparison(
    pe, treasury, same_outputs, same_comparison
):
    """Property: a failed year is accepted only when the exception names
    these outputs and this comparison, with the computed residual."""
    assume(not within_allowance(pe, treasury, POLICY))
    sources = [source(2027, treasury)]
    entry = exception(
        2027,
        pe - treasury,
        DIGEST if same_outputs else OTHER_DIGEST,
        sources=sources if same_comparison else None,
    )
    result = run({2027: pe}, sources, exceptions=[entry])
    expected = ACCEPTED if same_outputs and same_comparison else FAILED
    assert result["rows"][0]["status"] == expected
    assert result["rows"][0]["comparator"]["sha256"] == comparison_sha256(
        "m", 2027, sources, [link()], POLICY
    )


@pytest.mark.parametrize("text", ["false\n", "0\n", "[]\n", "", "# none\n"])
def test_a_policy_file_must_hold_a_mapping(tmp_path, text):
    """Review finding 5: a policy file that read as false, 0 or a list was
    taken for the defaults."""
    path = tmp_path / "policy.yaml"
    path.write_text(text)
    with pytest.raises(ReconciliationInputError, match="mapping"):
        load_policy(path)


def test_a_comparator_that_overflows_is_refused():
    """Review finding 6: a finite scale times a finite figure overflowed to
    an infinite comparator and allowance, which passed."""
    with pytest.raises(ReconciliationInputError, match="finite"):
        run(
            {2027: 1.0},
            [source(2027, 10.0)],
            mapping=[link(scale=1e308, reason="Overflow", reviewer="R")],
            policy=Policy(min_response_share=0),
        )


def test_a_mapping_scale_must_be_a_finite_number():
    with pytest.raises(ReconciliationInputError, match="scale"):
        link(scale=float("inf"))
    with pytest.raises(ReconciliationInputError, match="year_offset"):
        link(year_offset=1.5)


@pytest.mark.parametrize(
    "field",
    ["explanation", "reviewer", "accepted_at", "comparator_sha256"],
)
@pytest.mark.parametrize("value", [None, "", "  ", 3])
def test_an_exception_built_directly_needs_every_review_field(field, value):
    """Review finding 7: the constructor checked str(value), so None became
    the text "None"."""
    with pytest.raises(ReconciliationInputError, match=field):
        exception(2027, 0.5, **{field: value})


# --- second review of #17 -------------------------------------------------


@pytest.mark.parametrize("scale", [0.0, -1.0, -0.5])
def test_a_mapping_scale_must_be_above_zero(scale):
    """Review N1: a scale of zero dropped a Treasury figure, and a negative
    one flipped its sign, with no reviewer; a £5bn costing then passed
    against a £40m model figure."""
    with pytest.raises(ReconciliationInputError, match="above zero"):
        link(scale=scale, reason="R", reviewer="R")


def test_a_scaled_mapping_needs_a_reason_and_reviewer():
    with pytest.raises(ReconciliationInputError, match="the reason for"):
        link(scale=0.5)
    assert (
        link(scale=0.5, reason="Scotland's share", reviewer="R").scale == 0.5
    )
    assert link(scale=1.0).scale == 1.0


def test_the_cli_refuses_a_zero_scale(tmp_path):
    inputs = write_inputs(tmp_path)
    (inputs / "mapping.csv").write_text(
        "measure_id,source_id,row_id,scale,year_offset,status,reason,reviewer\n"
        "rate_change,S,7,0,,,,\n"
    )
    artifact = write_artifact(tmp_path, {2027: -0.04, 2028: -0.04})
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 2


@pytest.mark.parametrize(
    "flags",
    [
        ["--years", "2027"],
        ["--years", "2027", "2028", "2029"],
        ["--supported-years", "2027"],
        ["--outputs-sha256", OTHER_DIGEST],
        ["--measure-id", "another_measure"],
    ],
)
def test_a_flag_that_contradicts_the_receipt_is_refused(tmp_path, flags):
    """Review N2: --years 2027 dropped 2028 from both gates although the
    receipt reports it, which brought back the missing-year gap."""
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05}, years=[2027, 2028])
    assert (
        main([str(artifact), "--inputs", str(inputs), "--no-write", *flags])
        == 2
    )


def test_a_flag_that_repeats_the_receipt_is_accepted(tmp_path):
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05, 2028: -1.9})
    flags = [
        "--years",
        "2028",
        "2027",
        "--supported-years",
        "2027",
        "2028",
        "--outputs-sha256",
        DIGEST,
        "--measure-id",
        "rate_change",
    ]
    assert (
        main([str(artifact), "--inputs", str(inputs), "--no-write", *flags])
        == 0
    )


@pytest.mark.parametrize(
    "dataset_years", [[2027, "2028"], [2027, True], "2027", {"2027": 1}]
)
def test_the_receipt_years_must_be_whole_numbers(tmp_path, dataset_years):
    inputs = write_inputs(tmp_path)
    artifact = write_artifact(tmp_path, {2027: -1.05, 2028: -1.9})
    receipt = json.loads((artifact / "receipt.json").read_text())
    receipt["dashboard"]["dataset_years"] = dataset_years
    (artifact / "receipt.json").write_text(json.dumps(receipt))
    assert main([str(artifact), "--inputs", str(inputs), "--no-write"]) == 2


HUGE = 10**400


def test_an_integer_too_large_for_a_float_is_refused_cleanly(tmp_path):
    """Review N3: float() of a huge int raises OverflowError, which is not a
    ValueError, so it escaped as a traceback instead of a refusal."""
    with pytest.raises(ReconciliationInputError, match="finite"):
        run({2027: HUGE}, [source(2027, 1.0)])
    with pytest.raises(ValueError, match="finite"):
        check_responsiveness(
            {2027: HUGE},
            measure_id="m",
            declarations=[],
            comparators_bn={},
            min_response_bn=POLICY.min_response_bn,
            min_response_share=POLICY.min_response_share,
            zero_tolerance_bn=POLICY.zero_tolerance_bn,
        )
    policy = tmp_path / "policy.yaml"
    policy.write_text(f"relative_tolerance: {HUGE}\n")
    with pytest.raises(ReconciliationInputError, match="finite"):
        load_policy(policy)
    exceptions = tmp_path / "exceptions.yaml"
    exceptions.write_text(
        EXCEPTION.replace("residual_bn: -0.5", f"residual_bn: {HUGE}")
    )
    with pytest.raises(ReconciliationInputError, match="finite"):
        load_exceptions(exceptions)


def test_two_exceptions_for_the_same_outputs_are_refused(tmp_path):
    """Review N4: with two, which one the record named depended on their
    order in the file."""
    path = tmp_path / "exceptions.yaml"
    path.write_text(EXCEPTION + EXCEPTION.replace("Reviewer", "Someone else"))
    with pytest.raises(ReconciliationInputError, match="two exceptions"):
        load_exceptions(path)
    sources = [source(2027, 1.0)]
    entry = exception(2027, 0.5, sources=sources)
    with pytest.raises(ReconciliationInputError, match="two exceptions"):
        run({2027: 1.5}, sources, exceptions=[entry, entry])
    other_outputs = exception(2027, 0.5, OTHER_DIGEST, sources=sources)
    assert (
        run({2027: 1.5}, sources, exceptions=[entry, other_outputs])["rows"][
            0
        ]["status"]
        == ACCEPTED
    )


# --- third review of #17 --------------------------------------------------


@pytest.mark.parametrize(
    "reason, reviewer", [(" ", " "), (True, True), ("", "R"), ("Share", None)]
)
@pytest.mark.parametrize(
    "fields",
    [{"scale": 0.008}, {"status": NOT_COMPARABLE}],
    ids=["scaled", "not comparable"],
)
def test_a_reviewed_mapping_needs_real_review_text(reason, reviewer, fields):
    """Review N5: whitespace or True passed as a reviewer, so a direct
    caller scaled a £5bn figure to compare with £40m."""
    with pytest.raises(ReconciliationInputError, match="must be filled in"):
        link(reason=reason, reviewer=reviewer, **fields)


def test_a_row_mapped_twice_is_refused_by_reconcile_itself():
    """Review N6: the loader refused it, but reconcile() summed both, so
    one £5bn figure became a £10bn comparator."""
    with pytest.raises(ReconciliationInputError, match="mapped twice"):
        run({2027: 10.0}, [source(2027, 5.0)], mapping=[link(), link()])


def test_an_expected_effect_needs_a_reviewer_wherever_it_is_built():
    """Review N7: a declaration with no reviewer overrode the Treasury's
    sign through the direct API."""
    for reviewer in ("", " ", None, True):
        with pytest.raises(ValueError, match="reviewer"):
            ExpectedEffect("m", "positive", 2027, reviewer=reviewer)


@pytest.mark.parametrize("order", [1, -1])
def test_two_declarations_for_one_year_are_refused_in_any_order(order):
    """Review N7: opposite overlapping declarations gave responsive or
    wrong_direction depending on their order."""
    declarations = [
        ExpectedEffect("m", "positive", 2027, reviewer="A"),
        ExpectedEffect("m", "negative", 2026, 2027, reviewer="B"),
    ][::order]
    with pytest.raises(ValueError, match="two expected effects"):
        run({2027: 0.004}, [source(2027, -0.004)], expected=declarations)
    with pytest.raises(ValueError, match="two expected effects"):
        check_responsiveness(
            {2027: 0.004},
            measure_id="m",
            declarations=declarations,
            comparators_bn={},
            min_response_bn=POLICY.min_response_bn,
            min_response_share=POLICY.min_response_share,
            zero_tolerance_bn=POLICY.zero_tolerance_bn,
        )


def _combined_receipt():
    return {
        "dashboard": {
            "key": "combined--a+b",
            "measure_ids": ["a", "b"],
            "dataset_years": [2027],
        },
        "execution_receipt": {"outputs_sha256": DIGEST, "years": [2027]},
    }


def test_a_combined_receipts_key_binds_the_measure(tmp_path):
    """Review N8: with several measure_ids any --measure-id was accepted, so
    another measure's outputs could take an exception under this receipt."""
    from uk_budget_data.publication.reconcile import reconcile_receipted

    inputs = write_inputs(tmp_path)
    with pytest.raises(ReconciliationInputError, match="output key"):
        reconcile_receipted(
            _combined_receipt(), {2027: 1.5}, inputs, measure_id="foreign"
        )
    result = reconcile_receipted(_combined_receipt(), {2027: 1.5}, inputs)
    assert result["measure_id"] == "combined--a+b"


def test_a_huge_source_figure_is_refused_cleanly():
    """Review N9: the multiplication raised OverflowError before the check."""
    with pytest.raises(ReconciliationInputError, match="finite"):
        source(2027, 10**400)


def test_the_residual_reported_alongside_is_finite_too():
    """Review N10: the post-behavioural residual overflowed to -inf, which
    is not JSON, in a passing reconciliation."""
    with pytest.raises(ReconciliationInputError, match="finite"):
        run(
            {2027: -1e308},
            [
                source(2027, -1e308),
                source(2027, 1e308, basis="post_behavioural"),
            ],
        )
