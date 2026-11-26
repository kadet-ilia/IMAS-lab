from experiment import *
rng=np.random.default_rng(20261125); result=[]; mc=[]
for s in range(1,9):
 q,Q=laws(s);P=joint(Q,s)
 for rep in range(30):
  hat=[[rng.multinomial(M,q[x][g])/M for g in range(3)] for x in range(2)]
  if rep!=0:continue
  lo,hi=bounds(hat,M);a=decisions(lo,hi,COST)
  if s<=4:
   rg=np.random.default_rng(20262125+s); size=100000; x=rg.binomial(1,PI,size); idx=[]
   for g,n in enumerate(N):
    u=U[x,g].copy(); u[(x==1)&(g==0)&(s==4)]=.45
    r=0 if s==1 else RHO[g]; common=rg.random(size)<r; shared=rg.random(size)<u
    y=rg.random((size,n))<u[:,None]; y[common]=shared[common,None]; mask=rg.random((size,n))<(.95 if s<=2 else .6)
    m=mask.sum(1); k=(mask&y).sum(1);idx.append(m*(m+1)//2+k)
   acts=a[np.ravel_multi_index(tuple(idx),SHAPE)]; L=np.where(acts==2,COST,np.where(acts==0,6*x,np.where(x==1,.6,2.)))
   exact=metrics(P,a,COST); mc.append([s,exact[0],(acts!=2).mean(),exact[1],L.mean(),L.std(ddof=1)/np.sqrt(size)])
  ebox=np.sqrt(np.log(2*sum(2*(n+1) for n in N)/A)/(2*M));err=0
  for row in hat:
   for g,n in enumerate(N):
    h=H[g]; p=row[g]; bb=list(zip(np.maximum(0,p-ebox),np.minimum(1,p+ebox)))
    for v in h:
     opt=linprog(-v,A_eq=np.ones((1,n+1)),b_eq=[1],bounds=bb,method='highs'); assert opt.success; err=max(err,abs(-opt.fun-box_ext(v,p,ebox)))
  gam,lb,lt=cert(hat,a,s,M); rg=np.random.default_rng(91822+s); min_cov=1
  for _ in range(100):
   QQ=[]
   for row in hat:
    rr=[]
    for n,p in zip(N,row):
     v=rg.dirichlet(np.ones(n+1)); f=min(1,radius(n,M)/max(np.linalg.norm(v-p,1),1e-15));rr.append(p+rg.random()*f*(v-p))
    QQ.append(rr)
   cc=metrics(joint(QQ,s,True),a,COST)[0];min_cov=min(cc,min_cov);assert cc+1e-12>=lt
  result.append([s,err,lb,lt,min_cov])
pd.DataFrame(mc,columns=['scenario','exact_coverage','mc_coverage','exact_loss','mc_loss','se']).to_csv(OUT/'monte_carlo.csv',index=False)
pd.DataFrame(result,columns=['scenario','box_lp_error','lower','lower_tight','sampled_min_coverage']).to_csv(OUT/'certificate_checks.csv',index=False)
D=pd.read_csv(OUT/'matched.csv'); results=[]
for s in range(1,9):
 d=D[D.scenario==s].pivot(index='rep',columns='method',values='loss')
 for j in [3,4,8,11]:
  v=d[j]-d[6];w=t.ppf(1-.05/(2*32),len(v)-1)*v.std(ddof=1)/np.sqrt(len(v));results.append([s,j,v.mean(),v.mean()-w,v.mean()+w])
pd.DataFrame(results,columns=['scenario','baseline','difference','lower','upper']).to_csv(OUT/'paired.csv',index=False)
print('MC',mc);print('checks',result)
