// Presentation only: keep numeric calculation and download values unchanged.
export function formatExpected(value) {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.1) return '0.1未満';
  return value.toLocaleString('ja-JP', {minimumFractionDigits: 1, maximumFractionDigits: 1});
}

export function trendDisplay(items, official = false) {
  const points = items.map((item, index) => ({...item, index, v: official ? item.value : item.smr}));
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (!Number.isFinite(point.v)) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else {
      const previous = segment.at(-1);
      if (!official && previous && point.year !== previous.year + 1) {
        segments.push(segment);
        segment = [];
      }
      segment.push(point);
    }
  }
  if (segment.length) segments.push(segment);
  const first = points[0]?.year, last = points.at(-1)?.year;
  const fraction = point => !official && Number.isFinite(first) && Number.isFinite(last)
    ? (first === last ? 0.5 : (point.year - first) / (last - first))
    : (points.length <= 1 ? 0.5 : point.index / (points.length - 1));
  return {points, segments, fraction};
}
