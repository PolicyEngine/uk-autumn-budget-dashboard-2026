"""The publication gate's projection end is the one the engine uses.

``publication.receipt.projection_end_year`` restates how policyengine-uk's
``extend_single_year_dataset`` picks the last year it projects a dataset
to; this checks the two agree, by running the engine's own function.
"""

from unittest.mock import patch

import pandas as pd
import pytest

from uk_budget_data.publication.receipt import projection_end_year

economic_assumptions = pytest.importorskip(
    "policyengine_uk.data.economic_assumptions"
)
if not hasattr(economic_assumptions, "PROJECTION_END_YEAR"):
    pytest.skip(
        "this engine states its horizon as a default end_year",
        allow_module_level=True,
    )


def _engine_end(start_year: int) -> int:
    from policyengine_uk.data import UKSingleYearDataset
    from policyengine_uk.system import system

    dataset = UKSingleYearDataset(
        person=pd.DataFrame(),
        benunit=pd.DataFrame(),
        household=pd.DataFrame(),
        fiscal_year=start_year,
    )
    # Only the years matter here: uprating needs real columns, so it is
    # left out.
    with patch.object(
        economic_assumptions,
        "apply_uprating",
        lambda dataset, **kwargs: dataset,
    ):
        extended = economic_assumptions.extend_single_year_dataset(
            dataset, system.parameters
        )
    return max(int(year) for year in extended.years)


@pytest.mark.parametrize("start_year", [2024, 2031, 2033])
@pytest.mark.parametrize("cgt_end", [None, 2030, 2040])
def test_the_gate_and_the_engine_end_projection_in_the_same_year(
    start_year, cgt_end
):
    """Differential, review of #35: the gate read 2032 where the engine
    stopped at a finite CGT end, and 2030 where a later dataset start year
    raised it."""
    from policyengine_uk.system import system

    node = system.parameters.get_child(economic_assumptions.CGT_INDEX_PATH)
    projection = node.metadata["projection"]
    changes = {} if cgt_end is None else {"end_year": cgt_end}
    with patch.dict(projection, changes):
        assert projection_end_year(start_year=start_year) == _engine_end(
            start_year
        )
