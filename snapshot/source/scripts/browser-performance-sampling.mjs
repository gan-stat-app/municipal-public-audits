export const WARMUP_PAIRS=1,SAMPLE_PAIRS=3;

export const median=values=>{
  if(!values.length||values.some(value=>!Number.isFinite(value)||value<=0))throw new Error('performance timings must be finite and positive');
  const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
};

// Fixed work, not retries until a passing result. Both apps get the same warmup
// and sample count; sequential, alternating order limits runner/order bias.
// The caller opens a fresh page/context for every measurement, preserving the
// same application-cache history on both sides of each workload.
export const collectPerformanceSamples=async(measure,validate,{onSample=()=>{}}={})=>{
  const warmup={legacy:[],reconstructed:[]},samples={legacy:[],reconstructed:[]};
  for(let pair=0;pair<WARMUP_PAIRS+SAMPLE_PAIRS;pair++){
    const target=pair<WARMUP_PAIRS?warmup:samples;
    for(const app of pair%2?['reconstructed','legacy']:['legacy','reconstructed']){
      const result=await measure(app);
      await onSample({pair,phase:pair<WARMUP_PAIRS?'warmup':'measured',app,result});
      await validate(result); // Never hide console/network/functional failures.
      target[app].push(result);
    }
  }
  return{warmupPairs:WARMUP_PAIRS,measuredPairs:SAMPLE_PAIRS,aggregation:'median map timings',order:'alternating',warmup,samples};
};

export const summarizeMapSamples=samples=>{
  if(samples.length!==SAMPLE_PAIRS)throw new Error(`expected ${SAMPLE_PAIRS} measured samples per app`);
  return{
    ...samples[0],
    nationalMapMs:median(samples.map(sample=>sample.nationalMapMs)),
    municipalityMapMs:median(samples.map(sample=>sample.municipalityMapMs)),
    ...Object.fromEntries(['activePanelsNationalMapMs','activePanelsMunicipalityMapMs'].filter(key=>samples.some(sample=>sample[key]!=null)).map(key=>[key,median(samples.map(sample=>sample[key]))]))
  };
};

export const assertMapPerformance=(baseline,legacy,reconstructed)=>{
  const comparisons={};
  const keys=['nationalMap','municipalityMap'];
  if(baseline==='reconstructed-production')for(const key of['activePanelsNationalMap','activePanelsMunicipalityMap'])if(legacy[`${key}Ms`]!=null||reconstructed[`${key}Ms`]!=null)keys.push(key);
  for(const key of keys){
    const oldValue=legacy[`${key}Ms`],newValue=reconstructed[`${key}Ms`];
    median([oldValue,newValue]); // Invalid or missing timings must fail closed.
    comparisons[key]=newValue/oldValue; // Do not round before threshold checks.
  }
  if(baseline==='legacy-production'){
    if(Object.values(comparisons).some(value=>value>=1))throw new Error(`reconstructed map switching must outperform legacy: ${JSON.stringify(comparisons)}`);
  }else if(baseline==='reconstructed-production'){
    if(Object.values(comparisons).some(value=>value>2.5))throw new Error(`candidate map switching regressed more than 2.5x from reconstructed production: ${JSON.stringify(comparisons)}`);
  }else throw new Error(`unknown performance baseline: ${baseline}`);
};

