"""Independent Python reference for the E1-A scalar plant safety barrier.

This is NOT a Python reimplementation of the local estimator or transport.
It independently recomputes x(t+1), the robust control interval, the
nominal ISS one-step bound and the recursive bound from the JS event archive.
"""
from __future__ import annotations
import json
import math
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "tests" / "gui" / "localPlantReferenceBridge.mjs"


class TestLocalPlantIndependentOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js 22 required for independent plant replay")
        result = subprocess.run(
            [node, str(BRIDGE)],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=45,
            check=False,
        )
        if result.returncode:
            raise RuntimeError(f"Plant bridge failed: {result.stderr}")
        cls.archive = json.loads(result.stdout)

    def test_boundary_inputs_and_exact_discrete_recurrence(self):
        for case in self.archive["output"]:
            p = case["options"]
            S, a, b = p["plantSafeBound"], p["plantA"], p["plantB"]
            W, V = p["plantDisturbanceBound"], p["plantSensorBound"]
            U, k = p["plantControlLimit"], p["plantK"]
            assert self.archive["version"].startswith("e1a-scalar-")
            prior = case["initial"][:]
            n = len(prior)
            self.assertEqual(len(case["records"]), n * p["plantSteps"])
            for row in case["records"]:
                i = row["node"]
                self.assertAlmostEqual(row["stateBefore"], prior[i], places=11)
                x, y = row["stateBefore"], row["trustedSensor"]
                self.assertLessEqual(abs(x), S + 1e-10)
                self.assertLessEqual(abs(y - x), V + 1e-10)
                self.assertLessEqual(abs(row["disturbance"]), W + 1e-10)
                lo_x = max(-S, y - V)
                hi_x = min(S, y + V)
                u_lo = max(-U, (-S + W - a * lo_x) / b)
                u_hi = min(U, (S - W - a * hi_x) / b)
                self.assertLessEqual(u_lo, u_hi + 1e-10)
                self.assertAlmostEqual(row["safeLo"], u_lo, places=11)
                self.assertAlmostEqual(row["safeHi"], u_hi, places=11)
                self.assertLessEqual(row["control"], u_hi + 1e-10)
                self.assertGreaterEqual(row["control"], u_lo - 1e-10)
                if row["accepted"] and p["plantControlMode"] != "local_sensor":
                    estimate = (row["localAction"] if p["plantControlMode"] ==
                                "local_action" else row["localDecision"])
                    self.assertTrue(math.isfinite(estimate))
                    requested = -k * estimate
                    self.assertEqual(row["controlSource"], "local")
                    self.assertFalse(row["refused"])
                elif p["plantControlMode"] == "local_sensor":
                    requested = -k * y
                    self.assertEqual(row["controlSource"], "trusted_sensor")
                    estimate = y
                    self.assertFalse(row["refused"])
                else:
                    requested = (0 if p["plantFallbackPolicy"] == "barrier_zero"
                                 else -k * y)
                    self.assertTrue(row["refused"])
                    estimate = y
                self.assertAlmostEqual(row["requested"], requested, places=11)
                self.assertAlmostEqual(
                    row["control"], max(u_lo, min(u_hi, requested)), places=11
                )
                nxt = a * x + b * row["control"] + row["disturbance"]
                self.assertAlmostEqual(row["stateAfter"], nxt, places=11)
                self.assertLessEqual(abs(nxt), S + 1e-10)
                self.assertAlmostEqual(row["V"], nxt * nxt, places=11)
                prior[i] = nxt
            for i, value in enumerate(prior):
                self.assertAlmostEqual(
                    value, case["records"][-n + i]["stateAfter"], places=11
                )

    def test_independent_iss_step_and_recursion(self):
        for case in self.archive["output"]:
            p = case["options"]
            a, b, k, W = (
                p["plantA"], p["plantB"], p["plantK"],
                p["plantDisturbanceBound"],
            )
            q = abs(a - b * k)
            self.assertLess(q, 1, "Only nominal contraction is guaranteed")
            bound = [abs(x) for x in case["initial"]]
            for row in case["records"]:
                i, x = row["node"], row["stateBefore"]
                z = (row["localAction"] if p["plantControlMode"] ==
                     "local_action" and row["accepted"] else
                     row["localDecision"] if p["plantControlMode"] ==
                     "local_decision" and row["accepted"] else
                     row["trustedSensor"])
                residual = abs(row["control"] + k * z)
                error = abs(x - z)
                one = q * abs(x) + b * k * error + b * residual + abs(row["disturbance"])
                accumulated = q * bound[i] + b * k * error + b * residual + W
                self.assertAlmostEqual(row["issOneStepBound"], one, places=11)
                self.assertAlmostEqual(row["issRecursiveBound"], accumulated, places=11)
                self.assertLessEqual(abs(row["stateAfter"]), one + 1e-10)
                self.assertLessEqual(abs(row["stateAfter"]), accumulated + 1e-10)
                bound[i] = accumulated

    def test_traces_are_explicitly_different_from_classical_e1(self):
        modes = [r["options"]["plantControlMode"] for r in self.archive["output"]]
        self.assertEqual(modes, ["local_action", "local_decision", "local_sensor"])
        for case in self.archive["output"]:
            rows = case["records"]
            self.assertEqual(
                len([r for r in rows if r["honest"]]),
                case["options"]["plantSteps"] *
                (case["options"]["plantAgents"] - case["options"]["plantByzantine"])
            )
            self.assertEqual(case["metrics"]["safetyViolations"], 0)
            self.assertEqual(case["metrics"]["issViolations"], 0)
            self.assertTrue(all(h["slots"] <= h["capacity"] for h in case["network"]))


    def test_diagnostic_coverage_differs_from_actuation_source(self):
        for case in self.archive["output"]:
            honest = [r for r in case["records"] if r["honest"]]
            m = case["metrics"]
            coverage = sum(bool(r["accepted"]) for r in honest) / len(honest)
            local = sum(r["controlSource"] == "local" for r in honest) / len(honest)
            fallback = sum(bool(r["refused"]) for r in honest) / len(honest)
            self.assertAlmostEqual(m["honestCoverage"], coverage, places=11)
            self.assertAlmostEqual(
                m["honestLocalControlFraction"], local, places=11
            )
            self.assertAlmostEqual(m["honestFallbackFraction"], fallback, places=11)
            if case["options"]["plantControlMode"] == "local_sensor":
                self.assertEqual(local, 0)
                self.assertEqual(fallback, 0)
                self.assertGreater(coverage, 0)
            else:
                self.assertAlmostEqual(local + fallback, 1, places=11)


if __name__ == "__main__":
    unittest.main()
