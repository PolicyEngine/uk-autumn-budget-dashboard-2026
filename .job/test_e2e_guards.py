"""Operational boundary tests; stdlib only, no model import or simulation."""
from __future__ import annotations

import datetime
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import e2e_common as common


class FakeClock:
    def __init__(self):
        self.seconds = 0.0
        self.sleeps = []

    def perf_counter(self):
        return self.seconds

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.seconds += seconds


class GateTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.now = datetime.datetime(2026, 10, 23, 15, 29, 59, tzinfo=datetime.timezone.utc)
        test = self

        class FrozenDateTime(datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return test.now

        self.run = Mock(return_value=subprocess.CompletedProcess([], 0, "allowed", ""))
        self.vm_stat = Mock(return_value=self.vm_text(200_000, 1_800_000))
        self.statvfs = Mock(return_value=self.disk(55_000_000_000))
        self.load = Mock(return_value=(110.0, 110.0, 110.0))
        self.real_event = common.event
        self.event = Mock()
        self.stack = []
        for name, value in (
            ("time", self.clock),
            ("dt", SimpleNamespace(datetime=FrozenDateTime, timezone=datetime.timezone)),
            ("subprocess", SimpleNamespace(run=self.run, check_output=self.vm_stat)),
            ("event", self.event),
            ("COUNTERS", {"gates_s": 0.0, "gate_wait_s": 0.0, "construction_s": 0.0, "constructors": 0}),
        ):
            self.stack.append(patch.object(common, name, value))
        self.stack.extend((patch.object(common.os, "statvfs", self.statvfs),
                           patch.object(common.os, "getloadavg", self.load)))
        for item in self.stack:
            item.start()
            self.addCleanup(item.stop)

    @staticmethod
    def disk(available_bytes):
        return SimpleNamespace(f_bavail=available_bytes, f_frsize=1)

    @staticmethod
    def vm_text(free_pages, inactive_pages):
        return (
            "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
            f"Pages free: {free_pages}.\n"
            f"Pages inactive: {inactive_pages}.\n"
        )

    def test_exact_load_110_and_decimal_disk_55_gb_pass_without_wait(self):
        common.gate("exact operational limits")
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(self.run.call_count, 1)
        command = self.run.call_args.args[0]
        self.assertEqual(command[-2:], ["allowed", "uk-hub"])
        self.assertTrue(command[1].endswith("reviews/fleet-ops/tools/reservation.py"))
        self.statvfs.assert_called_once_with(common.JOB)

    def test_load_above_110_waits_and_rechecks_reservation(self):
        self.load.side_effect = [(110.000001, 0, 0), (110.0, 0, 0)]
        common.gate("load closed then open")
        self.assertEqual(self.clock.sleeps, [10])
        self.assertEqual(self.run.call_count, 2)
        self.assertEqual(self.load.call_count, 2)
        self.assertEqual(common.COUNTERS["gate_wait_s"], 10)

    def test_one_byte_below_55_decimal_gb_waits_then_passes(self):
        self.statvfs.side_effect = [self.disk(54_999_999_999), self.disk(55_000_000_000)]
        common.gate("disk closed then open")
        self.assertEqual(self.clock.sleeps, [10])
        self.assertEqual(self.run.call_count, 2)

    def test_resources_must_pass_together_in_same_snapshot(self):
        self.statvfs.side_effect = [self.disk(55_000_000_000),
                                   self.disk(54_999_999_999),
                                   self.disk(55_000_000_000)]
        self.load.side_effect = [(111, 0, 0), (109, 0, 0), (110, 0, 0)]
        common.gate("alternating resource pressure")
        self.assertEqual(self.clock.sleeps, [10, 10])
        self.assertEqual(self.run.call_count, 3)

    def test_reservation_refusal_stops_before_resources_or_protected_work(self):
        self.run.return_value = subprocess.CompletedProcess([], 1, "reserved for another hub", "")
        protected_work = Mock()
        with self.assertRaisesRegex(RuntimeError, "reservation refused"):
            common.gate("must stop")
            protected_work()
        self.statvfs.assert_not_called()
        self.load.assert_not_called()
        self.vm_stat.assert_not_called()
        protected_work.assert_not_called()
        self.assertEqual(self.clock.sleeps, [])
        self.assertEqual(self.event.call_args.args[0], "reservation_refused")

    def test_reservation_is_checked_again_after_a_resource_wait(self):
        self.load.return_value = (111, 0, 0)
        self.run.side_effect = [subprocess.CompletedProcess([], 0, "allowed", ""),
                                subprocess.CompletedProcess([], 1, "reservation changed", "")]
        with self.assertRaisesRegex(RuntimeError, "reservation refused"):
            common.gate("reservation changes while waiting")
        self.assertEqual(self.run.call_count, 2)
        self.statvfs.assert_called_once()
        self.load.assert_called_once()
        self.assertEqual(self.clock.sleeps, [10])

    def test_1530z_boundary_stops_before_resources(self):
        for second in (0, 1):
            with self.subTest(second=second):
                self.now = datetime.datetime(2026, 10, 23, 15, 30, second, tzinfo=datetime.timezone.utc)
                with self.assertRaisesRegex(RuntimeError, "15:30Z no-start boundary"):
                    common.gate("deadline")
        self.statvfs.assert_not_called()
        self.load.assert_not_called()
        self.vm_stat.assert_not_called()
        self.assertEqual(self.clock.sleeps, [])

    def test_memory_admission_counts_inactive_pages_and_five_gb_reserve(self):
        # 2,000,000 * 16,384 bytes = 32.768 GB; reserve leaves 27.768 GB.
        common.gate("memory exact limit", memory_gb=27.768)
        self.vm_stat.assert_called_once_with(["vm_stat"], text=True)
        self.assertEqual(self.clock.sleeps, [])

    def test_one_memory_page_short_waits_instead_of_starting(self):
        self.vm_stat.side_effect = [self.vm_text(199_999, 1_800_000),
                                   self.vm_text(200_000, 1_800_000)]
        common.gate("memory closed then open", memory_gb=27.768)
        self.assertEqual(self.clock.sleeps, [10])
        self.assertEqual(self.run.call_count, 2)

    def test_gate_persists_only_scratch_events_and_preserves_private_source(self):
        with tempfile.TemporaryDirectory(prefix="e2e-guard-test-") as folder:
            root = Path(folder)
            source = root / "private-source.h5"
            original = b"private input bytes: never opened for output"
            source.write_bytes(original)
            scratch = root / "scratch"
            scratch.mkdir()
            writes = []
            original_open = Path.open

            def scratch_only_open(path, mode="r", *args, **kwargs):
                if any(flag in mode for flag in ("w", "a", "x", "+")):
                    self.assertTrue(path.is_relative_to(scratch / "events"), str(path))
                    writes.append(path)
                return original_open(path, mode, *args, **kwargs)

            self.event.side_effect = self.real_event
            with patch.object(common, "JOB", scratch), patch.object(Path, "open", scratch_only_open), patch("builtins.print"):
                common.gate("safe event persistence")
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(len(writes), 2)
            self.assertTrue(all(path.parent == scratch / "events" for path in writes))


if __name__ == "__main__":
    unittest.main()
