"""Independent Python recomputation of E1-A set-valued sensor-fault safety.

No Python function imports the JS estimator or the JS interval arithmetic:
Node only supplies archived state/action/measurement events and parameters.
Python independently verifies every interval, control and transition.
"""
from __future__ import annotations
import json
import math
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "tests" / "gui" / "localPlantSensorFaultReferenceBridge.mjs"
TOL = 1e-9


class TestLocalPlantSensorFaultOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js 22 required for E1-A independent replay")
        result = subprocess.run(
            [node, str(BRIDGE)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        if result.returncode:
            raise RuntimeError(f"Failed fault bridge: {result.stderr}")
        cls.data = json.loads(result.stdout)

    def test_independent_certified_measurement_and_prediction_intervals(self):
        for case in self.data["results"]:
            p = case["options"]
            n, S = p["plantAgents"], p["plantSafeBound"]
            A, B, W = p["plantA"], p["plantB"], p["plantDisturbanceBound"]
            I = p["plantInitialMagnitude"]
            prior = [(-I, I) for _ in range(n)]
            true_state = case["initial"][:]
            self.assertEqual(len(case["records"]), case["completedSteps"] * n)
            for step in range(1, case["completedSteps"] + 1):
                rows = case["records"][(step - 1) * n:step * n]
                self.assertEqual([r["node"] for r in rows], list(range(n)))
                predicted = []
                for row in rows:
                    i, y = row["node"], row["trustedSensor"]
                    v = row["sensorBound"]
                    L, H = prior[i]
                    if y is None:
                        self.assertIsNone(v)
                        self.assertEqual(row["sensorStatus"], "dropout")
                        self.assertEqual(row["measurementOrigin"], "prediction")
                    else:
                        self.assertIsNotNone(v)
                        self.assertLessEqual(abs(y - true_state[i]), v + TOL)
                        L = max(L, -S, y - v)
                        H = min(H, S, y + v)
                        self.assertEqual(row["measurementOrigin"], "trusted")
                    self.assertLessEqual(L, H + TOL)
                    self.assertLessEqual(L - TOL, true_state[i])
                    self.assertLessEqual(true_state[i], H + TOL)
                    actual_interval = row["certifiedInterval"]
                    self.assertAlmostEqual(L, actual_interval["min"], places=10)
                    self.assertAlmostEqual(H, actual_interval["max"], places=10)
                    if row["sensorStatus"] == "dropout" and row["honest"]:
                        self.assertAlmostEqual(row["emittedValue"], (L + H) / 2, places=10)
                    # Independently compute robust intersection for requested u.
                    u_lower = max(-p["plantControlLimit"],
                                  (-S + W - A * L) / B)
                    u_upper = min(p["plantControlLimit"],
                                  (S - W - A * H) / B)
                    self.assertLessEqual(u_lower, u_upper + TOL)
                    self.assertAlmostEqual(u_lower, row["safeLo"], places=10)
                    self.assertAlmostEqual(u_upper, row["safeHi"], places=10)
                    u = min(u_upper, max(u_lower, row["requested"]))
                    self.assertAlmostEqual(u, row["control"], places=10)
                    x_next = A * true_state[i] + B * u + row["disturbance"]
                    self.assertAlmostEqual(x_next, row["stateAfter"], places=10)
                    self.assertLessEqual(abs(x_next), S + TOL)
                    predicted.append((A * L + B * u - W,
                                      A * H + B * u + W))
                    self.assertLessEqual(abs(row["disturbance"]), W + TOL)
                    true_state[i] = x_next
                prior = predicted
            for a, b in zip(true_state, case["final"]):
                self.assertAlmostEqual(a, b, places=10)

    def test_no_success_only_rmse_or_hidden_clipping_after_certification_loss(self):
        count_fail = 0
        for case in self.data["results"]:
            p, m = case["options"], case["metrics"]
            values = [r["stateAfter"] ** 2 for r in case["records"] if r["honest"]]
            if case["status"] == "completed":
                self.assertEqual(case["completedSteps"], p["plantSteps"])
                expected = sum(values) / len(values)
                self.assertAlmostEqual(m["fixedHorizonLoss"], expected, places=10)
                self.assertAlmostEqual(m["honestStateRmse"] ** 2, expected, places=10)
                self.assertIsNone(case["certificateFailure"])
            else:
                count_fail += 1
                self.assertEqual(case["status"], "certification_lost")
                self.assertLess(case["completedSteps"], p["plantSteps"])
                self.assertIsNone(m["honestStateRmse"])
                self.assertEqual(m["fixedHorizonLoss"], p["plantCertificationPenalty"])
                self.assertIsNotNone(case["certificateFailure"])
            self.assertEqual(m["certificationLost"], int(case["status"] != "completed"))
            self.assertTrue(all(
                abs(r["stateAfter"]) <= p["plantSafeBound"] + TOL
                for r in case["records"]
            ))
            self.assertTrue(all(
                h["slots"] <= h["capacity"] for h in case["history"]
                if h["slots"] is not None
            ))
        self.assertGreater(count_fail, 0, "Long blackout must expose the abort path")

    def test_no_sensor_readings_can_be_faked_for_local_sensor_baseline(self):
        for case in self.data["results"]:
            honest = [r for r in case["records"] if r["honest"]]
            missing = [r for r in honest if r["sensorStatus"] == "dropout"]
            if case["options"]["plantSensorFaultMode"] == "dropout":
                self.assertTrue(missing)
                self.assertTrue(all(r["trustedSensor"] is None for r in missing))
                if case["options"]["plantControlMode"] == "local_sensor":
                    self.assertTrue(all(
                        r["controlSource"] == "prediction_fallback"
                        and r["refused"]
                        for r in missing
                    ))
            else:
                self.assertTrue(all(r["trustedSensor"] is not None for r in honest))
                self.assertTrue(any(
                    r["sensorStatus"] == "degraded" and r["sensorBound"] ==
                    case["options"]["plantDegradedSensorBound"]
                    for r in honest
                ))


    def test_loss_of_certification_has_independently_impossible_width(self):
        found = False
        for case in self.data["results"]:
            failure = case["certificateFailure"]
            if not failure:
                continue
            if failure["phase"] != "control_feasibility":
                continue
            p = case["options"]
            interval = failure["certifiedInterval"]
            L, H = interval["min"], interval["max"]
            image_width = (p["plantA"] * (H - L) +
                           2 * p["plantDisturbanceBound"])
            if "ширина" in failure["reason"]:
                self.assertGreater(image_width, 2 * p["plantSafeBound"] + 1e-10)
                found = True
        self.assertTrue(found, "Long outage must expose the necessary width failure")


if __name__ == "__main__":
    unittest.main()
