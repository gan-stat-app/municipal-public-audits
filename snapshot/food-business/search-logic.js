// Only published facility addresses are used for locality filtering.
export const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g, '');
export const searchTerms = query => String(query ?? '').normalize('NFKC').trim().split(/\s+/u).filter(Boolean).map(normalize);
export const matchesTerms = (record, terms) => {
  const text = normalize([record.facility_name, record.facility_address, record.business_type].join(' '));
  return terms.every(term => text.includes(term));
};

export function addressMatches(address, municipality, prefecture) {
  let value = normalize(address);
  const name = normalize(municipality);
  if (!name || !value || /一円|市内|県内|都内|道内|府内|一帯/.test(value)) return false;
  const pref = normalize(prefecture);
  if (pref && value.startsWith(pref)) value = value.slice(pref.length);
  if (value.startsWith(name)) return true;
  value = value.replace(/^[^市区町村]+郡/u, '');
  return value.startsWith(name);
}

export function sourcesForArea(sources, code, areas) {
  if (!code) return sources;
  const name = areas.find(([id]) => id === code)?.[1];
  if (!name) return [];
  // A designated city's wards use the city's publisher. County-wide sources
  // remain candidates; a source's publication area is never inferred from D列.
  const own = sources.filter(s => ['health_center_city_or_ward','health_center_city'].includes(s.publisher_type) &&
    (s.authority_code === code || name.startsWith(s.publisher)));
  return own.length ? own : sources.filter(s => s.publisher_type === 'prefecture' || s.publisher_type === 'prefectural_health_center');
}

export function recommendedSource(sources, kind) {
  return sources.find(s => kind !== 'notification' && s.scope === 'published_permit_registry') ||
    sources.find(s => s.parser === 'ifas') || sources[0];
}

export function sortRecords(records, order) {
  const result = [...records];
  if (order === 'published') return result;
  const collator = new Intl.Collator('ja', { numeric: true });
  return result.sort((a, b) => {
    if (order === 'newest' || order === 'expiry') {
      const field = order === 'newest' ? 'valid_from' : 'valid_until';
      if (!a[field] || !b[field]) return a[field] ? -1 : b[field] ? 1 : 0;
      const dates = a[field].localeCompare(b[field]);
      if (dates) return order === 'newest' ? -dates : dates;
    }
    return collator.compare(a.facility_name || '\uffff', b.facility_name || '\uffff') ||
      collator.compare(a.facility_address, b.facility_address);
  });
}
