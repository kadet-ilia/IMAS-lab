import {runArticleSeries} from "./articleBrowserClient.js";
import {validateArticleConfig,ARTICLE_MODEL_VERSION} from "./articleEngine.js";
export const TABLE3_SCENARIOS=[
 {id:"coherent",name:"Согласованное смещение и манипулирование доверием",options:{attack_scenario:"collusion",manipulate_reputation:true}},
 {id:"trust",name:"Манипулирование доверием",options:{attack_scenario:"trust",manipulate_reputation:true}},
 {id:"subtle",name:"Малозаметное искажение",options:{attack_scenario:"subtle",manipulate_reputation:false}},
 {id:"mask",name:"Маскировка",options:{attack_scenario:"mask",manipulate_reputation:false}},
 {id:"onoff",name:"Переключающееся поведение (порог)",options:{attack_scenario:"on_off",manipulate_reputation:false,cusum_enabled:false}},
 {id:"onoff_cusum",name:"Переключающееся поведение + (14)",options:{attack_scenario:"on_off",manipulate_reputation:false,cusum_enabled:true}},
 {id:"clean",name:"Без атаки (контроль ложной изоляции)",options:{attack_scenario:"collusion",attack_shift:0,manipulate_reputation:false}}
];
/** Scenario-paired table 3, each case uses the same seed/run indexing. */
export async function runArticleTable3(raw,onProgress=()=>{}){
 const base=validateArticleConfig(raw),variants=[];
 for(let i=0;i<TABLE3_SCENARIOS.length;i++){
  const spec=TABLE3_SCENARIOS[i],c=validateArticleConfig({...base,...spec.options});
  const terminal=await runArticleSeries(c,p=>onProgress({...p,message:"Таблица 3: "+spec.name,
   overallCompleted:i*base.n_runs+p.completed,overallTotal:base.n_runs*TABLE3_SCENARIOS.length}));
  const r=terminal.result;
  const row=r.rows.find(x=>x.method==="trust_trimmed_mean");
  variants.push({...row,method:spec.id,scenarioName:spec.name,modelVersion:ARTICLE_MODEL_VERSION,
   configuration:c,cacheHit:terminal.cache_hit});
 }
 const first=validateArticleConfig({...base,...TABLE3_SCENARIOS[0].options});
 const reference=await runArticleSeries(first);
 return {result:{modelVersion:ARTICLE_MODEL_VERSION,config:base,rows:variants,table3Rows:variants,
  completed_runs:base.n_runs*variants.length,requested_runs:base.n_runs*variants.length,
  trajectory:reference.result.trajectory,metricPassport:{...reference.result.metricPassport,
   table3Scenarios:TABLE3_SCENARIOS.map(x=>({id:x.id,name:x.name,parameters:x.options})),
   primaryMethod:"trust_trimmed_mean",note:"Seven scenarios; results cannot be called replicas of published Table 3 without source parameters."}},
  cache_hit:variants.every(v=>v.cacheHit)};
}
