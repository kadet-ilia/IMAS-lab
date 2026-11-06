"""Fail-closed UP-36 evidence-readiness gate; NEVER issues a scientific acceptance.

Checks objective presence/integrity of independent evidence files and
calibration arithmetic. Reviewer independence, signatures and underlying
event labels require separate human authentication. Intended for both CI
and an offline accreditation dossier after evidence is supplied.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
from validate_external_calibration import analyze_file

STUDIES=("trust","uncertainty","probgraph","petri","cascade","misinformation")
PROBABILISTIC=set(STUDIES)-{"petri"}
SHA=re.compile(r"^[a-f0-9]{64}$")
COMMIT=re.compile(r"^[a-f0-9]{40}$")
MAX_FILE=200*1024*1024
STRESS=("powerInterruption","storageQuota","targetHardware","multiTab","longRunning")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def artifact(check: dict,root: pathlib.Path,issues: list[str],code: str) -> pathlib.Path | None:
    if not isinstance(check,dict):
        issues.append(code+": expected artifact {path,sha256}")
        return None
    rel=check.get("path")
    digest=check.get("sha256")
    if not isinstance(rel,str) or not rel.strip() or not isinstance(digest,str) or not SHA.fullmatch(digest):
        issues.append(code+": missing file path or SHA-256")
        return None
    try:
        target=(root/rel).resolve(strict=True)
        if not target.is_relative_to(root) or not target.is_file():
            raise ValueError("path escapes evidence directory")
        if target.stat().st_size>MAX_FILE:
            raise ValueError("artifact too large")
        content=target.read_bytes()
        if sha256(content)!=digest:
            raise ValueError("SHA-256 mismatch")
        return target
    except (OSError,ValueError,RuntimeError) as error:
        issues.append(code+": "+str(error))
        return None


def check_defects(path: pathlib.Path,issues: list[str]):
    try:
        data=json.loads(path.read_text(encoding="utf-8"))
        defects=data["defects"]
        if not isinstance(defects,list) or len(defects)!=55:
            raise ValueError("55 verbatim original findings are required")
        ids=set()
        for item in defects:
            if not isinstance(item,dict):
                raise ValueError("malformed finding")
            key=item.get("id")
            if not isinstance(key,str) or not key.strip() or key in ids:
                raise ValueError("missing or duplicate finding ID")
            ids.add(key)
            if not isinstance(item.get("verbatim"),str) or len(item["verbatim"].strip())<15:
                raise ValueError("unchanged original finding is missing")
            if item.get("status") not in ("resolved","not_applicable"):
                raise ValueError("finding not independently dispositioned")
            for f in ("evidenceReference","reviewerReference"):
                if not isinstance(item.get(f),str) or not item[f].strip():
                    raise ValueError("finding without evidence/reviewer reference")
            if item["status"]=="not_applicable" and not item.get("justification"):
                raise ValueError("N/A finding needs justification")
    except (ValueError,TypeError,KeyError,json.JSONDecodeError) as exc:
        issues.append("complete-original-55-defects: "+str(exc))


def evaluate(path: pathlib.Path | None,root: pathlib.Path) -> dict:
    issues=[]
    details={}
    try:
        if path is None or not path.exists():
            raise ValueError("original 55 findings, independent measurements and signed reviews were not provided")
        manifest=json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(manifest,dict) or manifest.get("schemaVersion")!=1:
            raise ValueError("expected manifest schemaVersion=1")
    except (OSError,ValueError,json.JSONDecodeError) as error:
        manifest={}
        issues.append("acceptance-manifest: "+str(error))
    reference=manifest.get("candidateCommit")
    if not isinstance(reference,str) or not COMMIT.fullmatch(reference):
        issues.append("candidate: immutable 40-character Git commit required")
    else:
        try:
            local=subprocess.run(["git","rev-parse","HEAD"],capture_output=True,
                                 text=True,timeout=4,check=False)
            if local.returncode==0 and local.stdout.strip()!=reference:
                issues.append("candidate: manifest commit differs from checked-out HEAD")
        except (OSError,subprocess.TimeoutExpired):
            pass
    # All external sources are separately hash-pinned; a digest is not an
    # authentication of who collected the measurements.
    evidence=manifest.get("evidence")
    if not isinstance(evidence,dict):
        evidence={}
    defects=artifact(evidence.get("originalDefectRegister"),root,issues,"complete-original-55-defects")
    if defects:
        check_defects(defects,issues)
    dataset=artifact(evidence.get("externalCalibrationDataset"),root,issues,"external-dataset")
    calibration=artifact(evidence.get("externalCalibrationReport"),root,issues,"external-calibration-report")
    if dataset and calibration:
        try:
            computed=analyze_file(dataset)
            reported=json.loads(calibration.read_text(encoding="utf-8"))
            for field in ("dataSha256","totalRecords","groups","datasetId"):
                if reported.get(field)!=computed[field]:
                    raise ValueError("calibration report mismatches source data: "+field)
            studies={x["studyId"] for x in computed["groups"]}
            if not PROBABILISTIC.issubset(studies):
                raise ValueError("not all five probabilistic experiments have external measurements")
            details["calibrationGroups"]=len(computed["groups"])
            details["externalObservations"]=computed["totalRecords"]
            details["sourceProvenanceIndependentlyVerified"]=False
        except (OSError,TypeError,ValueError,KeyError,json.JSONDecodeError) as error:
            issues.append("external-calibration-integrity: "+str(error))
    artifact(evidence.get("independentFormalE4"),root,issues,"independent-E4-formal")
    operational=evidence.get("operationalStress")
    if not isinstance(operational,dict):
        operational={}
    for kind in STRESS:
        entry=operational.get(kind)
        artifact(entry,root,issues,"stress-"+kind)
        if not isinstance(entry,dict) or entry.get("passed") is not True:
            issues.append("stress-"+kind+": no documented successful result")
    pub=evidence.get("publicationRecalculations")
    if not isinstance(pub,list) or len(pub)!=6:
        issues.append("publication: six re-computed experiment results required")
    else:
        if {x.get("studyId") for x in pub if isinstance(x,dict)}!=set(STUDIES):
            issues.append("publication: missing or duplicate study IDs")
        for index,entry in enumerate(pub):
            artifact(entry,root,issues,"publication-"+str(index))
            if not isinstance(entry,dict) or entry.get("candidateCommit")!=reference:
                issues.append("publication-"+str(index)+": model commit does not match candidate")
    reviews=evidence.get("independentReviews")
    if not isinstance(reviews,list) or len(reviews)<2:
        issues.append("independent-review: at least two distinct expert reports required")
    else:
        ids=set()
        covered=set()
        for i,item in enumerate(reviews):
            artifact(item,root,issues,"independent-review-"+str(i))
            if not isinstance(item,dict):
                issues.append("independent-review: malformed reviewer")
                continue
            label=(item.get("reviewerId"),item.get("organization"))
            if not all(isinstance(x,str) and x.strip() for x in label) or label in ids:
                issues.append("independent-review: duplicated/unnamed reviewer or organization")
            ids.add(label)
            if item.get("declaredIndependent") is not True or not item.get("signedDocumentReference"):
                issues.append("independent-review: independence and signed report must be declared")
            declared=item.get("studyCoverage")
            if isinstance(declared,list):
                covered.update(declared)
        if not set(STUDIES).issubset(covered):
            issues.append("independent-review: all six studies require coverage")
    status="evidence_present_needs_independent_authentication" if not issues else "blocked_missing_independent_evidence"
    return {"schemaVersion":1,"candidateCommit":reference,
      "status":status,"evidenceCompletenessPassed":not issues,
      "scientificAcceptance":False,
      "independentSignaturesCryptographicallyAuthenticated":False,
      "externalSourceAndLabelsAuthenticated":False,
      "issues":issues,
      "requiredExternalEvidence":["55 original verbatim findings","five real calibration datasets",
        "independent E4 formal check","five operational stress records",
        "six publication reruns","two independent signed expert opinions"],
      "details":details,
      "limitations":"File hashes, metadata and test outcomes cannot authenticate reviewers, signatures, independence, field measurements or scientific applicability."}


def main(argv=None):
    parser=argparse.ArgumentParser(description="UP-36 evidence readiness, not an approval")
    parser.add_argument("--manifest",type=pathlib.Path,
                        default=pathlib.Path("audit/remediation/05_validation/acceptance_manifest.json"))
    parser.add_argument("--evidence-root",type=pathlib.Path,default=pathlib.Path("."))
    parser.add_argument("--output",type=pathlib.Path)
    parser.add_argument("--strict-evidence",action="store_true",
                        help="Exit nonzero unless all stated evidence files pass objective checks; never approves science")
    args=parser.parse_args(argv)
    report=evaluate(args.manifest,args.evidence_root.resolve())
    data=json.dumps(report,ensure_ascii=False,indent=2)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(data,encoding="utf-8")
    else:
        sys.stdout.write(data)
    return 2 if args.strict_evidence and not report["evidenceCompletenessPassed"] else 0


if __name__=="__main__":
    raise SystemExit(main())
