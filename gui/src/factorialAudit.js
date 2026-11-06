/**
 * UP-13: verifiable 2-level six-factor design and replication-level uncertainty.
 * Contrasts are calculated from run-level data and retain unestimable outcomes
 * as null. Normal intervals quantify within-cell simulation variation only.
 */
export const FACTORIAL_AUDIT_VERSION="factorial-audit-1.0";
const Z95=1.959963984540054;
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const columnsFor=x=>[1,...x,...x.flatMap((v,i)=>x.slice(i+1).map(other=>v*other))];
export function auditFactorialDesign(factors,ranges,designs){
 if(!Array.isArray(factors)||factors.length!==6||!Array.isArray(designs)||![32,64].includes(designs.length))
  throw Error("Факторный план: требуется шесть факторов и 32 либо 64 уникальных точки");
 for(const f of factors){
  const levels=ranges?.[f];
  if(!Array.isArray(levels)||levels.length!==2||!levels.every(finite)||levels[0]>=levels[1])
   throw Error("Фактор "+f+": нижний уровень должен быть меньше верхнего");
 }
 const unique=new Set(),columns=[];
 for(const point of designs){
  const x=point.coded;
  if(!Array.isArray(x)||x.length!==6||x.some(v=>v!==1&&v!==-1))
   throw Error("Факторный план: недопустимый код уровня");
  const key=x.join(",");
  if(unique.has(key))throw Error("Факторный план: повтор точки "+key);
  unique.add(key);
  for(let j=0;j<6;j++){
   const f=factors[j],expected=ranges[f][x[j]===1?1:0];
   if(point.values?.[f]!==expected)
    throw Error("Фактор "+f+": фактический уровень не соответствует коду точки");
   // Effective levels must remain different after integer rounding.
   if(f!=="attack_intensity_multiplier"&&finite(point.settings?.[f])){
    const actual=point.settings[f];
    const intended=["n_byzantine","trust_window_steps"].includes(f)?Math.round(expected):expected;
    if(actual!==intended)throw Error("Фактор "+f+": уровень изменён после формирования плана");
   }
  }
  columns.push(columnsFor(x));
 }
 for(const f of factors){
  const levels=ranges[f];
  if(["n_byzantine","trust_window_steps"].includes(f)&&Math.round(levels[0])===Math.round(levels[1]))
   throw Error("Фактор "+f+": уровни совпадают после округления");
 }
 const n=designs.length,cols=columns[0].length; // 1 + 6 main + 15 pairwise.
 if(cols!==22)throw Error("Факторный план: неверное число столбцов модели");
 for(let j=0;j<cols;j++)for(let k=0;k<=j;k++){
  const dot=columns.reduce((sum,row)=>sum+row[j]*row[k],0);
  if(dot!==(j===k?n:0))throw Error("Факторный план: неортогональные столбцы "+j+","+k);
 }
 const relation=designs.length===32?"I=ABCDEF":"none";
 if(relation!=="none"&&designs.some(d=>d.coded.reduce((a,b)=>a*b,1)!==1))
  throw Error("Факторный план: нарушено определяющее соотношение I=ABCDEF");
 return {valid:true,points:n,columns:cols,rank:cols,orthogonal:true,
  definingRelation:relation,
  inferenceLimit:relation==="none"?
   "Полный план: дисперсия учитывает вариацию прогонов внутри точек.":
   "План разрешения VI: главные эффекты смешаны с эффектами порядка 5, парные — с эффектами порядка 4.",
  uncertaintyLimit:"Нормальный интервал предполагает независимые прогоны внутри ячеек и не отражает ошибку модели или смешение высших взаимодействий."};
}
function sampleVariance(a){
 const m=mean(a);return a.reduce((sum,v)=>sum+(v-m)**2,0)/(a.length-1);
}
export function estimateFactorialContrasts(designs,rawRows,metrics,method="proposed_robust"){
 const rows=rawRows.filter(x=>x.method===method);
 const terms=[];
 for(let j=0;j<6;j++)terms.push({factorIndex:[j],metricFactor:j});
 for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)terms.push({factorIndex:[i,j],metricFactor:[i,j]});
 const effects=[],interactions=[];
 for(const metric of metrics)for(const term of terms){
  const n=designs.length,positive=[],negative=[],missing=[];
  let withinVariance=0,replicateCount=0,minReplicates=Infinity,allReplicated=true;
  for(const point of designs){
   const vals=rows.filter(x=>x.design_index===point.index).map(x=>x[metric]).filter(finite);
   if(!vals.length){missing.push(point.index);continue;}
   replicateCount+=vals.length;minReplicates=Math.min(minReplicates,vals.length);
   const contrast=term.factorIndex.reduce((p,j)=>p*point.coded[j],1);
   (contrast===1?positive:negative).push(mean(vals));
   if(vals.length>=2)withinVariance+=sampleVariance(vals)/vals.length;
   else allReplicated=false;
  }
  const balanced=positive.length===n/2&&negative.length===n/2;
  const estimable=missing.length===0&&balanced;
  const effect=estimable?mean(positive)-mean(negative):null;
  // Each coefficient is +/- 2/n: preserve design balance and use ALL run-level data.
  const standardError=estimable&&allReplicated?Math.sqrt(withinVariance)*2/n:null;
  const lower=standardError!==null?effect-Z95*standardError:null;
  const upper=standardError!==null?effect+Z95*standardError:null;
  const meta={metric,estimable,effect,ci95_low:lower,ci95_high:upper,
   standard_error:standardError,replicates_total:replicateCount,
   min_replicates_per_cell:minReplicates===Infinity?0:minReplicates,
   missing_cells:missing.length,design_points:n,intervalMethod:standardError===null?null:"independent-cell-normal-approx-95",
   uncertaintyLimit:"Оценка только стохастической вариации независимых прогонов внутри ячеек, без поправки на множественные сравнения и без учёта смешения взаимодействий."};
  if(term.factorIndex.length===1)effects.push({...meta,factorIndex:term.metricFactor});
  else interactions.push({...meta,factorIndices:term.metricFactor,absolute_effect:finite(effect)?Math.abs(effect):null});
 }
 return {effects,interactions};
}
