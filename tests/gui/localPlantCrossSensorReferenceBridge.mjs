#!/usr/bin/env node
/**
 * Read-only event bridge for an INDEPENDENT Python replay of remote sensing.
 * The Python oracle never calls JS interval arithmetic or the JS shield.
 */
import {simulateLocalPlant} from "../../gui/src/adaptiveLocalPlant.js";
const base={plantSeed:20261117,plantSteps:44,plantAgents:8,
 plantByzantine:2,plantSensorFaultMode:"dropout",
 plantSensorFaultFraction:.5,plantSensorFaultStart:4,
 plantSensorFaultEnd:39,plantGuardEnabled:false,
 plantCapacity:48,plantTransportDelay:1,plantTransportLoss:.03,
 plantCrossEnabled:true,plantCrossFaultBudget:2,
 plantCrossBound:.08,plantCrossDelay:1,plantCrossTTL:5,
 plantCrossLoss:.03,plantCrossBandwidthFraction:.65};
const configurations=[
 {...base,plantTopology:"complete",plantControlMode:"local_sensor"},
 {...base,plantTopology:"complete",plantControlMode:"local_action"},
 {...base,plantTopology:"ring",plantControlMode:"local_sensor"},
 {...base,plantTopology:"ring",plantControlMode:"local_action"},
 {...base,plantTopology:"complete",plantControlMode:"local_sensor",
  plantCrossLoss:1},
 {...base,plantTopology:"complete",plantControlMode:"local_sensor",
  plantSensorFaultStart:8,plantSensorFaultEnd:11},
 {...base,plantTopology:"complete",plantControlMode:"local_sensor",
  plantCrossObservationMode:"range_geometry",
  plantCrossGeometryRadius:1,plantCrossMaxRange:.5,
  plantCrossDistanceErrorSlope:.04},
 {...base,plantTopology:"complete",plantControlMode:"local_sensor",
  plantCrossObservationMode:"range_geometry",
  plantCrossGeometryRadius:1,plantCrossMaxRange:1.45,
  plantCrossDistanceErrorSlope:.04},
 {...base,plantTopology:"complete",plantControlMode:"local_action",
  plantCrossObservationMode:"range_geometry",
  plantCrossGeometryRadius:1,plantCrossMaxRange:2.05,
  plantCrossDistanceErrorSlope:.04}
];
const results=configurations.map((config,i)=>{
 const r=simulateLocalPlant(config,i%2);
 return {options:r.options,run:r.run,status:r.status,
  completedSteps:r.completedSteps,certificateFailure:r.certificateFailure,
  initial:r.initial,final:r.final,metrics:r.metrics,
  records:r.records,rows:r.rows,crossTransport:r.crossTransport};
});
console.log(JSON.stringify({version:"e1a-independent-cross-interval-replay-1",
 results}));
