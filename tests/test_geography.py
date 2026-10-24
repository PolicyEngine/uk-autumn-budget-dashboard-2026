"""Tests for results by area through the disclosure layer (#24).

Every array here is synthetic. Seat codes are made up (Z14...), so no table
written here looks like a real seat table; region codes are the real ONS
ones, read from the canonical region table.
"""

import hashlib
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
from uk_budget_data.budget_years import POLICY_YEARS
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


FLAGS = (
    "household_is_spi_synthetic",
    "household_is_capital_gains_clone",
    "household_is_cgt_band_donor",
)


def stacked_efrs(lineage=False, donor_of=None, copy_age=8, donor_flags=True):
    """Three FRS households stacked as policyengine-uk-data stacks them.

    stack_datasets shifts a copy's ids to one more than the largest id
    present: an SPI copy of household 1 (id 1 + 4), then the capital-gains
    doubling of all four rows (ids + 6), then, if ``donor_of`` is a row
    position, a CGT band donor copying that row (id + 12). With ``lineage``
    every row's source_household_id names its FRS household, as files built
    after policyengine-uk-data#597 do; otherwise it repeats household_id.
    Without ``donor_flags`` the donor carries only its own flag, not the
    flags of the row it copies.
    """
    frs = [(1, 1, 0, 0), (2, 2, 0, 0), (3, 3, 0, 0)]  # id, source, spi, cg
    rows = frs + [(1 + 4, 1, 1, 0)]
    rows = rows + [(i + 6, src, spi, 1) for i, src, spi, _ in rows]
    donor = []
    if donor_of is not None:
        i, src, spi, cg = rows[donor_of]
        donor = [(i + 12, src, spi * donor_flags, cg * donor_flags)]
    ids = [r[0] for r in rows] + [r[0] for r in donor]
    sources = [r[1] for r in rows] + [r[1] for r in donor]
    household = pd.DataFrame(
        {
            "household_id": ids,
            "source_household_id": sources if lineage else ids,
            "region": ["LONDON" if s != 3 else "WALES" for s in sources],
            "tenure_type": ["RENT_PRIVATELY"] * len(ids),
            "accommodation_type": ["FLAT"] * len(ids),
            FLAGS[0]: [bool(r[2]) for r in rows] + [bool(r[2]) for r in donor],
            FLAGS[1]: [bool(r[3]) for r in rows] + [bool(r[3]) for r in donor],
            FLAGS[2]: [False] * len(rows) + [True] * len(donor),
        }
    )
    ages = {1: (40, 8), 2: (40, 8), 3: (70,)}
    person_rows = [
        (hh, age if (hh != ids[3] or n == 0) else copy_age)
        for hh, src in zip(ids, sources)
        for n, age in enumerate(ages[src])
    ]
    person = pd.DataFrame(
        {
            "person_household_id": [hh for hh, _ in person_rows],
            "age": [age for _, age in person_rows],
            "gender": ["FEMALE"] * len(person_rows),
        }
    )
    return household, person


def test_efrs_ids_from_lineage_built_after_the_fix():
    household, person = stacked_efrs(lineage=True)
    ids = g.survey_household_ids(household, person, "efrs")
    assert list(ids) == list(household["source_household_id"])
    assert ids.dtype == np.int64


@pytest.mark.parametrize("donor_of", [None, 0, 3, 7])
def test_efrs_ids_from_undoing_the_stacking_offsets(donor_of):
    household, person = stacked_efrs(donor_of=donor_of)
    lineage, _ = stacked_efrs(lineage=True, donor_of=donor_of)
    ids = g.survey_household_ids(household, person, "efrs")
    assert list(ids) == list(lineage["source_household_id"])


@pytest.mark.parametrize("donor_of", [3, 7])
def test_a_donor_is_unstacked_through_the_row_it_copies(donor_of):
    household, person = stacked_efrs(donor_of=donor_of, donor_flags=False)
    lineage, _ = stacked_efrs(lineage=True, donor_of=donor_of)
    ids = g.survey_household_ids(household, person, "efrs")
    assert list(ids) == list(lineage["source_household_id"])


@pytest.mark.parametrize("dropped", [FLAGS, FLAGS[:1], FLAGS[1:2], FLAGS[2:]])
def test_efrs_tables_without_their_copy_flags_are_refused(dropped):
    # Review probe: with no flags, every row would be its own household.
    household, person = stacked_efrs(donor_of=3)
    household = household.drop(columns=list(dropped))
    with pytest.raises(ValueError, match="lack the copy flags"):
        g.survey_household_ids(household, person, "efrs")


def test_efrs_ids_that_name_no_frs_household_are_refused():
    household, person = stacked_efrs()
    household.loc[3, "household_id"] = 99
    person.loc[person["person_household_id"] == 5, "person_household_id"] = 99
    with pytest.raises(ValueError, match="does not name the FRS household"):
        g.survey_household_ids(household, person, "efrs")


def test_an_efrs_copy_that_does_not_match_its_original_is_refused():
    household, person = stacked_efrs(copy_age=9)
    with pytest.raises(ValueError, match="does not\nmatch|does not match"):
        g.survey_household_ids(household, person, "efrs")


def test_member_order_does_not_change_the_match():
    household, person = stacked_efrs()
    shuffled = person.sample(frac=1, random_state=0).reset_index(drop=True)
    assert (
        g.survey_household_ids(household, shuffled, "efrs")
        == g.survey_household_ids(household, person, "efrs")
    ).all()


def microcosm_household(source_ids, **columns):
    return pd.DataFrame(
        {"household_id": range(10, 10 + len(source_ids))}
        | {"source_household_id": source_ids}
        | columns
    )


def test_microcosm_ids_that_link_copies_are_used():
    household = microcosm_household(
        [7, 7, 9], household_is_spi_synthetic=[False, True, False]
    )
    ids = g.survey_household_ids(
        household, None, "microcosm", microcosm_export=True
    )
    assert list(ids) == [7, 7, 9]


def test_a_sampled_microcosm_copy_need_not_have_its_original():
    # A local file is a sample: the FRS host of a copy may be absent.
    household = microcosm_household(
        [7, 7, 9], household_is_spi_synthetic=[True, True, False]
    )
    ids = g.survey_household_ids(
        household, None, "microcosm", microcosm_export=True
    )
    assert list(ids) == [7, 7, 9]


def test_a_file_that_is_not_a_microcosm_export_is_refused():
    # Review probe: two FRS households and an SPI copy of the first, each
    # cloned twice, with source ids taken after stacking (before
    # policyengine-uk-data#597). The copy's clones share an id no original
    # carries, so the ids are not unique per row.
    household = microcosm_household(
        [1, 1, 2, 2, 3, 3],
        household_is_spi_synthetic=[False] * 4 + [True] * 2,
    )
    with pytest.raises(ValueError, match="not a Microcosm export"):
        g.survey_household_ids(household, None, "microcosm")


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
        g.survey_household_ids(
            household, None, "microcosm", microcosm_export=True
        )


def test_microcosm_ids_unique_per_row_without_copies_are_used():
    household = microcosm_household(
        [7, 8, 9], household_is_capital_gains_clone=[False] * 3
    )
    ids = g.survey_household_ids(
        household, None, "microcosm", microcosm_export=True
    )
    assert list(ids) == [7, 8, 9]


@pytest.mark.parametrize(
    "columns, message",
    [
        ({"source_household_key": ["a", "b", "b"]}, "one to one"),
        ({"region": ["LONDON", "WALES", "LONDON"]}, "span more than one"),
    ],
)
def test_inconsistent_microcosm_lineage_is_refused(columns, message):
    household = microcosm_household([7, 7, 9], **columns)
    with pytest.raises(ValueError, match=message):
        g.survey_household_ids(
            household, None, "microcosm", microcosm_export=True
        )


def test_a_microcosm_export_is_recognised(tmp_path):
    exported, built = tmp_path / "microcosm.h5", tmp_path / "efrs.h5"
    with h5py.File(exported, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
    with h5py.File(built, "w"):
        pass
    assert g.is_microcosm_export(exported)
    assert not g.is_microcosm_export(built)


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
            "household_is_spi_synthetic": [False] * 4,
            "household_is_capital_gains_clone": [False, False, True, False],
            "household_is_cgt_band_donor": [False] * 4,
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
        microcosm_export=True,
    )
    assert list(local.source_ids) == [3, 10, 3, 2**32 + 9]
    assert list(local.seat_labels) == [S1, S2, S1, S1]
    efrs.collect("same", 2026, simulation, simulation)
    assert (efrs.change("same", 2026) == 0).all()
    assert len(efrs.weight(2026)) == 4


# The eFRS seat weights have one row per seat in the order of
# policyengine-uk-data's storage/constituencies_2024.csv, which the matrix
# builder reads; the matrix carries no codes. This is the sha256 of that
# file's code column, one code per line, when the dashboard's copy was last
# checked against it. If either file is reordered, the rows no longer name
# the right seats.
SEAT_ORDER_SHA256 = (
    "9fd6b0172cb5ca7c48b2c4c38ae1e29f6d01a1891d1d73c7b5e9976166e80bc6"
)


def test_the_seat_lookup_keeps_the_weight_matrix_row_order():
    codes = g.load_seats(SEATS_CSV)["code"].tolist()
    digest = hashlib.sha256("\n".join(codes).encode()).hexdigest()
    assert digest == SEAT_ORDER_SHA256


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


def efrs_tables():
    """Three eFRS households, built after policyengine-uk-data#597: the
    second is a capital-gains clone of the first and carries its id."""
    household = pd.DataFrame(
        {
            "household_id": [1, 2, 3],
            "source_household_id": [1, 1, 3],
            "household_weight": [100.0, 50.0, 80.0],
            "region": ["LONDON"] * 3,
            "tenure_type": ["RENT_PRIVATELY"] * 3,
            "accommodation_type": ["FLAT"] * 3,
            "household_is_spi_synthetic": [False] * 3,
            "household_is_capital_gains_clone": [False, True, False],
            "household_is_cgt_band_donor": [False] * 3,
        }
    )
    person = pd.DataFrame(
        {
            "person_household_id": [1, 1, 2, 2, 3],
            "age": [40, 8, 40, 8, 40],
            "gender": ["FEMALE", "MALE", "FEMALE", "MALE", "MALE"],
        }
    )
    return household, person


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
    assert collector.seat_weight_years == {2026: 2026}


def test_a_later_year_rescales_the_latest_seat_weights(regions, tmp_path):
    # The bundle's seat weights hold one year; later years keep each
    # household's split across seats, scaled to that year's weight.
    seat_regions = {S1: "E12000007", S2: "E12000007"}
    matrix = np.array([[60.0, 30.0, 0.0], [40.0, 20.0, 80.0]])
    path = write_seat_weights(tmp_path / "weights.h5", matrix, years=(2025,))
    collector = g.GeographyCollector.from_simulation(
        efrs_simulation(),
        kind="efrs",
        regions=regions,
        seat_regions=seat_regions,
        seat_weights=path,
    )
    weight = np.array([150.0, 75.0, 40.0])
    collector.add(
        "a", 2027, baseline=np.zeros(3), reformed=np.zeros(3), weight=weight
    )
    areas = collector.seat_areas(2027)
    assert collector.seat_weight_years == {2027: 2025}
    assert np.allclose(areas.record_weights([S1, S2]), weight)
    assert np.allclose(
        areas.record_weights([S1]), [60.0 * 1.5, 30.0 * 1.5, 0.0]
    )
    with pytest.raises(KeyError, match="or any earlier year"):
        collector.seat_areas(2024)


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
        microcosm_export=True,
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
            microcosm_export=True,
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
        "age_calc",
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


def test_a_region_an_earlier_table_withheld_stays_withheld():
    # Review finding: in a seat-only release the regions are references, and
    # a reference that passes counts as public. A region the published
    # table withheld must stay hidden, so the layer checks that the seats
    # do not add up to it.
    frame = prior_frame([("region", R1, "thin", 2026)])
    frame.loc[0, "tier"] = WITHHELD
    plain = thin_seat_world(levels=("constituency",))
    hidden = thin_seat_world(levels=("constituency",), prior=frame)
    region = cell("region", R1, "thin")
    assert plain.tier(region) != WITHHELD
    assert hidden.tier(region) == WITHHELD
    assert g.regional_withheld(frame) == {region}


def test_a_withheld_prior_cell_matching_no_estimate_is_refused():
    frame = prior_frame([("region", R3, "thin", 2026)])
    frame.loc[0, "tier"] = WITHHELD
    with pytest.raises(ValueError, match="match no estimate"):
        thin_seat_world(levels=("constituency",), prior=frame)


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
    assert parsed.seat_lookup is None
    assert parsed.years == POLICY_YEARS
    assert parsed.out_dir == Path("public/data")
    assert parsed.manifest == Path("public/data/manifest.json")
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


def publication_manifest(tmp_path, ids, packages=None, statuses=None):
    """A real approved publication manifest over synthetic receipts.

    These approvals exercise the command's entry gate; the area run still
    has to pass its independent data-limit and disclosure checks.
    """
    from tests.publication_support import World
    from uk_budget_data.publication import manifest as m
    from uk_budget_data.publication.artifacts import read_receipt
    from uk_budget_data.publication.combine import combined_key
    from uk_budget_data.publication.publish import approve, stage

    world = World()
    try:
        manifest = m.Manifest()
        args = dict(data_root=world.data_root, inputs=world.inputs)
        records = {}
        for key in ids:
            if key in (packages or {}):
                continue
            reference = world.ready(key, {2027: -1.0})
            stage(manifest, reference.path, **args)
            approve(manifest, key, "Reviewer", **args)
            receipt = read_receipt(reference.path)["execution_receipt"]
            records[key] = {
                "id": key,
                "baseline": receipt["baseline"],
                "reform": receipt["reform"],
            }
        for members in (packages or {}).values():
            key = combined_key(list(members))
            reference = world.write(
                key,
                {2027: -float(len(members))},
                members=[records[member] for member in members],
                measure_ids=list(members),
                member_outputs={
                    member: manifest.measures[member].outputs_sha256
                    for member in members
                },
            )
            world.reconcile(reference)
            stage(manifest, reference.path, **args)
            approve(manifest, key, "Reviewer", **args)
        for key, status in (statuses or {}).items():
            manifest.entries()[key].status = status
        path = tmp_path / "publication.json"
        path.write_text(manifest.model_dump_json(by_alias=True))
        return path
    finally:
        world.close()


def enhanced_frs_bundle(monkeypatch):
    """The enhanced-FRS bundle route, without loading its dataset."""
    monkeypatch.setattr(
        g,
        "_bundle_dataset",
        lambda: (
            "enhanced_frs_2024_25",
            "policyengine/policyengine-uk-data-private",
        ),
    )


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
    ("args", "message"),
    [
        (["--reforms", "no_such_reform"], "absent from the manifest"),
        (["--reforms", "pkg", "alpha"], "pkg needs its measures"),
        (
            ["--reforms", "alpha", "--seat-reforms", "beta"],
            "--seat-reforms must name chosen reforms",
        ),
        (
            ["--reforms", "alpha", "--seat-reforms", "absent"],
            "absent from the manifest",
        ),
        (["--seat-weights", "missing.h5"], "No seat weights"),
    ],
)
def test_options_are_checked_before_any_simulation(
    args, message, monkeypatch, tmp_path, capsys
):
    from uk_budget_data import cli
    from uk_budget_data.models import Reform

    packages = {"pkg": ("alpha", "beta")}
    ids = ("pkg", "alpha", "beta")
    manifest = publication_manifest(tmp_path, ids, packages)
    monkeypatch.setattr(g, "PACKAGES", packages)
    monkeypatch.setattr(
        g, "get_reform", {key: Reform(id=key, name=key) for key in ids}.get
    )
    enhanced_frs_bundle(monkeypatch)
    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path))
    monkeypatch.setattr(g, "simulate_reform", no_simulation)
    data = ["--data-dir", str(tmp_path), "--data-inputs-dir"]
    assert (
        cli.main(
            ["geography", "--manifest", str(manifest), *args, *data]
            + [str(REPO / "data_inputs")]
        )
        == 1
    )
    assert message in " ".join(capsys.readouterr().out.split())


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
        | {flag: [False] * n for flag in FLAGS}
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


def run_cli(
    monkeypatch,
    tmp_path,
    kind="efrs",
    orphan=False,
    extra=(),
    marker=True,
    lookup=True,
    changes_of=None,
    package=None,
    package_registered=False,
    inputs_ready=None,
):
    from uk_budget_data import cli
    from uk_budget_data.models import Reform

    inputs, frs_regions, codes = inputs_ready or synthetic_inputs(tmp_path)
    household, person, changes = fake_world(frs_regions)
    n = len(household)
    if orphan:
        # A copy that shares its key with no other household.
        household["household_is_capital_gains_clone"] = np.arange(n) == 0
    region_of = dict(zip(frs_regions, codes))
    seat_of = {code: f"Z14{i + 1:06d}" for i, code in enumerate(codes)}
    seat_regions = {f"Z14{i:06d}": codes[(i - 1) % 12] for i in range(1, 25)}
    args = ["--reforms", "pkg", "alpha", "beta", "--years", "2026"]
    if package is not None:
        args = ["--reforms", "alpha", "beta", "--package", package]
        if package_registered:
            # The integrator lists the package among the reforms too.
            args[3:3] = [package]
        args += ["--years", "2026"]
        changes[package] = changes["pkg"]
    if kind == "efrs":
        matrix = np.zeros((24, n))
        for column, frs in enumerate(household["region"]):
            first = list(seat_regions).index(seat_of[region_of[frs]])
            matrix[first, column] = 30.0
            matrix[first + 12, column] = 20.0
        weights = write_seat_weights(tmp_path / "weights.h5", matrix)
        if lookup:
            # The data release ships the lookup beside the weights.
            (tmp_path / g.SEATS_FILE).write_bytes(
                (inputs / g.SEATS_FILE).read_bytes()
            )
        args += ["--seat-weights", str(weights)]
    elif kind == "microcosm-national":
        national = tmp_path / "national.h5"
        with h5py.File(national, "w") as handle:
            if marker:
                handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "calibrated"
        args += ["--dataset-kind", kind, "--dataset", str(national)]
        args += ["--levels", "region"]
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
        local = tmp_path / "local.h5"
        with h5py.File(local, "w") as handle:
            if marker:
                handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
        args += ["--dataset-kind", "microcosm", "--dataset", str(local)]

    def simulate(reform, dataset, years, members=None):
        baseline = {2026: np.full(n, BASE)}
        reformed = {2026: BASE + changes[reform.id]}
        return (
            FakeSimulation(household, person, baseline),
            FakeSimulation(household, person, reformed),
        )

    reforms = {
        r: Reform(
            id=r, name=r, parameter_changes=(changes_of or {}).get(r) or {}
        )
        for r in ("pkg", "alpha", "beta")
    }
    if package_registered:
        reforms[package] = Reform(id=package, name=package)
    monkeypatch.setattr(g, "simulate_reform", simulate)
    monkeypatch.setattr(g, "get_reform", reforms.get)
    monkeypatch.setattr(g, "PACKAGES", {"pkg": ("alpha", "beta")})
    manifest = publication_manifest(
        tmp_path, reforms, packages={"pkg": ("alpha", "beta")}
    )
    enhanced_frs_bundle(monkeypatch)
    if package is not None:
        from uk_budget_data.publication import combine

        monkeypatch.setattr(g, "PACKAGES", {})
        monkeypatch.setattr(combine, "check_consistency", lambda *a: None)
    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
    out = tmp_path / "out"
    code = cli.main(
        [
            "geography",
            "--manifest",
            str(manifest),
            *args,
            *extra,
            "--out-dir",
            str(out),
        ]
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
    summary = json.loads((run / "efrs" / "summary.json").read_text())
    assert summary["seat_weights_from"] == {"2026": 2026}


@pytest.mark.parametrize("allowed", [False, True])
def test_a_demoted_run_stops_the_command_unless_allowed(
    monkeypatch, tmp_path, capsys, allowed
):
    resolve = g.resolve

    def demoting(geo, **kwargs):
        log = resolve(geo, **kwargs)
        log.demotions.append(("pkg", 2026))
        return log

    monkeypatch.setattr(g, "resolve", demoting)
    extra = ["--allow-demotions"] if allowed else []
    code, out, audit = run_cli(monkeypatch, tmp_path, extra=extra)
    printed = capsys.readouterr().out
    assert "Demoted: constituency pkg 2026" in printed
    assert code == (0 if allowed else 1)
    assert out.exists() == allowed
    assert any(audit.rglob("summary.json"))


def test_the_command_writes_seats_only_from_microcosm(monkeypatch, tmp_path):
    code, out, _ = run_cli(monkeypatch, tmp_path, kind="microcosm")
    assert code == 0
    assert [p.name for p in out.iterdir()] == ["constituency.csv"]
    assert validate_public(out) == []


def test_a_local_file_without_the_export_marker_is_refused(
    monkeypatch, tmp_path, capsys
):
    from uk_budget_data import cli
    from uk_budget_data.cli import parse_args

    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
    monkeypatch.setattr(g, "simulate_reform", no_simulation)
    local = tmp_path / "local.h5"
    with h5py.File(local, "w"):
        pass
    args = ["geography", "--dataset-kind", "microcosm", "--dataset"]
    args += [str(local), "--levels", "constituency"]
    args += ["--data-inputs-dir", str(REPO / "data_inputs")]
    assert cli.main(args) == 1
    assert "needs a Microcosm export" in capsys.readouterr().out
    with h5py.File(local, "a") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
    manifest = publication_manifest(tmp_path, ["two_child_limit"])
    args += ["--manifest", str(manifest), "--seat-reforms", "two_child_limit"]
    assert g._plan(parse_args(args)).microcosm_export


@pytest.mark.parametrize("lookup", ["missing", "reordered", "elsewhere"])
def test_seat_weights_need_the_lookup_they_were_built_from(
    lookup, tmp_path, monkeypatch
):
    from uk_budget_data.cli import parse_args

    weights_dir = tmp_path / "release"
    weights_dir.mkdir()
    extra = []
    if lookup != "missing":
        seats = pd.read_csv(SEATS_CSV, dtype=str, keep_default_na=False)
        if lookup == "reordered":
            seats = seats.iloc[[1, 0, *range(2, len(seats))]]
        path = weights_dir / g.SEATS_FILE
        if lookup == "elsewhere":
            path = tmp_path / "lookup.csv"
            extra = ["--seat-lookup", str(path)]
        seats.to_csv(path, index=False)
    write_seat_weights(weights_dir / g.SEAT_WEIGHTS_FILE, np.zeros((650, 1)))
    manifest = publication_manifest(tmp_path, ["two_child_limit"])
    enhanced_frs_bundle(monkeypatch)
    parsed = parse_args(
        [
            "geography",
            "--manifest",
            str(manifest),
            "--levels",
            "constituency",
            "--seat-reforms",
            "two_child_limit",
            *extra,
        ]
        + ["--data-dir", str(weights_dir)]
        + ["--data-inputs-dir", str(REPO / "data_inputs")]
    )
    if lookup == "elsewhere":
        assert (
            g._plan(parsed).seat_weights == weights_dir / g.SEAT_WEIGHTS_FILE
        )
        return
    message = "No seat lookup" if lookup == "missing" else "same order"
    with pytest.raises(ValueError, match=message):
        g._plan(parsed)


def test_data_the_key_cannot_link_stops_the_command(monkeypatch, tmp_path):
    code, out, _ = run_cli(monkeypatch, tmp_path, orphan=True)
    assert code == 1
    assert not out.exists()


# -- the Microcosm pair ------------------------------------------------------


def national_microcosm_household(**columns):
    return pd.DataFrame(
        {
            "household_id": [1, 2, 3],
            "household_weight": [10.0, 20.0, 30.0],
            "source_household_id": [7, 7, 9],
            "region": ["NORTH_EAST", "NORTH_EAST", "LONDON"],
            "household_is_spi_synthetic": [False, True, False],
        }
        | columns
    )


def test_a_microcosm_national_collector_publishes_regions(regions):
    household = national_microcosm_household()
    simulation = FakeSimulation(household, pd.DataFrame())
    collector = g.GeographyCollector.from_simulation(
        simulation,
        kind="microcosm-national",
        regions=regions,
        seat_regions={},
        microcosm_export=True,
    )
    assert collector.national and not collector.has_seats
    assert list(collector.source_ids) == [7, 7, 9]
    assert list(collector.region_codes) == ["E12000001"] * 2 + ["E12000007"]


@pytest.mark.parametrize(
    "kind, columns, message",
    [
        (
            "microcosm-national",
            {"constituency_code_oa": ["Z14000001"] * 3},
            "is a Microcosm local file",
        ),
        ("microcosm", {}, "is not a local file"),
        ("microcosm", {"region_code_oa": ["E12000001"] * 3}, "lacks"),
    ],
)
def test_each_file_of_the_pair_is_refused_as_the_other(
    regions, kind, columns, message
):
    household = national_microcosm_household(**columns)
    simulation = FakeSimulation(household, pd.DataFrame())
    with pytest.raises(ValueError, match=message):
        g.GeographyCollector.from_simulation(
            simulation,
            kind=kind,
            regions=regions,
            seat_regions={},
            microcosm_export=True,
        )


def test_the_national_microcosm_file_has_no_seats(tmp_path):
    from uk_budget_data.cli import parse_args

    national = tmp_path / "national.h5"
    with h5py.File(national, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "calibrated"
    args = ["geography", "--dataset-kind", "microcosm-national"]
    args += ["--dataset", str(national)]
    with pytest.raises(ValueError, match="has no seats"):
        g._plan(parse_args(args))
    with pytest.raises(ValueError, match="for the eFRS only"):
        g._plan(
            parse_args([*args, "--levels", "region", "--seat-weights", "w"])
        )


def test_the_command_writes_regions_from_microcosm_national(
    monkeypatch, tmp_path
):
    code, out, audit = run_cli(
        monkeypatch, tmp_path, kind="microcosm-national"
    )
    assert code == 0
    assert [p.name for p in out.iterdir()] == ["regional.csv"]
    assert validate_public(out) == []
    (run,) = audit.iterdir()
    assert [p.name for p in run.iterdir()] == ["microcosm-national"]


def test_a_package_is_built_from_the_chosen_measures(monkeypatch, tmp_path):
    code, out, audit = run_cli(
        monkeypatch, tmp_path, kind="microcosm", package="new_combined"
    )
    assert code == 0
    table = pd.read_csv(out / "constituency.csv")
    # With --package, the package and every measure are published by seat.
    assert set(table["reform"]) == {"alpha", "beta", "new_combined"}
    (run,) = audit.iterdir()
    summary = json.loads((run / "microcosm" / "summary.json").read_text())
    assert summary["packages"] == {"new_combined": ["alpha", "beta"]}


def test_a_package_name_is_checked(monkeypatch):
    from uk_budget_data.models import Reform

    monkeypatch.setattr(g, "get_reform", {}.get)
    measures = [Reform(id="a", name="a"), Reform(id="b", name="b")]
    with pytest.raises(ValueError, match="must end in _combined"):
        g.build_package("new_package", measures, [2026])


def test_a_registered_package_is_used_once_checked(monkeypatch):
    from uk_budget_data.models import Reform
    from uk_budget_data.publication import combine

    registered = Reform(id="old_combined", name="old")
    monkeypatch.setattr(g, "get_reform", {"old_combined": registered}.get)
    checked = []

    def check(package, members, *args):
        checked.append((package.id, [m.id for m in members]))

    monkeypatch.setattr(combine, "check_consistency", check)
    measures = [Reform(id="b", name="b"), Reform(id="a", name="a")]
    assert g.build_package("old_combined", measures, [2026]) is registered
    assert checked == [("old_combined", ["a", "b"])]


def test_a_package_that_is_not_its_measures_is_refused(monkeypatch):
    from uk_budget_data.models import Reform
    from uk_budget_data.publication import combine

    registered = Reform(id="old_combined", name="old")
    monkeypatch.setattr(g, "get_reform", {"old_combined": registered}.get)

    def check(*args):
        raise combine.CombineInconsistent("changes another parameter")

    monkeypatch.setattr(combine, "check_consistency", check)
    measures = [Reform(id="a", name="a"), Reform(id="b", name="b")]
    with pytest.raises(ValueError, match="another parameter"):
        g.build_package("old_combined", measures, [2026])


def test_a_registered_package_named_among_the_reforms_runs(
    monkeypatch, tmp_path
):
    code, out, _ = run_cli(
        monkeypatch,
        tmp_path,
        kind="microcosm",
        package="mock_combined",
        package_registered=True,
    )
    assert code == 0
    table = pd.read_csv(out / "constituency.csv")
    assert set(table["reform"]) == {"alpha", "beta", "mock_combined"}


def test_a_package_needs_two_measures(monkeypatch):
    from uk_budget_data.models import Reform

    monkeypatch.setattr(g, "get_reform", {}.get)
    with pytest.raises(ValueError, match="at least two"):
        g.build_package("a_combined", [Reform(id="a", name="a")], [2026])


def test_each_reform_is_simulated_on_its_own_baseline(monkeypatch):
    # The data-limit watch reads a variable calculated before it starts as
    # touching every limit, so no baseline is shared between reforms.
    from uk_budget_data.models import Reform

    built = []

    def build(dataset, scenario=None):
        built.append(scenario)
        return object()

    monkeypatch.setattr(g, "build_microsimulation", build)
    plain = Reform(id="plain", name="plain", parameter_changes={})
    first, _ = g.simulate_reform(plain, None, [2026])
    second, _ = g.simulate_reform(plain, None, [2026])
    assert first is not second and len(built) == 4


def test_a_package_the_manifest_does_not_approve_is_refused(tmp_path):
    from uk_budget_data.publication import manifest as m

    def parsed(path):
        return m.parse_manifest(path.read_bytes(), str(path))

    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()

    measures_only = parsed(
        publication_manifest(tmp_path / "a", ["alpha", "beta"])
    )
    with pytest.raises(ValueError, match="absent from the manifest"):
        g.approved_package(measures_only, "new_combined", ["alpha", "beta"])
    approved = parsed(
        publication_manifest(
            tmp_path / "b",
            ["pkg", "alpha", "beta"],
            packages={"pkg": ("alpha", "beta")},
        )
    )
    g.approved_package(approved, "new_combined", ["beta", "alpha"])


def write_audit(path, rows):
    path.mkdir(parents=True)
    columns = [*g._PAIR_KEY, "exact_value"]
    frame = pd.DataFrame(rows, columns=columns)
    frame.to_csv(path / g.AUDIT_FILE, index=False)
    return path


def test_the_pair_check_flags_gaps_beyond_tolerance(tmp_path):
    national = write_audit(
        tmp_path / "national",
        [
            ("national", "UK", "a", 2026, "average_change", 100.0),
            ("region", R1, "a", 2026, "average_change", 100.0),
            ("region", R1, "a", 2026, "relative_change", 0.0001),
            ("region", R2, "a", 2026, "average_change", 50.0),
            ("national", "UK", "a__interaction", 2026, "average_change", 9.0),
            ("national", "UK", "a", 2026, "share_gaining", 0.5),
        ],
    )
    local = write_audit(
        tmp_path / "local",
        [
            ("national", "UK", "a", 2026, "average_change", 104.0),
            ("region", R1, "a", 2026, "average_change", 115.0),
            ("region", R1, "a", 2026, "relative_change", 0.0004),
            ("constituency", S1, "a", 2026, "average_change", 1.0),
        ],
    )
    report = g.pair_consistency(national / g.AUDIT_FILE, local / g.AUDIT_FILE)
    status = dict(
        zip(zip(report["area_code"], report["outcome"]), report["status"])
    )
    assert status == {
        ("UK", "average_change"): "within_tolerance",
        (R1, "average_change"): "beyond_tolerance",
        (R1, "relative_change"): "within_tolerance",
        (R2, "average_change"): "national_only",
    }
    summary = g.pair_summary(report)
    assert "4 national and regional cells" in summary
    assert "1 beyond tolerance" in summary and "1 in one run only" in summary
    assert "115" not in summary and "104" not in summary


def test_a_local_run_writes_the_pair_report(monkeypatch, tmp_path, capsys):
    inputs = synthetic_inputs(tmp_path)
    extra = ["--run-id", "pair1"]
    code, _, audit = run_cli(
        monkeypatch,
        tmp_path,
        kind="microcosm-national",
        extra=extra,
        inputs_ready=inputs,
    )
    assert code == 0
    national = audit / "pair1" / "microcosm-national"
    code, _, _ = run_cli(
        monkeypatch,
        tmp_path,
        kind="microcosm",
        extra=[*extra, "--compare-with", str(national)],
        inputs_ready=inputs,
    )
    assert code == 0
    report = audit / "pair1" / "microcosm" / g.PAIR_REPORT_FILE
    assert stat.S_IMODE(report.stat().st_mode) == 0o600
    assert "Pair check (report only)" in capsys.readouterr().out
    assert set(pd.read_csv(report)["status"]) == {"within_tolerance"}


def test_compare_with_needs_a_local_run_and_an_audit(tmp_path):
    from uk_budget_data.cli import parse_args

    local = tmp_path / "local.h5"
    with h5py.File(local, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "calibrated"
    args = ["geography", "--dataset-kind", "microcosm", "--dataset"]
    args += [str(local), "--compare-with", str(tmp_path)]
    with pytest.raises(ValueError, match="No disclosure_audit.csv"):
        g._plan(parse_args(args))
    with pytest.raises(ValueError, match="for a Microcosm local run"):
        g._plan(parse_args(["geography", "--compare-with", str(tmp_path)]))


def test_a_run_id_is_a_plain_name(monkeypatch, tmp_path, capsys):
    from uk_budget_data import cli

    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path))
    monkeypatch.setattr(g, "simulate_reform", no_simulation)
    assert cli.main(["geography", "--run-id", "../escape"]) == 1
    assert "--run-id takes" in capsys.readouterr().out


def test_the_pair_check_command_reports_counts(tmp_path, capsys):
    from uk_budget_data import cli

    row = ("national", "UK", "a", 2026, "average_change", 100.0)
    national = write_audit(tmp_path / "audit" / "n", [row])
    local = write_audit(tmp_path / "audit" / "l", [row])
    args = ["pair-check", "--national-audit", str(national)]
    assert cli.main([*args, "--local-audit", str(local)]) == 0
    assert "0 beyond tolerance" in capsys.readouterr().out
    assert (local / g.PAIR_REPORT_FILE).is_file()


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


# --- data limits (#51 round 19, F8) -------------------------------------------

SURCHARGE_RATE = (
    "gov.hmrc.stamp_duty.residential.purchase.additional.rate[1].rate"
)
INCOME_TAX_RATE = "gov.hmrc.income_tax.rates.uk[0].rate"


def test_a_measure_the_data_cannot_cost_gets_no_table_by_area(
    monkeypatch, tmp_path, capsys
):
    """Review of #51, round 19: the area view ran outside the data-limit
    watch, so a measure published as not computable, or a package with it,
    would still show figures by area. The command now writes no table."""
    code, out, _ = run_cli(
        monkeypatch,
        tmp_path,
        changes_of={"alpha": {SURCHARGE_RATE: {"2026": 0.07}}},
    )
    printed = " ".join(capsys.readouterr().out.split())
    assert code == 1
    assert not out.exists()
    assert "Not computable on current data: alpha" in printed
    assert "beta" not in printed.split("Not computable")[1].split("Error")[0]


def test_with_no_data_limit_registered_nothing_is_refused(
    monkeypatch, tmp_path
):
    from uk_budget_data import data_limits

    monkeypatch.setattr(data_limits, "DATA_LIMITS", ())
    code, out, _ = run_cli(
        monkeypatch,
        tmp_path,
        changes_of={"alpha": {SURCHARGE_RATE: {"2026": 0.07}}},
    )
    assert code == 0
    assert out.exists()


def test_a_computable_measure_still_writes_its_tables(monkeypatch, tmp_path):
    code, out, _ = run_cli(
        monkeypatch,
        tmp_path,
        changes_of={"alpha": {INCOME_TAX_RATE: {"2026": 0.21}}},
    )
    assert code == 0
    assert validate_public(out) == []


# On the Pension Credit model limit, which holds this from 2027 until the
# UK hub's earnings fix is in the model.
MINIMUM_GUARANTEE = (
    "gov.dwp.pension_credit.guarantee_credit.minimum_guarantee.SINGLE"
)


def test_a_measure_touching_a_model_limit_writes_no_tables(
    monkeypatch, tmp_path, capsys
):
    """Review of the VAT model limit: approval alone held the area view, so
    a measure approved before its model limit was registered, or on a model
    with the fix, still ran by area. The command now judges its own run, as
    the generator does, and writes no table."""
    code, out, _ = run_cli(
        monkeypatch,
        tmp_path,
        changes_of={"alpha": {MINIMUM_GUARANTEE: {"2027": 250.0}}},
    )
    printed = " ".join(capsys.readouterr().out.split())
    assert code == 1
    assert not out.exists()
    assert "Mis-costed by this model: alpha" in printed
    assert "touch a model limit, so no tables were written" in printed
    assert "Not computable" not in printed


def household_situation():
    return {
        "people": {
            "p": {"age": {2027: 40}, "employment_income": {2027: 30_000}}
        },
        "benunits": {"b": {"members": ["p"]}},
        "households": {"h": {"members": ["p"]}},
    }


@pytest.mark.parametrize(
    "changes, limited",
    [
        ({SURCHARGE_RATE: {"2027": 0.07}}, ["additional_dwelling_purchases"]),
        ({INCOME_TAX_RATE: {"2027": 0.21}}, []),
    ],
)
def test_real_simulations_are_judged_as_the_generator_judges_them(
    monkeypatch, changes, limited
):
    """On simulations with a parameter tree: built under the build watch,
    collected under the run watch, then the generator's own rule."""
    from policyengine_uk import Simulation

    from uk_budget_data import data_limits
    from uk_budget_data.models import Reform

    monkeypatch.setattr(
        g,
        "build_microsimulation",
        lambda dataset, scenario=None: Simulation(
            situation=household_situation(), scenario=scenario
        ),
    )
    reform = Reform(id="m", name="m", parameter_changes=changes)
    baseline, reformed = g.simulate_reform(reform, None, [2027])
    with data_limits.observing(baseline, reformed) as observed:
        for sim in (baseline, reformed):
            sim.calculate("household_net_income", 2027)
    touched = g.reform_data_limits(
        reform, baseline, reformed, observed, [2027]
    )
    assert [item["key"] for item in touched] == limited


# --- the command on real simulations (#76's review) ----------------------------
#
# The command tests above run on stand-ins, for which the watch yields
# nothing, so they can't tell whether the area figures were watched. These
# run the real command on household simulations, replacing only the dataset
# builder, the dataset-level collector (one record) and the
# Microsimulation-only ``unweighted`` keyword (adapted from the review's
# probes).

PURCHASES = "additional_residential_property_purchased"
# The same name in ROT13, which no check of a formula's written names reads.
HIDDEN_PURCHASES = "nqqvgvbany_erfvqragvny_cebcregl_chepunfrq"
REFUSED = "Not computable on current data"


def real_household_build(dataset, scenario=None):
    from policyengine_uk import Simulation

    return Simulation(situation=household_situation(), scenario=scenario)


@pytest.fixture
def real_simulations(monkeypatch):
    monkeypatch.setattr(g, "build_microsimulation", real_household_build)
    monkeypatch.setattr(
        g,
        "household_values",
        lambda sim, variable, year: np.asarray(
            sim.calculate(variable, period=year, map_to="household"),
            dtype=float,
        ),
    )

    def one_record(cls, sim, **kwargs):
        return cls(
            source_ids=np.array([1]),
            region_codes=np.array(["E12000007"], dtype=object),
            national=True,
        )

    monkeypatch.setattr(
        g.GeographyCollector, "from_simulation", classmethod(one_record)
    )


def geography_command(
    monkeypatch,
    tmp_path,
    capsys,
    reforms,
    years=("2027",),
    packages=None,
    statuses=None,
    extra=(),
    bundle_efrs=True,
):
    from uk_budget_data import cli

    lookup = {reform.id: reform for reform in reforms}
    monkeypatch.setattr(g, "get_reform", lookup.get)
    monkeypatch.setattr(g, "PACKAGES", packages or {})
    manifest = publication_manifest(tmp_path, lookup, packages, statuses)
    if bundle_efrs:
        enhanced_frs_bundle(monkeypatch)
    monkeypatch.setenv(AUDIT_DIR_ENV, str(tmp_path / "audit"))
    inputs = Path(g.__file__).parents[2] / "data_inputs"
    code = cli.main(
        [
            "geography",
            "--manifest",
            str(manifest),
            "--reforms",
            *lookup,
            "--years",
            *years,
        ]
        + ["--levels", "region", "--out-dir", str(tmp_path / "out")]
        + ["--data-inputs-dir", str(inputs)]
        + list(extra)
    )
    printed = " ".join(capsys.readouterr().out.split())
    return code, printed


def test_an_unapproved_run_builds_no_simulation_and_writes_no_tables(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="held", name="Held")],
        statuses={"held": "provisional"},
    )
    assert code == 1
    assert "held: provisional" in printed
    assert not (tmp_path / "out").exists()
    assert not list((tmp_path / "audit").rglob("summary.json"))


def test_an_approved_run_proceeds_on_real_simulations(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    code, printed = geography_command(
        monkeypatch, tmp_path, capsys, [Reform(id="alpha", name="Alpha")]
    )
    assert code == 0, printed
    assert (tmp_path / "out" / "regional.csv").is_file()
    assert validate_public(tmp_path / "out") == []
    assert "UNCERTIFIED" not in printed


def test_a_microcosm_run_has_banners_and_an_uncertified_private_audit(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    local = tmp_path / "local.h5"
    with h5py.File(local, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset-kind", "microcosm", "--dataset", str(local)),
    )
    assert code == 0, printed
    assert printed.startswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.endswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.count(g.MICROCOSM_UNCERTIFIED) == 2
    (audit,) = (tmp_path / "audit").rglob("summary.json")
    summary = json.loads(audit.read_text())
    assert summary["certified"] is False
    assert summary["certification_reason"] == g.MICROCOSM_UNCERTIFIED
    assert validate_public(tmp_path / "out") == []


def test_explicit_efrs_data_keeps_its_route_on_a_microcosm_bundle(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    # The fixture builds an in-memory household simulation for this path.
    # An explicit eFRS file must not resolve the bundle's default dataset.
    monkeypatch.setattr(g, "_bundle_dataset", no_simulation)
    local = tmp_path / "efrs.h5"
    with h5py.File(local, "w"):
        pass
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", str(local)),
        bundle_efrs=False,
    )
    assert code == 0, printed
    assert (tmp_path / "out" / "regional.csv").is_file()
    assert "UNCERTIFIED" not in printed


def test_the_default_microcosm_bundle_refuses_efrs_before_simulation(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    # Pin 6.10.0's metadata so this also exercises the guard on 6.6.0.
    monkeypatch.setattr(
        g,
        "_bundle_dataset",
        lambda: ("microcosm_uk_2024_25", "policyengine/populace-uk-private"),
    )
    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        bundle_efrs=False,
    )
    assert code == 1
    assert "installed bundle defaults to microcosm_uk_2024_25" in printed
    assert "PR #59" in printed
    assert printed.startswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.endswith(g.MICROCOSM_UNCERTIFIED)
    assert not (tmp_path / "out").exists()


def test_the_default_efrs_bundle_proceeds_without_a_microcosm_label(
    real_simulations, monkeypatch, tmp_path, capsys
):
    """6.6.0's enhanced-FRS default remains usable on either model."""
    from uk_budget_data.models import Reform

    enhanced_frs_bundle(monkeypatch)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        bundle_efrs=False,
    )
    assert code == 0, printed
    assert (tmp_path / "out" / "regional.csv").is_file()
    assert "UNCERTIFIED" not in printed


def pinned_bundle_dataset(monkeypatch, name, repository, inherit=False):
    """Metadata only, with the same repository fallback as bundle overlays."""
    release = SimpleNamespace(
        default_dataset=name,
        datasets={
            name: SimpleNamespace(repo_id=None if inherit else repository)
        },
        data_package=SimpleNamespace(repo_id=repository),
    )
    monkeypatch.setattr(g, "get_release_manifest", lambda country: release)


@pytest.mark.parametrize(
    "repository",
    [
        "policyengine/policyengine-uk-data",
        "policyengine/policyengine-uk-data-private",
    ],
)
@pytest.mark.parametrize("inherit", [False, True])
def test_named_efrs_accepts_public_or_private_uk_data(
    real_simulations, monkeypatch, tmp_path, capsys, repository, inherit
):
    """Named eFRS datasets may carry or inherit either uk-data repository."""
    from uk_budget_data.models import Reform

    name = "enhanced_frs_2024_25"
    pinned_bundle_dataset(monkeypatch, name, repository, inherit)
    assert g._bundle_dataset(name) == (name, repository)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", name),
        bundle_efrs=False,
    )
    assert code == 0, printed
    assert (tmp_path / "out" / "regional.csv").is_file()
    assert "UNCERTIFIED" not in printed


def test_installed_efrs_dataset_and_overlay_resolve_without_loading_data():
    """On 6.10.0 the eFRS name is an overlay; on 6.6.0 it is certified."""
    assert g._bundle_dataset("enhanced_frs_2024_25") == (
        "enhanced_frs_2024_25",
        "policyengine/policyengine-uk-data-private",
    )
    assert g._bundle_dataset("populace_uk_2023") == (
        "populace_uk_2023",
        "policyengine/populace-uk-private",
    )


@pytest.mark.parametrize("named", [False, True])
def test_efrs_looking_name_from_another_repository_is_refused(
    real_simulations, monkeypatch, tmp_path, capsys, named
):
    """A name alone cannot establish that uk-data built an enhanced FRS."""
    from uk_budget_data.models import Reform

    name = "enhanced_frs_2024_25"
    pinned_bundle_dataset(monkeypatch, name, "another-owner/another-dataset")
    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", name) if named else (),
        bundle_efrs=False,
    )
    assert code == 1
    assert "another-owner/another-dataset" in printed
    assert "policyengine/policyengine-uk-data or" in printed
    assert "policyengine/policyengine-uk-data-private" in printed
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("name", ["microcosm_uk_2024_25", "populace_uk_2023"])
def test_named_microcosm_data_through_efrs_is_refused_and_labelled(
    real_simulations, monkeypatch, tmp_path, capsys, name
):
    """Both the dataset name and its repository identify Microcosm data."""
    from uk_budget_data.models import Reform

    pinned_bundle_dataset(
        monkeypatch, name, "policyengine/populace-uk-private"
    )
    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", name),
        bundle_efrs=False,
    )
    assert code == 1
    assert name in printed
    assert "PR #59" in printed
    assert printed.startswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.endswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.count(g.MICROCOSM_UNCERTIFIED) == 2
    assert not (tmp_path / "out").exists()


def test_bundle_names_take_precedence_over_local_files(
    real_simulations, monkeypatch, tmp_path, capsys
):
    """A local namesake cannot hide the dataset the engine would load."""
    from uk_budget_data.models import Reform

    name = "microcosm_uk_2024_25"
    pinned_bundle_dataset(
        monkeypatch, name, "policyengine/populace-uk-private"
    )
    monkeypatch.chdir(tmp_path)
    with h5py.File(name, "w"):
        pass
    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", name),
        bundle_efrs=False,
    )
    assert code == 1
    assert "PR #59" in printed
    assert printed.count(g.MICROCOSM_UNCERTIFIED) == 2


def test_unknown_named_dataset_is_refused_before_simulation(
    real_simulations, monkeypatch, tmp_path, capsys
):
    """A name absent from the installed bundle cannot take the local route."""
    from uk_budget_data.models import Reform

    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", "unknown_dataset"),
        bundle_efrs=False,
    )
    assert code == 1
    assert "has no UK dataset 'unknown_dataset'" in printed
    assert not (tmp_path / "out").exists()


def test_local_microcosm_export_through_efrs_is_refused_and_labelled(
    real_simulations, monkeypatch, tmp_path, capsys
):
    """The export marker closes the local-file route regardless of its name."""
    from uk_budget_data.models import Reform

    local = tmp_path / "enhanced_frs.h5"
    with h5py.File(local, "w") as handle:
        handle.attrs[g.MICROCOSM_EXPORT_ATTRIBUTE] = "household"
    monkeypatch.setattr(g, "build_microsimulation", no_simulation)
    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [Reform(id="alpha", name="Alpha")],
        extra=("--dataset", str(local)),
    )
    assert code == 1
    assert "efrs refuses a Microcosm export" in printed
    assert "PR #59" in printed
    assert printed.startswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.endswith(g.MICROCOSM_UNCERTIFIED)
    assert printed.count(g.MICROCOSM_UNCERTIFIED) == 2
    assert not (tmp_path / "out").exists()


def refused(printed):
    return [
        part.split(":")[0].strip()
        for part in printed.split(REFUSED + ": ")[1:]
    ]


def sdlt_priced_on_purchases(sim):
    """A limit that shows only in a formula: SDLT priced on second-home
    purchases."""
    from uk_budget_data.measure_templates import _replace_formula

    def formula(household, period, parameters):
        return household(PURCHASES, period) * 0.05

    _replace_formula(sim, "sdlt_on_residential_property_transactions", formula)
    return sim


def council_tax_on_purchases_from_2028(sim):
    """Council tax charged on second-home purchases, read only from 2028, so
    a watch over the first year alone would miss it. Council tax's own
    formula reads nothing limited, and the input's name is decoded as the
    formula runs, so nothing in 2027 gives it away: only watching 2028
    does."""
    from uk_budget_data.measure_templates import _replace_formula

    def formula(household, period, parameters):
        import codecs

        if period.start.year >= 2028:
            name = codecs.decode(HIDDEN_PURCHASES, "rot13")
            return household(name, period) * 0.05
        return household.empty_array()

    _replace_formula(sim, "council_tax", formula)
    return sim


def test_a_limit_only_in_a_formula_is_refused_on_real_simulations(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [
            Reform(
                id="f", name="f", simulation_modifier=sdlt_priced_on_purchases
            )
        ],
    )
    assert code == 1
    assert refused(printed) == ["f"], printed
    assert not (tmp_path / "out").exists()


def test_a_limit_read_only_in_a_later_year_is_refused(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    code, printed = geography_command(
        monkeypatch,
        tmp_path,
        capsys,
        [
            Reform(
                id="late",
                name="late",
                simulation_modifier=council_tax_on_purchases_from_2028,
            )
        ],
        years=("2027", "2028"),
    )
    assert code == 1
    assert refused(printed) == ["late"], printed


def test_a_limit_read_only_while_the_measure_is_built_is_refused(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from tests import fixed_shape_measures
    from uk_budget_data.models import Reform

    reform = Reform(
        id="b",
        name="b",
        simulation_modifier=fixed_shape_measures.sdlt_from_purchases_read_at_build,
    )
    code, printed = geography_command(monkeypatch, tmp_path, capsys, [reform])
    assert code == 1
    assert refused(printed) == ["b"], printed


def test_a_package_including_a_limited_measure_is_refused(
    real_simulations, monkeypatch, tmp_path, capsys
):
    from uk_budget_data.models import Reform

    both = {INCOME_TAX_RATE: {"2027": 0.21}, SURCHARGE_RATE: {"2027": 0.07}}
    reforms = [
        Reform(id="pkg", name="pkg", parameter_changes=both),
        Reform(
            id="a",
            name="a",
            parameter_changes={INCOME_TAX_RATE: {"2027": 0.21}},
        ),
        Reform(
            id="b",
            name="b",
            parameter_changes={SURCHARGE_RATE: {"2027": 0.07}},
        ),
    ]
    code, printed = geography_command(
        monkeypatch, tmp_path, capsys, reforms, packages={"pkg": ("a", "b")}
    )
    assert code == 1
    assert refused(printed) == ["pkg", "b"], printed


@pytest.mark.parametrize(
    "name", ["property_modifier", "vat_modifier", "payment_modifier"]
)
def test_a_template_measure_is_not_refused_on_real_simulations(
    real_simulations, monkeypatch, tmp_path, capsys, name
):
    """No false refusal: without the run watch, or with its sides swapped,
    a template measure would be refused or the run would stop. The model
    limits stay active for the other templates, so the area run's own
    model-limit check is shown not to refuse them; for the VAT base
    template they are set aside, since a model limit holds it until
    policyengine-uk #2187 (tests/test_vat_model_limit.py)."""
    from tests import template_measures
    from uk_budget_data import model_limits
    from uk_budget_data.models import Reform

    if name == "vat_modifier":
        monkeypatch.setattr(model_limits, "MODEL_LIMITS", ())
    reform = Reform(
        id="tpl",
        name="tpl",
        simulation_modifier=getattr(template_measures, name),
    )
    code, printed = geography_command(monkeypatch, tmp_path, capsys, [reform])
    assert REFUSED not in printed, printed
    assert "Estimating and checking" in printed, printed


def test_each_pair_of_simulations_is_freed_before_the_next_is_built(
    real_simulations, monkeypatch, tmp_path, capsys
):
    """#76's review: the observation holds both simulations, so keeping it
    kept the previous pair alive while the next was built (up to four
    microsimulations at once on certified data)."""
    import gc
    import weakref

    from uk_budget_data.models import Reform

    built = []
    simulate = g.simulate_reform

    def simulate_and_check(reform, dataset, years):
        gc.collect()
        alive = [ref for ref in built if ref() is not None]
        assert not alive, f"{len(alive)} earlier simulation(s) still alive"
        pair = simulate(reform, dataset, years)
        built.extend(weakref.ref(sim) for sim in pair)
        return pair

    monkeypatch.setattr(g, "simulate_reform", simulate_and_check)
    reforms = [
        Reform(
            id=f"r{rate}",
            name=f"r{rate}",
            parameter_changes={INCOME_TAX_RATE: {"2027": rate}},
        )
        for rate in (0.21, 0.22)
    ]
    code, printed = geography_command(monkeypatch, tmp_path, capsys, reforms)
    assert "earlier simulation" not in printed, printed
    assert len(built) == 4
    assert "Estimating and checking" in printed, printed
