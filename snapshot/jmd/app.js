const names=['全国','北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const nameToCode=new Map(names.slice(1).map((name,index)=>[name,`P${String(index+1).padStart(2,'0')}`]));

const classificationEl=document.querySelector('#classification');
const classificationInfoEl=document.querySelector('#classificationInfo');
const sexEl=document.querySelector('#sex');
const prefEl=document.querySelector('#pref');
const yearEl=document.querySelector('#year');
const causeGroupEl=document.querySelector('#causeGroup');
const causeSearchEl=document.querySelector('#causeSearch');
const causeSearchInfoEl=document.querySelector('#causeSearchInfo');
const causeEl=document.querySelector('#cause');
const statusEl=document.querySelector('#status');
const ranking=document.querySelector('#ranking');
const availabilityEl=document.querySelector('#availability');
const periodWarn=document.querySelector('#periodWarn');
const trend=document.querySelector('#trend');
const prefLegend=document.querySelector('#prefLegend');
const mapSvg=document.querySelector('#map');
const mapLegend=document.querySelector('#mapLegend');
const mapTip=document.querySelector('#mapTip');
const okinawaInsetsEl=document.querySelector('#okinawaInsets');
const cancerComparisonEl=document.querySelector('#cancerComparison');
const cancerComparisonCardEl=document.querySelector('#cancerComparisonCard');
const cancerComparisonTitleEl=document.querySelector('#cancerComparisonTitle');
const resultContextEl=document.querySelector('#resultContext');
const mapTitleEl=document.querySelector('#mapTitle');
const trendTitleEl=document.querySelector('#trendTitle');
const rankingTitleEl=document.querySelector('#rankingTitle');
const mapContextEl=document.querySelector('#mapContext');
const rankingContextEl=document.querySelector('#rankingContext');
const causeProfileCardEl=document.querySelector('#causeProfileCard');
const causeProfileTitleEl=document.querySelector('#causeProfileTitle');
const causeProfileToggleEl=document.querySelector('#causeProfileToggle');
const causeProfileBodyEl=document.querySelector('#causeProfileBody');
const causeProfileSummaryEl=document.querySelector('#causeProfileSummary');
const causeProfileListEl=document.querySelector('#causeProfileList');
const trendProfileCardEl=document.querySelector('#trendProfileCard');
const trendProfileTitleEl=document.querySelector('#trendProfileTitle');
const trendProfileToggleEl=document.querySelector('#trendProfileToggle');
const trendProfileBodyEl=document.querySelector('#trendProfileBody');
const trendProfileSummaryEl=document.querySelector('#trendProfileSummary');
const trendProfileListEl=document.querySelector('#trendProfileList');

prefEl.add(new Option('全国（経年推移のみ）','P00'));
for(let index=1;index<48;index++)prefEl.add(new Option(names[index],`P${String(index).padStart(2,'0')}`));
prefEl.value='P05';

let data=[];
let meta={};
let classificationMaster={};
let mapGeo=null;
let loadSequence=0;
let allCauses=[];
let causeProfileOpen=false;
let causeProfileFilter='above';
let trendProfileOpen=false;
let trendProfileFilter='increase';

const classificationOrder=['cndcs','jmdc_cause','jmdc_group','hi','hcd_cause'];

const sexKey=()=>sexEl.value==='both'?'Both':sexEl.value==='male'?'Male':'Female';
const relativeThresholds=[80,90,95,105,110,120];
const relativePalette=['#155b83','#4f8fb3','#a8c8d8','#ece7db','#efc0ad','#d97c63','#a83f46'];
const relativeLabels=['80未満','80以上90未満','90以上95未満','95以上105未満','105以上110未満','110以上120未満','120以上'];
const missingColor='#d7dde3';
const mainBounds=[122,20,154,46];
const mainBox={x:20,y:20,width:860,height:590};
const okinawaLayouts=[
  {key:'main',label:'沖縄本島周辺'},
  {key:'sakishima',label:'宮古・八重山'},
  {key:'daito',label:'大東諸島'}
];

async function decodePossiblyGzippedJson(response,url){
  const bytes=new Uint8Array(await response.arrayBuffer());
  let text;
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    if(typeof DecompressionStream!=='function')throw new Error(`gzip展開に対応していないブラウザです: ${url}`);
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text=await new Response(stream).text();
  }else{
    text=new TextDecoder().decode(bytes);
  }
  return JSON.parse(text);
}

async function fetchJson(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
  if(url.endsWith('.gz'))return decodePossiblyGzippedJson(response,url);
  return response.json();
}

async function init(){
  try{
    const [metaData,masterData,geo]=await Promise.all([
      fetchJson('/data/jmd/meta.json'),
      fetchJson('/data/jmd/classification_master.json'),
      fetchJson('/data/maps/prefectures-light.geojson')
    ]);
    meta=metaData;
    classificationMaster=masterData.classifications||{};
    mapGeo=geo;
    if(!mapGeo||mapGeo.type!=='FeatureCollection'||mapGeo.features?.length!==47)throw new Error('地図データが不正です');
    for(const key of classificationOrder){
      const config=classificationMaster[key];
      if(config)classificationEl.add(new Option(`${config.label}（${config.count}区分）`,key));
    }
    classificationEl.value='cndcs';
    await loadData({preserveCause:false});
  }catch(error){
    console.error(error);
    statusEl.className='error';
    statusEl.textContent='年齢調整死亡率のデータを読み込めませんでした。';
    mapTip.textContent='地図を読み込めませんでした。';
  }
}

function classificationConfig(){
  return classificationMaster[classificationEl.value]||{};
}

function updateYears(){
  const config=classificationConfig();
  const [firstYear,lastYear]=config.years||[1979,2024];
  const current=Number(yearEl.value);
  yearEl.innerHTML='';
  for(let year=lastYear;year>=firstYear;year--)yearEl.add(new Option(year,year));
  yearEl.value=current>=firstYear&&current<=lastYear?String(current):String(lastYear);
  classificationInfoEl.textContent=`${firstYear}～${lastYear}年・${config.count||0}区分`;
}

function causeLabels(){
  return classificationConfig().causes||{};
}

const popularPatterns=[
  /^(全死因|総死亡|all causes)$/i,/悪性新生物|cancer|malignant neoplasm/i,/心疾患|heart diseases?/i,
  /脳血管|cerebrovascular/i,/肺炎|pneumonia/i,/老衰|senility/i,/糖尿病|diabetes/i,
  /腎不全|renal failure/i,/肝疾患|liver disease/i,/慢性閉塞性肺疾患|COPD/i,
  /自殺|suicide/i,/不慮の事故|accident/i
];

function causeGroup(label){
  const value=String(label).toLowerCase();
  if(/悪性新生物|がん|癌|cancer|malignant neoplasm/.test(value))return 'cancer';
  if(/心疾患|心臓|虚血性心|脳血管|高血圧|循環器|heart|cardio|cerebrovascular|hypertensive/.test(value))return 'circulatory';
  if(/肺炎|気管支|喘息|呼吸器|copd|influenza|pneumonia|respiratory|bronch/.test(value))return 'respiratory';
  if(/肝疾患|胃潰瘍|十二指腸|消化器|liver|digestive|peptic|cirrhosis/.test(value))return 'digestive';
  if(/自殺|不慮|事故|交通|転倒|溺死|中毒|他殺|外因|suicide|accident|injur|external|homicide|fall|drown|poison/.test(value))return 'external';
  return popularPatterns.some(pattern=>pattern.test(value))?'main':'other';
}

function isPopularCause(label){
  return popularPatterns.some(pattern=>pattern.test(String(label)));
}

function optionLabel(cause){
  const available=meta.cause_availability?.[classificationEl.value]?.[sexKey()]?.[cause];
  const label=causeLabels()[cause]||'死因';
  return `${label} ${available?`（${available[0]}～${available[1]}）`:'（公表値なし）'}`;
}

function filteredCauses(){
  const selectedGroup=causeGroupEl.value;
  const query=causeSearchEl.value.trim().toLocaleLowerCase('ja');
  return allCauses.filter(cause=>{
    const label=causeLabels()[cause]||'';
    const group=causeGroup(label);
    const groupMatch=selectedGroup==='all'||(selectedGroup==='main'?isPopularCause(label):group===selectedGroup);
    return groupMatch&&(!query||label.toLocaleLowerCase('ja').includes(query)||cause.toLowerCase().includes(query));
  });
}

function updateCauseOptions({preserve=true}={}){
  const current=preserve?causeEl.value:'';
  const causes=filteredCauses();
  const popular=causes.filter(cause=>isPopularCause(causeLabels()[cause]));
  const others=causes.filter(cause=>!popular.includes(cause));
  causeEl.innerHTML='';
  const appendGroup=(label,items)=>{
    if(!items.length)return;
    const group=document.createElement('optgroup');
    group.label=label;
    for(const cause of items)group.append(new Option(optionLabel(cause),cause));
    causeEl.append(group);
  };
  appendGroup('よく使う死因',popular);
  appendGroup('すべての該当死因',others);
  if(!causes.length){
    const option=new Option('該当する死因がありません','');
    option.disabled=true;
    causeEl.add(option);
  }else if(causes.includes(current)){
    causeEl.value=current;
  }
  causeSearchInfoEl.textContent=`${causes.length}件を表示（全${allCauses.length}件）`;
  causeEl.disabled=!causes.length;
  return causes.length>0;
}

async function loadData({preserveCause=true}={}){
  const sequence=++loadSequence;
  statusEl.textContent='データを読み込んでいます…';
  const classification=classificationEl.value;
  const payload=await fetchJson(`/data/jmd/asdr_${classification}_${sexEl.value}.json.gz`);
  if(sequence!==loadSequence)return;
  data=payload.rows;
  const current=preserveCause?causeEl.value:'';
  updateYears();
  allCauses=[...new Set(data.map(row=>String(row[1])))].sort((a,b)=>Number(a)-Number(b));
  updateCauseOptions({preserve:false});
  if(allCauses.includes(current)&&filteredCauses().includes(current))causeEl.value=current;
  render();
}

function availability(){
  const available=meta.cause_availability?.[classificationEl.value]?.[sexKey()]?.[causeEl.value];
  availabilityEl.textContent=available?`公表値の収録期間：${available[0]}～${available[1]}年`:'この死因の公表値はありません';
  return available;
}

function series(code,cause){
  const values=new Map(data.filter(row=>row[0]===code&&String(row[1])===cause).map(row=>[row[2],row[3]]));
  const [firstYear,lastYear]=classificationConfig().years||[1979,2024];
  return Array.from({length:lastYear-firstYear+1},(_,index)=>{
    const year=firstYear+index;
    return [year,values.has(year)?values.get(year):null];
  });
}

function segments(seriesValues,x,y){
  const parts=[];
  let current=[];
  for(const [year,value] of seriesValues){
    if(value==null){
      if(current.length)parts.push(current);
      current=[];
    }else{
      current.push(`${x(year)},${y(value)}`);
    }
  }
  if(current.length)parts.push(current);
  return parts;
}

function drawTrend(){
  const cause=causeEl.value;
  const nationalOnly=prefEl.value==='P00';
  const prefectureSeries=nationalOnly?[]:series(prefEl.value,cause);
  const nationalSeries=series('P00',cause);
  const values=[...prefectureSeries,...nationalSeries].map(item=>item[1]).filter(value=>value!=null);
  trend.innerHTML='';
  prefLegend.hidden=nationalOnly;
  prefLegend.textContent=nationalOnly?'':names[Number(prefEl.value.slice(1))];
  if(!values.length){
    trend.innerHTML='<text x="450" y="165" text-anchor="middle">公表値がありません</text>';
    return;
  }

  const max=Math.max(...values)*1.08;
  const min=0;
  const left=55;
  const right=875;
  const top=20;
  const bottom=285;
  const [firstYear,lastYear]=classificationConfig().years||[1979,2024];
  const x=year=>left+(year-firstYear)/(lastYear-firstYear||1)*(right-left);
  const y=value=>bottom-(value-min)/(max-min||1)*(bottom-top);
  let html=`<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#999"/><line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#999"/>`;
  const firstTick=Math.ceil(firstYear/10)*10;
  for(let year=firstTick;year<=lastYear;year+=10)html+=`<text x="${x(year)}" y="310" text-anchor="middle" font-size="12">${year}</text>`;
  for(let index=0;index<=4;index++){
    const value=max*index/4;
    const yy=y(value);
    html+=`<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" stroke="#eee"/><text x="48" y="${yy+4}" text-anchor="end" font-size="11">${value.toFixed(1)}</text>`;
  }
  for(const points of segments(nationalSeries,x,y))html+=`<polyline points="${points.join(' ')}" fill="none" stroke="#777" stroke-width="2.5" stroke-dasharray="7 5"/>`;
  for(const points of segments(prefectureSeries,x,y))html+=`<polyline points="${points.join(' ')}" fill="none" stroke="#345d86" stroke-width="3"/>`;
  trend.innerHTML=html;
}

function mapSeriesRows(){
  const year=Number(yearEl.value);
  const cause=causeEl.value;
  return data.filter(row=>String(row[1])===cause&&row[2]===year&&row[0]!=='P00'&&row[3]!=null);
}

function nationalMapValue(){
  const year=Number(yearEl.value);
  const cause=causeEl.value;
  return data.find(row=>row[0]==='P00'&&String(row[1])===cause&&row[2]===year)?.[3]??null;
}

function nationalRatio(value,nationalValue){
  if(!Number.isFinite(value)||!Number.isFinite(nationalValue)||nationalValue<=0)return null;
  return value/nationalValue*100;
}

function relativeClass(ratio){
  if(!Number.isFinite(ratio))return -1;
  let index=0;
  while(index<relativeThresholds.length&&ratio>=relativeThresholds[index])index++;
  return index;
}

function ringsOf(feature){
  const geometry=feature.geometry;
  if(!geometry)return [];
  if(geometry.type==='Polygon')return geometry.coordinates.map(ring=>ring);
  if(geometry.type==='MultiPolygon')return geometry.coordinates.flatMap(polygon=>polygon.map(ring=>ring));
  return [];
}

function ringCenter(ring){
  let longitude=0;
  let latitude=0;
  for(const point of ring){
    longitude+=point[0];
    latitude+=point[1];
  }
  return [longitude/ring.length,latitude/ring.length];
}

function featureName(feature){
  const properties=feature.properties||{};
  if(properties.pref_name)return properties.pref_name;
  if(properties.N03_001)return properties.N03_001;
  const code=featureCode(feature);
  return code?names[Number(code.slice(1))]:'';
}

function featureCode(feature){
  const properties=feature.properties||{};
  const raw=String(properties.area_code??properties.code??properties.N03_007??'').match(/\d+/)?.[0]||'';
  if(raw){
    const two=raw.padStart(2,'0').slice(0,2);
    const number=Number(two);
    if(number>=1&&number<=47)return `P${two}`;
  }
  return nameToCode.get(properties.pref_name||properties.N03_001||'')||null;
}

function projector(bounds,box,padding=0){
  const [minLongitude,minLatitude,maxLongitude,maxLatitude]=bounds;
  const innerWidth=Math.max(1,box.width-padding*2);
  const innerHeight=Math.max(1,box.height-padding*2);
  const longitudeSpan=Math.max(.0001,maxLongitude-minLongitude);
  const latitudeSpan=Math.max(.0001,maxLatitude-minLatitude);
  const scale=Math.min(innerWidth/longitudeSpan,innerHeight/latitudeSpan);
  const offsetX=box.x+padding+(innerWidth-longitudeSpan*scale)/2;
  const offsetY=box.y+padding+(innerHeight-latitudeSpan*scale)/2;
  return ([longitude,latitude])=>[
    offsetX+(longitude-minLongitude)*scale,
    offsetY+(maxLatitude-latitude)*scale
  ];
}

const projectMain=projector(mainBounds,mainBox,0);

function pathForRings(rings,project){
  let path='';
  for(const ring of rings){
    if(!ring.length)continue;
    const points=ring.map(project);
    path+=`M${points.map(point=>point.map(value=>value.toFixed(1)).join(',')).join('L')}Z`;
  }
  return path;
}

function pathForFeature(feature){
  const visibleRings=ringsOf(feature).filter(ring=>{
    const [longitude,latitude]=ringCenter(ring);
    return longitude>=mainBounds[0]&&longitude<=mainBounds[2]&&latitude>=mainBounds[1]&&latitude<=mainBounds[3];
  });
  return pathForRings(visibleRings,projectMain);
}

function boundsOfRings(rings){
  const longitudes=[];
  const latitudes=[];
  for(const ring of rings){
    for(const [longitude,latitude] of ring){
      longitudes.push(longitude);
      latitudes.push(latitude);
    }
  }
  if(!longitudes.length)return null;
  return [Math.min(...longitudes),Math.min(...latitudes),Math.max(...longitudes),Math.max(...latitudes)];
}

function insetPathForRings(rings){
  const bounds=boundsOfRings(rings);
  if(!bounds)return '';
  return pathForRings(rings,projector(bounds,{x:0,y:0,width:300,height:160},8));
}

function okinawaZone(ring){
  const [longitude]=ringCenter(ring);
  if(longitude>=130)return 'daito';
  if(longitude<126.3)return 'sakishima';
  return 'main';
}

function mapDescription(name,value,nationalValue,ratio){
  if(!Number.isFinite(value))return `${name}：公表値なし`;
  if(!Number.isFinite(nationalValue)||!Number.isFinite(ratio))return `${name}：年齢調整死亡率 ${value.toFixed(1)}（人口10万対）`;
  return `${name}：年齢調整死亡率 ${value.toFixed(1)}、全国 ${nationalValue.toFixed(1)}、全国比 ${ratio.toFixed(0)}`;
}

function drawMap(){
  if(!mapGeo)return;
  const rows=mapSeriesRows();
  const valuesByCode=new Map(rows.map(row=>[row[0],row[3]]));
  const nationalValue=nationalMapValue();
  const selected=prefEl.value;
  const features=[...mapGeo.features].sort((a,b)=>featureName(a).localeCompare(featureName(b),'ja'));

  mapSvg.dataset.projection='uniform-national-bounds';
  mapSvg.dataset.colorScale='national-relative';
  mapSvg.dataset.okinawaLayout='responsive-panels';

  let html='<rect x="0" y="0" width="900" height="640" fill="#f8fafc"/>';
  for(const feature of features){
    const name=featureName(feature);
    const code=featureCode(feature);
    if(!code||code==='P47')continue;
    const value=valuesByCode.get(code)??null;
    const ratio=nationalRatio(value,nationalValue);
    const classification=relativeClass(ratio);
    const fill=classification<0?missingColor:relativePalette[classification];
    const path=pathForFeature(feature);
    if(!path)continue;
    const description=mapDescription(name,value,nationalValue,ratio);
    html+=`<path class="map-region ${code===selected?'map-selected':''}" data-code="${code}" data-name="${name}" data-value="${value??''}" data-national="${nationalValue??''}" data-ratio="${ratio??''}" tabindex="0" role="button" aria-label="${description}" d="${path}" fill="${fill}" fill-rule="evenodd" stroke="#fff" stroke-width="1.1"><title>${description}</title></path>`;
  }
  html+='<text x="875" y="625" text-anchor="end" class="map-note">標準化死亡比の全国地図と同じ縦横比で表示</text>';
  mapSvg.innerHTML=html;

  okinawaInsetsEl.innerHTML='';
  const okinawa=features.find(feature=>featureCode(feature)==='P47');
  if(okinawa){
    const code='P47';
    const value=valuesByCode.get(code)??null;
    const ratio=nationalRatio(value,nationalValue);
    const classification=relativeClass(ratio);
    const fill=classification<0?missingColor:relativePalette[classification];
    const description=mapDescription('沖縄県',value,nationalValue,ratio);
    const groups={main:[],sakishima:[],daito:[]};
    for(const ring of ringsOf(okinawa))groups[okinawaZone(ring)].push(ring);
    const panels=okinawaLayouts.map(layout=>{
      const path=insetPathForRings(groups[layout.key]);
      const shape=path?`<path class="okinawa-shape okinawa-inset okinawa-inset-${layout.key}" d="${path}" fill="${fill}" fill-rule="evenodd" stroke="#fff" stroke-width="1.1"/>`:'';
      return `<section class="okinawa-panel okinawa-panel-${layout.key}"><span class="okinawa-panel-title">${layout.label}</span><svg viewBox="0 0 300 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${shape}</svg></section>`;
    }).join('');
    okinawaInsetsEl.innerHTML=`<div class="map-region okinawa-region ${code===selected?'map-selected':''}" data-code="${code}" data-name="沖縄県" data-value="${value??''}" data-national="${nationalValue??''}" data-ratio="${ratio??''}" tabindex="0" role="button" aria-label="${description}"><span class="sr-only">${description}</span>${panels}</div>`;
  }

  document.querySelectorAll('.map-wrap .map-region').forEach(element=>{
    const select=()=>{
      prefEl.value=element.dataset.code;
      render();
      mapTip.textContent=`${element.dataset.name}を選択しました。`;
    };
    element.addEventListener('click',select);
    element.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        select();
      }
    });
    element.addEventListener('pointerenter',()=>{
      const value=Number(element.dataset.value);
      const national=Number(element.dataset.national);
      const ratio=Number(element.dataset.ratio);
      mapTip.textContent=mapDescription(
        element.dataset.name,
        Number.isFinite(value)&&element.dataset.value!==''?value:null,
        Number.isFinite(national)&&element.dataset.national!==''?national:null,
        Number.isFinite(ratio)&&element.dataset.ratio!==''?ratio:null
      );
    });
  });

  mapLegend.innerHTML='';
  if(!rows.length||!Number.isFinite(nationalValue)||nationalValue<=0){
    mapLegend.innerHTML='<span class="map-scale-label">全国との比較</span><span class="legend-item"><span class="legend-swatch map-swatch-missing"></span>公表値なし</span>';
    return;
  }
  mapLegend.insertAdjacentHTML('beforeend',`<span class="map-scale-label">全国の年齢調整死亡率 ${nationalValue.toFixed(1)} を100とした比率</span>`);
  relativeLabels.forEach((label,index)=>{
    mapLegend.insertAdjacentHTML('beforeend',`<span class="legend-item"><span class="legend-swatch map-swatch-${index}"></span>${label}</span>`);
  });
  mapLegend.insertAdjacentHTML('beforeend','<span class="legend-item"><span class="legend-swatch map-swatch-missing"></span>欠測</span>');
}

function selectedContext(){
  const cause=causeEl.value;
  const causeLabel=causeLabels()[cause]||'死因';
  const sexLabel=sexEl.options[sexEl.selectedIndex]?.text||'性別';
  const prefectureLabel=names[Number(prefEl.value.slice(1))]||'選択都道府県';
  const year=Number(yearEl.value);
  return {cause,causeLabel,sexLabel,prefectureLabel,year};
}

function updateResultContext(){
  const {causeLabel,sexLabel,prefectureLabel,year}=selectedContext();
  const nationalOnly=prefEl.value==='P00';
  document.querySelector('#yearControl').hidden=nationalOnly;
  yearEl.disabled=nationalOnly;
  document.querySelector('#mapCard').hidden=nationalOnly;
  document.querySelector('#rankingCard').hidden=nationalOnly;
  if(nationalOnly){
    resultContextEl.textContent=`表示中：${causeLabel}／${sexLabel}／全国／経年推移`;
    mapContextEl.textContent='';
    rankingContextEl.textContent='';
    trendTitleEl.textContent=`全国の${causeLabel}の経年推移｜${sexLabel}`;
    trend.setAttribute('aria-label',`全国の${sexLabel}・${causeLabel}の年齢調整死亡率の経年推移`);
    return;
  }
  resultContextEl.textContent=`表示中：${causeLabel}／${sexLabel}／${year}年／${prefectureLabel}`;
  const sectionContext=`現在の表示条件：${prefectureLabel}／${causeLabel}／${sexLabel}／${year}年／人口10万対・平成27年モデル人口`;
  mapContextEl.textContent=sectionContext;
  rankingContextEl.textContent=sectionContext;
  mapTitleEl.textContent=`${causeLabel}の全国地図｜${year}年・${sexLabel}`;
  trendTitleEl.textContent=`${prefectureLabel}と全国の${causeLabel}の経年推移｜${sexLabel}`;
  rankingTitleEl.textContent=`${causeLabel}の都道府県ランキング｜${year}年・${sexLabel}`;
  mapSvg.setAttribute('aria-label',`${year}年・${sexLabel}・${causeLabel}の都道府県別年齢調整死亡率の全国地図`);
  trend.setAttribute('aria-label',`${prefectureLabel}と全国の${sexLabel}・${causeLabel}の年齢調整死亡率の経年推移`);
}

function cancerSiteCauses(){
  return allCauses.filter(cause=>{
    const label=causeLabels()[cause]||'';
    if(causeGroup(label)!=='cancer')return false;
    return !/^(悪性新生物(?:＜[^＞]+＞)?|全悪性新生物|cancer|all malignant neoplasms?)$/i.test(label.trim());
  });
}

function drawCancerComparison(){
  const {cause,causeLabel,year,prefectureLabel}=selectedContext();
  const cancerSelected=prefEl.value!=='P00'&&causeGroup(causeLabel)==='cancer';
  cancerComparisonCardEl.hidden=!cancerSelected;
  if(!cancerSelected){
    cancerComparisonEl.innerHTML='';
    return;
  }
  cancerComparisonTitleEl.textContent='参考：悪性新生物の部位別比較';
  const prefecture=prefEl.value;
  const labels=causeLabels();
  let candidates=cancerSiteCauses().map(siteCause=>{
    const prefValue=data.find(row=>row[0]===prefecture&&String(row[1])===siteCause&&row[2]===year)?.[3]??null;
    const nationalValue=data.find(row=>row[0]==='P00'&&String(row[1])===siteCause&&row[2]===year)?.[3]??null;
    return {cause:siteCause,label:labels[siteCause]||siteCause,prefValue,nationalValue};
  }).filter(item=>item.prefValue!=null||item.nationalValue!=null)
    .sort((a,b)=>(b.prefValue??b.nationalValue??0)-(a.prefValue??a.nationalValue??0));
  const selectedSite=candidates.find(item=>item.cause===cause);
  candidates=candidates.slice(0,24);
  if(selectedSite&&!candidates.includes(selectedSite)){
    if(candidates.length)candidates[candidates.length-1]=selectedSite;
    else candidates=[selectedSite];
  }
  if(!candidates.length){
    cancerComparisonEl.innerHTML='<p class="note">この分類・年には、比較できる部位別悪性新生物の公表値がありません。</p>';
    return;
  }
  const max=Math.max(1,...candidates.flatMap(item=>[item.prefValue??0,item.nationalValue??0]));
  cancerComparisonEl.innerHTML=`<div class="cancer-legend"><span class="cancer-key cancer-pref">${prefectureLabel}</span><span class="cancer-key cancer-national">全国</span></div><div class="cancer-bars">${candidates.map(item=>`<div class="cancer-row ${item.cause===cause?'cancer-selected':''}"><span class="cancer-label">${item.label}${item.cause===cause?'<small>選択中</small>':''}</span><div class="cancer-values"><div><progress class="cancer-progress cancer-progress-pref" max="${max}" value="${item.prefValue??0}" aria-label="${item.label} ${prefectureLabel} ${item.prefValue??'公表値なし'}"></progress><b>${item.prefValue==null?'—':item.prefValue.toFixed(1)}</b></div><div><progress class="cancer-progress cancer-progress-national" max="${max}" value="${item.nationalValue??0}" aria-label="${item.label} 全国 ${item.nationalValue??'公表値なし'}"></progress><b>${item.nationalValue==null?'—':item.nationalValue.toFixed(1)}</b></div></div></div>`).join('')}</div>`;
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,character=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
}

function causeProfileRows(){
  const prefecture=prefEl.value;
  const year=Number(yearEl.value);
  if(prefecture==='P00'||!Number.isFinite(year))return [];
  const yearRows=data.filter(row=>row[2]===year&&row[3]!=null);
  const nationalByCause=new Map();
  const prefectureByCause=new Map();
  const regionalByCause=new Map();
  for(const row of yearRows){
    const cause=String(row[1]);
    if(row[0]==='P00'){
      nationalByCause.set(cause,row[3]);
    }else{
      if(!regionalByCause.has(cause))regionalByCause.set(cause,[]);
      regionalByCause.get(cause).push(row[3]);
      if(row[0]===prefecture)prefectureByCause.set(cause,row[3]);
    }
  }
  const labels=causeLabels();
  return allCauses.map(cause=>{
    const prefectureValue=prefectureByCause.get(cause);
    const nationalValue=nationalByCause.get(cause);
    const ratio=nationalRatio(prefectureValue,nationalValue);
    if(!Number.isFinite(ratio))return null;
    const regionalValues=(regionalByCause.get(cause)||[]).filter(Number.isFinite).sort((a,b)=>b-a);
    const rank=regionalValues.findIndex(value=>value===prefectureValue)+1;
    return {cause,label:labels[cause]||cause,prefectureValue,nationalValue,ratio,rank,total:regionalValues.length};
  }).filter(Boolean).sort((a,b)=>b.ratio-a.ratio||b.prefectureValue-a.prefectureValue);
}

function drawCauseProfile(){
  const nationalOnly=prefEl.value==='P00';
  causeProfileCardEl.hidden=nationalOnly;
  if(nationalOnly)return;
  const prefectureName=names[Number(prefEl.value.slice(1))]||'選択都道府県';
  causeProfileTitleEl.textContent=`${prefectureName}で高い死因を見る`;
  causeProfileToggleEl.setAttribute('aria-expanded',String(causeProfileOpen));
  causeProfileToggleEl.textContent=causeProfileOpen?'死因別の特徴を閉じる':'死因別の特徴を表示';
  causeProfileBodyEl.hidden=!causeProfileOpen;
  if(!causeProfileOpen)return;
  const rows=causeProfileRows();
  const filtered=rows.filter(item=>causeProfileFilter==='high120'?item.ratio>=120:causeProfileFilter==='above'?item.ratio>100:true);
  const shown=filtered.slice(0,50);
  document.querySelectorAll('.cause-profile-filters button').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.filter===causeProfileFilter));
  });
  causeProfileSummaryEl.textContent=`${yearEl.value}年・${sexEl.options[sexEl.selectedIndex]?.text||''}：比較可能${rows.length}死因中、全国比100超は${rows.filter(item=>item.ratio>100).length}死因、120以上は${rows.filter(item=>item.ratio>=120).length}死因。条件該当${filtered.length}件のうち最大50件を表示します。`;
  if(!shown.length){
    causeProfileListEl.innerHTML='<p class="note">この条件に該当する公表値はありません。</p>';
    return;
  }
  causeProfileListEl.innerHTML=shown.map(item=>`<button type="button" class="cause-profile-row" data-cause="${escapeHtml(item.cause)}" aria-label="${escapeHtml(item.label)}の詳細を表示。全国比 ${item.ratio.toFixed(1)}、年齢調整死亡率 ${item.prefectureValue.toFixed(1)}、全国 ${item.nationalValue.toFixed(1)}、${item.rank}位"><span class="cause-profile-name"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.cause)}</small></span><span class="cause-profile-ratio">全国比 <b>${item.ratio.toFixed(1)}</b></span><span>年齢調整死亡率 ${item.prefectureValue.toFixed(1)}</span><span>全国 ${item.nationalValue.toFixed(1)}</span><span>${item.rank}位 / ${item.total}都道府県</span></button>`).join('');
}


function trendComparisonPeriod(){
  const [firstYear,lastYear]=classificationConfig().years||[];
  if(!Number.isFinite(firstYear)||!Number.isFinite(lastYear)||lastYear-firstYear<9)return null;
  return {
    previousStart:lastYear-9,
    previousEnd:lastYear-5,
    recentStart:lastYear-4,
    recentEnd:lastYear
  };
}

function mean(values){
  return values.reduce((sum,value)=>sum+value,0)/values.length;
}

function signed(value,digits=1){
  return `${value>0?'+':''}${value.toFixed(digits)}`;
}

function trendProfileRows(){
  const prefecture=prefEl.value;
  const period=trendComparisonPeriod();
  if(prefecture==='P00'||!period)return [];
  const labels=causeLabels();
  return allCauses.map(cause=>{
    const values=new Map(data
      .filter(row=>row[0]===prefecture&&String(row[1])===cause&&Number.isFinite(row[3]))
      .map(row=>[row[2],row[3]]));
    const previousYears=[];
    const recentYears=[];
    for(let year=period.previousStart;year<=period.previousEnd;year++)if(values.has(year))previousYears.push(values.get(year));
    for(let year=period.recentStart;year<=period.recentEnd;year++)if(values.has(year))recentYears.push(values.get(year));
    if(previousYears.length!==5||recentYears.length!==5)return null;
    const previousAverage=mean(previousYears);
    const recentAverage=mean(recentYears);
    const change=recentAverage-previousAverage;
    const percentChange=previousAverage>0?change/previousAverage*100:null;
    return {
      cause,
      label:labels[cause]||cause,
      previousAverage,
      recentAverage,
      change,
      percentChange,
      lowRate:previousAverage<1||recentAverage<1
    };
  }).filter(Boolean);
}

function drawTrendProfile(){
  const nationalOnly=prefEl.value==='P00';
  trendProfileCardEl.hidden=nationalOnly;
  if(nationalOnly)return;
  const prefectureName=names[Number(prefEl.value.slice(1))]||'選択都道府県';
  const period=trendComparisonPeriod();
  trendProfileTitleEl.textContent=`${prefectureName}で最近変化が大きい死因を見る`;
  trendProfileToggleEl.setAttribute('aria-expanded',String(trendProfileOpen));
  trendProfileToggleEl.textContent=trendProfileOpen?'5年平均の変化を閉じる':'5年平均の変化を表示';
  trendProfileBodyEl.hidden=!trendProfileOpen;
  if(!trendProfileOpen)return;
  if(!period){
    trendProfileSummaryEl.textContent='10年間の比較に必要な収録期間がありません。';
    trendProfileListEl.innerHTML='';
    return;
  }
  const rows=trendProfileRows();
  const filtered=rows.filter(item=>trendProfileFilter==='increase'?item.change>0:trendProfileFilter==='decrease'?item.change<0:true);
  filtered.sort((a,b)=>trendProfileFilter==='decrease'?a.change-b.change:trendProfileFilter==='increase'?b.change-a.change:Math.abs(b.change)-Math.abs(a.change));
  const shown=filtered.slice(0,50);
  document.querySelectorAll('.trend-profile-filters button').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.filter===trendProfileFilter));
  });
  trendProfileSummaryEl.textContent=`${period.previousStart}～${period.previousEnd}年平均と${period.recentStart}～${period.recentEnd}年平均を比較。各5年が揃う${rows.length}死因中、増加${rows.filter(item=>item.change>0).length}死因、減少${rows.filter(item=>item.change<0).length}死因。条件該当${filtered.length}件のうち最大50件を変化量順に表示します。`;
  if(!shown.length){
    trendProfileListEl.innerHTML='<p class="note">この条件に該当する公表値はありません。</p>';
    return;
  }
  trendProfileListEl.innerHTML=shown.map(item=>{
    const direction=item.change>0?'up':item.change<0?'down':'flat';
    const rate=Number.isFinite(item.percentChange)?`${signed(item.percentChange)}%`:'算出不可';
    const caution=item.lowRate?'<small class="trend-low-note">低率・変動注意</small>':'';
    return `<button type="button" class="cause-profile-row trend-profile-row" data-cause="${escapeHtml(item.cause)}" aria-label="${escapeHtml(item.label)}の推移を表示。年齢調整死亡率の変化量 ${signed(item.change)}、前半5年平均 ${item.previousAverage.toFixed(1)}、直近5年平均 ${item.recentAverage.toFixed(1)}、変化率 ${rate}${item.lowRate?'、低率のため変動に注意':''}"><span class="cause-profile-name"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.cause)}</small>${caution}</span><span class="trend-change trend-change-${direction}">変化量 <b>${signed(item.change)}</b></span><span>${period.previousStart}～${period.previousEnd}年 <b>${item.previousAverage.toFixed(1)}</b></span><span>${period.recentStart}～${period.recentEnd}年 <b>${item.recentAverage.toFixed(1)}</b></span><span class="trend-rate">変化率 ${rate}</span></button>`;
  }).join('');
}

function render(){
  if(!causeEl.value){
    availabilityEl.textContent='検索条件に合う死因がありません';
    ranking.innerHTML='';
    cancerComparisonCardEl.hidden=true;
    cancerComparisonEl.innerHTML='';
    resultContextEl.textContent='表示できる死因を選択してください。';
    return;
  }
  updateResultContext();
  drawCauseProfile();
  drawTrendProfile();
  const available=availability();
  const year=Number(yearEl.value);
  const cause=causeEl.value;
  periodWarn.innerHTML='';
  if(available&&(year<available[0]||year>available[1])){
    periodWarn.innerHTML=`<div class="warn">${causeLabels()[cause]}の公表値収録期間は${available[0]}～${available[1]}年です。${year}年を0としては扱いません。</div>`;
  }

  const nationalOnly=prefEl.value==='P00';
  const rows=mapSeriesRows().sort((a,b)=>b[3]-a[3]);
  if(nationalOnly){
    const nationalSeries=series('P00',cause);
    statusEl.textContent=nationalSeries.some(row=>row[1]!=null)?'全国の公表値による経年推移を表示しています。':'この条件では全国の公表値がありません。';
    ranking.innerHTML='';
    drawTrend();
    drawCancerComparison();
    return;
  }
  statusEl.textContent=rows.length?`${year}年・${rows.length}都道府県（公表値のある地域）`:'この条件では公表値がありません。';
  if(!rows.length){
    ranking.innerHTML='';
  }else{
    const max=Math.max(...rows.map(row=>row[3]),1);
    ranking.innerHTML=`<div class="bars">${rows.map((row,index)=>`<div class="bar ${row[0]===prefEl.value?'rank-selected':''}"><span>${index+1}. ${names[Number(row[0].slice(1))]}</span><progress class="rank-progress" max="${max}" value="${row[3]}" aria-label="${names[Number(row[0].slice(1))]} 年齢調整死亡率 ${row[3].toFixed(1)}"></progress><strong>${row[3].toFixed(1)}</strong></div>`).join('')}</div>`;
  }
  drawMap();
  drawTrend();
  drawCancerComparison();
}

classificationEl.addEventListener('change',()=>loadData({preserveCause:false}).catch(error=>{
  console.error(error);
  statusEl.textContent='読み込みに失敗しました。';
}));
sexEl.addEventListener('change',()=>loadData({preserveCause:true}).catch(error=>{
  console.error(error);
  statusEl.textContent='読み込みに失敗しました。';
}));
prefEl.addEventListener('change',render);
yearEl.addEventListener('change',render);
causeEl.addEventListener('change',render);
causeGroupEl.addEventListener('change',()=>{
  if(updateCauseOptions({preserve:true}))render();
});
causeSearchEl.addEventListener('input',()=>{
  if(updateCauseOptions({preserve:true}))render();
});
causeProfileToggleEl.addEventListener('click',()=>{
  causeProfileOpen=!causeProfileOpen;
  drawCauseProfile();
});
document.querySelector('.cause-profile-filters').addEventListener('click',event=>{
  const button=event.target.closest('button[data-filter]');
  if(!button)return;
  causeProfileFilter=button.dataset.filter;
  drawCauseProfile();
});

trendProfileToggleEl.addEventListener('click',()=>{
  trendProfileOpen=!trendProfileOpen;
  drawTrendProfile();
});
document.querySelector('.trend-profile-filters').addEventListener('click',event=>{
  const button=event.target.closest('button[data-filter]');
  if(!button)return;
  trendProfileFilter=button.dataset.filter;
  drawTrendProfile();
});
trendProfileListEl.addEventListener('click',event=>{
  const button=event.target.closest('button[data-cause]');
  if(!button)return;
  causeGroupEl.value='all';
  causeSearchEl.value='';
  updateCauseOptions({preserve:false});
  causeEl.value=button.dataset.cause;
  render();
  document.querySelector('#trendCard').scrollIntoView({behavior:'smooth',block:'start'});
});

causeProfileListEl.addEventListener('click',event=>{
  const button=event.target.closest('button[data-cause]');
  if(!button)return;
  causeGroupEl.value='all';
  causeSearchEl.value='';
  updateCauseOptions({preserve:false});
  causeEl.value=button.dataset.cause;
  render();
  document.querySelector('#mapCard').scrollIntoView({behavior:'smooth',block:'start'});
});

init();
