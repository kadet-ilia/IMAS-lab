"""Acceptance-gate unit vectors use synthetic fixtures ONLY, not actual approval."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

from scientific_release_gate import evaluate, main, sha256
from validate_external_calibration import analyze_file


class ScientificReleaseGateTests(unittest.TestCase):
    def put(self,root,name,body):
        path=root/name
        path.write_bytes(body.encode("utf-8") if isinstance(body,str) else body)
        return {"path":name,"sha256":sha256(path.read_bytes())}

    def fixture(self,root):
        git=subprocess.run(["git","rev-parse","HEAD"],capture_output=True,text=True,check=False)
        commit=git.stdout.strip() if git.returncode==0 else "a"*40
        defects={"defects":[{"id":f"TEST-{i:03d}",
                "verbatim":"SYNTHETIC ONLY - this is not an original finding "+str(i),
                "status":"resolved","evidenceReference":"TEST_ONLY-"+str(i),
                "reviewerReference":"NOT_VERIFIED_TEST_ONLY"}
                for i in range(55)]}
        dataset={"schemaVersion":1,"provenance":{
            "datasetId":"SYNTHETIC_UNIT_TEST_NOT_REAL",
            "sourceOrganization":"NONEXISTENT_UNIT_TEST",
            "collectionMethod":"fabricated vectors","collectionPeriod":"none",
            "reference":"this is a synthetic unit fixture"},
            "observations":[
              {"studyId":study,"scenario":"toy","metric":"risk",
               "recordId":f"{i}","predictedProbability":.25,
               "observedOutcome":i%2}
              for study in ["trust","uncertainty","probgraph","cascade","misinformation"]
              for i in range(20)]}
        original=self.put(root,"external-dataset.json",json.dumps(dataset))
        report=analyze_file(root/"external-dataset.json")
        evidence={"originalDefectRegister":self.put(root,"55-defects.json",json.dumps(defects)),
           "externalCalibrationDataset":original,
           "externalCalibrationReport":self.put(root,"calibration.json",json.dumps(report)),
           "independentFormalE4":self.put(root,"formal-e4.txt","SYNTHETIC E4 only"),
           "operationalStress":{},"publicationRecalculations":[],
           "independentReviews":[]}
        for t in ["powerInterruption","storageQuota","targetHardware","multiTab","longRunning"]:
            evidence["operationalStress"][t]={**self.put(root,t+".txt","SYNTHETIC "+t),"passed":True}
        for i,study in enumerate(["trust","uncertainty","probgraph","petri","cascade","misinformation"]):
            evidence["publicationRecalculations"].append({
             **self.put(root,study+".json",json.dumps({"study":study,"synthetic":True})),
             "studyId":study,"candidateCommit":commit})
        for i in range(2):
            evidence["independentReviews"].append({
              **self.put(root,f"review-{i}.txt","SYNTHETIC UNSIGNED PLACEHOLDER"),
              "reviewerId":f"TEST-ONLY-{i}","organization":f"FAKE-LAB-{i}",
              "declaredIndependent":True,"signedDocumentReference":"NOT_REAL",
              "studyCoverage":["trust","uncertainty","probgraph","petri","cascade","misinformation"]})
        manifest={"schemaVersion":1,"candidateCommit":commit,"evidence":evidence}
        path=root/"manifest.json"
        path.write_text(json.dumps(manifest),encoding="utf-8")
        return path,manifest

    def test_missing_external_manifest_blocks_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            report=evaluate(root/"missing.json",root)
            self.assertEqual(report["status"],"blocked_missing_independent_evidence")
            self.assertFalse(report["scientificAcceptance"])
            self.assertTrue(any("external-dataset" in x for x in report["issues"]))
            self.assertTrue(any("complete-original-55-defects" in x for x in report["issues"]))
            self.assertTrue(any("independent-review" in x for x in report["issues"]))

    def test_even_complete_mock_files_do_not_issue_scientific_acceptance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            path,manifest=self.fixture(root)
            report=evaluate(path,root)
            self.assertEqual(report["issues"],[],report["issues"])
            self.assertEqual(report["status"],"evidence_present_needs_independent_authentication")
            self.assertTrue(report["evidenceCompletenessPassed"])
            self.assertFalse(report["scientificAcceptance"])
            self.assertFalse(report["independentSignaturesCryptographicallyAuthenticated"])
            self.assertFalse(report["externalSourceAndLabelsAuthenticated"])
            self.assertEqual(report["details"]["calibrationGroups"],5)

    def test_corrupt_or_escaped_artifacts_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            path,manifest=self.fixture(root)
            (root/"55-defects.json").write_text("modified",encoding="utf-8")
            report=evaluate(path,root)
            self.assertTrue(any("SHA-256" in x for x in report["issues"]))
            self.assertFalse(report["evidenceCompletenessPassed"])
            manifest["evidence"]["externalCalibrationDataset"]["path"]="../escape.json"
            path.write_text(json.dumps(manifest),encoding="utf-8")
            report=evaluate(path,root)
            self.assertTrue(any("external-dataset" in x for x in report["issues"]))

    def test_original_findings_must_be_all_55_distinct_verbatim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            path,manifest=self.fixture(root)
            defect_path=root/"55-defects.json"
            data=json.loads(defect_path.read_text(encoding="utf-8"))
            data["defects"][-1]["id"]=data["defects"][0]["id"]
            manifest["evidence"]["originalDefectRegister"]=self.put(
                root,"55-defects.json",json.dumps(data))
            path.write_text(json.dumps(manifest),encoding="utf-8")
            report=evaluate(path,root)
            self.assertTrue(any("duplicate finding ID" in x for x in report["issues"]))
            self.assertFalse(report["scientificAcceptance"])

    def test_cli_strict_refuses_missing_external_data_and_writes_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            output=root/"readiness.json"
            status=main(["--manifest",str(root/"absent.json"),
                         "--evidence-root",str(root),
                         "--output",str(output),"--strict-evidence"])
            self.assertEqual(status,2)
            report=json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(report["status"],"blocked_missing_independent_evidence")
            self.assertFalse(report["scientificAcceptance"])
            status=main(["--manifest",str(root/"absent.json"),
                         "--evidence-root",str(root),"--output",str(output)])
            self.assertEqual(status,0)
            self.assertFalse(json.loads(output.read_text())["scientificAcceptance"])


if __name__=="__main__":
    unittest.main()
