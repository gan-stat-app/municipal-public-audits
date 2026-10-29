// Recovered from the production bundle.
export const designatedCities = [
  { code:'01100', pref:'01', name:'札幌市', prefixes:['011'] },
  { code:'04100', pref:'04', name:'仙台市', prefixes:['041'] },
  { code:'11100', pref:'11', name:'さいたま市', prefixes:['111'] },
  { code:'12100', pref:'12', name:'千葉市', prefixes:['121'] },
  { code:'14100', pref:'14', name:'横浜市', prefixes:['1410','1411'] },
  { code:'14130', pref:'14', name:'川崎市', prefixes:['1413'] },
  { code:'14150', pref:'14', name:'相模原市', prefixes:['1415'] },
  { code:'15100', pref:'15', name:'新潟市', prefixes:['151'] },
  { code:'22100', pref:'22', name:'静岡市', prefixes:['2210'] },
  { code:'22130', pref:'22', name:'浜松市', prefixes:['2213','2214'] },
  { code:'23100', pref:'23', name:'名古屋市', prefixes:['231'] },
  { code:'26100', pref:'26', name:'京都市', prefixes:['261'] },
  { code:'27100', pref:'27', name:'大阪市', prefixes:['2710','2711','2712'] },
  { code:'27140', pref:'27', name:'堺市', prefixes:['2714'] },
  { code:'28100', pref:'28', name:'神戸市', prefixes:['281'] },
  { code:'33100', pref:'33', name:'岡山市', prefixes:['331'] },
  { code:'34100', pref:'34', name:'広島市', prefixes:['341'] },
  { code:'40100', pref:'40', name:'北九州市', prefixes:['4010'] },
  { code:'40130', pref:'40', name:'福岡市', prefixes:['4013'] },
  { code:'43100', pref:'43', name:'熊本市', prefixes:['431'] },
];

export function designatedCityForWard(areaCode) {
  return designatedCities.find(city => areaCode !== city.code && city.prefixes.some(prefix => areaCode.startsWith(prefix)));
}

export function designatedCityByCode(areaCode) {
  return designatedCities.find(city => city.code === areaCode);
}

export function displayAreaName(areaCode, areaName) {
  const city = designatedCityForWard(areaCode);
  return city && !areaName.startsWith(city.name) ? `${city.name}${areaName}` : areaName;
}

export function designatedCityWardCodes(areaCode, availableCodes=[]) {
  const city=designatedCityByCode(areaCode);if(!city)return[];
  return availableCodes.filter(code=>code!==city.code&&city.prefixes.some(prefix=>code.startsWith(prefix)));
}

export function isSelectedMapArea(selectedCode, featureCode, availableCodes=[]) {
  if(selectedCode===featureCode)return true;
  const wards=designatedCityWardCodes(selectedCode,availableCodes);
  return wards.includes(featureCode);
}
