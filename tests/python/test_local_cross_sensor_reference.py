"""Independent cross-sensor observer and shield oracle.

Node exports timestamped authenticated remote reports and executed controls.
Python recomputes every causal interval without importing the JS arithmetic.
Truth and simulator Byzantine membership are used ONLY for posterior checks.
"""
from __future__ import annotations
import json
import math
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "tests" / "gui" / "localPlantCrossSensorReferenceBridge.mjs"
EPS = 1e-9


class TestCrossSensorIndependentOracle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node.js 22 is required for independent replay")
        proc = subprocess.run([node, str(BRIDGE)], cwd=ROOT, capture_output=True,
                              text=True, timeout=60, check=False)
        if proc.returncode:
            raise RuntimeError(proc.stderr)
        cls.results = json.loads(proc.stdout)["results"]

    def test_certified_robust_fusion_and_physical_plant(self):
        found_refined = found_uninformative = 0
        for case in self.results:
            p = case["options"]
            n = p["plantAgents"]
            S = p["plantSafeBound"]
            A, B = p["plantA"], p["plantB"]
            W, U = p["plantDisturbanceBound"], p["plantControlLimit"]
            f = p["plantCrossFaultBudget"]
            t_max = case["completedSteps"]
            self.assertEqual(len(case["records"]), t_max * n)
            prior = [(-p["plantInitialMagnitude"], p["plantInitialMagnitude"])
                     for _ in range(n)]
            actual_states = list(case["initial"])
            executed = []
            for t in range(1, t_max + 1):
                records = case["records"][(t - 1) * n:t * n]
                self.assertEqual([r["node"] for r in records], list(range(n)))
                predictions, applied, updated = [], [], []
                for r in records:
                    i = r["node"]
                    self.assertAlmostEqual(r["stateBefore"], actual_states[i],
                                           delta=EPS)
                    L, H = prior[i]
                    y, accuracy = r["trustedSensor"], r["sensorBound"]
                    if y is None:
                        self.assertIsNone(accuracy)
                    else:
                        self.assertLessEqual(abs(y - actual_states[i]),
                                             accuracy + EPS)
                        L = max(L, -S, y - accuracy)
                        H = min(H, S, y + accuracy)
                    # All received reports are distinct, source-authenticated
                    # direct measurements of the target's earlier PHYSICAL state.
                    reporters = r["crossReports"]
                    self.assertEqual(len(reporters), r["crossReporters"])
                    self.assertEqual(len({q["source"] for q in reporters}),
                                     len(reporters))
                    derived = []
                    for packet in reporters:
                        src, target, s = (packet["source"], packet["target"],
                                          packet["emitted"])
                        self.assertEqual(target, i)
                        self.assertNotEqual(src, target)
                        self.assertLess(s, t)
                        self.assertGreaterEqual(packet["arrived"], s + 1)
                        self.assertLessEqual(packet["arrived"], t)
                        self.assertLessEqual(t - s, p["plantCrossTTL"])
                        self.assertLessEqual(abs(packet["value"]), S + EPS)
                        # Physical admissibility and certified precision
                        # are re-derived independently from public geometry.
                        # The reporter does NOT choose its error tolerance.
                        if p["plantCrossObservationMode"] == "range_geometry":
                            gap = min(abs(src - i), n - abs(src - i))
                            distance = (2 * p["plantCrossGeometryRadius"] *
                                        math.sin(math.pi * gap / n))
                            self.assertLessEqual(
                                distance,p["plantCrossMaxRange"] + EPS)
                            certified_error = (p["plantCrossBound"] +
                                p["plantCrossDistanceErrorSlope"] * distance)
                        else:
                            certified_error = p["plantCrossBound"]
                        self.assertLess(certified_error,S)
                        # The simulator's actual honest noise is checked
                        # POST HOC, not used in certificate fusion.
                        if src < n - p["plantByzantine"]:
                            past_true = case["records"][(s - 1) * n + i]["stateBefore"]
                            self.assertLessEqual(abs(packet["value"] - past_true),
                                                 certified_error + EPS)
                        lo = packet["value"] - certified_error
                        hi = packet["value"] + certified_error
                        for k in range(s, t):
                            u = executed[k - 1][target]
                            lo = A * lo + B * u - W
                            hi = A * hi + B * u + W
                        derived.append((max(-S, lo), min(S, hi)))
                    m, q = len(derived), len(derived) - f
                    if q <= 0:
                        found_uninformative += 1
                        self.assertFalse(r["crossSupported"])
                    else:
                        candidates = sorted(set(
                            v for interval in derived for v in interval
                            if math.isfinite(v)
                        ))
                        endpoints = [x for x in candidates if sum(
                            lo <= x + 1e-10 and hi >= x - 1e-10
                            for lo, hi in derived if lo <= hi
                        ) >= q]
                        self.assertTrue(endpoints)
                        L = max(L, endpoints[0])
                        H = min(H, endpoints[-1])
                        self.assertTrue(r["crossSupported"])
                    self.assertLessEqual(L, H + EPS)
                    self.assertLessEqual(L - EPS, actual_states[i])
                    self.assertLessEqual(actual_states[i], H + EPS)
                    certified = r["certifiedInterval"]
                    self.assertAlmostEqual(certified["min"], L, delta=EPS)
                    self.assertAlmostEqual(certified["max"], H, delta=EPS)
                    if r["crossRefined"]:
                        found_refined += 1
                    lo_u = max(-U, (-S + W - A * L) / B)
                    hi_u = min(U, (S - W - A * H) / B)
                    self.assertLessEqual(lo_u, hi_u + EPS)
                    self.assertAlmostEqual(lo_u, r["safeLo"], delta=EPS)
                    self.assertAlmostEqual(hi_u, r["safeHi"], delta=EPS)
                    u = min(hi_u, max(lo_u, r["requested"]))
                    self.assertAlmostEqual(u, r["control"], delta=EPS)
                    x_next = A * actual_states[i] + B * u + r["disturbance"]
                    self.assertAlmostEqual(x_next, r["stateAfter"], delta=EPS)
                    self.assertLessEqual(abs(x_next), S + EPS)
                    predictions.append((A * L + B * u - W,
                                        A * H + B * u + W))
                    updated.append(x_next)
                    applied.append(u)
                executed.append(applied)
                actual_states = updated
                prior = predictions
            for a, b in zip(actual_states, case["final"]):
                self.assertAlmostEqual(a, b, delta=EPS)
        self.assertGreater(found_refined, 0,
                           "Dense cross sensing should cause measurable refinement")
        self.assertGreater(found_uninformative, 0,
                           "m<=f must never invent certifying information")

    def test_range_geometry_bounds_coverage_without_faking_observability(self):
        geometric = [c for c in self.results if
                     c["options"]["plantCrossObservationMode"] ==
                     "range_geometry"]
        self.assertTrue(geometric)
        for case in geometric:
            p, n = case["options"], case["options"]["plantAgents"]
            minimum = 2 * p["plantCrossGeometryRadius"] * math.sin(math.pi / n)
            if p["plantCrossMaxRange"] < minimum - EPS:
                self.assertEqual(case["crossTransport"]["generated"],0)
                self.assertTrue(all(
                    not row["crossSupported"] and not row["crossRefined"]
                    for row in case["records"]))
            for row in case["records"]:
                self.assertLessEqual(row["crossReporters"],
                    n - 1)
                self.assertLessEqual(row["crossRequiredSupport"],
                    max(0,row["crossReporters"] - p["plantCrossFaultBudget"]))

    def test_shared_resource_and_full_horizon_censoring(self):
        for case in self.results:
            p, metrics = case["options"], case["metrics"]
            link = case["crossTransport"]
            self.assertEqual(
                link["generated"],
                link["delivered"] + link["lost"] + link["blocked"] +
                link["expired"] + link["superseded"] + link["pending"]
            )
            for row in case["rows"]:
                self.assertLessEqual(row["slotsUsed"], p["plantCapacity"])
                self.assertLessEqual(row["crossSent"], row["crossBudget"])
                self.assertLessEqual(row["crossSent"] + row["transmitted"],
                                     p["plantCapacity"])
            if case["status"] == "completed":
                self.assertEqual(case["completedSteps"], p["plantSteps"])
                honest = [r["V"] for r in case["records"] if r["honest"]]
                self.assertAlmostEqual(
                    metrics["fixedHorizonLoss"],
                    sum(honest) / len(honest),
                    delta=EPS
                )
            else:
                self.assertEqual(case["status"], "certification_lost")
                self.assertLess(case["completedSteps"], p["plantSteps"])
                self.assertIsNone(metrics["honestStateRmse"])
                self.assertEqual(metrics["fixedHorizonLoss"],
                                 p["plantCertificationPenalty"])


if __name__ == "__main__":
    unittest.main()
