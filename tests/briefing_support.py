"""Receipted random briefing rows in the publication core's synthetic World."""

import random

from tests.publication_support import RATE_PATH, make_tables
from uk_budget_data.models import DataConfig, Reform, ReformResult
from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.generate import generate_artifacts
from uk_budget_data.publication.publish import approve, stage

CATEGORIES = (
    "gain_more_5",
    "gain_less_5",
    "no_change",
    "lose_less_5",
    "lose_more_5",
)
COMBINED_KEY = "combined--alpha+beta"


def briefing_tables(key, years, seed=1):
    """Complete tables with fresh values, including every poverty series."""
    rng = random.Random(seed)
    tables = make_tables(key, {year: 1 + rng.random() for year in years})
    for row in tables["distributional_impact"]:
        row["value"] = rng.uniform(-10, 10)
    for row in tables["winners_losers"]:
        row["avg_change"] = rng.uniform(-3000, 3000)
    tables["briefing_deciles"] = []
    tables["briefing_winners_losers"] = []
    tables["briefing_poverty"] = []
    tables["constituency"] = []
    for year in years:
        base = {"reform_id": key, "year": year}
        for decile in ["all", *(str(n) for n in range(1, 11))]:
            tables["briefing_deciles"].append(
                {**base, "decile": decile, "avg_change_gbp": rng.uniform(-5000, 5000)}
            )
            weights = [rng.uniform(0.1, 100) for _ in CATEGORIES]
            for category, weight in zip(CATEGORIES, weights):
                tables["briefing_winners_losers"].append(
                    {**base, "decile": decile, "category": category, "share_pct": weight / sum(weights) * 100}
                )
        for measure in ("absolute", "relative"):
            for housing in ("bhc", "ahc"):
                for group in ("overall", "child", "working_age", "pensioner"):
                    baseline = rng.uniform(5, 40)
                    change = rng.uniform(-4, 4)
                    tables["briefing_poverty"].append(
                        {**base, "measure": measure, "housing": housing, "group": group, "baseline_rate_pct": baseline, "reform_rate_pct": baseline + change, "change_pp": change}
                    )
        for number in range(3):
            tables["constituency"].append(
                {**base, "constituency_code": f"E{number:08d}", "constituency_name": f"Test constituency {number}", "average_gain": rng.uniform(-5000, 5000), "relative_change": rng.uniform(-10, 10)}
            )
    return tables


def approved_world(world, seed=1, years=(2027, 2028), *, tables_by_key=None):
    """Generate/stage/approve two members and their combined artifact."""
    years = list(years)
    reforms = [
        Reform(id="alpha", name="Alpha", parameter_changes={RATE_PATH: {str(y): 0.21 for y in years}}),
        Reform(id="beta", name="Beta", parameter_changes={"gov.hmrc.income_tax.rates.uk[1].rate": {str(y): 0.41 for y in years}}),
    ]
    tables_by_key = tables_by_key or {
        key: briefing_tables(key, years, seed + index)
        for index, key in enumerate(("alpha", "beta", COMBINED_KEY))
    }

    def process(reform, config, baseline, reformed):
        return ReformResult(
            reform_id=reform.id,
            reform_name=reform.name,
            demographic_constituency=[],
            **tables_by_key[reform.id],
        )

    # No global monkeypatch: generation captures a clean, synthetic revision
    # only for this call, then every actual artifact/manifest gate is run.
    from unittest.mock import patch

    with patch("uk_budget_data.publication.generate.code_revision", return_value=world.revision()):
        report = generate_artifacts(
            reforms,
            DataConfig(years=years),
            combined_sets=[reforms],
            artifacts_root=world.artifacts,
            generator_argv=["synthetic briefing test"],
            build=lambda dataset, scenario=None: world.sim(),
            process=process,
        )
    assert report.refused == {}
    manifest = m.Manifest()
    arguments = {"data_root": world.data_root, "inputs": world.inputs}
    for reference in report.written:
        if reference.key != COMBINED_KEY:
            values = {row["year"]: row["value"] for row in tables_by_key[reference.key]["budgetary_impact"]}
            world.costing(reference.key, values)
            world.reconcile(reference)
        stage(manifest, reference.path, **arguments)
        approve(manifest, reference.key, "Briefing tester", **arguments)
    m.save_manifest(manifest, world.data_root)
    return manifest, tables_by_key
