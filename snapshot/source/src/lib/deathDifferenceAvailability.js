const causeCodes=new Set(['Se00','Se02','Se04','Se07','Se10','Se16','Se17','Se21','Se23','Se24','Se26','Se27','Se29','Se30','Se31','Se34','SeCO','SeIH']);
export function availability(q) {
  if(q.mode !== 'arbitrary' || q.basis !== 'juki') return '任意期間SMRの住民基本台帳人口方式で表示できます。';
  if(q.startYear < 2015 || q.endYear > 2024) return '年齢別データの対応期間は2015～2024年です。期間を変更すると表示できます。';
  if(q.regionUnit==='medical-area' && q.datasetCode!=='Se00') return '2次医療圏は全死因のみ対応しています。構成市区町村の公表表に死因別・年齢別の死亡数がないため、死因別の死亡数差ピラミッドは計算できません。全年齢合計の死因別SMR・観察死亡数・期待死亡数は確認できます。';
  if(q.datasetCode !== 'Se00' && !/^\d{2}000$/.test(q.areaCode)) return '市区町村は全死因のみ対応しています。使用する公表表に「死因×性別×年齢階級」の死亡数がないため、死因別の年齢別死亡数差は計算できません。全年齢合計の死因別SMR・観察死亡数・期待死亡数は確認できます。';
  if(!causeCodes.has(q.datasetCode)) return '選択した死因には対応していません。';
  return '';
}
