"""Independent E2.21/22/27/32 reference.
TV: direct LP over probability and absolute-deviation variables.
Identification: independent LP feasibility and component-bound formulas.
POMDP: exact rational recursion on unnormalized hidden-state masses.
Statistics: SciPy binomial survival and closed-form Holm.
"""
import json
import sys
import math
import itertools as it
from fractions import Fraction as F
import numpy as np
from scipy.optimize import linprog
from scipy.stats import binom

def extreme(h, p, radius, maximize):
    h, p = np.array(h), np.array(p)
    n = len(p)
    eye = np.eye(n)
    A = np.vstack([np.hstack([eye, -eye]), np.hstack([-eye, -eye]),
                   np.r_[np.zeros(n), np.ones(n)]])
    b = np.r_[p, -p, radius]
    obj = np.r_[(-1 if maximize else 1)*h, np.zeros(n)]
    r = linprog(obj, A_ub=A, b_ub=b, A_eq=[np.r_[np.ones(n),np.zeros(n)]],
                b_eq=[1], bounds=(0,None), method="highs")
    if not r.success:
        raise RuntimeError(r.message)
    return float(h @ r.x[:n])

def tv(c):
    sizes = c["groups"]
    B = len(sizes)
    h = []
    for n,i in zip(sizes,c["ix"]):
        m,k = [(m,k) for m in range(n+1) for k in range(m+1)][i]
        C = lambda a,b: math.comb(a,b) if 0 <= b <= a else 0
        h.append([C(j,k)*C(n-j,m-k)/C(n,m) for j in range(n+1)])
    joint = [math.prod(z) for z in it.product(*h)]
    osc = max(joint)-min(joint)
    lo,hi = [],[]
    for row in c["counts"]:
        p = [np.array(a)/sum(a) for a in row]
        rad = [min(2,math.sqrt(2*math.log((2**(n+1)-2)*2*B/c["alpha"])/sum(a)))
               for n,a in zip(sizes,row)]
        D = min(1,c["bound"]+1-math.prod(1-r/2 for r in rad))
        center = [math.prod(z) for z in it.product(*p)]
        a = max(min(joint),math.prod(extreme(v,q,r,False) for v,q,r in zip(h,p,rad))-c["bound"]*osc,
                extreme(joint,center,2*D,False))
        b = min(max(joint),math.prod(extreme(v,q,r,True) for v,q,r in zip(h,p,rad))+c["bound"]*osc,
                extreme(joint,center,2*D,True))
        lo.append(max(min(joint),a-1e-13*osc))
        hi.append(min(max(joint),b+1e-13*osc))
    p = c["prior"]
    A,B = (1-p)*hi[0],p*hi[1]
    if A==0 and B==0: return [0,1]
    if A==0: return [1,1]
    if B==0: return [0,0]
    return [p*lo[1]/(p*lo[1]+A), B/(B+(1-p)*lo[0])]

def identification(c):
    v,N,h,G=c["completion"],c["N"],c["h"],c["gamma"]
    # Independent odds calculation via solving a two-outcome normalization.
    p=sum(v["forced"])/N
    p0=max(0,p-h); p1=min(1,p+h)
    s0=0 if p0==0 else 1/(1+G*(1-p0)/p0)
    s1=0 if p1==0 else 1/(1+(1-p1)/(G*p1))
    L=[max(a, max(0,z/N-h)/s1 if s1 else 0) for a,z in zip(v["lower"],v["forced"])]
    U=[min(a, min(1,(z/N+h)/s0) if s0 else 1) for a,z in zip(v["upper"],v["forced"])]
    ok=False
    if all(a<=b for a,b in zip(L,U)):
        r=linprog(np.zeros(len(L)),A_eq=[np.ones(len(L))],b_eq=[1],bounds=list(zip(L,U)),method="highs")
        ok=r.success
    return (L+U if ok else v["lower"]+v["upper"])+[int(ok)]

def pomdp(c):
    f=lambda x:F(str(x))
    p,b,g,d,esc,safe,w,a,z=[f(c[k]) for k in ("prior","b","f","d","c","safetyRisk","waitCost","p01","p10")]
    agents=[(f(v["u0"]),f(v["u1"]),f(v["availability"]),v["delay"],f(v["cost"])) for v in c["pomdpAgents"]]
    # Values are unconditional contributions of a history, so Bayes division
    # is not needed. All terminal choices use the strict M6 admissibility.
    def visit(m0,m1,t,left):
        mass=m0+m1
        if not mass:return F(0)
        r0=b*m1;r1=g*m0+d*m1
        vals=[esc*mass]
        if r0<r1 and r0<=safe*mass:vals.append(r0)
        if r1<r0 and r1<=safe*mass:vals.append(r1)
        if not t:return min(vals)
        def advance(k):
            v0,v1=m0,m1
            for _ in range(k):
                v0,v1=v0*(1-a)+v1*z,v0*a+v1*(1-z)
            return v0,v1
        x,y=advance(1);vals.append(w*mass+visit(x,y,t-1,left))
        for i in left:
            u0,u1,v,dt,cost=agents[i]
            if dt>t:continue
            x,y=advance(dt);rest=tuple(j for j in left if j!=i)
            vals.append((cost+w*dt)*mass+visit(x*(1-u0)*v,y*(1-u1)*v,t-dt,rest)+
                        visit(x*u0*v,y*u1*v,t-dt,rest)+visit(x*(1-v),y*(1-v),t-dt,rest))
        return min(vals)
    value=float(visit(1-p,p,c["pomdpHorizon"],tuple(range(len(agents)))))
    return [value,value]

def statistics(c):
    ps=c["ps"]
    order=sorted(range(len(ps)),key=lambda i:ps[i])
    adjusted=[0]*len(ps)
    for j,i in enumerate(order):
        adjusted[i]=min(1,max((len(ps)-k)*ps[order[k]] for k in range(j+1)))
    return [float(binom.sf(c["k"]-1,c["N"],c["p"]))]+adjusted

def main():
    rows=json.load(sys.stdin);summary={};failures=[]
    for row in rows:
        kind=row["kind"];ref=globals()[kind](row["input"]);obs=row["actual"]
        if len(ref)!=len(obs):raise RuntimeError("length mismatch")
        err=max(abs(x-y) for x,y in zip(ref,obs))
        s=summary.setdefault(kind,{"cases":0,"values":0,"maxAbsError":0})
        s["cases"]+=1;s["values"]+=len(ref);s["maxAbsError"]=max(s["maxAbsError"],err)
        if not math.isfinite(err) or err>2e-8:failures.append({"kind":kind,"id":row["id"],"error":err,"expected":ref,"actual":obs})
    print(json.dumps({"cases":len(rows),"byKind":summary,"failures":failures}))
if __name__=="__main__":main()
