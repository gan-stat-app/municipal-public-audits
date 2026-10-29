import{readFileSync}from'node:fs';import{gunzipSync}from'node:zlib';
const root=new URL('../public/school-dental/',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8'),js=readFileSync(new URL('app.js',root),'utf8'),data=JSON.parse(gunzipSync(readFileSync(new URL('data/school-dental.json.gz',root)))),bodyDoc=JSON.parse(gunzipSync(readFileSync(new URL('data/school-body.json.gz',root)))),expand=doc=>doc.columns?doc.rows.map(values=>Object.fromEntries(doc.columns.map((column,i)=>[column,values[i]]))):doc.rows,body={meta:bodyDoc.meta,rows:expand(bodyDoc)};
if(!html.includes('<h1><span>子どもの歯・視力・体格</span> <span>都道府県比較</span></h1>'))throw Error('学校保健のタイトルが不正です');
if(!html.includes('/transparency/#citation'))throw Error('引用・利用案内へのリンクがありません');
if(!html.includes('2025年度・12歳・男女計・永久歯1人当たり平均むし歯等数'))throw Error('歯・口腔の初期条件の説明がありません');
if(!html.includes('近視の診断率ではありません'))throw Error('視力の解釈上の注意がありません');
if(!js.includes("theme:'dental',year:2025,age:12,sex:'total',metric:'dmft',pref:'00'"))throw Error('歯・口腔・全国を初期表示にする状態が違います');
if(!html.includes('<option value="body">体格</option>')||!js.includes("obesity_rate:{label:'肥満傾向児'")||!js.includes("height_mean:{label:'平均身長'"))throw Error('体格指標がありません');
if(!js.includes('async function ensureBody()')||!js.includes("jsonGz('./data/school-body.json.gz?v=3')")||js.includes("Promise.all([jsonGz('./data/school-dental.json.gz'),fetch('./data/school-body"))throw Error('圧縮体格データが初期表示で遅延読込されません');
if(!Array.isArray(bodyDoc.columns)||bodyDoc.rows.some(row=>!Array.isArray(row)||row.length!==bodyDoc.columns.length))throw Error('体格データが列共有形式になっていません');
if(!js.includes('Object.assign(existing,row)'))throw Error('体格データが既存の年度・年齢・性別・地域行へ統合されません');
if(body.meta.years.join(',')!==Array.from({length:20},(_,i)=>2006+i).join(',')||body.rows.length!==37440)throw Error(`体格年度・行数が不正: ${body.meta.years}/${body.rows.length}`);
for(const year of body.meta.years)for(let age=5;age<=17;age++)for(const sex of['total','male','female']){const rs=body.rows.filter(r=>r.year===year&&r.age===age&&r.sex===sex);if(rs.length!==48)throw Error(`体格 ${year}/${age}/${sex}: ${rs.length}`)}
const bodyKeys=new Set(body.rows.map(r=>`${r.year}/${r.age}/${r.sex}/${r.prefCode}`));if(bodyKeys.size!==body.rows.length)throw Error('体格データに重複条件があります');
for(const row of body.rows){for(const [total,parts] of [['obesity_rate',['obesity_mild','obesity_moderate','obesity_severe']],['thinness_rate',['thinness_mild','thinness_severe']]]){const values=parts.map(key=>row[key]),tolerance=row.year<2020&&total==='thinness_rate'?.511:.011;if(Number.isFinite(row[total])&&values.every(Number.isFinite)&&Math.abs(row[total]-values.reduce((a,b)=>a+b,0))>tolerance)throw Error(`体格内訳の不一致: ${row.year}/${row.age}/${row.sex}/${row.prefCode}/${total}`)}}
const body2020=body.rows.find(r=>r.year===2020&&r.age===12&&r.sex==='total'&&r.prefCode==='00');if(body2020.obesity_rate!==10.84||body2020.thinness_rate!==4)throw Error('2020年度全国12歳の体格値が原表と一致しません');
const bodyNational=body.rows.find(r=>r.year===2025&&r.age===12&&r.sex==='total'&&r.prefCode==='00');if(bodyNational.obesity_rate!==11.1||bodyNational.thinness_rate!==3.94)throw Error('全国12歳の肥満・痩身傾向が原表と一致しません');
// e-Stat 2025年度表6 statInfId=000040409512。06-001/005/009のI7（全国）・I12（秋田県）。
// 全国男女計の一致だけでは、都道府県別・男女別の12歳の欠落を検出できない。
for(const row of body.rows.filter(r=>r.year===2025&&r.age===12))if(!Number.isFinite(row.obesity_rate))throw Error(`2025年度12歳の肥満傾向児が欠測です: ${row.sex}/${row.prefCode}`);
for(const [prefCode,sex,expected] of [['00','male',12.68],['00','female',9.46],['05','total',13.84],['05','male',15.94],['05','female',11.69]]){
 const row=body.rows.find(r=>r.year===2025&&r.age===12&&r.sex===sex&&r.prefCode===prefCode);
 if(!row||row.obesity_rate!==expected)throw Error(`2025年度12歳の肥満傾向児が原表と一致しません: ${sex}/${prefCode}`);
}
const bodyMale=body.rows.find(r=>r.year===2025&&r.age===12&&r.sex==='male'&&r.prefCode==='00');if(bodyMale.height_mean!==153.8||bodyMale.height_sd!==8.06||bodyMale.weight_mean!==45.2||bodyMale.weight_sd!==10.17)throw Error('全国12歳男子の身長・体重が原表と一致しません');
if(!js.includes('function bodySd(')||!html.includes('平均身長と平均体重からBMIは算出していません'))throw Error('体格の表示・解釈上の注意が不足しています');
if(!js.includes("prefCode:'00',prefecture:'全国'")||!js.includes("p.prefecture+(p.published?'':'（'+missingReason(S.year,p.prefCode)+'）')"))throw Error('全国と公表値がない都道府県を選択肢に残す実装がありません');
if(!js.includes("S.pref==='00'?'':bar(nat,'全国')"))throw Error('全国選択時に視力内訳を重複表示します');
if(data.rows.length!==37440)throw Error(`行数が不正: ${data.rows.length}`);
if(data.meta.years.join(',')!==Array.from({length:20},(_,i)=>2006+i).join(','))throw Error('年度範囲が不正');
for(const y of data.meta.years)for(const age of[5,12,17])for(const sex of['total','male','female']){const rows=data.rows.filter(r=>r.year===y&&r.age===age&&r.sex===sex);if(rows.length!==48)throw Error(`${y}/${age}/${sex}: ${rows.length}`)}
if(!js.includes('function cascade()')||!js.includes('pref-shape:not(.unavailable)'))throw Error('公表値連動セレクターがありません');
if(data.nationalLong[0].year!==1984||data.nationalLong[0].dmft!==4.75)throw Error('長期系列の始点が不正');
const latest=data.rows.find(r=>r.year===2025&&r.age===12&&r.sex==='total'&&r.prefCode==='00');if(latest.dmft!==.47)throw Error(`全国12歳DMFTが不正: ${latest.dmft}`);
if(latest.vision_below_1!==53.52||latest.vision_07_to_1!==13.12||latest.vision_03_to_07!==18.05||latest.vision_below_03!==22.35)throw Error('全国12歳の視力内訳が原表と一致しません');
// 秋田県の視力4項目を原表から固定。2006～2025年度の780行・3120項目を全件照合済み。
// e-Stat statInfId: 2006=000001075838、2011=000012915321、2012=000020086441、
// 2019=000031925057、2020=000032108460、2025=000040409514。原表SHA256はdata.meta.sourcesに保存。
// 内訳の一部がX、4項目がXまたは-の条件も固定し、欠測の0置換・推測補完を検出する。
const akitaVisionFields=['vision_below_1','vision_07_to_1','vision_03_to_07','vision_below_03'];
const akitaVisionCases=[
 [2006,6,'total',[25.2,17,6.8,1.4]], // 09-002 D17:G17
 [2011,6,'total',[27,20.3,5.8,.9]], // 09-002 D17:G17（秋田県は調査対象）
 [2011,12,'total',[68.2,null,null,null]], // 09-008 D17:G17（内訳はX）
 [2012,12,'total',[54.8,10.8,17.3,26.7]], // 09-008 M17:P17
 [2019,12,'female',[57,23.5,22.7,10.8]], // 08-034 M17:P17
 [2020,6,'male',[28.9,20.8,7.7,.4]], // 08-015 M17:P17
 [2025,6,'total',[24.7,14.7,7,3]], // 08-002 K12:N12
 [2025,6,'male',[25.4,12.6,8.3,4.5]], // 08-015 K12:N12
 [2025,6,'female',[24,16.9,5.7,1.4]], // 08-028 K12:N12
 [2025,7,'total',[27.7,14.3,10.8,2.6]], // 08-003 K12:N12
 [2025,7,'male',[null,null,null,null]], // 08-016 K12:N12（X）
 [2025,12,'total',[null,null,null,null]], // 08-008 K12:N12（X）
 [2025,12,'male',[null,null,null,null]], // 08-021 K12:N12（X）
 [2025,12,'female',[null,null,null,null]], // 08-034 K12:N12（-）
];
for(const [year,age,sex,expected] of akitaVisionCases){
 const matches=data.rows.filter(r=>r.year===year&&r.age===age&&r.sex===sex&&r.prefCode==='05');
 if(matches.length!==1||matches[0].prefecture!=='秋田県')throw Error(`秋田県の視力回帰検査対象行が不正です: ${year}/${age}/${sex}/${matches.length}`);
 for(const [i,metric] of akitaVisionFields.entries())if(matches[0][metric]!==expected[i])throw Error(`秋田県の視力値が原表と一致しません: ${year}/${age}/${sex}/${metric}: ${matches[0][metric]} != ${expected[i]}`);
}
if(Math.abs(latest.vision_below_1-(latest.vision_07_to_1+latest.vision_03_to_07+latest.vision_below_03))>.001)throw Error('視力1.0未満と内訳の合計が一致しません');
for(const row of data.rows.filter(r=>r.vision_below_1!=null)){const parts=['vision_07_to_1','vision_03_to_07','vision_below_03'].map(k=>row[k]);if(parts.every(Number.isFinite)&&Math.abs(row.vision_below_1-parts.reduce((a,b)=>a+b,0))>.11)throw Error(`視力内訳の不一致: ${row.year}/${row.age}/${row.prefCode}`)}
for(const dataset of[data.rows,body.rows])for(const code of['03','04','07']){const rows=dataset.filter(r=>r.year===2011&&r.prefCode===code);if(rows.some(r=>Object.entries(r).some(([k,v])=>!['year','age','sex','prefCode','prefecture'].includes(k)&&v!=null)))throw Error(`2011年度の調査対象外3県に値があります: ${code}`)}
for(const [metric,expected] of[['vision_below_1',36],['caries_rate',44],['dmft',44]]){const rank=data.rows.filter(r=>r.year===2011&&r.age===12&&r.sex==='total'&&r.prefCode!=='00'&&Number.isFinite(r[metric]));if(rank.length!==expected)throw Error(`2011年度${metric}の順位母数が${rank.length}県です`)}
for(const metric of['obesity_rate','thinness_rate']){const rank=body.rows.filter(r=>r.year===2011&&r.age===12&&r.sex==='total'&&r.prefCode!=='00'&&Number.isFinite(r[metric]));if(rank.length!==44)throw Error(`2011年度${metric}の順位母数が${rank.length}県です`)}
if(!js.includes('全国値は岩手県・宮城県・福島県を除く')||!html.includes('3県は「調査対象外」'))throw Error('2011年度の対象外3県に関する画面注記がありません');
if(data.nationalLong.at(-1).year!==2025||data.nationalLong.at(-1).dmft!==.47)throw Error('長期系列の終点が不正');
console.log(JSON.stringify({ok:true,rows:data.rows.length,years:data.meta.years,longYears:[data.nationalLong[0].year,data.nationalLong.at(-1).year],latestNationalDmft:latest.dmft,akitaVisionCases:akitaVisionCases.length}));
await import('./school-trend-test.mjs');
