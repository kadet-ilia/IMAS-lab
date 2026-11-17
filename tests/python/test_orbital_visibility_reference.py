"""Independent Python reconstruction of opt-in 3D physical observation.

Node provides only input options and simulation trace. Python computes
geometry, geometry-derived measurement bounds, historical propagation,
f-contamination fusion, certified shield and actual plant transitions.
No JavaScript geometry, projection or f-hull arithmetic is reused.
"""
from __future__ import annotations

import json
import math
import pathlib
import shutil
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = ROOT / "tests/gui/localOrbitalVisibilityReferenceBridge.mjs"
TOL = 1e-9


def geometry(p, source, target, time):
    n = p["plantAgents"]
    planes = p["plantCrossOrbitPlanes"]
    per = n // planes
    radius = p["plantCrossOrbitRadius"]
    inclination = p["plantCrossOrbitInclination"]
    rate = p["plantCrossOrbitAngularRate"]
    uncertainty = p["plantCrossOrbitPositionError"]

    def orbit(idx):
        plane, offset = divmod(idx, per)
        azimuth = 2 * math.pi * plane / planes
        phase = 2 * math.pi * offset / per + rate * (time - 1)
        co, so = math.cos(azimuth), math.sin(azimuth)
        cp, sp = math.cos(phase), math.sin(phase)
        ci, si = math.cos(inclination), math.sin(inclination)
        xyz = [radius * (co * cp - so * ci * sp),
               radius * (so * cp + co * ci * sp),
               radius * si * sp]
        tangent = [-co * sp - so * ci * cp,
                   -so * sp + co * ci * cp, si * cp]
        return xyz, tangent

    a, boresight = orbit(source)
    b, _ = orbit(target)
    delta = [y-x for x, y in zip(a, b)]
    product = lambda u, v: sum(x*y for x, y in zip(u, v))
    norm = lambda u: math.sqrt(product(u, u))
    d = norm(delta)
    d_upper = d + 2 * uncertainty
    range_ok = (d > 2 * uncertainty + 1e-10 and
                d_upper <= p["plantCrossMaxRange"] + 1e-10)
    fraction = (max(0.0, min(1.0, -product(a, delta) / (d*d)))
                if d > 1e-10 else 0.0)
    nearest = [x + fraction*y for x, y in zip(a, delta)]
    closest = norm(nearest)
    clear = closest > p["plantCrossCentralBodyRadius"]+uncertainty+1e-10
    angle = (math.acos(max(-1.0,min(1.0,product(boresight,delta)/d)))
             if d > 1e-10 else math.pi)
    direction_error = (math.asin(min(1.0, 2*uncertainty/(d-2*uncertainty)))
                       if d > 2*uncertainty + 1e-10 else math.pi/2)
    pointing = (
        p["plantCrossPointingMode"] == "omnidirectional" or
        angle + direction_error + p["plantCrossOrbitPointingError"] <=
        p["plantCrossPointingHalfAngle"] + 1e-10)
    error = p["plantCrossBound"] + p["plantCrossDistanceErrorSlope"]*d_upper
    return {"eligible":range_ok and clear and pointing,
            "rangeAllowed":range_ok, "occultationFree":clear,
            "pointingAllowed":pointing, "distance":d,
            "errorBound":error, "closest":closest,
            "nominalAngle":angle, "directionError":direction_error,
            "maxTrueDistance":d_upper}


class TestOrbitalCrossSensorIndependentReference(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        exe = shutil.which("node")
        if not exe:
            raise RuntimeError("Node 22 required")
        proc = subprocess.run([exe, str(BRIDGE)], cwd=ROOT,
                              text=True, capture_output=True,
                              timeout=70, check=False)
        if proc.returncode:
            raise RuntimeError(proc.stderr)
        cls.results = json.loads(proc.stdout)["results"]

    def test_orbital_geometry_and_spherical_occlusion_without_js_arithmetic(self):
        self.assertEqual(len(self.results), 5)
        hidden = available = pointing_blocked = 0
        for case in self.results:
            p = case["options"]
            for item in case["snapshot"]:
                actual = geometry(p, item["source"], item["target"], item["time"])
                seen = item["visibility"]
                for key in ["eligible","rangeAllowed","occultationFree",
                            "pointingAllowed"]:
                    self.assertEqual(actual[key], seen[key], key)
                for key in ["distance","errorBound","closest","nominalAngle",
                            "directionError","maxTrueDistance"]:
                    self.assertAlmostEqual(actual[key], seen[key], delta=TOL)
                hidden += not actual["occultationFree"]
                available += actual["eligible"]
                pointing_blocked += not actual["pointingAllowed"]
        self.assertGreater(hidden, 0)
        self.assertGreater(available, 0)
        self.assertGreater(pointing_blocked, 0)

    def test_historical_sensor_certificates_and_robust_barrier(self):
        refined = 0
        for case in self.results:
            p = case["options"]
            n = p["plantAgents"]
            S, A, B = p["plantSafeBound"], p["plantA"], p["plantB"]
            W, U = p["plantDisturbanceBound"], p["plantControlLimit"]
            f = p["plantCrossFaultBudget"]
            tape = []
            prior = [(-p["plantInitialMagnitude"], p["plantInitialMagnitude"])
                     for _ in range(n)]
            physical = list(case["initial"])
            self.assertEqual(len(case["records"]), n*case["completedSteps"])
            for time in range(1, case["completedSteps"]+1):
                rows = case["records"][(time-1)*n:time*n]
                next_prior = []
                next_physical = []
                applied = []
                for r in rows:
                    i = r["node"]
                    self.assertAlmostEqual(r["stateBefore"],physical[i],
                                           delta=TOL)
                    L, H = prior[i]
                    y = r["trustedSensor"]
                    v = r["sensorBound"]
                    if y is not None:
                        self.assertLessEqual(abs(y-physical[i]),v+TOL)
                        L = max(L,y-v,-S)
                        H = min(H,y+v,S)
                    else:
                        self.assertIsNone(v)
                    intervals = []
                    sources = set()
                    for report in r["crossReports"]:
                        sender = report["source"]
                        s = report["emitted"]
                        self.assertEqual(report["target"],i)
                        self.assertNotIn(sender,sources)
                        sources.add(sender)
                        self.assertLess(s,time)
                        self.assertLessEqual(time-s,p["plantCrossTTL"])
                        self.assertLessEqual(report["arrived"],time)
                        g = geometry(p,sender,i,s)
                        self.assertTrue(g["eligible"])
                        err = g["errorBound"]
                        if sender < n-p["plantByzantine"]:
                            x_past = case["records"][(s-1)*n+i]["stateBefore"]
                            self.assertLessEqual(abs(report["value"]-x_past),
                                                 err+TOL)
                        a = report["value"]-err
                        b = report["value"]+err
                        for k in range(s,time):
                            command = tape[k-1][i]
                            a = A*a+B*command-W
                            b = A*b+B*command+W
                        intervals.append((max(-S,a),min(S,b)))
                    self.assertEqual(len(sources),r["crossReporters"])
                    m = len(intervals)
                    count = m-f
                    if count > 0:
                        candidates = sorted({x for pair in intervals for x in pair})
                        feasible = [x for x in candidates if sum(
                            lo <= x+1e-10 and hi >= x-1e-10
                            for lo,hi in intervals if lo <= hi
                        ) >= count]
                        self.assertTrue(feasible)
                        L = max(L,feasible[0])
                        H = min(H,feasible[-1])
                        self.assertTrue(r["crossSupported"])
                    else:
                        self.assertFalse(r["crossSupported"])
                    self.assertLessEqual(L,H+TOL)
                    self.assertLessEqual(L-TOL,physical[i])
                    self.assertLessEqual(physical[i],H+TOL)
                    self.assertAlmostEqual(r["certifiedInterval"]["min"],
                                           L,delta=TOL)
                    self.assertAlmostEqual(r["certifiedInterval"]["max"],
                                           H,delta=TOL)
                    refined += r["crossRefined"]
                    low = max(-U,(-S+W-A*L)/B)
                    high = min(U,(S-W-A*H)/B)
                    self.assertLessEqual(low,high+TOL)
                    self.assertAlmostEqual(low,r["safeLo"],delta=TOL)
                    self.assertAlmostEqual(high,r["safeHi"],delta=TOL)
                    command = min(high,max(low,r["requested"]))
                    self.assertAlmostEqual(command,r["control"],delta=TOL)
                    state = A*physical[i]+B*command+r["disturbance"]
                    self.assertAlmostEqual(state,r["stateAfter"],delta=TOL)
                    self.assertLessEqual(abs(state),S+TOL)
                    applied.append(command)
                    next_physical.append(state)
                    next_prior.append((A*L+B*command-W,A*H+B*command+W))
                physical = next_physical
                prior = next_prior
                tape.append(applied)
            self.assertEqual(case["network"]["generated"],
                sum(case["network"][key] for key in
                    ["delivered","lost","blocked","expired","superseded","pending"]))
            self.assertTrue(all(r["slotsUsed"]<=p["plantCapacity"]
                                for r in case["rows"]))
        self.assertGreater(refined,0)


if __name__ == "__main__":
    unittest.main()
