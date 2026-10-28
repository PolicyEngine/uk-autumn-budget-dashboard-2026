"""Stage, approve, check and withdraw manifest entries.

The gates, in order:

1. **Integrity.** The receipt describes itself consistently, its derived
   fields follow from their sources, and the files on disk are the files it
   lists. A manifest entry names its artifact by digest, and the directory
   must still hold exactly those bytes.
2. **One execution identity.** The artifact ran on the manifest's execution
   identity and declared basis.
3. **Certification.** The receipt is publishable: a certified model and data
   pair whose certificate verifies, generated from a clean tree.
4. **Responsiveness.** The measure moves, in the expected direction. An
   inert, wrong-direction or undeclared measure is never staged.
4a. **Data limits.** A measure the certified data cannot cost
   (``uk_budget_data.data_limits``, recorded in its receipt) is staged only
   as ``not_computable``: listed with its reason, never with a figure, and
   never approved. Its artifact is receipt-only: the receipt lists no
   files, and the directory holds ``receipt.json`` and nothing else. It
   skips responsiveness and reconciliation, which would only measure the £0
   the data give it, and the hold on hand-written modifiers (4c), since it
   publishes no figure to release. It must still be publishable, so its
   certificate is still verified (``receipt.dashboard_problems``).
4b. **Model limits.** A measure the installed model overstates until a
   known fix lands (``uk_budget_data.model_limits``, recorded in its
   receipt) may be staged or provisional, with its figure, but is never
   approved.
4c. **Hand-written modifiers.** While a data limit is active, an artifact
   whose receipt binds a hand-written modifier on either side is held at
   every figure level until two people attest its exact receipt
   (``attestations``); a release never waives any other check.
4d. **The floor of survey households** (``disclosure_floor``). A
   provisional or approved artifact with household tables must have been
   held to it: its receipt records the check, so one generated before the
   floor is regenerated first. One whose decile tables still hold a cell
   under it is never staged or shown, so ``publish review-rows`` deletes
   it before anything is committed.
5. **Completeness** (approval only). Every supported year is covered and
   every table is complete.
6. **Reconciliation** (approval only). Every comparable year passes or
   carries an accepted exception. Reconciliation and responsiveness are
   recomputed from the current Treasury inputs at every gate; the
   ``reconciliation.json`` file is a record for people, never trusted.
7. **Combined runs.** Every member is in the manifest with the measure
   definition the combined run used, and with the outputs it had when the
   combined run was generated; approval needs every member approved.

An entry's name is the one its receipt records (``dashboard.name``), which
any tables the artifact has must also carry; it is never taken from the key.

Staging an artifact supersedes the previous entry for its key and marks any
combined run that included different outputs for that measure as stale, in
the same write.
"""

import json
import os
from pathlib import Path
from typing import Optional

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.artifacts import (
    COMBINED_PREFIX,
    RECEIPT_FILE,
    capture,
    captured_file_problems,
    captured_tables,
    read_receipt,
)
from uk_budget_data.publication.attestations import (
    load_attestation,
    requires_attestation,
    validate_attestation,
)
from uk_budget_data.publication.combine import combined_key
from uk_budget_data.publication.disclosure_floor import (
    AGE_TABLE,
    DECILE_TABLES,
    FLOOR_TABLES,
    FLOOR_TABLES_BEFORE_THE_LIST,
    METRICS_TABLES,
    withheld_age_labels,
)
from uk_budget_data.publication.receipt import (
    artifact_sha256,
    certificate_problems,
    composition_problems,
    dashboard_problems,
    document_problems,
    load_execution_receipt,
)
from uk_budget_data.publication.reconcile import (
    ACCEPTED,
    PASS,
    ReconciliationInputError,
    budgetary_from_rows,
    load_expected,
    reconcile_receipted,
)
from uk_budget_data.publication.responsiveness import RESPONSIVE
from uk_budget_data.publication.tables import TABLES
from uk_budget_data.publication.validate import (
    table_problems,
    withholding_problems,
)

TREASURY_INPUTS = Path("data_inputs/treasury")
# TODO(W5): require household receipts once the deployed-route checker
# (household_route.py) has fixtures from the team.
REQUIRE_HOUSEHOLD_CHECKS = False


class PublishError(RuntimeError):
    """Raised when an operation is refused; ``problems`` says why."""

    def __init__(self, subject: str, problems: list[str]):
        super().__init__(f"{subject}: " + "; ".join(problems))
        self.subject = subject
        self.problems = problems


def is_combined(key: str) -> bool:
    return key.startswith(COMBINED_PREFIX)


def artifact_dir(entry: m.Entry, data_root: Path) -> Path:
    return data_root / entry.artifact


def recompute_reconciliation(
    document: dict, tables: dict, key: str, inputs: Path
) -> tuple[Optional[dict], list[str]]:
    """Reconcile a captured artifact afresh against the Treasury inputs.

    ``tables`` are the rows the gate checked against ``document``, so what
    is reconciled is exactly what was verified.
    """
    try:
        # One finite output per year: a repeated year is refused, not
        # silently replaced by whichever row came last.
        budgetary = budgetary_from_rows(
            tables.get("budgetary_impact") or [], key, "budgetary_impact"
        )
        return (
            reconcile_receipted(document, budgetary, inputs, measure_id=key),
            [],
        )
    except (ReconciliationInputError, ValueError, OSError) as error:
        return None, [f"reconciliation: {error}"]


def binding_problems(
    document: dict, tables: dict, entry: m.Entry, key: str
) -> list[str]:
    """Ways the artifact on disk is not the one the manifest entry names.

    Besides the digests, every field the entry copies from the receipt
    (name, years, unsupported years, and a combined run's members and
    member snapshot) must still say what the receipt says, so nothing that
    reads the manifest alone can be told something else. The name is the
    receipt's, and so is the tables' (``_name_problems``), whichever the
    artifact has; never the key.
    """
    dashboard = document["dashboard"]
    digests = dashboard["digests"]
    problems = _name_problems(dashboard, tables)
    actual = artifact_sha256(document)
    if actual != entry.artifact_sha256:
        problems.append(
            "the artifact on disk is not the one this entry names "
            f"({actual[:12]} is not {entry.artifact_sha256[:12]})"
        )
    for name in (
        "outputs_sha256",
        "receipt_sha256",
        "execution_identity_sha256",
    ):
        if digests[name] != getattr(entry, name):
            problems.append(f"the artifact's {name} is not the entry's")
    if entry.name != dashboard.get("name"):
        problems.append("the entry's name is not the artifact's")
    if entry.description != dashboard.get("description", ""):
        problems.append("the entry's description is not the artifact's")
    personal = (
        entry.personal.model_dump(exclude_none=True)
        if entry.personal
        else None
    )
    if personal != dashboard.get("personal"):
        problems.append("the entry's personal mapping is not the artifact's")
    if entry.years != document["execution_receipt"]["years"]:
        problems.append("the entry's years are not the artifact's")
    if entry.unsupported_years != dashboard["unsupported_years"]:
        problems.append("the entry's unsupported years are not the artifact's")
    if entry.data_limits != _limit_keys(dashboard):
        problems.append("the entry's data limits are not the artifact's")
    elif entry.status == m.NOT_COMPUTABLE and entry.reason != _limit_reason(
        dashboard
    ):
        problems.append("the entry's reason is not the artifact's")
    if is_combined(key):
        if entry.measures != list(dashboard.get("measure_ids") or []):
            problems.append("the entry's members are not the artifact's")
        if entry.member_outputs_sha256 != dashboard.get(
            "member_outputs_sha256"
        ):
            problems.append(
                "the entry's member snapshot is not the artifact's"
            )
    elif entry.measures is not None or entry.member_outputs_sha256 is not None:
        problems.append("a measure's entry names combined-run members")
    if entry.attestation is not None:
        try:
            validate_attestation(document, entry.attestation.model_dump())
        except (ValueError, TypeError) as error:
            problems.append(f"the entry's attestation is invalid: {error}")
    return problems


def _name_problems(dashboard: dict, tables: dict) -> list[str]:
    """Ways the artifact does not carry one name: its receipt must record
    one, and every row of every table it has with a ``reform_name`` column
    must say the same."""
    name = dashboard.get("name")
    if not isinstance(name, str) or not name.strip():
        return ["its receipt records no name for the page to show"]
    if not isinstance(dashboard.get("description", ""), str):
        return ["its receipt's public description is not text"]
    if dashboard.get("personal") is not None:
        try:
            m.PersonalSeries.model_validate(dashboard["personal"])
        except ValueError:
            return ["its receipt's personal mapping is invalid"]
    differing = sorted(
        table
        for table, rows in tables.items()
        if "reform_name" in TABLES[table].column_names
        and any(row.get("reform_name") != name for row in rows)
    )
    if differing:
        return [
            "its tables name it differently from its receipt: "
            + ", ".join(differing)
        ]
    return []


def _receipt_only_problems(document: dict, path: Path) -> list[str]:
    """Ways a not-computable artifact holds more than its receipt.

    It binds no figures: its receipt lists no files, and its directory
    holds ``receipt.json`` and nothing else, whatever the other entry is
    (a stray table, ``reconciliation.json``, a directory).
    """
    problems = []
    if document["dashboard"].get("files"):
        problems.append(
            "its receipt lists files, but a not-computable artifact binds "
            "no figures"
        )
    receipt = path / RECEIPT_FILE
    if receipt.is_symlink() or not receipt.is_file():
        problems.append(f"its {RECEIPT_FILE} is not a regular file")
    try:
        names = sorted(os.listdir(path))
    except OSError as error:
        return problems + [f"its directory cannot be listed: {error}"]
    problems += [
        f"{name} is in it, but a not-computable artifact holds only "
        f"{RECEIPT_FILE}"
        for name in names
        if name != RECEIPT_FILE
    ]
    return problems


def _limit_keys(dashboard: dict) -> list[str]:
    return [item["key"] for item in dashboard.get("data_limits") or []]


def _limit_reason(dashboard: dict) -> str:
    return " ".join(item["reason"] for item in dashboard["data_limits"])


def _identity_problems(document: dict, manifest: m.Manifest) -> list[str]:
    """Ways the artifact's provenance is not the manifest's.

    A manifest holding any entry must record the one execution identity
    and the one forecast and calibration basis its entries share, and the
    whole identity it records (not only its digest) must be the one this
    artifact ran on.
    """
    digests = document["dashboard"]["digests"]
    problems = []
    if manifest.execution is None:
        problems.append("the manifest records no execution identity")
    else:
        if (
            digests["execution_identity_sha256"]
            != manifest.execution.execution_identity_sha256
        ):
            problems.append(
                "it ran on a different execution identity from the manifest"
            )
        try:
            identity = load_execution_receipt(document).execution_identity()
        except (ValueError, KeyError) as error:
            problems.append(f"its execution identity cannot be read: {error}")
        else:
            if json.loads(json.dumps(identity)) != manifest.execution.identity:
                problems.append(
                    "the manifest's execution identity is not the one it "
                    "ran on"
                )
    if manifest.basis is None:
        problems.append(
            "the manifest records no forecast and calibration basis"
        )
    elif document["dashboard"]["basis"] != manifest.basis:
        problems.append("its forecast and calibration basis differs")
    return problems


def _members_problems(
    document: dict,
    manifest: m.Manifest,
    data_root: Path,
    need: tuple[str, ...],
) -> list[str]:
    """Check a combined run's members against the manifest's measures.

    Each member must be in the manifest at a needed status, with the measure
    definition the combined run used, and with the outputs it had when the
    combined run was generated (recorded in the combined receipt).

    Every not-computable member has the outputs digest of no files, so the
    snapshot cannot tell two such artifacts of one measure apart. Staging
    the second still stales the combined run (``stage``), but restaging
    that run unchanged is not refused here while the member's definition
    is unchanged (a changed one is refused below). No figure rests on it:
    a combined run with a not-computable member is not computable itself.
    """
    dashboard = document["dashboard"]
    recorded = dashboard.get("member_outputs_sha256")
    problems = []
    ids = sorted(dashboard.get("measure_ids") or [])
    records = sorted(m["id"] for m in dashboard.get("members") or [])
    if not ids or records != ids:
        problems.append(
            "its member records do not match its measure ids "
            f"({records} against {ids})"
        )
    if recorded is not None and sorted(recorded) != ids:
        problems.append("its member snapshot does not cover its members")
    if dashboard.get("key") != combined_key(ids):
        problems.append("its key does not name exactly its members")
    problems += composition_problems(document)
    if not recorded:
        problems.append(
            "it does not record its members' outputs; generate it after "
            "staging every member"
        )
        recorded = {}
    for member in dashboard.get("members") or []:
        entry = manifest.measures.get(member["id"])
        if entry is None or entry.status not in need:
            wanted = " or ".join(need)
            problems.append(f"member {member['id']} is not {wanted}")
            continue
        if recorded and recorded.get(member["id"]) != entry.outputs_sha256:
            problems.append(
                f"member {member['id']} has different outputs from when "
                "this combined run was generated"
            )
        own_document = read_receipt(artifact_dir(entry, data_root))
        own = own_document["execution_receipt"]
        if m.NOT_COMPUTABLE not in need and requires_attestation(own_document):
            attestation, errors = load_attestation(own_document)
            problems += [f"member {member['id']}: {error}" for error in errors]
            if attestation != entry.attestation:
                problems.append(
                    f"member {member['id']}'s attestation changed; restage it"
                )
        for side in ("reform", "baseline"):
            # Kind, representation, digest and binding: everything an
            # identity's meaning depends on (its name is a label).
            if not isinstance(member.get(side), dict) or any(
                own[side].get(field) != member[side].get(field)
                for field in (
                    "kind",
                    "representation",
                    "reform_sha256",
                    "binding",
                )
            ):
                problems.append(
                    f"member {member['id']} was combined with a different "
                    f"{side} definition from its published artifact"
                )
    return problems


def gate_problems(
    key: str,
    path: Path,
    manifest: m.Manifest,
    *,
    level: str,
    data_root: Path,
    inputs: Path = TREASURY_INPUTS,
    household_receipt: Optional[dict] = None,
    entry: Optional[m.Entry] = None,
) -> tuple[list[str], dict]:
    """Every reason an artifact may not hold ``level``, plus what was read.

    ``level`` is ``staged``, ``provisional``, ``approved`` or
    ``not_computable``; an artifact recording a data limit may hold only
    the last, and must hold its receipt alone, and one recording none may
    not hold it, and must list its files. ``entry`` is the manifest entry
    the artifact is meant to be, when there is one: the artifact must then
    be exactly the bytes it names. The second return value carries the
    receipt document and reconciliation summary.
    """
    try:
        captured = capture(path)
    except (ValueError, OSError) as error:
        return [str(error)], {}
    document = captured.document
    problems = document_problems(document) + captured_file_problems(captured)
    if problems:
        return problems, {"document": document}
    # Every later check reads these rows, parsed from the bytes whose
    # digests were just checked; nothing is read from disk again.
    tables = captured_tables(captured)
    dashboard = document["dashboard"]
    if dashboard["key"] != key:
        return [f"the receipt is for {dashboard['key']!r}"], {
            "document": document
        }
    if path.name != artifact_sha256(document)[:16]:
        problems.append("its directory is not named by its digest")
    if entry is not None:
        problems += binding_problems(document, tables, entry, key)
    else:
        problems += _name_problems(dashboard, tables)
    problems += dashboard_problems(document)
    problems += _identity_problems(document, manifest)
    problems += _year_problems(document, tables)
    info: dict = {
        "document": document,
        "tables": tables,
        "reconciliation": None,
    }

    limited = bool(dashboard.get("data_limits"))
    if limited:
        problems += _receipt_only_problems(document, path)
    elif not dashboard.get("files"):
        problems.append(
            "its receipt lists no files, which only a not-computable "
            "artifact may"
        )
    if limited and level != m.NOT_COMPUTABLE:
        return (
            problems
            + [
                f"not computable on current data, so it cannot be {level}: "
                f"{_limit_reason(dashboard)}"
            ],
            info,
        )
    if level == m.NOT_COMPUTABLE:
        if not limited:
            problems.append(
                "it records no data limit, so it is not 'not computable'"
            )
        if dashboard.get("publishable") is not True:
            reasons = dashboard.get("reasons") or ["no reason recorded"]
            problems += [f"not publishable: {r}" for r in reasons]
        if is_combined(key):
            problems += _members_problems(
                document,
                manifest,
                data_root,
                (m.STAGED, m.NOT_COMPUTABLE, *m.DISPLAYABLE),
            )
        return problems, info

    if requires_attestation(document):
        attestation, errors = load_attestation(document)
        problems += errors
        info["attestation"] = attestation
        if entry is not None and attestation != entry.attestation:
            problems.append(
                "the entry's attestation is not the current committed "
                "release; restage it"
            )

    problems += _floor_problems(dashboard, tables, level)
    if level in (m.PROVISIONAL, m.APPROVED):
        if dashboard.get("publishable") is not True:
            reasons = dashboard.get("reasons") or ["no reason recorded"]
            problems += [f"not publishable: {r}" for r in reasons]
        else:
            problems += [
                f"certificate: {problem}"
                for problem in certificate_problems(
                    load_execution_receipt(document)
                )
            ]

    outputs = dashboard["digests"]["outputs_sha256"]
    if is_combined(key):
        need = {
            m.STAGED: (m.STAGED, *m.DISPLAYABLE),
            m.PROVISIONAL: m.DISPLAYABLE,
            m.APPROVED: (m.APPROVED,),
        }[level]
        problems += _members_problems(document, manifest, data_root, need)
    else:
        reconciliation, errors = recompute_reconciliation(
            document, tables, key, inputs
        )
        if reconciliation is not None and (
            reconciliation["outputs_sha256"] != outputs
        ):
            reconciliation, errors = None, [
                "reconciliation ran on different outputs"
            ]
        if reconciliation is None:
            problems += errors
        else:
            summary = reconciliation["summary"]["status"]
            responsiveness = reconciliation["responsiveness"]["status"]
            info["reconciliation"] = m.ReconciliationSummary(
                summary_status=summary, responsiveness_status=responsiveness
            )
            if responsiveness != RESPONSIVE:
                problems.append(
                    f"responsiveness is {responsiveness}: the measure does "
                    "not move as expected"
                )
            if level == m.APPROVED and summary not in (PASS, ACCEPTED):
                problems.append(f"reconciliation is {summary}")

    if level == m.APPROVED and dashboard.get("model_limits"):
        problems.append(
            "held at provisional, not approved: "
            + " ".join(item["reason"] for item in dashboard["model_limits"])
        )

    if level == m.APPROVED:
        years = [
            year
            for year in document["execution_receipt"]["years"]
            if year not in dashboard["unsupported_years"]
        ]
        declared = [
            effect.from_year
            for effect in load_expected(inputs / "expected_effects.csv")
            if effect.measure_id == key
        ]
        problems += table_problems(
            _supported_rows(tables, years),
            key=key,
            years=years,
            effective_from_year=min(declared) if declared else None,
        )
        if not years:
            problems.append("no supported years to approve")
        if REQUIRE_HOUSEHOLD_CHECKS and not (
            household_receipt and household_receipt.get("pass")
        ):
            problems.append("no passing household receipt")
    return problems, info


def _floor_problems(dashboard: dict, tables: dict, level: str) -> list[str]:
    """Check the floor and the receipt's withholding at every figure level.

    Published thin decile cells are refused even at staging. Withheld
    decile rows must be present and blank, with their complementary all
    row, and a summary statistic is empty exactly where the receipt
    records it withheld (``_unrecorded_withheld``), and the age table holds
    no row its receipt's thin groups withhold (``_unwithheld_age_rows``).
    Provisional and approved household tables also need a recorded floor check that covers
    every table the floor now covers, so artifacts made before the floor,
    or before it covered the summary statistics (#285 review, finding 6),
    must be regenerated. No acknowledgement lifts any of these: such a
    cell rests on too few cases to publish.
    """
    floor = dashboard.get("disclosure_floor")
    problems = (
        withholding_problems(tables, floor)
        + _unrecorded_withheld(floor, tables)
        + _unwithheld_age_rows(floor, tables)
    )
    if floor is None:
        if level in (m.PROVISIONAL, m.APPROVED) and (
            tables.keys() & set(FLOOR_TABLES)
        ):
            return problems + [
                "its receipt records no check of its household tables "
                "against the floor of survey households, as for an artifact "
                "generated before the floor: regenerate it"
            ]
        return problems
    if not isinstance(floor, dict):
        return problems
    if level in (m.PROVISIONAL, m.APPROVED):
        covered = floor.get("tables", FLOOR_TABLES_BEFORE_THE_LIST)
        uncovered = [
            table
            for table in FLOOR_TABLES
            if table in tables and table not in covered
        ]
        if uncovered:
            problems.append(
                "its receipt's floor of survey households does not cover "
                f"{', '.join(uncovered)}, as for an artifact generated "
                "before the floor covered them: regenerate it"
            )
    if not floor.get("thin_cells_in_tables"):
        return problems
    cells = "; ".join(
        f"{cell['table']} {cell['year']} ({', '.join(cell['groups'])})"
        for cell in floor.get("thin_cells") or []
        if cell.get("table") in DECILE_TABLES
    )
    return problems + [
        "its tables hold cells resting on fewer than "
        f"{floor.get('survey_households')} survey households: {cells}"
    ]


def _unrecorded_withheld(floor: Optional[dict], tables: dict) -> list[str]:
    """A summary statistic whose cell and the receipt's floor record
    disagree. An empty cell the record does not name as withheld: only the
    floor may leave one empty (``disclosure_floor.thin_metrics``), so any
    other is a figure that failed, never to be shown as "Not published".
    Or a cell the record names as withheld that still holds a figure: that
    figure rests on 1 or 2 survey households, so it is never published,
    whatever the receipt says was done with it (#285 review, finding 1)."""
    record = floor if isinstance(floor, dict) else {}
    named = {
        (cell.get("table"), cell.get("year"), group)
        for cell in record.get("thin_cells") or []
        if isinstance(cell, dict) and cell.get("table") in METRICS_TABLES
        for group in cell.get("groups") or []
    }
    empty: set = set()
    held: set = set()
    for table in METRICS_TABLES:
        for row in tables.get(table) or []:
            for column, value in row.items():
                cell = (table, row["year"], column)
                if value is None and cell not in named:
                    empty.add(cell)
                elif value is not None and cell in named:
                    held.add(cell)
    return [
        f"{table} {year} {column}: empty, but its receipt does not record "
        "it withheld by the floor of survey households"
        for table, year, column in sorted(empty)
    ] + [
        f"{table} {year} {column}: recorded withheld by the floor, but holds "
        "a figure"
        for table, year, column in sorted(held)
    ]


def _unwithheld_age_rows(floor: Optional[dict], tables: dict) -> list[str]:
    """Age table rows its receipt records as withheld: each year's thin
    groups and whatever would give them back (``withheld_age_labels``),
    every row of the year when "all" is thin. Generation leaves them out;
    one still in the table rests on 1 or 2 survey households (#285 second
    review, the age table's counterpart of finding 1)."""
    record = floor if isinstance(floor, dict) else {}
    rows = tables.get(AGE_TABLE) or []
    problems = []
    for cell in record.get("thin_cells") or []:
        if not isinstance(cell, dict) or cell.get("table") != AGE_TABLE:
            continue
        year = cell.get("year")
        labels = [row["age_band"] for row in rows if row["year"] == year]
        withheld = withheld_age_labels(list(cell.get("groups") or []), labels)
        problems.extend(
            f"{AGE_TABLE} {year} {label}: recorded withheld by the floor, "
            "but in the table"
            for label in labels
            if withheld is None or label in withheld
        )
    return problems


def _year_problems(document: dict, tables: dict) -> list[str]:
    """Rows for years the receipt does not report.

    Checked on every table before unsupported years are set aside, so a
    row for an undeclared year is refused rather than filtered out of the
    checks while still reaching anything that reads the tables.
    """
    reported = set(document["execution_receipt"]["years"])
    problems = []
    for name, rows in sorted(tables.items()):
        extra = sorted(
            {row["year"] for row in rows if "year" in row} - reported
        )
        if extra:
            problems.append(
                f"{name} has rows for years its receipt does not report: "
                f"{extra}"
            )
    return problems


def _supported_rows(tables: dict, years: list[int]) -> dict:
    keep = set(years)
    return {
        name: [row for row in rows if row["year"] in keep]
        for name, rows in tables.items()
    }


def _mark_dependants_stale(
    manifest: m.Manifest, key: str, outputs: Optional[str]
) -> None:
    for _, entry in manifest.combined.items():
        if key not in (entry.measures or []):
            continue
        if (
            outputs is not None
            and (entry.member_outputs_sha256 or {}).get(key) == outputs
        ):
            continue
        if entry.status != m.WITHDRAWN:
            entry.status = m.STALE
            entry.reason = f"member {key} changed"
            entry.approval = None


def stage(
    manifest: m.Manifest,
    path: Path,
    *,
    data_root: Path,
    inputs: Path = TREASURY_INPUTS,
    provisional: bool = False,
    adopt_execution: bool = False,
    adopt_basis: bool = False,
) -> str:
    """Add or replace the manifest entry for an artifact. Returns its key.

    Raises PublishError if the artifact fails any gate for the level asked
    for. Nothing in the manifest changes when it is refused.
    """
    document = read_receipt(path)
    dashboard = document["dashboard"]
    key = dashboard["key"]
    digests = dashboard["digests"]
    # A measure the data cannot cost is not computable whatever was asked
    # for: its entry never carries a figure.
    if dashboard.get("data_limits"):
        level = m.NOT_COMPUTABLE
    else:
        level = m.PROVISIONAL if provisional else m.STAGED

    if is_combined(key) != bool(dashboard.get("members")):
        raise PublishError(
            key,
            [
                "a combined key needs a combined artifact, and a measure "
                "key a single-measure one"
            ],
        )
    working = manifest.model_copy(deep=True)
    changed_identity = (
        working.execution is not None
        and working.execution.execution_identity_sha256
        != digests["execution_identity_sha256"]
    )
    changed_basis = (
        working.basis is not None and working.basis != dashboard["basis"]
    )
    if changed_identity and not adopt_execution:
        raise PublishError(
            key,
            [
                "it ran on a different execution identity from the manifest; "
                "regenerate every entry and stage with --adopt-execution"
            ],
        )
    if changed_basis and not adopt_basis:
        raise PublishError(
            key,
            [
                "its forecast and calibration basis differs from the "
                "manifest; stage with --adopt-basis"
            ],
        )
    if changed_identity or changed_basis or working.execution is None:
        receipt = load_execution_receipt(document)
        if changed_identity or changed_basis:
            for other_key, entry in working.entries().items():
                if other_key != key and entry.status != m.WITHDRAWN:
                    entry.status = m.STALE
                    entry.reason = (
                        "the execution identity changed"
                        if changed_identity
                        else "the forecast and calibration basis changed"
                    )
                    entry.approval = None
        working.execution = m.Execution(
            execution_identity_sha256=digests["execution_identity_sha256"],
            identity=receipt.execution_identity(),
        )
        working.basis = dashboard["basis"]

    problems, info = gate_problems(
        key, path, working, level=level, data_root=data_root, inputs=inputs
    )
    if problems:
        raise PublishError(key, problems)

    try:
        relative = path.resolve().relative_to(data_root.resolve())
    except ValueError:
        raise PublishError(
            key, [f"the artifact is not under the data root {data_root}"]
        ) from None
    group = working.combined if is_combined(key) else working.measures
    previous = group.get(key)
    entry = m.Entry(
        # The name in the receipt the gate checked, which any tables carry
        # too: never the key.
        name=info["document"]["dashboard"]["name"],
        description=dashboard.get("description", ""),
        personal=dashboard.get("personal"),
        status=level,
        artifact=relative.as_posix(),
        outputs_sha256=digests["outputs_sha256"],
        receipt_sha256=digests["receipt_sha256"],
        execution_identity_sha256=digests["execution_identity_sha256"],
        artifact_sha256=artifact_sha256(document),
        years=document["execution_receipt"]["years"],
        unsupported_years=dashboard["unsupported_years"],
        reconciliation=info.get("reconciliation"),
        attestation=info.get("attestation"),
        data_limits=_limit_keys(dashboard),
        reason=(
            _limit_reason(dashboard) if level == m.NOT_COMPUTABLE else None
        ),
    )
    if is_combined(key):
        # The member outputs this combined run was generated against, from
        # its own receipt: never relabelled with the current members.
        entry.measures = list(dashboard["measure_ids"])
        entry.member_outputs_sha256 = dict(dashboard["member_outputs_sha256"])
    group[key] = entry

    carried = None
    if (
        level != m.NOT_COMPUTABLE
        and previous is not None
        and previous.approval is not None
        and previous.outputs_sha256 == entry.outputs_sha256
    ):
        blocking, _ = gate_problems(
            key,
            path,
            working,
            level=m.APPROVED,
            data_root=data_root,
            inputs=inputs,
            entry=entry,
        )
        if not blocking:
            carried = previous.approval.model_copy(
                update={
                    "carried_from_receipt": previous.receipt_sha256,
                    "artifact_sha256": entry.artifact_sha256,
                }
            )
            entry.status = m.APPROVED
            entry.approval = carried
    if (
        previous is not None
        and previous.artifact_sha256 != entry.artifact_sha256
    ):
        working.superseded.append(
            m.Superseded(key=key, superseded_at=m.now(), entry=previous)
        )
    if not is_combined(key):
        # A measure that becomes not computable stales every combined run
        # using it, even with unchanged outputs: their figures included it.
        # Restaging one that already was, unchanged, stales nothing. Every
        # receipt-only artifact has the outputs digest of no files, so only
        # the same artifact counts as unchanged.
        becomes_limited = level == m.NOT_COMPUTABLE and not (
            previous is not None
            and previous.status == m.NOT_COMPUTABLE
            and previous.outputs_sha256 == entry.outputs_sha256
            and previous.data_limits == entry.data_limits
            and previous.artifact_sha256 == entry.artifact_sha256
        )
        _mark_dependants_stale(
            working, key, None if becomes_limited else entry.outputs_sha256
        )

    _commit(manifest, working)
    return key


def approve(
    manifest: m.Manifest,
    key: str,
    by: str,
    *,
    data_root: Path,
    inputs: Path = TREASURY_INPUTS,
    household_receipt: Optional[dict] = None,
) -> None:
    """Approve an entry's current outputs, if every gate passes."""
    entry = manifest.entries().get(key)
    if entry is None:
        raise PublishError(key, ["it is not in the manifest"])
    if entry.status in (m.STALE, m.WITHDRAWN):
        raise PublishError(key, [f"it is {entry.status}: {entry.reason}"])
    if entry.status == m.NOT_COMPUTABLE:
        raise PublishError(
            key,
            [
                "it is not computable on current data, so there is no "
                f"figure to approve: {entry.reason}"
            ],
        )
    if not by.strip():
        raise PublishError(key, ["an approval needs a name"])
    problems, info = gate_problems(
        key,
        artifact_dir(entry, data_root),
        manifest,
        level=m.APPROVED,
        data_root=data_root,
        inputs=inputs,
        household_receipt=household_receipt,
        entry=entry,
    )
    if is_combined(key):
        for member in entry.measures or []:
            current = manifest.measures.get(member)
            if current is None or current.outputs_sha256 != (
                entry.member_outputs_sha256 or {}
            ).get(member):
                problems.append(f"member {member} has changed since staging")
    if problems:
        raise PublishError(key, problems)
    working = manifest.model_copy(deep=True)
    target = working.group(key)[key]
    target.status = m.APPROVED
    target.reason = None
    target.reconciliation = info.get("reconciliation")
    target.household_checks = household_receipt
    target.approval = m.Approval(
        by=by.strip(),
        at=m.now(),
        outputs_sha256=target.outputs_sha256,
        artifact_sha256=target.artifact_sha256,
    )
    _commit(manifest, working)


def withdraw(manifest: m.Manifest, key: str, reason: str) -> None:
    """Take an entry off the page, and stale any combined run using it."""
    if key not in manifest.entries():
        raise PublishError(key, ["it is not in the manifest"])
    if not reason.strip():
        raise PublishError(key, ["a withdrawal needs a reason"])
    working = manifest.model_copy(deep=True)
    entry = working.group(key)[key]
    entry.status = m.WITHDRAWN
    entry.reason = reason.strip()
    entry.approval = None
    if not is_combined(key):
        _mark_dependants_stale(working, key, None)
    _commit(manifest, working)


def check(
    manifest: m.Manifest,
    *,
    data_root: Path,
    inputs: Path = TREASURY_INPUTS,
    check_flat_index: bool = True,
) -> list[str]:
    """Re-run every gate over every entry the page lists.

    Returns one line per failure; an empty list means the manifest may be
    published as it stands.
    """
    from uk_budget_data.publication.release_index import (
        identity_problems,
        manifest_identity_problems,
        release_index_problems,
    )

    # The manifest and the file the page reads both name this Budget
    failures = identity_problems(manifest) + manifest_identity_problems(
        data_root
    )
    if check_flat_index:
        failures += release_index_problems(data_root, manifest)
    for key, entry in sorted(manifest.entries().items()):
        if entry.status not in m.LISTED:
            continue
        problems, _ = gate_problems(
            key,
            artifact_dir(entry, data_root),
            manifest,
            level=entry.status,
            data_root=data_root,
            inputs=inputs,
            household_receipt=entry.household_checks,
            entry=entry,
        )
        if entry.status == m.APPROVED:
            if (
                entry.approval is None
                or entry.approval.outputs_sha256 != entry.outputs_sha256
                or entry.approval.artifact_sha256 != entry.artifact_sha256
            ):
                problems.append("its approval is for a different artifact")
        if (
            manifest.execution is None
            or entry.execution_identity_sha256
            != manifest.execution.execution_identity_sha256
        ):
            problems.append("its execution identity is not the manifest's")
        if is_combined(key):
            for member in entry.measures or []:
                current = manifest.measures.get(member)
                if current is None or current.outputs_sha256 != (
                    entry.member_outputs_sha256 or {}
                ).get(member):
                    problems.append(f"member {member} has changed")
        failures += [f"{key}: {problem}" for problem in problems]
    return failures


def _commit(manifest: m.Manifest, working: m.Manifest) -> None:
    """Copy a fully-built working manifest over the caller's, all at once."""
    for name in type(manifest).model_fields:
        setattr(manifest, name, getattr(working, name))
