import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const root = new URL('../public/dpc/', import.meta.url);
const summary = JSON.parse(readFileSync(new URL('data/summary.json', root)));
const hospitalHistory = JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL('data/hospital-history.json.gz.b64', root), 'utf8').trim(), 'base64')));
const history = JSON.parse(readFileSync(new URL('data/area-history.json', root)));
const validation = JSON.parse(readFileSync(new URL('data/validation.json', root)));
const yearPayloads = ['2021','2022','2023'].map(year =>
  JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL(`data/year-${year}.json.gz.b64`, root), 'utf8').trim(), 'base64'))),
);
assert.equal(validation.status, 'PASS');
assert.equal(summary.meta.hospitalCount, 6372);
assert.deepEqual(history.meta.years.map(x => x.year), ['2021','2022','2023']);
assert.equal(hospitalHistory.validation.currentHospitals, 6372);
assert.equal(hospitalHistory.validation.withFourYears, 5624);
assert.equal(hospitalHistory.validation.withAtLeastTwoYears, 6244);
assert.equal(hospitalHistory.validation.eventLinksExcluded, 19);
assert.equal(hospitalHistory.validation.ambiguousLinksExcluded, 5);
assert.equal(Object.keys(hospitalHistory.hospitals).length, 6372);
assert.ok(Object.values(hospitalHistory.hospitals).every(rows => rows.length >= 1 && rows.length <= 4));
assert.equal(history.rows.length, 1005);
assert.deepEqual(yearPayloads.map(x => x.meta.year), ['2021','2022','2023']);
assert.deepEqual(yearPayloads.map(x => x.meta.hospitalCount), [5732,5919,6304]);
assert.ok(yearPayloads.every(x => x.meta.areaCount === 335 && x.meta.unmappedHospitalCount === 0));
assert.ok(yearPayloads.every(x => x.summary.areas.length === 335 && x.summary.mdc.length === 18));
assert.ok(yearPayloads.every(x => x.hospitals.length === x.meta.hospitalCount));
assert.ok(yearPayloads.every(x => x.meta.hospitalSchema === 'v2-array'));
assert.ok(yearPayloads.every(x => x.hospitals.every(h => h[7] && h.slice(18).length === 18 && h.slice(18).every(m => m.length === 10))));
assert.ok(yearPayloads.every(x => !x.meta.unavailable.includes('death24hPublished')));
assert.ok(yearPayloads.every(x => x.meta.sourceManifest.length === 5));
assert.ok(yearPayloads.every(x => x.summary.areas.some(a => a.death24hPublished > 0)));
assert.ok(yearPayloads.every(x => x.meta.sourceManifest.every(s => /^[0-9a-f]{64}$/.test(s.sha256))));
assert.ok(yearPayloads.every(x => /0に置換せず/.test(x.meta.suppression)));
assert.ok(history.validation.every(x => x.areaCount === 335 && x.unmappedHospitalCount === 0));
assert.ok(history.rows.every(x => Number.isInteger(x.published) && Number.isInteger(x.suppressed)));
assert.match(history.meta.suppression, /0に置換せず/);
assert.equal(summary.meta.areaCount, 335);
assert.equal(summary.meta.unmappedHospitalCount, 0);
assert.equal(summary.mdc.length, 18);
assert.equal(summary.areas.length, 335);
assert.equal(summary.meta.sourceManifest.length, 8);
assert.ok(summary.meta.sourceManifest.every(x => /^[0-9a-f]{64}$/.test(x.sha256)));

const files = readdirSync(new URL('data/pref/', root)).filter(x => x.endsWith('.json.gz'));
assert.equal(files.length, 47);
let hospitals = 0;
for (const file of files) {
  const rows = JSON.parse(gunzipSync(readFileSync(new URL(`data/pref/${file}`, root))));
  hospitals += rows.length;
  assert.ok(rows.every(h => h.area && h.mdc && Object.keys(h.mdc).length === 18));
}
assert.equal(hospitals, 6372);

const death24h = JSON.parse(gunzipSync(readFileSync(new URL('data/death24h.json.gz', root))));
assert.equal(death24h.meta.scope, '医療機関別MDC');
assert.equal(death24h.meta.hospitalCount, 6372);
assert.equal(death24h.meta.mdcCount, 18);
assert.equal(Object.keys(death24h.hospitals).length, 6372);
assert.equal(Object.keys(death24h.areas).length, 335);
assert.equal(Object.values(death24h.areas).reduce((n, x) => n + x.death24hPublished, 0), 32619);
assert.equal(Object.values(death24h.areas).filter(x => x.death24hPublished > 0).length, 267);
assert.ok(Object.values(death24h.hospitals).every(m => Object.keys(m).length === 18));
assert.ok(Object.values(death24h.hospitals).every(m => Object.values(m).every(x => Number.isInteger(x.death24hPublished) && Number.isInteger(x.death24hSuppressed))));

const surgeryDefinitions = JSON.parse(readFileSync(new URL('data/surgery-definitions.json', root), 'utf8'));
assert.equal(surgeryDefinitions.meta.year, '令和6年度');
assert.equal(surgeryDefinitions.meta.effective, '2025-03-18');
assert.equal(Object.keys(surgeryDefinitions.diseases).length, 164);
assert.equal(Object.values(surgeryDefinitions.diseases).reduce((n, groups) => n + Object.keys(groups).length, 0), 320);
assert.equal(Object.values(surgeryDefinitions.diseases).flatMap(Object.values).reduce((n, group) => n + group.procedures.length, 0), 1659);
assert.equal(surgeryDefinitions.diseases['010010']['01'].title, '頭蓋内腫瘍摘出術+原発性悪性脳腫瘍光線力学療法加算');
assert.equal(surgeryDefinitions.diseases['010010']['02'].procedures.length, 3);
assert.equal(surgeryDefinitions.diseases['010010']['03'].procedures.length, 14);

const surgeryMdcs = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','18'];
let surgeryDiseases = 0;
for (const mdc of surgeryMdcs) {
  const surgery = JSON.parse(gunzipSync(readFileSync(new URL(`data/surgery/mdc${mdc}.json.gz`, root))));
  assert.equal(surgery.meta.mdc, mdc);
  assert.ok(surgery.diseases.every(d => d.code && d.name && d.labels.length));
  for (const disease of surgery.diseases) {
    for (const label of disease.labels.filter(x => /^0[1-6]$/.test(x))) {
      assert.ok(
        surgeryDefinitions.diseases[disease.code]?.[label],
        `missing surgery definition: ${disease.code} ${label}`,
      );
    }
  }
  assert.ok(Object.values(surgery.hospitals).every(items => items.every(x => Number.isInteger(x[0]) && Array.isArray(x[1]) && Array.isArray(x[2]))));
  surgeryDiseases += surgery.diseases.length;
}
assert.equal(surgeryDiseases, 346);

const diagnosis = JSON.parse(gunzipSync(readFileSync(new URL('data/diagnosis-groups.json.gz', root))));
assert.equal(diagnosis.meta.scope, '全国集計');
assert.equal(diagnosis.rows.length, 3248);
assert.ok(diagnosis.rows.some(x => x.name.includes('脳腫瘍') && x.icd.some(i => i.code.includes('C71'))));
assert.ok(diagnosis.rows.every(x => x.code && x.name && x.mdc));

const historicalDiagnosisCounts = [4557, 4726, 4726];
for (const [index, year] of ['2021','2022','2023'].entries()) {
  const file = new URL(`data/diagnosis/${year}.json.gz.b64`, root);
  assert.ok(readFileSync(file).length < 750000);
  const data = JSON.parse(gunzipSync(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')));
  assert.equal(data.meta.rowSchema, 'v1-array');
  assert.equal(data.rows.length, historicalDiagnosisCounts[index]);
  assert.ok(data.rows.every(row => row.length === 28 && row[0] && row[1] && row[3]));
}

for (const year of ['2021','2022','2023']) {
  let diseaseCount = 0;
  const definitions = JSON.parse(readFileSync(new URL(`data/surgery-definitions-${year}.json`, root)));
  assert.equal(definitions.meta.surveyYear, year);
  assert.match(definitions.meta.source, /^https:\/\/www\.mhlw\.go\.jp\//);
  assert.ok(Object.keys(definitions.diseases).length > 150);
  for (const mdc of surgeryMdcs) {
    const file = new URL(`data/surgery/${year}/mdc${mdc}.json.gz.b64`, root);
    assert.ok(readFileSync(file).length < 750000);
    const data = JSON.parse(gunzipSync(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')));
    assert.equal(data.meta.year, year);
    assert.equal(data.meta.mdc, mdc);
    assert.ok(data.diseases.every(d => d.code && d.name && d.labels.length));
    for (const disease of data.diseases) {
      for (const label of disease.labels.filter(value => /^0[1-6]$/.test(value))) {
        assert.ok(
          definitions.diseases[disease.code]?.[label],
          `missing ${year} surgery definition: ${disease.code} ${label}`,
        );
      }
    }
    assert.ok(Object.values(data.hospitals).every(items => items.every(x => Number.isInteger(x[0]) && Array.isArray(x[1]) && Array.isArray(x[2]))));
    diseaseCount += data.diseases.length;
  }
  assert.equal(diseaseCount, 347);
}
const kCodeCoverageAudit = JSON.parse(readFileSync(new URL('data/kcode-name-coverage-audit.json', root)));
assert.deepEqual(kCodeCoverageAudit.years.map(x => x.year), ['2021','2022','2023','2024']);
assert.deepEqual(kCodeCoverageAudit.years.map(x => x.publishedCodes), [1474,1506,1490,1542]);
assert.deepEqual(kCodeCoverageAudit.years.map(x => x.outsideDefinitionCoverageCodes), [109,122,112,580]);
assert.equal(kCodeCoverageAudit.years.find(x => x.year === '2024').outsideDefinitionCoverageCases, 1671737);
assert.equal(kCodeCoverageAudit.representativeChecks.find(x => x.code === 'K179').status, 'covered');
assert.equal(kCodeCoverageAudit.meta.statusLabels.outsideDefinitionCoverage, 'DPC年度定義表の名称収録対象外');

const deathAreaHistory = JSON.parse(readFileSync(new URL('data/death24h-area-history.json', root)));
assert.equal(deathAreaHistory.rows.length, 1005);
assert.ok(deathAreaHistory.rows.every(row => Number.isInteger(row.death24hPublished) && Number.isInteger(row.death24hSuppressed)));

for (const file of ['index.html','style.css','app.js','provenance.html','research.html']) {
  const text = readFileSync(new URL(file, root), 'utf8');
  assert.ok(text.length > 100);
  assert.doesNotMatch(text, /https?:\/\/(?!www\.mhlw\.go\.jp|municipal-smr\.jp|www\.w3\.org)/, `${file} has an unapproved URL`);
}
const app = readFileSync(new URL('app.js', root), 'utf8');
assert.doesNotThrow(() => new Function(app));
const html = readFileSync(new URL('index.html', root), 'utf8');
assert.match(html, /NDBとは対象と読み方が異なります/);
assert.match(html, /「－」を0に置き換えません/);
assert.match(html, /このタブは全国集計です/);
assert.match(html, /入院後24時間以内死亡/);
assert.match(app, /death24hPublished/);
assert.match(app, /renderHospitalSurgery/);
assert.match(app, /数値公表なし（秘匿セル/);
assert.match(app, /含まれる手術・Kコードを見る/);
assert.match(app, /98.*割り当てられていません/);
assert.match(app, /秘匿を含むため算出不可/);
assert.match(app, /DPC病床100床当たり退院患者/);
assert.match(app, /renderAreaTrend/);
assert.match(app, /令和3～6年度の推移/);
assert.match(app, /renderHospitalHistory/);
assert.match(app, /async function setYear/);
assert.match(app, /year-\$\{year\}\.json\.gz\.b64/);
assert.doesNotMatch(app, /この年度は未収録/);
assert.match(app, /diagnosis\/\$\{year\}\.json\.gz\.b64/);
assert.match(app, /surgery\/\$\{year\}\/mdc\$\{mdc\}\.json\.gz\.b64/);
assert.match(app, /surgery-definitions-\$\{year\}\.json/);
assert.match(app, /選択年度の定義で詳細展開/);
assert.match(app, /疾患・手術・Kコード検索/);
assert.match(app, /surgeryDefinitionHaystack/);
assert.match(app, /function surgeryNameFallback/);
assert.match(app, /DPC年度定義表の名称収録対象外/);
assert.doesNotMatch(app, /年度定義表で名称未特定/);
assert.match(app, /matchingSurgeryDefinitions/);
assert.match(app, /検索語に一致した手術定義/);
assert.match(app, /history\.replaceState/);
assert.match(app, /hospitalPref/);
assert.match(app, /classification/);
assert.match(html, /ページ全体の共通条件/);
assert.match(html, /id="hospital-prefecture"/);
assert.match(html, /id="hospital-more"/);
assert.match(html, /id="hospital-dialog"/);
assert.equal((html.match(/data-hospital-goal=/g) || []).length, 4);
assert.match(app, /fillSelect\(\$\("hospital-prefecture"\), prefectures, ""\)/);
assert.match(app, /hospitalLimit: 50/);
assert.match(app, /nationalHospitals: new Map\(\)/);
assert.match(app, /dialog\.showModal\(\)/);
assert.match(app, /hospitalPref.*all/s);
assert.match(html, /data-year="2021"/);
assert.match(html, /現在表示：令和6年度/);
assert.doesNotMatch(html, /全国検索（令和6年度のみ）/);
assert.match(app, /告示番号・通番だけでは過年度と安全に接続できませんでした/);
assert.match(html, /疾患手術/);
assert.match(html, /研究テーマ別の見方/);
const research = readFileSync(new URL('research.html', root), 'utf8');
assert.match(research, /公表集計では評価できないもの/);
assert.match(research, /未調整値だけで医療の質や病院の優劣を判断できません/);
console.log(JSON.stringify({pass:true, areas:summary.areas.length, hospitals, prefectureFiles:files.length}));
