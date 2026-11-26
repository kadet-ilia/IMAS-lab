import test from "node:test";
import assert from "node:assert/strict";
import {EXTRA_DEFAULTS,studyPlan,evaluateUnit,summarizeStudy} from "./extendedStudies.js";
import {dependenceTables,dependencePoint,dependenceStudy} from "./dependenceRobust.js";
import {tables,point} from "./extendedModel.js";
const c={...EXTRA_DEFAULTS,groups:[2,2],u:[[.15,.2],[.85,.8]],rho:[.2,.3],m:1000,reps:1,depBound:.4,stress:"dependenceRobust",levels:3};
const counts=[[[800,150,50],[700,200,100]],[[50,150,800],[100,200,700]]];
test("Zero dependence recovers independent bounds, positive TV only widens",()=>{
 const a=tables(c,counts),b=dependenceTables(c,counts,0),d=dependenceTables(c,counts,.4);
 for(let i=0;i<6;i++)for(let j=0;j<6;j++){const ix=[i,j],p=point(c,a,ix),q=dependencePoint(c,b,ix),v=dependencePoint(c,d,ix);assert.ok(Math.abs(p[0]-q[0])<1e-9&&Math.abs(p[1]-q[1])<1e-9);assert.ok(v[0]<=q[0]+1e-10&&v[1]>=q[1]-1e-10);}
 assert.deepEqual(dependencePoint(c,d,[0,0]),[c.prior,c.prior]);
});
test("Joint TV experiment has common counts and scope flags",()=>{
 const p=studyPlan("robustness",c);assert.equal(p.length,3);const records=p.map(u=>evaluateUnit("robustness",c,u,p.length)),s=summarizeStudy("robustness",c,records);assert.equal(s.rows.length,6);
 assert.deepEqual(records[0].counts,records[2].counts);assert.equal(s.rows[1].assumptionsValid,true);assert.equal(s.rows[3].assumptionsValid,false);
 for(const r of records){assert.ok(r.summary[1].coverage<=r.summary[0].coverage+1e-10);assert.ok(r.summary[1].width>=r.summary[0].width-1e-10);}
});
test("Large latent space uses product envelope",()=>{
 const n=8,z={...c,groups:Array(n).fill(2),u:[Array(n).fill(.2),Array(n).fill(.8)],rho:Array(n).fill(.2),m:1000};
 const D=dependenceTables(z,[0,1].map(x=>Array.from({length:n},()=>x?[50,150,800]:[800,150,50])),.2);assert.equal(D.algorithm,"product_envelope");const p=dependencePoint(z,D,Array(n).fill(0));assert.ok(Math.abs(p[0]-z.prior)<1e-12&&Math.abs(p[1]-z.prior)<1e-12);
});
