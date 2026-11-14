import React,{useEffect,useState} from "react";
import {collectExportableElements,saveStandaloneElement} from "./figureExport.js";

/** Choose one individual object across all six studies, including legacy panels. */
export default function FigureExportPicker({activeTab}){
 const [open,setOpen]=useState(false),[items,setItems]=useState([]),[error,setError]=useState("");
 useEffect(()=>{setOpen(false);setItems([]);setError("");},[activeTab]);
 const choose=()=>{
  if(open){setOpen(false);return;}
  setItems(collectExportableElements(document.querySelector("main.content")));
  setOpen(true);setError("");
 };
 const save=(item,format)=>{
  setOpen(false);setError("");
  saveStandaloneElement(item.element,item.title+"-"+item.index,format)
   .catch(e=>setError(e.message||String(e)));
 };
 return <div className="figure-export-picker">
  <button type="button" className="figure-export-picker-trigger"
   aria-expanded={open} aria-label="Сохранить отдельный график, таблицу или схему"
   disabled={["help2027","data"].includes(activeTab)} onClick={choose}>Сохранить объект</button>
  {open?<div className="figure-export-menu" role="group" aria-label="Выбор объекта для экспорта">
   <div className="figure-export-heading">Экспорт отдельного объекта</div>
   {items.length?items.map(item=><div key={item.index} className="figure-export-row">
    <span title={item.title}>{item.index}. {item.title} — {item.kind}</span>
    <div>{item.formats.map(format=><button key={format} type="button"
     aria-label={"Сохранить "+item.index+" в "+format}
     onClick={()=>save(item,format)}>{format}</button>)}</div>
   </div>):<p>На текущей вкладке нет отображаемых графиков или таблиц.</p>}
  </div>:null}
  {error?<span role="alert" className="figure-export-error">{error}</span>:null}
 </div>;
}
