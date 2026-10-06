"""Publication checks for constituency and demographic CSVs."""

import csv
import json

from scripts.validate_published_data import (
    validate,
    validate_constituency_files,
)

POLICIES = ("cgt_equalisation", "fuel_duty_rise_cancellation")
YEARS = (2026,)
CONSTITUENCY_FIELDS = (
    "reform_id",
    "year",
    "constituency_code",
    "constituency_name",
    "average_gain",
    "relative_change",
)
DEMOGRAPHIC_FIELDS = (
    "reform_id",
    "year",
    "constituency_code",
    "constituency_name",
    "num_children",
    "is_married",
    "average_gain",
    "relative_change",
    "household_count",
)


def write_csv(path, fields, rows):
    with path.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def sample_files(tmp_path):
    codes = [f"E1400{index:05d}" for index in range(650)]
    (tmp_path / "uk_constituencies_2024.geojson").write_text(
        json.dumps(
            {"features": [{"properties": {"GSScode": code}} for code in codes]}
        )
    )
    constituency = []
    demographic = []
    for policy in POLICIES:
        for code in codes:
            common = {
                "reform_id": policy,
                "year": "2026",
                "constituency_code": code,
                "constituency_name": code,
                "average_gain": (
                    "0" if policy == "fuel_duty_rise_cancellation" else "10"
                ),
                "relative_change": "0",
            }
            constituency.append(common)
            demographic.append(
                {
                    **common,
                    "num_children": "0",
                    "is_married": "False",
                    "household_count": "100",
                }
            )
    write_csv(tmp_path / "constituency.csv", CONSTITUENCY_FIELDS, constituency)
    write_csv(
        tmp_path / "demographic_constituency.csv",
        DEMOGRAPHIC_FIELDS,
        demographic,
    )
    return constituency, demographic


def test_valid_constituency_files(tmp_path):
    sample_files(tmp_path)
    assert validate_constituency_files(tmp_path, POLICIES, YEARS) == []


def test_duplicate_nonfinite_and_mismatched_local_rows(tmp_path):
    constituency, demographic = sample_files(tmp_path)
    constituency.append(constituency[0].copy())
    constituency[1]["average_gain"] = "nan"
    demographic[0]["average_gain"] = "50"
    demographic[1]["household_count"] = "inf"
    write_csv(tmp_path / "constituency.csv", CONSTITUENCY_FIELDS, constituency)
    write_csv(
        tmp_path / "demographic_constituency.csv",
        DEMOGRAPHIC_FIELDS,
        demographic,
    )
    errors = validate_constituency_files(tmp_path, POLICIES, YEARS)
    assert any("duplicate" in error for error in errors)
    assert any("invalid average_gain" in error for error in errors)
    assert any("invalid household_count" in error for error in errors)
    assert any("average_gain mismatch" in error for error in errors)


def test_group_support_and_transport_timing(tmp_path):
    constituency, demographic = sample_files(tmp_path)
    demographic[-1]["num_children"] = "1"
    fuel_row = next(
        row
        for row in constituency
        if row["reform_id"] == "fuel_duty_rise_cancellation"
    )
    fuel_row["average_gain"] = "1"
    write_csv(tmp_path / "constituency.csv", CONSTITUENCY_FIELDS, constituency)
    write_csv(
        tmp_path / "demographic_constituency.csv",
        DEMOGRAPHIC_FIELDS,
        demographic,
    )
    errors = validate_constituency_files(tmp_path, POLICIES, YEARS)
    assert any("group coverage differs" in error for error in errors)
    assert any("2026 effect" in error for error in errors)


def test_national_files_reject_duplicate_keys_nonfinite_values_and_cross_file_mismatch(
    tmp_path,
):
    """A row count alone cannot establish a complete, consistent publication."""
    policy = "savings_tax_increase_2pp"
    common = {"reform_id": policy, "year": "2027"}
    tables = {
        "budgetary_impact": (
            ["reform_id", "year", "value"],
            [{**common, "value": "1"}],
        ),
        "distributional_impact": (
            ["reform_id", "year", "decile", "value"],
            [
                {
                    **common,
                    "decile": f"{n}{'st' if n == 1 else 'nd' if n == 2 else 'rd' if n == 3 else 'th'}",
                    "value": "0",
                }
                for n in range(1, 11)
            ],
        ),
        "winners_losers": (
            ["reform_id", "year", "decile", "avg_change"],
            [
                {**common, "decile": group, "avg_change": "0"}
                for group in [*(str(n) for n in range(1, 11)), "all"]
            ],
        ),
        "metrics": (
            [
                "reform_id",
                "year",
                "people_affected",
                "gini_change",
                "poverty_change_pp",
                "poverty_change_pct",
            ],
            [
                {
                    **common,
                    "people_affected": "1",
                    "gini_change": "0",
                    "poverty_change_pp": "0",
                    "poverty_change_pct": "0",
                }
            ],
        ),
        "household_scatter": (
            [
                "reform_id",
                "year",
                "household_id",
                "baseline_income",
                "income_change",
                "household_weight",
            ],
            [
                {
                    **common,
                    "household_id": "1",
                    "baseline_income": "100",
                    "income_change": "0",
                    "household_weight": "1",
                }
            ],
        ),
        "income_curve": (
            [
                "reform_id",
                "year",
                "employment_income",
                "baseline_net_income",
                "reform_net_income",
            ],
            [
                {
                    **common,
                    "employment_income": str(n),
                    "baseline_net_income": "0",
                    "reform_net_income": "0",
                }
                for n in range(201)
            ],
        ),
        "obr_comparison": (
            [
                "reform_id",
                "year",
                "policyengine_value",
                "obr_static_value",
                "obr_post_behavioural_value",
            ],
            [
                {
                    **common,
                    "policyengine_value": "1",
                    "obr_static_value": "",
                    "obr_post_behavioural_value": "",
                }
            ],
        ),
    }
    for name, (fields, rows) in tables.items():
        write_csv(tmp_path / f"{name}.csv", fields, rows)
    assert validate(tmp_path, (policy,), (2027,), False) == []

    tables["distributional_impact"][1][-1]["decile"] = "1st"
    tables["metrics"][1][0]["gini_change"] = "nan"
    tables["obr_comparison"][1][0]["policyengine_value"] = "2"
    for name in ("distributional_impact", "metrics", "obr_comparison"):
        fields, rows = tables[name]
        write_csv(tmp_path / f"{name}.csv", fields, rows)
    errors = validate(tmp_path, (policy,), (2027,), False)
    assert any("incomplete decile" in error for error in errors)
    assert any("invalid gini_change" in error for error in errors)
    assert any("OBR/PE mismatch" in error for error in errors)
