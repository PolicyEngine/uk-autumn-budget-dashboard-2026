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
