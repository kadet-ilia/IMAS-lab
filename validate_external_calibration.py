"""Offline validation of a supplied external binary-outcome calibration dataset.

This is a protocol implementation, NOT an external dataset or a signed
independent assessment. It will never claim that scientific acceptance passed.
Raw records are not included in the output, only statistics and a SHA256.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import pathlib
import sys
from collections import defaultdict


ALLOWED_STUDIES={"trust","uncertainty","probgraph","cascade","misinformation"}
EPS=1e-12
Z=1.959963984540054


def wilson(events: int, count: int) -> tuple[float,float]:
    if count<=0 or events<0 or events>count:
        raise ValueError("Incorrect binomial observations")
    p=events/count
    z2=Z*Z
    denom=1+z2/count
    center=(p+z2/(2*count))/denom
    radius=Z*math.sqrt(p*(1-p)/count+z2/(4*count*count))/denom
    return (max(0.0,center-radius), min(1.0,center+radius))


def calibrated_groups(source: dict, digest: str) -> dict:
    if not isinstance(source,dict) or source.get("schemaVersion")!=1:
        raise ValueError("Expected calibration schemaVersion=1")
    provenance=source.get("provenance")
    if not isinstance(provenance,dict):
        raise ValueError("Missing original data provenance")
    for key in ("datasetId","sourceOrganization","collectionMethod","collectionPeriod","reference"):
        value=provenance.get(key)
        if not isinstance(value,str) or not value.strip():
            raise ValueError("Provenance field is missing: "+key)
    observations=source.get("observations")
    if not isinstance(observations,list) or not observations:
        raise ValueError("Expected non-empty observation records")
    if len(observations)>500000:
        raise ValueError("Unbounded external calibration dataset")
    groups=defaultdict(list)
    ids=set()
    for i,record in enumerate(observations):
        if not isinstance(record,dict):
            raise ValueError("Invalid record "+str(i))
        study=record.get("studyId")
        scenario=record.get("scenario")
        metric=record.get("metric")
        run_id=record.get("recordId")
        prediction=record.get("predictedProbability")
        outcome=record.get("observedOutcome")
        if study not in ALLOWED_STUDIES or not isinstance(scenario,str) or not scenario.strip() or (
            not isinstance(metric,str) or not metric.strip()) or not isinstance(run_id,str) or not run_id.strip():
            raise ValueError("Study, scenario, metric or record ID missing: "+str(i))
        if (isinstance(prediction,bool) or not isinstance(prediction,(int,float))
                or not math.isfinite(prediction) or not 0<=prediction<=1):
            raise ValueError("Invalid predicted probability at record "+str(i))
        if type(outcome) is not int or outcome not in (0,1):
            raise ValueError("Binary ground truth must be 0 or 1 at record "+str(i))
        key=(study,scenario,metric,run_id)
        if key in ids:
            raise ValueError("Duplicate external observation identifier "+str(key))
        ids.add(key)
        groups[(study,scenario,metric)].append((float(prediction),outcome))
    reports=[]
    for key,rows in sorted(groups.items()):
        n=len(rows)
        observed=sum(y for _,y in rows)
        mean_probability=sum(p for p,_ in rows)/n
        rate=observed/n
        brier=sum((p-y)**2 for p,y in rows)/n
        logloss=sum(-(y*math.log(max(EPS,p))+(1-y)*math.log(max(EPS,1-p))) for p,y in rows)/n
        baseline=sum((rate-y)**2 for _,y in rows)/n
        bins=[]
        ece=0.0
        for number in range(10):
            values=[(p,y) for p,y in rows if min(9,int(p*10))==number]
            if not values:
                continue
            average_p=sum(p for p,_ in values)/len(values)
            average_y=sum(y for _,y in values)/len(values)
            ece+=len(values)*abs(average_p-average_y)/n
            bins.append({"bin":number,"count":len(values),
                         "meanPredicted":average_p,"observedRate":average_y})
        lower,upper=wilson(observed,n)
        reports.append({"studyId":key[0],"scenario":key[1],"metric":key[2],
            "samples":n,"observedEvents":observed,"observedRate":rate,
            "observedWilson95":[lower,upper],"meanPredictedProbability":mean_probability,
            "calibrationBias":rate-mean_probability,"brierScore":brier,
            "empiricalConstantRateBaselineBrier":baseline,
            "logLoss":logloss,"expectedCalibrationError10Bins":ece,
            "bins":bins,
            "warning":"Small or sparse validation set" if n<100 or min(observed,n-observed)<10 else None})
    return {"schemaVersion":1,"dataSha256":digest,"datasetId":provenance["datasetId"],
      "sourceOrganization":provenance["sourceOrganization"],
      "claimedCollectionMethod":provenance["collectionMethod"],
      "claimedCollectionPeriod":provenance["collectionPeriod"],
      "claimedReference":provenance["reference"],
      "sourceProvenanceIndependentlyVerified":False,
      "sourceLabelsIndependentlyVerified":False,
      "externalCalibrationPerformedOnSubmittedData":True,
      "independentScientificAcceptance":"pending_review",
      "issues":["Submitted data origins and labels require independent verification",
                "Calibration results alone do not establish causal validity or deployment transfer"],
      "groups":reports,"totalRecords":len(observations),
      "generatedUtc":dt.datetime.now(dt.timezone.utc).isoformat()}


def analyze_file(path: pathlib.Path) -> dict:
    content=path.read_bytes()
    if len(content)>200*1024*1024:
        raise ValueError("Calibration input exceeds 200 MiB")
    digest=hashlib.sha256(content).hexdigest()
    return calibrated_groups(json.loads(content),digest)


def main(argv: list[str]) -> int:
    if len(argv) not in (2,3):
        print("Usage: python validate_external_calibration.py input.json [report.json]",file=sys.stderr)
        return 2
    try:
        report=analyze_file(pathlib.Path(argv[1]))
    except (ValueError,KeyError,TypeError,OSError,json.JSONDecodeError) as error:
        print("External calibration rejected: "+str(error),file=sys.stderr)
        return 1
    data=json.dumps(report,ensure_ascii=False,indent=2)
    if len(argv)==3:
        pathlib.Path(argv[2]).write_text(data+"\n",encoding="utf-8")
    else:
        print(data)
    return 0


if __name__=="__main__":
    raise SystemExit(main(sys.argv))
