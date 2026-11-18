#!/usr/bin/env python3
"""M7 arithmetic reconciliation for performance pilot exports.

Does NOT validate wall clock/CPU accuracy or establish cross-machine
comparability. No external Python dependencies.
"""
import csv
import json
import math
import statistics
import sys
from pathlib import Path

CASES = {"common_estimator", "closed_decision_feedback"}
MODES = {"adaptive", "risk_aware", "regime_aware_discrete",
         "regime_aware_blend"}


def close(a, b, note):
    assert math.isfinite(a) and math.isfinite(b), note
    assert math.isclose(a, b, abs_tol=1e-8, rel_tol=1e-8), (
        note, a, b)


def percentile(values, p):
    ordered = sorted(values)
    position = p * (len(values) - 1)
    low = math.floor(position)
    return ordered[low] + (ordered[min(low+1, len(ordered)-1)] -
                           ordered[low]) * (position-low)


def audit(root):
    root = Path(root)
    reports = []
    for summary_path in sorted(root.glob("*/**/*-summary.json")):
        report = json.loads(summary_path.read_text(encoding="utf-8"))
        assert report["protocol"] == "e1a-cost-pilot-1.0.0"
        stage = report["stage"]
        assert stage in {"smoke", "reference"}
        n = 2 if stage == "smoke" else 16
        assert report["observationsPerModePerWorkload"] == n
        assert report["measurements"] == 2*4*n
        assert len(report["sourceSha256"]) == 64
        assert len(report["planSha256"]) == 64
        assert report["host"]["logicalCpus"] > 0
        assert len(report["groups"]) == 8
        data_path = summary_path.with_name(stage + "-per-run.csv")
        with data_path.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream, delimiter=";"))
        assert len(rows) == 8*n
        ids = [(x["workload"], x["mode"], int(x["run"])) for x in rows]
        assert len(set(ids)) == len(ids)
        assert {x["workload"] for x in rows} == CASES
        assert {x["mode"] for x in rows} == MODES
        for row in rows:
            assert int(row["run"]) in range(n)
            assert int(row["steps"]) == 48
            assert float(row["wallMs"]) > 0
            assert float(row["cpuMs"]) >= 0
            assert 0 <= float(row["coverage"]) <= 1
            assert math.isfinite(float(row["rmse"]))
            assert math.isfinite(float(row["controlRmse"]))
        for c in CASES:
            for run in range(n):
                values = [float(x["controlRmse"]) for x in rows
                          if x["workload"] == c and int(x["run"]) == run]
                assert len(values) == 4
                for value in values[1:]:
                    close(value, values[0], "unchanged combined E1")
        for group in report["groups"]:
            assert group["workload"] in CASES
            assert group["mode"] in MODES
            data = [x for x in rows if x["workload"] == group["workload"]
                    and x["mode"] == group["mode"]]
            assert len(data) == group["runs"] == n
            wall = [float(x["wallMs"]) for x in data]
            cpu = [float(x["cpuMs"]) for x in data]
            rmse = [float(x["rmse"]) for x in data]
            close(group["wallMedianMs"], statistics.median(wall), "wall median")
            close(group["wallQ25Ms"], percentile(wall, 0.25), "Q25")
            close(group["wallQ75Ms"], percentile(wall, 0.75), "Q75")
            close(group["cpuMedianMs"], statistics.median(cpu), "CPU median")
            close(group["meanRmse"], statistics.mean(rmse), "mean RMSE")
        reports.append({"stage": stage, "observations": len(rows),
                        "checkedGroups": 8, "status": "arithmetic_verified"})
    if not reports:
        raise AssertionError("M7 benchmark output missing")
    return reports


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: auditCostBenchmark.py <cost-results-directory>")
    for record in audit(sys.argv[1]):
        print("M7 COST AUDIT " + json.dumps(record, ensure_ascii=False))
