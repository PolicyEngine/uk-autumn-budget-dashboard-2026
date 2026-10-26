"""The Modal household calculator's scaling: the warm schedule (Vahid, 25
October) and the autoscaler settings each deploy applies."""

import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from uk_budget_data.household_warm import warm_target

MODAL_HOUSEHOLD_PATH = (
    Path(__file__).parents[1] / "src/uk_budget_data/modal_household.py"
)
SCALING_VARIABLES = (
    "HOUSEHOLD_MODAL_APP",
    "HOUSEHOLD_MODAL_MIN_CONTAINERS",
    "HOUSEHOLD_MODAL_MAX_CONTAINERS",
    "HOUSEHOLD_MODAL_BUFFER_CONTAINERS",
)


@pytest.mark.parametrize(
    "now_uk, expected",
    [
        ("2026-10-25T18:00", (2, 0)),
        ("2026-10-26T09:00", (12, 1)),
        ("2026-10-26T17:59", (12, 1)),
        ("2026-10-26T18:00", (2, 0)),
        ("2026-10-27T07:59", (2, 0)),
        ("2026-10-27T08:00", (6, 1)),
        ("2026-10-27T20:00", (2, 0)),
        ("2026-10-28T07:59", (2, 0)),
        ("2026-10-28T08:00", (12, 1)),
        ("2026-10-28T23:59", (12, 1)),
        ("2026-10-29T00:00", (2, 0)),
        ("2026-10-29T08:00", (6, 1)),
        ("2026-10-29T20:00", (2, 0)),
        ("2026-11-03T23:59", (2, 0)),
        ("2026-11-04T00:00", (0, 0)),
    ],
)
def test_warm_target(now_uk, expected):
    assert warm_target(now_uk) == expected


def load_modal_household(monkeypatch, **environment):
    """Import ``modal_household`` as a deploy would, with a stand-in for
    ``modal`` (not installed here) that records each decorator's
    arguments. Returns the module and the stand-in."""
    for name in SCALING_VARIABLES:
        monkeypatch.delenv(name, raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    fake_modal = MagicMock()
    monkeypatch.setitem(sys.modules, "modal", fake_modal)
    spec = importlib.util.spec_from_file_location(
        "modal_household_under_test", MODAL_HOUSEHOLD_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, fake_modal


def class_settings(fake_modal) -> tuple:
    """The ``app.cls`` arguments of ``Household`` and ``Web``, in that
    order (the order the module defines them)."""
    household_call, web_call = fake_modal.App.return_value.cls.call_args_list
    return household_call.kwargs, web_call.kwargs


def test_production_defaults_keep_two_running_buffer_four_and_cap_eighty(
    monkeypatch,
):
    module, fake_modal = load_modal_household(monkeypatch)
    household, web = class_settings(fake_modal)
    assert module.PRODUCTION
    assert household["min_containers"] == 2
    assert household["buffer_containers"] == 4
    assert household["max_containers"] == 80
    # Web keeps its rule: 1 while Household keeps any running.
    assert web["min_containers"] == 1
    assert web["max_containers"] == 4
    assert "buffer_containers" not in web
    # The image carries what the deploy read, for the container's import.
    assert module.DEPLOY_SETTINGS["HOUSEHOLD_MODAL_MIN_CONTAINERS"] == "2"
    assert module.DEPLOY_SETTINGS["HOUSEHOLD_MODAL_MAX_CONTAINERS"] == "80"
    assert module.DEPLOY_SETTINGS["HOUSEHOLD_MODAL_BUFFER_CONTAINERS"] == "4"


def test_a_test_app_keeps_none_running(monkeypatch):
    """A test app has no warm schedule to lower its minimum, so it keeps
    0 containers running by default."""
    module, fake_modal = load_modal_household(
        monkeypatch, HOUSEHOLD_MODAL_APP="uk-budget-household-speedtest"
    )
    household, web = class_settings(fake_modal)
    assert not module.PRODUCTION
    assert household["min_containers"] == 0
    assert web["min_containers"] == 0
    assert household["buffer_containers"] == 4
    assert household["max_containers"] == 80


def test_the_deployers_environment_overrides_each_default(monkeypatch):
    module, fake_modal = load_modal_household(
        monkeypatch,
        HOUSEHOLD_MODAL_MIN_CONTAINERS="0",
        HOUSEHOLD_MODAL_MAX_CONTAINERS="12",
        HOUSEHOLD_MODAL_BUFFER_CONTAINERS="0",
    )
    household, web = class_settings(fake_modal)
    assert household["min_containers"] == 0
    assert household["max_containers"] == 12
    assert household["buffer_containers"] == 0
    assert web["min_containers"] == 0
    assert module.DEPLOY_SETTINGS["HOUSEHOLD_MODAL_MIN_CONTAINERS"] == "0"
    assert module.DEPLOY_SETTINGS["HOUSEHOLD_MODAL_MAX_CONTAINERS"] == "12"
    assert module.DEPLOY_SETTINGS["HOUSEHOLD_MODAL_BUFFER_CONTAINERS"] == "0"


def test_the_warm_schedule_sets_only_the_minimum(monkeypatch):
    """Modal keeps the settings a call leaves out, so the schedule leaves
    the deployed buffer and maximum alone. (A test app keeps the schedule
    as a plain function, so it can be called here.)"""
    module, fake_modal = load_modal_household(
        monkeypatch, HOUSEHOLD_MODAL_APP="uk-budget-household-speedtest"
    )
    module.warm_schedule()
    update_autoscaler = (
        fake_modal.Cls.from_name.return_value.return_value.update_autoscaler
    )
    assert update_autoscaler.call_count == 2
    for autoscaler_call in update_autoscaler.call_args_list:
        assert set(autoscaler_call.kwargs) == {"min_containers"}
