// Selected death classification Se01–Se34, all deaths and two preserved composites.
// Official datasets retain their separate legacy code meanings, including Se18=heart failure.
// Keep dataset codes stable because they are part of URL and data-file compatibility.

export const arbitraryCauses = [
  [
    "Se00",
    "全死因"
  ],
  [
    "Se01",
    "結核"
  ],
  [
    "Se02",
    "悪性新生物＜腫瘍＞"
  ],
  [
    "Se03",
    "食道の悪性新生物＜腫瘍＞"
  ],
  [
    "Se04",
    "胃の悪性新生物＜腫瘍＞"
  ],
  [
    "Se05",
    "結腸の悪性新生物＜腫瘍＞"
  ],
  [
    "Se06",
    "直腸Ｓ状結腸移行部及び直腸の悪性新生物＜腫瘍＞"
  ],
  [
    "Se07",
    "肝及び肝内胆管の悪性新生物＜腫瘍＞"
  ],
  [
    "Se08",
    "胆のう及びその他の胆道の悪性新生物＜腫瘍＞"
  ],
  [
    "Se09",
    "膵の悪性新生物＜腫瘍＞"
  ],
  [
    "Se10",
    "気管，気管支及び肺の悪性新生物＜腫瘍＞"
  ],
  [
    "Se11",
    "乳房の悪性新生物＜腫瘍＞"
  ],
  [
    "Se12",
    "子宮の悪性新生物＜腫瘍＞"
  ],
  [
    "Se13",
    "白血病"
  ],
  [
    "Se14",
    "糖尿病"
  ],
  [
    "Se15",
    "高血圧性疾患"
  ],
  [
    "Se16",
    "心疾患（高血圧性を除く）"
  ],
  [
    "Se17",
    "急性心筋梗塞"
  ],
  [
    "Se18",
    "その他の虚血性心疾患"
  ],
  [
    "Se19",
    "不整脈及び伝導障害"
  ],
  [
    "Se20",
    "心不全"
  ],
  [
    "Se21",
    "脳血管疾患"
  ],
  [
    "Se22",
    "くも膜下出血"
  ],
  [
    "Se23",
    "脳内出血"
  ],
  [
    "Se24",
    "脳梗塞"
  ],
  [
    "Se25",
    "大動脈瘤及び解離"
  ],
  [
    "Se26",
    "肺炎"
  ],
  [
    "Se27",
    "慢性閉塞性肺疾患"
  ],
  [
    "Se28",
    "喘息"
  ],
  [
    "Se29",
    "肝疾患"
  ],
  [
    "Se30",
    "腎不全"
  ],
  [
    "Se31",
    "老衰"
  ],
  [
    "Se32",
    "不慮の事故"
  ],
  [
    "Se33",
    "交通事故"
  ],
  [
    "Se34",
    "自殺"
  ],
  [
    "SeCO",
    "大腸の悪性新生物＜腫瘍＞"
  ],
  [
    "SeIH",
    "虚血性心疾患"
  ]
];

export const officialCauses = [
  ['Se00', '全死因'],
  ['Se02', '悪性新生物'],
  ['Se04', '胃の悪性新生物'],
  ['SeCO', '大腸の悪性新生物'],
  ['Se07', '肝及び肝内胆管の悪性新生物'],
  ['Se10', '気管・気管支・肺の悪性新生物'],
  ['Se16', '心疾患（高血圧性を除く）'],
  ['Se17', '急性心筋梗塞'],
  ['Se18', '心不全'],
  ['Se21', '脳血管疾患'],
  ['Se23', '脳内出血'],
  ['Se24', '脳梗塞'],
  ['Se26', '肺炎'],
  ['Se29', '肝疾患'],
  ['Se30', '腎不全'],
  ['Se31', '老衰'],
  ['Se32', '不慮の事故'],
  ['Se34', '自殺'],
];

export const arbitraryCauseMap = new Map(arbitraryCauses);
export const officialCauseMap = new Map(officialCauses);


export const legacyArbitraryCodes = new Set(['Se00','Se02','Se04','Se07','Se10','Se16','Se17','Se21','Se23','Se24','Se26','Se27','Se29','Se30','Se31','Se34','SeCO','SeIH']);
export function causeAvailability(q) {
  if(q.mode === 'official') return officialCauseMap.has(q.datasetCode) ? '' : 'この死因の国公式5年値は公表資料に収録されていません。';
  if(!arbitraryCauseMap.has(q.datasetCode)) return '選択した死因は選択死因分類にありません。';
  if(q.datasetCode === 'Se12' && q.sex !== '女') return '子宮の悪性新生物のSMRは女性を選択してください。男性の非該当値をゼロには置き換えません。';
  if(q.dataRevision === 'rebuilt') return q.startYear >= 1999 && q.endYear <= 2024 ? '' : '対応期間は1999～2024年です。';
  if(!legacyArbitraryCodes.has(q.datasetCode)) {
    if(q.basis !== 'juki') return 'この死因の国勢調査方式は人口入力の確認中です。住民基本台帳人口方式を選択すると表示できます。';
    if(q.startYear < 2015 || q.endYear > 2024) return 'この死因の検証済み対応期間は2015～2024年です。期間を変更すると表示できます。';
  }
  return '';
}
export function causeForMode(code, from, to) {
  if(from === to) return code;
  if(to === 'official') return code === 'Se20' ? 'Se18' : code !== 'Se18' && officialCauseMap.has(code) ? code : 'Se00';
  return code === 'Se18' ? 'Se20' : arbitraryCauseMap.has(code) ? code : 'Se00';
}
