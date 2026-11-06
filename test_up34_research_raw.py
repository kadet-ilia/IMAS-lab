"""UP-34 / NZ-15: independent re-calculation from complete E2 and E6 raw-run archives.

The Python code uses only individual recorded observations, initial graph
sources, directed edge uniforms and the documented mathematical operators.
No grouped JS statistics or precomputed JS method estimates are used as
inputs to the independent oracle.
"""
import json
import math
import subprocess
import unittest

from test_up34_deterministic import BRIDGE, ROOT, weights_reference, spread_reference, check_close

SCENARIOS=[("Базовый сценарий (с допустимыми потерями)",.7),
           ("Неполнота данных",1.0),
           ("Противоречивые данные",1.8),
           ("Несвоевременные сообщения",1.2)]


def truncated_mean(xs,k):
    if not xs:
        return 0.0
    values=sorted(xs)
    trim=min(k,(len(values)-1)//2)
    middle=values[trim:len(values)-trim]
    return sum(middle)/len(middle)


def analyze_e2(data):
    c=data["config"]
    archive=data["sourceRunJournal"]
    assert archive["studyId"]=="uncertainty" and archive["complete"]
    assert archive["scenarios"]==4 and archive["runsPerScenario"]==c["runs"]
    totals=[[{"accepted":0,"correct":0,"wrong":0,"age":0.0} for _ in range(3)]
            for _ in range(4)]
    oracle=[{"accepted":0,"correct":0} for _ in range(4)]
    for entry in archive["entries"]:
        s=entry["scenarioIndex"]
        assert entry["scenario"]==SCENARIOS[s][0]
        assert entry["truth"] in (-1,1)
        messages=entry["messages"]
        assert len(messages)==c["agents"]
        obs=[]
        for i,msg in enumerate(messages):
            assert msg["agent"]==i+1
            if msg["missing"]:
                continue
            assert msg["age"]==(3 if msg["stale"] else 1)
            sigma=c["signalNoise"]*SCENARIOS[s][1]
            w=(.22 if msg["attacked"] else .93)/(sigma*sigma+.15) * (
                .22 if msg["stale"] else 1)
            check_close(msg["oracleWeight"],w,f"E2.oracleWeight.agent{i+1}")
            obs.append({"x":msg["x"],"d":msg["age"],"weight":msg["oracleWeight"]})
        check_close(entry["observedCount"],len(obs),"E2.available_messages")
        xs=sorted(o["x"] for o in obs)
        weights=weights_reference({"observations":obs,"noise":c["signalNoise"]*SCENARIOS[s][1]}) if obs else []
        estimates=[
            sum(xs)/len(xs) if xs else 0.0,
            truncated_mean(xs,min(math.floor(len(xs)*.16),max(0,(len(xs)-1)//2))),
            sum(o["x"]*w for o,w in zip(obs,weights))/sum(weights) if obs else 0.0
        ]
        for i,(actual,expected) in enumerate(zip(entry["methodEstimates"],estimates)):
            check_close(actual,expected,f"E2.scenario{s}.run{entry['run']}.method{i}")
        oracle_estimate=sum(o["x"]*o["weight"] for o in obs)/sum(o["weight"] for o in obs) if obs else 0.0
        check_close(entry["oracleEstimate"],oracle_estimate,"E2.oracle")
        ready= len(obs)>=math.ceil(c["agents"]*.3)
        if ready and abs(oracle_estimate)>=c["threshold"]:
            oracle[s]["accepted"]+=1
            oracle[s]["correct"]+=int(math.copysign(1,oracle_estimate)==entry["truth"])
        for k,value in enumerate(estimates):
            if not ready or abs(value)<c["threshold"]:
                continue
            t=totals[s][k]
            t["accepted"]+=1
            t["correct"]+=int(math.copysign(1,value)==entry["truth"])
            t["wrong"]+=int(math.copysign(1,value)!=entry["truth"])
            t["age"]+=sum(o["d"] for o in obs)/len(obs)
    for s in range(4):
        o=oracle[s]
        check_close(data["oracleBenchmark"][s]["coverage"],o["accepted"]/c["runs"],"E2.oracle.coverage")
        check_close(data["oracleBenchmark"][s]["correctUnconditional"],
                    o["correct"]/c["runs"],"E2.oracle.correctUnconditional")
        for k in range(3):
            r=data["rows"][s*3+k]
            expected=totals[s][k]
            check_close(r["coverage"],expected["accepted"]/c["runs"],"E2.coverage")
            check_close(r["correctUnconditional"],expected["correct"]/c["runs"],"E2.correct")
            check_close(r["errorRate"],expected["wrong"]/c["runs"],"E2.error")
            check_close(r["accuracy"],expected["correct"]/expected["accepted"]
                        if expected["accepted"] else None,"E2.conditional_accuracy")
            check_close(r["meanObservationAge"],expected["age"]/expected["accepted"]
                        if expected["accepted"] else None,"E2.age")


def analyze_e6(data):
    c=data["config"]
    journal=data["sourceRunJournal"]
    assert journal["studyId"]=="misinformation" and journal["complete"]
    assert len(journal["entries"])==4*c["runs"]
    counts=[[{"right":0,"wrong":0,"refuse":0,"deviation":0.0} for _ in range(3)]
            for _ in range(4)]
    exposure=[0.0]*4
    for entry in journal["entries"]:
        f=entry["compromised"]
        initial=entry["initialCompromised"]
        assert len(initial)==f and len(set(initial))==f
        outcome=spread_reference({"n":c["agents"],"initial":initial,
            "edges":entry["edges"],"tapes":entry["eventTapes"],"p":c["spread"],"defense":0})
        assert outcome["infected"]==entry["exposed"]
        exposure[f]+=len(outcome["infected"])/c["agents"]
        observations=entry["observations"]
        assert len(observations)==c["agents"]
        xs=[o["value"] for o in observations]
        weights=weights_reference({"observations":[{"x":x} for x in xs],"noise":c["noise"]})
        estimates=[sum(xs)/len(xs),sum(x*w for x,w in zip(xs,weights))/sum(weights),
                   truncated_mean(xs,3)]
        for k in range(3):
            check_close(entry["methodEstimates"][k],estimates[k],f"E6.f{f}.method{k}")
        for k in range(4):
            check_close(entry["trimEstimates"][k],truncated_mean(xs,k),f"E6.trim{k}")
        for k,value in enumerate(estimates):
            count=counts[f][k]
            if abs(value)<c["threshold"]:
                count["refuse"]+=1
            elif math.copysign(1,value)==entry["truth"]:
                count["right"]+=1
            else:
                count["wrong"]+=1
            count["deviation"]+=abs(value-entry["truth"])
    for f in range(4):
        check_close(data["scenarioMetrics"][f]["meanExposedFraction"],exposure[f]/c["runs"],"E6.exposure")
        for k in range(3):
            row=data["rows"][f*3+k]
            n=counts[f][k]
            correct=n["right"]/c["runs"]
            wrong=n["wrong"]/c["runs"]
            refuse=n["refuse"]/c["runs"]
            check_close(row["correctProbability"],correct,"E6.correct")
            check_close(row["wrongProbability"],wrong,"E6.wrong")
            check_close(row["abstentionProbability"],refuse,"E6.abstain")
            check_close(row["meanDeviation"],n["deviation"]/c["runs"],"E6.deviation")
            check_close(row["risk"],c["costWrong"]*wrong+c["costRefuse"]*refuse,"E6.risk")


class IndependentResearchRawArchiveReconstruction(unittest.TestCase):
    def test_e2_and_e6_complete_independent_numeric_audit(self):
        cases=[
            {"type":"research_source","studyId":"uncertainty",
             "config":{"agents":11,"runs":17,"seed":20261116,"signalNoise":.4,
                       "loss":.66,"corruption":.27,"threshold":.24,"source_run_limit":17}},
            {"type":"research_source","studyId":"misinformation",
             "config":{"agents":7,"runs":19,"seed":20261117,"spread":.48,"noise":.24,
                       "attackBias":2.5,"threshold":.17,"costWrong":2.5,
                       "costRefuse":.45,"source_run_limit":19}}
        ]
        run=subprocess.run(["node",str(BRIDGE)],input=json.dumps({"cases":cases}),
                           cwd=ROOT,capture_output=True,text=True,timeout=90)
        self.assertEqual(run.returncode,0,run.stderr[-4000:])
        result=json.loads(run.stdout)
        for case,data in zip(cases,result["results"]):
            with self.subTest(study=case["studyId"]):
                self.assertTrue(data["metricIntegrity"]["valid"])
                if case["studyId"]=="uncertainty":
                    analyze_e2(data)
                else:
                    analyze_e6(data)


if __name__=="__main__":
    unittest.main()
