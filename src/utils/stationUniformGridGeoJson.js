import { segmentNodeLon, segmentNodeLat } from '@/utils/geojsonRouteHelpers.js';
import { minimalLineStringFeatureCollectionFromRouteExportRows } from '@/utils/mapDrawnRoutesImport.js';

/** 每軸倍率：第一次 4×4＝16 格；之後每軸再 ×4（4→16→64→…） */
const AXIS_SPLIT_FACTOR = 4;
/** 每軸區間數之上限（防爆） */
const MAX_DIVISIONS_PER_AXIS = 16384;

/** @typedef {{ minLon: number, maxLon: number, minLat: number, maxLat: number }} Bounds */

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
 * 軸對齊格線：`divX`／`divY` 為各軸方向之「細分條數」，畫線在條界上（各有 div+1 條）。
 * GeoJSON `[lon]=x 向、[lat]=y 向`（繪圖時 yScale 倒置與資料一致）。
 * @param {Bounds} bounds
 * @param {number} divX
 * @param {number} divY
 */
export function uniformGridLinesForAxisAlignedBounds(bounds, divX, divY) {
  const dx = Math.max(1, Math.floor(Number(divX)) || 1);
  const dy = Math.max(1, Math.floor(Number(divY)) || 1);
  const { minLon, maxLon, minLat, maxLat } = bounds;
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  const features = [];
  let fid = 0;

  for (let i = 0; i <= dx; i++) {
    const x = dx > 0 && spanLon !== 0 ? minLon + (spanLon * i) / dx : minLon + i;
    features.push({
      type: 'Feature',
      id: `ugrid_v_${fid++}`,
      properties: {
        layoutUniformStationGrid: true,
        uniformGridKind: 'meridian',
        uniformGridAxisIndex: i,
        uniformGridDivX: dx,
        uniformGridDivY: dy,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, minLat],
          [x, maxLat],
        ],
      },
    });
  }

  for (let j = 0; j <= dy; j++) {
    const y = dy > 0 && spanLat !== 0 ? minLat + (spanLat * j) / dy : minLat + j;
    features.push({
      type: 'Feature',
      id: `ugrid_h_${fid++}`,
      properties: {
        layoutUniformStationGrid: true,
        uniformGridKind: 'parallel',
        uniformGridAxisIndex: j,
        uniformGridDivX: dx,
        uniformGridDivY: dy,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [minLon, y],
          [maxLon, y],
        ],
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** @param {number} val @param {number} lo @param {number} hi */
function clamp01Axis(val, lo, hi) {
  if (!(hi >= lo)) return lo;
  return Math.min(hi, Math.max(lo, val));
}

/**
 * @param {number} val
 * @param {number} minV
 * @param {number} maxV
 * @param {number} divisions
 * @param {Set<number>} keptStripIndices 0 … divisions-1
 */
export function scalarToCompressedStrips(val, minV, maxV, divisions, keptStripIndices) {
  const div = Math.max(1, Math.floor(Number(divisions)) || 1);
  const span = maxV - minV;
  const w = span > 0 ? span / div : 1e-14;
  const L = span > 0 ? clamp01Axis(val, minV, maxV) : minV;

  let xc = 0;
  let pos = minV;
  for (let i = 0; i < div; i++) {
    const left = pos;
    const right = left + w;
    const keep = keptStripIndices.has(i);

    if (!keep) {
      if (L >= left - 1e-12 && L <= right + 1e-12) {
        return xc;
      }
      pos = right;
      continue;
    }

    if (L < left - 1e-12) {
      return xc;
    }
    if (L <= right + 1e-12) {
      return xc + Math.max(0, Math.min(1, w > 1e-20 ? (L - left) / w : 0));
    }
    xc += 1;
    pos = right;
  }
  return xc;
}

/**
 * `meta`：**wgs84** 模式供後續刪列／列；**compressed** 僅紀錄壓縮後格數。
 * @typedef {{ mode: 'wgs84'; bounds: Bounds; divisionsPerAxis: number } | { mode: 'compressed'; nx: number; ny: number }} LayoutUniformGridMeta
 */

/**
 * 全域均勻切分：每軸先 4（4×4＝16 格），任一格逾 1 站則每軸 ×4 …
 * @param {unknown[]} exportRows
 * @returns {{ geojson: { type:'FeatureCollection', features: unknown[] }, meta: { mode:'wgs84', bounds: Bounds, divisionsPerAxis: number } | null }}
 */
export function buildMapDrawnStationUniformRefinementGridWithMeta(exportRows) {
  const pts = collectLonLatStationsFromMapDrawnExportRows(exportRows);
  if (pts.length === 0) {
    return { geojson: { type: 'FeatureCollection', features: [] }, meta: null };
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

  const meta = {
    mode: /** @type {const} */ ('wgs84'),
    bounds: { ...bounds },
    divisionsPerAxis: divisions,
  };
  const geojson = uniformGridLinesForAxisAlignedBounds(bounds, divisions, divisions);
  return { geojson, meta };
}

/** @deprecated 相容舊呼叫；請用 {@link buildMapDrawnStationUniformRefinementGridWithMeta} */
export function buildMapDrawnStationUniformRefinementGridFeatureCollection(exportRows) {
  return buildMapDrawnStationUniformRefinementGridWithMeta(exportRows).geojson;
}

function copyLonLatPair(p) {
  if (!Array.isArray(p) || p.length < 2) return p;
  return [Number(p[0]), Number(p[1])];
}

/** @param {unknown} node @param {number} lon @param {number} lat */
function writeNodeLonLat(node, lon, lat) {
  if (!node || typeof node !== 'object') return;
  node.lon = lon;
  node.lat = lat;
  if (!node.tags || typeof node.tags !== 'object') node.tags = {};
  node.tags.lon = lon;
  node.tags.lat = lat;
}

/**
 * @param {unknown[]} exportRows mapDrawn 列（會被深拷貝後原地改 lon/lat）
 * @param {Bounds} bounds
 * @param {number} divisions
 * @param {Set<number>} keptCols
 * @param {Set<number>} keptRows
 */
export function remapMapDrawnExportRowsToCompressedStrips(
  exportRows,
  bounds,
  divisions,
  keptCols,
  keptRows
) {
  /** @type {unknown[]} */
  const rows = JSON.parse(JSON.stringify(Array.isArray(exportRows) ? exportRows : []));
  const div = Math.max(1, Math.floor(Number(divisions)) || 1);

  /** @param {number} lon @param {number} lat */
  const toXY = (lon, lat) => {
    const cx = scalarToCompressedStrips(lon, bounds.minLon, bounds.maxLon, div, keptCols);
    const cy = scalarToCompressedStrips(lat, bounds.minLat, bounds.maxLat, div, keptRows);
    return [cx, cy];
  };

  const remapCoordsPair = (pair) => {
    const cc = copyLonLatPair(pair);
    if (!cc || cc.length < 2) return pair;
    const lo = Number(cc[0]);
    const la = Number(cc[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(la)) return pair;
    return toXY(lo, la);
  };

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const seg = row.segment;
    if (seg && typeof seg === 'object') {
      const applyNode = (n) => {
        if (!n || typeof n !== 'object') return;
        const lo = segmentNodeLon(n);
        const la = segmentNodeLat(n);
        if (!Number.isFinite(lo) || !Number.isFinite(la)) return;
        const [cx, cy] = toXY(lo, la);
        writeNodeLonLat(n, cx, cy);
      };
      applyNode(seg.start);
      for (const st of seg.stations || []) applyNode(st);
      applyNode(seg.end);
    }
    const rc = row.routeCoordinates;
    if (Array.isArray(rc) && rc.length === 3) {
      const [a, bends, b] = rc;
      row.routeCoordinates = [remapCoordsPair(a), (Array.isArray(bends) ? bends : []).map(remapCoordsPair), remapCoordsPair(b)];
    }
  }
  return rows;
}

/**
 * @param {unknown[]} exportRows
 * @param {{ bounds: Bounds; divisionsPerAxis: number }} wgsMeta
 */
export function computeOccupiedColRowSetsFromStations(exportRows, wgsMeta) {
  const pts = collectLonLatStationsFromMapDrawnExportRows(exportRows);
  const { bounds, divisionsPerAxis: divRaw } = wgsMeta;
  const divisions = Math.max(1, Math.floor(Number(divRaw)) || 1);
  const cols = new Set();
  const rowsSt = new Set();

  for (const p of pts) {
    const parts = cellKeyForPoint(p, bounds, divisions).split(',');
    const ix = Number(parts[0]);
    const iy = Number(parts[1]);
    if (Number.isFinite(ix)) cols.add(ix);
    if (Number.isFinite(iy)) rowsSt.add(iy);
  }
  return { keptCols: cols, keptRows: rowsSt };
}

/**
 * json 繪製圖層：刪掉「整段 col／row都無任何站」之條後，將 jsonData／格線重整到壓縮座標。
 * @param {{ jsonData?: unknown[], dataJson?: unknown[], geojsonData?: unknown, layoutUniformGridGeoJson?: unknown, layoutUniformGridMeta?: LayoutUniformGridMeta|null }} layer
 * @returns {{ nx: number, ny: number } | null}
 */
export function applyLayoutViewerCompressEmptyBands(layer) {
  if (!layer || typeof layer !== 'object') return null;
  const meta = layer.layoutUniformGridMeta;
  if (!meta || meta.mode !== 'wgs84' || !meta.bounds || !Number.isFinite(meta.divisionsPerAxis)) {
    return null;
  }
  const rows = layer.jsonData ?? layer.dataJson;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const { bounds, divisionsPerAxis } = meta;
  const div = Math.max(1, Math.floor(Number(divisionsPerAxis)));

  /** 任一列／欄帶只要有站就保留（其餘整條刪除） */
  const fromPts = computeOccupiedColRowSetsFromStations(rows, meta);
  const keptColsSet = fromPts.keptCols;
  const keptRowsSet = fromPts.keptRows;

  const nx = keptColsSet.size;
  const ny = keptRowsSet.size;
  if (nx < 1 || ny < 1) return null;

  const newRows = remapMapDrawnExportRowsToCompressedStrips(
    rows,
    bounds,
    div,
    keptColsSet,
    keptRowsSet
  );

  layer.jsonData = newRows;
  layer.dataJson = newRows;

  layer.geojsonData = minimalLineStringFeatureCollectionFromRouteExportRows(newRows, {
    stationPoints: 'endpoints',
    routeLine: 'endpoints',
  });

  layer.layoutUniformGridGeoJson = uniformGridLinesForAxisAlignedBounds(
    { minLon: 0, maxLon: nx, minLat: 0, maxLat: ny },
    nx,
    ny
  );

  layer.layoutUniformGridMeta = {
    mode: /** @type {const} */ ('compressed'),
    nx,
    ny,
    sourceDivisions: div,
  };

  return { nx, ny };
}
