// Recovered from production bundle formal-app-Bczh_25D.js (function me).
export const smrMapThresholds = [80, 90, 95, 105, 110, 120];
export const smrMapPalette = ['#155b83','#4f8fb3','#a8c8d8','#ece7db','#efc0ad','#d97c63','#a83f46'];
export const smrMapNoData = '#d7dde3';
export const smrMapExcluded = '#c8cfd6';
export const smrMapLegend = ['80未満','80–90','90–95','95–105','105–110','110–120','120以上'];
export const significancePalette = {high:'#b33b45',neutral:'#aab4ba',low:'#287da3',missing:'#d7dde3'};

export function productionSmrFill(smr, rankingEligible=true){
  if(smr==null || !Number.isFinite(smr)) return smrMapNoData;
  if(!rankingEligible) return smrMapExcluded;
  if(smr<80) return smrMapPalette[0];
  if(smr<90) return smrMapPalette[1];
  if(smr<95) return smrMapPalette[2];
  if(smr<105) return smrMapPalette[3];
  if(smr<110) return smrMapPalette[4];
  if(smr<120) return smrMapPalette[5];
  return smrMapPalette[6];
}

export function significanceFill({smr,ci95Low,ci95High,ranking_eligible=true}={}){
  if(smr==null||!Number.isFinite(smr)||!Number.isFinite(ci95Low)||!Number.isFinite(ci95High))return significancePalette.missing;
  if(!ranking_eligible)return smrMapExcluded;
  if(ci95Low>100)return significancePalette.high;
  if(ci95High<100)return significancePalette.low;
  return significancePalette.neutral;
}
