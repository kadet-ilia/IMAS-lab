import React from "react";

/**
 * Single structural shell for all six equally supported experiments.
 * Workspace must have exactly two adjacent children: aside.sidebar and main.content.
 * Experimental differences belong inside the body, not in the page chrome.
 */
export function ExperimentLayout({sidebar,navigation,authors,title,description=null,progress=null,error=null,studyId,children}){
 return <>
  {sidebar}
  <main className="content r27-experiment-content imas-experiment-content" data-study={studyId}>
   {navigation}
   <header className="imas-experiment-heading">
    <div className="r27-kicker">{authors}</div>
    <h2 className="r27-study-title">{title}</h2>
    {description?<p className="r27-study-purpose">{description}</p>:null}
   </header>
   {progress}
   {error}
   {children}
  </main>
 </>;
}

/** Common card components: all experiments use the same class names and DOM shape. */
export function ExperimentPanel({title,subtitle,children,className="",headerAside=null}){
 return <section className={["panel",className].filter(Boolean).join(" ")}><header className="panel-header"><div><h2>{title}</h2>{subtitle?<p>{subtitle}</p>:null}</div>{headerAside}</header><div className="panel-body">{children}</div></section>;
}
export function ExperimentKpi({label,value,note,tone="blue"}){
 return <div className="kpi"><div className="kpi-label">{label}</div><div className={["kpi-value",tone].filter(Boolean).join(" ")}>{value}</div><div className="kpi-note">{note}</div></div>;
}
export function ExperimentParameterTooltip({text}){
 if(!text)return null;
 return <span className="parameter-tooltip" tabIndex={0} aria-label={text} onClick={e=>{e.preventDefault();e.currentTarget.focus();}}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M9.8 9.1a2.4 2.4 0 1 1 3.7 2c-1 .6-1.5 1.1-1.5 2.2M12 17h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
  <span role="tooltip">{text}</span>
 </span>;
}

/** Uniform progress indicator; research workers can flag indeterminate progress. */
export function ExperimentProgress({progress=null,running=false,cacheHit=false}){
 const data=progress||{message:"Готов к запуску",completed:0,total:1,percent:0};
 const percentage=Math.max(0,Math.min(100,Number(data.percent||0)));
 const seconds=Number(data.eta_seconds);
 const remaining=Number.isFinite(seconds)&&seconds>=0
  ? (seconds<60?Math.ceil(seconds)+" с":Math.floor(seconds/60)+" мин "+Math.ceil(seconds%60)+" с")
  : "—";
 return <div className={"progress-strip "+(running?"running":"done")} role="status">
  <div className="progress-head">
   <strong>{data.message||(running?"Выполняется":"Готов к запуску")}</strong>
   <span>{Number(data.completed||0)} / {Number(data.total||1)} · {percentage.toFixed(1)}%</span>
   {cacheHit?<em>кэш</em>:null}
   <span>Осталось: {remaining}</span>
  </div>
  <div className="progress-track"><i className={data.indeterminate?"r27-progress-indeterminate":""} style={data.indeterminate?undefined:{width:percentage+"%"}}/></div>
 </div>;
}
