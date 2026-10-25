"""Past fiscal events' measures, imported from policyengine-scorecard.

The scorecard replays each UK fiscal event's measures on a certified model
and data pair and exports, per event, every measure with its construction
(policyengine-scorecard ``docs/uk_replay/DASHBOARD_EXPORT.md``). This module
turns one export into the dashboard's own registry for that event
(``events/<release id>.json``), which ``reform_for`` reads into ``Reform``
objects that the dashboard's pipeline runs on today's certified model and
data, as it runs this Budget's measures. A historical figure is therefore
what the event's measures are worth under today's law, model and data, not
what was known when the event was announced (docs/historical-releases.md).

The import rule. A replayed measure has two worlds, one of them the
engine's current law and the other constructed: a measure in current law
(``reversal_on_certified_world``) is costed against a baseline that undoes
it, and one not in current law (``forward_delta_on_certified_world``)
against a reform that adds it. For every parameter and replay year where
the two worlds' intended values differ (the values the replay checked the
engine read, at 1 January on the annualised tree), the constructed world's
value is written under that bare year; every other year is left at the
dashboard's own current law. The constructed world is the baseline of a
reversal and the reform of a forward delta; the other side is the
dashboard's current law, never this Budget's configured baseline. A bare
year is that fiscal year (that calendar year on a calendar-year series) in
the dashboard's engine, which is what the engine reads at 1 January of the
year: ``tests/test_historical_events.py`` checks the built values against
the replay's, parameter by parameter.

The Universal Credit health route (the replay's
``uc_health_element_refresh``) is built with the dashboard's own template,
``uc_health_element_change``. A measure the rule cannot carry (another
executor route, a sentinel value, no change at all, a change in no year the
dashboard scores, or a scored year an uprated amount would leave out) is
not imported and is listed, with its reason, beside the measures the
replay did not compute.

The dashboard scores a historical release over the policy years the
replay also covers (``budget_years.json`` policy years that the replay
supports).
"""

import csv
import hashlib
import io
import json
import math
import warnings
from contextlib import contextmanager
from decimal import Decimal, Inexact, localcontext
from functools import lru_cache
from importlib.resources import files
from pathlib import Path
from typing import Optional

from uk_budget_data import releases
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.models import Reform
from uk_budget_data.publication.release_index import (
    HISTORICAL_OBR_COMPARISON_HEADER,
    METADATA_HEADERS,
)

SCHEMA = "uk-budget-dashboard/historical-event/v1"
EXPORT_SCHEMA = "policyengine-scorecard/uk-event-dashboard-export/v1"
EVENTS_DIR = "events"
REVERSAL = "reversal_on_certified_world"
FORWARD = "forward_delta_on_certified_world"
CONSTRUCTED_WORLD = {REVERSAL: "baseline_world", FORWARD: "reform_world"}
CURRENT_LAW_WORLD = {REVERSAL: "reform_world", FORWARD: "baseline_world"}
UC_HEALTH_ROUTE = "uc_health_element_refresh"
EXCHEQUER_POSITIVE = "positive_gain_to_exchequer"
# The classes the scorecard partitions an event's measures into, and the
# kinds of gap it gives a measure it could not express.
CLASSES = (
    "expressible",
    "partial",
    "not_expressible",
    "out_of_household_scope",
)
# A measure the replay computed that the dashboard cannot carry
DASHBOARD_IMPORT_GAP = "dashboard_import"

# The flat view files' headers, as the release index checks them
COVERAGE_HEADER = METADATA_HEADERS["coverage.csv"]
NOT_MODELLED_HEADER = METADATA_HEADERS["not_modelled.csv"]
OBR_COMPARISON_HEADER = HISTORICAL_OBR_COMPARISON_HEADER
# The row the coverage table gives the replay's computed measures; the
# class rows (gap_kind empty) partition the event, and the gap-kind rows
# break down the not-expressible class.
COMPUTED_ROW = "computed_by_replay"


class EventImportError(ValueError):
    """An export, or an event registry, the dashboard cannot use."""


def decode(value):
    """A replay value: a boolean, a number, or ``"inf"``/``"-inf"``."""
    if isinstance(value, bool):
        return value
    if value in ("inf", "-inf"):
        return float(value)
    if isinstance(value, (int, float)) and math.isfinite(value):
        return value
    raise EventImportError(f"{value!r} is not a replay parameter value")


def encode(value):
    """The registry's spelling of a value: JSON has no infinity."""
    if isinstance(value, float) and math.isinf(value):
        return "inf" if value > 0 else "-inf"
    return value


def _equal(left, right) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    return left == right


def scored_years(supported) -> list[int]:
    """The years the dashboard scores an event over: its policy years that
    the replay also supports."""
    return sorted(set(POLICY_YEARS) & {int(year) for year in supported})


def release_for_event(slug: str) -> releases.Release:
    for release in releases.RELEASES.values():
        if release.historical and release.event == slug:
            return release
    raise EventImportError(f"no registered release replays {slug!r}")


def _constructed_changes(measure: dict) -> dict[str, dict[str, object]]:
    """The constructed world's value for each parameter and year where it
    differs from current law's, keyed by bare year."""
    kind = measure["construction"]["kind"]
    constructed, current = CONSTRUCTED_WORLD[kind], CURRENT_LAW_WORLD[kind]
    changes: dict[str, dict[str, object]] = {}
    for year in measure["years"]:
        values = year["processed_parameter_values"]
        paths = set(values.get(constructed, {})) | set(values.get(current, {}))
        for path in sorted(paths):
            if path not in values.get(constructed, {}):
                raise EventImportError(
                    f"{measure['measure_key']}: {path} has no constructed "
                    f"value in {year['year']}"
                )
            mine = decode(values[constructed][path]["intended"])
            theirs = values.get(current, {}).get(path)
            if theirs is not None and _equal(mine, decode(theirs["intended"])):
                continue
            changes.setdefault(path, {})[str(year["year"])] = encode(mine)
    return changes


def _not_imported(measure: dict, reason: str) -> dict:
    return {
        "reform_id": measure["measure_key"],
        "reform_name": measure["title"],
        "classification": measure["classification"],
        "gap_kind": DASHBOARD_IMPORT_GAP,
        "reason": reason,
    }


def _import_measure(measure: dict, years: list[int]):
    """The registry record for a computed measure, or why it is not
    imported."""
    construction = measure["construction"]
    kind = construction["kind"]
    if kind not in CONSTRUCTED_WORLD:
        return None, f"the replay's construction {kind} has no import rule"
    route = construction.get("executor_route")
    if route not in (None, UC_HEALTH_ROUTE):
        return None, (
            f"the replay ran the {route} route, which the dashboard has no "
            "template for"
        )
    if construction.get("sentinels"):
        return None, (
            "the replay's construction relies on a value the engine reads "
            "as no limit, which the dashboard does not carry"
        )
    changes = _constructed_changes(measure)
    if not changes:
        return None, "the replay's construction changes no parameter"
    first = min(int(y) for values in changes.values() for y in values)
    replay_by_year = {int(y["year"]): y for y in measure["years"]}
    if first > max(years, default=0) or not any(
        replay_by_year.get(year, {}).get("measure_total_gbp")
        or any(str(year) in values for values in changes.values())
        for year in years
    ):
        return None, (
            "in the years the dashboard scores, the replay's construction "
            "changes nothing and the replay costs nothing"
        )
    record = {
        "id": measure["measure_key"],
        "name": measure["title"],
        "construction": kind,
        "classification": measure["classification"],
        "executor_route": route,
        "missing_legs": list(measure.get("missing_legs") or []),
        "changes": {
            path: dict(sorted(values.items()))
            for path, values in sorted(changes.items())
        },
        "replay": {
            str(y["year"]): {
                "measure_total_gbp": y["measure_total_gbp"],
                "head_effects": y["head_effects"],
                "intended": {
                    world: {
                        path: v["intended"]
                        for path, v in sorted(paths.items())
                    }
                    for world, paths in sorted(
                        y["processed_parameter_values"].items()
                    )
                },
            }
            for y in measure["years"]
        },
    }
    try:
        reform = reform_for(record)
        _check_scored_years(reform, years)
    except (ValueError, KeyError) as error:
        return None, f"the dashboard cannot build it: {error}"
    return record, None


def _check_scored_years(reform: Reform, years: list[int]) -> None:
    from policyengine_uk.system import system

    from uk_budget_data.scored_years import missing_scored_years

    gaps = missing_scored_years(
        reform.baseline_parameter_changes,
        reform.parameter_changes,
        years,
        system,
    )
    if gaps:
        raise ValueError("; ".join(gap.reason for gap in gaps))


@contextmanager
def _exact():
    """Decimal arithmetic that refuses to round: OBR cells are exact
    decimals, and so are their sums."""
    with localcontext() as context:
        context.prec = 1000
        context.traps[Inexact] = True
        yield


def _gbp_sum(values) -> str:
    """The exact sum of decimal pound amounts, as plain decimal text."""
    with _exact():
        total = sum((Decimal(str(value)) for value in values), Decimal(0))
        text = format(total.normalize(), "f")
    return "0" if text in ("-0", "0") else text


def coverage_rows(export: dict) -> list[list[str]]:
    """The event's coverage: one row per class (a partition of its
    measures and of the absolute value of every OBR cell), one per kind of
    gap in the not-expressible class, and the replay's computed measures.
    Shares are exact fractions, as the scorecard states them."""
    accounting = export["accounting"]
    rows = []
    for name in CLASSES:
        entry = accounting["by_class"][name]
        rows.append(
            [
                name,
                "",
                entry["measures"],
                entry["rows"],
                entry["net_gbp_decimal"],
                entry["absolute_gbp_decimal"],
                entry["share_of_absolute"],
                entry["share_of_measures"],
            ]
        )
    for gap, entry in sorted(
        accounting["not_expressible_by_gap_kind"].items()
    ):
        rows.append(
            [
                "not_expressible",
                gap,
                entry["measures"],
                entry["rows"],
                entry["net_gbp_decimal"],
                entry["absolute_gbp_decimal"],
                entry["share_of_absolute"],
                entry["share_of_measures"],
            ]
        )
    computed = accounting["computed"]
    rows.append(
        [
            COMPUTED_ROW,
            "",
            computed["measures"],
            computed["rows"],
            "",
            computed["absolute_gbp_decimal"],
            computed["share_of_absolute"],
            computed["share_of_measures"],
        ]
    )
    return [[str(value) for value in row] for row in rows]


def import_export(export: dict, export_sha256: str) -> dict:
    """The dashboard's registry for one exported event."""
    if export.get("schema") != EXPORT_SCHEMA:
        raise EventImportError("not a scorecard event dashboard export")
    if export.get("sign_convention") != EXCHEQUER_POSITIVE:
        raise EventImportError("the export's sign convention is not known")
    release = release_for_event(export["event"]["slug"])
    years = scored_years(export["years"]["supported"])
    if not years:
        raise EventImportError(
            f"{release.id}: the replay covers none of the dashboard's "
            "policy years"
        )
    measures, not_modelled = [], []
    reserved = set(_reserved_ids())
    for measure in sorted(export["measures"], key=lambda m: m["measure_key"]):
        if measure["measure_key"] in reserved:
            raise EventImportError(
                f"{measure['measure_key']} is already a dashboard measure id"
            )
        rows = measure.get("obr_rows") or []
        listed = {
            "rows": len(rows),
            "obr_absolute_gbp": _gbp_sum(
                Decimal(row["obr_value_gbp_decimal"]).copy_abs()
                for row in rows
            ),
        }
        if not measure["computed"]:
            not_modelled.append(
                {
                    "reform_id": measure["measure_key"],
                    "reform_name": measure["title"],
                    "classification": measure["classification"],
                    "gap_kind": measure.get("gap_kind") or "",
                    "reason": measure.get("reason") or "",
                    **listed,
                }
            )
            continue
        record, reason = _import_measure(measure, years)
        if record is None:
            not_modelled.append({**_not_imported(measure, reason), **listed})
            continue
        record["obr"] = _obr_by_year(rows, years)
        measures.append(record)
    return {
        "schema": SCHEMA,
        "release": release.id,
        "event": export["event"]["slug"],
        "name": export["event"]["name"],
        "source": {
            "export_schema": export["schema"],
            "export_sha256": export_sha256,
            "registry_sha256": export["event"]["registry_sha256"],
            "variant": {
                key: export["variant"][key]
                for key in (
                    "packages",
                    "dataset",
                    "namespace_manifest_sha256",
                    "receipt_sha256",
                    "comparison_sha256",
                )
                if key in export["variant"]
            },
        },
        "replay_years": [int(y) for y in export["years"]["supported"]],
        "years": years,
        "measures": measures,
        "not_modelled": not_modelled,
        "coverage": coverage_rows(export),
    }


def _obr_by_year(rows: list[dict], years: list[int]) -> dict:
    """The OBR's costing of a measure by scored year: every head, and the
    heads the replay models (its constructed rows)."""
    result = {}
    for year in years:
        cells = [row for row in rows if int(row["year"]) == year]
        if not cells:
            continue
        result[str(year)] = {
            "obr_gbp": _gbp_sum(r["obr_value_gbp_decimal"] for r in cells),
            "obr_modelled_heads_gbp": _gbp_sum(
                r["obr_value_gbp_decimal"]
                for r in cells
                if r["status"] == "constructed"
            ),
        }
    return result


def _reserved_ids() -> list[str]:
    from uk_budget_data.reforms import list_reform_ids

    return list_reform_ids()


# --- the registry -----------------------------------------------------


def event_path(release: releases.Release, root: Optional[Path] = None):
    if root is not None:
        return Path(root) / f"{release.id}.json"
    return files("uk_budget_data").joinpath(EVENTS_DIR, f"{release.id}.json")


def canonical_json(document) -> str:
    return json.dumps(document, indent=1, sort_keys=True) + "\n"


def write_event(document: dict, root: Path) -> Path:
    path = Path(root) / f"{document['release']}.json"
    path.write_text(canonical_json(document))
    return path


def validate_event(document: dict, release: releases.Release) -> dict:
    if not isinstance(document, dict) or document.get("schema") != SCHEMA:
        raise EventImportError(f"{release.id}: unknown event schema")
    if (
        document.get("release") != release.id
        or document.get("event") != release.event
    ):
        raise EventImportError(
            f"{release.id}: the event registry is for another release"
        )
    for record in document["measures"]:
        if record.get("construction") not in CONSTRUCTED_WORLD:
            raise EventImportError(
                f"{release.id}: {record.get('id')} has no import rule"
            )
    ids = [m["id"] for m in document["measures"]] + [
        m["reform_id"] for m in document["not_modelled"]
    ]
    if len(ids) != len(set(ids)):
        raise EventImportError(f"{release.id}: a measure is listed twice")
    if not set(document["years"]) <= set(POLICY_YEARS):
        raise EventImportError(
            f"{release.id}: scores a year outside the policy years"
        )
    return document


@lru_cache(maxsize=None)
def load_event(release_id: str) -> Optional[dict]:
    """A historical release's registry, or None if none is imported."""
    release = releases.get_release(release_id)
    if not release.historical:
        raise EventImportError(f"{release_id} is not a past event")
    path = event_path(release)
    if not path.is_file():
        return None
    return validate_event(json.loads(path.read_text()), release)


def _parameter_values(path: str, values: dict) -> dict:
    """Validate one parameter's change as the measure templates do: a
    leaf in the installed tree, no UC health trap, bare four-digit years."""
    from uk_budget_data.measure_templates import (
        _refuse_uc_health_traps,
        _validate_parameter_path,
    )

    _validate_parameter_path(path)
    built = {}
    for year, value in values.items():
        if not (len(year) == 4 and year.isdigit() and year[0] != "0"):
            raise ValueError(f"{path}: {year!r} is not a bare year")
        built[year] = decode(value)
    _refuse_uc_health_traps(path, built)
    return built


def reform_for(record: dict) -> Reform:
    """The dashboard measure for an imported record.

    A reversal's constructed world is its baseline and its reform is the
    dashboard's current law; a forward delta's constructed world is its
    reform and its baseline current law. Both sides are explicit (an empty
    change is current law), so this Budget's configured baseline is never
    used.
    """
    from uk_budget_data.measure_templates import (
        UC_NEW_CLAIMANT_HEALTH,
        UC_PROTECTED_HEALTH,
        uc_health_element_change,
    )

    changes = {}
    if record.get("executor_route") == UC_HEALTH_ROUTE:
        health = {UC_PROTECTED_HEALTH, UC_NEW_CLAIMANT_HEALTH}
        other = set(record["changes"]) - health
        if other:
            raise ValueError(
                "the UC health route changes only the health element: "
                + ", ".join(sorted(other))
            )
        changes = uc_health_element_change(
            protected=record["changes"].get(UC_PROTECTED_HEALTH),
            new_claimant=record["changes"].get(UC_NEW_CLAIMANT_HEALTH),
        )
    else:
        with warnings.catch_warnings():
            # A limited parameter warns again when the measure is
            # generated, where the warning decides its status
            warnings.simplefilter("ignore")
            changes = {
                path: _parameter_values(path, values)
                for path, values in record["changes"].items()
            }
    description = _description(record)
    if record["construction"] == REVERSAL:
        return Reform(
            id=record["id"],
            name=record["name"],
            description=description,
            parameter_changes={},
            baseline_parameter_changes=changes,
        )
    return Reform(
        id=record["id"],
        name=record["name"],
        description=description,
        parameter_changes=changes,
        baseline_parameter_changes={},
    )


def _description(record: dict) -> str:
    how = (
        "costed against today's law with the measure undone"
        if record["construction"] == REVERSAL
        else "costed by adding the measure to today's law"
    )
    text = f"Replayed on today's model and data, {how}."
    if record["missing_legs"]:
        text += " Not modelled: " + " ".join(
            leg.rstrip(".") + "." for leg in record["missing_legs"]
        )
    return text


def release_reform_lookup(release: releases.Release):
    """The reform lookup a release's generation uses: this Budget's
    registry for it, an imported event's for a past event (and nothing
    from another release)."""
    if not release.historical:
        from uk_budget_data.reforms import get_reform as current

        return current
    document = load_event(release.id)
    if document is None:
        raise EventImportError(f"{release.id}: no event registry is imported")
    records = {record["id"]: record for record in document["measures"]}

    def lookup(reform_id: str) -> Optional[Reform]:
        record = records.get(reform_id)
        return reform_for(record) if record is not None else None

    return lookup


# --- the release's flat files -------------------------------------------


def _csv(header, rows) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def flat_files(document: dict) -> dict[str, str]:
    """A release's three flat view files: coverage, the measures it does
    not model, and the OBR's costing of the measures it does, by scored
    year, beside the replay's own figure on its pair (none from the
    dashboard: the page reads those from the release's artifacts), with
    the model and data the replay ran on."""
    variant = document["source"]["variant"]
    pair = (
        f"policyengine-uk {variant['packages']['policyengine-uk']}, "
        f"{variant['dataset']['path']} at revision "
        f"{variant['dataset']['revision']}"
    )
    obr = []
    for record in document["measures"]:
        for year, costing in sorted(record["obr"].items()):
            replay = record["replay"].get(year, {}).get("measure_total_gbp")
            obr.append(
                [
                    record["id"],
                    record["name"],
                    year,
                    costing["obr_gbp"],
                    costing["obr_modelled_heads_gbp"],
                    "" if replay is None else repr(float(replay)),
                    pair,
                ]
            )
    not_modelled = [
        [row[name] for name in NOT_MODELLED_HEADER]
        for row in document["not_modelled"]
    ]
    return {
        "coverage.csv": _csv(COVERAGE_HEADER, document["coverage"]),
        "not_modelled.csv": _csv(NOT_MODELLED_HEADER, not_modelled),
        "obr_comparison.csv": _csv(OBR_COMPARISON_HEADER, obr),
    }


def import_file(
    export_path: Path, events_root: Path, data_root: Optional[Path] = None
) -> tuple[Path, list[Path]]:
    """Import one export: write its registry under ``events_root`` and,
    given the default release's data root (normally public/data), its flat
    view files into the release's own root there."""
    raw = Path(export_path).read_bytes()
    document = import_export(json.loads(raw), hashlib.sha256(raw).hexdigest())
    release = releases.get_release(document["release"])
    registry = write_event(document, events_root)
    written = []
    if data_root is not None:
        root = releases.data_root_for(release, Path(data_root))
        root.mkdir(parents=True, exist_ok=True)
        for name, text in flat_files(document).items():
            path = root / name
            path.write_text(text)
            written.append(path)
    load_event.cache_clear()
    return registry, written
