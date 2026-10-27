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

CI runs the suite in shards on separate runners (``--ci-shard K/N``): each
keeps the tests tests/ci_shards.py assigns it by their recorded CI times.
Within a shard, four pytest-xdist workers take the heaviest tests first, so
the first four heavy units start on separate workers and the rest follow as
each worker's next unit (see ``pytest_collection_modifyitems``). Tests
marked ``slow`` take minutes each and go first even before CI has recorded
their time.
"""

import importlib
import os

import pytest

try:
    from tests import ci_shards
except ImportError:
    # tests/test_certified_data.py runs a copy of this file on its own in a
    # temporary directory, where there are no shards to split.
    ci_shards = None

CERTIFIED_DATA = "certified_data"
SLOW = "slow"
# Where the warnings the tests can let through are defined. Under
# pytest-xdist the main process imports a worker's warning's module to
# report it, in one thread per worker, so two workers' first warnings at
# once can deadlock on the import lock and crash the session. Importing
# them before the workers start leaves nothing to import then.
WARNING_MODULES = (
    "uk_budget_data.data_limits",
    "uk_budget_data.measure_templates",
)


def certified_data_required() -> bool:
    """Whether certified-data tests must run rather than skip."""
    return os.environ.get("REQUIRE_CERTIFIED_DATA") == "1"


def is_xdist_worker(config) -> bool:
    """Whether this process is a pytest-xdist worker, not the main one."""
    return hasattr(config, "workerinput")


def pytest_addoption(parser):
    parser.addoption(
        "--ci-shard",
        default=None,
        metavar="K/N",
        help="run only shard K of N (tests/ci_shards.py)",
    )


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
    if not is_xdist_worker(config):
        for module in WARNING_MODULES:
            importlib.import_module(module)


@pytest.fixture
def stand_in_data_limits(request, monkeypatch):
    """The two lifted purchase limits registered on top of the registry,
    for tests of the machinery written around them
    (tests/data_limit_stand_ins.py). A certified-data test checks the
    registry itself against the certified data, so it sees it as it is."""
    if CERTIFIED_DATA in request.keywords:
        return
    from tests import data_limit_stand_ins

    data_limit_stand_ins.register(monkeypatch)


@pytest.fixture
def stand_in_model_limits(monkeypatch):
    """The three expired model limits registered around the registry, for
    tests of the machinery written around them
    (tests/model_limit_stand_ins.py). No model has a stand-in's fix unless
    the test installs it (``with_fix``)."""
    from tests import model_limit_stand_ins

    model_limit_stand_ins.register(monkeypatch)


def _group(item) -> str | None:
    mark = item.get_closest_marker("xdist_group")
    if mark is None:
        return None
    return mark.args[0] if mark.args else mark.kwargs.get("name")


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(config, items):
    """Keep this CI shard's tests; under pytest-xdist, heaviest first.

    Last, so ``-m`` has already deselected what this run leaves out and
    every shard splits the same set of tests.

    CI runs ``-n 4 --dist loadgroup --no-loadscope-reorder``, which hands
    out work units (a test, or the tests of one ``xdist_group``) in
    collection order: one to each worker, then a second, then more to a
    worker only as its own tests finish. With the slow tests first, then
    the rest by recorded time, the first four heavy units start on separate
    workers, the rest follow as each worker's next unit, and light tests
    queue behind them. In file order, a worker that finished its light tests
    early could be given two slow units back to back. Serial runs keep file
    order.
    """
    shard_option = config.getoption("--ci-shard")
    if ci_shards is None:
        if shard_option:
            raise pytest.UsageError("--ci-shard needs tests/ci_shards.py")
        if is_xdist_worker(config):
            items.sort(key=lambda item: item.get_closest_marker(SLOW) is None)
        return
    durations = ci_shards.load_durations()
    if shard_option:
        shard, count = ci_shards.parse_shard(shard_option)
        shards = ci_shards.assign(
            [(item.nodeid, _group(item)) for item in items],
            count,
            durations,
        )
        kept = [item for item in items if shards[item.nodeid] == shard]
        dropped = [item for item in items if shards[item.nodeid] != shard]
        if dropped:
            config.hook.pytest_deselected(items=dropped)
        items[:] = kept
    if is_xdist_worker(config):
        items.sort(
            key=lambda item: (
                item.get_closest_marker(SLOW) is None,
                -ci_shards.weight(item.nodeid, durations),
            )
        )


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
