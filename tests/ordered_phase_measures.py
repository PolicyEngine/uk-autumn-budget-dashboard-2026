"""Source-bindable synthetic modifiers for ordered phase contract tests.

These change only diagnostic attributes, never policy or population data.
Keeping them outside pytest-rewritten modules lets the real receipt API
verify their loaded source and defaults.
"""


def before_add(sim, amount=1):
    sim.ordered_value = getattr(sim, "ordered_value", 0) + amount
    sim.ordered_events = getattr(sim, "ordered_events", ()) + ("before_add",)
    return sim


def before_multiply(sim, factor=2):
    sim.ordered_value = getattr(sim, "ordered_value", 0) * factor
    sim.ordered_events = getattr(sim, "ordered_events", ()) + (
        "before_multiply",
    )
    return sim


def after_add(sim, amount=3):
    sim.ordered_value = getattr(sim, "ordered_value", 0) + amount
    sim.ordered_events = getattr(sim, "ordered_events", ()) + ("after_add",)
    return sim


def after_multiply(sim, factor=4):
    sim.ordered_value = getattr(sim, "ordered_value", 0) * factor
    sim.ordered_events = getattr(sim, "ordered_events", ()) + (
        "after_multiply",
    )
    return sim
