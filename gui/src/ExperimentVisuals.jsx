import React, {useEffect,useMemo,useState} from "react";
import {LineChart,Line,CartesianGrid,XAxis,YAxis,Tooltip,ResponsiveContainer,BarChart,Bar} from "recharts";
import {FRACTION_METRICS,formatStudyValue} from "./metricFormatting.js";
import "./research2027.css";

const PALETTE={normal:"#cfe1f1",coordinator:"#6ca6df",missing:"#e3e8ed",misled:"#edb663",compromised:"#d85454",affected:"#d85454",isolated:"#7c83a2"};
const LABELS={normal:"Корректен",coordinator:"Координатор",missing:"Сообщение не получено",misled:"Недостоверные данные",compromised:"Скомпрометирован",affected:"Нарушение функции",isolated:"Изолирован"};
const round=(v)=>typeof v==="number"&&Number.isFinite(v)?v.toLocaleString("ru-RU",{maximumFractionDigits:3}):"—";
const directed=(a,b)=>a[0]===b[0]&&a[1]===b[1];
function positions(n){
 return Array.from({length:n},(_,i)=>{
  const inner=n>14&&i<Math.ceil(n*.42), count=inner?Math.ceil(n*.42):(n>14?n-Math.ceil(n*.42):n);
  const local=inner?i:(n>14?i-Math.ceil(n*.42):i);
  const rad=n>14?(inner?94:193):Math.min(188,Math.max(124,28*n));
  const theta=2*Math.PI*local/count-Math.PI/2;
  return {x:275+rad*Math.cos(theta),y:232+rad*Math.sin(theta)};
 });
}
function edgeSegment(a,b){
 const dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy)),margin=19;
 return {x1:a.x+dx/len*margin,y1:a.y+dy/len*margin,x2:b.x-dx/len*margin,y2:b.y-dy/len*margin};
}
export function TopologyPlayback({replay,compact=false}){
 const [cursor,setCursor]=useState(0),[playing,setPlaying]=useState(false),[rate,setRate]=useState(1),[selected,setSelected]=useState(null);
 const frames=replay?.frames||[],edges=replay?.edges||[],vertices=replay?.vertices||[];
 const total=frames.length;
 useEffect(()=>{setCursor(0);setPlaying(false);setSelected(null);},[replay]);
 useEffect(()=>{
  if(!playing||total<2)return;
  const timer=setInterval(()=>setCursor(current=>{
   if(current>=total-1){setPlaying(false);return current;}
   return current+1;
  }),Math.round(850/rate));
  return ()=>clearInterval(timer);
 },[playing,total,rate]);
 const frame=frames[Math.min(cursor,Math.max(0,total-1))];
 const pos=useMemo(()=>positions(vertices.length),[vertices.length]);
 if(!replay||!frame)return <div className="r27-empty">Трасса для пошагового воспроизведения пока отсутствует.</div>;
 const counts=Object.entries(PALETTE).map(([key])=>[key,frame.status.filter(s=>s===key).length]).filter(([,v])=>v);
 const moving=frame.activeEdges||[];
 const title=replay.title||"Граф взаимодействия агентов";
 const activeNodes=new Set(moving.flat());
 const visibleEdges=edges.length>650?edges.slice(0,650):edges;
 const graph=<svg className="r27-playback-svg" viewBox={compact?"40 9 470 446":"0 0 550 464"} role="img" aria-label={"Ориентированный граф взаимодействий. "+title}>
  <defs><marker id="imas-replay-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="context-stroke"/></marker></defs>
  {visibleEdges.map(([a,b],i)=>{if(!pos[a]||!pos[b])return null;const segment=edgeSegment(pos[a],pos[b]),on=moving.some(e=>directed(e,[a,b]));return <line key={i} {...segment} stroke={on?"#df862e":"#95abc0"} strokeWidth={on?3.8:1.1} opacity={on?1:.49} markerEnd="url(#imas-replay-arrow)" className={on&&playing?"r27-pulse-edge":""}/>;})}
  {pos.map((p,i)=>{const state=frame.status[i]||"normal",active=activeNodes.has(i),r=vertices.length>36?10:vertices.length>16?14:18;return <g key={i} onClick={()=>setSelected(i===selected?null:i)} className="r27-node" role="button" tabIndex="0" aria-label={"Агент "+(i+1)+" "+LABELS[state]} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelected(i);}}}>
    <circle cx={p.x} cy={p.y} r={r+(selected===i?5:active?3:0)} fill={PALETTE[state]||PALETTE.normal} stroke={selected===i?"#163d65":active?"#d07622":"#416d91"} strokeWidth={selected===i?3:active?2.7:1.5}/>
    {vertices.length<=60?<text x={p.x} y={p.y+3.7} fill="#1c344d" textAnchor="middle" fontSize={vertices.length>20?9:11} fontWeight="700">{i+1}</text>:null}
    <title>{"Агент "+(i+1)+": "+(LABELS[state]||state)}</title>
  </g>;})}
 </svg>;
 return <section className={"r27-replay"+(compact?" r27-replay-compact":"")} aria-label="Пошаговое воспроизведение">
  <div className="r27-replay-heading"><div><h3>{title}</h3><p>Такты и изменение состояния вершин; выделенные рёбра — события текущего шага.</p></div><strong>Такт {frame.step} / {frames.at(-1)?.step}</strong></div>
  <div className="r27-playback-grid"><div className="r27-playback-figure">{graph}</div>
   <div className="r27-playback-aside"><h4>Состояние модели</h4><p className="r27-playback-event">{frame.info||"Нет событий"}</p><div className="r27-status-legend">{counts.map(([k,v])=><div key={k}><i style={{background:PALETTE[k]}}/><span>{LABELS[k]||k}</span><b>{v}</b></div>)}</div>
    {frame.value!==null&&frame.value!==undefined?<div className="r27-playback-value">{replay.valueLabel||"Показатель"}<strong>{round(frame.value)}</strong></div>:null}
    {selected!==null?<p className="r27-node-detail">Агент А{selected+1}: {LABELS[frame.status[selected]]||frame.status[selected]}</p>:null}
    {edges.length>650?<p className="r27-note">Для сохранения читаемости отображены первые 650 из {edges.length} рёбер.</p>:null}
   </div></div>
  <div className="r27-playback-controls">
   <button type="button" onClick={()=>{setPlaying(false);setCursor(0);}} title="В начало">|◀</button>
   <button type="button" onClick={()=>{setPlaying(false);setCursor(x=>Math.max(0,x-1));}} disabled={cursor===0} title="Предыдущий такт">◀</button>
   <button type="button" className="r27-play-main" onClick={()=>{if(cursor===total-1&&!playing)setCursor(0);setPlaying(v=>!v);}} aria-label={playing?"Пауза":"Воспроизвести"}>{playing?"Пауза":"▶ Воспроизвести"}</button>
   <button type="button" onClick={()=>{setPlaying(false);setCursor(x=>Math.min(total-1,x+1));}} disabled={cursor===total-1} title="Следующий такт">▶</button>
   <input aria-label="Выбор такта" type="range" min="0" max={Math.max(0,total-1)} step="1" value={cursor} onChange={e=>{setPlaying(false);setCursor(Number(e.target.value));}}/>
   <label>Скорость <select value={rate} onChange={e=>setRate(Number(e.target.value))}><option value="0.5">0,5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
  </div>
  {compact?<details className="r27-replay-notes"><summary>{replay.notes?.includes("Схематическое")?"Схематическая топология · Подробнее":"Описание и ограничения трассы"}</summary><p>{replay.notes||"Трасса иллюстрирует отдельную реализацию; статистические данные приведены отдельно."}</p></details>:<p className="r27-note">{replay.notes||"Трасса иллюстрирует отдельную реализацию; статистические данные приведены отдельно."}</p>}
 </section>;
}
/** Single comparison matrix, aligned side-by-side with the main graph for E2/E3/E5/E6. */
export function ScenarioComparisonMatrix({result,metric}){
 const rows=result?.rows||[];
 const scenarios=[...new Set(rows.map(x=>x.scenario).filter(Boolean))];
 const methods=[...new Set(rows.map(x=>x.method).filter(Boolean))];
 const measured=scenarios.map(s=>methods.map(m=>rows.find(x=>x.scenario===s&&x.method===m)?.[metric]));
 const numbers=measured.flat().filter(Number.isFinite),lo=Math.min(...numbers,0),hi=Math.max(...numbers,0),span=Math.max(hi-lo,1e-9);
 return <section className="panel r27-panel r27-comparison-matrix" aria-label="Сравнительная матрица по сценариям и методам">
  <header className="panel-header"><div><h2>Сравнительная матрица по сценариям и методам</h2><p>Значения показателя, выбранного над графиком; цвет соответствует величине.</p></div></header>
  <div className="panel-body">{metric&&methods.length&&scenarios.length&&numbers.length?
   <div className="r27-table-scroll"><table className="r27-table"><thead><tr><th>Сценарий</th>{methods.map(m=><th key={m}>{m}</th>)}</tr></thead>
   <tbody>{scenarios.map((scenario,i)=><tr key={scenario}><th>{scenario}</th>{methods.map((method,j)=>{
    const value=measured[i][j],z=Number.isFinite(value)?(value-lo)/span:0;
    return <td key={method} style={{background:Number.isFinite(value)?"rgba(24,104,173,"+(0.07+0.43*z)+")":undefined}}>{formatStudyValue(metric,value)}</td>;
   })}</tr>)}</tbody></table></div>
  :<div className="r27-summary-empty">Сравнительные показатели появятся после завершения расчёта.</div>}</div>
 </section>;
}
export function StudyVisualization({result,metric}){
 const replay=result?.replay, frames=replay?.frames||[];
 const timeline=frames.map(frame=>({step:frame.step,value:frame.value,compromised:frame.status.filter(x=>x==="compromised"||x==="affected").length,misled:frame.status.filter(x=>x==="misled").length,isolated:frame.status.filter(x=>x==="isolated").length}));
 const petri=result?.id==="petri";
 const byTime=petri?(result.statesByTime||[]).map((value,step)=>({step,value})):timeline;
 return <div className="r27-analytics">
  <section className="panel r27-panel"><header className="panel-header"><div><h2>{petri?"Исследованные маркировки по тактам":"Динамика показателя в демонстрационной трассе"}</h2><p>{petri?"Число посещённых состояний, сгруппированных по времени.":"Динамика одной фиксированной реализации, а не среднее Монте-Карло."}</p></div></header><div className="panel-body">
   <ResponsiveContainer width="100%" height={255}><LineChart data={byTime}><CartesianGrid strokeDasharray="3 3" stroke="#e0e8f0"/><XAxis dataKey="step" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}} domain={["auto","auto"]}/><Tooltip formatter={v=>round(v)}/><Line name={petri?"Исследовано маркировок":replay?.valueLabel||"Значение"} dataKey="value" stroke="#2068a3" strokeWidth={2.5} dot={{r:3}} isAnimationActive={false}/></LineChart></ResponsiveContainer>
  </div></section>
  <section className="panel r27-panel"><header className="panel-header"><div><h2>Матрица состояний агентов</h2><p>Строки — агенты; столбцы — такты. Окраска соответствует состоянию модели.</p></div></header><div className="panel-body">
   <div className="r27-state-scroll"><div className="r27-state-matrix" style={{gridTemplateColumns:"44px repeat("+frames.length+",minmax(15px,1fr))"}}>
    <span/><>{frames.map((frame,i)=><span className="r27-matrix-tick" key={"t"+i}>{frame.step}</span>)}</>
    {(replay?.vertices||[]).flatMap((v,i)=>[<b key={"a"+i}>А{i+1}</b>,...frames.map((frame,j)=><span key={i+"_"+j} title={"А"+(i+1)+"; t="+frame.step+"; "+(LABELS[frame.status[i]]||frame.status[i])} style={{background:PALETTE[frame.status[i]]||PALETTE.normal}}/>)])}
   </div></div>
  </div></section>

 </div>;
}
export function baselineReplay(data,config){
 const series=data?.series?.length?data.series:[{step:0,proposed_robust:0,truth:0}];
 const n=Math.min(data?.configuration?.effective_agent_count||config.n_agents||21,100),agents=data?.agents||[],states=data?.states||[],reps=data?.reputation||[];
 const vertices=Array.from({length:n},(_,i)=>({id:i,label:"А"+(i+1)}));
 const edges=[],topology=config.network_topology;
 if(topology==="complete"){for(let i=0;i<n;i++)for(let j=0;j<n;j++)if(i!==j)edges.push([i,j]);}
 else if(topology==="ring"||topology==="small_world"){for(let i=0;i<n;i++){edges.push([i,(i+1)%n]);edges.push([i,(i+2)%n]);}}
 else{for(let i=0;i<n;i++){edges.push([i,(i+1)%n]);edges.push([i,(i+3)%n]);}}
 const byAgent=new Map(),byState=new Map(),repMap=new Map();
 agents.forEach((a,i)=>byAgent.set(Number(a.agent??a.id??i+1),a));
 states.forEach(x=>byState.set(String(x.step)+":"+String(x.agent),x.state));
 reps.forEach(x=>repMap.set(String(x.step)+":"+String(x.agent),x.reputation));
 const stride=Math.max(1,Math.floor(series.length/80));
 const frames=series.filter((x,i)=>i%stride===0||i===series.length-1).map(row=>{
  const step=row.step,status=Array.from({length:n},(_,i)=>{
   const agent=byAgent.get(i+1)||agents[i]||{}, raw=byState.get(step+":"+(i+1));
   // The timestamped state is authoritative: first isolation is a historical event,
   // not proof that the agent remains isolated after its cooldown.
   if(raw==="isolated")return "isolated";
   if(raw==="dormant")return "normal";
   if(raw==="byzantine")return "compromised";
   if(raw==="sybil")return "misled";
   if(raw==="honest")return "normal";
   const isolated=agent.isolated_at!==null&&agent.isolated_at!==undefined&&agent.isolated_at<=step;
   if(isolated)return "isolated"; // Legacy traces without state snapshots only.
   if(agent.byzantine&&step>=config.attack_start_step)return "compromised";
   if(agent.sybil)return "misled";
   return "normal";
  });
  const meanTrust=reps.filter(x=>x.step===step).map(x=>x.reputation).filter(Number.isFinite);
  return {step,status,activeEdges:[],info:"Доверительно-усечённая оценка: "+round(row.proposed_robust)+"; эталон: "+round(row.truth)+"; среднее доверие: "+round(meanTrust.length?meanTrust.reduce((a,b)=>a+b,0)/meanTrust.length:0),value:row.proposed_robust};
 });
 return {title:"Топология взаимодействия и изменение доверия",vertices,edges,frames,notes:"Схематическое представление класса топологии. Реальные пары отправитель–получатель в протоколе исходного ядра не фиксируются. Отображаемые связи — иллюстративная топология, а не подтверждённый журнал доставки.",valueLabel:"Доверительно-усечённая оценка"};
}
