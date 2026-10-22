"""The household calculation's Modal app: restored from a memory snapshot.

As the PA, MA and MT child tax credit dashboards' household calculators and
the household API's Modal worker do, the container class takes a memory
snapshot (``enable_memory_snapshot=True``) after ``@modal.enter(snap=True)``
has imported the models and calculated one household, so a new container
restores a warm process instead of loading the models again. It scales to
zero when idle and out to a limit under load.

Modal isn't installed for the tests: a stand-in ``modal`` module records
what the app asks of it.
"""

import importlib
import sys
import types
from pathlib import Path

import pytest
from fastapi import FastAPI

from uk_budget_data import household_impact

REPO = Path(__file__).resolve().parent.parent


class FakeImage:
    """Records the image's build steps, in order."""

    def __init__(self, steps):
        self.steps = steps

    @classmethod
    def debian_slim(cls, python_version=None):
        return cls([("debian_slim", {"python_version": python_version})])

    def _step(self, name, *args, **kwargs):
        return FakeImage(self.steps + [(name, {"args": args, **kwargs})])

    def uv_sync(self, *args, **kwargs):
        return self._step("uv_sync", *args, **kwargs)

    def add_local_python_source(self, *args, **kwargs):
        return self._step("add_local_python_source", *args, **kwargs)

    def env(self, *args, **kwargs):
        return self._step("env", *args, **kwargs)


class FakeApp:
    def __init__(self, name, image=None, **kwargs):
        self.name = name
        self.image = image
        self.classes = {}

    def cls(self, **options):
        def register(cls):
            self.classes[cls.__name__] = options
            return cls

        return register


def fake_modal():
    module = types.ModuleType("modal")
    module.Image = FakeImage
    module.App = FakeApp

    def enter(snap=False):
        def mark(function):
            function.modal_enter_snap = snap
            return function

        return mark

    def asgi_app():
        def mark(function):
            function.modal_asgi_app = True
            return function

        return mark

    module.enter = enter
    module.asgi_app = asgi_app
    return module


@pytest.fixture
def modal_household(monkeypatch):
    monkeypatch.setitem(sys.modules, "modal", fake_modal())
    monkeypatch.setenv("GIT_SHA", "a" * 40)
    sys.modules.pop("uk_budget_data.modal_household", None)
    module = importlib.import_module("uk_budget_data.modal_household")
    yield module
    sys.modules.pop("uk_budget_data.modal_household", None)


def test_containers_restore_from_a_memory_snapshot(modal_household):
    options = modal_household.app.classes["HouseholdImpactApi"]
    assert options["enable_memory_snapshot"] is True
    # Scales to zero after a while idle, and out to a limit under load
    assert options["scaledown_window"] > 0
    assert 1 <= options["max_containers"] <= 100
    assert options["cpu"] >= 1 and options["memory"] >= 2048


def test_the_image_installs_exactly_what_uv_lock_pins(modal_household):
    steps = modal_household.app.image.steps
    names = [name for name, _ in steps]
    assert names[0] == "debian_slim"
    python_version = (REPO / ".python-version").read_text().strip()
    assert steps[0][1]["python_version"] == python_version
    uv_sync = dict(steps)["uv_sync"]
    assert Path(uv_sync["args"][0]).resolve() == REPO
    assert (REPO / "uv.lock").exists()
    assert uv_sync.get("frozen", True) is True
    assert ("add_local_python_source", {"args": ("uk_budget_data",)}) in steps


def test_the_image_records_the_commit_it_was_built_from(modal_household):
    environments = [
        step["args"][0]
        for name, step in modal_household.app.image.steps
        if name == "env"
    ]
    assert {"GIT_SHA": "a" * 40} in environments


def test_the_snapshot_is_taken_after_a_household_is_calculated(
    modal_household, monkeypatch
):
    calls = []
    monkeypatch.setattr(
        household_impact,
        "calculate_household_impact",
        lambda answers, policies, year: calls.append((policies, year)),
    )
    api = modal_household.HouseholdImpactApi()
    assert api.load.modal_enter_snap is True
    api.load()
    assert calls == [
        (household_impact.measure_ids(), modal_household.WARMUP_YEAR)
    ]


def test_the_web_endpoint_is_the_household_app(modal_household):
    api = modal_household.HouseholdImpactApi()
    assert api.web.modal_asgi_app is True
    web = api.web()
    assert isinstance(web, FastAPI)
    paths = {route.path for route in web.routes}
    assert {"/health", "/household-impact"} <= paths
