#!/usr/bin/env python3
"""Independent Python numeric audit of E1-A f×k×L GitHub Actions archives.

Usage: python gui/scripts/auditFklResults.py ARCHIVE.zip [--stage exploratory] [--output report.json]
Requires only the Python standard library. Does NOT re-run the JS simulator,
verify source integrity, or independently prove validity of bootstrap assumptions.
"""
import argparse
import csv
import hashlib
import io
import json
import math
import pathlib
import sys
import zipfile
from collections import defaultdict

EXPECTED = {"smoke": 3, "exploratory": 80, "confirmatory": 16}
EXPECTED_R = {"smoke": 2, "exploratory": 30, "confirmatory": 100}
MODES = ("Adaptive", "Risk", "Discrete", "Blend")
FACTOR_F = (3, 6, 9, 12)
FACTOR_K = (0, 3, 6, 9, 12)
FACTOR_L = (0, 1, 2, 4)


def ensure(condition, message):
    if not condition:
        raise ValueError("FKL audit failed: " + message)


def number(value, name):
    try:
        n = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError("FKL audit failed: invalid number " + name) from exc
    ensure(math.isfinite(n), "nonfinite " + name)
    return n


def close(actual, expected, label):
    ensure(math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-11),
           label + " mismatch: " + str(actual) + " vs " + str(expected))


def read_documents(archive, stage):
    names = archive.namelist()
    ensure(archive.testzip() is None, "ZIP CRC error")
    def read_suffix(name):
        candidates = [n for n in names if n == name or n.endswith("/" + name)]
        ensure(len(candidates) == 1, "expected one " + name)
        return archive.read(candidates[0]).decode("utf-8")
    manifest = json.loads(read_suffix("protocol-manifest.json"))
    summary = json.loads(read_suffix(stage + "-summary.json"))
    rows = list(csv.DictReader(io.StringIO(
        read_suffix(stage + "-run-metrics.csv")), delimiter=";"))
    return manifest, summary, rows


def validate_archive(archive_path, stage="exploratory"):
    ensure(stage in EXPECTED, "unknown stage")
    archive_path = pathlib.Path(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        manifest, summary, rows = read_documents(archive, stage)
    ensure(manifest.get("protocol") == "e1a-fkl-regime-factorial-1.0.0",
           "protocol mismatch")
    ensure(summary.get("protocol") == manifest["protocol"], "summary protocol mismatch")
    for key in ("fingerprint", "designSha256", "sourceSha256"):
        ensure(summary.get(key) == manifest.get(key), key + " mismatch")
        ensure(isinstance(summary[key], str) and len(summary[key]) == 64,
               "bad SHA-256 metadata " + key)
    ensure(summary.get("stage") == stage, "wrong research stage")
    conditions = summary.get("conditions", [])
    ensure(len(conditions) == EXPECTED[stage], "incomplete cell summaries")
    ensure(summary.get("cells") == EXPECTED[stage], "incorrect cell count")
    ensure(len(rows) == EXPECTED[stage] * EXPECTED_R[stage],
           "incomplete primary run table")
    ensure(summary["cellRuns"] == len(rows), "incorrect cellRuns")
    ensure(summary["individualPolicyRuns"] == 4 * len(rows),
           "incorrect individual policy simulation count")
    grouped = defaultdict(list)
    for row in rows:
        f, k, lag, run = (int(row[n]) for n in ("f", "k", "lag", "run"))
        ensure(f in FACTOR_F and k in FACTOR_K and lag in FACTOR_L,
               "unknown factor level")
        cell_id = "f%d__k%d__lag%d" % (f, k, lag)
        ensure(row["id"] == cell_id, "mismatched factor cell identifier")
        ensure(row.get("stage") == stage, "mixed simulation stages")
        ensure(int(row["seed"]) > 0, "seed unavailable")
        ensure(0 <= run < EXPECTED_R[stage], "invalid run index")
        baseline = number(row["combinedRmse"], "combinedRmse")
        ensure(baseline >= 0, "negative RMSE")
        control_loss = number(row["combinedUnconditionalLoss"], "combined loss")
        ensure(control_loss >= 0, "negative unconditional loss")
        for mode in MODES:
            label = mode.lower()
            current = number(row[label + "Rmse"], label + "Rmse")
            delta = number(row["delta" + mode + "Combined"], "delta " + mode)
            loss = number(row[label + "UnconditionalLoss"], "loss " + mode)
            delta_loss = number(row["deltaLoss" + mode + "Combined"], "delta loss " + mode)
            coverage = number(row[label + "Coverage"], "coverage " + mode)
            ensure(current >= 0 and loss >= 0 and 0 <= coverage <= 1,
                   "invalid RMSE/loss/coverage")
            close(current - baseline, delta, "paired RMSE " + cell_id)
            close(loss - control_loss, delta_loss, "paired loss " + cell_id)
        grouped[cell_id].append(row)
    ensure(len(grouped) == EXPECTED[stage], "missing/duplicate factor cells")
    conditions_by_id = {cell["id"]: cell for cell in conditions}
    ensure(len(conditions_by_id) == len(conditions), "duplicate summary ID")
    blocks = {}
    for cell_id, run_list in grouped.items():
        record = conditions_by_id.get(cell_id)
        ensure(record is not None, "orphan run cell " + cell_id)
        ensure(record["stage"] == stage, "wrong cell stage")
        ensure(len(run_list) == EXPECTED_R[stage], "wrong replicates " + cell_id)
        indices = [int(row["run"]) for row in run_list]
        ensure(sorted(indices) == list(range(EXPECTED_R[stage])),
               "duplicated/missing run index in " + cell_id)
        f, k, lag = (int(run_list[0][factor]) for factor in ("f", "k", "lag"))
        ensure((f, k, lag) == (record["f"], record["k"], record["lag"]),
               "wrong cell factors")
        seed = int(run_list[0]["seed"])
        ensure(all(int(row["seed"]) == seed for row in run_list),
               "inconsistent cell seed")
        ensure(seed == record["seed"], "summary seed mismatch")
        if f in blocks:
            ensure(blocks[f] == seed, "lost common seed block for f=%d" % f)
        else:
            blocks[f] = seed
        for mode in MODES:
            key = "delta" + mode + "Combined"
            values = [number(row[key],key) for row in run_list]
            close(sum(values) / len(values),
                  number(record["meanDelta" + mode + "Combined"], "mean " + mode),
                  "mean contrast " + cell_id + " " + mode)
            ensure(int(record["wins" + mode]) ==
                   sum(value < 0 for value in values),
                   "wrong number of wins " + cell_id)
            ensure(int(record["losses" + mode]) ==
                   sum(value > 0 for value in values),
                   "wrong number of losses " + cell_id)
            low = number(record["ci" + mode + "Low"], "bootstrap lower")
            high = number(record["ci" + mode + "High"], "bootstrap upper")
            ensure(low <= high, "reversed bootstrap endpoints")
    ensure(len(blocks) == (3 if stage == "smoke" else 4), "missing Byzantine count blocks")
    effects = {}
    for mode in MODES:
        key = "meanDelta" + mode + "Combined"
        effects[mode.lower()] = {
            "meanEqualCellWeightedDeltaRmse":sum(float(c[key]) for c in conditions)/len(conditions),
            "betterCells":sum(float(c[key]) < 0 for c in conditions),
            "worseCells":sum(float(c[key]) > 0 for c in conditions)
        }
        group = summary["overall"][mode.lower()]
        close(effects[mode.lower()]["meanEqualCellWeightedDeltaRmse"],
              number(group["meanCellWeightedDeltaRmse"], "stage mean"),
              "whole-stage mean " + mode)
    if stage == "exploratory":
        ensure(set(grouped) == {
            "f%d__k%d__lag%d" % (f, k, lag)
            for f in FACTOR_F for k in FACTOR_K for lag in FACTOR_L
        }, "missing factorial combinations")
        for contrast_name, axis in (("lagContrasts","lag"), ("kContrasts","k")):
            for contrast in summary[contrast_name]:
                f = contrast["f"]
                k = contrast["k"] if axis == "lag" else contrast["to"]
                lag = contrast["to"] if axis == "lag" else contrast["lag"]
                base_id = ("f%d__k%d__lag0" % (f,k)
                           if axis == "lag" else "f%d__k0__lag%d" % (f,lag))
                other_id = "f%d__k%d__lag%d" % (f,k,lag)
                base_rows = sorted(grouped[base_id],key=lambda r: int(r["run"]))
                other_rows = sorted(grouped[other_id],key=lambda r: int(r["run"]))
                differences = [
                    float(y["deltaDiscreteCombined"]) - float(x["deltaDiscreteCombined"])
                    for x,y in zip(base_rows,other_rows)
                ]
                close(sum(differences)/len(differences),
                      number(contrast["meanInteractionDelta"], "factor interaction"),
                      axis + " interaction " + other_id)
        ensure(len(summary["lagContrasts"]) == 60, "incorrect lag contrast count")
        ensure(len(summary["kContrasts"]) == 64, "incorrect trimming contrast count")
    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    return {
        "status":"verified_internal_consistency_only",
        "archive":archive_path.name,"archiveSha256":digest,
        "stage":stage,"protocol":summary["protocol"],"sourceSha256":summary["sourceSha256"],
        "factorCells":len(grouped),"cellRuns":len(rows),
        "policySimulations":summary["individualPolicyRuns"],
        "uniqueSeedBlocks":len(blocks),
        "conditionalEffects":effects,
        "warning":"No source-code verification, real-world validation, independence of factorial cells, or bootstrap coverage proof."
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("archive",help="GitHub Actions FKL ZIP artifact")
    p.add_argument("--stage",choices=sorted(EXPECTED),default="exploratory")
    p.add_argument("--output",default=None)
    args=p.parse_args()
    try:
        report=validate_archive(args.archive,args.stage)
    except (ValueError,KeyError,IndexError,zipfile.BadZipFile) as exc:
        print("FKL AUDIT FAILURE: "+str(exc),file=sys.stderr)
        return 1
    output=json.dumps(report,ensure_ascii=False,indent=2)+"\n"
    if args.output:pathlib.Path(args.output).write_text(output,encoding="utf-8")
    print(output,end="")
    return 0


if __name__=="__main__":
    raise SystemExit(main())
