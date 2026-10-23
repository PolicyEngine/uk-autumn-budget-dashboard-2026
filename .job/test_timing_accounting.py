"""Check deadline arithmetic where overlapping measurements can mislead."""
import json
from pathlib import Path
import unittest

import summarize_e2e6 as summary


class TimingAccountingTests(unittest.TestCase):
    def test_every_batch_counts_its_full_launcher_and_outside_gate(self):
        result = summary.timed_projection(10, 20, 3, 1, 5, 200, 15, 22)
        self.assertEqual(result["critical_path_seconds"], 125)
        self.assertEqual(result["machine_margin_seconds"], 75)
        self.assertEqual(result["conservative_repeat_frozen_reference"]["critical_path_seconds"], 130)

    def test_fifteen_measures_require_eight_two_process_batches(self):
        result = summary.timed_projection(0, 20, 2, 0, None, 150, 15, 20)
        self.assertEqual(result["projected_batches"], 8)
        self.assertEqual(result["machine_margin_seconds"], -10)
        self.assertFalse(result["machine_fits"])

    def test_preserved_failed_attempt_partitions_its_wall_without_nested_calls(self):
        record = json.loads((Path(__file__).parent / "serial-failed-attempt.json").read_text())
        # Read the independently recovered ledger rather than simulating a run.
        self.assertEqual(record["failure"]["written_artifacts"], {})
        self.assertFalse(record["failure"]["throughput_estimate_allowed"])
        self.assertIsNone(record["memory"]["peak_memory_decimal_gb"])
        self.assertAlmostEqual(sum(record["disjoint_external_components_seconds"].values()),
                               record["external_wall_seconds"])


if __name__ == "__main__":
    unittest.main()
