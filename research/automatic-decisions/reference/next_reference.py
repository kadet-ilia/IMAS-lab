"""Independent E2.13–E2.19 numerical checks on bounded small cases.
References use SciPy optimization, distributions and an explicit latent-state tree.
This is a numerical verification suite, not a proof of operational validity.
"""
import json
import math
import sys
import itertools
from functools import lru_cache
import numpy as np
from scipy.optimize import minimize, linprog
from scipy.stats import beta, hypergeom
from scipy.special import rel_entr
from extended_reference import extremum

def partial_fit(n, hist):
    pairs = [(m,k) for m in range(n+1) for k in range(m+1)]
    H = np.array([hypergeom.pmf(k,n,np.arange(n+1),m) for m,k in pairs])
    mask = np.array(hist)>0
    F, z = H[mask], np.asarray(hist)[mask]
    def objective(p):
        return -float(z@np.log(np.maximum(F@p,1e-300)))
    def jac(p):
        return -(F.T@(z/np.maximum(F@p,1e-300)))
    sol = minimize(objective,np.ones(n+1)/(n+1),jac=jac,bounds=[(0,1)]*(n+1),constraints={"type":"eq","fun":lambda p:p.sum()-1,"jac":lambda p:np.ones(n+1)},method="SLSQP",options={"ftol":1e-10,"maxiter":2000})
    if not sol.success:
        raise RuntimeError(sol.message)
    return sol.x,-sol.fun

def stop_reference(c, counts, active):
    # Explicit posterior over latent (X,J_1,...,J_B), not JS product recursion.
    B=len(c["groups"]); ns=c["groups"]; M=c["m"]
    hat=[[np.asarray(a)/M for a in row] for row in counts]
    hidden=list(itertools.product([0,1],*(range(n+1) for n in ns)))
    prior=np.array([(c["prior"] if x else 1-c["prior"])*math.prod(hat[x][g][j] for g,j in enumerate(js)) for x,*js in hidden])
    X=np.array([row[0] for row in hidden]); J=np.array([row[1:] for row in hidden])
    eps=[min(2,math.sqrt(2/M*math.log((2**(n+1)-2)*2*B/c["alpha"]))) for n in ns]
    theta=c["f"]/(c["b"]+c["f"]-c["d"])
    @lru_cache(None)
    def solve(m,k):
        prob=prior.copy()
        lower=[];upper=[]
        for x in [0,1]:
            lo=hi=c["prior"] if x else 1-c["prior"]
            for g,n in enumerate(ns):
                h=hypergeom.pmf(k[g],n,np.arange(n+1),m[g])
                lo*=max(0,-extremum(-h,hat[x][g],"l1",eps[g]))
                hi*=max(0,extremum(h,hat[x][g],"l1",eps[g]))
            lower.append(lo);upper.append(hi)
        for g,n in enumerate(ns): prob*=hypergeom.pmf(k[g],n,J[:,g],m[g])
        z=prob.sum()
        if z==0:return c["c"]
        p=prob[X==1].sum()/z
        if not upper[0] and not upper[1]:lo,hi=0,1
        elif not upper[0]:lo=hi=1
        elif not upper[1]:lo=hi=0
        else:lo=lower[1]/(lower[1]+upper[0]);hi=upper[1]/(upper[1]+lower[0])
        v=c["c"]
        if hi<theta and c["b"]*hi<=c["safetyRisk"]:v=min(v,c["b"]*p)
        elif lo>theta and c["f"]+(c["d"]-c["f"])*lo<=c["safetyRisk"]:v=min(v,c["f"]+(c["d"]-c["f"])*p)
        if sum(m)>=c["queryBudget"]:return v
        groups=[g for g,n in enumerate(ns) if m[g]<n]
        if not active and groups:groups=[min(groups,key=lambda g:(m[g],g))]
        for g in groups:
            py=float(prob@((J[:,g]-k[g])/(ns[g]-m[g]))/z);py=min(1,max(0,py))
            a=list(m);a[g]+=1;b=list(k);b[g]+=1
            q=c["queryCost"]
            if py<1:q+=(1-py)*solve(tuple(a),k)
            if py>0:q+=py*solve(tuple(a),tuple(b))
            v=min(v,q)
        return v
    return solve((0,)*B,(0,)*B)

def queue_reference(c,stream,feedback):
    """Independent event calendar; full event ordering and occupancy integration."""
    pending=list(stream); waiting=[]; running=[]; results={}; last=0.;area=busyarea=0.
    H=c["queueHorizon"];warm=c["queueWarmup"];s=c["operators"]
    def record(v,kind,t,w,actual):
        results[v["id"]]=dict(outcome=kind,finish=t,wait=w,loss=actual,action=v["action"],price=v["price"])
    def dispatch(t):
        while waiting and len(running)<s:
            j=next((i for i,v in enumerate(waiting) if v["hi"]>=c["priorityThreshold"]),0) if c["queuePriority"] else 0
            v=waiting.pop(j);w=t-v["t"];end=t+v["service"]
            running.append((end,v["id"]))
            record(v,"served",end,w,c["queueOperatorLoss"]+c["queueWaitCost"]*w)
    while pending or running or waiting or last<H:
        t=min(pending[0]["t"] if pending else math.inf,min((v[0] for v in running),default=math.inf),min((v["t"]+c["deadline"] for v in waiting),default=math.inf),H if last<H else math.inf)
        if not math.isfinite(t):break
        dt=max(0,min(t,H)-max(last,warm));area+=dt*len(waiting);busyarea+=dt*len(running);last=t
        running=[v for v in running if v[0]>t]
        expired=[v for v in waiting if v["t"]+c["deadline"]<=t];waiting=[v for v in waiting if v["t"]+c["deadline"]>t]
        for v in expired:record(v,"timeout",t,t-v["t"],c["failureCost"]+c["b"]*v["x"]+c["queueWaitCost"]*(t-v["t"]))
        dispatch(t)
        while pending and pending[0]["t"]==t:
            v=dict(pending.pop(0));v["price"]=c["c"]+(c["feedbackGain"]*(len(waiting)+1)/(s*c["service"]) if feedback and len(running)==s else 0)
            cap=min(v["price"],c["safetyRisk"]);lo,hi=v["lo"],v["hi"]
            theta=c["f"]/(c["b"]+c["f"]-c["d"])
            a=0 if hi<theta and c["b"]*hi<=cap else 1 if lo>theta and c["f"]+(c["d"]-c["f"])*lo<=cap else 2
            v["action"]=a
            if a!=2:
                actual=c["b"]*v["x"] if a==0 else c["d"] if v["x"] else c["f"]
                record(v,"automatic",t,0,actual)
            elif len(running)<s:waiting.append(v);dispatch(t)
            elif len(waiting)>=c["queueCapacity"]:record(v,"rejected",t,0,c["failureCost"]+c["b"]*v["x"])
            elif c["deadline"]==0:record(v,"timeout",t,0,c["failureCost"]+c["b"]*v["x"])
            else:waiting.append(v)
    measured=[results[v["id"]] for v in stream if warm<=v["t"]<H]
    return results,dict(N=len(measured),loss=sum(v["loss"] for v in measured)/len(measured),Lq=area/(H-warm),rho=busyarea/((H-warm)*s))

def main():
    data=json.load(sys.stdin);checks=0;worst=0.;by={}
    def compare(k,a,b,tol=2e-8):
        nonlocal checks,worst
        err=abs(float(a)-float(b));checks+=1;by[k]=by.get(k,0)+1;worst=max(worst,err)
        if err>tol:raise AssertionError((k,a,b,err,tol))
    for r in data["beta"]:
        expected=beta.ppf(r["p"],r["a"],r["b"])
        compare("beta",sum(r["bracket"])/2,expected)
    for r in data["simplex"]:
        s=linprog(-np.asarray(r["h"]),A_eq=np.ones((1,len(r["h"]))),b_eq=[1],bounds=list(zip(r["lo"],r["hi"])),method="highs")
        assert s.success;compare("simplex",r["value"],-s.fun)
    for r in data["kl"]:
        p,h=np.asarray(r["p"]),np.asarray(r["h"]);radius=r["radius"]
        sol=minimize(lambda q:-h@q,p,jac=lambda q:-h,bounds=[(1e-12,1)]*len(p),constraints=[{"type":"eq","fun":lambda q:q.sum()-1,"jac":lambda q:np.ones(len(p))},{"type":"ineq","fun":lambda q:radius-rel_entr(p,q).sum(),"jac":lambda q:p/q}],method="SLSQP",options={"ftol":1e-11,"maxiter":1000})
        if not sol.success:raise RuntimeError(sol.message)
        compare("reverse_kl",r["value"],-sol.fun,2e-6)
        assert r["value"]>=-sol.fun-2e-8
    for r in data["partial"]:
        p,ll=partial_fit(r["n"],r["hist"])
        compare("partial_likelihood",r["fit"]["logLikelihood"],ll,1e-6)
        for a,b in zip(r["fit"]["p"],p):compare("partial_probability",a,b,2e-5)
        pairs=[(m,k) for m in range(r["n"]+1) for k in range(m+1)]
        for j in range(r["n"]+1):
            forced=sum(v for (m,k),v in zip(pairs,r["hist"]) if m==r["n"] and k==j)
            possible=sum(v for (m,k),v in zip(pairs,r["hist"]) if k<=j<=k+r["n"]-m)
            compare("completion",r["bounds"]["forced"][j],forced,0);compare("completion",r["bounds"]["possible"][j],possible,0)
    for r in data["weights"]:
        a=np.array(r["history"][-r["limit"]:])[:,r["g"]];w=r["decay"]**np.arange(len(a)-1,-1,-1)
        p=np.bincount(a,weights=w,minlength=r["n"]+1)/w.sum()
        for v,z in zip(r["result"]["p"],p):compare("weighted_probability",v,z)
        compare("effective_n",r["result"]["effectiveN"],w.sum()**2/(w@w))
    for r in data["stopping"]:
        for i,active in [(1,False),(2,True)]:
            compare("stopping_value",r["result"]["summary"][i]["nominalValue"],stop_reference(r["c"],r["result"]["counts"],active))
    for r in data["risk"]:
        rows=r["rows"];t=np.asarray(r["thresholds"]);a=np.array([v["score"] for v in rows]);l=np.array([v["autoLoss"] for v in rows]);N=len(rows)
        sums=(a[None,:]<=t[:,None])@l
        crc=(sums+r["Lmax"])/(N+1);pac=np.minimum(r["Lmax"],sums/N+r["Lmax"]*math.sqrt(math.log(len(t)/r["alpha"])/(2*N)))
        for k,arr in [("crc",crc),("pac",pac)]:
            eligible=t[arr<=r["target"]];expected=float(eligible[-1]) if len(eligible) else None
            assert expected==r["result"][k],(k,expected,r["result"][k])
            for i,v in enumerate(arr):compare("risk_"+k,r["result"]["curve"][i][k+"Bound"],v)
    for r in data["queue"]:
        result,summary=queue_reference(r["c"],r["stream"],r["feedback"])
        for k,v in summary.items():compare("queue_"+k,r["result"][k],v)
        for e in r["result"]["events"]:
            ref=result[e["id"]];assert ref["outcome"]==e["outcome"]
            for k in ["finish","wait","action","price"]:compare("queue_event_"+k,e[k],ref[k])
    print(json.dumps({"checks":checks,"max_absolute_error":worst,"by_check":by,"scope":"beta, unequal simplex, reverse KL, partial likelihood, weights, latent-state DP, risk threshold, event calendar"},indent=2))
if __name__=="__main__":main()
