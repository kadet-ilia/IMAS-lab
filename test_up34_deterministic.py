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


if __name__=="__main__":
    unittest.main()
