"""Each measure's definition as its publication receipt binds it.

Personal impact asks the household API live, so the page has to know the
API computes each selected measure from the definition its published
figures were approved on. A receipt binds a measure's two sides with
policyengine.py's reform identities (``publication.receipt.
measure_identities``, recorded as ``execution_receipt.baseline`` and
``.reform``):

- parameter changes by their content;
- a simulation modifier by its source, its module's source, its default
  arguments and the commit the receipt was made at (``dashboard.git_sha``).

The commit is a label in that digest; the sources are read from the
running code. So recomputing a measure's identities at the approved
receipt's own commit gives the receipt's exactly when the measure's
parameter changes and modifier code are the ones approved, and the API
needs no git history to do it. The household API reports them beside its
answers (``?definition=<id>:<commit>``), and the page compares them with
the approved receipt.

Not covered: the rest of the calculation code (the paths a receipt binds
only through its commit) beyond the bound modifiers' own modules and the
parameter values. That is: code a modifier
calls in another module (the registered templates in ``measure_templates``,
and their module state), the household calculation (``household_impact``,
``personal_impact``, ``publication.combine``), the request's defaults in
``api``, and the locked dependencies beyond the versions the page compares.
A change to any of them since a receipt, or to the image's base layers,
reaches Household impact with the definition unchanged. Listing them needs
git history, which the API image lacks, so ``publish definitions`` lists
them from the checkout it runs in (``run_check``): the paths committed since
each receipt's commit that could change a calculation, by the area run's
rule (``publication.receipt.calculation_changes_since``).

A warning issued from a frame in a bound module leaves a
``__warningregistry__`` in it, and the receipt API then refuses to bind
that module. Household runs execute in worker processes when the API has
more than one (``HOUSEHOLD_WORKERS``, 2 on Cloud Run), so they never touch
the API process's modules; with one, they run in it, and a measure can
become unbindable (reported as an ``error``, so shown unavailable).
"""

import copy
import functools
import json
import re
import subprocess
import urllib.parse
from collections.abc import Callable, Iterable
from pathlib import Path

from uk_budget_data.models import DataConfig
from uk_budget_data.publication.receipt import (
    CodeRevision,
    ReceiptUnavailable,
    measure_identities,
)
from uk_budget_data.reforms import SAVINGS_INCOME_RATES_ID, get_reform

# The fields of an identity its digest depends on, the ones the receipt
# gate compares (``receipt._IDENTITY_FIELDS``); ``name`` is a label.
IDENTITY_FIELDS = ("kind", "representation", "reform_sha256", "binding")
# A full commit sha, as ``scenario_reform_identity`` requires one.
FULL_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
# A request names a measure and its approved commit: "<id>:<commit>".
SEPARATOR = ":"
# A measure a request or receipt names that the running code doesn't
# register: a measure added since this revision, or one it has dropped.
UNREGISTERED = "not a measure the running code registers"
# The measures the page's Household calculator adds to every household
# request that the national results leave out (the page's
# ``calculatorOnlyMeasures.js``, which names no measure anywhere else, so a
# test reads its list from there and keeps the two equal). One the manifest
# doesn't name has no
# receipt to check its definition against, so the page leaves it unchecked;
# once named, it is checked as any published measure (``checked_measures``).
CALCULATOR_ONLY_MEASURES = (SAVINGS_INCOME_RATES_ID,)

# The deploy and rollback pipelines' expectations snippets
# (cloudbuild*.yaml) call ``definitions_for`` and ``FULL_COMMIT`` inside the
# image they check, including older images on a rollback: keep both names
# and ``definitions_for``'s form while revisions that have them can be
# rolled back to.


def identity_core(identity) -> dict:
    """An identity's digest fields, from a ReformIdentity or its JSON."""
    if not isinstance(identity, dict):
        identity = json.loads(identity.model_dump_json())
    return {name: identity.get(name) for name in IDENTITY_FIELDS}


def parse_requested(values: Iterable[str]) -> dict:
    """``<id>:<commit>`` values as ``{id: commit}``.

    Raises ValueError for a value of another form, a commit that is not a
    full sha, or a measure named twice. A measure the running code doesn't
    register is not refused here: ``definitions_for`` reports it as that
    measure's ``error``, so the page can name a measure added after the
    revision answering it (the API still serving the previous revision
    while a new one deploys, or rolled back to an older one) and get the
    others' definitions.
    """
    requested = {}
    for value in values:
        measure_id, separator, git_sha = value.partition(SEPARATOR)
        if not separator or not measure_id:
            raise ValueError(
                f"definition {value!r}: write it as <measure id>:<commit>"
            )
        if not FULL_COMMIT.fullmatch(git_sha):
            raise ValueError(
                f"definition {value!r}: the commit must be a full "
                "lowercase sha (40 or 64 hex digits)"
            )
        if measure_id in requested:
            raise ValueError(f"definition: {measure_id} is named twice")
        requested[measure_id] = git_sha
    return requested


class _Unbound(Exception):
    """A definition the running code cannot bind, raised out of the cache
    so a refusal is never kept: the next request tries again."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@functools.lru_cache(maxsize=256)
def _definition(measure_id: str, git_sha: str) -> dict:
    reform = get_reform(measure_id)
    if reform is None:
        raise ValueError(f"{measure_id} is not a registered measure")
    try:
        # Generation's configuration names no baseline of its own (the
        # CLI's DataConfig sets paths and years only), and neither does the
        # household calculation's (household_impact.measure_sides).
        baseline, own = measure_identities(
            reform, DataConfig(), CodeRevision(git_sha, tree_clean=True)
        )
    except ReceiptUnavailable as error:
        raise _Unbound(error.reason) from error
    return {
        "git_sha": git_sha,
        "baseline": identity_core(baseline),
        "reform": identity_core(own),
    }


def measure_definition(measure_id: str, git_sha: str) -> dict:
    """One measure's definition at ``git_sha``: its baseline and reform
    identities' digest fields, or the reason the running code cannot bind
    them (``error``).

    ``git_sha`` is the commit the approved receipt was made at; the running
    code supplies everything else.
    """
    if not FULL_COMMIT.fullmatch(git_sha):
        raise ValueError(f"{git_sha!r} is not a full commit sha")
    try:
        return copy.deepcopy(_definition(measure_id, git_sha))
    except _Unbound as error:
        return {"git_sha": git_sha, "error": error.reason}


def definitions_for(requested: dict, known: Iterable[str] = None) -> dict:
    """``{id: measure_definition(id, commit)}`` for ``{id: commit}``.

    A measure not in ``known`` (when given: the measures the household
    calculation registers) is reported as ``UNREGISTERED``, and one whose
    definition fails for any other reason with that reason, as
    ``measure_definition`` reports a refusal, so one measure never fails
    the request: the page shows it unavailable and still checks the others.
    """
    known = None if known is None else set(known)
    reported = {}
    for measure_id, git_sha in requested.items():
        if known is not None and measure_id not in known:
            reported[measure_id] = {"git_sha": git_sha, "error": UNREGISTERED}
            continue
        try:
            reported[measure_id] = measure_definition(measure_id, git_sha)
        except Exception as error:
            reported[measure_id] = {
                "git_sha": git_sha,
                "error": f"{type(error).__name__}: {error}",
            }
    return reported


def receipt_definition(document: dict) -> dict:
    """What a receipt document approved: its commit and both identities'
    digest fields, in ``measure_definition``'s form."""
    execution = document.get("execution_receipt") or {}
    return {
        "git_sha": (document.get("dashboard") or {}).get("git_sha"),
        "baseline": identity_core(execution.get("baseline") or {}),
        "reform": identity_core(execution.get("reform") or {}),
    }


def _shown(value, otherwise: str = "none") -> str:
    # A reported value as the page shows it too: only strings are shown.
    return value if isinstance(value, str) else otherwise


def differences(approved: dict, reported) -> list[str]:
    """How a reported definition differs from an approved one (empty when
    it is the same definition). A missing report or an ``error`` is a
    difference.

    The page compares the same way (``src/utils/publication/
    definitions.js``); the contract's ``definition_vectors`` hold the two
    to the same answers.
    """
    if not isinstance(reported, dict):
        return ["no definition reported"]
    if "error" in reported:
        reason = _shown(reported["error"], "no reason given")
        return [f"the running code cannot bind it: {reason}"]
    problems = []
    if reported.get("git_sha") != approved.get("git_sha"):
        problems.append(
            f"reported at commit {_shown(reported.get('git_sha'))}, not "
            f"the approved {_shown(approved.get('git_sha'))}"
        )
    for side in ("baseline", "reform"):
        theirs = reported.get(side)
        if not isinstance(theirs, dict):
            problems.append(f"no {side} identity reported")
            continue
        for name in IDENTITY_FIELDS:
            if theirs.get(name) != approved[side].get(name):
                problems.append(f"its {side} {name} differs")
    return problems


# Cases the page's comparison must answer as ``differences`` does: the
# contract exports them (``definition_vectors``). Identity values are
# strings or null, as receipts and the API give them.
_APPROVED = {
    "git_sha": "1" * 40,
    "baseline": {
        "kind": "current_law",
        "representation": None,
        "reform_sha256": None,
        "binding": "content",
    },
    "reform": {
        "kind": "reform",
        "representation": "policyengine-uk.scenario/v1",
        "reform_sha256": "a" * 64,
        "binding": "code_revision",
    },
}


def _changed(**sides) -> dict:
    reported = copy.deepcopy(_APPROVED)
    for side, fields in sides.items():
        if isinstance(fields, dict):
            reported[side].update(fields)
        else:
            reported[side] = fields
    return reported


DIFFERENCE_CASES = [
    _APPROVED,
    {**_APPROVED, "name": "a label", "extra": 1},
    None,
    [],
    "no",
    {"git_sha": "1" * 40, "error": UNREGISTERED},
    {**_APPROVED, "error": "refused"},
    {"git_sha": "1" * 40, "error": None},
    {"error": {"reason": 1}},
    {**_APPROVED, "git_sha": "2" * 40},
    {key: value for key, value in _APPROVED.items() if key != "git_sha"},
    {**_APPROVED, "git_sha": None},
    _changed(reform={"reform_sha256": "b" * 64}),
    _changed(baseline={"kind": "reform"}),
    _changed(baseline={"representation": "x"}),
    _changed(baseline={"representation": {"x": 1}}),
    _changed(reform={"reform_sha256": 1}),
    _changed(reform={"binding": "content", "representation": None}),
    _changed(baseline=None),
    _changed(reform="not an identity"),
    {key: value for key, value in _APPROVED.items() if key != "reform"},
    _changed(reform={"name": "a label"}),
    {
        **_changed(reform={"reform_sha256": None}),
        "git_sha": "3" * 64,
    },
    {
        **_APPROVED,
        "baseline": {
            key: value
            for key, value in _APPROVED["baseline"].items()
            if value is not None
        },
    },
]

RECEIPT_CASES = [
    {
        "execution_receipt": {
            "baseline": {"kind": "current_law", "binding": "content"},
            "reform": {**_APPROVED["reform"], "name": "alpha"},
        },
        "dashboard": {"git_sha": "1" * 40, "key": "alpha"},
    },
    {"execution_receipt": {}, "dashboard": {}},
    {},
    {"execution_receipt": {"baseline": None}, "dashboard": None},
]


def definition_vectors() -> dict:
    """``differences`` and ``receipt_definition`` on fixed cases, for the
    page's copy of both to reproduce."""
    return {
        "differences": [
            {
                "approved": _APPROVED,
                "reported": case,
                "problems": differences(_APPROVED, case),
            }
            for case in DIFFERENCE_CASES
        ],
        "receipts": [
            {"receipt": case, "definition": receipt_definition(case)}
            for case in RECEIPT_CASES
        ],
    }


class ApiUnanswered(Exception):
    """The household API gave no definitions to compare."""


def api_reporter(
    base_url: str, timeout: float = 300.0, client=None
) -> Callable[[dict], dict]:
    """``definitions_for`` as the household API at ``base_url`` answers it:
    one request naming every measure at its commit, with the deploy smoke's
    household (the definitions don't depend on it), as the page asks.

    The returned function raises ``ApiUnanswered`` when the API answers
    with anything but a 200 carrying ``definitions`` (a revision before
    them answers without).
    """
    from uk_budget_data.deploy_smoke import (
        HOUSEHOLD_IMPACT_ROUTE,
        SMOKE_HOUSEHOLD_IMPACT,
        StdlibClient,
    )

    client = client or StdlibClient(base_url, timeout)

    def report(requested: dict) -> dict:
        query = urllib.parse.urlencode(
            [
                ("definition", f"{measure_id}{SEPARATOR}{git_sha}")
                for measure_id, git_sha in sorted(requested.items())
            ]
        )
        try:
            response = client.request(
                "POST",
                f"{HOUSEHOLD_IMPACT_ROUTE}?{query}",
                json=SMOKE_HOUSEHOLD_IMPACT,
            )
        except Exception as error:  # noqa: BLE001 - reported, not raised
            raise ApiUnanswered(
                f"no answer: {type(error).__name__}: {error}"
            ) from error
        if response.status_code != 200:
            raise ApiUnanswered(f"HTTP {response.status_code}")
        try:
            served = response.json().get("definitions")
        except (ValueError, AttributeError):
            served = None
        if not isinstance(served, dict):
            raise ApiUnanswered(
                "no definitions in its answer (a revision without them)"
            )
        return served

    return report


def manifest_report(
    data_root: Path, report: Callable[[dict], dict] = None
) -> list[dict]:
    """For each single measure the page displays (approved or
    provisional), whether the definition at its receipt's commit is the one
    approved: computed by the running code, or as ``report`` gives it
    (``api_reporter``: a deployed revision's).

    Each row is ``{key, status, git_sha, problems}``, in key order.
    Combined runs are left out: the household calculation combines the
    selected single measures, each bound by its own receipt.
    """
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.publish import artifact_dir

    manifest = m.load_manifest(data_root)
    rows, compared = [], {}
    for key, entry in sorted(manifest.measures.items()):
        if entry.status not in m.DISPLAYABLE:
            continue
        row = {"key": key, "status": entry.status, "git_sha": None}
        try:
            document = read_receipt(artifact_dir(entry, data_root))
        except (OSError, ValueError) as error:
            rows.append({**row, "problems": [f"no receipt: {error}"]})
            continue
        approved = receipt_definition(document)
        row["git_sha"] = approved["git_sha"]
        if report is None and get_reform(key) is None:
            rows.append({**row, "problems": [UNREGISTERED]})
        elif not isinstance(approved["git_sha"], str) or not (
            FULL_COMMIT.fullmatch(approved["git_sha"])
        ):
            rows.append(
                {**row, "problems": ["its receipt records no full commit sha"]}
            )
        else:
            compared[key] = (row, approved)
    if compared:
        reported = (report or definitions_for)(
            {
                key: approved["git_sha"]
                for key, (_, approved) in compared.items()
            }
        )
        for key, (row, approved) in compared.items():
            rows.append(
                {**row, "problems": differences(approved, reported.get(key))}
            )
    return sorted(rows, key=lambda row: row["key"])


def checked_measures(data_root: Path, ids: Iterable[str]) -> list[str]:
    """The measures of a household request (``ids``, in order) whose
    definitions the page checks: every one but a calculator-only measure
    the publication's manifest does not name, or names as withdrawn (the
    page's ``publishedRequest`` and ``definitionChecked``). Each of these
    needs an approved definition, or the page answers nothing.
    """
    from uk_budget_data.publication import manifest as m

    manifest = m.load_manifest(data_root)

    def named(key):
        entry = manifest.measures.get(key)
        return entry is not None and entry.status != m.WITHDRAWN

    return [
        key for key in ids if key not in CALCULATOR_ONLY_MEASURES or named(key)
    ]


def approved_definitions(data_root: Path, ids: Iterable[str]) -> dict:
    """``{id: receipt_definition(receipt)}`` for each of ``ids`` the page
    displays (approved or provisional): what the page checks the household
    API's answers for it against (``publishedDefinitions``).

    One with no displayable entry, no readable receipt or no full commit
    (the only kind the API takes) is left out: the page has nothing to
    check it against, and answers nothing for it.
    """
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.publish import artifact_dir

    manifest = m.load_manifest(data_root)
    approved = {}
    for key in ids:
        entry = manifest.measures.get(key)
        if entry is None or entry.status not in m.DISPLAYABLE:
            continue
        try:
            document = read_receipt(artifact_dir(entry, data_root))
        except (OSError, ValueError):
            continue
        definition = receipt_definition(document)
        git_sha = definition["git_sha"]
        if isinstance(git_sha, str) and FULL_COMMIT.fullmatch(git_sha):
            approved[key] = definition
    return approved


def _changes_in_checkout(
    git_sha: str, repo_root: Path = Path(".")
) -> list[str]:
    from uk_budget_data.publication.receipt import calculation_changes_since

    # One this checkout lacks would otherwise read as a side branch
    if (
        FULL_COMMIT.fullmatch(git_sha)
        and subprocess.run(
            ["git", "cat-file", "-e", f"{git_sha}^{{commit}}"],
            cwd=repo_root,
            capture_output=True,
        ).returncode
    ):
        raise ValueError(
            f"this checkout has no commit {git_sha[:12]}: fetch it "
            "(git fetch origin), or unshallow a shallow clone"
        )
    return calculation_changes_since(git_sha, repo_root)


def changes_lines(rows: list[dict], changes_since) -> list[str]:
    """For each receipt commit the rows name, the paths committed since it
    that could change a calculation, as ``changes_since`` lists them.

    A definition binds only a measure's parameter changes and its
    modifier's own module, so these reach Household impact with every
    definition the same (runbook G5, step 1). Each commit is listed once,
    with the measures whose receipts were made at it.
    """
    by_commit = {}
    for row in rows:
        git_sha = row["git_sha"]
        if isinstance(git_sha, str) and FULL_COMMIT.fullmatch(git_sha):
            by_commit.setdefault(git_sha, []).append(row["key"])
    if not by_commit:
        return []
    lines = [
        "Calculation paths committed since each receipt's commit (no "
        "definition shows them; runbook G5, step 1):"
    ]
    for git_sha, keys in sorted(by_commit.items(), key=lambda item: item[1]):
        heading = f"  since {git_sha[:12]} ({', '.join(keys)})"
        try:
            paths = changes_since(git_sha)
        except (OSError, ValueError) as error:
            lines.append(f"{heading}: cannot list them: {error}")
            continue
        if not paths:
            lines.append(f"{heading}: none")
            continue
        lines.append(f"{heading}:")
        lines.extend(f"    {path}" for path in paths)
    return lines


def run_check(
    data_root: Path,
    out=print,
    report: Callable[[dict], dict] = None,
    where: str = "this code",
    changes_since: Callable[[str], list[str]] = _changes_in_checkout,
) -> int:
    """``publish definitions``: print the report, then the calculation
    paths committed since each receipt's commit (``changes_lines``; by
    default from the checkout in the working directory); 1 if any
    displayed measure's definition is not the approved one, or ``report``
    (the household API, ``where``) gave none, else 0. The paths are listed,
    not counted: whoever deploys judges them (G5)."""
    from uk_budget_data.publication import manifest as m

    if not m.manifest_path(data_root).exists():
        out("no manifest yet: no published measure to compare")
        return 0
    try:
        rows = manifest_report(data_root, report)
    except ApiUnanswered as error:
        out(f"REFUSED {where} gave no definitions to compare: {error}")
        return 1
    for row in rows:
        commit = (row["git_sha"] or "?")[:12]
        if row["problems"]:
            out(f"DIFFERS {row['key']} ({row['status']}, receipt {commit}):")
            for problem in row["problems"]:
                out(f"  - {problem}")
        else:
            out(f"same    {row['key']} ({row['status']}, receipt {commit})")
    for line in changes_lines(rows, changes_since):
        out(line)
    unbound = sum(1 for row in rows if row["problems"])
    out(
        f"{len(rows) - unbound} of {len(rows)} displayed measures have the "
        f"approved definition in {where}"
    )
    return 1 if unbound else 0
