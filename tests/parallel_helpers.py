"""Worker functions for tests/test_parallel.py.

A worker process imports these by name, so they live in a module of their
own, not in the test module.
"""

import os
import time


def slow_echo(seconds: float) -> tuple[float, int]:
    """Sleep, then give back the argument and this worker's process id."""
    time.sleep(seconds)
    return seconds, os.getpid()


def timed_echo(seconds: float) -> tuple[float, float]:
    """When this unit started and ended."""
    start = time.time()
    time.sleep(seconds)
    return start, time.time()


def fail_on_two(value: int) -> int:
    if value == 2:
        raise ValueError("unit 2 failed")
    time.sleep(0.05)
    return value


# --- receipted artifacts in worker processes --------------------------------

# The Worlds this process has attached, by root.
_WORLDS: dict = {}


def world_sim(root: str, dataset=None, scenario=None):
    """A stand-in simulation from the World made at ``root``, attached in
    this process on first use (``World.attach``)."""
    from tests.publication_support import World

    if root not in _WORLDS:
        _WORLDS[root] = World.attach(root)
    return _WORLDS[root].sim()


def fake_process(
    values, reform, config, baseline, reformed, baseline_scenario
):
    """The flow tests' stand-in calculators, as a function a worker process
    can be sent."""
    from tests.test_publication_flow import fake_process as calculators

    return calculators(values)(
        reform, config, baseline, reformed, baseline_scenario
    )


def retune_then_process(
    values, reform, config, baseline, reformed, baseline_scenario
):
    """Change ``module_level_modifier`` in this process after the run has
    computed its identities, then calculate as :func:`fake_process` does:
    the receipt's re-check should refuse the run. Run it only in a worker
    process, which ends with its unit."""
    from tests import fixed_shape_measures

    if reform.id == "retuned":
        fixed_shape_measures.module_level_modifier.__defaults__ = (0.3,)
    return fake_process(
        values, reform, config, baseline, reformed, baseline_scenario
    )
