/**
 * E1-A UI-only diagnostic of *scheduled* effective attack opportunity.
 * Does not use simulated byzantine identities or oracle truth.
 * Matches the time-gating semantics of adaptiveScenario.js for dynamic
 * intensity schedules. No network delivery or realized attack success
 * is inferred from this deterministic schedule.
 */
import {attackIntensityAt,validateAttackPhases} from "./attackProfiles.js";

export const ADAPTIVE_EXPOSURE_DIAGNOSTICS_VERSION="e1a-scheduled-exposure-1.0.0";

export function projectAdaptiveAttackExposure(options={},horizon){
 if(!Number.isInteger(horizon)||horizon<1||horizon>50000)
  throw Error("E1-A exposure: horizon must be a positive integer");
 if(options.scenario!=="dynamic")
  return null;
 const phases=validateAttackPhases(options.phases,horizon);
 const strategy=options.attackStrategy??"legacy";
 if(!["legacy","coordinated","stealth","pulsed","reputation_boost"].includes(strategy))
  throw Error("E1-A exposure: unknown attack strategy");
 const period=options.attackPeriod??10,duty=options.attackDuty??4;
 const warmup=options.reputationWarmup??12;
 if(!Number.isInteger(period)||period<1||!Number.isInteger(duty)||
  duty<1||duty>period||!Number.isInteger(warmup)||warmup<0)
  throw Error("E1-A exposure: invalid temporal behavior parameters");
 const points=Array.from({length:horizon},(_,index)=>{
  const step=index+1;
  const intensity=attackIntensityAt(step,phases,horizon);
  const behavioral=strategy==="pulsed"?
   (step-1)%period<duty:
   strategy==="reputation_boost"?step>warmup:true;
  const effective=behavioral?intensity:0;
  return {step,intensity,actualIntensity:effective,
   nominalActive:intensity>0,actualActive:effective>0};
 });
 const nominalActiveSteps=points.filter(x=>x.nominalActive).length;
 const effectiveActiveSteps=points.filter(x=>x.actualActive).length;
 return Object.freeze({strategy,horizon,nominalActiveSteps,effectiveActiveSteps,
  suppressedActiveSteps:nominalActiveSteps-effectiveActiveSteps,
  zeroEffectiveExposure:nominalActiveSteps>0&&effectiveActiveSteps===0,
  points,interpretation:"Scheduled attack activity, not delivered malicious traffic or success"});
}
