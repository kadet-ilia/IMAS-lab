#!/usr/bin/env python3
"""Independent Python arithmetic audit of frozen E1-A M5-B JSON/CSV exports.

No import from JavaScript simulation; recompute per-run paired deltas,
per-cell means, run coverage, factorial identity and first-trace pairing.
This is arithmetic integrity, NOT independent validation of attack physics.
"""
import csv
import json
import math
import sys
from pathlib import Path

EPS = 1e-10
STAGE_LENGTHS = {"smoke": (3, 2), "exploratory": (80, 20),
                 "confirmatory": (16, 80)}


def close(a, b, context):
    if not (math.isfinite(a) and math.isfinite(b) and
            math.isclose(a, b, rel_tol=EPS, abs_tol=EPS)):
        raise AssertionError(f"{context}: {a!r} != {b!r}")


def mean(values):
    return sum(values) / len(values)


def audit(directory):
    root = Path(directory)
    manifests = sorted(root.glob("*/protocol-manifest.json"))
    if not manifests:
        raise AssertionError("No M5-B protocol manifests found")
    reports = []
    for manifest_path in manifests:
        folder = manifest_path.parent
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        design = manifest["design"]
        if design["protocol"] != "e1a-periodic-correlation-factorial-1.0.0":
            raise AssertionError("Unknown scientific protocol")
        if not all(manifest[k] for k in ("sourceSha256", "fingerprint", "designSha256")):
            raise AssertionError("Incomplete source/protocol fingerprint")
        stage_files = sorted(folder.glob("*-summary.json"))
        if not stage_files:
            raise AssertionError("No complete campaign stage for " + str(folder))
        for stage_file in stage_files:
            stage = stage_file.name.removesuffix("-summary.json")
            if stage not in STAGE_LENGTHS:
                raise AssertionError("Unexpected stage " + stage)
            count, runs = STAGE_LENGTHS[stage]
            summary = json.loads(stage_file.read_text(encoding="utf-8"))
            assert summary["fingerprint"] == manifest["fingerprint"]
            assert summary["sourceSha256"] == manifest["sourceSha256"]
            assert summary["conditionsCount"] == count
            assert summary["cellRuns"] == count * runs
            assert summary["individualSimulations"] == count * runs * 3
            assert len(summary["conditions"]) == count
            expected = design["stages"][stage]
            assert len(expected) == count
            condition_ids = set()
            for index, cell in enumerate(expected):
                assert cell["runs"] == runs
                assert summary["conditions"][index]["id"] == cell["id"]
                assert cell["id"] not in condition_ids
                condition_ids.add(cell["id"])
                cell_path = folder / stage / (cell["id"] + ".json")
                saved = json.loads(cell_path.read_text(encoding="utf-8"))
                assert saved["fingerprint"] == manifest["fingerprint"]
                assert saved["cell"] == cell
                rows = saved["runs"]
                assert len(rows) == runs
                assert [x["run"] for x in rows] == list(range(runs))
                assert all(x["seed"] == cell["seed"] for x in rows)
                assert all(x["cell"] == cell["id"] for x in rows)
                for row in rows:
                    for mode, suffix in (("adaptive", "Adaptive"),
                                         ("risk", "Risk"),
                                         ("discrete", "Discrete")):
                        close(row["delta" + suffix + "Combined"],
                              row[mode + "Rmse"] - row["combinedRmse"],
                              f"{cell['id']}:run{row['run']}:{mode} RMSE")
                        close(row["deltaLoss" + suffix + "Combined"],
                              row[mode + "Loss"] - row["combinedLoss"],
                              f"{cell['id']}:run{row['run']}:{mode} loss")
                        assert 0 <= row[mode + "Coverage"] <= 1
                first_trace = saved["firstTrace"]
                assert set(first_trace) == {
                    "adaptive", "risk_aware", "regime_aware_discrete"}
                for mode, trajectory in first_trace.items():
                    assert len(trajectory) == 48
                    assert [x["step"] for x in trajectory] == list(range(1, 49))
                    for i, tick in enumerate(trajectory):
                        control = first_trace["adaptive"][i]
                        close(tick["combined"], control["combined"],
                              f"{cell['id']}:step{i}:{mode} baseline")
                        close(tick["intensity"], control["intensity"],
                              f"{cell['id']}:step{i}:{mode} intensity")
                for mode, suffix in (("adaptive", "Adaptive"),
                                     ("risk", "Risk"),
                                     ("discrete", "Discrete")):
                    close(saved["summary"]["meanDelta" + suffix + "Combined"],
                          mean([x["delta" + suffix + "Combined"] for x in rows]),
                          f"{cell['id']} mean {mode}")
                # Confirmatory aggregation appends inferential annotations
                # only to the stage summary. Check scientific cell fields
                # exactly; do not require the checkpoint to retroactively
                # contain appended sign-flip / Holm p-values.
                stage_cell = summary["conditions"][index]
                base_cell = saved["summary"]
                assert set(stage_cell) == set(base_cell) | (
                    {"signFlipP", "holmP"} if stage == "confirmatory" else set())
                assert all(stage_cell[k] == v for k, v in base_cell.items())
                if stage == "confirmatory":
                    p, adjusted = stage_cell["signFlipP"], stage_cell["holmP"]
                    assert math.isfinite(p) and 0 <= p <= 1
                    assert math.isfinite(adjusted) and p <= adjusted <= 1
            condition_rows = list(csv.DictReader(
                (folder / (stage + "-conditions.csv")).open(
                    encoding="utf-8", newline=""), delimiter=";"))
            run_rows = list(csv.DictReader(
                (folder / (stage + "-per-run.csv")).open(
                    encoding="utf-8", newline=""), delimiter=";"))
            assert len(condition_rows) == count
            assert len(run_rows) == count * runs
            assert [x["id"] for x in condition_rows] == [
                c["id"] for c in expected]
            assert len({x["cell"] for x in run_rows}) == count
            for mode, suffix in (("adaptive", "Adaptive"),
                                 ("risk", "Risk"),
                                 ("discrete", "Discrete")):
                close(summary["overall"][mode]["meanDeltaRmse"],
                      mean([r["meanDelta" + suffix + "Combined"]
                            for r in summary["conditions"]]),
                      f"{stage}:mean {mode}")
            if stage == "confirmatory":
                # Independently reconstruct Holm step-down adjustment from
                # published per-cell raw p values (without importing JS).
                raw = [c["signFlipP"] for c in summary["conditions"]]
                indexed = sorted(enumerate(raw), key=lambda pair: pair[1])
                corrected = [None] * len(raw)
                largest = 0.0
                for rank, (cell_index, p_value) in enumerate(indexed):
                    largest = max(largest, min(1.0, (len(raw)-rank) * p_value))
                    corrected[cell_index] = largest
                for cell_index, value in enumerate(corrected):
                    close(summary["conditions"][cell_index]["holmP"],
                          value, f"Holm correction cell {cell_index}")
            reports.append({
                "stage": stage, "cells": count,
                "paired_runs": count * runs,
                "method_simulations": count * runs * 3,
                "status": "arithmetic_verified",
            })
    return reports


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: auditPeriodicCampaign.py <periodic-results-dir>")
    for result in audit(sys.argv[1]):
        print("M5-B AUDIT " + json.dumps(result, ensure_ascii=False))
