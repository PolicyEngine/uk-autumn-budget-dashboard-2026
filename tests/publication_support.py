"""A small publication world for tests: no dataset, real receipt logic.

The receipts are built by policyengine's own receipt code. To get certified
receipts without the private dataset, the bundle manifest policyengine reads
is replaced by a copy that certifies a tiny dummy file, so certification is
still decided by bytes and versions exactly as in production.
"""

import copy
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace

import policyengine.provenance.certification as certification
import pytest
from policyengine_uk.utils.scenario import Scenario

from uk_budget_data.certified_data import load_bundle_manifest
from uk_budget_data.example_households import EXAMPLE_HOUSEHOLDS
from uk_budget_data.publication import receipt as receipt_module
from uk_budget_data.publication.artifacts import (
    RECEIPT_FILE,
    table_files,
    write_artifact,
)
from uk_budget_data.publication.receipt import (
    artifact_sha256,
    projection_end_year,
)
from uk_budget_data.publication.reconcile import reconcile_artifact
from uk_budget_data.publication.tables import sha256_bytes
from uk_budget_data.publication.validate import DECILES, WINNERS_GROUPS

# The installed bundle's certified default dataset. Read from the bundle, so
# the fixtures follow its data line (policyengine-uk-data's enhanced FRS
# until 6.10.0, Microcosm since).
_UK_RELEASE = load_bundle_manifest()["data_releases"]["uk"]
DATASET_NAME = _UK_RELEASE["default_dataset"]

# A small dataset the bundle pins but does not certify, for real runs whose
# receipts must stay uncertified: policyengine-uk-data's tiny enhanced FRS.
# Until 6.10.0 it is one of the release's datasets; from 6.10.0 it is an
# overlay, still in policyengine-uk-data-private, so the certified-data job's
# token must read that repository too. CI's access check names it with
# --also, and test_certified_data keeps the two in step.
SMALL_DATASET_NAME = "enhanced_frs_2024_25_tiny"


def other_dataset_name() -> str:
    """Another dataset the bundle names beside its certified default.

    A receipt for it is uncertified, which is how the tests check that only
    the default publishes. Only an ``.h5`` variant of the default's name
    counts (``enhanced_frs_2024_25_tiny`` until 6.10.0,
    ``microcosm_uk_2024_25_dense`` since): weights, calibration and
    diagnostics files are not datasets. A bundle without one fails the tests
    that need it, not every test that imports this module.
    """
    names = sorted(
        name
        for name, entry in _UK_RELEASE["datasets"].items()
        if name != DATASET_NAME
        and name.startswith(DATASET_NAME)
        and entry["path"].endswith(".h5")
    )
    if not names:
        pytest.fail(
            f"the installed bundle names no .h5 variant of its default "
            f"dataset {DATASET_NAME!r}; choose another stand-in for an "
            "uncertified dataset"
        )
    return names[0]


BASIS = {
    "forecast": {"status": "pre_budget", "source": "test", "vintage": "v1"},
    "calibration": {"status": "pre_budget", "source": "test", "vintage": "v1"},
}
# The installed model's horizon: 2030 on policyengine-uk 2.126.12, 2032 from
# 2.130.1. The gate requires dataset years to run to it.
PROJECTION_END = projection_end_year()
DATASET_YEARS = list(range(2024, PROJECTION_END + 1))
YEARS = [2027, 2028]
RATE_PATH = "gov.hmrc.income_tax.rates.uk[0].rate"
SOURCE_HEADER = (
    "source_id,document,table,row_id,row_label,fiscal_year,value_bn,basis,"
    "sign_convention,head,notes\n"
)


def default_name(key: str) -> str:
    """The display name World gives a key's tables and receipt."""
    return key.replace("_", " ").title()


def make_tables(
    key: str, values: dict[int, float], name: str = None
) -> dict[str, list[dict]]:
    """A complete, valid set of tables whose fiscal impact is ``values``."""
    name = name or default_name(key)
    tables = {
        "budgetary_impact": [],
        "distributional_impact": [],
        "winners_losers": [],
        "metrics": [],
        "income_curve": [],
        "household_scatter_binned": [],
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
        for household in EXAMPLE_HOUSEHOLDS:
            for income in household.grid():
                tables["income_curve"].append(
                    {
                        **base,
                        "household": household.id,
                        "x_variable": household.x_variable,
                        "income": income,
                        "baseline_net_income": income * 0.7,
                        "reform_net_income": income * 0.7 + value,
                    }
                )
        tables["household_scatter_binned"].append(
            {
                **base,
                "income_band": 20000.0,
                "change_band": -75.0 if value < 0 else 50.0,
                "change_band_upper": -50.0 if value < 0 else 75.0,
                "households": 1000.0,
                "income_basis_year": min(values),
            }
        )
    return tables


def make_household_rows(
    key: str, values: dict[int, float], name: str = None
) -> list[dict]:
    """Household-level scatter rows that bin to make_tables' scatter cells."""
    name = name or default_name(key)
    return [
        {
            "reform_id": key,
            "reform_name": name,
            "year": year,
            "baseline_income": 20_100.0,
            "income_change": -50.0 if value < 0 else 50.0,
            "household_weight": 100.0,
            "household_id": household,
            "reference_income": 20_100.0,
            "income_basis_year": min(values),
        }
        for year, value in values.items()
        for household in range(1, 11)
    ]


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

        self._dataset = self.root / f"{DATASET_NAME}.h5"
        self._dataset.write_bytes(b"dummy certified dataset")
        self.bundle = self._bundle_for(self._dataset)
        (self.root / "manifest.json").write_text(json.dumps(self.bundle))
        self._patch()

    @classmethod
    def attach(cls, root) -> "World":
        """The World another process made at ``root``, patched into this
        one: a worker process (``--jobs``) shares none of the test
        process's patches, so it builds its receipts against the same
        bundle and dataset this way. Only that process's exit undoes it."""
        instance = cls.__new__(cls)
        instance.root = Path(root)
        instance.data_root = instance.root / "public" / "data"
        instance.artifacts = instance.data_root / "artifacts"
        instance.inputs = instance.root / "treasury"
        instance._dataset = instance.root / f"{DATASET_NAME}.h5"
        instance.bundle = json.loads(
            (instance.root / "manifest.json").read_text()
        )
        instance._patch()
        return instance

    def _patch(self):
        """Point policyengine's receipt code at this World's bundle."""
        self._original_path = certification.default_bundle_source_path
        self._original_loader = receipt_module.load_bundle_manifest
        certification.default_bundle_source_path = lambda: (
            self.root / "manifest.json"
        )
        receipt_module.load_bundle_manifest = lambda: self.bundle
        # The receipt code projects the dataset itself to find the years it
        # supports; the dummy dataset is not a real one, so stand in with
        # the years World's simulations report.
        self._receipt_api, _ = receipt_module.receipt_api()
        self._original_projection = getattr(
            self._receipt_api, "_projected_years", None
        )
        if self._original_projection is not None:
            self._receipt_api._projected_years = lambda *args: tuple(
                DATASET_YEARS
            )

    def close(self):
        if self._original_projection is not None:
            self._receipt_api._projected_years = self._original_projection
        certification.default_bundle_source_path = self._original_path
        receipt_module.load_bundle_manifest = self._original_loader
        shutil.rmtree(self.root, ignore_errors=True)

    @staticmethod
    def commit_attestation(path: Path) -> None:
        """Commit only one review input in its temporary, local Git repo.

        Never reuse a worktree's external Git metadata or stage datasets
        and generated artifacts beside the review input.
        """
        path = Path(path).resolve()
        directory = path.parent
        metadata = directory / ".git"
        if metadata.is_symlink() or (
            metadata.exists() and not metadata.is_dir()
        ):
            raise ValueError("attestation tests require local Git metadata")
        environment = {
            name: value
            for name, value in os.environ.items()
            if not name.startswith("GIT_")
        }

        def git(*arguments):
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(directory),
                    "-c",
                    "user.name=Attestation tests",
                    "-c",
                    "user.email=attestations@example.invalid",
                    "-c",
                    "commit.gpgSign=false",
                    "-c",
                    "core.hooksPath=/dev/null",
                    *arguments,
                ],
                check=True,
                capture_output=True,
                env=environment,
            )

        if not metadata.exists():
            git("init")
        git("add", "--", path.name)
        git(
            "commit",
            "--only",
            "--allow-empty",
            "-m",
            "Commit attestation test input",
            "--",
            path.name,
        )

    @staticmethod
    def _bundle_for(dataset: Path) -> dict:
        digest = hashlib.sha256(dataset.read_bytes()).hexdigest()
        bundle = copy.deepcopy(load_bundle_manifest())
        release = bundle["data_releases"]["uk"]
        release["certified_data_artifact"]["sha256"] = digest
        release["datasets"][DATASET_NAME]["sha256"] = digest
        return bundle

    # --- simulations and receipts ------------------------------------

    def sim(
        self,
        dataset: Path = None,
        years=DATASET_YEARS,
        dataset_name: str = DATASET_NAME,
    ):
        """A stand-in simulation carrying what the receipt builder reads.

        Like policyengine's materializer, it records the dataset's hash when
        the simulation is built.
        """
        source = Path(dataset or self._dataset)
        return SimpleNamespace(
            policyengine_bundle={
                "runtime_dataset_source": str(source),
                "runtime_dataset_sha256": hashlib.sha256(
                    source.read_bytes()
                ).hexdigest(),
                "country_id": "uk",
                "runtime_dataset": dataset_name,
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
        member_outputs=None,
        dataset_name: str = DATASET_NAME,
        reform_identity=None,
        baseline_identity=None,
        config_baseline=None,
        data_limits=(),
        model_limits=(),
        name=None,
        with_tables=None,
        modifier_templates=None,
    ):
        """Generate an artifact for ``key`` with the given fiscal impact.

        With ``members`` (records of id, reform and baseline identities),
        the artifact is a combined run: its identities are the members'
        composition, as ``receipt.combined_identities`` builds them, unless
        ``reform_identity`` is given to test a receipt that is not.

        The receipt records ``name`` (by default the tables' own, or the
        key's default name). An artifact recording a data limit is
        receipt-only, as generation writes it; ``with_tables=True`` writes
        one with its tables anyway, as generation did before, to test that
        the gates refuse it.
        """
        revision = self.revision(clean)
        scenario = Scenario(
            parameter_changes={
                RATE_PATH: {str(y): rate for y in sorted(values)}
            }
        )
        baseline_identity = (
            baseline_identity
            or receipt_module.scenario_identity(
                None, name=f"{key} baseline", revision=revision
            )
        )
        composition = None
        requested_config_baseline, config_baseline = config_baseline, None
        if members:
            members, composition, composed = self._compose(members)
            baseline_identity, composed_reform = composed
            reform_identity = reform_identity or composed_reform
            config_baseline = receipt_module.receipt_api()[
                0
            ].ReformIdentity.model_validate(
                requested_config_baseline or World.configured_baseline()
            )
        reform_identity = reform_identity or receipt_module.scenario_identity(
            scenario, name=key, revision=revision
        )
        if modifier_templates is None:
            counts = receipt_module.template_proof.modifier_counts(
                {
                    "dashboard": {"members": members},
                    "execution_receipt": {
                        "baseline": json.loads(
                            baseline_identity.model_dump_json()
                        ),
                        "reform": json.loads(
                            reform_identity.model_dump_json()
                        ),
                    },
                }
            )
            modifier_templates = {
                side: [None] * count for side, count in counts.items()
            }
        inputs = dict(
            key=key,
            measure_ids=measure_ids or [key],
            years=sorted(values),
            baseline_identity=baseline_identity,
            reform_identity=reform_identity,
            basis=BASIS,
            revision=revision,
            members=members,
            member_outputs=member_outputs,
            composition=composition,
            config_baseline_identity=config_baseline,
            data_limits=list(data_limits),
            model_limits=list(model_limits),
            modifier_templates=modifier_templates,
            generator_argv=["test"],
        )
        if name is None:
            rows = (tables or {}).get("budgetary_impact") or []
            name = rows[0]["reform_name"] if rows else default_name(key)
        inputs["name"] = name
        sim = self.sim(dataset, dataset_years, dataset_name)

        def build(file_digests):
            return receipt_module.build_receipt_document(
                sim,
                sim,
                receipt_module.ReceiptInputs(
                    file_digests=file_digests, **inputs
                ),
            )

        if with_tables is None:
            with_tables = not data_limits
        tables = tables or make_tables(key, values, name)
        if with_tables and data_limits:
            return self._write_with_tables(tables, key, build)
        return write_artifact(
            tables if with_tables else None, key, build, self.artifacts
        )

    def _write_with_tables(self, tables, key, build):
        """Write a data-limited artifact holding its tables, as generation
        did before not-computable artifacts became receipt-only, which
        ``write_artifact`` now refuses to write."""
        files = table_files(tables, key)
        document = build(
            {name: sha256_bytes(data) for name, data in files.items()}
        )
        target = self.artifacts / key / artifact_sha256(document)[:16]
        target.mkdir(parents=True)
        for name, data in files.items():
            (target / name).write_bytes(data)
        (target / RECEIPT_FILE).write_text(
            json.dumps(document, indent=2, sort_keys=True) + "\n"
        )
        digests = document["dashboard"]["digests"]
        return SimpleNamespace(
            key=key,
            path=target,
            outputs_sha256=digests["outputs_sha256"],
            artifact_sha256=artifact_sha256(document),
        )

    @staticmethod
    def configured_baseline() -> dict:
        """The configured baseline World's combined runs record: current
        law, as generate records a config with no baseline changes."""
        api, _ = receipt_module.receipt_api()
        return json.loads(
            api.reform_identity(
                None, None, name="configured baseline"
            ).model_dump_json()
        )

    @staticmethod
    def _compose(records):
        """Compose member records the way combined_identities does: every
        reform in order, and each distinct baseline once."""
        api, _ = receipt_module.receipt_api()
        records = [dict(record) for record in records]
        # As combined_identities: a member on the configured baseline
        # (current law here) shares it, applied once; a member with its own
        # baseline has it applied.
        configured = World.configured_baseline()
        configured_core = {k: v for k, v in configured.items() if k != "name"}
        configured_bound = False
        for record in records:
            core = {k: v for k, v in record["baseline"].items() if k != "name"}
            shared = core == configured_core
            record.setdefault(
                "baseline_bound", not shared or not configured_bound
            )
            configured_bound |= shared and record["baseline_bound"]
        composition = {
            "reform_applied_before_data_load": False,
            "baseline_applied_before_data_load": False,
        }
        name = "+".join(record["id"] for record in records)
        composed = (
            api.composed_reform_identity(
                [
                    api.ReformIdentity.model_validate(record["baseline"])
                    for record in records
                    if record["baseline_bound"]
                ],
                applied_before_data_load=False,
                name=f"{name} baseline",
            ),
            api.composed_reform_identity(
                [
                    api.ReformIdentity.model_validate(record["reform"])
                    for record in records
                ],
                applied_before_data_load=False,
                name=name,
            ),
        )
        return records, composition, composed

    def register(self, dataset_name: str, dataset: Path):
        """Name ``dataset``'s bytes in the bundle as ``dataset_name``.

        A dataset other than the bundle's certified default yields an
        uncertified receipt: the way to test what the gates do with one.
        """
        digest = hashlib.sha256(dataset.read_bytes()).hexdigest()
        release = self.bundle["data_releases"]["uk"]
        release["datasets"][dataset_name]["sha256"] = digest
        (self.root / "manifest.json").write_text(json.dumps(self.bundle))

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
        """A reviewed exception naming the Treasury comparison as it stands,
        as a reviewer copies comparator.sha256 from reconciliation.json."""
        from uk_budget_data.publication.reconcile import (
            comparison_sha256,
            load_mapping,
            load_policy,
            load_sources,
        )

        comparator = comparison_sha256(
            measure,
            year,
            load_sources(self.inputs / "sources"),
            load_mapping(self.inputs / "mapping.csv"),
            load_policy(self.inputs / "policy.yaml"),
        )
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
                "comparator_sha256": comparator or "c" * 64,
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
