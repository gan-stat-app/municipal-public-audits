import assert from'node:assert/strict';
import{test}from'node:test';
import{median,collectPerformanceSamples,summarizeMapSamples,assertMapPerformance}from'./browser-performance-sampling.mjs';

const sample=(nationalMapMs,municipalityMapMs=500)=>({nationalMapMs,municipalityMapMs});
const check=(legacy,reconstructed,baseline='reconstructed-production')=>assertMapPerformance(baseline,summarizeMapSamples(legacy),summarizeMapSamples(reconstructed));

test('one national-map outlier matching the failed CI does not fail the median gate',()=>{
  const legacy=[sample(534.3),sample(393.1),sample(450)];
  const reconstructed=[sample(1666.2),sample(772.6),sample(850)];
  assert.ok(reconstructed[0].nationalMapMs/legacy[0].nationalMapMs>2.5);
  assert.equal(summarizeMapSamples(reconstructed).nationalMapMs,850);
  assert.doesNotThrow(()=>check(legacy,reconstructed));
});

test('a single unusually fast baseline cannot fail otherwise stable maps',()=>{
  assert.doesNotThrow(()=>check([sample(100),sample(500),sample(500)],[sample(1000),sample(1000),sample(1000)]));
});

test('the October 11 majority slowdown still fails; subsequent success samples pass',()=>{
  assert.throws(()=>check([533.9,522,540.9].map(x=>sample(x)),[2149.8,2160,989.5].map(x=>sample(x))),/regressed more than 2\.5x/);
  assert.doesNotThrow(()=>check([373.6,375.8,389.3].map(x=>sample(x)),[581.8,1347.2,616.2].map(x=>sample(x))));
  assert.doesNotThrow(()=>check([539.2,544.8,543.2].map(x=>sample(x)),[935.3,903.5,977.4].map(x=>sample(x))));
});

test('the failing functional sample is retained for diagnostics before validation aborts',async()=>{
  const retained=[];
  await assert.rejects(()=>collectPerformanceSamples(async app=>({app,...sample(500)}),()=>{throw new Error('failed draw')},{onSample:x=>retained.push(x)}),/failed draw/);
  assert.equal(retained.length,1);
  assert.equal(retained[0].phase,'warmup');
  assert.equal(retained[0].app,'legacy');
});

for(const key of ['activePanelsNationalMapMs','activePanelsMunicipalityMapMs']){
  test(`${key} retains the same median/2.5x gate after both builds open deferred panels`,()=>{
    const legacy=Array.from({length:3},()=>({...sample(500),[key]:500}));
    const spike=[500,500,3000].map(value=>({...sample(500),[key]:value}));
    const sustained=[100,1300,1400].map(value=>({...sample(500),[key]:value}));
    assert.doesNotThrow(()=>check(legacy,spike));
    assert.throws(()=>check(legacy,sustained),/regressed more than 2\.5x/);
    assert.throws(()=>check(legacy,[{...sample(500)},...spike.slice(1)]),/finite and positive/);
  });
}

for(const key of['nationalMapMs','municipalityMapMs']){
  test(`one ${key} spike passes but sustained greater-than-2.5x regression fails`,()=>{
    const legacy=Array.from({length:3},()=>sample(500));
    const spike=[sample(500),sample(500),{...sample(500),[key]:5000}];
    const sustained=[1300,1400,1500].map(value=>({...sample(500),[key]:value}));
    assert.doesNotThrow(()=>check(legacy,spike));
    assert.throws(()=>check(legacy,sustained),/regressed more than 2\.5x/);
  });
  test(`one fast ${key} cannot conceal a majority regression`,()=>{
    const legacy=Array.from({length:3},()=>sample(500));
    const reconstructed=[100,1500,1600].map(value=>({...sample(500),[key]:value}));
    assert.throws(()=>check(legacy,reconstructed),/regressed more than 2\.5x/);
  });
}

test('exactly 2.5x passes while a tiny excess fails before report rounding',()=>{
  const legacy=Array.from({length:3},()=>sample(500));
  assert.doesNotThrow(()=>check(legacy,Array.from({length:3},()=>sample(1250))));
  assert.throws(()=>check(legacy,Array.from({length:3},()=>sample(1250.01))),/regressed more than 2\.5x/);
});

test('the original legacy baseline still requires strict improvement on both maps',()=>{
  const legacy=Array.from({length:3},()=>sample(500));
  assert.doesNotThrow(()=>check(legacy,Array.from({length:3},()=>sample(400,400)),'legacy-production'));
  for(const reconstructed of[sample(500,400),sample(400,500)])assert.throws(()=>check(legacy,[reconstructed,reconstructed,reconstructed],'legacy-production'),/must outperform legacy/);
});

test('warmup is excluded; fixed three samples per app are measured sequentially in alternating order',async()=>{
  const calls=[],validated=[],counts={legacy:0,reconstructed:0};
  let active=0;
  const sampling=await collectPerformanceSamples(async app=>{
    assert.equal(active++,0);
    calls.push(app);
    const number=counts[app]++;
    await Promise.resolve();
    active--;
    return{app,...sample(number===0?app==='legacy'?10:10000:app==='legacy'?500:1000)};
  },result=>validated.push(result));
  assert.deepEqual(calls,['legacy','reconstructed','reconstructed','legacy','legacy','reconstructed','reconstructed','legacy']);
  assert.equal(validated.length,8);
  assert.equal(sampling.warmupPairs,1);
  assert.equal(sampling.measuredPairs,3);
  for(const app of['legacy','reconstructed']){
    assert.equal(sampling.warmup[app].length,1);
    assert.equal(sampling.samples[app].length,3);
  }
  assert.equal(summarizeMapSamples(sampling.samples.legacy).nationalMapMs,500);
  assert.equal(summarizeMapSamples(sampling.samples.reconstructed).nationalMapMs,1000);
  assert.doesNotThrow(()=>check(sampling.samples.legacy,sampling.samples.reconstructed));
});

test('warmup and measured functional failures abort without retrying until success',async()=>{
  for(const failAt of[1,4,8]){
    let calls=0;
    await assert.rejects(()=>collectPerformanceSamples(async()=>({...sample(500),number:++calls}),result=>{
      if(result.number===failAt)throw new Error('functional or network failure');
    }),/functional or network failure/);
    assert.equal(calls,failAt);
  }
});

test('browser measurement errors abort rather than being discarded as outliers',async()=>{
  let calls=0;
  await assert.rejects(()=>collectPerformanceSamples(async()=>{
    if(++calls===3)throw new Error('map render timeout');
    return sample(500);
  },()=>{}),/map render timeout/);
  assert.equal(calls,3);
});

test('median uses numeric ordering without mutating diagnostic samples',()=>{
  const values=[100,20,3];
  assert.equal(median(values),20);
  assert.deepEqual(values,[100,20,3]);
});

test('incomplete or invalid timing sets fail closed',()=>{
  for(const samples of[[],[sample(500)],[sample(500),sample(500)]])assert.throws(()=>summarizeMapSamples(samples),/expected 3/);
  for(const invalid of[NaN,Infinity,undefined,null,0,-1])assert.throws(()=>summarizeMapSamples([sample(500),sample(invalid),sample(500)]),/finite and positive/);
  assert.throws(()=>assertMapPerformance('unknown',sample(500),sample(500)),/unknown performance baseline/);
});

