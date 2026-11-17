/**
 * Exact conditional McNemar test for paired *binary* episode outcomes.
 * A discordant pair contributes one Bernoulli(1/2) conditional on
 * exactly b+c discordant pairs under the marginal symmetry null.
 */
export function exactMcNemarTwoSided(pairs){
 if(!Array.isArray(pairs)||!pairs.length||
  pairs.some(x=>!x||typeof x.off!=="boolean"||typeof x.on!=="boolean"))
  throw Error("Парная проверка сертификатов: некорректная выборка");
 const improvement=pairs.filter(x=>x.on&&!x.off).length;
 const deterioration=pairs.filter(x=>!x.on&&x.off).length;
 const discordant=improvement+deterioration;
 const ties=pairs.length-discordant;
 let pValue=1;
 if(discordant){
  const tail=Math.min(improvement,deterioration);
  let term=Math.pow(0.5,discordant),cumulative=term;
  for(let k=1;k<=tail;k++){
   term*= (discordant-k+1)/k;
   cumulative+=term;
  }
  pValue=Math.min(1,2*cumulative);
 }
 return Object.freeze({n:pairs.length,improvement,deterioration,discordant,
  ties,offSuccess:pairs.filter(x=>x.off).length,
  onSuccess:pairs.filter(x=>x.on).length,pValue,
  method:"exact conditional two-sided McNemar"});
}
