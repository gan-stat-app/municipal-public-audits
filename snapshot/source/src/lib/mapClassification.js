// Classification mechanics only. Production thresholds/palette must be supplied by recovered config.
export function quantileThresholds(values, classes=5){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length||classes<2) return [];
  const out=[];
  for(let k=1;k<classes;k++){
    const p=k/classes, index=(sorted.length-1)*p, lo=Math.floor(index), hi=Math.ceil(index), f=index-lo;
    out.push(sorted[lo]*(1-f)+sorted[hi]*f);
  }
  return out;
}
export function classify(value,thresholds){
  if(!Number.isFinite(value))return null;
  let i=0; while(i<thresholds.length&&value>thresholds[i])i++; return i;
}
export function classifyMapValues(valueMap,thresholds){
  return new Map([...valueMap].map(([code,item])=>[code,{...item,classIndex:classify(item.smr,thresholds)}]));
}
