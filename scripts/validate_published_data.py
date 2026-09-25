"""Check dashboard CSV coverage, arithmetic, and transport-policy timing."""

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

FEATURED_POLICIES = (
    "cgt_equalisation",
    "fuel_duty_rise_cancellation",
    "bus_fare_cap",
    "threshold_freeze_extension",
    "dividend_tax_increase_2pp",
    "savings_tax_increase_2pp",
    "property_tax_increase_2pp",
)
NATIONAL_FIELDS = {
    "budgetary_impact": ("value",),
    "distributional_impact": ("value",),
    "winners_losers": ("avg_change",),
    "metrics": (
        "people_affected",
        "gini_change",
        "poverty_change_pp",
        "poverty_change_pct",
    ),
    "household_scatter": (
        "baseline_income",
        "income_change",
        "household_weight",
    ),
    "income_curve": (
        "employment_income",
        "baseline_net_income",
        "reform_net_income",
    ),
    "obr_comparison": ("policyengine_value",),
}
ROWS_PER_POLICY_YEAR = {
    "budgetary_impact": 1,
    "distributional_impact": 10,
    "winners_losers": 11,
    "metrics": 1,
    "income_curve": 201,
    "obr_comparison": 1,
}
DECILES = {
    f"{n}{'st' if n == 1 else 'nd' if n == 2 else 'rd' if n == 3 else 'th'}"
    for n in range(1, 11)
}
WINNERS_GROUPS = {*(str(n) for n in range(1, 11)), "all"}
OPTIONAL_OBR_FIELDS = ("obr_static_value", "obr_post_behavioural_value")
TRANSPORT_POLICIES = ("fuel_duty_rise_cancellation", "bus_fare_cap")
CONSTITUENCY_FIELDS = ("average_gain", "relative_change")
DEMOGRAPHIC_FIELDS = (
    "average_gain",
    "relative_change",
    "household_count",
)
CHILD_GROUPS = {"0", "1", "2", "3", "4+"}
MARRIED_GROUPS = {"True", "False"}


def read_rows(path: Path) -> list[dict[str, str]]:
    """Read a required CSV, preserving blank cells for OBR validation."""
    with path.open(newline="") as source:
        return list(csv.DictReader(source))


def validate_constituency_files(
    directory: Path, policies: tuple[str, ...], years: tuple[int, ...]
) -> list[str]:
    """Validate both local files against the map and each other."""
    errors = []
    geojson_path = directory / "uk_constituencies_2024.geojson"
    if not geojson_path.exists():
        return [f"Missing {geojson_path}"]
    try:
        with geojson_path.open() as source:
            features = json.load(source)["features"]
        expected_codes = {
            feature["properties"]["GSScode"] for feature in features
        }
        if len(features) != 650 or len(expected_codes) != 650:
            errors.append("GeoJSON must contain 650 unique constituencies")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return [f"Invalid {geojson_path}"]

    tables = {}
    for name, fields in (
        ("constituency", CONSTITUENCY_FIELDS),
        ("demographic_constituency", DEMOGRAPHIC_FIELDS),
    ):
        path = directory / f"{name}.csv"
        if not path.exists():
            errors.append(f"Missing {path}")
            continue
        with path.open(newline="") as source:
            reader = csv.DictReader(source)
            required = {
                "reform_id",
                "year",
                "constituency_code",
                "constituency_name",
                *fields,
            }
            if name == "demographic_constituency":
                required.update(("num_children", "is_married"))
            missing = required - set(reader.fieldnames or ())
            if missing:
                errors.append(f"{name}: missing columns {sorted(missing)}")
                continue
            tables[name] = list(reader)

    group_support = defaultdict(dict)
    for policy in policies:
        for year in years:
            key = f"{policy} {year}"
            local = {}
            for name, fields in (
                ("constituency", CONSTITUENCY_FIELDS),
                ("demographic_constituency", DEMOGRAPHIC_FIELDS),
            ):
                rows = [
                    row
                    for row in tables.get(name, ())
                    if row["reform_id"] == policy and row["year"] == str(year)
                ]
                local[name] = rows
                codes = [row["constituency_code"] for row in rows]
                unique_codes = set(codes)
                if len(unique_codes) != 650:
                    errors.append(
                        f"{name}: {key} covers {len(unique_codes)} of 650 constituencies"
                    )
                if unique_codes != expected_codes:
                    errors.append(f"{name}: {key} codes differ from map")
                for row in rows:
                    code = row["constituency_code"]
                    if not (row["constituency_name"] or "").strip():
                        errors.append(f"{name}: blank name for {key} {code}")
                    for field in fields:
                        try:
                            value = float(row[field])
                            if not math.isfinite(value):
                                raise ValueError("not finite")
                            if field == "household_count" and value <= 0:
                                raise ValueError("not positive")
                        except (TypeError, ValueError):
                            errors.append(
                                f"{name}: invalid {field} for {key} {code}"
                            )
                    if policy in TRANSPORT_POLICIES and year == 2026:
                        for field in CONSTITUENCY_FIELDS:
                            try:
                                if abs(float(row[field])) > 1e-4:
                                    errors.append(
                                        f"{name}: {key} has a 2026 effect in {code}"
                                    )
                                    break
                            except (TypeError, ValueError):
                                pass
            constituency = local["constituency"]
            demographic = local["demographic_constituency"]
            counts = Counter(row["constituency_code"] for row in constituency)
            for code, count in counts.items():
                if count != 1:
                    errors.append(f"constituency: duplicate {key} {code}")
            by_code = {row["constituency_code"]: row for row in constituency}
            demographic_keys = Counter(
                (
                    row["constituency_code"],
                    row["num_children"],
                    row["is_married"],
                )
                for row in demographic
            )
            for (code, children, married), count in demographic_keys.items():
                if count != 1:
                    errors.append(
                        f"demographic_constituency: duplicate {key} {code} {children}/{married}"
                    )
                if (
                    children not in CHILD_GROUPS
                    or married not in MARRIED_GROUPS
                ):
                    errors.append(
                        f"demographic_constituency: invalid group for {key} {code} {children}/{married}"
                    )
            group_support[year][policy] = set(demographic_keys)
            by_area = defaultdict(list)
            for row in demographic:
                code = row["constituency_code"]
                by_area[code].append(row)
                if (
                    code in by_code
                    and row["constituency_name"]
                    != by_code[code]["constituency_name"]
                ):
                    errors.append(
                        f"demographic_constituency: name mismatch for {key} {code}"
                    )
            for code, area_rows in by_area.items():
                if code not in by_code:
                    continue
                try:
                    total = sum(
                        float(row["household_count"]) for row in area_rows
                    )
                    if total <= 0:
                        continue
                    average = (
                        sum(
                            float(row["household_count"])
                            * float(row["average_gain"])
                            for row in area_rows
                        )
                        / total
                    )
                    published = float(by_code[code]["average_gain"])
                    if (
                        math.isfinite(average)
                        and math.isfinite(published)
                        and abs(average - published) > 0.05
                    ):
                        errors.append(
                            f"constituency/demographic average_gain mismatch for {key} {code}"
                        )
                except (TypeError, ValueError, ZeroDivisionError):
                    pass  # Row-level numeric checks above report the defect.
    for year, supports in group_support.items():
        complete = [
            (policy, groups) for policy, groups in supports.items() if groups
        ]
        if len(complete) < 2:
            continue
        reference_policy, reference_groups = complete[0]
        for policy, groups in complete[1:]:
            if groups != reference_groups:
                errors.append(
                    f"demographic_constituency: group coverage differs in {year} for {policy} and {reference_policy}"
                )
    return errors


def validate(
    directory: Path,
    policies: tuple[str, ...],
    years: tuple[int, ...],
    require_constituency: bool,
) -> list[str]:
    """Return every publication gate failure for the requested policy set."""
    errors = []
    tables = {}
    for name, fields in NATIONAL_FIELDS.items():
        path = directory / f"{name}.csv"
        if not path.exists():
            errors.append(f"Missing {path}")
            continue
        rows = read_rows(path)
        tables[name] = rows
        required = {"reform_id", "year", *fields}
        key_field = {
            "distributional_impact": "decile",
            "winners_losers": "decile",
            "household_scatter": "household_id",
            "income_curve": "employment_income",
        }.get(name)
        if key_field:
            required.add(key_field)
        missing_columns = required - set(rows[0] if rows else ())
        if missing_columns:
            errors.append(f"{name}: missing columns {sorted(missing_columns)}")
            continue
        for policy in policies:
            for year in years:
                matching = [
                    row
                    for row in rows
                    if row.get("reform_id") == policy
                    and row.get("year") == str(year)
                ]
                if not matching:
                    errors.append(f"{name}: missing {policy} {year}")
                expected_count = ROWS_PER_POLICY_YEAR.get(name)
                if (
                    expected_count is not None
                    and matching
                    and len(matching) != expected_count
                ):
                    errors.append(
                        f"{name}: {policy} {year} has {len(matching)} rows, expected {expected_count}"
                    )
                if key_field and matching:
                    keys = [row[key_field] for row in matching]
                    if any(not key for key in keys) or len(set(keys)) != len(
                        keys
                    ):
                        errors.append(
                            f"{name}: duplicate or blank {key_field} for {policy} {year}"
                        )
                    expected_keys = (
                        DECILES
                        if name == "distributional_impact"
                        else WINNERS_GROUPS
                        if name == "winners_losers"
                        else None
                    )
                    if (
                        expected_keys is not None
                        and set(keys) != expected_keys
                    ):
                        errors.append(
                            f"{name}: incomplete {key_field} for {policy} {year}"
                        )
                for row in matching:
                    for field in fields:
                        try:
                            if not math.isfinite(float(row[field])):
                                raise ValueError("not finite")
                        except (KeyError, TypeError, ValueError):
                            errors.append(
                                f"{name}: invalid {field} for {policy} {year}"
                            )
                    if name == "obr_comparison":
                        for field in OPTIONAL_OBR_FIELDS:
                            if row.get(field):
                                try:
                                    if not math.isfinite(float(row[field])):
                                        raise ValueError("not finite")
                                except ValueError:
                                    errors.append(
                                        f"{name}: invalid {field} for {policy} {year}"
                                    )
    if "budgetary_impact" in tables and "obr_comparison" in tables:
        budget = {
            (row["reform_id"], row["year"]): row["value"]
            for row in tables["budgetary_impact"]
        }
        for row in tables["obr_comparison"]:
            key = (row["reform_id"], row["year"])
            if (
                key[0] in policies
                and key[1] in {str(year) for year in years}
                and key in budget
            ):
                try:
                    if (
                        abs(
                            float(row["policyengine_value"])
                            - float(budget[key])
                        )
                        > 1e-6
                    ):
                        errors.append(f"OBR/PE mismatch for {key[0]} {key[1]}")
                except (TypeError, ValueError):
                    pass  # Row-level numeric checks report invalid values.
    if "household_scatter" in tables and policies:
        reference = {
            row.get("household_id")
            for row in tables["household_scatter"]
            if row.get("reform_id") == policies[0]
            and row.get("year") == str(years[0])
        }
        for policy in policies:
            for year in years:
                current = {
                    row.get("household_id")
                    for row in tables["household_scatter"]
                    if row.get("reform_id") == policy
                    and row.get("year") == str(year)
                }
                if current and current != reference:
                    errors.append(
                        f"household_scatter: sampled IDs differ for {policy} {year}"
                    )
    if 2026 in years:
        for name in (
            "budgetary_impact",
            "distributional_impact",
            "winners_losers",
            "household_scatter",
            "income_curve",
        ):
            for row in tables.get(name, []):
                if (
                    row.get("reform_id") not in policies
                    or row.get("reform_id") not in TRANSPORT_POLICIES
                    or row.get("year") != "2026"
                ):
                    continue
                try:
                    effect = (
                        float(row["reform_net_income"])
                        - float(row["baseline_net_income"])
                        if name == "income_curve"
                        else float(row["income_change"])
                        if name == "household_scatter"
                        else float(row["avg_change"])
                        if name == "winners_losers"
                        else float(row["value"])
                    )
                    if abs(effect) > 1e-4:
                        errors.append(
                            f"{name}: {row['reform_id']} has a 2026 effect"
                        )
                        break
                except (KeyError, ValueError):
                    pass  # Numeric validation above reports this row.
    if require_constituency:
        errors.extend(validate_constituency_files(directory, policies, years))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "directory", type=Path, nargs="?", default=Path("public/data")
    )
    parser.add_argument("--policies", nargs="+", default=FEATURED_POLICIES)
    parser.add_argument(
        "--years", nargs="+", type=int, default=(2026, 2027, 2028, 2029, 2030)
    )
    parser.add_argument("--require-constituency", action="store_true")
    args = parser.parse_args()
    errors = validate(
        args.directory,
        tuple(args.policies),
        tuple(args.years),
        args.require_constituency,
    )
    for error in errors[:30]:
        print(f"FAIL: {error}")
    if len(errors) > 30:
        print(f"... and {len(errors) - 30} more failures")
    if errors:
        print(f"{len(errors)} publication-gate failure(s)")
        return 1
    print(
        f"Validated {len(args.policies)} policies, {len(args.years)} years, and {len(NATIONAL_FIELDS) + (2 if args.require_constituency else 0)} CSVs"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
