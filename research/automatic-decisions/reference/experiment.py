"""Exact enumeration of grouped binary judgments; synthetic, not operational data."""
import numpy as np, pandas as pd
from scipy.stats import binom, betabinom, hypergeom, t
from scipy.optimize import linprog
from itertools import product, combinations
from pathlib import Path
OUT=Path(__file__).resolve().parent
N=(9,7,5); U=np.array([[.22,.13,.18],[.78,.87,.82]]); RHO=np.array([.8,.45,.1]); PI=.35; A=.05; M=20000; TH=2/7.4; COST=1.25
PAIRS=[np.array([(m,k) for m in range(n+1) for k in range(m+1)]) for n in N]
H=[np.array([hypergeom.pmf(k,n,np.arange(n+1),m) for m,k in pairs]) for n,pairs in zip(N,PAIRS)]
SHAPE=tuple(len(p) for p in PAIRS)

def outer(v): return np.einsum('i,j,k->ijk',*v).ravel()
def likelihood(v): return np.array([outer(v[x]) for x in range(2)])
def q_mix(n,u,r):
 q=(1-r)*binom.pmf(np.arange(n+1),n,u); q[0]+=r*(1-u); q[-1]+=r*u; return q

def q_beta(n,u,r):
 if r<=1e-8: return binom.pmf(np.arange(n+1),n,u)
 if r>=1-1e-8: return q_mix(n,u,1.)
 z=1/r-1; return betabinom.pmf(np.arange(n+1),n,u*z,(1-u)*z)

def q_neg(n,u):
 z=n*u; j=int(z); q=np.zeros(n+1); q[j]=1-z+j; q[j+1]=z-j; return q

def laws(s):
 r=np.zeros(3) if s==1 else RHO
 fun=q_beta if s==5 else q_mix
 q=[[q_neg(n,U[x,g]) if s==6 else fun(n,U[x,g],r[g]) for g,n in enumerate(N)] for x in range(2)]
 test=[[a.copy() for a in row] for row in q]
 if s==4: test[1][0]=q_mix(9,.45,.8)
 return q,test

def transforms(s,nom=False):
 miss=.05 if s<=2 else .4
 if s==8 and not nom:
  return [np.array([binom.pmf(k,np.arange(n+1),.35)*binom.pmf(m-k,n-np.arange(n+1),.75) for m,k in p]) for n,p in zip(N,PAIRS)]
 return [h*binom.pmf(p[:,0],n,1-miss)[:,None] for n,p,h in zip(N,PAIRS,H)]

def joint(q,s,nom=False):
 T=transforms(s,nom)
 P=likelihood([[T[g]@q[x][g] for g in range(3)] for x in range(2)])
 if s==7 and not nom:
  for x in range(2):
   F=[np.cumsum(a) for a in q[x]]; cuts=np.unique(np.clip(np.r_[0.,1.,*F],0,1)); z=np.zeros(tuple(n+1 for n in N))
   for a,b in zip(cuts[:-1],cuts[1:]):
    if b>a: z[tuple(min(n,np.searchsorted(f,(a+b)/2)) for n,f in zip(N,F))]+=b-a
   co=np.einsum('ia,jb,kc,abc->ijk',*T,z,optimize=True).ravel(); P[x]=.8*P[x]+.2*co
 assert np.allclose(P.sum(1),1,atol=1e-12)
 return P

def radius(n,m): return min(2,np.sqrt(2/m*np.log((2**(n+1)-2)*6/A)))
def extrem(h,q,r):
 order=np.argsort(h); a=q.copy(); budget=r/2; i=0;j=len(q)-1
 while i<j and budget>1e-15:
  l,k=order[i],order[j]; v=min(a[l],1-a[k],budget)
  if h[k]<=h[l]: break
  a[l]-=v; a[k]+=v; budget-=v
  if a[l]<1e-14:i+=1
  if a[k]>1-1e-14:j-=1
 return h@a

def box_ext(h,q,e):
 lo=np.maximum(0,q-e); hi=np.minimum(1,q+e); p=lo.copy(); b=1-p.sum()
 for k in np.argsort(-h):
  v=min(b,hi[k]-p[k]);p[k]+=v;b-=v
 return h@p

def post(P):
 den=(1-PI)*P[0]+PI*P[1]; return np.divide(PI*P[1],den,out=np.full_like(den,PI),where=den>0)
def bounds(q,m,box=False):
 eps=np.sqrt(np.log(2*sum(2*(n+1) for n in N)/A)/(2*m))
 fn=lambda h,a,n:box_ext(h,a,eps) if box else extrem(h,a,radius(n,m))
 low=likelihood([[np.maximum(0,[-fn(-h,q[x][g],n) for h in H[g]]) for g,n in enumerate(N)] for x in range(2)])
 hi=likelihood([[np.maximum(0,[fn(h,q[x][g],n) for h in H[g]]) for g,n in enumerate(N)] for x in range(2)])
 a=PI*low[1]; b=(1-PI)*hi[0]; c=PI*hi[1]; d=(1-PI)*low[0]
 return np.divide(a,a+b,out=np.zeros_like(a),where=a+b>0),np.divide(c,c+d,out=np.ones_like(c),where=c+d>0)

def decisions(lo,hi,c,strict=True):
 w0=6*hi;w1=2-1.4*lo
 if strict:
  a=np.where((hi<TH)&(w0<=c),0,np.where((lo>TH)&(w1<=c),1,2))
 else: a=np.where(np.minimum(w0,w1)<=c,(w1<w0).astype(int),2)
 return a

def score(p):return np.minimum(6*p,2-1.4*p)
def metrics(P,a,c,acc=None):
 p0=(1-PI)*P[0];p1=PI*P[1]; z=p0+p1
 if acc is None:acc=(a!=2).astype(float)
 assert np.all((acc>=0)&(acc<=1))
 miss=np.sum(p1*(a==0)*acc); false=np.sum(p0*(a==1)*acc); cov=z@acc
 loss=6*miss+2*false+.6*np.sum(p1*(a==1)*acc)+c*(1-cov)
 return np.array([cov,loss,miss,false])
def match(p,P,target):
 z=(1-PI)*P[0]+PI*P[1]; v=np.round(score(p),12); order=np.argsort(v,kind='stable');cum=np.cumsum(z[order]); i=min(len(z)-1,np.searchsorted(cum,target));cut=v[order[i]]; keep=v<cut; tie=v==cut; frac=np.clip((target-z@keep)/max(z@tie,1e-300),0,1); return keep+frac*tie

def estimate_beta(q):
 b=[]
 for row in q:
  z=[]
  for n,p in zip(N,row):
   j=np.arange(n+1); u=np.clip(j@p/n,1e-9,1-1e-9); r=((j*(j-1))@p/(n*(n-1))-u*u)/(u*(1-u));z.append(q_beta(n,u,np.clip(r,0,.999999)))
  b.append(z)
 return b

def estimate_mix(q):
 b=[]
 for row in q:
  z=[]
  for n,p in zip(N,row):
   j=np.arange(n+1); u=np.clip(j@p/n,1e-9,1-1e-9); r=((j*(j-1))@p/(n*(n-1))-u*u)/(u*(1-u));z.append(q_mix(n,u,np.clip(r,0,1)))
  b.append(z)
 return b

def independent(q):return [[binom.pmf(np.arange(n+1),n,np.arange(n+1)@q[x][g]/n) for g,n in enumerate(N)] for x in range(2)]
def cert(q,a,s,m):
 T=transforms(s,True); P=joint(q,s,True); gam=metrics(P,a,1.25)[0]; e=np.array([radius(n,m) for n in N]); D=1-np.prod(1-e/2); C=(a!=2).reshape(SHAPE).astype(float)
 rem=sum(np.prod(e[list(J)])/2 for k in (2,3) for J in combinations(range(3),k))
 d=0
 for x,pi in [(0,1-PI),(1,PI)]:
  f=[T[g]@q[x][g] for g in range(3)]
  for g in range(3):
   vv=[f[j] if j!=g else None for j in range(3)]
   if g==0: h=T[g].T@np.einsum('ijk,j,k->i',C,vv[1],vv[2])
   elif g==1:h=T[g].T@np.einsum('ijk,i,k->j',C,vv[0],vv[2])
   else:h=T[g].T@np.einsum('ijk,i,j->k',C,vv[0],vv[1])
   d+=pi*(h@q[x][g]+extrem(-h,q[x][g],e[g]))
 return gam,max(0,gam-D),max(0,gam-D,gam-d-rem)

def run():
 rng=np.random.default_rng(20261125); rows=[]; costs=[]; matched=[]; validity=[]; checks=[]; valrows=[]; sens=[]
 for s in range(1,9):
  q,Q=laws(s); P=joint(Q,s); ptrue=post(P); z=(1-PI)*P[0]+PI*P[1]
  for rep in range(30):
   hat=[[rng.multinomial(M,q[x][g])/M for g in range(3)] for x in range(2)]
   Pnom=joint(hat,s,True); lo,hi=bounds(hat,M); blo,bhi=bounds(hat,M,True)
   pm={3:post(joint(independent(hat),s,True)),4:post(Pnom),8:post(joint(estimate_beta(hat),s,True)),10:ptrue,11:post(joint(estimate_mix(hat),s,True))}
   aa={j:decisions(p,p,COST) for j,p in pm.items()}; aa[6]=decisions(lo,hi,COST);aa[7]=decisions(lo,hi,COST,False);aa[9]=decisions(blo,bhi,COST)
   for j,a in aa.items(): rows.append([s,rep,j,*metrics(P,a,COST)])
   cov=metrics(P,aa[6],COST)[0]; assert np.array_equal(aa[6],aa[7]);
   for j,p in pm.items():
    a=(p>TH).astype(int); ac=match(p,P,cov);matched.append([s,rep,j,*metrics(P,a,COST,ac)])
   matched.append([s,rep,6,*metrics(P,aa[6],COST)])
   g,b,bt=cert(hat,aa[6],s,M)
   covered=(ptrue>=lo-1e-12)&(ptrue<=hi+1e-12)
   realrisk=np.where(aa[6]==0,6*ptrue,2-1.4*ptrue)
   validity.append([s,rep,z@covered,z@(hi-lo),g,b,bt,cov,z@((aa[6]!=2)&(realrisk>COST+1e-12)),int(all(np.linalg.norm(q[x][g]-hat[x][g],1)<=radius(n,M) for x in range(2) for g,n in enumerate(N)))])
   if s==3:
    for c in [.75,1.,1.25,1.5,6*TH,1.75,2.,2.5]:
     for j,strict in [(6,True),(7,False)]:
      a=decisions(lo,hi,c,strict); costs.append([c,rep,j,*metrics(P,a,c),z@((a!=2)&(lo<=TH)&(hi>=TH))])
   if s in (2,3,4,5):
    Pv=joint(q,s,True); zv=(1-PI)*Pv[0]+PI*Pv[1]; vrng=np.random.default_rng(20270000+s*100+rep); v=vrng.multinomial(M,zv)/M
    target=v@(aa[6]!=2); V=np.stack([v,v])
    for j in (3,4,8,11):
     p=pm[j]; ac=match(p,V,target); valrows.append([s,rep,j,*metrics(P,(p>TH).astype(int),COST,ac)])
    valrows.append([s,rep,6,*metrics(P,aa[6],COST)])
   if rep==0 and s<=5:
    for x in range(2):
     for g,n in enumerate(N):
      a=hat[x][g];d=n+1; I=np.eye(d); eps=radius(n,M)
      for h in H[g]:
       r=linprog(np.r_[-h,np.zeros(d)],A_ub=np.vstack([np.c_[I,-I],np.c_[-I,-I],np.r_[np.zeros(d),np.ones(d)][None,:]]),b_ub=np.r_[a,-a,eps],A_eq=np.r_[np.ones(d),np.zeros(d)][None,:],b_eq=[1],bounds=(0,None),method='highs')
       assert r.success; checks.append(abs(-r.fun-extrem(h,a,eps)))
  print('scenario',s,flush=True)
 for m in [500,2000,5000,20000,100000]:
  q,Q=laws(3);P=joint(Q,3); z=(1-PI)*P[0]+PI*P[1]; rg=np.random.default_rng(20263125+m)
  for rep in range(30):
   hat=[[rg.multinomial(m,q[x][g])/m for g in range(3)] for x in range(2)];lo,hi=bounds(hat,m);a=decisions(lo,hi,COST);g,b,bt=cert(hat,a,3,m); met=metrics(P,a,COST);sens.append([m,rep,z@(hi-lo),*met,b,bt])
 for name,rr,cols in [('fixed',rows,['scenario','rep','method','coverage','loss','miss','false']),('matched',matched,['scenario','rep','method','coverage','loss','miss','false']),('cost',costs,['cost','rep','method','coverage','loss','miss','false','crossing_coverage']),('validity',validity,['scenario','rep','posterior_mass','width','nominal','lower','lower_tight','coverage','risk_violation_mass','calibration_included']),('validation',valrows,['scenario','rep','method','coverage','loss','miss','false']),('sensitivity',sens,['n','rep','width','coverage','loss','miss','false','lower','lower_tight'])]:
  df=pd.DataFrame(rr,columns=cols);df.to_csv(OUT/(name+'.csv'),index=False);print(name); print(df.groupby([c for c in cols if c in ['scenario','method','cost','n']]).mean(numeric_only=True).round(6).to_string())
 print('LP maximum discrepancy',max(checks));(OUT/'checks.txt').write_text(f'LP maximum discrepancy = {max(checks):.16g}\n')
if __name__=='__main__':run()
