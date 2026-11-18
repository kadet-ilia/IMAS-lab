import csv
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
import zipfile

MODULE_PATH = pathlib.Path(__file__).resolve().parents[2] / "gui" / "scripts" / "auditFklResults.py"
SPEC = importlib.util.spec_from_file_location("e1a_fkl_audit", MODULE_PATH)
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


def fixture():
    factors = [(3, 0, 0), (6, 12, 1), (12, 12, 4)]
    conditions = []
    rows = []
    for fi, (f, k, lag) in enumerate(factors):
        key = f"f{f}__k{k}__lag{lag}"
        condition = {
            "id": key, "stage": "smoke", "f": f, "k": k,
            "lag": lag, "R": 2, "seed": 2010000000 + fi * 8192 + 997,
            "meanCombinedRmse": 0.2
        }
        for mode in audit.MODES:
            condition["meanDelta" + mode + "Combined"] = 0.0
            condition["wins" + mode] = 0
            condition["losses" + mode] = 0
            condition["ci" + mode + "Low"] = 0.0
            condition["ci" + mode + "High"] = 0.0
        conditions.append(condition)
        for run in (0, 1):
            row = {
                "id": key, "stage": "smoke", "f": f, "k": k, "lag": lag,
                "R": 2, "run": run, "seed": condition["seed"], "block": "f" + str(f),
                "combinedRmse": 0.2, "trimmedRmse": 0.21,
                "combinedUnconditionalLoss": 0.04,
                "trimmedUnconditionalLoss": 0.0441,
                "combinedCoverage": 1,
            }
            for mode in audit.MODES:
                m = mode.lower()
                row[m + "Rmse"] = 0.2
                row[m + "UnconditionalLoss"] = 0.04
                row[m + "Coverage"] = 1
                row["delta" + mode + "Combined"] = 0
                row["deltaLoss" + mode + "Combined"] = 0
            rows.append(row)
    summary = {
        "protocol": "e1a-fkl-regime-factorial-1.0.0",
        "stage": "smoke", "cells": 3, "cellRuns": 6,
        "individualPolicyRuns": 24,
        "fingerprint": "a" * 64, "designSha256": "b" * 64,
        "sourceSha256": "c" * 64,
        "conditions": conditions,
        "overall": {
            mode.lower(): {"meanCellWeightedDeltaRmse": 0.0}
            for mode in audit.MODES
        }
    }
    manifest = {
        "protocol": summary["protocol"], "fingerprint": summary["fingerprint"],
        "designSha256": summary["designSha256"],
        "sourceSha256": summary["sourceSha256"]
    }
    return manifest, summary, rows


def make_archive(target, manifest, summary, rows):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("hash/protocol-manifest.json",
                   json.dumps(manifest))
        z.writestr("hash/smoke-summary.json", json.dumps(summary))
        text = io.StringIO()
        writer = csv.DictWriter(text, fieldnames=list(rows[0]), delimiter=";")
        writer.writeheader()
        writer.writerows(rows)
        z.writestr("hash/smoke-run-metrics.csv", text.getvalue())


class FklAuditTests(unittest.TestCase):
    def test_accepts_complete_synthetic_smoke_archive(self):
        manifest, summary, rows = fixture()
        with tempfile.TemporaryDirectory() as path:
            target = pathlib.Path(path) / "smoke.zip"
            make_archive(target, manifest, summary, rows)
            report = audit.validate_archive(target, "smoke")
        self.assertEqual(report["factorCells"], 3)
        self.assertEqual(report["cellRuns"], 6)
        self.assertEqual(report["policySimulations"], 24)
        self.assertEqual(report["uniqueSeedBlocks"], 3)
        self.assertEqual(report["status"], "verified_internal_consistency_only")

    def test_rejects_corrupt_paired_metrics(self):
        manifest, summary, rows = fixture()
        rows[0]["deltaDiscreteCombined"] = 0.025
        with tempfile.TemporaryDirectory() as path:
            target = pathlib.Path(path) / "tampered.zip"
            make_archive(target, manifest, summary, rows)
            with self.assertRaisesRegex(ValueError, "paired RMSE"):
                audit.validate_archive(target, "smoke")

    def test_rejects_truncated_run_table(self):
        manifest, summary, rows = fixture()
        rows.pop()
        with tempfile.TemporaryDirectory() as path:
            target = pathlib.Path(path) / "truncated.zip"
            make_archive(target, manifest, summary, rows)
            with self.assertRaisesRegex(ValueError, "incomplete primary run table"):
                audit.validate_archive(target, "smoke")

    def test_rejects_falsified_protocol_digest(self):
        manifest, summary, rows = fixture()
        summary["sourceSha256"] = "d" * 64
        with tempfile.TemporaryDirectory() as path:
            target = pathlib.Path(path) / "digest.zip"
            make_archive(target, manifest, summary, rows)
            with self.assertRaisesRegex(ValueError, "sourceSha256 mismatch"):
                audit.validate_archive(target, "smoke")


if __name__ == "__main__":
    unittest.main()
