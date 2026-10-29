export function mapScopeForArea(areaCode){
  if(!/^\d{5}$/.test(String(areaCode??'')))throw new Error(`Invalid area code: ${areaCode}`);
  return String(areaCode).endsWith('000')?'national':'prefecture';
}

export function isPrefectureWide(areaCode){
  return mapScopeForArea(areaCode)==='national';
}

export function mapViewportFeatures(features,scope,selectedCode){
  if(scope.startsWith('national')||scope==='medical-area')return features;
  const pref=selectedCode.slice(0,2),visible=features.filter(f=>f.properties.area_code.startsWith(pref));
  if(scope!=='medical-prefecture'||pref!=='13')return visible;
  // Tokyo's island medical area spans Izu and Ogasawara. Split display geometry
  // into inset zones while retaining the original medical-area selection code.
  return visible.flatMap(f=>{
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    const zones=new Map();
    for(const polygon of polygons){
      let maxLat=-Infinity;
      for(const ring of polygon)for(const point of ring)maxLat=Math.max(maxLat,point[1]);
      const zone=maxLat>=35.3?'mainland':maxLat>=30.5?'izu':'ogasawara';
      if(!zones.has(zone))zones.set(zone,[]);zones.get(zone).push(polygon);
    }
    return [...zones].map(([zone,coordinates])=>({...f,properties:{...f.properties,inset_zone:zone},geometry:{type:'MultiPolygon',coordinates}}));
  });
}
