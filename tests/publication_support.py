"""A small publication world for tests: no dataset, real receipt logic.

The receipts are built by policyengine's own receipt code. To get certified
receipts without the private dataset, the bundle manifest policyengine reads
is replaced by a copy that certifies a tiny dummy file, so certification is
still decided by bytes and versions exactly as in production.
"""

import copy
import hashlib
import json
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

import policyengine.provenance.certification as certification
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.certified_data import load_bundle_manifest
from uk_budget_data.publication import receipt as receipt_module
from uk_budget_data.publication.artifacts import write_artifact
from uk_budget_data.publication.reconcile import reconcile_artifact
from uk_budget_data.publication.tables import (
    SCATTER_SAMPLE_PER_MILLE,
    in_scatter_sample,
)
from uk_budget_data.publication.validate import DECILES, WINNERS_GROUPS

BASIS = {
    "forecast": {"status": "pre_budget", "source": "test", "vintage": "v1"},
    "calibration": {"status": "pre_budget", "source": "test", "vintage": "v1"},
}
DATASET_YEARS = list(range(2024, 2031))
YEARS = [2027, 2028]
RATE_PATH = "gov.hmrc.income_tax.rates.uk[0].rate"
SOURCE_HEADER = (
    "source_id,document,table,row_id,row_label,fiscal_year,value_bn,basis,"
    "sign_convention,head,notes\n"
)


# Household ids that fall in the published scatter sample.
SAMPLED_HOUSEHOLDS = [
    household
    for household in range(1, 5000)
    if in_scatter_sample(household, SCATTER_SAMPLE_PER_MILLE)
][:3]


def module_level_modifier(sim, rate=0.21):
    """A structural measure written the way receipts can bind it.

    It lives here, not in a test module: pytest rewrites test modules'
    assertions on import, and the receipt refuses to bind a function whose
    loaded code no longer matches its source file.
    """
    return sim


def make_tables(key: str, values: dict[int, float]) -> dict[str, list[dict]]:
    """A complete, valid set of tables whose fiscal impact is ``values``."""
    name = key.replace("_", " ").title()
    tables = {
        "budgetary_impact": [],
        "distributional_impact": [],
        "winners_losers": [],
        "metrics": [],
        "income_curve": [],
        "household_scatter": [],
    }
    for year, value in values.items():
        base = {"reform_id": key, "reform_name": name, "year": year}
        tables["budgetary_impact"].append({**base, "value": value})
        tables["metrics"].append(
            {
                **base,
                "people_affected": 10.0 + value,
                "gini_change": value / 100,
                "poverty_change_pp": value / 10,
                "poverty_change_pct": value,
            }
        )
        for decile in sorted(DECILES):
            tables["distributional_impact"].append(
                {**base, "decile": decile, "value": value}
            )
        for group in sorted(WINNERS_GROUPS):
            tables["winners_losers"].append(
                {**base, "decile": group, "avg_change": value * 100}
            )
        for point in range(201):
            income = point * 750.0
            tables["income_curve"].append(
                {
                    **base,
                    "employment_income": income,
                    "baseline_net_income": income * 0.7,
                    "reform_net_income": income * 0.7 + value,
                }
            )
        for household in SAMPLED_HOUSEHOLDS:
            tables["household_scatter"].append(
                {
                    **base,
                    "baseline_income": 20000.0 + household,
                    "income_change": value,
                    "household_weight": 1000.0,
                    "household_id": household,
                }
            )
    return tables


class World:
    """Temporary data root, Treasury inputs and patched bundle."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="publication-"))
        self.data_root = self.root / "public" / "data"
        self.artifacts = self.data_root / "artifacts"
        self.inputs = self.root / "treasury"
        (self.inputs / "sources").mkdir(parents=True)
        self._costings: dict[tuple[str, int], float] = {}
        self._mapped: set[str] = set()
        self._expected: list[str] = []
        self._write_inputs()

        self._dataset = self.root / "enhanced_frs_2024_25.h5"
        self._dataset.write_bytes(b"dummy certified dataset")
        self.bundle = self._bundle_for(self._dataset)
        (self.root / "manifest.json").write_text(json.dumps(self.bundle))
        self._original_path = certification.default_bundle_source_path
        self._original_loader = receipt_module.load_bundle_manifest
        certification.default_bundle_source_path = lambda: (
            self.root / "manifest.json"
        )
        receipt_module.load_bundle_manifest = lambda: self.bundle

    def close(self):
        certification.default_bundle_source_path = self._original_path
        receipt_module.load_bundle_manifest = self._original_loader
        shutil.rmtree(self.root, ignore_errors=True)

    @staticmethod
    def _bundle_for(dataset: Path) -> dict:
        digest = hashlib.sha256(dataset.read_bytes()).hexdigest()
        bundle = copy.deepcopy(load_bundle_manifest())
        release = bundle["data_releases"]["uk"]
        release["certified_data_artifact"]["sha256"] = digest
        release["datasets"]["enhanced_frs_2024_25"]["sha256"] = digest
        return bundle

    # --- simulations and receipts ------------------------------------

    def sim(self, dataset: Path = None, years=DATASET_YEARS):
        """A stand-in simulation carrying what the receipt builder reads."""
        return SimpleNamespace(
            policyengine_bundle={
                "runtime_dataset_source": str(dataset or self._dataset),
                "country_id": "uk",
                "runtime_dataset": "enhanced_frs_2024_25",
            },
            dataset=SimpleNamespace(years=list(years)),
        )

    def revision(self, clean=True, sha="a" * 40):
        return receipt_module.CodeRevision(
            sha, clean, () if clean else ("src/uk_budget_data/reforms.py",)
        )

    def write(
        self,
        key: str,
        values: dict[int, float],
        *,
        rate: float = 0.21,
        clean: bool = True,
        dataset: Path = None,
        dataset_years=DATASET_YEARS,
        members=None,
        measure_ids=None,
        tables=None,
    ):
        """Generate an artifact for ``key`` with the given fiscal impact."""
        revision = self.revision(clean)
        scenario = Scenario(
            parameter_changes={
                RATE_PATH: {str(y): rate for y in sorted(values)}
            }
        )
        inputs = dict(
            key=key,
            measure_ids=measure_ids or [key],
            years=sorted(values),
            baseline_identity=receipt_module.scenario_identity(
                None, name=f"{key} baseline", revision=revision
            ),
            reform_identity=receipt_module.scenario_identity(
                scenario, name=key, revision=revision
            ),
            basis=BASIS,
            revision=revision,
            members=members,
            generator_argv=["test"],
        )
        sim = self.sim(dataset, dataset_years)

        def build(file_digests):
            return receipt_module.build_receipt_document(
                sim,
                sim,
                receipt_module.ReceiptInputs(
                    file_digests=file_digests, **inputs
                ),
            )

        return write_artifact(
            tables or make_tables(key, values), key, build, self.artifacts
        )

    # --- Treasury inputs ----------------------------------------------

    def costing(self, measure: str, values: dict[int, float]):
        """Enter static costings for a measure and map it to them."""
        for year, value in values.items():
            self._costings[(measure, year)] = value
        self._mapped.add(measure)
        self._write_inputs()

    def expect(self, measure: str, direction: str, from_year: int):
        self._expected.append(f"{measure},{direction},{from_year},,Tester,")
        self._write_inputs()

    def exception(
        self, measure: str, year: int, residual: float, outputs: str
    ):
        path = self.inputs / "exceptions.yaml"
        entries = json.loads(path.read_text()) if path.exists() else []
        entries.append(
            {
                "measure_id": measure,
                "fiscal_year": f"{year}-{(year + 1) % 100:02d}",
                "residual_bn": residual,
                "explanation_class": "behavioural",
                "explanation": "The costing includes a behavioural yield.",
                "reviewer": "Reviewer",
                "accepted_at": "2026-10-28T15:00:00Z",
                "outputs_sha256": outputs,
            }
        )
        path.write_text(json.dumps(entries))  # JSON is valid YAML

    def _write_inputs(self):
        rows = [
            f"S,Budget,costings,{measure},{measure},"
            f"{year}-{(year + 1) % 100:02d},{value},static_costing,"
            "exchequer_positive,tax,\n"
            for (measure, year), value in sorted(self._costings.items())
        ]
        (self.inputs / "sources" / "S.csv").write_text(
            SOURCE_HEADER + "".join(rows)
        )
        (self.inputs / "mapping.csv").write_text(
            "measure_id,source_id,row_id,scale,year_offset,status,reason,"
            "reviewer\n"
            + "".join(f"{m},S,{m},,,,,\n" for m in sorted(self._mapped))
        )
        (self.inputs / "expected_effects.csv").write_text(
            "measure_id,direction,from_year,to_year,reviewer,note\n"
            + "".join(line + "\n" for line in self._expected)
        )

    def reconcile(self, reference) -> dict:
        """Run reconciliation for an artifact and write its result."""
        result = reconcile_artifact(reference.path, self.inputs)
        (reference.path / "reconciliation.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n"
        )
        return result

    def ready(self, key: str, values: dict[int, float], **kwargs):
        """An artifact whose costings match, reconciled and ready to stage."""
        self.costing(key, values)
        reference = self.write(key, values, **kwargs)
        self.reconcile(reference)
        return reference
