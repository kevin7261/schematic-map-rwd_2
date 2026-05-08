import { segmentNodeLon, segmentNodeLat } from '@/utils/geojsonRouteHelpers.js';

/** 每軸倍率：第一次 4×4＝16 格；之後 16×16…（每軸 4→16→64→…） */
const AXIS_SPLIT_FACTOR = 4;
/** 每軸區間數之上限（防爆） */
const MAX_DIVISIONS_PER_AXIS = 16384;

/**
 * @param {unknown[]} rows — 路段匯出列（segment.start／stations／end 含經緯度）
 * @returns {{ lon: number, lat: number }[]}
 */
export function collectLonLatStationsFromMapDrawnExportRows(rows) {
  const out = [];
  if (!Array.isArray(rows)) return out;

  const addNode = (n) => {
    if (!n || typeof n !== 'object') return;
    const lon = segmentNodeLon(n);
    const lat = segmentNodeLat(n);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    out.push({ lon, lat });
  };

  for (const row of rows) {
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') continue;
    addNode(seg.start);
    for (const st of seg.stations || []) addNode(st);
    addNode(seg.end);
  }
  return out;
}

/** @typedef {{ minLon: number, maxLon: number, minLat: number, maxLat: number }} Bounds */

export function paddedRootBoundsForStations(stations) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of stations) {
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  const w = Math.max(maxLon - minLon, 1e-14);
  const h = Math.max(maxLat - minLat, 1e-14);
  const mlon = Math.max(w * 0.025, 1e-10);
  const mlat = Math.max(h * 0.025, 1e-10);

  let r = {
    minLon: minLon - mlon,
    maxLon: maxLon + mlon,
    minLat: minLat - mlat,
    maxLat: maxLat + mlat,
  };
  const spanLon = r.maxLon - r.minLon;
  const spanLat = r.maxLat - r.minLat;
  const extra = Math.max(spanLon, spanLat) - Math.min(spanLon, spanLat);
  if (extra > 0 && spanLon < spanLat) {
    r = {
      ...r,
      minLon: r.minLon - extra / 2,
      maxLon: r.maxLon + extra / 2,
    };
  } else if (extra > 0 && spanLon > spanLat) {
    r = {
      ...r,
      minLat: r.minLat - extra / 2,
      maxLat: r.maxLat + extra / 2,
    };
  }
  return r;
}

/**
 * @param {{ lon:number,lat:number }} p
 * @param {Bounds} b
 * @param {number} divisions 每軸等分數（格線有 divisions+1 條）
 */
function cellKeyForPoint(p, b, divisions) {
  const spanLon = b.maxLon - b.minLon;
  const spanLat = b.maxLat - b.minLat;
  const div = Math.max(1, Math.floor(divisions));
  let ix = 0;
  let iy = 0;
  if (spanLon > 0) {
    const t = ((p.lon - b.minLon) / spanLon) * div;
    ix = Math.floor(t);
    if (ix >= div) ix = div - 1;
    if (ix < 0) ix = 0;
  }
  if (spanLat > 0) {
    const t = ((p.lat - b.minLat) / spanLat) * div;
    iy = Math.floor(t);
    if (iy >= div) iy = div - 1;
    if (iy < 0) iy = 0;
  }
  return `${ix},${iy}`;
}

/**
 * 由最終每軸 divisions 產生（divisions+1）條縱線＋（divisions+1）條橫線
 * @param {Bounds} bounds
 * @param {number} divisions
 */
export function uniformGridLinesFeatureCollection(bounds, divisions) {
  const div = Math.max(1, Math.floor(divisions));
  const { minLon, maxLon, minLat, maxLat } = bounds;
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  const features = [];
  let fid = 0;

  for (let i = 0; i <= div; i++) {
    const lon = minLon + (spanLon * i) / div;
    features.push({
      type: 'Feature',
      id: `ugrid_v_${fid++}`,
      properties: {
        layoutUniformStationGrid: true,
        uniformGridKind: 'meridian',
        uniformGridIndex: i,
        uniformGridDivisions: div,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, minLat],
          [lon, maxLat],
        ],
      },
    });
  }

  for (let j = 0; j <= div; j++) {
    const lat = minLat + (spanLat * j) / div;
    features.push({
      type: 'Feature',
      id: `ugrid_h_${fid++}`,
      properties: {
        layoutUniformStationGrid: true,
        uniformGridKind: 'parallel',
        uniformGridIndex: j,
        uniformGridDivisions: div,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [minLon, lat],
          [maxLon, lat],
        ],
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * 全域均勻切分：每軸先 4 段（4×4＝16 格），若任一格超過 1 站則每軸再 ×4，直到每格至多一站或達上限。
 *
 * @param {unknown[]} exportRows
 * @returns {{ type:'FeatureCollection', features: unknown[] }}
 */
export function buildMapDrawnStationUniformRefinementGridFeatureCollection(exportRows) {
  const pts = collectLonLatStationsFromMapDrawnExportRows(exportRows);
  if (pts.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const bounds = paddedRootBoundsForStations(pts);
  let divisions = AXIS_SPLIT_FACTOR;

  while (divisions <= MAX_DIVISIONS_PER_AXIS) {
    const counts = new Map();
    for (const p of pts) {
      const k = cellKeyForPoint(p, bounds, divisions);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let maxInCell = 0;
    for (const c of counts.values()) {
      if (c > maxInCell) maxInCell = c;
    }
    if (maxInCell <= 1) break;
    const next = divisions * AXIS_SPLIT_FACTOR;
    if (next > MAX_DIVISIONS_PER_AXIS) break;
    divisions = next;
  }

  return uniformGridLinesFeatureCollection(bounds, divisions);
}
