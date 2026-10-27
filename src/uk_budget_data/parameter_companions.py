"""Parameters policyengine-uk charges in step with another.

The engine holds some rates and switches twice, so a measure that changes
one and not the other changes less than it says. Drill 5's mock measures
had three such gaps (the review on #145):

- the income tax and dividend scales end with a bracket at £10m that
  repeats the additional rate, so a new additional rate alone leaves income
  above £10m at the old one;
- capital gains tax charges the gains above the higher rate limit, stacked
  on income, at an additional rate that current law sets equal to the
  higher rate (the law has no additional rate), for the main rates and for
  residential property and carried interest, so a new higher rate alone
  leaves most large gains at the old one;
- from policyengine-uk 2.151.0 Northern Ireland's Local Housing Allowance
  follows a freeze and a percentile of its own (``gov.dfc.LHA``), which
  have matched each Great Britain change so far, so a change to
  ``gov.dwp.LHA`` alone leaves Northern Ireland as it was.

A measure that changes the first parameter of a pair in a year changes the
second in that year too; one meant to change only the first sets the
second to its current value, so the choice is written down. Generation
refuses any other (``publication.generate``), and the flat pipeline says
so. A pair whose second parameter the installed engine lacks is not
checked.

``parameter_changes`` are checked before the simulations are built
(:func:`companion_gaps`), and what the two built simulations run once they
are (:func:`built_companion_gaps`), so a modifier that edits the first
parameter alone is refused too, as the wealth-tax scales are.
"""

from dataclasses import dataclass
from typing import Callable, Optional

INCOME_TAX = "gov.hmrc.income_tax.rates"
CGT = "gov.hmrc.cgt"
TOP_BRACKET = "the scale's £10m bracket repeats it"
ABOVE_HIGHER = (
    "the engine charges gains above the higher rate limit at it, equal to "
    "the higher rate in current law"
)
NORTHERN_IRELAND = "Northern Ireland's rates follow it"

# (the parameter a measure changes, its companion, why the engine needs both)
COMPANIONS = (
    (f"{INCOME_TAX}.uk[2].rate", f"{INCOME_TAX}.uk[3].rate", TOP_BRACKET),
    (
        f"{INCOME_TAX}.dividends[2].rate",
        f"{INCOME_TAX}.dividends[3].rate",
        TOP_BRACKET,
    ),
    (f"{CGT}.higher_rate", f"{CGT}.additional_rate", ABOVE_HIGHER),
    (
        f"{CGT}.residential_property.higher_rate",
        f"{CGT}.residential_property.additional_rate",
        ABOVE_HIGHER,
    ),
    (
        f"{CGT}.carried_interest.higher_rate",
        f"{CGT}.carried_interest.additional_rate",
        ABOVE_HIGHER,
    ),
    ("gov.dwp.LHA.freeze", "gov.dfc.LHA.freeze", NORTHERN_IRELAND),
    ("gov.dwp.LHA.percentile", "gov.dfc.LHA.percentile", NORTHERN_IRELAND),
)


@dataclass(frozen=True)
class CompanionGap:
    """Years in which a scenario changes a parameter but not its companion."""

    path: str
    companion: str
    why: str
    years: tuple[str, ...]

    @property
    def reason(self) -> str:
        return (
            f"{self.path} changes in {', '.join(self.years)} but "
            f"{self.companion} does not, and {self.why}. Change both, or "
            f"set {self.companion} to its current value to leave it."
        )


def installed(path: str) -> bool:
    """Whether the installed engine has the parameter at ``path``."""
    from policyengine_uk.system import system

    try:
        system.parameters.get_child(path)
    except (KeyError, AttributeError, IndexError, ValueError):
        return False
    return True


def companion_gaps(
    *scenarios, has: Optional[Callable[[str], bool]] = None
) -> list[CompanionGap]:
    """The gaps in ``scenarios``' ``parameter_changes`` (either may be
    None), in COMPANIONS order. ``has`` says whether the engine has a
    parameter (the installed engine's by default)."""
    has = has or installed
    gaps = []
    for scenario in scenarios:
        changes = getattr(scenario, "parameter_changes", None) or {}
        for path, companion, why in COMPANIONS:
            if path not in changes or not has(companion):
                continue
            missing = sorted(
                set(changes[path]) - set(changes.get(companion) or {})
            )
            if missing:
                gaps.append(CompanionGap(path, companion, why, tuple(missing)))
    return gaps


def built_companion_gaps(
    sim_baseline, sim_reform, years, *scenarios
) -> list[CompanionGap]:
    """The gaps in what two built simulations run, in COMPANIONS order: the
    scored ``years`` in which the first parameter of a pair differs between
    them and its companion does not, unless one of ``scenarios`` names the
    companion in that year (set to its current value, so the choice is
    written down). A modifier that edits the first parameter alone shows
    here; a pair either tree lacks is not checked."""
    from uk_budget_data import data_limits

    systems = (sim_baseline.tax_benefit_system, sim_reform.tax_benefit_system)
    named: dict[str, set] = {}
    for scenario in scenarios:
        changes = getattr(scenario, "parameter_changes", None) or {}
        for path, values in changes.items():
            named.setdefault(path, set()).update(str(y) for y in values or {})
    gaps = []
    with (
        data_limits._caches_left_as_found(systems[0]),
        data_limits._caches_left_as_found(systems[1]),
    ):
        for path, companion, why in COMPANIONS:
            try:
                pairs = [
                    (
                        system.parameters.get_child(path),
                        system.parameters.get_child(companion),
                    )
                    for system in systems
                ]
            except (KeyError, AttributeError, IndexError, ValueError):
                continue
            missing = []
            for year in years:
                at = f"{year}-01-01"
                (first, second), (first_after, second_after) = pairs
                if (
                    first(at) != first_after(at)
                    and second(at) == second_after(at)
                    and str(year) not in named.get(companion, set())
                ):
                    missing.append(str(year))
            if missing:
                gaps.append(CompanionGap(path, companion, why, tuple(missing)))
    return gaps


def companion_refusal(gaps: list[CompanionGap]) -> str:
    """Why a measure with ``gaps`` is refused."""
    return " ".join(gap.reason for gap in gaps)
