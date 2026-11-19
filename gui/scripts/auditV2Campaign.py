#!/usr/bin/env python3
"""Independent E1-A v2 arithmetic audit. Not a field validation of cyber-risk.

Read primary per-cell JSON and CSV, recompute delta RMSE, refusal loss,
descriptive cell means, condition and campaign totals and Holm p adjustment.
No imports from the JS statistics or simulator implementation.
"""
import csv
import json
import math
import sys
from pathlib import Path

MODES = {
    "adaptive": "adaptive", "risk_aware": "risk",
    "regime_aware": "v1",
    "regime_aware_v2_discrete": "v2Discrete",
    "regime_aware_v2_blend": "v2Blend",
}
SIZES = {"smoke": (3, 2), "train": (48, 12), "holdout": (12, 60)}


def near(a, b, context):
    assert math.isfinite(a) and math.isfinite(b), context
    assert math.isclose(a, b, abs_tol=1e-10, rel_tol=1e-10), (
        context, a, b)


def avg(x):
    return sum(x) / len(x)


def verify(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf8"))
    assert manifest["protocol"] == "e1a-v2-huber-regret-factorial-1.0.0"
    assert all(len(manifest[k]) == 64
               for k in ("sourceHash", "planHash", "fingerprint"))
    reports = []
    for summary_file in sorted(folder.glob("*-summary.json")):
        stage = summary_file.name.removesuffix("-summary.json")
        count, runs_per_cell = SIZES[stage]
        data = json.loads(summary_file.read_text(encoding="utf8"))
        assert data["fingerprint"] == manifest["fingerprint"]
        assert data["planHash"] == manifest["planHash"]
        assert data["sourceHash"] == manifest["sourceHash"]
        assert data["cells"] == count
        assert data["wholeRunPairs"] == count * runs_per_cell
        assert data["modelExecutions"] == count * runs_per_cell * len(MODES)
        assert len(data["conditions"]) == count
        assert len(manifest["design"]["stages"][stage]) == count
        all_rows = []
        for index, cell in enumerate(manifest["design"]["stages"][stage]):
            record = json.loads((folder / (stage + "__" + cell["id"] + ".json"))
                                .read_text(encoding="utf8"))
            assert record["fingerprint"] == manifest["fingerprint"]
            assert record["cell"] == cell
            assert len(record["rows"]) == cell["runs"] == runs_per_cell
            assert record["condition"]["id"] == cell["id"]
            actual_condition = data["conditions"][index]
            # Holdout adds test statistics in campaign summary only, after
            # immutable per-cell checkpoint has already been written.
            assert all(actual_condition[k] == v
                       for k, v in record["condition"].items())
            if stage == "holdout":
                assert set(actual_condition) == set(record["condition"]) | {
                    "signFlipP", "holmP"}
                assert 0 <= actual_condition["signFlipP"] <= 1
                assert actual_condition["signFlipP"] <= actual_condition["holmP"] <= 1
            else:
                assert actual_condition == record["condition"]
            first = record["firstTraces"]
            assert set(first) == set(MODES)
            for name, ticks in first.items():
                assert len(ticks) == 48
                assert [t["step"] for t in ticks] == list(range(1, 49))
                for t, anchor in zip(ticks, first["adaptive"]):
                    near(t["control"], anchor["control"],
                         cell["id"] + " historical E1 " + name)
                    near(t["effectiveIntensity"], anchor["effectiveIntensity"],
                         cell["id"] + " exogenous attacks " + name)
            rows = record["rows"]
            assert [x["index"] for x in rows] == list(range(runs_per_cell))
            assert all(x["seed"] == cell["seed"] for x in rows)
            assert all(x["id"] == cell["id"] for x in rows)
            for row in rows:
                for mode, prefix in MODES.items():
                    near(row[prefix+"Delta"],
                         row[prefix+"Rmse"]-row["controlRmse"],
                         cell["id"]+mode+" RMSE delta")
                    near(row[prefix+"LossDelta"],
                         row[prefix+"Loss"]-row["controlLoss"],
                         cell["id"]+mode+" refusal-loss delta")
                    assert 0 <= row[prefix+"Coverage"] <= 1
                    assert row[prefix+"Switches"] >= 0
                assert 0 <= row["activeTicks"] <= 48
            near(record["condition"]["activeTicks"],
                 avg([r["activeTicks"] for r in rows]), "attack exposure")
            for mode, prefix in MODES.items():
                near(record["condition"][prefix+"Delta"],
                     avg([r[prefix+"Delta"] for r in rows]),
                     cell["id"]+mode+" mean")
                near(record["condition"][prefix+"LossDelta"],
                     avg([r[prefix+"LossDelta"] for r in rows]),
                     cell["id"]+mode+" loss")
                near(record["condition"][prefix+"Switches"],
                     avg([r[prefix+"Switches"] for r in rows]),
                     cell["id"]+mode+" switching")
            all_rows.extend(rows)
        assert len(all_rows) == count * runs_per_cell
        with (folder / (stage+"-per-run.csv")).open(
                encoding="utf8", newline="") as stream:
            csv_rows = list(csv.DictReader(stream, delimiter=";"))
        assert len(csv_rows) == len(all_rows)
        assert [x["id"] for x in csv_rows] == [x["id"] for x in all_rows]
        assert [int(x["index"]) for x in csv_rows] == [
            x["index"] for x in all_rows]
        with (folder / (stage+"-conditions.csv")).open(
                encoding="utf8", newline="") as stream:
            csv_cells = list(csv.DictReader(stream, delimiter=";"))
        assert len(csv_cells) == count
        assert [x["id"] for x in csv_cells] == [
            x["id"] for x in data["conditions"]]
        for mode, prefix in MODES.items():
            expected = avg([r[prefix+"Delta"] for r in data["conditions"]])
            near(data["overall"][mode]["meanCellDelta"], expected,
                 stage+" "+mode+" total")
        if stage == "holdout":
            indexed = sorted(enumerate(c["signFlipP"]
                       for c in data["conditions"]), key=lambda x: x[1])
            previous = 0
            adjusted = [None] * len(indexed)
            for rank, (i, p) in enumerate(indexed):
                previous = max(previous, min(1, (len(indexed)-rank)*p))
                adjusted[i] = previous
            for i, c in enumerate(data["conditions"]):
                near(c["holmP"], adjusted[i], "Holm "+c["id"])
        reports.append({"stage": stage, "cells": count,
                        "fullRunPairs": count * runs_per_cell,
                        "modelExecutions": count * runs_per_cell * len(MODES),
                        "status": "arithmetic_verified"})
    assert reports, "No completed stages to audit"
    return reports


def audit(root):
    folders = list(Path(root).glob("*/manifest.json"))
    if not folders:
        raise AssertionError("No v2 campaign manifest found")
    return [report for path in folders for report in verify(path.parent)]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: auditV2Campaign.py <v2-results-directory>")
    for item in audit(sys.argv[1]):
        print("E1-A V2 AUDIT " + json.dumps(item, ensure_ascii=False))
