import React,{useMemo,useState} from "react";
import {STUDY_DEFS} from "./research2027.js";
import {MODULE_MANUAL} from "./ResearchManual.js";
import {SIMPLE_GUIDES} from "./SimpleGuides.js";

const LEGACY_GROUPS={
 "Базовая модель":["purpose","agents"],
 "Доверие и безопасность":["trust","reputation","isolation","aggregation","network","sybil"],
 "Статистика и оценивание":["statistics","bootstrap","distributions","sensitivity"],
 "Реализация и применение":["parallel","process","software","interpretation","glossary","limits"]
};
const INTRO=[
 {id:"guide-purpose",title:"Назначение комплекса",group:"Общая документация",paragraphs:["IMAS-lab — локальный исследовательский комплекс для воспроизводимой оценки интеллектуальной мультиагентной системы поддержки принятия решений при частичной компрометации агентов и недостоверности информации.","Шесть вычислительных исследований выбираются через единый выпадающий список. Каждое имеет отдельную математическую постановку, численные показатели и инструменты визуализации."]},
 {id:"guide-architecture",title:"Структура программных компонентов",group:"Общая документация",paragraphs:["Эксперимент E1 «Расчёт доверия» выполняется браузерным JavaScript-ядром gui/src/trustEngine.js. Историческая модель experiment.py применяется только для сравнительного анализа и имеет иную математическую постановку.","Модели E2–E6 реализованы в gui/src/research2027.js и исполняются в браузерных Workers. Все шесть экспериментов образуют единый исследовательский комплекс. ResearchSettings.jsx отвечает за боковые панели, ExperimentVisuals.jsx — за графы и анимацию, UnifiedHelp.jsx и ResearchManual.js — за единый справочник."]},
 {id:"guide-workflow",title:"Порядок проведения эксперимента",group:"Общая документация",paragraphs:["Выберите исследование в верхнем меню, задайте параметры в боковой панели и выполните расчёт. Доступны тематические группы настроек и раскрываемые разделы дополнительных параметров.","Сохраните JSON или CSV вместе с начальным зерном и количеством прогонов. Меняя исходные условия, повторите расчёт и сопоставьте несколько характеристик. Изменённая конфигурация нового эксперимента сбрасывает результаты предыдущего расчёта."]},
 {id:"guide-graphics",title:"Графы, анимация и матрицы состояний",group:"Общая документация",paragraphs:["Вершины графа обозначают агентов, ориентированные рёбра — связи. Окраска показывает нормальное функционирование, компрометацию, влияние ложных данных и изоляцию. Текущие переходы выделяются при воспроизведении.","Доступны запуск, пауза, перемотка, переход на один такт и регулировка скорости. Покадровая трасса представляет отдельную реализацию, а не усреднение Монте-Карло. В E1 демонстрационная топология может быть схематической; точную передачу сообщений следует проверять по исходному журналу при его записи."]},
 {id:"guide-analysis",title:"Сравнение результатов и научная интерпретация",group:"Общая документация",paragraphs:["Столбчатые диаграммы сравнивают методы и сценарии, линейные графики — изменение состояния по тактам, тепловые матрицы — сочетания методов или состояний агентов, сводные таблицы — точные численные значения.","Оценку точности автоматических решений необходимо сопоставлять с долей отказов; опасность графовых угроз — с долей поражённых; недостижимость в сети Петри — с полнотой перебора; каскадный ущерб — с хвостовыми характеристиками распределения."]},
 {id:"guide-limitations",title:"Воспроизводимость и ограничения",group:"Общая документация",paragraphs:["Для проверки сохраняются версия комплекса, исходные параметры, фиксируемое зерно генератора, описание алгоритма, число прогонов, таблицы и условия сравнения.","Все шесть моделей — синтетические исследовательские постановки. Для научной валидации необходима отдельная сверка с окончательными рукописями, независимые контрольные примеры и калибровка по данным реального объекта."]}
];
const mid=(id,key)=>"manual-"+id+"-"+key;
function DocSection({id,title,paragraphs=[],equations=[],steps=[],terms=[],note}){
 return <section id={id} className={"r27-doc-section"+((id?.startsWith("simple-")||id?.endsWith("-simple"))?" r27-doc-simple":"")}><h2>{title}</h2>
  {paragraphs.map((p,i)=><p key={i}>{p}</p>)}
  {equations.map((eq,i)=><div className="r27-manual-equation" role="math" key={i}><span className="r27-eq-num">{i+1}</span><span>{eq}</span></div>)}
  {steps.length?<ol>{steps.map((st,i)=><li key={i}>{st}</li>)}</ol>:null}
  {terms.length?<dl className="glossary">{terms.map(([term,def])=><React.Fragment key={term}><dt>{term}</dt><dd>{def}</dd></React.Fragment>)}</dl>:null}
  {note?<p className="r27-document-caution">{note}</p>:null}
 </section>;
}
const treeGroups=nodes=>Object.entries(nodes.reduce((acc,node)=>{const group=node.group||"Разделы";(acc[group]??=[]).push(node);return acc;},{}));
function HelpBranch({name,nodes,selected,setSelected,search}){
 const lower=search.trim().toLocaleLowerCase("ru");
 const filtered=nodes.filter(x=>!lower||name.toLocaleLowerCase("ru").includes(lower)||x.title.toLocaleLowerCase("ru").includes(lower));
 if(!filtered.length)return null;
 return <details className="r27-help-branch" open={lower?true:undefined} defaultOpen={name==="Общая документация"||name==="Расчет доверия"}>
  <summary>{name}<small>{filtered.length}</small></summary>
  {treeGroups(filtered).map(([group,items])=><details className="r27-help-subbranch" open={lower?true:undefined} defaultOpen={group==="Базовая модель"||group==="Основы модели"} key={group}>
   <summary>{group}</summary>
   {items.map(s=><a key={s.id} href={"#"+s.id} onClick={()=>setSelected(s.id)} aria-current={selected===s.id?"location":undefined} className={selected===s.id?"r27-help-current":""}>{s.title}</a>)}
  </details>)}
 </details>;
}
export function UnifiedHelp({baselineArticle,baselineSections=[],researchTheory}){
 const [search,setSearch]=useState(""),[selected,setSelected]=useState("guide-purpose");
 const tree=useMemo(()=>{
  const base=baselineSections.map(([id,title])=>({id,title,group:Object.entries(LEGACY_GROUPS).find(([,list])=>list.includes(id))?.[0]||"Прочее"}));
  return [{name:"Общая документация",nodes:INTRO},{name:"Расчет доверия",nodes:[{...SIMPLE_GUIDES.trust,id:"simple-trust"},...base]},...STUDY_DEFS.map(d=>({name:MODULE_MANUAL[d.id]?.name||d.short,nodes:[{...SIMPLE_GUIDES[d.id],id:mid(d.id,"simple")},...(MODULE_MANUAL[d.id]?.sections||[]).map(s=>({...s,id:mid(d.id,s.id)}))]}))];
 },[baselineSections]);
 return <div className="r27-manual-layout">
  <aside className="help-toc r27-help-tree"><h2>Содержание</h2>
   <label className="r27-help-search">Поиск раздела<input type="search" aria-label="Поиск по содержанию справки" placeholder="Название раздела" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <p className="r27-help-count">6 экспериментов · {tree.reduce((n,x)=>n+x.nodes.length,0)} разделов</p>
   <nav aria-label="Дерево разделов справки">{tree.map(module=><HelpBranch key={module.name} {...module} selected={selected} setSelected={setSelected} search={search}/>)}</nav>
  </aside>
  <div className="r27-manual-body">
   <article className="help-article r27-overview-article"><h2 className="r27-manual-title">Единая справка по экспериментальному комплексу IMAS-lab</h2><p>Теоретические положения, математические модели, вычислительные алгоритмы, графы взаимодействий и научные ограничения шести экспериментов.</p>{INTRO.map(item=><DocSection key={item.id} {...item}/>)}</article>
   <header className="r27-manual-chapter" id="manual-trust"><h2>1. Расчет доверия</h2><p>Динамическое доверие, репутация, робастная агрегация и оценка защищённости.</p></header>
   <article className="help-article r27-module-article"><DocSection id="simple-trust" {...SIMPLE_GUIDES.trust}/></article>
   {baselineArticle}
   {STUDY_DEFS.map((def,i)=>{const module=MODULE_MANUAL[def.id],theory=researchTheory[def.id];return <React.Fragment key={def.id}>
    <header className="r27-manual-chapter" id={"manual-"+def.id}><h2>{i+2}. {module.name}</h2><p>{def.title}</p><p>{theory.goal}</p></header>
    <article className="help-article r27-module-article"><DocSection id={mid(def.id,"simple")} {...SIMPLE_GUIDES[def.id]}/>{module.sections.map(item=><DocSection key={item.id} {...item} id={mid(def.id,item.id)}/>)}</article>
   </React.Fragment>;})}
  </div>
 </div>;
}
