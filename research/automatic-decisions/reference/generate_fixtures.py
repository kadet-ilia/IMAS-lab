"""Primary inputs only; generated from the article's fixed NumPy streams."""
import argparse,json,scipy
from experiment import *
def sparse(v):
 return [[int(i),int(v[i])] for i in np.flatnonzero(v)]
def control(s,hat):
 out={}
 if s<=4:
  rg=np.random.default_rng(20262125+s); size=100000; x=rg.binomial(1,PI,size); idx=[]
  for g,n in enumerate(N):
   u=U[x,g].copy(); u[(x==1)&(g==0)&(s==4)]=.45
   r=0 if s==1 else RHO[g]; common=rg.random(size)<r; shared=rg.random(size)<u
   y=rg.random((size,n))<u[:,None]; y[common]=shared[common,None]; mask=rg.random((size,n))<(.95 if s<=2 else .6)
   m=mask.sum(1); k=(mask&y).sum(1);idx.append(m*(m+1)//2+k)
  i=np.ravel_multi_index(tuple(idx),SHAPE);out['mc']=[sparse(np.bincount(i[x==a],minlength=np.prod(SHAPE))) for a in (0,1)]
 rg=np.random.default_rng(91822+s); candidates=[]
 for _ in range(100):
  Q=[]
  for row in hat:
   rr=[]
   for n,p in zip(N,row):
    v=rg.dirichlet(np.ones(n+1));f=min(1,radius(n,M)/max(np.linalg.norm(v-p,1),1e-15));rr.append((p+rg.random()*f*(v-p)).tolist())
   Q.append(rr)
  candidates.append(Q)
 out['candidates']=candidates
 ebox=np.sqrt(np.log(2*sum(2*(n+1) for n in N)/A)/(2*M))
 box_values=[];l1_values=[]
 for row in hat:
  bb=[];ll=[]
  for g,n in enumerate(N):
   p=row[g];d=n+1;I=np.eye(d);eps=radius(n,M);bounds0=list(zip(np.maximum(0,p-ebox),np.minimum(1,p+ebox)))
   bv=[];lv=[]
   for h in H[g]:
    opt=linprog(-h,A_eq=np.ones((1,d)),b_eq=[1],bounds=bounds0,method='highs');assert opt.success;bv.append(float(-opt.fun))
    if s<=5:
     opt=linprog(np.r_[-h,np.zeros(d)],A_ub=np.vstack([np.c_[I,-I],np.c_[-I,-I],np.r_[np.zeros(d),np.ones(d)][None,:]]),b_ub=np.r_[p,-p,eps],A_eq=np.r_[np.ones(d),np.zeros(d)][None,:],b_eq=[1],bounds=(0,None),method='highs')
     assert opt.success;lv.append(float(-opt.fun))
   bb.append(bv);ll.append(lv)
  box_values.append(bb);l1_values.append(ll)
 out['box_lp']=box_values
 if s<=5:out['l1_lp']=l1_values
 return out
def generate(path):
 if (np.__version__,scipy.__version__)!=('2.3.5','1.17.0'):raise RuntimeError('Install pinned NumPy and SciPy versions')
 rng=np.random.default_rng(20261125);records=[]
 for s in range(1,9):
  q,_=laws(s)
  if s in (2,3,4,5):
   P=joint(q,s,True);z=(1-PI)*P[0]+PI*P[1]
  for rep in range(30):
   counts=[[rng.multinomial(M,q[x][g]).tolist() for g in range(3)] for x in range(2)]
   rec={'s':s,'rep':rep,'m':M,'counts':counts}
   if s in (2,3,4,5):rec['validation']=sparse(np.random.default_rng(20270000+s*100+rep).multinomial(M,z))
   if rep==0:rec['control']=control(s,[[np.array(a)/M for a in row] for row in counts])
   records.append(rec)
 for m in [500,2000,5000,20000,100000]:
  q,_=laws(3);rg=np.random.default_rng(20263125+m)
  for rep in range(30):
   records.append({'s':3,'rep':rep,'m':m,'sensitivity':True,'counts':[[rg.multinomial(m,q[x][g]).tolist() for g in range(3)] for x in range(2)]})
 payload={'schema':'imas-e2-fixtures-v1','seed':20261125,'numpy':np.__version__,'scipy':scipy.__version__,'records':records}
 path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(payload,separators=(',',':'),allow_nan=False),encoding='utf-8');tmp.replace(path)
 print(path, path.stat().st_size, 'bytes; records:',len(records))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);args=p.parse_args();generate(args.output)
