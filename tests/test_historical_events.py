"""Past fiscal events imported from policyengine-scorecard replays.

Invariants (uk_budget_data.historical_events, docs/historical-releases.md):

- Import faithfulness: a measure's changes are exactly the constructed
  world's value in each parameter and replay year where it differs from
  current law's, and nothing else; a reversal's constructed world is its
  baseline and a forward delta's its reform, the other side being the
  dashboard's current law (never this Budget's configured baseline).
- Built values: the dashboard's engine reads each changed parameter, at
  1 January of each changed year, as the value the replay intended
  (relative tolerance 1e-9), on every imported measure.
- Partition: the coverage table's class rows partition the event's
  measures and OBR cells, so their exact shares sum to one; the gap-kind
  rows sum to the not-expressible row; and every measure in the event is
  either imported or listed as not modelled, once.
- A past event's generation reads only its own registry, over its years.
- Regeneration: importing the same export again gives the same bytes.
"""

import csv
import io
import math
import os
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

import pytest
from hypothesis import given
from hypothesis import strategies as st

from uk_budget_data import historical_events as h
from uk_budget_data import releases
from uk_budget_data.budget_years import POLICY_YEARS
from uk_budget_data.parameter_companions import COMPANIONS as _COMPANION_PAIRS

HISTORICAL = [r for r in releases.RELEASES.values() if r.historical]
EVENTS = {r.id: h.load_event(r.id) for r in HISTORICAL}
IMPORTED = {rid: doc for rid, doc in EVENTS.items() if doc is not None}
RECORDS = [
    (rid, record)
    for rid, doc in sorted(IMPORTED.items())
    for record in doc["measures"]
]
# A scorecard checkout's exports, to check the registries regenerate
EXPORTS = os.environ.get("SCORECARD_DASHBOARD_EXPORT")


def _this_budgets_measure() -> str:
    """One of this Budget's own measures that no past event's registry
    lists, read from the live registry so it follows the measures."""
    from uk_budget_data.reforms import list_reform_ids

    imported = {m["id"] for doc in IMPORTED.values() for m in doc["measures"]}
    return next(
        reform_id
        for reform_id in list_reform_ids()
        if reform_id not in imported and not reform_id.endswith("_combined")
    )


THIS_BUDGETS_MEASURE = _this_budgets_measure()


def test_every_past_event_is_imported_and_scores_only_policy_years():
    assert set(IMPORTED) == {r.id for r in HISTORICAL}
    for rid, document in IMPORTED.items():
        assert document["years"]
        assert set(document["years"]) <= set(POLICY_YEARS)
        assert set(document["years"]) <= set(document["replay_years"])
        assert document["years"] == h.scored_years(document["replay_years"])


# --- the import rule, on synthetic replays ----------------------------

value = st.one_of(
    st.booleans(),
    st.integers(-5, 5),
    st.sampled_from([0.1, 0.2, 0.45, 12570.0, "inf"]),
)
paths = st.lists(
    st.sampled_from(
        ["gov.a.rate", "gov.b.threshold", "gov.c.flag", "gov.d.cap"]
    ),
    min_size=1,
    max_size=3,
    unique=True,
)


@st.composite
def replayed_measure(draw):
    kind = draw(st.sampled_from([h.REVERSAL, h.FORWARD]))
    chosen = draw(paths)
    first = draw(st.integers(2023, 2026))
    years = list(range(first, first + draw(st.integers(1, 6))))
    worlds = {}
    for year in years:
        worlds[year] = {path: (draw(value), draw(value)) for path in chosen}
    constructed = h.CONSTRUCTED_WORLD[kind]
    current = h.CURRENT_LAW_WORLD[kind]
    measure = {
        "measure_key": "event__measure",
        "construction": {"kind": kind},
        "years": [
            {
                "year": year,
                "processed_parameter_values": {
                    constructed: {
                        path: {"intended": mine, "processed": mine}
                        for path, (mine, _) in worlds[year].items()
                    },
                    current: {
                        path: {"intended": theirs, "processed": theirs}
                        for path, (_, theirs) in worlds[year].items()
                    },
                },
            }
            for year in years
        ],
    }
    return measure, worlds


def _same(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    return h.decode(left) == h.decode(right)


@given(replayed_measure())
def test_the_changes_are_the_constructed_world_where_it_differs(drawn):
    measure, worlds = drawn
    expected = {}
    for year, values in worlds.items():
        for path, (mine, theirs) in values.items():
            if not _same(mine, theirs):
                expected.setdefault(path, {})[str(year)] = mine
    assert h._constructed_changes(measure) == expected


@given(st.sampled_from([h.REVERSAL, h.FORWARD]))
def test_the_constructed_world_goes_on_its_own_side(kind):
    record = {
        "id": "event__measure",
        "name": "A measure",
        "construction": kind,
        "executor_route": None,
        "missing_legs": [],
        "changes": {"gov.hmrc.income_tax.rates.uk[0].rate": {"2027": 0.21}},
    }
    reform = h.reform_for(record)
    built = {"gov.hmrc.income_tax.rates.uk[0].rate": {"2027": 0.21}}
    if kind == h.REVERSAL:
        assert reform.baseline_parameter_changes == built
        assert reform.parameter_changes == {}
    else:
        assert reform.parameter_changes == built
        assert reform.baseline_parameter_changes == {}
    # Both sides are explicit, so the configured baseline is never used
    assert reform.has_custom_baseline()
    assert reform.baseline_scenario_for(SimpleNamespace()) is not None


@given(
    st.lists(
        st.decimals(
            min_value=-(10**12),
            max_value=10**12,
            places=6,
            allow_nan=False,
            allow_infinity=False,
        ),
        max_size=20,
    )
)
def test_pound_sums_are_exact(values):
    total = h._gbp_sum(str(v) for v in values)
    assert Fraction(total) == sum((Fraction(str(v)) for v in values), 0)


@given(st.one_of(st.booleans(), st.integers(), st.sampled_from(["inf"])))
def test_values_round_trip_through_the_registry(raw):
    assert _same(h.encode(h.decode(raw)), raw)


def test_a_bad_value_is_refused():
    for bad in ("nan", None, float("nan"), "12"):
        with pytest.raises(h.EventImportError):
            h.decode(bad)


# --- the registries ----------------------------------------------------


@pytest.mark.parametrize("release_id", sorted(IMPORTED), ids=sorted(IMPORTED))
def test_coverage_partitions_the_event(release_id):
    document = IMPORTED[release_id]
    rows = [dict(zip(h.COVERAGE_HEADER, row)) for row in document["coverage"]]
    classes = [
        r for r in rows if r["class"] in h.CLASSES and not r["gap_kind"]
    ]
    assert sorted(r["class"] for r in classes) == sorted(h.CLASSES)
    assert all(r["gap_kind"] == "" for r in classes)
    total = sum(int(r["measures"]) for r in classes)
    assert sum(Fraction(r["share_of_absolute"]) for r in classes) in (0, 1)
    assert sum(Fraction(r["share_of_measures"]) for r in classes) == 1
    for r in classes:
        assert Fraction(r["share_of_measures"]) == Fraction(
            int(r["measures"]), total
        )
    gaps = [
        r for r in rows if r["class"] == "not_expressible" and r["gap_kind"]
    ]
    whole = next(r for r in classes if r["class"] == "not_expressible")
    for field in ("measures", "rows"):
        assert sum(int(r[field]) for r in gaps) == int(whole[field])
    for field in ("net_gbp", "absolute_gbp"):
        assert sum(Fraction(r[field]) for r in gaps) == Fraction(whole[field])
    # Every measure is imported or listed as not modelled, once
    ids = [m["id"] for m in document["measures"]] + [
        m["reform_id"] for m in document["not_modelled"]
    ]
    assert len(ids) == len(set(ids)) == total
    computed = next(r for r in rows if r["class"] == h.COMPUTED_ROW)
    imported_or_refused = len(document["measures"]) + sum(
        1
        for m in document["not_modelled"]
        if m["gap_kind"] == h.DASHBOARD_IMPORT_GAP
    )
    assert imported_or_refused == int(computed["measures"])


@pytest.mark.parametrize("release_id", sorted(IMPORTED), ids=sorted(IMPORTED))
def test_the_flat_files_have_the_checked_headers(release_id):
    from uk_budget_data.publication.release_index import (
        HISTORICAL_FLAT_VIEW_FILES,
        HISTORICAL_OBR_COMPARISON_HEADER,
        METADATA_HEADERS,
    )

    files = h.flat_files(IMPORTED[release_id])
    assert tuple(sorted(files)) == HISTORICAL_FLAT_VIEW_FILES
    headers = {**METADATA_HEADERS}
    headers["obr_comparison.csv"] = HISTORICAL_OBR_COMPARISON_HEADER
    for name, text in files.items():
        assert tuple(text.splitlines()[0].split(",")) == headers[name]
    years = {str(y) for y in IMPORTED[release_id]["years"]}
    rows = list(csv.DictReader(io.StringIO(files["obr_comparison.csv"])))
    assert {row["year"] for row in rows} <= years
    imported = {m["id"] for m in IMPORTED[release_id]["measures"]}
    assert {row["reform_id"] for row in rows} <= imported


@pytest.mark.parametrize(
    "release_id,record",
    RECORDS,
    ids=[record["id"] for _, record in RECORDS],
)
def test_each_record_is_its_replays_construction(release_id, record):
    """The stored changes are the import rule applied to the stored
    replay values, and only years the replay ran."""
    constructed = h.CONSTRUCTED_WORLD[record["construction"]]
    current = h.CURRENT_LAW_WORLD[record["construction"]]
    expected = {}
    for year, replay in record["replay"].items():
        for path, mine in replay["intended"].get(constructed, {}).items():
            theirs = replay["intended"].get(current, {}).get(path)
            if theirs is None or not _same(mine, theirs):
                expected.setdefault(path, {})[year] = mine
    assert record["changes"] == expected


# --- built values: the dashboard's engine reads what the replay intended


def _situation():
    return {
        "people": {"person": {"age": {2027: 40}}},
        "benunits": {"benunit": {"members": ["person"]}},
        "households": {"household": {"members": ["person"]}},
    }


def _read(parameters, path, year):
    return parameters.get_child(path)(f"{year}-01-01")


def _matches(read, intended) -> bool:
    intended = h.decode(intended)
    if isinstance(intended, bool):
        return bool(read) is intended
    if math.isinf(intended):
        return math.isinf(read) and (read > 0) == (intended > 0)
    return math.isclose(float(read), intended, rel_tol=1e-9, abs_tol=1e-12)


@pytest.mark.parametrize(
    "release_id,record",
    RECORDS,
    ids=[record["id"] for _, record in RECORDS],
)
def test_the_engine_builds_the_replays_constructed_values(release_id, record):
    from policyengine_uk import Simulation
    from policyengine_uk.utils.scenario import Scenario

    reform = h.reform_for(record)
    side = (
        reform.baseline_parameter_changes
        if record["construction"] == h.REVERSAL
        else reform.parameter_changes
    )
    built = Simulation(
        situation=_situation(), scenario=Scenario(parameter_changes=side)
    ).tax_benefit_system.parameters
    # A companion the engine charges in step is read back too, at the values
    # of the parameter it follows (historical_events._with_companions)
    expected = dict(record["changes"])
    for path, companion, _ in _COMPANION_PAIRS:
        if path in record["changes"] and companion in side:
            expected.setdefault(companion, record["changes"][path])
    wrong = []
    for path, values in expected.items():
        for year, intended in values.items():
            read = _read(built, path, year)
            if not _matches(read, intended):
                wrong.append(
                    f"{path} {year}: read {read!r}, intended {intended!r}"
                )
    assert wrong == []


def test_no_imported_measure_changes_a_parameter_without_its_companion():
    """Generation's own check (publication.generate._refuse_companion_gaps)
    refuses none of the imported measures."""
    from uk_budget_data.parameter_companions import companion_gaps

    gaps = {}
    for _, record in RECORDS:
        reform = h.reform_for(record)
        found = companion_gaps(
            SimpleNamespace(
                parameter_changes=reform.baseline_parameter_changes
            ),
            SimpleNamespace(parameter_changes=reform.parameter_changes),
        )
        if found:
            gaps[record["id"]] = [gap.reason for gap in found]
    assert gaps == {}


def test_the_lha_reset_is_undone_in_northern_ireland_too():
    """The record changes gov.dwp.LHA.freeze alone; Northern Ireland's
    freeze takes the same values, and nothing else is added."""
    (record,) = [
        record
        for _, record in RECORDS
        if record["id"]
        == "autumn_statement_2023__lha_reset_to_30th_percentile"
    ]
    assert set(record["changes"]) == {"gov.dwp.LHA.freeze"}
    reform = h.reform_for(record)
    side = reform.baseline_parameter_changes
    assert set(side) == {"gov.dwp.LHA.freeze", "gov.dfc.LHA.freeze"}
    assert side["gov.dfc.LHA.freeze"] == side["gov.dwp.LHA.freeze"]
    assert reform.parameter_changes == {}


def test_a_companion_the_engine_lacks_is_left_out(monkeypatch):
    """As generation's check leaves it (an engine before gov.dfc.LHA)."""
    from uk_budget_data import parameter_companions

    def lacks_dfc(path):
        return not path.startswith("gov.dfc.")

    monkeypatch.setattr(parameter_companions, "installed", lacks_dfc)
    (record,) = [
        record
        for _, record in RECORDS
        if record["id"]
        == "autumn_statement_2023__lha_reset_to_30th_percentile"
    ]
    side = h.reform_for(record).baseline_parameter_changes
    assert set(side) == {"gov.dwp.LHA.freeze"}


def test_a_companion_the_record_sets_keeps_its_own_values():
    record = {
        "id": "synthetic__cgt",
        "name": "Synthetic CGT rates",
        "construction": h.REVERSAL,
        "executor_route": None,
        "missing_legs": [],
        "changes": {
            "gov.hmrc.cgt.higher_rate": {"2025": 0.2},
            "gov.hmrc.cgt.additional_rate": {"2025": 0.21},
        },
    }
    side = h.reform_for(record).baseline_parameter_changes
    assert side == {
        "gov.hmrc.cgt.higher_rate": {"2025": 0.2},
        "gov.hmrc.cgt.additional_rate": {"2025": 0.21},
    }


@given(
    st.dictionaries(
        st.sampled_from([pair[0] for pair in _COMPANION_PAIRS]),
        st.dictionaries(
            st.integers(2024, 2030).map(str),
            st.floats(0, 1, allow_nan=False),
            min_size=1,
            max_size=3,
        ),
        min_size=1,
    ),
    st.sampled_from([h.REVERSAL, h.FORWARD]),
)
def test_every_pair_a_record_changes_is_changed_in_step(changes, construction):
    record = {
        "id": "synthetic__pairs",
        "name": "Synthetic pairs",
        "construction": construction,
        "executor_route": None,
        "missing_legs": [],
        "changes": changes,
    }
    reform = h.reform_for(record)
    side = (
        reform.baseline_parameter_changes
        if construction == h.REVERSAL
        else reform.parameter_changes
    )
    for path, companion, _ in _COMPANION_PAIRS:
        if path in changes:
            assert side[companion] == side[path] == changes[path]
    # Nothing but the record's parameters and their companions
    assert set(side) == set(changes) | {
        companion for path, companion, _ in _COMPANION_PAIRS if path in changes
    }


# --- generation reads only the release's registry ---------------------


def cli_years():
    from uk_budget_data.cli import DefaultYears

    return DefaultYears(POLICY_YEARS)


def _parsed(**overrides):
    parsed = SimpleNamespace(
        list_reforms=False,
        artifacts=True,
        combined=None,
        artifacts_root=Path("public/data/artifacts"),
        reforms=None,
        years=cli_years(),
        only=None,
        legacy_geography=False,
        data_dir=Path("data"),
        data_inputs_dir=Path("data_inputs"),
        dataset=None,
        skip_input_check=False,
        output_dir=Path("public/data"),
        jobs="1",
        backend="local",
        unit_memory_gb=None,
    )
    for key, value in overrides.items():
        setattr(parsed, key, value)
    return parsed


@pytest.fixture
def captured(monkeypatch):
    from uk_budget_data import cli

    calls = []

    def fake(parsed, config, reforms, lookup, out=print, runner=None):
        calls.append(
            SimpleNamespace(
                config=config, reforms=reforms, lookup=lookup, runner=runner
            )
        )
        return 0

    monkeypatch.setattr(cli, "run_generate_artifacts", fake)
    return calls


def _event_root(release):
    return Path("public/data") / release.data_root / "artifacts"


def test_a_past_events_artifacts_root_generates_its_own_measures(captured):
    from uk_budget_data import cli

    release = HISTORICAL[0]
    assert cli.run_generate(_parsed(artifacts_root=_event_root(release))) == 0
    (call,) = captured
    document = IMPORTED[release.id]
    assert [r.id for r in call.reforms] == [
        m["id"] for m in document["measures"]
    ]
    assert call.config.years == document["years"]
    other = IMPORTED[HISTORICAL[1].id]["measures"][0]["id"]
    assert call.lookup(other) is None
    assert call.lookup(THIS_BUDGETS_MEASURE) is None
    # No runner: generate_artifacts runs them here, one after another
    assert call.runner is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"reforms": [THIS_BUDGETS_MEASURE]},
        {"years": [2031]},
        {"only": "age_impact"},
        # A worker would look an unpicklable measure up in this Budget's
        # registry, so a past event's measures never leave this process
        {"jobs": "2"},
        {"jobs": "auto"},
        {"backend": "modal"},
    ],
)
def test_a_past_event_refuses_what_is_not_its_own(captured, overrides):
    from uk_budget_data import cli

    release = HISTORICAL[0]
    parsed = _parsed(artifacts_root=_event_root(release), **overrides)
    assert cli.run_generate(parsed) == 1
    assert captured == []


def test_an_unregistered_release_root_is_refused(captured):
    from uk_budget_data import cli

    parsed = _parsed(
        artifacts_root=Path("public/data/releases/uk-nope/artifacts")
    )
    assert cli.run_generate(parsed) == 1
    assert captured == []


def test_this_budgets_generation_keeps_its_registry_and_years(captured):
    from uk_budget_data import cli
    from uk_budget_data.parallel import SerialRunner
    from uk_budget_data.reforms import get_reform

    parsed = _parsed(reforms=[THIS_BUDGETS_MEASURE])
    assert cli.run_generate(parsed) == 0
    (call,) = captured
    assert call.lookup is get_reform
    assert call.config.years == list(POLICY_YEARS)
    # --jobs 1, the default, runs this Budget's measures one after another
    assert isinstance(call.runner, SerialRunner)


# --- regeneration -------------------------------------------------------


@pytest.mark.skipif(
    not EXPORTS, reason="set SCORECARD_DASHBOARD_EXPORT to a scorecard export"
)
def test_the_registries_regenerate_from_the_exports(tmp_path):
    visited = []
    for export in sorted(Path(EXPORTS).glob("*_20*.json")):
        registry, _ = h.import_file(export, tmp_path)
        committed = h.event_path(releases.get_release(registry.stem))
        assert registry.read_bytes() == Path(str(committed)).read_bytes()
        visited.append(registry.stem)
    # Every registered past event, once: an empty or wrong directory fails
    assert sorted(visited) == sorted(release.id for release in HISTORICAL)
