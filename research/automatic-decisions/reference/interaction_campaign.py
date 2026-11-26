"""E2.20 exploratory deterministic Bayes campaign, one common-shock group.
Exactly 512 wide + 512 local configurations. No calibration randomness.
All signs are computed with fractions (including zeros).
"""
from fractions import Fraction as F
from random import Random
import json
from pathlib import Path
from statistics import mean
from interaction_reference import bayes_risk

ROOT=20261128
N=512

def inputs(rng, local):
    n=lambda a,b:rng.randint(a,b)
    q=lambda a,b:F(n(a,b),100)
    if local:
        size=n(8,10); u0=q(14,22); u1=q(46,54); prior=q(54,66)
        b=q(210,250); f=q(650,730); d=q(165,200); c=q(85,120)
        rl=q(50,62); rh=q(63,75); dl=q(18,28); dh=q(30,45)
    else:
        size=n(2,12); u0=q(2,85); u1=q(int(u0*100)+1,98); prior=q(5,95)
        b=q(50,800); f=q(50,800); d=q(0,int(min(b,f)*100)-1); c=q(5,400)
        rl=q(0,79); rh=q(int(rl*100)+1,100); dl=q(0,79); dh=q(int(dl*100)+1,100)
    return size,u0,u1,prior,b,f,d,c,rl,rh,dl,dh

def campaign():
    names=('n','u0','u1','prior','b','f','d','c','rhoLow','rhoHigh','dropLow','dropHigh')
    rows=[]; summary={}; rng=Random(ROOT); seen=set()
    for domain in ('wide','local'):
        current=[]
        while len(current)<N:
            x=inputs(rng,domain=='local')
            if x in seen:continue
            seen.add(x)
            n,*p,rl,rh,dl,dh=x
            rs=[bayes_risk(n,*p,rho,delta) for rho in (rl,rh) for delta in (dl,dh)]
            I=rs[3]-rs[2]-rs[1]+rs[0]
            row={'domain':domain,'case':len(current)+1,'inputs':{k:float(v) if k!='n' else v for k,v in zip(names,x)},'risks':[float(v) for v in rs],'contrast':float(I),'sign':(I>0)-(I<0)}
            current.append(row);rows.append(row)
        values=[v['contrast'] for v in current]
        summary[domain]={'configurations':N,'negative':sum(v['sign']==-1 for v in current),'zero':sum(v['sign']==0 for v in current),'positive':sum(v['sign']==1 for v in current),'mean':mean(values),'min':min(values),'max':max(values),'maxExample':max(current,key=lambda v:v['contrast'])}
    return {'version':'E2.20-oracle-pilot-v1','seed':ROOT,'uniqueConfigurations':len(seen),'summary':summary,'rows':rows,'scope':'One exchangeable group, common shock, MCAR, ideal Bayes with escalation. Exact rational arithmetic. Local domain was selected after observing a counterexample; counts are not population probabilities.'}

if __name__=='__main__':
    import sys
    data=campaign()
    Path(sys.argv[1] if len(sys.argv)>1 else 'interaction-pilot.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in data.items() if k!='rows'},ensure_ascii=False,indent=2))
