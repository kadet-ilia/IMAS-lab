"""UP-34: independent E3/E5 numerical replays and E4 bounded BFS proof checking.

Input events and the initial topology are taken from the JavaScript source archive.
All transitions, propagation outcomes, risk statistics, and BFS search order are
computed anew in Python. This is a programmatic verification, not an external
scientific acceptance or empirical calibration.
"""
import copy
import json
import math
import subprocess
import unittest

from test_up34_deterministic import BRIDGE, ROOT, spread_reference, check_close


def percentile(values,q):
    xs=sorted(values)
    f=(len(xs)-1)*q
    i=math.floor(f)
    return xs[i]+(xs[min(i+1,len(xs)-1)]-xs[i])*(f-i)


def upper_shortfall(values,alpha=.95):
    xs=sorted(values,reverse=True)
    mass=len(xs)*(1-alpha)
    whole=int(mass)
    fraction=mass-whole
    return (sum(xs[:whole])+(fraction*xs[whole] if fraction else 0))/mass


def replay_graph(data):
    journal=data["sourceRunJournal"]
    id=data["id"]
    cfg=data["config"]
    scenario_count=4 if id=="probgraph" else 8
    method_count=3 if id=="probgraph" else 2
    R=cfg["runs"]
    assert journal["complete"] and journal["schemaVersion"]==2
    assert len(journal["entries"])==scenario_count*R
    assert len(data["pairedRuns"])==scenario_count*R
    row_values=[[{"fractions":[],"events":[],"losses":[],"affected":[],"history":[]}
                 for _ in range(method_count)]for _ in range(scenario_count)]
    for index,entry in enumerate(journal["entries"]):
        source=entry["scenarioIndex"] if id=="probgraph" else entry["source"]
        assert source==index//R and entry["run"]==index%R
        assert len(entry["methodDefenses"])==method_count
        pair=data["pairedRuns"][index]
        assert pair["scenario"]==entry["scenario"] and pair["run"]==entry["run"]
        for k,method in enumerate(entry["methodDefenses"]):
            init=entry["initialNodes"] if id=="probgraph" else [entry["initialNode"]]
            p=cfg["spread"]*(entry["scenarioMultiplier"] if id=="probgraph" else 1)
            independent=spread_reference({"n":cfg["agents"],"edges":entry["edges"],
                "initial":init,"tapes":entry["eventTape"],"p":p,
                "defense":method["defense"]})
            infected=independent["infected"]
            recorded=pair["methods"][k]
            assert recorded["method"]==method["method"]
            results=row_values[source][k]
            if id=="probgraph":
                fraction=len(infected)/cfg["agents"]
                danger=int(fraction>=cfg["criticalFraction"])
                check_close(recorded["infectedCount"],len(infected),"E3.infectedCount")
                check_close(recorded["finalFraction"],fraction,"E3.finalFraction")
                assert recorded["danger"]==danger
                results["fractions"].append(fraction)
                results["events"].append(danger)
                results["history"].append(independent["history"])
            else:
                damage=sum(entry["impactWeights"][i] for i in infected)
                danger=int(damage>=entry["criticalDamage"])
                check_close(recorded["loss"],damage,"E5.loss")
                assert recorded["affectedCount"]==len(infected)
                assert recorded["danger"]==danger
                results["losses"].append(damage)
                results["affected"].append(len(infected))
                results["events"].append(danger)
    for scenario in range(scenario_count):
        for method in range(method_count):
            vals=row_values[scenario][method]
            row=data["rows"][scenario*method_count+method]
            check_close(row["dangerProbability"],sum(vals["events"])/R,"graph.danger")
            assert row["dangerEvents"]==sum(vals["events"])
            if id=="probgraph":
                check_close(row["expectedFraction"],sum(vals["fractions"])/R,"E3.mean")
                check_close(row["p95Fraction"],percentile(vals["fractions"],.95),"E3.p95")
                for t in range(cfg["steps"]+1):
                    check_close(row["t"+str(t)],
                        sum(history[t] for history in vals["history"])/R/cfg["agents"],
                        "E3.trajectory")
            else:
                losses=vals["losses"]
                check_close(row["expectedDamage"],sum(losses)/R,"E5.mean")
                check_close(row["affectedAgents"],sum(vals["affected"])/R,"E5.affected")
                check_close(row["p95Damage"],percentile(losses,.95),"E5.p95")
                check_close(row["es95"],upper_shortfall(losses,.95),"E5.es95")
                check_close(row["excessDamage"],
                    sum(max(0,v-row["directDamage"]) for v in losses)/R,"E5.excess")
        contrast=data["pairedEffects"]
        if id=="probgraph":
            for k in range(1,method_count):
                effect=contrast[scenario*(method_count-1)+k-1]
                base=row_values[scenario][0]["events"]
                alternative=row_values[scenario][k]["events"]
                check_close(effect["reductionDanger"],
                    sum(a-b for a,b in zip(base,alternative))/R,"E3.paired.danger")
        else:
            effect=contrast[scenario]
            for metric,field in (("Damage","losses"),("Danger","events")):
                a=row_values[scenario][0][field]
                b=row_values[scenario][1][field]
                check_close(effect["reduction"+metric],
                    sum(x-y for x,y in zip(a,b))/R,"E5.paired."+metric)


def independent_bfs(data):
    j=data["markingJournal"]
    assert j["complete"] and j["boundedByStateLimit"]
    n=data["config"]["agents"]
    horizon=j["horizon"]
    critical=j["criticalCount"]
    policy=j["isolationPolicy"]
    delay=j["detectionDelay"]
    states=[{"mask":1,"isolated":0,"t":0,"transition":"t=0: скомпрометирован A1"}]
    found={"1:0:0"}
    time_counts=[0]*(horizon+1)
    cursor=0
    reached=False
    witness=[]
    while cursor<len(states) and cursor<j["stateLimit"]:
        state=states[cursor]
        row=j["records"][cursor]
        assert row["index"]==cursor
        for field in ("mask","isolated","t","transition"):
            assert row[field]==state[field],(field,cursor,row.get(field),state[field])
        mask=state["mask"]
        isolated=state["isolated"]
        t=state["t"]
        time_counts[t]+=1
        danger=mask.bit_count()>=critical
        assert row["critical"]==danger
        cursor+=1
        if danger:
            assert row["successors"]==[]
            reached=True
            break
        if t>=horizon:
            assert row["successors"]==[]
            continue
        nxt=t+1
        transitions=[]
        if policy==1 and nxt>=delay:
            newly=mask & ~isolated
            names=", ".join("A"+str(i+1) for i in range(n) if newly&(1<<i))
            transitions.append((mask,isolated|newly,nxt,
                "t="+str(nxt)+": обязательная изоляция "+(names or "нет новых агентов")))
        else:
            transitions.append((mask,isolated,nxt,"t="+str(nxt)+": ожидание"))
            for a,b in data["edges"]:
                if mask&(1<<a) and not isolated&(1<<a) and not mask&(1<<b) and not isolated&(1<<b):
                    transitions.append((mask|(1<<b),isolated,nxt,
                        "t="+str(nxt)+": передача A"+str(a+1)+" → A"+str(b+1)))
            if policy==0 and nxt>=delay:
                for v in range(n):
                    if mask&(1<<v) and not isolated&(1<<v):
                        transitions.append((mask,isolated|(1<<v),nxt,
                            "t="+str(nxt)+": изоляция A"+str(v+1)))
        expected=[]
        for m,iso,at,transition in transitions:
            signature=f"{m}:{iso}:{at}"
            new=signature not in found
            expected.append({"mask":m,"isolated":iso,"t":at,
                             "transition":transition,"enqueued":new})
            if new:
                found.add(signature)
                states.append({"mask":m,"isolated":iso,"t":at,"transition":transition})
        assert row["successors"]==expected,("transition mismatch",cursor-1)
    assert cursor==data["processed"]==j["processed"]
    assert len(states)==data["enqueued"]==j["enqueued"]
    assert time_counts==data["statesByTime"]
    expected_frontier=states[cursor:]
    assert j["frontier"]==expected_frontier
    verdict="reachable" if reached else ("inconclusive" if cursor<len(states) else "unreachable_within_bound")
    assert data["verdict"]==j["verdict"]==verdict


class IndependentlyVerifiedSourceArchives(unittest.TestCase):
    def test_e3_e5_complete_recomputation_and_e4_search_proof(self):
        cases=[
            {"type":"research_source","studyId":"probgraph",
             "config":{"agents":9,"runs":11,"seed":20261120,"edgeProbability":.4,
                       "spread":.3,"steps":5,"criticalFraction":.4,
                       "source_run_limit":11,"source_event_limit":50000}},
            {"type":"research_source","studyId":"cascade",
             "config":{"agents":8,"runs":13,"seed":20261121,"spread":.36,
                       "lossScale":1.2,"defenseFactor":.5,
                       "source_run_limit":13,"source_event_limit":50000}},
            {"type":"research_source","studyId":"petri",
             "config":{"agents":7,"runs":1,"seed":20261122,"steps":9,"criticalCount":7,
                       "stateLimit":1500,"detectionDelay":4,"isolationPolicy":0,
                       "marking_log_limit":1500}},
            {"type":"research_source","studyId":"petri",
             "config":{"agents":7,"runs":1,"seed":20261123,"steps":8,"criticalCount":5,
                       "stateLimit":1500,"detectionDelay":1,"isolationPolicy":1,
                       "marking_log_limit":1500}}
        ]
        response=subprocess.run(["node",str(BRIDGE)],input=json.dumps({"cases":cases}),
                                cwd=ROOT,capture_output=True,text=True,timeout=90)
        self.assertEqual(response.returncode,0,response.stderr[-5000:])
        answers=json.loads(response.stdout)["results"]
        for case,result in zip(cases,answers):
            with self.subTest(study=case["studyId"]):
                assert result["metricIntegrity"]["valid"]
                if case["studyId"]=="petri":
                    independent_bfs(result)
                else:
                    replay_graph(result)
        # Corruption tests demonstrate that the independent oracle uses raw
        # transitions rather than accepting the displayed summary as truth.
        damaged=copy.deepcopy(answers[2])
        damaged["markingJournal"]["records"][0]["successors"][0]["mask"] ^= 8
        with self.assertRaises(AssertionError):
            independent_bfs(damaged)
        damaged=copy.deepcopy(answers[0])
        damaged["pairedRuns"][0]["methods"][0]["infectedCount"]+=1
        with self.assertRaises(AssertionError):
            replay_graph(damaged)


if __name__=="__main__":
    unittest.main()
