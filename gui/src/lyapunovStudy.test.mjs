import test from "node:test";
import assert from "node:assert/strict";
import {simulateRun,validateConfig,attackIntensity} from "./trustEngine.js";
import {
 defaultAttackPhases,validateAttackPhases,feedbackTrajectory,runLyapunovStudy,attackIntensityAt
} from "./lyapunovStudy.js";

const config={n_agents:7,n_byzantine:2,n_steps:8,attack_start_step:2,
 trim_each_side:2,honest_noise_sigma:0,observer_noise_sigma:0,
 isolation_enabled:false,network_enabled:false,static_bias:4,seed:1234};
const phases=[{start:1,intensity:0},{start:3,intensity:1},{start:5,intensity:0},{start:7,intensity:2}];

test("piecewise attack schedule reaches proposals, observations and recorded intensity",()=>{
 const x=simulateRun({...config,attack_schedule:phases},"dynamic",0,0,true);
 assert.deepEqual(x.trajectory.map(row=>row.attack_active),[0,0,1,1,0,0,1,1]);
 assert.deepEqual(x.trajectory.map(row=>row.attack_intensity),[0,0,1,1,0,0,2,2]);
 const mean=x.trajectory.map(row=>row.arithmetic_mean);
 assert.ok(Math.abs(mean[0]-config.desired_action||0)<1e-10);
 assert.ok(Math.abs(mean[2]-mean[0])>0.1);
 assert.ok(Math.abs(mean[4]-mean[0])<1e-10);
 assert.ok(Math.abs(mean[6]-mean[0])>Math.abs(mean[2]-mean[0]));
 assert.equal(attackIntensity(5,"dynamic",{attack_schedule:phases}),0);
});

test("schedule is validated and correct for edge horizons",()=>{
 assert.equal(defaultAttackPhases(8,2)[0].start,1);
 assert.equal(attackIntensityAt(7,phases),2);
 assert.throws(()=>validateAttackPhases([{start:2,intensity:1}],8),/первая фаза/);
 assert.throws(()=>validateAttackPhases([{start:1,intensity:0},{start:1,intensity:2}],8),/возрастать/);
 assert.throws(()=>validateConfig({...config,attack_schedule:[{start:1,intensity:Infinity}]}),/attack_schedule/);
});

test("noise-free nominal feedback has exact V(t+1)=0.25V(t)",()=>{
 const c=validateConfig(config);
 const trajectory=Array.from({length:c.n_steps},(_,i)=>({
  step:i+1,arithmetic_mean:c.desired_action,
  trust_weighted_mean:c.desired_action,proposed_robust:c.desired_action
 }));
 const result=feedbackTrajectory(trajectory,c,{gain:.5,initialError:1,tolerance:.01,runs:1,phases:[{start:1,intensity:0}]});
 const points=result.proposed_robust.points;
 for(let i=0;i<points.length;i++){
  assert.ok(Math.abs(points[i].e-.5**i)<1e-12);
  assert.ok(Math.abs(points[i].V-.25**i)<1e-12);
 }
 assert.equal(result.proposed_robust.metrics.positive_delta_v_fraction,0);
 assert.equal(result.proposed_robust.metrics.decision_rmse,0);
});

test("with nonzero disturbances positive deltaV is possible, ISS sampled bound holds",()=>{
 const c=validateConfig(config);
 const trajectory=Array.from({length:c.n_steps},(_,i)=>({
  step:i+1,arithmetic_mean:c.desired_action+1,
  trust_weighted_mean:c.desired_action+1,proposed_robust:c.desired_action+1
 }));
 const result=feedbackTrajectory(trajectory,c,{gain:.5,initialError:0,tolerance:.01,runs:1,phases});
 const points=result.proposed_robust.points;
 assert.ok(points[1].deltaV>0);
 for(const p of points)assert.ok(Math.abs(p.e)<=p.iss_bound+1e-12);
 assert.ok(result.proposed_robust.metrics.final_abs_error>0);
});

test("no decision causes safe hold and penalizes unconditional accuracy",()=>{
 const c=validateConfig(config);
 const trajectory=Array.from({length:c.n_steps},(_,i)=>({
  step:i+1,arithmetic_mean:null,trust_weighted_mean:null,proposed_robust:null
 }));
 const result=feedbackTrajectory(trajectory,c,{gain:.5,initialError:1,tolerance:.01,runs:1,phases});
 assert.equal(result.proposed_robust.metrics.decision_coverage,0);
 assert.equal(result.proposed_robust.metrics.correct_probability,0);
 assert.equal(result.proposed_robust.metrics.final_abs_error,1);
 assert.equal(result.proposed_robust.metrics.decision_rmse,null);
});

test("complete experiment compares identical random realizations across methods",()=>{
 const result=runLyapunovStudy(config,{gain:.5,initialError:1,tolerance:.1,runs:3,phases});
 assert.equal(result.runs.length,3);
 assert.equal(result.summary.length,3);
 assert.equal(result.series.length,9);
 assert.equal(result.comparison.length,8);
 assert.equal(result.nominal.unforced_lyapunov_factor,.25);
 assert.deepEqual(result.series.slice(1).map(row=>row.attack_intensity),[0,0,1,1,0,0,2,2]);
 for(const m of result.summary)assert.ok(m.state_rmse.mean>=0);
});


test("representative 50-agent 30-step dynamic study returns a finite output",()=>{
 const start=performance.now();
 const study=runLyapunovStudy({n_steps:30,n_agents:50,n_byzantine:10,attack_start_step:20},
  {runs:1,gain:.5,initialError:1,tolerance:.1,
   phases:[{start:1,intensity:0},{start:20,intensity:1},{start:22,intensity:1.5},{start:23,intensity:0}]});
 assert.equal(study.series.length,31);
 assert.ok(Number.isFinite(study.summary[0].decision_rmse.mean));
 assert.ok(performance.now()-start<20000,"one representative run is unexpectedly slow");
});

test("attack intensity curves interpolate from previous phase level to target",()=>{
 const profile=(curve)=>[{start:1,intensity:0,curve:"constant"},{start:3,intensity:4,curve},{start:8,intensity:0,curve:"constant"}];
 assert.deepEqual([3,4,5,6,7].map(step=>attackIntensityAt(step,profile("linear"),10)),[0,1,2,3,4]);
 const exponential=[3,4,5,6,7].map(step=>attackIntensityAt(step,profile("exponential"),10));
 const parabolic=[3,4,5,6,7].map(step=>attackIntensityAt(step,profile("parabolic"),10));
 const hyperbolic=[3,4,5,6,7].map(step=>attackIntensityAt(step,profile("hyperbolic"),10));
 for(const values of [exponential,parabolic,hyperbolic]){
  assert.equal(values[0],0);assert.equal(values.at(-1),4);
  assert.ok(values.every((value,i)=>i===0||value>=values[i-1]));
 }
 assert.ok(hyperbolic[1]>linearMid(profile("linear")));
 function linearMid(p){return attackIntensityAt(4,p,10);}
});
test("attack profile is limited to five phases and validates curve names",()=>{
 const five=Array.from({length:5},(_,i)=>({start:i+1,intensity:i,curve:"constant"}));
 assert.equal(validateAttackPhases(five,10).length,5);
 assert.throws(()=>validateAttackPhases([...five,{start:6,intensity:1}],10),/1 до 5/);
 assert.throws(()=>validateAttackPhases([{start:1,intensity:1,curve:"sine"}],10),/неизвестный закон/);
});
