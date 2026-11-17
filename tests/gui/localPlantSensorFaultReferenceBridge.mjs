/**
 * The JS module supplies only event traces and actions. Python independently
 * calculates the certified observer and safety intervals for every tick.
 */
import {simulateLocalPlant} from "../../gui/src/adaptiveLocalPlant.js";
const base={plantSeed:705113,plantSteps:19,
 plantAgents:8,plantByzantine:2,
 plantSensorFaultFraction:.5,plantGuardEnabled:false,
 plantSensorFaultStart:6,plantSensorFaultEnd:10,
 plantDegradedSensorBound:.3,plantCapacity:64,plantTransportLoss:0};
const scenarios=[
 {plantSensorFaultMode:"dropout",plantControlMode:"local_action"},
 {plantSensorFaultMode:"dropout",plantControlMode:"local_sensor"},
 {plantSensorFaultMode:"degraded",plantControlMode:"local_decision"},
 {plantSensorFaultMode:"dropout",plantControlMode:"local_action",
  plantSteps:45,plantSensorFaultStart:2,plantSensorFaultEnd:43,
  plantSensorFaultFraction:1}
];
const results=scenarios.map((s,i)=>{
 const out=simulateLocalPlant({...base,...s},i);
 return {options:out.options,status:out.status,
  completedSteps:out.completedSteps,certificateFailure:out.certificateFailure,
  initial:out.initial,records:out.records,metrics:out.metrics,
  final:out.final,history:out.transport.history.map(h=>({
   step:h.step,slots:h.totalUsed,capacity:h.sharedCapacity}))};
});
process.stdout.write(JSON.stringify({schema:"e1a-fault-independent-1",results})+"\n");
