/**
 * Deterministic compact full-state plant replay for an INDEPENDENT Python
 * numerical oracle. It is a test-side adapter, not a source of expected math.
 */
import {simulateLocalPlant,LOCAL_PLANT_VERSION} from "../../gui/src/adaptiveLocalPlant.js";
const options={plantSeed:260114,plantAgents:8,plantByzantine:2,
 plantSteps:15,plantTopology:"ring",plantPartition:true,
 plantPartitionStart:6,plantPartitionEnd:11,
 plantCapacity:30,plantTransportDelay:1,plantTransportTTL:5,
 plantTransportLoss:0.03,plantAttackBias:1.2,
 plantDisturbanceBound:0.04,plantSensorBound:0.04};
const output=["local_action","local_decision","local_sensor"].map(mode=>{
 const result=simulateLocalPlant({...options,plantControlMode:mode},0);
 return {options:result.options,initial:result.initial,records:result.records,
  metrics:result.metrics,network:result.transport.history.map(h=>({
   step:h.step,received:h.receivedThisStep,slots:h.totalUsed,capacity:h.sharedCapacity
  }))};
});
process.stdout.write(JSON.stringify({version:LOCAL_PLANT_VERSION,output})+"\n");
