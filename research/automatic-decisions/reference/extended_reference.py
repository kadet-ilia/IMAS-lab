"""Independent small-problem reference for E2 extensions. No JS algorithm imports."""
import itertools
import json
import math
import sys
import numpy as np
from scipy.optimize import linprog, minimize_scalar
from scipy.stats import hypergeom, binom

def extremum(h, p, family, radius):
    h, p = np.asarray(h, float), np.asarray(p, float)
    k = len(p)
    if family == "l1":
        A = np.vstack([np.c_[np.eye(k), -np.eye(k)], np.c_[-np.eye(k), -np.eye(k)], np.r_[np.zeros(k), np.ones(k)]])
        b = np.r_[p, -p, radius]
        obj = np.r_[-h, np.zeros(k)]
        eq = np.r_[np.ones(k), np.zeros(k)][None, :]
        bounds = [(0, None)] * (2*k)
    elif family == "box":
        A, b, obj, eq = None, None, -h, np.ones((1,k))
        bounds = list(zip(np.maximum(0,p-radius), np.minimum(1,p+radius)))
    elif family == "wasserstein":
        A = (np.abs(np.arange(k)[:,None]-np.arange(k)[None,:])/(k-1)).reshape(1,-1)
        b, obj = [radius], -np.tile(h,k)
        eq = np.kron(np.eye(k), np.ones((1,k)))
        bounds = [(0,None)]*(k*k)
    elif family == "moments":
        z = np.arange(k)/(k-1)
        T = np.vstack([z,z*z])
        A, b, obj, eq = np.vstack([T,-T]), np.r_[T@p+radius,-T@p+radius], -h, np.ones((1,k))
        bounds = [(0,None)]*k
    else:
        raise ValueError(family)
    sol = linprog(obj,A_ub=A,b_ub=b,A_eq=eq,b_eq=p if family=="wasserstein" else [1.],bounds=bounds,method="highs")
    if not sol.success:
        raise RuntimeError(sol.message)
    return -float(sol.fun)

def grouped(c, counts):
    """Independent exact calculation, using LP extrema and SciPy observation laws."""
    groups = c["groups"]
    B = len(groups)
    alpha, M = c["alpha"], c["m"]
    priors = np.array([1-c["prior"],c["prior"]])
    pairs = [list((m,k) for m in range(n+1) for k in range(m+1)) for n in groups]
    H = [np.array([hypergeom.pmf(k,n,np.arange(n+1),m) for m,k in o]) for n,o in zip(groups,pairs)]
    mask = [np.array([binom.pmf(m,n,1-c["drop"]) for m,k in o]) for n,o in zip(groups,pairs)]
    q, p = [], []
    for x in range(2):
        q.append([])
        p.append([])
        for g,n in enumerate(groups):
            u,r = c["u"][x][g],c["rho"][g]*c["rhoScale"]
            law = (1-r)*binom.pmf(np.arange(n+1),n,u)
            law[0]+=r*(1-u)
            law[-1]+=r*u
            q[x].append(law/law.sum())
            p[x].append(np.array(counts[x][g])/M)
    e = [min(2,math.sqrt(2/M*math.log((2**(n+1)-2)*2*B/alpha))) for n in groups]
    low = [[np.array([-extremum(-h,p[x][g],"l1",e[g]) for h in H[g]]).clip(0,1) for g in range(B)] for x in range(2)]
    high = [[np.array([extremum(h,p[x][g],"l1",e[g]) for h in H[g]]).clip(0,1) for g in range(B)] for x in range(2)]
    f = [[(H[g]@q[x][g])*mask[g] for g in range(B)] for x in range(2)]
    fn = [[(H[g]@p[x][g])*mask[g] for g in range(B)] for x in range(2)]
    loss = np.array([[0,c["b"]],[c["f"],c["d"]],[c["c"],c["c"]]])
    theta = c["f"]/(c["b"]+c["f"]-c["d"])
    out = dict(coverage=0.,loss=0.,miss=0.,false=0.,nomCoverage=0.,nomLoss=0.,posteriorMass=0.,width=0.,violation=0.)
    first = [[np.zeros(len(o)) for o in pairs] for _ in range(2)]
    for ix in itertools.product(*(range(len(o)) for o in pairs)):
        def prod(t,x): return math.prod(t[x][g][i] for g,i in enumerate(ix))
        a,b=priors[1]*prod(low,1),priors[0]*prod(high,0)
        u,v=priors[1]*prod(high,1),priors[0]*prod(low,0)
        if b==0 and u==0: lo,hi=0.,1.
        elif b==0: lo,hi=1.,1.
        elif u==0: lo,hi=0.,0.
        else: lo,hi=a/(a+b),u/(u+v)
        action=0 if hi<theta and c["b"]*hi<=c["c"] else 1 if lo>theta and c["f"]+(c["d"]-c["f"])*lo<=c["c"] else 2
        z=priors*np.array([prod(f,x) for x in range(2)])
        zn=priors*np.array([prod(fn,x) for x in range(2)])
        mass=z.sum()
        out["loss"]+=z@loss[action]
        out["nomLoss"]+=zn@loss[action]
        out["width"]+=mass*(hi-lo)
        if mass and lo-1e-12<=z[1]/mass<=hi+1e-12: out["posteriorMass"]+=mass
        if action!=2:
            out["coverage"]+=mass
            out["nomCoverage"]+=zn.sum()
            out["miss"]+=z[1] if action==0 else 0
            out["false"]+=z[0] if action==1 else 0
            if mass and z@loss[action]/mass>c["c"]+1e-12: out["violation"]+=mass
            for x in range(2):
                for g,i in enumerate(ix):
                    first[x][g][i]+=math.prod(fn[x][j][ix[j]] for j in range(B) if j!=g)
    D=1-math.prod(1-r/2 for r in e)
    rem=(math.prod(1+r for r in e)-1-sum(e))/2
    penalty=0
    for x in range(2):
        d=0
        for g in range(B):
            h=(first[x][g]*mask[g])@H[g]
            d+=h@p[x][g]+extremum(-h,p[x][g],"l1",e[g])
        penalty+=priors[x]*(max(0,d)+rem)
    out["lower"]=max(0,out["nomCoverage"]-D)
    out["tight"]=max(out["lower"],out["nomCoverage"]-penalty,0)
    Lmax=float(loss.max())
    out["upperRisk"]=min(Lmax,out["nomLoss"]+Lmax*D)
    return out

def queue(lam,mu,s):
    a=lam/mu
    if a>=s: return None
    term=a**s/math.factorial(s)/(1-a/s)
    p=term/(sum(a**n/math.factorial(n) for n in range(s))+term)
    return {"waitProb":p,"Wq":p/(s*mu-lam),"Lq":lam*p/(s*mu-lam)}

def run():
    data=json.load(sys.stdin)
    max_error=0.
    checks=0
    def compare(a,b,tol=2e-9):
        nonlocal max_error,checks
        err=abs(float(a)-float(b))
        max_error=max(err,max_error)
        checks+=1
        if err>tol: raise AssertionError((a,b,err,tol))
    for row in data["exact"]:
        expected=grouped(row["config"],row["counts"])
        for k,v in expected.items(): compare(row[k],v)
    for r in data["extrema"]:
        v=extremum(r["h"],r["p"],r["family"],r["radius"])
        # Numerical dual approximations must never underestimate the LP maximum.
        if r["family"] in ("wasserstein","moments"):
            if r["value"]<v-2e-9: raise AssertionError(r)
            if r["value"]>max(r["h"])+2e-9: raise AssertionError(r)
            if r["family"]=="wasserstein": compare(r["value"],v,2e-6)
            else: checks+=1
        else: compare(r["value"],v)
    for r in data["queue"]:
        v=queue(r["lambda"],r["mu"],r["s"])
        if v is None: assert not r["result"]["stable"]; checks+=1
        else:
            for k,a in v.items(): compare(r["result"][k],a)
    for r in data["multi"]:
        vertices=[np.array(v) for v in itertools.product(*zip(r["lo"],r["hi"])) if sum(v)>0]
        L=np.asarray(r["loss"])
        risk=np.array([L@w/w.sum() for w in vertices])
        choices=[a for a in range(len(L)) if risk[:,a].max()<=r["c"]+1e-12 and all((risk[:,a]-risk[:,b]).max()<-1e-12 for b in range(len(L)) if a!=b)]
        assert r["action"]==(choices[0] if choices else len(L)),r
        checks+=1
    print(json.dumps({"checks":checks,"max_absolute_error":max_error,"scope":"small nominal L1, LP extrema, Erlang C, multiclass vertices"},indent=2))

if __name__=="__main__":
    run()
