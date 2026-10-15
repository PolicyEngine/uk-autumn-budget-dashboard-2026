"""Shared pytest configuration.

Tests marked ``certified_data`` build microsimulations on the certified UK
dataset pinned by the installed policyengine.py bundle, which needs
``HUGGING_FACE_TOKEN``. Locally they skip when the token is absent. In CI the
certified-data job sets ``REQUIRE_CERTIFIED_DATA=1``: a missing token then
fails those tests, and any certified-data test that skips for another reason
fails the session, so removing or breaking the credential can never turn the
check green. A module skipped while being collected also fails the session
then, since its tests can no longer be told apart.

Skips are counted from test reports, which reach the main process under
pytest-xdist too; hooks that take the test item run only on the workers.

Tests marked ``slow`` take minutes each. The Python tests job runs the suite
on four pytest-xdist workers and these tests are collected first there, so
its four slow units start on separate workers (see
``pytest_collection_modifyitems``).
"""

import os

import pytest

CERTIFIED_DATA = "certified_data"
SLOW = "slow"


def certified_data_required() -> bool:
    """Whether certified-data tests must run rather than skip."""
    return os.environ.get("REQUIRE_CERTIFIED_DATA") == "1"


def is_xdist_worker(config) -> bool:
    """Whether this process is a pytest-xdist worker, not the main one."""
    return hasattr(config, "workerinput")


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        f"{CERTIFIED_DATA}: needs the certified UK dataset pinned by the "
        "policyengine.py bundle (HUGGING_FACE_TOKEN)",
    )
    config.addinivalue_line(
        "markers",
        f"{SLOW}: takes minutes; collected first under pytest-xdist",
    )


def pytest_collection_modifyitems(config, items):
    """Under pytest-xdist, collect the slow tests first.

    CI runs ``-n 4 --dist loadgroup --no-loadscope-reorder``, which hands
    out work units (a test, or the tests of one ``xdist_group``) in
    collection order: one to each worker, then a second, then more to a
    worker only as its own tests finish. With the slow tests first, the four
    slow units start on separate workers and light tests queue behind them.
    In file order, a worker that finished its light tests early could be
    given two slow units back to back. Serial runs keep file order.
    """
    if is_xdist_worker(config):
        items.sort(key=lambda item: item.get_closest_marker(SLOW) is None)


def pytest_runtest_setup(item):
    if CERTIFIED_DATA not in item.keywords:
        return
    if os.environ.get("HUGGING_FACE_TOKEN"):
        return
    message = "HUGGING_FACE_TOKEN is not set; the certified dataset is needed"
    if certified_data_required():
        pytest.fail(f"REQUIRE_CERTIFIED_DATA=1 but {message}", pytrace=False)
    pytest.skip(message)


def pytest_runtest_logreport(report):
    if report.skipped and CERTIFIED_DATA in report.keywords:
        _CERTIFIED_DATA_SKIPS.append(report.nodeid)


def pytest_collectreport(report):
    if report.skipped:
        _COLLECTION_SKIPS.append(report.nodeid)


_CERTIFIED_DATA_SKIPS: list[str] = []
_COLLECTION_SKIPS: list[str] = []


def pytest_sessionfinish(session, exitstatus):
    if is_xdist_worker(session.config):
        return  # the main process sees every report and decides
    skips = _CERTIFIED_DATA_SKIPS + [
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
