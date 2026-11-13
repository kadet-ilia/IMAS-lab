"""UP-34: independent deterministic Python oracle for current JS mathematical semantics.

This explicitly does NOT assert equivalence with the older experiment.py simulator.
Each test sends identical source observations/events to gui/src/up34Bridge.mjs,
then compares the JS result against a pure-Python implementation which does not
import or call the tested JavaScript code.
"""
import json
import math
import random
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BRIDGE = ROOT / "gui/src/up34Bridge.mjs"
TOLERANCE = 3e-8


def quantile(data, fraction):
    values = sorted(data)
    if not values:
        raise ValueError("empty quantile")
    location = (len(values) - 1) * fraction
    i = int(location)
    return values[i] + (values[min(len(values)-1, i+1)] - values[i]) * (location - i)


def beta_reference(case):
    n = len(case["history"][0])
    alpha0 = case["prior"] * case["strength"]
    beta0 = (1-case["prior"]) * case["strength"]
    out = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            alpha, beta = alpha0, beta0
            for age, matrix in enumerate(reversed(case["history"])):
                evidence = matrix[i][j]
                if evidence is not None:
                    weight = case["forgetting"] ** age
                    alpha += weight * evidence
                    beta += weight * (1 - evidence)
            out[i][j] = alpha/(alpha+beta)
    return out


def gaussian_solve(a, b):
    """Independent solution of (I - damping*C.T)r = constant teleportation."""
    n = len(b)
    matrix = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(matrix[row][col]))
        if abs(matrix[pivot][col]) < 1e-12:
            raise ValueError("singular matrix")
        matrix[col], matrix[pivot] = matrix[pivot], matrix[col]
        scale = matrix[col][col]
        matrix[col] = [v / scale for v in matrix[col]]
        for row in range(n):
            if row == col:
                continue
            factor = matrix[row][col]
            matrix[row] = [v - factor * x for v,x in zip(matrix[row],matrix[col])]
    return [row[-1] for row in matrix]


def eigen_reference(case):
    active = [i for i, on in enumerate(case["active"]) if on]
    n = len(case["active"])
    out = [0.0] * n
    if not active:
        return out
    m = len(active)
    c = []
    for i in active:
        row = [max(0.0, case["matrix"][i][j]-0.5) for j in active]
        total = sum(row)
        c.append([v / total for v in row] if total > 1e-15 else [1/m] * m)
    d = case["damping"]
    a = [[(1.0 if i == j else 0.0) - d*c[j][i] for j in range(m)] for i in range(m)]
    r = gaussian_solve(a, [(1.0-d)/m] * m)
    scale = max(max(r), 1e-15)
    for i, value in zip(active,r):
        out[i] = value / scale
    return out


def trim_reference(case):
    pairs = sorted(enumerate(zip(case["values"],case["weights"])),
                   key=lambda pair:(pair[1][0],pair[0]))
    count = len(pairs)
    k = min(case["k"], (count-1)//2)
    items = pairs[k:count-k]
    vals = [pair[1][0] for pair in items]
    weights = [max(0.0,pair[1][1]) for pair in items]
    total = sum(weights)
    return sum(x*w for x,w in zip(vals,weights))/total if total > 1e-15 else sum(vals)/len(vals)


def weights_reference(case):
    obs = case["observations"]
    xs = [o["x"] for o in obs]
    med = quantile(xs,0.5)
    mad = quantile([abs(x-med) for x in xs],0.5)
    scale = max(0.15,1.4826*mad,case["noise"])
    return [max(0.01,1.0/((1+abs(o["x"]-med)/scale) *
                        (1+0.25*(max(1,o.get("d",1))-1)))) for o in obs]


def shortfall_reference(case):
    descending = sorted(case["values"],reverse=True)
    count = len(descending)
    mass = (1-case["alpha"])*count
    full = int(math.floor(mass))
    fraction = mass - full
    total = sum(descending[:full])
    if fraction > 0:
        total += fraction*descending[full]
    return total/mass


def spread_reference(case):
    infected = set(case["initial"])
    frontier = set(infected)
    counts = [len(infected)]
    prob = min(1,max(0,case["p"]*(1-case["defense"])))
    for draws in case["tapes"]:
        new = set()
        for (a,b),draw in zip(case["edges"],draws):
            if a in frontier and b not in infected and draw<prob:
                new.add(b)
        infected.update(new)
        frontier.update(new)
        counts.append(len(infected))
    return {"infected":sorted(infected),"history":counts}


def transport_reference(case):
    n=case["n"]
    queue=[]
    last_values=[None]*n
    last_steps=[-1000000000]*n
    previous={field:0 for field in
              ("attempted","delivered","lost","bandwidth_dropped","expired")}
    results=[]
    for t,stage in enumerate(case["steps"]):
        active=stage["active"]
        if not case["networkEnabled"]:
            items=[i for i,on in enumerate(active) if on]
            budget=case["bandwidth"]
            stats={"attempted":len(items),"delivered":len(items),"lost":0,
                "bandwidth_dropped":0,"expired":0,"backlogged":0,"component_size":len(items),
                "queued":0,"mean_delay":0}
            values=stage["proposals"][:]
            availability=active[:]
        else:
            comps=sorted(stage["comps"],key=lambda a:(-len(a),a[0] if a else -1))
            largest=comps[0] if comps else []
            assert len(stage["events"])==len(largest)
            lost=0
            for i,event in zip(largest,stage["events"]):
                if event["lossDraw"]<case["loss"]:
                    lost+=1
                else:
                    delay=event["delay"]
                    queue.append({"due":t+delay,"sent":t,"source":i,
                        "value":stage["proposals"][i],"delay":delay})
            queue.sort(key=lambda q:q["due"])
            delivered=0
            expired=0
            delays=[]
            retained=[]
            budget=case["bandwidth"]
            for msg in queue:
                if t-msg["sent"]>case["staleness"]:
                    expired+=1
                elif msg["due"]<=t and budget>0:
                    last_values[msg["source"]]=msg["value"]
                    last_steps[msg["source"]]=msg["sent"]
                    budget-=1
                    delivered+=1
                    delays.append(t-msg["sent"])
                else:
                    retained.append(msg)
            queue=retained
            availability=[(i in largest and last_values[i] is not None and
                           t-last_steps[i]<=case["staleness"]) for i in range(n)]
            values=last_values[:]
            stats={"attempted":len(largest),"delivered":delivered,"lost":lost,
                "bandwidth_dropped":0,"expired":expired,
                "backlogged":sum(q["due"]<=t for q in queue),
                "component_size":len(largest),"queued":len(queue),
                "mean_delay":sum(delays)/len(delays) if delays else 0}
        for field in previous:
            previous[field]+=stats[field]
        pending=len(queue) if case["networkEnabled"] else 0
        balance=previous["attempted"]-sum(previous[k] for k in
                 ("delivered","lost","bandwidth_dropped","expired"))-pending
        if balance:
            raise AssertionError(f"independent transport imbalance at step {t}: {balance}")
        ledger={**previous,"pending":pending,"balance":balance}
        results.append({"values":values,"available":availability,"remainingBudget":budget,
                        "stats":stats,"queue":[v.copy() for v in queue],"ledger":ledger})
    return results


REFERENCES={
    "beta":beta_reference,"eigen":eigen_reference,"trim":trim_reference,
    "weights":weights_reference,"shortfall":shortfall_reference,
    "spread":spread_reference,"transport":transport_reference,
    "graph_zero":lambda c:[[False]*c["n"] for _ in range(c["n"])]
}


def check_close(actual,expected,path="root"):
    if isinstance(expected,bool) or expected is None:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"
    elif isinstance(expected,dict):
        assert isinstance(actual,dict), f"{path}: expected mapping"
        assert set(actual)==set(expected),f"{path}: keys {set(actual)^set(expected)}"
        for key,value in expected.items():
            check_close(actual[key],value,f"{path}.{key}")
    elif isinstance(expected,list):
        assert isinstance(actual,list) and len(actual)==len(expected),f"{path}: array length"
        for i,(a,b) in enumerate(zip(actual,expected)):
            check_close(a,b,f"{path}[{i}]")
    else:
        assert isinstance(actual,(int,float)) and not isinstance(actual,bool), f"{path}: not numeric"
        assert math.isfinite(actual),f"{path}: not finite"
        assert math.isclose(actual,expected,rel_tol=TOLERANCE,abs_tol=TOLERANCE),\
               f"{path}: {actual:.15g} != {expected:.15g}"


def test_cases():
    randoms=random.Random(2026110601)
    cases=[]
    for variant in range(16):
        n=randoms.choice([3,4,5,7])
        history=[[[None if randoms.random()<.24 else
                  round(randoms.random(),5) for _ in range(n)] for _ in range(n)]
                 for _ in range(randoms.randint(1,5))]
        cases.append({"type":"beta","history":history,
                      "prior":randoms.choice([.21,.5,.79]),
                      "strength":randoms.choice([.7,2,4.5]),
                      "forgetting":randoms.choice([.25,.5,.9,1.0])})
        matrix=[[round(randoms.random(),6) for _ in range(n)] for _ in range(n)]
        cases.append({"type":"eigen","matrix":matrix,
                      "active":[randoms.random()>.3 for _ in range(n)],
                      "damping":randoms.choice([0,.4,.75,.85,.95])})
    for variant in range(35):
        n=randoms.randint(3,13)
        cases.append({"type":"trim","values":[randoms.randint(-100,100)/7 for _ in range(n)],
                      "weights":[randoms.choice([0,.1,1,3]) for _ in range(n)],
                      "k":randoms.randint(0,8)})
        cases.append({"type":"weights","observations":[
            {"x":round(randoms.gauss(0,2),6),"d":randoms.choice([1,1,2,3,5])}
            for _ in range(n)],"noise":randoms.choice([.1,.2,.7,2])})
    for variant in range(30):
        n=randoms.randint(3,9)
        edges=[[i,j] for i in range(n) for j in range(n)
               if i!=j and randoms.random()<.19]
        t=randoms.randint(1,7)
        cases.append({"type":"spread","n":n,"edges":edges,
                      "initial":randoms.sample(range(n),randoms.randint(1,min(n,3))),
                      "tapes":[[randoms.random() for _ in edges] for _ in range(t)],
                      "p":randoms.choice([0,.15,.6,1,1.4]),
                      "defense":randoms.choice([0,.25,.7,1])})
        cases.append({"type":"shortfall","values":[randoms.random()*100 for _ in range(n+5)],
                      "alpha":randoms.choice([0,.5,.8,.95,.99])})
    for version in range(11):
        n=randoms.choice([3,5,8])
        network=version!=0
        loss=[0,0,1,.4,.7,.1,.25,.8,.4,0,.2][version]
        bandwidth=[5,0,2,1,3,2,1,0,3,6,0][version]
        steps=[]
        for t in range(12):
            active=[(i==0 or randoms.random()>.28) for i in range(n)]
            nodes=[i for i,on in enumerate(active) if on]
            if network and version%3==0 and len(nodes)>2:
                comps=[nodes[::2],nodes[1::2]]
            else:
                comps=[nodes] if nodes else []
            largest=sorted(comps,key=lambda x:(-len(x),x[0] if x else -1))[0] if comps else []
            events=[{"lossDraw":randoms.random(),"delay":randoms.randint(0,5)} for _ in largest]
            steps.append({"active":active,"comps":comps,"events":events,
                          "proposals":[round(randoms.uniform(-2,2),5) for _ in range(n)]})
        cases.append({"type":"transport","n":n,"networkEnabled":network,
                      "loss":loss,"bandwidth":bandwidth,"staleness":version%5,
                      "steps":steps})
    cases.append({"type":"graph_zero","n":8})
    return cases


class IndependentCrossLanguageParity(unittest.TestCase):
    def test_fixed_events_and_randomized_input_vectors(self):
        cases=test_cases()
        self.assertGreater(len(cases),150)
        completed=subprocess.run(["node",str(BRIDGE)],cwd=ROOT,input=json.dumps({"cases":cases}),
                                 capture_output=True,text=True,check=False,timeout=90)
        self.assertEqual(completed.returncode,0,completed.stderr[-4000:])
        result=json.loads(completed.stdout)
        self.assertEqual(result["schema"],"up34-parity-v2")
        self.assertEqual(len(result["results"]),len(cases))
        for number,(case,actual) in enumerate(zip(cases,result["results"])):
            with self.subTest(case=number,operation=case["type"]):
                expected=REFERENCES[case["type"]](case)
                check_close(actual,expected,path=f'{case["type"]}#{number}')



def reconstruct_no_network_trust_trace(result):
    """Independent E1 step-level oracle reading ONLY recorded source events.

    The original Python simulator is not called: it has different transport
    and failure semantics. Values in the source-event log are exogenous inputs,
    not precomputed decisions or reputations.
    """
    c=result["configuration"]
    assert c["network_enabled"] is False
    n=c["n_agents"]+c["n_sybil_agents"]
    sybil=[i>=c["n_agents"] for i in range(n)]
    log=result["sourceEvents"]
    journal={t:{"proposal":[],"evidence":[]} for t in range(1,c["n_steps"]+1)}
    for event in log:
        if event["kind"]=="proposal_generated":
            journal[event["step"]]["proposal"].append(event)
        elif event["kind"]=="evidence":
            journal[event["step"]]["evidence"].append(event)
    byzantine=[None]*n
    active=[not s for s in sybil]
    cooldown_until=[-1]*n
    isolated_at=[None]*n
    detection_at=[None]*n
    low=[0]*n
    hist=[]
    decisions={name:[] for name in
               ("arithmetic_mean","trust_weighted_mean","coordinate_trimmed_mean","proposed_robust")}
    expected_isolations=[]
    expected_attempted=0
    for t in range(c["n_steps"]):
        step=t+1
        records=journal[step]["proposal"]
        assert len(records)==n and len(set(item["source"] for item in records))==n
        prop=[None]*n
        recorded_running=[False]*n
        for item in records:
            i=item["source"]-1
            prop[i]=item["value"]
            recorded_running[i]=item["active"]
            if byzantine[i] is None:
                byzantine[i]=item["byzantine"]
            else:
                assert byzantine[i]==item["byzantine"]
            assert item["sybil"]==sybil[i]
        eligible=[not sybil[i] or step>=c["sybil_activation_step"] for i in range(n)]
        for i in range(n):
            if (not active[i] and eligible[i] and
                ((sybil[i] and cooldown_until[i]<0) or
                 (cooldown_until[i]>=0 and cooldown_until[i]<t))):
                active[i]=True
                low[i]=0
        running=[active[i] and eligible[i] for i in range(n)]
        assert running==recorded_running,(step,running,recorded_running)
        indices=[i for i in range(n) if running[i]]
        if hist:
            direct=beta_reference({"history":hist,"prior":c["initial_trust"],
                                   "strength":c["trust_prior_strength"],
                                   "forgetting":c["forgetting_factor"]})
        else:
            direct=[[c["initial_trust"]]*n for _ in range(n)]
        local=[c["initial_trust"]]*n
        for j in indices:
            local[j]=quantile([direct[i][j] for i in indices],.5)
        eigen=eigen_reference({"matrix":direct,"active":running,
                               "damping":c["reputation_damping"]})
        rep=[.7*local[i]+.3*eigen[i] for i in range(n)]
        values=[prop[i] for i in indices]
        weights=[max(rep[i],c["minimum_weight"]) for i in indices]
        if values:
            project=lambda x:min(c["safe_action_max"],max(c["safe_action_min"],x))
            average=sum(values)/len(values)
            weighted=sum(x*w for x,w in zip(values,weights))/sum(weights)
            coordinate=trim_reference({"values":values,"weights":[1.0]*len(values),
                                       "k":c["trim_each_side"]})
            trusted_positions=[j for j,i in enumerate(indices)
                               if rep[i]>=c["aggregation_trust_threshold"]]
            if trusted_positions:
                trusted_values=[values[j] for j in trusted_positions]
                trusted_weights=[weights[j] for j in trusted_positions]
                combined=project(trim_reference({"values":trusted_values,
                    "weights":trusted_weights,"k":c["trim_each_side"]}))
            else:
                combined=None
            tick_results={
                "arithmetic_mean":project(average),
                "trust_weighted_mean":project(weighted),
                "coordinate_trimmed_mean":project(coordinate),
                "proposed_robust":combined
            }
        else:
            tick_results={key:None for key in decisions}
        for method,value in tick_results.items():
            decisions[method].append(value)
            check_close(result["series"][t][method],value,f"E1.{method}.tick{step}")
        evidence=[[None]*n for _ in range(n)]
        for event in journal[step]["evidence"]:
            i,j=event["observer"]-1,event["target"]-1
            assert running[i] and running[j]
            assert event["status"]=="delivered"
            evidence[i][j]=event["value"]
        assert len(journal[step]["evidence"])==len(indices)**2
        hist.append(evidence)
        if len(hist)>c["trust_window_steps"]:
            hist.pop(0)
        updated=beta_reference({"history":hist,"prior":c["initial_trust"],
                                "strength":c["trust_prior_strength"],
                                "forgetting":c["forgetting_factor"]})
        after=[c["initial_trust"]]*n
        for j in indices:
            after[j]=quantile([updated[i][j] for i in indices],.5)
        if c["isolation_enabled"] and step>=c["minimum_evidence_steps"]:
            for i in range(n):
                low[i]=low[i]+1 if running[i] and after[i]<c["isolation_threshold"] else 0
                if running[i] and low[i]>=c["isolation_patience"]:
                    if isolated_at[i] is None:
                        isolated_at[i]=step
                    if byzantine[i] and step>=c["attack_start_step"] and detection_at[i] is None:
                        detection_at[i]=step
                    expected_isolations.append((step,i+1,after[i],low[i]))
                    active[i]=False
                    cooldown_until[i]=t+c["isolation_cooldown_steps"]
        tick=result["series"][t]
        expected_attempted+=len(indices)+len(indices)**2
        check_close(tick["active_agents"],sum(running[i] and active[i] for i in range(n)),
                    f"E1.active_agents.tick{step}")
        check_close(tick["isolated_agents"],sum(eligible[i] and not active[i] for i in range(n)),
                    f"E1.isolated_agents.tick{step}")
        check_close(tick["available_agents"],len(indices),f"E1.available_agents.tick{step}")
        check_close(tick["messages_delivered"],len(indices)+len(indices)**2,
                    f"E1.messages_delivered.tick{step}")
        check_close(tick["messages_lost"],0,f"E1.messages_lost.tick{step}")
        onoff=((step-c["attack_start_step"])%c["on_off_period"]<
                c["on_off_attack_steps"])
        active_attack=step>=c["attack_start_step"] and (
            result["scenario"]!="on_off" or onoff)
        check_close(tick["attack_active"],int(active_attack),f"E1.attack_active.tick{step}")
        reputation=[x for x in result["reputation"] if x["step"]==step]
        assert len(reputation)==n
        states=[x for x in result["states"] if x["step"]==step]
        assert len(states)==n
        for i,row in enumerate(reputation):
            assert row["agent"]==i+1
            for field,value in (("localTrust",local[i]),("eigenReputation",eigen[i]),
                                ("reputation",rep[i]),("isolationScore",after[i])):
                check_close(row[field],value,f"E1.agent{i+1}.tick{step}.{field}")
            assert row["active"]==active[i]
            expected_state=("dormant" if sybil[i] and not eligible[i] else
                            "isolated" if not active[i] else
                            "sybil" if sybil[i] else
                            "byzantine" if byzantine[i] else "honest")
            assert states[i]["agent"]==i+1 and states[i]["state"]==expected_state
    assert len(result["events"])==len(expected_isolations)
    for actual,(step,agent,score,confirmations) in zip(result["events"],expected_isolations):
        assert actual["step"]==step and actual["agent"]==agent
        check_close(actual["isolationScore"],score,f"E1.isolation{agent}.{step}")
        assert actual["confirmations"]==confirmations
        assert actual["reason"]=="local_post_evidence_below_threshold"
    bad_count=sum(byzantine)
    detected=[v for v in detection_at if v is not None]
    summary=result["summary"]
    check_close(summary["detection_rate"],len(detected)/max(1,bad_count),
                "E1.summary.detection_rate")
    check_close(summary["mean_detection_delay_steps"],
                (sum(v-c["attack_start_step"] for v in detected)/len(detected)
                 if detected else None),"E1.summary.mean_detection_delay_steps")
    check_close(summary["preserved_functionality"],
                sum(active[i] and not byzantine[i] for i in range(n))/max(1,n-bad_count),
                "E1.summary.preserved_functionality")
    premature=sum(byzantine[i] and isolated_at[i] is not None and
                  isolated_at[i]<c["attack_start_step"] for i in range(n))
    false_isolations=sum(not byzantine[i] and isolated_at[i] is not None
                         for i in range(n))+premature
    check_close(summary["premature_byzantine_isolations"],premature,
                "E1.summary.premature_isolations")
    check_close(summary["false_isolations"],false_isolations,
                "E1.summary.false_isolations")
    check_close(summary["communication_attempted"],expected_attempted,
                "E1.summary.communication_attempted")
    check_close(summary["communication_delivered"],expected_attempted,
                "E1.summary.communication_delivered")
    check_close(summary["communication_lost"],0,"E1.summary.communication_lost")
    check_close(summary["communication_queued"],0,"E1.summary.communication_queued")
    check_close(summary["message_balance"],0,"E1.summary.message_balance")
    for row in result["rows"]:
        xs=decisions[row["method"]]
        accepted=[x for x in xs if x is not None]
        correct=sum(x is not None and abs(x-c["desired_action"])<=
                    c["correctness_tolerance"] for x in xs)
        check_close(row["probability_correct"],correct/c["n_steps"],
                    "E1.metrics.probability_correct")
        errors=[x-c["desired_action"] for x in accepted]
        check_close(row["mae"],sum(abs(e) for e in errors)/len(errors)
                    if errors else None,"E1.metrics.mae")
        check_close(row["rmse"],math.sqrt(sum(e*e for e in errors)/len(errors))
                    if errors else None,"E1.metrics.rmse")
        check_close(row["bias"],sum(errors)/len(errors) if errors else None,
                    "E1.metrics.bias")


class EndToEndEventTapeReconstruction(unittest.TestCase):
    def test_e1_full_step_reconstruction_of_reputation_decision_and_isolation(self):
        common={"n_agents":7,"n_byzantine":2,"n_sybil_agents":1,
                "sybil_activation_step":4,"trim_each_side":2,
                "n_steps":17,"attack_start_step":4,"on_off_period":5,
                "on_off_attack_steps":2,"source_event_limit":25000,
                "network_enabled":False,"minimum_evidence_steps":2,
                "isolation_cooldown_steps":3}
        cases=[
            {"type":"trust_trace","scenario":"on_off","runIndex":0,
             "config":{**common,"seed":20261106,"isolation_enabled":False}},
            {"type":"trust_trace","scenario":"on_off","runIndex":1,
             "config":{**common,"seed":20261107,"isolation_enabled":True,
                       "isolation_threshold":.8,"isolation_patience":1}},
            {"type":"trust_trace","scenario":"static_bias","runIndex":3,
             "config":{**common,"seed":20261108,"isolation_enabled":True,
                       "isolation_threshold":.4,"isolation_patience":2}}
        ]
        output=subprocess.run(["node",str(BRIDGE)],input=json.dumps({"cases":cases}),
                              cwd=ROOT,capture_output=True,text=True,timeout=90)
        self.assertEqual(output.returncode,0,output.stderr[-4000:])
        data=json.loads(output.stdout)
        for idx,item in enumerate(data["results"]):
            with self.subTest(scenario=idx):
                reconstruct_no_network_trust_trace(item)



if __name__=="__main__":
    unittest.main()
