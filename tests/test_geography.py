"""Tests for results by area through the disclosure layer (#24).

Every array here is synthetic. Seat codes are made up (Z14...), so no table
written here looks like a real seat table; region codes are the real ONS
ones, read from the canonical region table.
"""

import json
import stat
from pathlib import Path
from types import SimpleNamespace

import h5py
import numpy as np
import pandas as pd
import pytest
from policyengine.disclosure import (
    DisclosureSettings,
    Finding,
    validate_public,
)
from policyengine.disclosure.schema import PUBLIC_COLUMNS, WITHHELD

from tests import geography_fixture
from uk_budget_data import geography as g
from uk_budget_data.private_outputs import AUDIT_DIR_ENV, PrivateOutputError

REPO = Path(__file__).resolve().parents[1]
REGIONS_CSV = REPO / "data_inputs" / "regions.csv"
SEATS_CSV = REPO / "data_inputs" / "constituencies_2024.csv"
FAST = DisclosureSettings(n_replicates=200)
BASE = 30_000.0
R1, R2, R3 = "E12000001", "E12000002", "E12000003"
S1, S2, S3, S4 = "Z14000001", "Z14000002", "Z14000003", "Z14000004"
SEAT_REGIONS = {S1: R1, S2: R1, S3: R2, S4: R2}
PKG = "pkg_combined"


@pytest.fixture(scope="module")
def regions():
    return g.load_regions(REGIONS_CSV)


def block_matrix(blocks, n):
    """One seat row per (start, stop) block of records, at weight 100."""
    matrix = np.zeros((len(blocks), n))
    for row, (start, stop) in enumerate(blocks):
        matrix[row, start:stop] = 100.0
    return matrix


def make_collector(
    regions_per_record,
    changes,
    *,
    matrix=None,
    seat_regions=SEAT_REGIONS,
    labels=None,
    national=True,
    years=(2026,),
    weight=None,
):
    """A collector over synthetic records, one source household each."""
    n = len(regions_per_record)
    kwargs = {}
    if matrix is not None:
        kwargs["seat_matrix"] = g.SeatMatrix(
            codes=tuple(seat_regions),
            parent_of=seat_regions,
            load=lambda year: matrix,
        )
    if labels is not None:
        kwargs.update(seat_labels=labels, seat_regions=seat_regions)
    collector = g.GeographyCollector(
        source_ids=np.arange(n),
        region_codes=np.asarray(regions_per_record, dtype=object),
        national=national,
        **kwargs,
    )
    weight = np.full(n, 100.0) if weight is None else weight
    baseline = np.full(n, BASE)
    for year in years:
        for reform, change in changes.items():
            collector.add(
                reform,
                year,
                baseline=baseline,
                reformed=baseline + change,
                weight=weight,
            )
    return collector


def two_regions(n=300):
    return np.array([R1] * (n // 2) + [R2] * (n // 2), dtype=object)


def change_on(n, records, amount=50.0):
    change = np.zeros(n)
    change[list(records)] = amount
    return change


def published_frame(geo):
    frame = geo.release.to_public().to_frame()
    return frame[frame["outcome"] == "average_change"]


def tier_of(geo, level, area, reform, year=2026):
    frame = published_frame(geo)
    row = frame[
        (frame["level"] == level)
        & (frame["area_code"] == area)
        & (frame["reform"] == reform)
        & (frame["year"] == year)
    ]
    assert len(row) == 1
    return row["tier"].iloc[0]


def cell(level, area, reform, year=2026):
    return (level, area, reform, year, "change")


def prior_frame(rows, noise="False"):
    return pd.DataFrame(
        [
            {
                "level": level,
                "area_code": area,
                "reform": reform,
                "year": str(year),
                "outcome": "average_change",
                "tier": "reported",
                "noise": noise,
            }
            for level, area, reform, year in rows
        ]
    )


# -- regions and seats -------------------------------------------------------


def test_the_region_table_is_complete(regions):
    assert sorted(regions["code"]) == sorted(g.REGION_CODES)


def test_an_incomplete_region_table_is_refused(tmp_path):
    frame = pd.read_csv(REGIONS_CSV, dtype=str, keep_default_na=False)
    path = tmp_path / "regions.csv"
    frame.iloc[:-1].to_csv(path, index=False)
    with pytest.raises(ValueError, match="twelve"):
        g.load_regions(path)


def test_frs_regions_from_text_bytes_and_enum_members(regions):
    from policyengine_uk.system import system

    enum = system.variables["region"].possible_values
    codes = g.frs_region_codes(
        ["NORTH_EAST", b"WALES", enum.SCOTLAND, "UNKNOWN", None], regions
    )
    assert list(codes) == ["E12000001", "W92000004", "S92000003", "", ""]


def test_an_unknown_frs_region_is_refused(regions):
    with pytest.raises(ValueError, match="Unknown FRS region"):
        g.frs_region_codes(["NORTH_EAST", "ATLANTIS"], regions)


def test_microcosm_codes_its_nations_with_nines(regions):
    codes = g.microcosm_region_codes(
        ["W99999999", "S99999999", "N99999999", "E12000007", ""], regions
    )
    assert list(codes) == [
        "W92000004",
        "S92000003",
        "N92000002",
        "E12000007",
        "",
    ]
    with pytest.raises(ValueError, match="Microcosm region"):
        g.microcosm_region_codes(["W92000004"], regions)


def test_constituency_lookup_labels(regions):
    codes = g.lookup_region_codes(
        ["Eastern", "Yorkshire and the Humber", "Wales"], regions
    )
    assert list(codes) == ["E12000006", "E12000003", "W92000004"]
    with pytest.raises(ValueError):
        g.lookup_region_codes([""], regions)


def test_every_seat_has_a_region(regions):
    mapping = g.seat_region_map(SEATS_CSV, regions)
    seats = pd.read_csv(SEATS_CSV, dtype=str)
    assert list(mapping) == list(seats["code"])
    assert set(mapping.values()) == set(g.REGION_CODES)


# -- survey households -------------------------------------------------------


def efrs_tables(copy_age=40, flag="household_is_capital_gains_clone"):
    """Three households; the second is a flagged copy of the first."""
    household = pd.DataFrame(
        {
            "household_id": [1, 2, 3],
            # The eFRS's own source id links nothing, so it must be ignored.
            "source_household_id": [1, 2, 3],
            "household_weight": [100.0, 50.0, 80.0],
            "region": ["LONDON", "LONDON", "LONDON"],
            "tenure_type": ["RENT_PRIVATELY"] * 3,
            "accommodation_type": ["FLAT"] * 3,
            flag: [False, True, False],
        }
    )
    person = pd.DataFrame(
        {
            "person_household_id": [1, 1, 2, 2, 3],
            "age": [40, 8, copy_age, 8, 40],
            "gender": ["FEMALE", "MALE", "FEMALE", "MALE", "MALE"],
        }
    )
    return household, person


def test_the_efrs_key_links_a_copy_to_its_original():
    household, person = efrs_tables()
    ids = g.survey_household_ids(household, person, "efrs")
    assert ids[0] == ids[1] != ids[2]
    assert ids.dtype == np.int64


def test_the_efrs_key_refuses_a_copy_with_no_original():
    household, person = efrs_tables(copy_age=41)
    with pytest.raises(ValueError, match="share their key"):
        g.survey_household_ids(household, person, "efrs")


def test_member_order_does_not_change_the_key():
    household, person = efrs_tables()
    shuffled = person.iloc[[3, 0, 4, 2, 1]].reset_index(drop=True)
    assert (
        g.survey_household_ids(household, shuffled, "efrs")
        == g.survey_household_ids(household, person, "efrs")
    ).all()


def microcosm_household(source_ids, **flags):
    return pd.DataFrame(
        {"household_id": [10, 11, 12], "source_household_id": source_ids}
        | flags
    )


def test_microcosm_ids_that_link_copies_are_used():
    household = microcosm_household(
        [7, 7, 9], household_is_spi_synthetic=[False, True, False]
    )
    ids = g.survey_household_ids(household, None, "microcosm")
    assert list(ids) == [7, 7, 9]


@pytest.mark.parametrize(
    "flag",
    [
        "household_is_spi_synthetic",
        "household_is_capital_gains_clone",
        "household_is_cgt_band_donor",
        "household_is_cgt_support_copy",
        "household_is_cgt_residential_clone",
    ],
)
def test_microcosm_ids_unique_per_row_with_copies_are_refused(flag):
    household = microcosm_household([7, 8, 9], **{flag: [0, 1, 0]})
    with pytest.raises(ValueError, match="does not link copies"):
        g.survey_household_ids(household, None, "microcosm")


def test_microcosm_ids_unique_per_row_without_copies_are_used():
    household = microcosm_household(
        [7, 8, 9], household_is_capital_gains_clone=[False] * 3
    )
    assert list(g.survey_household_ids(household, None, "microcosm")) == [
        7,
        8,
        9,
    ]


def test_another_dataset_kind_is_refused():
    with pytest.raises(ValueError, match="Unknown dataset kind"):
        g.survey_household_ids(pd.DataFrame(), pd.DataFrame(), "frs")


# -- simulations -------------------------------------------------------------


class FakeDataset:
    def __init__(self, year, household, person):
        self.years = [year, year + 1]
        self._tables = SimpleNamespace(household=household, person=person)

    def __getitem__(self, year):
        assert year == self.years[0]
        return self._tables


class FakeSimulation:
    """The parts of a Microsimulation the geography code reads."""

    def __init__(self, household, person, net_income=None, year=2023):
        self.dataset = FakeDataset(year, household, person)
        ids = household["household_id"].to_numpy()
        self.populations = {"household": SimpleNamespace(ids=np.unique(ids))}
        self.weight = household["household_weight"].to_numpy(np.float32)
        self.net_income = net_income or {}

    def calculate(self, variable, period=None, map_to=None, unweighted=False):
        assert map_to == "household" and unweighted
        if variable == "household_weight":
            return self.weight
        return np.asarray(self.net_income[period])


def wrapped_household():
    # Clone ids past int32 wrap in policyengine-uk, so rows are matched by
    # position, never by id.
    ids = np.array([5, 2**31 + 1, 2**32 + 3], dtype=np.int64)
    return pd.DataFrame(
        {"household_id": ids, "household_weight": [10.0, 20.0, 30.0]}
    )


def test_rows_match_by_position_when_ids_wrap():
    household = wrapped_household()
    assert (
        household["household_id"].astype(np.int32) != household["household_id"]
    ).any()
    simulation = FakeSimulation(household, pd.DataFrame())
    tables = g.dataset_tables(simulation)
    assert tables.year == 2023
    assert tables.household["household_id"].tolist() == list(
        household["household_id"]
    )


def test_a_different_household_count_is_refused():
    household = wrapped_household()
    with pytest.raises(ValueError, match="numbers of households"):
        g.check_household_alignment(
            household,
            engine_ids=household["household_id"][:2],
            engine_weight=[10.0, 20.0],
        )


def test_a_table_out_of_engine_order_is_refused():
    household = wrapped_household().iloc[[1, 0, 2]].reset_index(drop=True)
    simulation = FakeSimulation(household, pd.DataFrame())
    with pytest.raises(ValueError, match="engine's order"):
        g.dataset_tables(simulation)


def test_weights_that_differ_by_position_are_refused():
    household = wrapped_household()
    with pytest.raises(ValueError, match="household_weight differs"):
        g.check_household_alignment(
            household,
            engine_ids=household["household_id"],
            engine_weight=[10.0, 30.0, 20.0],
        )


def test_a_real_simulation_of_synthetic_households(regions, tmp_path):
    """The engine's own dataset and order, on four made-up households."""
    from policyengine_uk.data.dataset_schema import UKSingleYearDataset

    from uk_budget_data.pipeline import build_microsimulation

    ids = np.array([3, 10, 2**31 + 7, 2**32 + 9], dtype=np.int64)
    household = pd.DataFrame(
        {
            "household_id": ids,
            "household_weight": [100.0, 200.0, 150.0, 150.0],
            "region": ["LONDON", "WALES", "LONDON", "LONDON"],
            "tenure_type": ["RENT_PRIVATELY", "OWNED_OUTRIGHT"]
            + ["RENT_PRIVATELY"] * 2,
            "accommodation_type": ["FLAT", "HOUSE_DETACHED", "FLAT", "FLAT"],
            "council_tax": [1500.0, 1200.0, 1500.0, 1500.0],
            "rent": [12000.0, 0.0, 12000.0, 12000.0],
            # The third household is a clone of the first.
            "household_is_capital_gains_clone": [False, False, True, False],
            "source_household_id": [3, 10, 3, 2**32 + 9],
            "region_code_oa": ["E12000007", "W99999999"] + ["E12000007"] * 2,
            "constituency_code_oa": [S1, S2, S1, S1],
        }
    )
    person = pd.DataFrame(
        {
            "person_id": np.arange(1, 7),
            "person_household_id": ids[[0, 0, 1, 2, 2, 3]],
            "person_benunit_id": [1, 1, 2, 3, 3, 4],
            "age": [40, 8, 70, 40, 8, 30],
            "gender": ["FEMALE", "MALE", "MALE", "FEMALE", "MALE", "FEMALE"],
            "employment_income": [30_000.0, 0.0, 0.0, 30_000.0, 0.0, 20_000.0],
        }
    )
    benunit = pd.DataFrame({"benunit_id": [1, 2, 3, 4]})
    path = tmp_path / "synthetic.h5"
    UKSingleYearDataset(
        person=person, benunit=benunit, household=household, fiscal_year=2023
    ).save(str(path))
    simulation = build_microsimulation(str(path))

    tables = g.dataset_tables(simulation)
    assert tables.year == 2023
    assert tables.household["household_id"].tolist() == ids.tolist()
    efrs = g.GeographyCollector.from_simulation(
        simulation, kind="efrs", regions=regions, seat_regions={}
    )
    assert (
        list(efrs.region_codes)
        == ["E12000007", "W92000004"] + ["E12000007"] * 2
    )
    assert efrs.source_ids[0] == efrs.source_ids[2]
    assert len(set(efrs.source_ids)) == 3
    local = g.GeographyCollector.from_simulation(
        simulation,
        kind="microcosm",
        regions=regions,
        seat_regions={S1: "E12000007", S2: "W92000004"},
    )
    assert list(local.source_ids) == [3, 10, 3, 2**32 + 9]
    assert list(local.seat_labels) == [S1, S2, S1, S1]
    efrs.collect("same", 2026, simulation, simulation)
    assert (efrs.change("same", 2026) == 0).all()
    assert len(efrs.weight(2026)) == 4


# -- the collector -----------------------------------------------------------


def test_the_collector_refuses_bad_arrays():
    collector = make_collector(two_regions(4), {})
    ones = np.ones(4)
    with pytest.raises(ValueError, match="one entry per record"):
        collector.add("a", 2026, baseline=ones[:3], reformed=ones, weight=ones)
    collector.add("a", 2026, baseline=ones, reformed=ones, weight=ones)
    with pytest.raises(ValueError, match="already collected"):
        collector.add("a", 2026, baseline=ones, reformed=ones, weight=ones)
    with pytest.raises(ValueError, match="differs between reforms"):
        collector.add("b", 2026, baseline=ones, reformed=ones, weight=ones * 2)


def efrs_simulation(net_income=None):
    household, person = efrs_tables()
    return FakeSimulation(household, person, net_income)


def write_seat_weights(path, matrix, years=(2026,)):
    with h5py.File(path, "w") as handle:
        for year in years:
            handle[str(year)] = matrix
    return path


def test_an_efrs_collector_reads_regions_ids_and_seat_weights(
    regions, tmp_path
):
    seat_regions = {S1: "E12000007", S2: "E12000007"}
    matrix = np.array([[60.0, 30.0, 0.0], [40.0, 20.0, 80.0]])
    path = write_seat_weights(tmp_path / "weights.h5", matrix)
    collector = g.GeographyCollector.from_simulation(
        efrs_simulation(),
        kind="efrs",
        regions=regions,
        seat_regions=seat_regions,
        seat_weights=path,
    )
    assert collector.national
    assert list(collector.region_codes) == ["E12000007"] * 3
    assert collector.source_ids[0] == collector.source_ids[1]
    assert collector.seat_areas(2026).area_codes == (S1, S2)
    with pytest.raises(KeyError, match="2027"):
        collector.seat_areas(2027)


def test_the_collector_reads_both_runs_of_a_year(regions):
    baseline = efrs_simulation({2026: [1.0, 2.0, 3.0]})
    reformed = efrs_simulation({2026: [1.0, 5.0, 3.0]})
    collector = g.GeographyCollector.from_simulation(
        baseline, kind="efrs", regions=regions, seat_regions={}
    )
    collector.collect("a", 2026, baseline, reformed)
    assert list(collector.change("a", 2026)) == [0.0, 3.0, 0.0]
    reformed.weight = reformed.weight * 2
    with pytest.raises(ValueError, match="between the runs"):
        collector.collect("b", 2026, baseline, reformed)


def microcosm_simulation(seat=S2):
    household = pd.DataFrame(
        {
            "household_id": [1, 2, 3],
            "household_weight": [10.0, 10.0, 10.0],
            "source_household_id": [1, 1, 3],
            "household_is_capital_gains_clone": [False, True, False],
            "region_code_oa": ["W99999999", "W99999999", "E12000001"],
            "constituency_code_oa": [S3, S3, seat],
        }
    )
    return FakeSimulation(household, pd.DataFrame())


def test_a_microcosm_collector_reads_seat_labels(regions):
    seat_regions = {S2: "E12000001", S3: "W92000004"}
    collector = g.GeographyCollector.from_simulation(
        microcosm_simulation(),
        kind="microcosm",
        regions=regions,
        seat_regions=seat_regions,
    )
    assert not collector.national
    assert list(collector.region_codes) == ["W92000004"] * 2 + ["E12000001"]
    assert list(collector.seat_labels) == [S3, S3, S2]
    assert list(collector.source_ids) == [1, 1, 3]


def test_a_seat_outside_its_households_region_is_refused(regions):
    seat_regions = {S2: "W92000004", S3: "W92000004"}
    with pytest.raises(ValueError, match="outside their region"):
        g.GeographyCollector.from_simulation(
            microcosm_simulation(),
            kind="microcosm",
            regions=regions,
            seat_regions=seat_regions,
        )


def test_the_reform_processor_feeds_a_collector_each_year():
    from uk_budget_data.models import DataConfig, Reform
    from uk_budget_data.pipeline import ReformProcessor

    class Stub:
        def calculate(self, *args, **kwargs):
            return []

    class Recorder:
        def __init__(self):
            self.calls = []

        def collect(self, *args):
            self.calls.append(args)

    recorder = Recorder()
    processor = ReformProcessor(
        Reform(id="m", name="M"),
        DataConfig(years=[2026, 2027]),
        geography_collector=recorder,
    )
    for name in (
        "budgetary_calc",
        "distributional_calc",
        "winners_losers_calc",
        "metrics_calc",
        "income_curve_calc",
        "household_scatter_calc",
    ):
        setattr(processor, name, Stub())
    processor.distributional_calc = SimpleNamespace(
        calculate=lambda *args: ([], None)
    )
    baseline, reformed = object(), object()
    processor.process(baseline, reformed, None)
    assert recorder.calls == [
        ("m", 2026, baseline, reformed),
        ("m", 2027, baseline, reformed),
    ]
    assert (
        ReformProcessor(Reform(id="m", name="M")).geography_collector is None
    )


# -- the release -------------------------------------------------------------


def package_world(years=(2026,), levels=("region", "constituency")):
    """Three regions of 100; a package of alpha and beta whose interaction
    rests on three households in R1; four seats in blocks, the second of
    them only five households wide."""
    n = 300
    regions_per_record = np.array([R1] * 100 + [R2] * 100 + [R3] * 100)
    alpha = change_on(n, list(range(0, 300, 2)), 120.0)
    beta = change_on(n, list(range(1, 300, 3)), -40.0)
    interaction = change_on(n, [0, 7, 14, *range(100, 300, 7)], 3.0)
    matrix = block_matrix([(0, 50), (95, 100), (100, 150), (150, 300)], n)
    seat_regions = {S1: R1, S2: R1, S3: R2, S4: R3}
    collector = make_collector(
        regions_per_record,
        {PKG: alpha + beta + interaction, "alpha": alpha, "beta": beta},
        matrix=matrix,
        seat_regions=seat_regions,
        years=years,
    )
    return g.build_release(
        collector,
        levels=levels,
        seat_reforms=[PKG],
        packages={PKG: ("alpha", "beta")},
        settings=FAST,
    )


def test_release_structure():
    geo = package_world(years=(2026, 2027))
    reforms = (PKG, "alpha", "beta", g.interaction_id(PKG))
    levels = ("national", "region", "constituency")
    assert set(geo.estimates) == {
        (level, reform, year)
        for level in levels
        for reform in reforms
        for year in (2026, 2027)
    }
    published = {key for key in geo.estimates if geo.is_published(key)}
    assert published == {
        ("region", reform, year)
        for reform in (PKG, "alpha", "beta")
        for year in (2026, 2027)
    } | {("constituency", PKG, year) for year in (2026, 2027)}
    # The layer keeps relations privately; these are the declared ones.
    assert geo.release._nestings == [
        ("region", "national", None),
        ("constituency", "region", {S1: R1, S2: R1, S3: R2, S4: R3}),
    ]
    assert geo.release._packages == [
        (PKG, ("alpha", "beta")),
        (PKG, ("alpha", "beta", g.interaction_id(PKG))),
    ]
    for (level, reform, year), estimate in geo.estimates.items():
        secret = reform == g.interaction_id(PKG) or (
            level == "constituency" and reform != PKG
        )
        for area in estimate.areas.area_codes:
            for family in g.SHARE_FAMILIES:
                assert (
                    geo.tier((level, area, reform, year, family)) == WITHHELD
                )
            if secret:
                assert geo.tier(cell(level, area, reform, year)) == WITHHELD
    assert set(geo.priors[0].cells) == {
        ("national", "UK", reform, year, outcome)
        for reform in (PKG, "alpha", "beta")
        for year in (2026, 2027)
        for outcome in ("average_change", "relative_change")
    }
    assert ("national", "UK", PKG, 2026, "change") in geo.known


def test_the_interaction_is_the_package_less_its_measures():
    geo = package_world()
    table = geo.estimates[("national", g.interaction_id(PKG), 2026)]._table
    exact = table.loc[table["outcome"] == "average_change", "exact_value"]
    # Three pounds for 32 of 300 households, all weighted equally.
    assert exact.iloc[0] == pytest.approx(3.0 * 32 / 300)


def test_a_local_dataset_publishes_seats_only():
    n = 300
    labels = np.array([S1] * 75 + [S2] * 75 + [S3] * 75 + [S4] * 75)
    collector = make_collector(
        two_regions(n),
        {"a": change_on(n, range(0, n, 2))},
        labels=labels,
        national=False,
    )
    geo = g.build_release(collector, seat_reforms=["a"], settings=FAST)
    assert geo.published_levels == ("constituency",)
    assert not geo.is_published(("region", "a", 2026))
    assert geo.release._nestings[1] == ("constituency", "region", None)
    with pytest.raises(ValueError, match="Nothing to publish"):
        g.build_release(collector, levels=("region",), settings=FAST)


def test_a_release_needs_complete_inputs():
    n = 300
    collector = make_collector(two_regions(n), {"a": change_on(n, [0])})
    with pytest.raises(ValueError, match="no constituency"):
        g.build_release(collector, seat_reforms=["a"], settings=FAST)
    with pytest.raises(ValueError, match="needs itself"):
        g.build_release(
            collector,
            levels=("region",),
            packages={"a": ("b",)},
            settings=FAST,
        )
    collector.add(
        "b",
        2027,
        baseline=np.zeros(n),
        reformed=np.zeros(n),
        weight=np.ones(n),
    )
    with pytest.raises(ValueError, match="Missing runs"):
        g.build_release(collector, levels=("region",), settings=FAST)


@pytest.mark.parametrize(
    "row", [("region", R1, "a", 2030), ("region", R3, "a", 2026)]
)
def test_a_prior_cell_matching_no_estimate_is_refused(row):
    n = 300
    collector = make_collector(two_regions(n), {"a": change_on(n, range(n))})
    with pytest.raises(ValueError, match="match no estimate"):
        g.build_release(
            collector,
            levels=("region",),
            prior_regional=prior_frame([row]),
            settings=FAST,
        )


def test_a_prior_drops_withheld_rows():
    frame = prior_frame([("region", R1, "a", 2026), ("region", R2, "a", 2026)])
    frame.loc[1, "tier"] = WITHHELD
    prior = g.regional_prior(frame)
    assert prior.cells == [("region", R1, "a", 2026, "average_change")]
    assert not prior.noise


def test_the_combined_reform_names_every_other_budget_measure():
    from uk_budget_data.reforms import (
        AUTUMN_BUDGET_2026_COMBINED_COMPONENTS,
        AUTUMN_BUDGET_2026_COMBINED_ID,
        get_autumn_budget_2026_reforms,
    )

    ids = [reform.id for reform in get_autumn_budget_2026_reforms()]
    assert AUTUMN_BUDGET_2026_COMBINED_ID in ids
    assert sorted(AUTUMN_BUDGET_2026_COMBINED_COMPONENTS) == sorted(
        i for i in ids if i != AUTUMN_BUDGET_2026_COMBINED_ID
    )
    assert g.PACKAGES == {
        AUTUMN_BUDGET_2026_COMBINED_ID: AUTUMN_BUDGET_2026_COMBINED_COMPONENTS
    }


# -- resolving ---------------------------------------------------------------


def thin_seat_world(levels=("region", "constituency"), prior=None):
    """Seat S1 rests on three households; S2 shows forty beside it."""
    n = 300
    change = change_on(
        n, [0, 1, 2, *range(75, 115), *range(150, 190), *range(225, 265)]
    )
    collector = make_collector(
        two_regions(n),
        {"thin": change},
        matrix=block_matrix([(0, 75), (75, 150), (150, 225), (225, 300)], n),
    )
    return g.build_release(
        collector,
        levels=levels,
        seat_reforms=["thin"],
        prior_regional=prior,
        settings=FAST,
    )


def test_a_thin_seat_withholds_the_seat_the_layer_suggests():
    geo = thin_seat_world()
    log = g.resolve(geo)
    assert log.withheld == [cell("constituency", S2, "thin")]
    assert log.rounds == 1 and log.demotions == []
    assert tier_of(geo, "constituency", S1, "thin") == WITHHELD
    assert tier_of(geo, "constituency", S2, "thin") == WITHHELD
    assert tier_of(geo, "constituency", S3, "thin") != WITHHELD


def lonely_seat_world(levels=("region", "constituency"), prior=None):
    """S1 rests on three households and S2 on none, while the region has
    fifty more outside both seats: no seat can hide S1."""
    n = 300
    change = change_on(
        n, [0, 1, 2, *range(30, 80), *range(150, 190), *range(225, 265)]
    )
    collector = make_collector(
        two_regions(n),
        {"thin": change},
        matrix=block_matrix([(0, 10), (10, 30), (150, 225), (225, 300)], n),
    )
    return g.build_release(
        collector,
        levels=levels,
        seat_reforms=["thin"],
        prior_regional=prior,
        settings=FAST,
    )


def test_with_no_seat_to_withhold_the_region_is_withheld():
    geo = lonely_seat_world()
    log = g.resolve(geo)
    assert log.withheld == [
        # R1 alone would be the national total less R2, so R2 goes too,
        # and then one of R2's seats, since its seats would add up to it.
        cell("constituency", S3, "thin"),
        cell("region", R1, "thin"),
        cell("region", R2, "thin"),
    ]
    assert tier_of(geo, "region", R1, "thin") == WITHHELD
    assert g.exposures(geo) == []


def test_with_no_legal_fix_the_seat_run_is_demoted(tmp_path):
    geo = lonely_seat_world(levels=("constituency",))
    log = g.resolve(geo)
    assert log.demotions == [("thin", 2026)]
    assert log.passes == 2 and log.withheld == []
    assert not geo.is_published(("constituency", "thin", 2026))
    names = {"constituency": {S1: "a", S2: "b", S3: "c", S4: "d"}}
    written = g.write_public_tables(
        geo.release, tmp_path, names, levels=geo.published_levels
    )
    table = pd.read_csv(written["constituency"])
    assert table.empty and list(table.columns)[:3] == [
        "level",
        "area_code",
        "area_name",
    ]


def test_a_demotion_that_cannot_help_raises():
    # The region is published and already public, so it cannot be withheld,
    # and demoting the seats leaves the same remainder.
    prior = prior_frame([("region", R1, "thin", 2026)])
    geo = lonely_seat_world(prior=prior)
    with pytest.raises(g.ResolutionError, match="nothing to demote"):
        g.resolve(geo)


def test_a_withheld_region_with_public_seats_withholds_its_weakest_seat():
    n = 300
    change = change_on(n, [0, 1, 2, *range(150, 250)])
    # R1's seats hold R2's households, so they pass while R1 cannot.
    matrix = block_matrix([(150, 200), (200, 230), (230, 265), (265, 300)], n)
    collector = make_collector(two_regions(n), {"thin": change}, matrix=matrix)
    geo = g.build_release(collector, seat_reforms=["thin"], settings=FAST)
    log = g.resolve(geo)
    assert cell("constituency", S2, "thin") in log.withheld
    assert cell("region", R2, "thin") in log.withheld
    # R2 is then withheld, so its seat with the fewest sources goes too.
    assert cell("constituency", S4, "thin") in log.withheld
    assert tier_of(geo, "region", R1, "thin") == WITHHELD


def three_regions(n=300):
    return np.array([R1] * 100 + [R2] * 100 + [R3] * 100, dtype=object)


def thin_measure_world(prior=None):
    """alpha rests on three households in R1, beside a broad beta."""
    n = 300
    alpha = change_on(n, [0, 1, 2, *range(100, 160), *range(200, 260)])
    beta = change_on(n, [*range(10, 70), *range(110, 170), *range(210, 270)])
    collector = make_collector(
        three_regions(n), {PKG: alpha + beta, "alpha": alpha, "beta": beta}
    )
    return g.build_release(
        collector,
        levels=("region",),
        packages={PKG: ("alpha", "beta")},
        prior_regional=prior,
        settings=FAST,
    )


def test_a_thin_measure_in_a_package_withholds_another_measure():
    geo = thin_measure_world()
    log = g.resolve(geo)
    assert cell("region", R1, "beta") in log.withheld
    assert cell("region", R2, "alpha") in log.withheld
    assert tier_of(geo, "region", R1, PKG) != WITHHELD


def test_withheld_cells_form_a_rectangle():
    # beta in R1, withheld for the package, would be the national total
    # less the other regions; alpha in R2, withheld for alpha's nesting,
    # would be the package less beta there. Withholding beta in R2 closes
    # the rectangle of alpha and beta in R1 and R2.
    geo = thin_measure_world()
    log = g.resolve(geo)
    assert log.withheld == [
        cell("region", R1, "beta"),
        cell("region", R2, "alpha"),
        cell("region", R2, "beta"),
    ]
    assert tier_of(geo, "region", R1, "alpha") == WITHHELD
    assert g.exposures(geo) == []


def test_a_lone_withheld_cell_is_found():
    geo = thin_measure_world()
    geo.withhold([cell("region", R1, "beta"), cell("region", R2, "alpha")])
    assert g.exposures(geo) == [
        (PKG, cell("region", R2, "alpha")),
        ("nesting", cell("region", R1, "beta")),
    ]


def test_loose_records_keep_a_lone_region_hidden():
    n = 330
    regions_per_record = np.array([R1] * 150 + [R2] * 150 + [""] * 30)
    labels = np.array(
        [S1] * 75 + [S2] * 75 + [S3] * 75 + [S4] * 75 + [""] * 30
    )
    change = change_on(n, [0, 1, 2, *range(150, 250), *range(300, 330)])
    collector = make_collector(
        regions_per_record,
        {"thin": change},
        labels=labels,
        national=True,
    )
    geo = g.build_release(collector, seat_reforms=["thin"], settings=FAST)
    log = g.resolve(geo)
    # Households in no region stay hidden beside R1, so R1 is withheld
    # alone and nothing else needs to be.
    assert tier_of(geo, "region", R1, "thin") == WITHHELD
    assert cell("region", R2, "thin") not in log.withheld


def test_a_package_dominated_beside_its_measures_is_withheld_by_seat():
    n = 300
    weight = np.full(n, 100.0)
    weight[0] = 1.0
    matrix = block_matrix([(0, 75), (75, 150), (150, 225), (225, 300)], n)
    # Household 0 weighs little in its region but much in seat S1, where
    # alpha's change rests on it while the package's does not.
    alpha = change_on(n, [*range(1, 41), *range(150, 200)], 10.0)
    alpha[0] = 10_000.0
    beta = np.zeros(n)
    interaction = np.zeros(n)
    interaction[0] = -10_000.0
    collector = make_collector(
        two_regions(n),
        {PKG: alpha + beta + interaction, "alpha": alpha, "beta": beta},
        matrix=matrix,
        weight=weight,
    )
    geo = g.build_release(
        collector,
        seat_reforms=[PKG],
        packages={PKG: ("alpha", "beta")},
        settings=FAST,
    )
    log = g.resolve(geo)
    assert cell("constituency", S1, PKG) in log.withheld
    assert tier_of(geo, "constituency", S1, PKG) == WITHHELD


def test_a_lone_seat_with_no_legal_partner_demotes_its_run():
    n = 300
    weight = np.full(n, 100.0)
    weight[0] = 1.0
    # R1 has a single seat, so the package's withheld cell there would be
    # R1's package value, and R1 is a reference that cannot be withheld.
    matrix = block_matrix([(0, 75), (150, 225), (225, 300)], n)
    seat_regions = {S1: R1, S3: R2, S4: R2}
    alpha = change_on(n, [*range(1, 41), *range(150, 200)], 10.0)
    alpha[0] = 10_000.0
    interaction = np.zeros(n)
    interaction[0] = -10_000.0
    collector = make_collector(
        two_regions(n),
        {PKG: alpha + interaction, "alpha": alpha, "beta": np.zeros(n)},
        matrix=matrix,
        seat_regions=seat_regions,
        weight=weight,
    )
    geo = g.build_release(
        collector,
        levels=("constituency",),
        seat_reforms=[PKG],
        packages={PKG: ("alpha", "beta")},
        settings=FAST,
    )
    log = g.resolve(geo)
    assert log.demotions == [(PKG, 2026)]
    assert published_frame(geo).empty


def test_a_withheld_package_beside_public_measures_withholds_one():
    n = 200
    regions_per_record = two_regions(n)
    alpha = change_on(n, [*range(0, 50), *range(100, 160)], 100.0)
    beta = alpha.copy()
    interaction = change_on(n, range(1, 50), -200.0)
    collector = make_collector(
        regions_per_record,
        {PKG: alpha + beta + interaction, "alpha": alpha, "beta": beta},
    )
    geo = g.build_release(
        collector,
        levels=("region",),
        packages={PKG: ("alpha", "beta")},
        settings=FAST,
    )
    log = g.resolve(geo)
    assert cell("region", R1, "alpha") in log.withheld
    assert cell("region", R1, "beta") not in log.withheld
    assert tier_of(geo, "region", R1, PKG) == WITHHELD


def test_a_known_cell_is_never_withheld():
    n = 300
    change = change_on(n, [0, 1, 2, *range(100, 140), *range(200, 260)])
    collector = make_collector(three_regions(n), {"thin": change})
    prior = prior_frame([("region", R2, "thin", 2026)])
    geo = g.build_release(
        collector, levels=("region",), prior_regional=prior, settings=FAST
    )
    log = g.resolve(geo)
    # The layer suggests R2, with the fewest sources, but it is public.
    assert log.withheld == [cell("region", R3, "thin")]


def test_a_region_finding_with_no_legal_fix_raises():
    n = 200
    change = change_on(n, [0, 1, 2, *range(100, 160)])
    collector = make_collector(two_regions(n), {"thin": change})
    prior = prior_frame([("region", R2, "thin", 2026)])
    geo = g.build_release(
        collector, levels=("region",), prior_regional=prior, settings=FAST
    )
    with pytest.raises(g.ResolutionError, match="No legal fix") as error:
        g.resolve(geo)
    assert error.value.findings == [
        "recoverable_remainder nesting region thin 2026 change national UK"
    ]


def test_a_noised_prior_raises():
    n = 200
    collector = make_collector(two_regions(n), {"a": change_on(n, range(n))})
    prior = prior_frame([("region", R1, "a", 2026)], noise="True")
    geo = g.build_release(
        collector, levels=("region",), prior_regional=prior, settings=FAST
    )
    with pytest.raises(g.ResolutionError, match="noise_reference_public"):
        g.resolve(geo)


def test_an_unchecked_overlap_raises():
    geo = thin_seat_world()
    finding = Finding(
        code="unchecked_overlap",
        blocking=True,
        relation="release",
        message="synthetic",
        level="constituency|national",
    )
    with pytest.raises(g.ResolutionError, match="cannot resolve"):
        g._fix(geo, finding)


def test_a_round_that_adds_nothing_raises(monkeypatch):
    geo = thin_seat_world()
    monkeypatch.setattr(
        g, "_fix", lambda geo, finding: cell("region", R2, "thin")
    )
    with pytest.raises(g.ResolutionError, match="added nothing"):
        g.resolve(geo)


def test_resolving_stops_after_the_last_round():
    with pytest.raises(g.ResolutionError, match="after 0 rounds"):
        g.resolve(thin_seat_world(), max_rounds=0)


def test_resolving_is_deterministic():
    first, second = package_world(), package_world()
    assert g.resolve(first) == g.resolve(second)
    pd.testing.assert_frame_equal(
        first.release.to_public().to_frame(),
        second.release.to_public().to_frame(),
    )


# -- public tables and the private audit -------------------------------------


NAMES = {
    "region": {R1: "One", R2: "Two", R3: "Three"},
    "constituency": {S1: "Seat 1", S2: "Seat 2", S3: "Seat 3", S4: "Seat 4"},
}


@pytest.fixture
def resolved():
    geo = package_world(years=(2026, 2027))
    return geo, g.resolve(geo)


def test_the_tables_hold_published_change_outcomes_in_order(
    resolved, tmp_path
):
    geo, _ = resolved
    written = g.write_public_tables(geo.release, tmp_path, NAMES)
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "constituency.csv",
        "regional.csv",
    ]
    for level, path in written.items():
        assert validate_public(path) == []
        table = pd.read_csv(path, dtype=str, keep_default_na=False)
        columns = list(PUBLIC_COLUMNS)
        columns.insert(columns.index("area_code") + 1, "area_name")
        assert list(table.columns) == columns
        assert set(table["level"]) == {level}
        assert set(table["outcome"]) == set(g.PUBLISHED_OUTCOMES)
        key = ["level", "area_code", "reform", "year", "outcome"]
        assert table[key].values.tolist() == sorted(table[key].values.tolist())
        assert (
            table["area_name"] == table["area_code"].map(NAMES[level])
        ).all()
        withheld = table[table["tier"] == WITHHELD]
        assert not withheld.empty
        blank = withheld[["value", "lo", "hi", "direction", "support_band"]]
        assert (blank == "").all().all()
        assert (withheld["reason"] == "disclosure_control").all()
    seats = pd.read_csv(written["constituency"])
    assert set(seats["reform"]) == {PKG}


def test_a_table_is_written_only_for_the_levels_asked(resolved, tmp_path):
    geo, _ = resolved
    g.write_public_tables(geo.release, tmp_path, NAMES, levels=["region"])
    assert [p.name for p in tmp_path.iterdir()] == ["regional.csv"]


def test_an_unnamed_area_is_refused(resolved, tmp_path):
    geo, _ = resolved
    names = {"region": {R1: "One"}, "constituency": NAMES["constituency"]}
    with pytest.raises(g.GeographyError, match="No name"):
        g.write_public_tables(geo.release, tmp_path, names)
    assert list(tmp_path.iterdir()) == []


def test_a_table_that_fails_validation_replaces_nothing(
    resolved, tmp_path, monkeypatch
):
    geo, _ = resolved
    existing = tmp_path / "regional.csv"
    existing.write_text("earlier table\n")
    monkeypatch.setattr(g, "validate_public", lambda path: ["a problem"])
    with pytest.raises(g.GeographyError, match="fails validation"):
        g.write_public_tables(geo.release, tmp_path, NAMES, levels=["region"])
    assert existing.read_text() == "earlier table\n"
    assert [p.name for p in tmp_path.iterdir()] == ["regional.csv"]


def test_the_audit_goes_to_a_private_directory(
    resolved, tmp_path, monkeypatch
):
    geo, log = resolved
    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
    directory = g.write_private_audit(geo, log, run_id="r1", release_name="x")
    assert (
        directory == (tmp_path / "audit" / "geography" / "r1" / "x").resolve()
    )
    for name in ("disclosure_audit.csv", "summary.json"):
        assert stat.S_IMODE((directory / name).stat().st_mode) == 0o600
    summary = json.loads((directory / "summary.json").read_text())
    assert summary["rounds"] == log.rounds
    assert summary["secondary_withholdings"] == len(log.withheld)
    assert set(summary["tiers"]) == {"region", "constituency"}
    assert "estimate_s" in summary["timings_s"]


def test_the_audit_refuses_a_directory_inside_a_repository(resolved, tmp_path):
    geo, log = resolved
    (tmp_path / "repo" / ".git").mkdir(parents=True)
    with pytest.raises(PrivateOutputError, match="git repository"):
        g.write_private_audit(
            geo, log, run_id="r1", release_name="x", root=tmp_path / "repo"
        )


# -- command line ------------------------------------------------------------


def test_geography_arguments():
    from uk_budget_data.cli import parse_args

    parsed = parse_args(["geography"])
    assert parsed.command == "geography"
    assert parsed.dataset is None and parsed.dataset_kind == "efrs"
    assert parsed.levels == ["region", "constituency"]
    assert parsed.seat_reforms is None and parsed.reforms is None
    assert parsed.years == [2026, 2027, 2028, 2029, 2030]
    assert parsed.out_dir == Path("public/data")
    parsed = parse_args(
        [
            "geography",
            "--dataset",
            "local.h5",
            "--dataset-kind",
            "microcosm",
            "--levels",
            "constituency",
            "--seat-reforms",
            "a",
            "b",
            "--years",
            "2027",
            "--prior-regional",
            "regional.csv",
        ]
    )
    assert parsed.dataset == Path("local.h5")
    assert parsed.levels == ["constituency"]
    assert parsed.seat_reforms == ["a", "b"]
    assert parsed.years == [2027]
    assert parsed.prior_regional == Path("regional.csv")
    with pytest.raises(SystemExit):
        parse_args(["geography", "--levels", "national"])


def no_simulation(*args, **kwargs):
    raise AssertionError("a simulation was built")


def test_without_a_private_directory_nothing_runs(monkeypatch):
    from uk_budget_data import cli

    monkeypatch.delenv(AUDIT_DIR_ENV, raising=False)
    monkeypatch.setattr(g, "simulate_reform", no_simulation)
    assert cli.main(["geography"]) == 1


def test_a_local_dataset_needs_a_path(monkeypatch, tmp_path):
    from uk_budget_data import cli

    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path))
    monkeypatch.setattr(g, "simulate_reform", no_simulation)
    assert cli.main(["geography", "--dataset-kind", "microcosm"]) == 1


@pytest.mark.parametrize(
    "args",
    [
        ["--reforms", "no_such_reform"],
        ["--reforms", "autumn_budget_2026_combined", "two_child_limit"],
        ["--reforms", "two_child_limit", "--seat-reforms", "fuel_duty_freeze"],
        ["--reforms", "two_child_limit", "--levels", "constituency"],
        ["--seat-weights", "missing.h5"],
    ],
)
def test_options_are_checked_before_any_simulation(
    args, monkeypatch, tmp_path
):
    from uk_budget_data import cli

    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path))
    monkeypatch.setattr(g, "simulate_reform", no_simulation)
    data = ["--data-dir", str(tmp_path), "--data-inputs-dir"]
    assert (
        cli.main(["geography", *args, *data, str(REPO / "data_inputs")]) == 1
    )


def synthetic_inputs(tmp_path):
    """The real region table beside a lookup of made-up seats."""
    inputs = tmp_path / "inputs"
    inputs.mkdir()
    (inputs / "regions.csv").write_bytes(REGIONS_CSV.read_bytes())
    regions = pd.read_csv(REGIONS_CSV, dtype=str)
    seats = pd.DataFrame(
        {
            "code": [f"Z14{i:06d}" for i in range(1, 25)],
            "name": [f"Seat {i}" for i in range(1, 25)],
            "x": 0,
            "y": 0,
            "region": list(regions["constituencies_region"]) * 2,
            "country": "",
        }
    )
    seats.to_csv(inputs / "constituencies_2024.csv", index=False)
    return inputs, list(regions["frs_region"]), list(regions["code"])


def fake_world(frs_regions):
    """24 synthetic households per region, a reform's change by id."""
    n = 24 * len(frs_regions)
    index = np.arange(n)
    region = [frs_regions[i % len(frs_regions)] for i in index]
    household = pd.DataFrame(
        {
            "household_id": index + 1,
            "household_weight": 50.0 + index % 3,
            "region": region,
            "tenure_type": ["OWNED_OUTRIGHT"] * n,
            "accommodation_type": ["HOUSE_DETACHED"] * n,
            "source_household_id": index + 1,
        }
    )
    person = pd.DataFrame(
        {
            "person_household_id": index + 1,
            "age": 20 + index,
            "gender": ["FEMALE"] * n,
        }
    )
    changes = {
        "alpha": np.where(index % 2 == 0, 100.0, 0.0),
        "beta": np.where(index % 3 == 0, -50.0, 0.0),
    }
    changes["pkg"] = changes["alpha"] + changes["beta"]
    return household, person, changes


def run_cli(monkeypatch, tmp_path, kind="efrs", orphan=False):
    from uk_budget_data import cli
    from uk_budget_data.models import Reform

    inputs, frs_regions, codes = synthetic_inputs(tmp_path)
    household, person, changes = fake_world(frs_regions)
    n = len(household)
    if orphan:
        # A copy that shares its key with no other household.
        household["household_is_capital_gains_clone"] = np.arange(n) == 0
    region_of = dict(zip(frs_regions, codes))
    seat_of = {code: f"Z14{i + 1:06d}" for i, code in enumerate(codes)}
    seat_regions = {f"Z14{i:06d}": codes[(i - 1) % 12] for i in range(1, 25)}
    args = ["--reforms", "pkg", "alpha", "beta", "--years", "2026"]
    if kind == "efrs":
        matrix = np.zeros((24, n))
        for column, frs in enumerate(household["region"]):
            first = list(seat_regions).index(seat_of[region_of[frs]])
            matrix[first, column] = 30.0
            matrix[first + 12, column] = 20.0
        weights = write_seat_weights(tmp_path / "weights.h5", matrix)
        args += ["--seat-weights", str(weights)]
    else:
        household["region_code_oa"] = [
            (
                region_of[frs]
                if region_of[frs][0] == "E"
                else region_of[frs][0] + "99999999"
            )
            for frs in household["region"]
        ]
        household["constituency_code_oa"] = [
            seat_of[region_of[frs]] for frs in household["region"]
        ]
        args += ["--dataset-kind", "microcosm", "--dataset", "local.h5"]

    def simulate(reform, dataset, years):
        baseline = {2026: np.full(n, BASE)}
        reformed = {2026: BASE + changes[reform.id]}
        return (
            FakeSimulation(household, person, baseline),
            FakeSimulation(household, person, reformed),
        )

    reforms = {r: Reform(id=r, name=r) for r in ("pkg", "alpha", "beta")}
    monkeypatch.setattr(g, "simulate_reform", simulate)
    monkeypatch.setattr(g, "get_reform", reforms.get)
    monkeypatch.setattr(g, "PACKAGES", {"pkg": ("alpha", "beta")})
    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
    out = tmp_path / "out"
    code = cli.main(
        ["geography", *args, "--out-dir", str(out)]
        + ["--data-inputs-dir", str(inputs)]
    )
    return code, out, tmp_path / "audit" / "geography"


def test_the_command_writes_both_tables_from_the_efrs(monkeypatch, tmp_path):
    code, out, audit = run_cli(monkeypatch, tmp_path)
    assert code == 0
    assert sorted(p.name for p in out.iterdir()) == [
        "constituency.csv",
        "regional.csv",
    ]
    assert validate_public(out) == []
    assert set(pd.read_csv(out / "constituency.csv")["reform"]) == {"pkg"}
    (run,) = audit.iterdir()
    assert sorted(p.name for p in (run / "efrs").iterdir()) == [
        "disclosure_audit.csv",
        "summary.json",
    ]


def test_the_command_writes_seats_only_from_microcosm(monkeypatch, tmp_path):
    code, out, _ = run_cli(monkeypatch, tmp_path, kind="microcosm")
    assert code == 0
    assert [p.name for p in out.iterdir()] == ["constituency.csv"]
    assert validate_public(out) == []


def test_data_the_key_cannot_link_stops_the_command(monkeypatch, tmp_path):
    code, out, _ = run_cli(monkeypatch, tmp_path, orphan=True)
    assert code == 1
    assert not out.exists()


# -- the front-end fixture --------------------------------------------------


def test_the_front_end_fixture_is_what_the_recipe_writes(tmp_path):
    written = geography_fixture.build(tmp_path)
    for path in written.values():
        committed = geography_fixture.FIXTURE_DIR / path.name
        assert path.read_bytes() == committed.read_bytes(), (
            f"{path.name} is stale: run "
            "uv run python -m tests.geography_fixture"
        )


def test_the_front_end_fixture_shows_every_tier():
    tables = {
        name: pd.read_csv(geography_fixture.FIXTURE_DIR / name)
        for name in ("regional.csv", "constituency.csv")
    }
    for table in tables.values():
        assert set(table["tier"]) == {"reported", "approximate", "withheld"}
    regional = tables["regional.csv"]
    assert (regional["value"] == 0).any()
    assert set(regional["reform"]) == {"synthetic_combined", "alpha", "beta"}
    assert set(regional["year"]) == {2026, 2027}
    seats = tables["constituency.csv"]
    assert seats["area_code"].str.startswith("Z14").all()
