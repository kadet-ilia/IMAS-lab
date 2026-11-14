/**
 * Standalone export of one scientific figure/table. No external rasterization
 * service or screenshot of the entire dashboard is required.
 */
const slug=name=>String(name||"figure").toLowerCase().replace(/[^a-zа-яё0-9]+/gi,"-").replace(/^-|-$/g,"").slice(0,90)||"figure";
const xmlEscape=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
function saveBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function chartSvg(root){
 const candidates=[...root.querySelectorAll(".panel-body svg")];
 return candidates.map(svg=>({svg,rect:svg.getBoundingClientRect()}))
  .filter(x=>x.rect.width>100&&x.rect.height>80)
  .sort((a,b)=>b.rect.width*b.rect.height-a.rect.width*a.rect.height)[0]?.svg||null;
}
function chartMarkup(svg){
 const clone=svg.cloneNode(true),box=svg.getBoundingClientRect();
 const width=Math.max(1,Math.ceil(box.width)),height=Math.max(1,Math.ceil(box.height));
 clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
 clone.setAttribute("width",String(width));clone.setAttribute("height",String(height));
 clone.setAttribute("viewBox",clone.getAttribute("viewBox")||"0 0 "+width+" "+height);
 // Recharts SVG relies on a few CSS properties; inline the text defaults.
 clone.querySelectorAll("text").forEach(x=>{
  if(!x.hasAttribute("fill"))x.setAttribute("fill","#34465a");
  if(!x.hasAttribute("font-family"))x.setAttribute("font-family","Arial, sans-serif");
 });
 const bg=document.createElementNS("http://www.w3.org/2000/svg","rect");
 bg.setAttribute("width","100%");bg.setAttribute("height","100%");bg.setAttribute("fill","#ffffff");
 clone.insertBefore(bg,clone.firstChild);
 return {markup:'<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone),width,height};
}
function tableRows(table){
 return [...table.querySelectorAll("tr")].map(row=>[...row.querySelectorAll("th,td")].map(cell=>cell.innerText.replace(/\s+/g," ").trim()));
}
function tableCsv(table){
 const escape=value=>'"'+String(value).replaceAll('"','""')+'"';
 return "\uFEFF"+tableRows(table).map(row=>row.map(escape).join(";")).join("\r\n");
}
async function svgToPng(svg,title){
 const {markup,width,height}=chartMarkup(svg),scale=2;
 const url=URL.createObjectURL(new Blob([markup],{type:"image/svg+xml;charset=utf-8"}));
 try{
  const image=new Image();
  await new Promise((resolve,reject)=>{
   image.onload=resolve;image.onerror=()=>reject(Error("Не удалось преобразовать SVG в PNG"));
   image.src=url;
  });
  const canvas=document.createElement("canvas");canvas.width=width*scale;canvas.height=height*scale;
  const ctx=canvas.getContext("2d");if(!ctx)throw Error("Canvas недоступен");
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if(!blob)throw Error("Не удалось сформировать PNG");
  saveBlob(blob,slug(title)+".png");
 }finally{URL.revokeObjectURL(url);}
}
function wrap(ctx,text,maxWidth){
 const words=String(text).split(/\s+/),out=[],line=[];
 for(const word of words){
  if(ctx.measureText([...line,word].join(" ")).width>maxWidth&&line.length){out.push(line.join(" "));line.length=0;}
  line.push(word);
 }
 if(line.length)out.push(line.join(" "));
 return out.length?out:[""];
}
async function tableToPng(table,title){
 const rows=tableRows(table),count=Math.max(...rows.map(r=>r.length),1);
 const width=Math.min(2400,Math.max(850,count*180)),cellWidth=(width-40)/count;
 const ctxCanvas=document.createElement("canvas"),ctx=ctxCanvas.getContext("2d");
 if(!ctx)throw Error("Canvas недоступен");
 ctx.font="14px Arial, sans-serif";
 const layout=rows.map(row=>row.map(cell=>wrap(ctx,cell,cellWidth-18)));
 const heights=layout.map(row=>Math.max(36,...row.map(lines=>lines.length*19+14)));
 const height=72+heights.reduce((a,b)=>a+b,0);
 if(height>30000)throw Error("Таблица слишком велика для PNG; используйте CSV без потери строк");
 ctxCanvas.width=width*2;ctxCanvas.height=height*2;ctx.scale(2,2);
 ctx.fillStyle="#ffffff";ctx.fillRect(0,0,width,height);
 ctx.font="bold 18px Arial, sans-serif";ctx.fillStyle="#123a63";ctx.fillText(title,20,35,width-40);
 let y=62;
 layout.forEach((row,i)=>{
  const h=heights[i];ctx.fillStyle=i===0?"#eaf1f8":i%2?"#ffffff":"#f6f8fa";ctx.fillRect(20,y,width-40,h);
  ctx.strokeStyle="#d9e1e9";ctx.strokeRect(20,y,width-40,h);
  ctx.font=(i===0?"bold ":"")+"13px Arial, sans-serif";ctx.fillStyle="#233b52";
  for(let j=0;j<count;j++){
   const lines=row[j]||[""];
   lines.forEach((line,k)=>ctx.fillText(line,28+j*cellWidth,y+20+k*19,cellWidth-16));
   if(j) {ctx.beginPath();ctx.moveTo(20+j*cellWidth,y);ctx.lineTo(20+j*cellWidth,y+h);ctx.stroke();}
  }
  y+=h;
 });
 const blob=await new Promise(resolve=>ctxCanvas.toBlob(resolve,"image/png"));
 if(!blob)throw Error("Не удалось сформировать PNG таблицы");
 saveBlob(blob,slug(title)+".png");
}
export function availablePanelFormats(root){
 if(!root)return [];
 const svg=chartSvg(root),table=root.querySelector(".panel-body table");
 return [...(svg?["SVG","PNG"]:table?["PNG"]:[]),...(table?["CSV"]:[])];
}
export async function savePanelAsset(root,title,format){
 if(!root)throw Error("Не найден контейнер для экспорта");
 const svg=chartSvg(root),table=root.querySelector(".panel-body table"),name=slug(title);
 if(format==="SVG"&&svg){
  saveBlob(new Blob([chartMarkup(svg).markup],{type:"image/svg+xml;charset=utf-8"}),name+".svg");return;
 }
 if(format==="PNG"&&svg)return svgToPng(svg,title);
 if(format==="PNG"&&table)return tableToPng(table,title);
 if(format==="CSV"&&table){
  saveBlob(new Blob([tableCsv(table)],{type:"text/csv;charset=utf-8"}),name+".csv");return;
 }
 throw Error("В выбранной панели отсутствует объект для формата "+format);
}


/** Global selection covers charts/tables rendered outside shared ExperimentPanel. */
export function collectExportableElements(root){
 if(!root)return [];
 const all=[...root.querySelectorAll("svg, table")];
 return all.filter(element=>{
  if(element.closest(".panel-export-menu,.figure-export-menu"))return false;
  const rect=element.getBoundingClientRect();
  return rect.width>150&&rect.height>75;
 }).filter(element=>{
  if(element.tagName.toLowerCase()!=="svg")return true;
  return !element.parentElement?.closest("svg"); // only top-level SVGs
 }).map((element,index)=>{
  const kind=element.tagName.toLowerCase()==="svg"?"График/схема":"Таблица";
  const section=element.closest(".panel,.r27-panel,.r27-experiment-section");
  const title=section?.querySelector(".panel-header h2, h2, h3")?.textContent?.trim()
   ||element.closest("section")?.querySelector("h2,h3")?.textContent?.trim()||"Объект";
  return {element,index:index+1,kind,title,formats:kind==="Таблица"?["PNG","CSV"]:["SVG","PNG"]};
 });
}
export async function saveStandaloneElement(element,title,format){
 if(!element?.isConnected)throw Error("Объект больше не находится на странице; обновите список");
 const kind=element.tagName.toLowerCase();
 if(kind==="svg"&&format==="SVG"){
  saveBlob(new Blob([chartMarkup(element).markup],{type:"image/svg+xml;charset=utf-8"}),slug(title)+".svg");return;
 }
 if(kind==="svg"&&format==="PNG")return svgToPng(element,title);
 if(kind==="table"&&format==="PNG")return tableToPng(element,title);
 if(kind==="table"&&format==="CSV"){
  saveBlob(new Blob([tableCsv(element)],{type:"text/csv;charset=utf-8"}),slug(title)+".csv");return;
 }
 throw Error("Выбранный формат не поддерживается для этого объекта");
}
