"""Export the Budget's official costings for the page's comparison.

The Public finances card can show, beside each measure's PolicyEngine
figure, the official costing of the same measure: HM Treasury's figures,
certified by the OBR. Those figures are entered once, for the
reconciliation gate, in ``data_inputs/treasury`` (``sources/*.csv`` and
``mapping.csv``), which the page cannot read. This writes the same sums the
gate compares, for both bases, to ``public/data/official_costings.json``::

    uv run python -m uk_budget_data.publication.official_costings

Each figure is ``reconcile._comparator`` for that measure, year and basis,
so the page shows exactly the comparator the gate used: several mapped
rows summed, with their reviewed scale and year offset, and nothing while
any mapped row is still blank. Measures every row of which a reviewer
classified ``not_comparable`` are left out. A year in which a reviewer
classified every mapped row not comparable (``not_comparable_years`` in
``mapping.csv``) has no figure on either basis and says why::

    "2030": {"static_costing": null, "post_behavioural": null,
             "not_comparable": {"reason": "..."}}

The file names the manifest's release and Budget, and only the manifest's
measure keys. The page refuses it for any other Budget, and joins it only
to measures whose own figures verified, so no costing from another Budget
can sit beside this one's figures (the reason ``obr_comparison.csv`` is not
bound). It holds no PolicyEngine figure. It does not name the manifest's
revision: the official figures do not depend on ours, so restaging a
measure does not make them stale. A file under ``public/`` needs a review
row like any other.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from uk_budget_data.publication import manifest as m
from uk_budget_data.publication.reconcile import (
    BASES,
    NOT_COMPARABLE,
    ReconciliationInputError,
    _comparator,
    _one_mapping_each,
    _one_source_each,
    excluded_links,
    load_mapping,
    load_sources,
)

SCHEMA = "uk-budget-official-costings/v1"
OUTPUT_FILE = "official_costings.json"
INPUTS = Path("data_inputs/treasury")


def official_costings(manifest: m.Manifest, sources, mapping) -> dict:
    """The official costing of each manifest measure, by year and basis.

    A year with no complete comparator on a basis is null on that basis; a
    year a reviewer classified not comparable is null on both, with the
    reason; a measure with neither is left out.
    """
    _one_source_each(sources)
    _one_mapping_each(mapping)
    measures = {}
    for key in sorted(manifest.measures):
        links = [link for link in mapping if link.measure_id == key]
        if not any(link.status != NOT_COMPARABLE for link in links):
            continue
        entry = manifest.measures[key]
        years = {}
        for year in sorted(entry.years):
            out = excluded_links(links, year)
            if len(out) == len(links):
                years[str(year)] = {
                    **{basis: None for basis in BASES},
                    "not_comparable": {
                        "reason": "; ".join(
                            dict.fromkeys(link.reason for link in out)
                        )
                    },
                }
                continue
            figures = {
                basis: _comparator(key, year, basis, sources, mapping).value_bn
                for basis in BASES
            }
            if any(value is not None for value in figures.values()):
                years[str(year)] = figures
        if any("not_comparable" not in figures for figures in years.values()):
            measures[key] = {"years": years}
    return {
        "schema": SCHEMA,
        "release": manifest.release,
        "budget": dict(manifest.budget),
        "sign_convention": "exchequer_positive",
        "measures": measures,
    }


def write_official_costings(
    data_root: Path = m.DATA_ROOT, inputs: Path = INPUTS
) -> Path:
    if not m.manifest_path(data_root).exists():
        raise ReconciliationInputError(
            f"no manifest in {data_root}: stage the measures first"
        )
    manifest = m.load_manifest(data_root)
    document = official_costings(
        manifest,
        load_sources(inputs / "sources"),
        load_mapping(inputs / "mapping.csv"),
    )
    path = data_root / OUTPUT_FILE
    path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    return path


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m uk_budget_data.publication.official_costings",
        description=(
            "Write public/data/official_costings.json from the Treasury "
            "inputs the reconciliation gate reads."
        ),
    )
    parser.add_argument("--data-root", type=Path, default=m.DATA_ROOT)
    parser.add_argument("--inputs", type=Path, default=INPUTS)
    args = parser.parse_args(argv)
    try:
        path = write_official_costings(args.data_root, args.inputs)
    except (ReconciliationInputError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    document = json.loads(path.read_text())
    print(
        f"wrote {path}: official costings for "
        f"{len(document['measures'])} measure(s)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
