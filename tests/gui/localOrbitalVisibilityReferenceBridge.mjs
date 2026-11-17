#!/usr/bin/env node
/**
 * JS event bridge only. Numerical ephemeris and interval fusion are rebuilt
 * independently in the Python test, not imported from this module.
 */
import {simulateLocalPlant} from "../../gui/src/adaptiveLocalPlant.js";
import {syntheticOrbitVisibility} from "../../gui/src/adaptiveCrossOrbitalVisibility.js";

const base={
 plantSeed:20261217,plantSteps:44,plantAgents:8,plantByzantine:2,
 plantTopology:"complete",plantControlMode:"local_sensor",
 plantSensorFaultMode:"dropout",plantSensorFaultFraction:.5,
 plantSensorFaultStart:4,plantSensorFaultEnd:39,plantGuardEnabled:false,
 plantCapacity:48,plantTransportLoss:.03,
 plantCrossEnabled:true,plantCrossFaultBudget:2,
 plantCrossObservationMode:"orbital_visibility",
 plantCrossOrbitRadius:2,plantCrossOrbitPlanes:2,
 plantCrossOrbitInclination:.9,plantCrossOrbitAngularRate:.23,
 plantCrossMaxRange:5,plantCrossBound:.04,
 plantCrossDistanceErrorSlope:.02,plantCrossDelay:1,
 plantCrossTTL:5,plantCrossLoss:.03,plantCrossBandwidthFraction:.65
};
const configs=[
 {...base,plantCrossCentralBodyRadius:0},
 {...base,plantCrossCentralBodyRadius:1.5},
 {...base,plantCrossCentralBodyRadius:0,
  plantCrossPointingMode:"prograde",
  plantCrossPointingHalfAngle:Math.PI/2},
 {...base,plantCrossCentralBodyRadius:1.5,
  plantCrossPointingMode:"prograde",
  plantCrossPointingHalfAngle:2.6,
  plantCrossOrbitPositionError:.06,
  plantCrossOrbitPointingError:.08},
 {...base,plantTopology:"ring",plantCrossCentralBodyRadius:0}
];
const results=configs.map((config,i)=>{
 const r=simulateLocalPlant(config,i%2);
 const snapshot=[];
 for(let time=1;time<=8;time++)
  for(let source=0;source<config.plantAgents;source++)
   for(let target=0;target<config.plantAgents;target++)
    if(source!==target)snapshot.push({time,source,target,
     visibility:syntheticOrbitVisibility(source,target,time,r.options)});
 return {options:r.options,run:r.run,status:r.status,
  completedSteps:r.completedSteps,certificateFailure:r.certificateFailure,
  initial:r.initial,final:r.final,metrics:r.metrics,
  records:r.records,rows:r.rows,network:r.crossTransport,snapshot};
});
console.log(JSON.stringify({version:"e1a-python-independent-orbital-visibility-1",
 results}));
