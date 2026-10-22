"""Reconcile a measure's fiscal costing against the Treasury's.

For each model year the measure's fiscal impact is compared with the mapped
Treasury costing on the gated basis (the static costing by default). A year
passes when the difference is within the larger of a relative tolerance and
an absolute floor. Anything larger fails unless a reviewed exception, bound
to the exact outputs being published, accepts it. Years with no entered
costing are ``awaiting_source``; rows a reviewer classified as not comparable
are reported as such; years beyond the dataset's projection are
``unsupported``. The post-behavioural figure is reported alongside and never
gated.

Every year the artifact reports (its receipt's ``years``) must have exactly
one finite model output, unless the dataset does not support that year; a
missing year fails. An exception names the Treasury comparison it approved
(``comparator_sha256``: the basis, every figure and mapping behind it), so
it lapses when any of them changes.

Responsiveness (does the measure move at all, in the right direction) is
checked separately and cannot be waived by an exception; see
``responsiveness.py``.

The result is written as ``reconciliation.json`` beside the artifact::

    uv run python -m uk_budget_data.publication.reconcile \\
        public/data/artifacts/<measure>/<digest>/

The tolerance numbers in ``data_inputs/treasury/policy.yaml`` are a proposal
pending the team's decision.
"""

import argparse
import csv
import hashlib
import json
import math
import numbers
import re
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Collection, Iterable, Mapping, Optional

import yaml

from uk_budget_data.publication.responsiveness import (
    ExpectedEffect,
    check_responsiveness,
    collected,
    finite_impact,
    overlaps,
    validated,
    whole_year,
)

SCHEMA = "uk-budget-dashboard/reconciliation/v1"

PASS = "pass"
ACCEPTED = "accepted"
FAILED = "failed"
AWAITING_SOURCE = "awaiting_source"
NOT_COMPARABLE = "not_comparable"
UNSUPPORTED = "unsupported"

# The team's closed list of explanation classes (drill 3 rubric).
EXPLANATION_CLASSES = frozenset(
    {
        "behavioural",
        "coverage_business",
        "top_tail_data",
        "timing_fiscal_calendar",
        "incidence_basis",
        "baseline_mismatch",
        "data_forward_path",
        "devolved",
        "interaction",
    }
)

BASES = ("static_costing", "post_behavioural")
# A declared residual is typed to the nearest £1m.
RESIDUAL_ROUNDING_BN = 0.0005
_EPSILON = 1e-12


class ReconciliationInputError(ValueError):
    """Raised for malformed reconciliation inputs."""


def _finite(value, label: str) -> float:
    try:
        return finite_impact(value, label)
    except ValueError as error:
        raise ReconciliationInputError(str(error)) from error


def _reviewed(value, label: str) -> str:
    """A field a reviewer must fill in: non-empty text, never coerced."""
    if not isinstance(value, str) or not value.strip():
        raise ReconciliationInputError(
            f"{label} must be filled in, not {value!r}"
        )
    return value


@dataclass(frozen=True)
class Policy:
    """Acceptance thresholds (a proposal until the team decides them)."""

    relative_tolerance: float = 0.10
    absolute_floor_bn: float = 0.05
    comparator_basis: str = "static_costing"
    zero_tolerance_bn: float = 0.0025
    min_response_bn: float = 0.001
    min_response_share: float = 0.05

    def __post_init__(self):
        if self.comparator_basis not in BASES:
            raise ReconciliationInputError(
                f"comparator_basis must be one of {BASES}"
            )
        for name in (
            "relative_tolerance",
            "absolute_floor_bn",
            "zero_tolerance_bn",
            "min_response_bn",
            "min_response_share",
        ):
            value = _finite(getattr(self, name), name)
            if not value >= 0:
                raise ReconciliationInputError(
                    f"{name} must be a finite number >= 0"
                )
        if not self.min_response_bn > 0:
            raise ReconciliationInputError(
                "min_response_bn must be above zero, so a measure that "
                "does nothing can never count as moving"
            )


@dataclass(frozen=True)
class SourceRow:
    """One Treasury figure: a table row in one fiscal year on one basis."""

    source_id: str
    row_id: str
    fiscal_year: str
    value_bn: float
    basis: str
    row_label: str = ""

    def __post_init__(self):
        if self.basis not in BASES:
            raise ReconciliationInputError(
                f"{self.source_id} row {self.row_id}: basis {self.basis!r}"
            )
        _finite(
            self.value_bn,
            f"{self.source_id} row {self.row_id} in {self.fiscal_year}",
        )


@dataclass(frozen=True)
class MappingRow:
    """Links a measure to a Treasury row, or classifies it not comparable."""

    measure_id: str
    source_id: str
    row_id: str
    scale: float = 1.0
    year_offset: int = 0
    status: str = ""
    reason: str = ""
    reviewer: str = ""

    def __post_init__(self):
        scale = _finite(self.scale, f"{self.measure_id}: mapping scale")
        # Every figure is entered with the Exchequer sign, so a comparator
        # never needs its sign flipped; a scale of zero would drop the row
        # without the review a not_comparable classification needs.
        if not scale > 0:
            raise ReconciliationInputError(
                f"{self.measure_id}: mapping scale must be above zero, not "
                f"{self.scale!r}; classify the row not_comparable instead"
            )
        if scale != 1:
            for name in ("reason", "reviewer"):
                _reviewed(
                    getattr(self, name),
                    f"{self.measure_id}: the {name} for a mapping scaled by "
                    f"{self.scale!r}",
                )
        if isinstance(self.year_offset, bool) or not isinstance(
            self.year_offset, numbers.Integral
        ):
            raise ReconciliationInputError(
                f"{self.measure_id}: year_offset must be a whole number"
            )
        object.__setattr__(self, "year_offset", int(self.year_offset))
        if self.status not in ("", NOT_COMPARABLE):
            raise ReconciliationInputError(
                f"{self.measure_id}: mapping status must be blank or "
                f"{NOT_COMPARABLE}"
            )
        if self.status == NOT_COMPARABLE:
            for name in ("reason", "reviewer"):
                _reviewed(
                    getattr(self, name),
                    f"{self.measure_id}: the {name} for a not_comparable "
                    "mapping",
                )


@dataclass(frozen=True)
class ExceptionEntry:
    """A reviewed acceptance of one year's residual for exact outputs."""

    measure_id: str
    fiscal_year: str
    residual_bn: float
    explanation_class: str
    explanation: str
    reviewer: str
    accepted_at: str
    outputs_sha256: str
    comparator_sha256: str

    def __post_init__(self):
        where = f"{self.measure_id} {self.fiscal_year}: exception"
        for name in (
            "measure_id",
            "fiscal_year",
            "explanation_class",
            "explanation",
            "reviewer",
            "accepted_at",
            "outputs_sha256",
            "comparator_sha256",
        ):
            _reviewed(getattr(self, name), f"{where} {name}")
        _finite(self.residual_bn, f"{where} residual_bn")
        if self.explanation_class not in EXPLANATION_CLASSES:
            raise ReconciliationInputError(
                f"{self.measure_id} {self.fiscal_year}: explanation_class "
                f"{self.explanation_class!r} is not in the closed list"
            )


def fiscal_year_label(model_year: int, offset: int = 0) -> str:
    """Model year 2027 is fiscal year ``2027-28``."""
    start = model_year + offset
    return f"{start}-{(start + 1) % 100:02d}"


def allowance_bn(
    treasury_bn: float,
    policy: Policy,
    printed_zero: Optional[bool] = None,
) -> float:
    """The largest acceptable absolute difference from a Treasury figure.

    A figure the Treasury prints as zero tolerates only its own rounding.
    A comparator that sums to zero from non-zero printed figures is not a
    printed zero, so it gets the ordinary allowance.

    Args:
        treasury_bn: The comparator.
        policy: Thresholds.
        printed_zero: Whether every figure behind the comparator was printed
            as zero. None means "infer from the comparator itself".
    """
    if printed_zero is None:
        printed_zero = abs(treasury_bn) <= _EPSILON
    if printed_zero:
        return policy.zero_tolerance_bn
    return max(
        policy.relative_tolerance * abs(treasury_bn),
        policy.absolute_floor_bn,
    )


def within_allowance(
    pe_bn: float,
    treasury_bn: float,
    policy: Policy,
    printed_zero: Optional[bool] = None,
) -> bool:
    """Whether a year passes without an exception (the bound is inclusive)."""
    return (
        abs(pe_bn - treasury_bn)
        <= allowance_bn(treasury_bn, policy, printed_zero) + _EPSILON
    )


@dataclass(frozen=True)
class Comparator:
    """The Treasury side of one year on one basis.

    ``sha256`` fingerprints everything the comparison rests on: the basis,
    each figure with its scale and offset, and the rows classified not
    comparable. An exception names it, so a change to any of them makes the
    exception lapse. It is None while the comparator is incomplete.
    """

    value_bn: Optional[float]
    rows: list
    missing: list
    printed_zero: bool
    sha256: Optional[str] = None


def _fingerprint(basis: str, rows: list, excluded: list) -> str:
    def key(item):
        return json.dumps(item, sort_keys=True)

    payload = {
        "basis": basis,
        "rows": sorted(rows, key=key),
        "excluded": sorted(excluded, key=key),
    }
    text = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def _comparator(
    measure_id: str,
    model_year: int,
    basis: str,
    sources: list[SourceRow],
    mapping: list[MappingRow],
) -> Comparator:
    """Sum the mapped Treasury rows for one year on one basis.

    Every comparable mapping must contribute exactly one figure. If any has
    none (not yet entered, or left blank), the comparator is incomplete and
    its value is None, so a partial sum can never pass.
    """
    contributions = []
    used = []
    missing = []
    excluded = []
    for link in mapping:
        if link.measure_id != measure_id:
            continue
        if link.status == NOT_COMPARABLE:
            excluded.append(
                {"source_id": link.source_id, "row_id": link.row_id}
            )
            continue
        label = fiscal_year_label(model_year, link.year_offset)
        matches = [
            row
            for row in sources
            if row.source_id == link.source_id
            and row.row_id == link.row_id
            and row.basis == basis
            and row.fiscal_year == label
        ]
        if len(matches) > 1:
            raise ReconciliationInputError(
                f"{link.source_id} row {link.row_id} has {len(matches)} "
                f"{basis} figures for {label}"
            )
        if not matches:
            missing.append(
                {
                    "source_id": link.source_id,
                    "row_id": link.row_id,
                    "fiscal_year": label,
                }
            )
            continue
        row = matches[0]
        where = f"{link.source_id} row {link.row_id} in {label}"
        contributions.append(
            _finite(link.scale * row.value_bn, f"{where}, scaled")
        )
        used.append(
            {
                "source_id": row.source_id,
                "row_id": row.row_id,
                "fiscal_year": row.fiscal_year,
                "value_bn": row.value_bn,
                "scale": link.scale,
                "year_offset": link.year_offset,
            }
        )
    if missing or not used:
        return Comparator(None, used, missing, False)
    # fsum is exact up to the final rounding, so the order the mapping lists
    # its rows cannot move the comparator (and the gate) by a rounding error.
    total = _finite(
        math.fsum(contributions), f"the {basis} comparator for {measure_id}"
    )
    printed_zero = all(abs(row["value_bn"]) <= _EPSILON for row in used)
    return Comparator(
        total, used, [], printed_zero, _fingerprint(basis, used, excluded)
    )


def comparison_sha256(
    measure_id: str,
    model_year: int,
    sources: list[SourceRow],
    mapping: list[MappingRow],
    policy: Policy,
) -> Optional[str]:
    """The ``comparator_sha256`` an exception for this year must name.

    It is also written as ``comparator.sha256`` on each compared row of
    ``reconciliation.json``. None while the comparator is incomplete.
    """
    return _comparator(
        measure_id, model_year, policy.comparator_basis, sources, mapping
    ).sha256


def _one_exception_each(exceptions: list[ExceptionEntry]) -> None:
    """Refuse two exceptions for one measure, year and outputs: which one
    the record names would depend on their order."""
    seen = set()
    for entry in exceptions:
        key = (entry.measure_id, entry.fiscal_year, entry.outputs_sha256)
        if key in seen:
            raise ReconciliationInputError(
                f"{entry.measure_id} {entry.fiscal_year}: two exceptions for "
                "the same outputs; keep one"
            )
        seen.add(key)


_INPUT_KINDS = {
    "sources": SourceRow,
    "mapping": MappingRow,
    "exceptions": ExceptionEntry,
    "expected": ExpectedEffect,
}


def _validated_inputs(**inputs) -> dict[str, list]:
    """Each input collection read once into a list, every item exactly its
    validated type with its state passing that type's checks again (see
    ``responsiveness.validated``)."""
    try:
        return {
            name: [
                validated(item, _INPUT_KINDS[name], f"{name} item")
                for item in collected(items, name)
            ]
            for name, items in inputs.items()
        }
    except ReconciliationInputError:
        raise
    except ValueError as error:
        raise ReconciliationInputError(str(error)) from error


def _one_source_each(sources: list[SourceRow]) -> None:
    """Refuse a Treasury figure entered twice, as load_sources does."""
    seen = set()
    for row in sources:
        identity = (row.source_id, row.row_id, row.fiscal_year, row.basis)
        if identity in seen:
            raise ReconciliationInputError(f"{identity} is entered twice")
        seen.add(identity)


def _one_mapping_each(mapping: list[MappingRow]) -> None:
    """Refuse a Treasury row mapped twice to one measure: its figure would
    be summed twice, a scale nobody reviewed."""
    seen = set()
    for row in mapping:
        identity = (row.measure_id, row.source_id, row.row_id)
        if identity in seen:
            raise ReconciliationInputError(f"{identity} is mapped twice")
        seen.add(identity)


def _whole_years(values, label: str) -> list[int]:
    """A sorted list of years: whole numbers (any integer type, a NumPy
    year included, as builtin ints), never bools or text."""
    try:
        return sorted(
            {
                whole_year(year, f"{label}: each year")
                for year in collected(values, label)
            }
        )
    except ValueError as error:
        raise ReconciliationInputError(str(error)) from error


def _checked_budgetary(
    budgetary: Mapping[int, float], years: Collection[int], measure_id: str
) -> dict[int, float]:
    """The model outputs as floats, each finite and within the years."""
    if not isinstance(budgetary, Mapping):
        raise ReconciliationInputError(
            f"{measure_id}: the model outputs must be a mapping of years"
        )
    checked = {}
    for year, value in budgetary.items():
        try:
            year = whole_year(year, f"{measure_id}: model year")
        except ValueError as error:
            raise ReconciliationInputError(str(error)) from error
        if year in checked:
            raise ReconciliationInputError(
                f"{measure_id}: two model outputs for {year}"
            )
        checked[year] = _finite(value, f"{measure_id}'s impact in {year}")
    stray = sorted(set(checked) - set(years))
    if stray:
        raise ReconciliationInputError(
            f"{measure_id}: model outputs for years the artifact does not "
            f"report: {stray}"
        )
    return checked


def reconcile(
    budgetary: Mapping[int, float],
    *,
    measure_id: str,
    outputs_sha256: str,
    sources: list[SourceRow],
    mapping: list[MappingRow],
    exceptions: list[ExceptionEntry],
    policy: Policy,
    expected: list[ExpectedEffect],
    years: Collection[int],
    supported_years: Optional[set[int]] = None,
) -> dict:
    """Build the reconciliation result for one measure's outputs.

    Args:
        budgetary: Model year -> fiscal impact in £bn (positive improves the
            government balance, the Treasury's Exchequer sign).
        measure_id: The measure.
        outputs_sha256: Digest of the artifact outputs being reconciled.
        sources: Entered Treasury figures.
        mapping: Measure-to-row links and not-comparable classifications.
        exceptions: Reviewed exceptions; only those naming this digest apply.
        policy: Thresholds.
        expected: Reviewed expected-effect declarations.
        years: The years the artifact reports (its receipt's). Each needs a
            model output unless the dataset does not support it; a year
            with none fails. An output for any other year is refused.
        supported_years: Years the dataset supports, or None for all.

    Returns:
        The ``reconciliation.json`` document.

    Raises:
        ReconciliationInputError: for a model output that is not a finite
            number or is for a year the artifact does not report, or for a
            comparator that overflows.
    """
    years = _whole_years(years, f"{measure_id}: the artifact's years")
    if not years:
        raise ReconciliationInputError(
            f"{measure_id}: the artifact reports no years"
        )
    if supported_years is not None:
        supported_years = set(
            _whole_years(supported_years, f"{measure_id}: supported years")
        )
    try:
        validated(policy, Policy, "policy")
    except ReconciliationInputError:
        raise
    except ValueError as error:
        raise ReconciliationInputError(str(error)) from error
    inputs = _validated_inputs(
        sources=sources,
        mapping=mapping,
        exceptions=exceptions,
        expected=expected,
    )
    sources, mapping = inputs["sources"], inputs["mapping"]
    exceptions, expected = inputs["exceptions"], inputs["expected"]
    budgetary = _checked_budgetary(budgetary, years, measure_id)
    _one_source_each(sources)
    _one_exception_each(exceptions)
    _one_mapping_each(mapping)
    own_links = [m for m in mapping if m.measure_id == measure_id]
    not_comparable = [m for m in own_links if m.status == NOT_COMPARABLE]
    comparable = [m for m in own_links if m.status != NOT_COMPARABLE]
    other = next(b for b in BASES if b != policy.comparator_basis)

    rows = []
    comparators: dict[int, Optional[float]] = {}
    for year in years:
        pe = budgetary.get(year)
        label = fiscal_year_label(year)
        row: dict = {"year": year, "fiscal_year": label, "pe_bn": pe}
        gated_side = _comparator(
            measure_id, year, policy.comparator_basis, sources, mapping
        )
        alongside_side = _comparator(measure_id, year, other, sources, mapping)
        gated, gated_rows = gated_side.value_bn, gated_side.rows
        alongside, alongside_rows = (
            alongside_side.value_bn,
            alongside_side.rows,
        )
        comparators[year] = gated if gated is not None else alongside
        if alongside is not None:
            row["alongside"] = {
                "basis": other,
                "value_bn": alongside,
                "residual_bn": (
                    None
                    if pe is None
                    else _finite(
                        pe - alongside,
                        f"{measure_id}'s {label} {other} residual",
                    )
                ),
                "rows": alongside_rows,
            }

        if supported_years is not None and year not in supported_years:
            row["status"] = UNSUPPORTED
            row["reason"] = "Beyond the dataset's projected years"
        elif pe is None:
            # No exception can accept a year the model did not produce.
            row["status"] = FAILED
            row["reason"] = "No model output for a year the artifact reports"
        elif not_comparable and not comparable:
            # Every mapped row was classified out of scope.
            row["status"] = NOT_COMPARABLE
            row["reason"] = "; ".join(m.reason for m in not_comparable)
            row["reviewer"] = "; ".join(m.reviewer for m in not_comparable)
        elif gated is None:
            row["status"] = AWAITING_SOURCE
            if gated_side.missing:
                row["missing"] = gated_side.missing
        else:
            residual = _finite(pe - gated, f"{measure_id}'s {label} residual")
            row["comparator"] = {
                "basis": policy.comparator_basis,
                "value_bn": gated,
                "rows": gated_rows,
                "sha256": gated_side.sha256,
            }
            row["residual_bn"] = residual
            row["allowance_bn"] = _finite(
                allowance_bn(gated, policy, gated_side.printed_zero),
                f"{measure_id}'s {label} allowance",
            )
            if not_comparable:
                row["excluded"] = [
                    {"row_id": m.row_id, "reason": m.reason}
                    for m in not_comparable
                ]
            if within_allowance(pe, gated, policy, gated_side.printed_zero):
                row["status"] = PASS
            else:
                row["status"] = FAILED
                for entry in exceptions:
                    if (
                        entry.measure_id == measure_id
                        and entry.fiscal_year == label
                        and entry.outputs_sha256 == outputs_sha256
                    ):
                        if entry.comparator_sha256 != gated_side.sha256:
                            row["exception_rejected"] = (
                                "the Treasury comparison it approved has "
                                f"changed ({entry.comparator_sha256[:12]} is "
                                f"not {gated_side.sha256[:12]})"
                            )
                        elif (
                            abs(entry.residual_bn - residual)
                            <= RESIDUAL_ROUNDING_BN + _EPSILON
                        ):
                            row["status"] = ACCEPTED
                            row["exception"] = {
                                "explanation_class": entry.explanation_class,
                                "explanation": entry.explanation,
                                "reviewer": entry.reviewer,
                                "accepted_at": entry.accepted_at,
                                "residual_bn": entry.residual_bn,
                                "comparator_sha256": entry.comparator_sha256,
                            }
                        else:
                            row["exception_rejected"] = (
                                f"declared residual {entry.residual_bn} does "
                                f"not match {residual:.4f}"
                            )
        rows.append(row)

    statuses = [row["status"] for row in rows]
    if FAILED in statuses:
        summary = FAILED
    elif AWAITING_SOURCE in statuses:
        summary = AWAITING_SOURCE
    elif ACCEPTED in statuses:
        summary = ACCEPTED
    else:
        summary = PASS

    try:
        responsiveness = check_responsiveness(
            budgetary,
            measure_id=measure_id,
            declarations=expected,
            comparators_bn=comparators,
            min_response_bn=policy.min_response_bn,
            min_response_share=policy.min_response_share,
            zero_tolerance_bn=policy.zero_tolerance_bn,
            supported_years=supported_years,
            years=years,
        )
    except ReconciliationInputError:
        raise
    except ValueError as error:
        raise ReconciliationInputError(str(error)) from error

    return {
        "schema": SCHEMA,
        "measure_id": measure_id,
        "outputs_sha256": outputs_sha256,
        # A copy: editing the result never changes the caller's Policy.
        "policy": asdict(policy),
        "rows": rows,
        "responsiveness": responsiveness,
        "summary": {
            "status": summary,
            "years": {
                status: statuses.count(status) for status in set(statuses)
            },
        },
    }


# --------------------------------------------------------------------------
# Input files
# --------------------------------------------------------------------------


def load_policy(path: Path) -> Policy:
    """The thresholds: defaults only when there is no policy file at all.

    A file that exists must hold a mapping. An empty file, or one that
    reads as ``false``, ``0`` or a list, is refused rather than taken for
    the defaults.
    """
    if not path.exists():
        return Policy()
    data = yaml.safe_load(path.read_text())
    if not isinstance(data, dict):
        raise ReconciliationInputError(
            f"{path}: expected a mapping of thresholds, not {data!r}"
        )
    unknown = set(data) - set(Policy.__dataclass_fields__)
    if unknown:
        raise ReconciliationInputError(
            f"{path}: unknown keys {sorted(unknown)}"
        )
    return Policy(**data)


def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_sources(directory: Path) -> list[SourceRow]:
    """Read every source sheet; rows with a blank value are not yet entered."""
    rows = []
    seen: set[tuple] = set()
    for path in sorted(directory.glob("*.csv")):
        for line in _read_csv(path):
            value = (line.get("value_bn") or "").strip()
            if value == "":
                continue
            if line["basis"] not in BASES:
                raise ReconciliationInputError(
                    f"{path}: basis {line['basis']!r}"
                )
            if line.get("sign_convention") != "exchequer_positive":
                raise ReconciliationInputError(
                    f"{path}: only exchequer_positive figures are supported"
                )
            try:
                number = float(value)
            except ValueError as error:
                raise ReconciliationInputError(
                    f"{path}: value_bn {value!r} is not a number"
                ) from error
            if not math.isfinite(number):
                raise ReconciliationInputError(
                    f"{path}: value_bn {value!r} is not finite"
                )
            identity = (
                line["source_id"],
                str(line["row_id"]),
                line["fiscal_year"],
                line["basis"],
            )
            if identity in seen:
                raise ReconciliationInputError(
                    f"{path}: {identity} is entered twice"
                )
            seen.add(identity)
            rows.append(
                SourceRow(
                    source_id=line["source_id"],
                    row_id=str(line["row_id"]),
                    fiscal_year=line["fiscal_year"],
                    value_bn=number,
                    basis=line["basis"],
                    row_label=line.get("row_label", ""),
                )
            )
    return rows


def load_mapping(path: Path) -> list[MappingRow]:
    rows = [
        MappingRow(
            measure_id=line["measure_id"],
            source_id=line.get("source_id", ""),
            row_id=str(line.get("row_id", "")),
            scale=float(line.get("scale") or 1.0),
            year_offset=int(line.get("year_offset") or 0),
            status=(line.get("status") or "").strip(),
            reason=(line.get("reason") or "").strip(),
            reviewer=(line.get("reviewer") or "").strip(),
        )
        for line in _read_csv(path)
    ]
    seen = set()
    for row in rows:
        identity = (row.measure_id, row.source_id, row.row_id)
        if identity in seen:
            raise ReconciliationInputError(
                f"{path}: {identity} is mapped twice"
            )
        if not math.isfinite(row.scale):
            raise ReconciliationInputError(
                f"{path}: {identity} has a non-finite scale"
            )
        seen.add(identity)
    return rows


def _reviewed_text(entry: dict, name: str, where: str) -> str:
    """A field a reviewer must fill in: non-empty text, never coerced.

    YAML reads an empty field as null; ``str(None)`` would make it the
    non-empty text "None". A timestamp YAML parsed as a date is accepted
    in ISO form.
    """
    if name not in entry:
        raise ReconciliationInputError(f"{where}: missing {name!r}")
    value = entry[name]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if not isinstance(value, str) or not value.strip():
        raise ReconciliationInputError(
            f"{where}: {name} must be filled in, not {value!r}"
        )
    return value.strip()


def load_exceptions(path: Path) -> list[ExceptionEntry]:
    if not path.exists():
        return []
    entries = yaml.safe_load(path.read_text()) or []
    if not isinstance(entries, list):
        raise ReconciliationInputError(f"{path}: expected a list")
    loaded = []
    for index, entry in enumerate(entries):
        where = f"{path}: exception {index + 1}"
        if not isinstance(entry, dict):
            raise ReconciliationInputError(f"{where}: expected a mapping")
        if "residual_bn" not in entry:
            raise ReconciliationInputError(f"{where}: missing 'residual_bn'")
        residual = _finite(entry["residual_bn"], f"{where}: residual_bn")
        loaded.append(
            ExceptionEntry(
                measure_id=_reviewed_text(entry, "measure_id", where),
                fiscal_year=_reviewed_text(entry, "fiscal_year", where),
                residual_bn=residual,
                explanation_class=_reviewed_text(
                    entry, "explanation_class", where
                ),
                explanation=_reviewed_text(entry, "explanation", where),
                reviewer=_reviewed_text(entry, "reviewer", where),
                accepted_at=_reviewed_text(entry, "accepted_at", where),
                outputs_sha256=_reviewed_text(entry, "outputs_sha256", where),
                comparator_sha256=_reviewed_text(
                    entry, "comparator_sha256", where
                ),
            )
        )
    _one_exception_each(loaded)
    return loaded


def load_expected(path: Path) -> list[ExpectedEffect]:
    """Reviewed expectations: each names its reviewer, and a measure has at
    most one expectation for any year, so no declaration can be overridden
    by another one's position in the file."""
    effects = []
    for number, line in enumerate(_read_csv(path), start=2):
        where = f"{path}: line {number}"
        reviewer = (line.get("reviewer") or "").strip()
        if not reviewer:
            raise ReconciliationInputError(
                f"{where}: an expected effect needs its reviewer"
            )
        try:
            effect = ExpectedEffect(
                measure_id=line["measure_id"],
                direction=line["direction"].strip(),
                from_year=int(line["from_year"]),
                to_year=int(line["to_year"]) if line.get("to_year") else None,
                reviewer=reviewer,
                note=(line.get("note") or "").strip(),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise ReconciliationInputError(f"{where}: {error}") from error
        for other in effects:
            if other.measure_id == effect.measure_id and overlaps(
                other, effect
            ):
                raise ReconciliationInputError(
                    f"{where}: {effect.measure_id} already has an expected "
                    f"effect for some of these years ({other.direction} "
                    f"from {other.from_year}); give each year one expectation"
                )
        effects.append(effect)
    return effects


def budgetary_from_rows(
    rows: Iterable[Mapping], measure_id: str, where: str
) -> dict[int, float]:
    """A measure's model output for each year, from budgetary_impact rows.

    A year given twice is refused, whatever the order of the rows, and so
    is a value that is not a finite number.
    """
    budgetary: dict[int, float] = {}
    for row in rows:
        if row["reform_id"] != measure_id:
            continue
        year = row["year"]
        # A CSV year is ASCII digits; anything else must already be an
        # integer. int() would truncate 2027.5 and accept True.
        if isinstance(year, str) and re.fullmatch(r"[1-9][0-9]*", year):
            year = int(year)
        try:
            year = whole_year(year, f"{where}: year")
        except ValueError as error:
            raise ReconciliationInputError(
                f"{where}: year {row['year']!r} is not a whole number"
            ) from error
        if year in budgetary:
            raise ReconciliationInputError(
                f"{where}: {measure_id} has two budgetary_impact rows for "
                f"{year}"
            )
        value = row["value"]
        if isinstance(value, str):
            try:
                value = float(value)
            except ValueError as error:
                raise ReconciliationInputError(
                    f"{where}: {measure_id}'s {year} value {row['value']!r} "
                    "is not a number"
                ) from error
        budgetary[year] = _finite(value, f"{where}: {measure_id} in {year}")
    return budgetary


def read_budgetary(artifact: Path, measure_id: str) -> dict[int, float]:
    budgetary = budgetary_from_rows(
        _read_csv(artifact / "budgetary_impact.csv"), measure_id, str(artifact)
    )
    if not budgetary:
        raise ReconciliationInputError(
            f"{artifact}: no budgetary_impact rows for {measure_id}"
        )
    return budgetary


def _measure_from(receipt: dict, flag: Optional[str]) -> str:
    """The measure to reconcile: the output key the receipt states, else
    the one measure it names. A flag may only repeat it; a combined
    artifact's measure_ids name its members, so only its key binds."""
    dashboard = receipt.get("dashboard", {})
    key = dashboard.get("key")
    if key is not None:
        if flag is not None and flag != key:
            raise ReconciliationInputError(
                f"--measure-id {flag!r} is not the receipt's output key "
                f"({key!r})"
            )
        return key
    ids = dashboard.get("measure_ids") or []
    if flag is None:
        if len(ids) != 1:
            raise ReconciliationInputError(
                f"pass --measure-id: the receipt names {len(ids)} measures"
            )
        return ids[0]
    if len(ids) == 1 and flag != ids[0]:
        raise ReconciliationInputError(
            f"--measure-id {flag!r} is not the measure the receipt names "
            f"({ids[0]!r})"
        )
    return flag


def _agrees(name: str, flag, stated):
    """What the receipt states, or the flag where it states nothing. A flag
    that contradicts the receipt is refused: it would reconcile outputs,
    years or digests other than the ones the receipt binds."""
    if stated is None:
        return flag
    if flag is not None and flag != stated:
        raise ReconciliationInputError(
            f"--{name} {flag!r} contradicts the receipt's {stated!r}"
        )
    return stated


def not_computable(receipt) -> bool:
    """Whether a receipt records a data limit: its artifact holds no
    figures, so there is nothing to reconcile."""
    dashboard = receipt.get("dashboard") if isinstance(receipt, dict) else {}
    return isinstance(dashboard, dict) and bool(dashboard.get("data_limits"))


def reconcile_artifact(
    artifact: Path,
    inputs: Path,
    *,
    measure_id: Optional[str] = None,
    outputs_sha256: Optional[str] = None,
    supported_years: Optional[set[int]] = None,
    years: Optional[list[int]] = None,
) -> dict:
    """Reconcile an artifact directory using the inputs directory.

    See ``reconcile_receipted`` for what the receipt supplies. An artifact
    whose receipt records a data limit is not computable, so it has no
    figures to reconcile, and is refused.
    """
    receipt_path = artifact / "receipt.json"
    receipt = (
        json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
    )
    measure_id = _measure_from(receipt, measure_id)
    if not_computable(receipt):
        raise ReconciliationInputError(
            f"{measure_id}: not computable on current data; nothing to "
            "reconcile"
        )
    return reconcile_receipted(
        receipt,
        read_budgetary(artifact, measure_id),
        inputs,
        measure_id=measure_id,
        outputs_sha256=outputs_sha256,
        supported_years=supported_years,
        years=years,
    )


def reconcile_receipted(
    receipt: dict,
    budgetary: dict[int, float],
    inputs: Path,
    *,
    measure_id: Optional[str] = None,
    outputs_sha256: Optional[str] = None,
    supported_years: Optional[set[int]] = None,
    years: Optional[list[int]] = None,
) -> dict:
    """Reconcile already-read budgetary rows, described by their receipt.

    The gate passes rows from the same capture it checked against the
    receipt, so what is reconciled is exactly what was verified.

    The measure, output digest, years and supported years come from the
    receipt (``dashboard.measure_ids``, ``execution_receipt.outputs_sha256``,
    ``execution_receipt.years`` and ``dashboard.dataset_years``). An
    argument may supply one the receipt does not state; one that
    contradicts the receipt is refused.
    """
    measure_id = _measure_from(receipt, measure_id)
    execution = receipt.get("execution_receipt", {})
    dashboard = receipt.get("dashboard", {})
    outputs_sha256 = _agrees(
        "outputs-sha256", outputs_sha256, execution.get("outputs_sha256")
    )
    if not outputs_sha256:
        raise ReconciliationInputError(
            "no outputs_sha256: pass --outputs-sha256 or supply receipt.json"
        )
    stated_years = execution.get("years")
    years = _agrees(
        "years",
        None if years is None else _whole_years(years, "--years"),
        (
            None
            if stated_years is None
            else _whole_years(stated_years, "the receipt's years")
        ),
    )
    if not years:
        raise ReconciliationInputError(
            "no years: pass --years or supply receipt.json"
        )
    stated_supported = dashboard.get("dataset_years")
    supported = _agrees(
        "supported-years",
        (
            None
            if supported_years is None
            else _whole_years(supported_years, "--supported-years")
        ),
        (
            None
            if stated_supported is None
            else _whole_years(stated_supported, "the receipt's dataset_years")
        ),
    )
    if not budgetary:
        raise ReconciliationInputError(
            f"no budgetary_impact rows for {measure_id}"
        )
    return reconcile(
        budgetary,
        measure_id=measure_id,
        outputs_sha256=outputs_sha256,
        sources=load_sources(inputs / "sources"),
        mapping=load_mapping(inputs / "mapping.csv"),
        exceptions=load_exceptions(inputs / "exceptions.yaml"),
        policy=load_policy(inputs / "policy.yaml"),
        expected=load_expected(inputs / "expected_effects.csv"),
        years=years,
        supported_years=None if supported is None else set(supported),
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m uk_budget_data.publication.reconcile",
        description="Reconcile an artifact against the Treasury costings.",
    )
    parser.add_argument("artifact", type=Path)
    parser.add_argument(
        "--inputs", type=Path, default=Path("data_inputs/treasury")
    )
    parser.add_argument("--measure-id", default=None)
    parser.add_argument("--outputs-sha256", default=None)
    parser.add_argument("--supported-years", nargs="+", type=int, default=None)
    parser.add_argument(
        "--years",
        nargs="+",
        type=int,
        default=None,
        help="the years the artifact reports (default: its receipt's)",
    )
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="print the result without writing reconciliation.json",
    )
    args = parser.parse_args(argv)
    try:
        result = reconcile_artifact(
            args.artifact,
            args.inputs,
            measure_id=args.measure_id,
            outputs_sha256=args.outputs_sha256,
            supported_years=(
                set(args.supported_years) if args.supported_years else None
            ),
            years=args.years,
        )
    except ReconciliationInputError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if not args.no_write:
        (args.artifact / "reconciliation.json").write_text(text)
    for row in result["rows"]:
        comparator = row.get("comparator", {}).get("value_bn")
        ours = row["pe_bn"]
        print(
            f"{row['fiscal_year']}: ours "
            f"{'—' if ours is None else format(ours, '+.3f') + 'bn'}, Treasury "
            f"{'—' if comparator is None else format(comparator, '+.3f') + 'bn'}"
            f" -> {row['status']}"
        )
    print(
        f"summary: {result['summary']['status']}; responsiveness: "
        f"{result['responsiveness']['status']}"
    )
    ok = (
        result["summary"]["status"] in (PASS, ACCEPTED)
        and result["responsiveness"]["status"] == "responsive"
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
