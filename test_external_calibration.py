"""Synthetic fixtures test calibration arithmetic, not empirical validity."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

from validate_external_calibration import calibrated_groups,wilson


class ExternalCalibrationContract(unittest.TestCase):
    def setUp(self):
        self.payload={"schemaVersion":1,"provenance":{
            "datasetId":"synthetic-unit-fixture-not-independent",
            "sourceOrganization":"UNIT_TEST_ONLY",
            "collectionMethod":"fabricated test vectors",
            "collectionPeriod":"not applicable",
            "reference":"unit test"},
            "observations":[
                {"studyId":"uncertainty","scenario":"test","metric":"correctDecision",
                 "recordId":str(i),"predictedProbability":.5,"observedOutcome":i%2}
                for i in range(20)]}

    def test_wilson_and_brier_from_explicit_binary_vectors(self):
        output=calibrated_groups(self.payload,"deadbeef")
        self.assertEqual(output["totalRecords"],20)
        self.assertFalse(output["sourceProvenanceIndependentlyVerified"])
        self.assertEqual(output["independentScientificAcceptance"],"pending_review")
        group=output["groups"][0]
        self.assertEqual(group["observedEvents"],10)
        self.assertAlmostEqual(group["brierScore"],.25)
        self.assertAlmostEqual(group["logLoss"],.6931471805599453)
        self.assertAlmostEqual(group["expectedCalibrationError10Bins"],0)
        self.assertAlmostEqual(group["calibrationBias"],0)
        self.assertEqual(group["observedWilson95"],list(wilson(10,20)))

    def test_missing_provenance_and_duplicate_records_are_refused(self):
        self.payload.pop("provenance")
        with self.assertRaisesRegex(ValueError,"provenance"):
            calibrated_groups(self.payload,"abc")
        self.setUp()
        self.payload["observations"].append(dict(self.payload["observations"][0]))
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            calibrated_groups(self.payload,"abc")

    def test_nan_outcome_and_unbounded_input_are_refused(self):
        for invalid in (-.1,1.1,float("nan"),True,".3"):
            self.setUp()
            self.payload["observations"][0]["predictedProbability"]=invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError,"probability"):
                calibrated_groups(self.payload,"abc")
        self.setUp()
        self.payload["observations"][0]["observedOutcome"]=.0
        with self.assertRaisesRegex(ValueError,"ground truth"):
            calibrated_groups(self.payload,"abc")

    def test_cli_generates_auditable_report_but_never_signed_acceptance(self):
        with tempfile.TemporaryDirectory() as temp:
            source=pathlib.Path(temp)/"input.json"
            target=pathlib.Path(temp)/"report.json"
            source.write_text(json.dumps(self.payload),encoding="utf-8")
            run=subprocess.run([sys.executable,"validate_external_calibration.py",str(source),str(target)],
                               capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            report=json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(len(report["dataSha256"]),64)
            self.assertEqual(report["independentScientificAcceptance"],"pending_review")


if __name__=="__main__":
    unittest.main()
