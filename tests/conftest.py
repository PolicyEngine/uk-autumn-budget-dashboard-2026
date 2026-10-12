"""Shared pytest configuration.

Tests marked ``certified_data`` build microsimulations on the certified UK
dataset pinned by the installed policyengine.py bundle, which needs
``HUGGING_FACE_TOKEN``. Locally they skip when the token is absent. In CI the
certified-data job sets ``REQUIRE_CERTIFIED_DATA=1``: a missing token then
fails those tests, and any certified-data test that skips for another reason
fails the session, so removing or breaking the credential can never turn the
check green. A module skipped while being collected also fails the session
then, since its tests can no longer be told apart.
"""

import os

import pytest

CERTIFIED_DATA = "certified_data"


def certified_data_required() -> bool:
    """Whether certified-data tests must run rather than skip."""
    return os.environ.get("REQUIRE_CERTIFIED_DATA") == "1"


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        f"{CERTIFIED_DATA}: needs the certified UK dataset pinned by the "
        "policyengine.py bundle (HUGGING_FACE_TOKEN)",
    )
    config._certified_data_skips = []


def pytest_runtest_setup(item):
    if CERTIFIED_DATA not in item.keywords:
        return
    if os.environ.get("HUGGING_FACE_TOKEN"):
        return
    message = "HUGGING_FACE_TOKEN is not set; the certified dataset is needed"
    if certified_data_required():
        pytest.fail(f"REQUIRE_CERTIFIED_DATA=1 but {message}", pytrace=False)
    pytest.skip(message)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.skipped and CERTIFIED_DATA in item.keywords:
        item.config._certified_data_skips.append(item.nodeid)


def pytest_collectreport(report):
    if report.skipped:
        _COLLECTION_SKIPS.append(report.nodeid)


_COLLECTION_SKIPS: list[str] = []


def pytest_sessionfinish(session, exitstatus):
    skips = getattr(session.config, "_certified_data_skips", []) + [
        f"{nodeid} (skipped while collecting)" for nodeid in _COLLECTION_SKIPS
    ]
    if certified_data_required() and skips:
        reporter = session.config.pluginmanager.get_plugin("terminalreporter")
        if reporter is not None:
            reporter.write_line(
                "REQUIRE_CERTIFIED_DATA=1 but these certified-data tests "
                "skipped: " + ", ".join(sorted(set(skips))),
                red=True,
            )
        session.exitstatus = pytest.ExitCode.TESTS_FAILED
