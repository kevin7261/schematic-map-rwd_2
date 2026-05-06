/**
 * 測試_4 taipei_sn4_a：將 Sn4 手繪折線／標記以與載入 GeoJSON 相同之 way／node 形狀附加至 layer.geojsonData。
 * 與 MapTab／networkDrawSketchToSpaceNetworkSegments 之 taipei 形狀一致（扁平 properties + element_type）。
 */

import { getNetworkDrawRouteColor } from '@/utils/networkDrawSketchPalette.js';
import { isGeoJsonWayLineFeature } from '@/utils/geojsonRouteHelpers.js';

const GEO_XY_KEY_SCALE = 1e6;
/** @param {{ x: number; y: number }} p — x=經度, y=緯度 */
const geoXYKey = (p) =>
  `${Math.round(p.x * GEO_XY_KEY_SCALE) / GEO_XY_KEY_SCALE},${
    Math.round(p.y * GEO_XY_KEY_SCALE) / GEO_XY_KEY_SCALE
  }`;

/**
 * @param {number[][] | null | undefined} coords LineString coordinates [lng, lat][]
 * @returns {Array<{ x: number; y: number }> | null}
 */
function lineCoordsToXYPolyline(coords) {
  if (!Array.isArray(coords)) return null;
  /** @type {Array<{ x: number; y: number }>} */
  const pl = [];
  for (const c of coords) {
    const x = Number(c?.[0]);
    const y = Number(c?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = pl[pl.length - 1];
    if (prev && Math.abs(prev.x - x) < 1e-12 && Math.abs(prev.y - y) < 1e-12) continue;
    pl.push({ x, y });
  }
  return pl.length >= 2 ? pl : null;
}

/**
 * Feature 清單中辨識為 way 線者 → WGS84 折線（與手繪 polyline 同格式），含載入之底圖路網。
 *
 * @param {object[] | null | undefined} features
 * @returns {Array<Array<{ x: number; y: number }>>}
 */
export function extractWayPolylinesWgs84FromGeojsonFeatures(features) {
  /** @type {Array<Array<{ x: number; y: number }>>} */
  const out = [];
  for (const f of features || []) {
    if (!isGeoJsonWayLineFeature(f)) continue;
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') {
      const pl = lineCoordsToXYPolyline(g.coordinates);
      if (pl) out.push(pl);
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      for (const ring of g.coordinates) {
        const pl = lineCoordsToXYPolyline(ring);
        if (pl) out.push(pl);
      }
    }
  }
  return out;
}

/**
 * @param {{ x: number; y: number }} a
 * @param {{ x: number; y: number }} b
 * @param {{ x: number; y: number }} c
 * @param {{ x: number; y: number }} d
 * @returns {{ pt: { x: number; y: number } } | null}
 */
function segIntersectSegmentsXY(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  const EPS = 1e-10;
  if (Math.abs(denom) < EPS) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { pt: { x: a.x + t * rx, y: a.y + t * ry } };
}

/**
 * 若干折線之頭尾與線段交叉點（去重）；緯度優先排序後供車站編號。
 * type：線段交叉為 intersection；兩條以上折線共端或封閉折線同端點亦為 intersection；其餘端點為 terminal。
 *
 * @param {Array<Array<{ x: number; y: number }>> | null | undefined} polylinesWgs84
 * @returns {Array<{ x: number; y: number; type: 'terminal' | 'intersection' }>}
 */
export function collectSn4SketchJunctionTerminalStationPoints(polylinesWgs84) {
  const list = (polylinesWgs84 || []).filter((pl) => pl && pl.length >= 2);
  if (!list.length) return [];

  /** 同一座標作為「折線起或迄」被計入的次數（共端 ≥2 → intersection） */
  const endpointHitCount = new Map();
  const bumpEndpointKey = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const k = geoXYKey({ x, y });
    endpointHitCount.set(k, (endpointHitCount.get(k) || 0) + 1);
  };
  for (const pl of list) {
    bumpEndpointKey(pl[0].x, pl[0].y);
    bumpEndpointKey(pl[pl.length - 1].x, pl[pl.length - 1].y);
  }

  const keys = new Set();
  /** @type {Array<{ x: number; y: number }>} */
  const acc = [];
  const crossingKeys = new Set();
  const tryAdd = (x, y, isCrossing) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const q = { x, y };
    const k = geoXYKey(q);
    if (isCrossing) crossingKeys.add(k);
    if (keys.has(k)) return;
    keys.add(k);
    acc.push(q);
  };

  for (const pl of list) {
    tryAdd(pl[0].x, pl[0].y, false);
    tryAdd(pl[pl.length - 1].x, pl[pl.length - 1].y, false);
  }

  /** @type {Array<{ pi: number; si: number; a: { x: number; y: number }; b: { x: number; y: number } }>} */
  const segs = [];
  for (let pi = 0; pi < list.length; pi++) {
    const pts = list[pi];
    for (let si = 0; si < pts.length - 1; si++) {
      segs.push({ pi, si, a: pts[si], b: pts[si + 1] });
    }
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i];
      const B = segs[j];
      if (A.pi === B.pi && Math.abs(A.si - B.si) <= 1) continue;
      const hit = segIntersectSegmentsXY(A.a, A.b, B.a, B.b);
      if (!hit) continue;
      tryAdd(hit.pt.x, hit.pt.y, true);
    }
  }

  acc.sort((p, q) => (p.y !== q.y ? p.y - q.y : p.x - q.x));
  return acc.map((p) => {
    const k = geoXYKey(p);
    const isCross = crossingKeys.has(k);
    const endHits = endpointHitCount.get(k) || 0;
    const type =
      isCross || endHits >= 2 ? 'intersection' : 'terminal';
    return { x: p.x, y: p.y, type };
  });
}

/**
 * @param {number} idOffset 已由 appendSn4SketchMarkerNodes 使用之筆數
 * @param {Array<Array<{ x: number; y: number }>>} polylinesWgs84
 */
export function buildSn4AutoSketchStationFeatures(idOffset, polylinesWgs84) {
  const pts = collectSn4SketchJunctionTerminalStationPoints(polylinesWgs84);
  /** @type {object[]} */
  const feats = [];
  let i = 0;
  for (const pt of pts) {
    i += 1;
    const label = `車站${i}`;
    feats.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [pt.x, pt.y],
      },
      properties: {
        osm_id: String(-(7_100_000 + idOffset + i)),
        element_type: 'node',
        station_id: label,
        station_name: label,
        type: pt.type,
        sketch_sn4: true,
        sketch_sn4_auto_station: true,
      },
    });
  }
  return feats;
}

/** @returns {string} #RRGGBB */
export function randomSketchRouteColorHex() {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** 與 sketchPolylinesWgs84ToGeoJsonFeatureCollection 之 node meta 一致 */
const SKETCH_MARKER_NODE_META = {
  red: { station_id: 'HD_X', station_name: '交叉點' },
  blue: { station_id: 'HD_E', station_name: '懸空端' },
  green: { station_id: 'HD_J', station_name: '相接端' },
  station: { station_id: 'HD_S', station_name: '加註站點' },
};

/**
 * @param {{ red?: Array<{x:number,y:number}>, blue?: Array, green?: Array, station?: Array }|null|undefined} markersWgs84
 * @param {object[]} outFeatures
 */
function appendSn4SketchMarkerNodes(markersWgs84, outFeatures) {
  if (!markersWgs84 || typeof markersWgs84 !== 'object') return;
  let m = 0;
  const kinds = ['red', 'blue', 'green', 'station'];
  for (const kind of kinds) {
    const meta = SKETCH_MARKER_NODE_META[kind];
    const arr = markersWgs84[kind];
    for (const p of arr || []) {
      const lng = Number(p?.x);
      const lat = Number(p?.y);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      m += 1;
      outFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        properties: {
          osm_id: String(-(7_100_000 + m)),
          element_type: 'node',
          station_id: meta.station_id,
          station_name: meta.station_name,
          sketch_sn4: true,
        },
      });
    }
  }
}

function num(v) {
  return Number(v ?? 0);
}

/** 與 geojsonExportRouteSegments／手繪分頁內插一致（度）；略寬以涵蓋貼線與浮點 */
const STATION_ON_WAY_MAX_DIST_SQ = (5e-5) * (5e-5);

function paramAlongSegment01LngLat(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-22) return 0;
  return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
}

function distPointToClosedSegmentSqLngLat(ax, ay, bx, by, px, py) {
  const t = paramAlongSegment01LngLat(ax, ay, bx, by, px, py);
  const qx = ax + t * (bx - ax);
  const qy = ay + t * (by - ay);
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

function flattenWayCoordRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates];
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.filter((ring) => Array.isArray(ring) && ring.length >= 2);
  }
  return [];
}

function minDistSqPointToWayRings(rings, lng, lat) {
  let best = Infinity;
  for (const ring of rings) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const d = distPointToClosedSegmentSqLngLat(
        num(a[0]),
        num(a[1]),
        num(b[0]),
        num(b[1]),
        lng,
        lat
      );
      if (d < best) best = d;
    }
  }
  return best;
}

/** 沿路排序：環序 + 弧長位置（MultiLineString 各環分段） */
function projectionSortKeyAlongRings(rings, lng, lat) {
  let bestKey = Infinity;
  let bestD = Infinity;
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    if (ring.length < 2) continue;
    let cumulative = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const ax = num(a[0]);
      const ay = num(a[1]);
      const bx = num(b[0]);
      const by = num(b[1]);
      const segLen = Math.hypot(bx - ax, by - ay);
      const t = paramAlongSegment01LngLat(ax, ay, bx, by, lng, lat);
      const d = distPointToClosedSegmentSqLngLat(ax, ay, bx, by, lng, lat);
      const s = cumulative + Number(t) * segLen;
      const key = ri * 1e15 + s;
      if (d < bestD) {
        bestD = d;
        bestKey = key;
      }
      cumulative += segLen;
    }
  }
  return bestKey;
}

function stationEntryKeyFromObj(s) {
  const lng = num(s.lng ?? s.x);
  const lat = num(s.lat ?? s.y);
  return `${lng.toFixed(9)},${lat.toFixed(9)}`;
}

/**
 * 將手繪「加黑點站」（HD_S Point）對應到最近之路線，並寫入各 way 之 properties.stations
 * （JSON 分頁可見；與 segment.stations 之中段站語意一致）。
 *
 * @param {object[]} features — 即將寫入之 FeatureCollection.features
 */
export function distributeBlackStationMarkersToWayProperties(features) {
  if (!Array.isArray(features)) return;

  /** @type {{ feature: object, rings: number[][] }[]} */
  const wayEntries = [];
  for (const f of features) {
    if (!isGeoJsonWayLineFeature(f)) continue;
    const rings = flattenWayCoordRings(f.geometry).filter((r) => r.length >= 2);
    if (!rings.length) continue;
    f.properties = f.properties && typeof f.properties === 'object' ? f.properties : {};
    const prev = Array.isArray(f.properties.stations) ? [...f.properties.stations] : [];
    if (f.properties.sketch_sn4_way) {
      f.properties.stations = [];
    } else {
      f.properties.stations = prev;
    }
    wayEntries.push({ feature: f, rings });
  }

  const stationMeta = SKETCH_MARKER_NODE_META.station;
  /** @type {{ lng: number; lat: number; station_id: string; station_name: string }[]} */
  const blackMarkers = [];
  for (const f of features) {
    const p = f.properties;
    if (!p?.sketch_sn4 || p.sketch_sn4_way) continue;
    if (p.station_id !== stationMeta.station_id) continue;
    if (f.geometry?.type !== 'Point') continue;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = num(c[0]);
    const lat = num(c[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    blackMarkers.push({
      lng,
      lat,
      station_id: String(p.station_id ?? stationMeta.station_id),
      station_name: String(p.station_name ?? stationMeta.station_name),
    });
  }

  for (const bm of blackMarkers) {
    let best = null;
    let bestD = STATION_ON_WAY_MAX_DIST_SQ;
    for (const w of wayEntries) {
      const d = minDistSqPointToWayRings(w.rings, bm.lng, bm.lat);
      if (d <= bestD) {
        bestD = d;
        best = w;
      }
    }
    if (!best) continue;
    const arr = best.feature.properties.stations;
    const k = stationEntryKeyFromObj(bm);
    if (arr.some((x) => stationEntryKeyFromObj(x) === k)) continue;
    arr.push({
      lng: bm.lng,
      lat: bm.lat,
      station_id: bm.station_id,
      station_name: bm.station_name,
    });
  }

  for (const w of wayEntries) {
    const arr = w.feature.properties.stations;
    if (arr.length <= 1) continue;
    arr.sort(
      (a, b) =>
        projectionSortKeyAlongRings(w.rings, num(a.lng ?? a.x), num(a.lat ?? a.y)) -
        projectionSortKeyAlongRings(w.rings, num(b.lng ?? b.x), num(b.lat ?? b.y))
    );
    const deduped = [];
    let prevK = null;
    for (const s of arr) {
      const kk = stationEntryKeyFromObj(s);
      if (kk === prevK) continue;
      prevK = kk;
      deduped.push(s);
    }
    w.feature.properties.stations = deduped;
  }
}

/**
 * @param {Array<Array<{ x: number, y: number }>>} polylines
 * @param {string[]} strokeColorsHex — 與 polylines 同序，長度不足處補隨機色
 */
function buildSn4SketchWayFeatures(polylines, strokeColorsHex) {
  const features = [];
  let idx = 0;
  for (let i = 0; i < (polylines || []).length; i++) {
    const pl = polylines[i];
    if (!pl || pl.length < 2) continue;
    const coordinates = pl
      .map((p) => {
        const lng = Number(p?.x);
        const lat = Number(p?.y);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        return [lng, lat];
      })
      .filter(Boolean);
    const compact = [];
    for (const c of coordinates) {
      const prev = compact[compact.length - 1];
      if (
        prev &&
        Math.abs(prev[0] - c[0]) < 1e-12 &&
        Math.abs(prev[1] - c[1]) < 1e-12
      ) {
        continue;
      }
      compact.push(c);
    }
    if (compact.length < 2) continue;
    idx += 1;
    const color =
      strokeColorsHex &&
      strokeColorsHex[i] != null &&
      String(strokeColorsHex[i]).trim() !== ''
        ? strokeColorsHex[i]
        : getNetworkDrawRouteColor(i);
    const routeLabel = `路線${idx}`;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: compact,
      },
      properties: {
        osm_id: String(-(900_000 + idx)),
        element_type: 'way',
        color,
        railway: 'subway',
        route_company: 'unknow',
        route_id: routeLabel,
        route_name: routeLabel,
        sketch_sn4: true,
        sketch_sn4_way: true,
        sketch_sn4_stroke_index: i,
      },
    });
  }
  return features;
}

/**
 * 自 geojsonData 移除先前附加之 sketch_sn4 要素，再附上目前手繪 way／node。
 *
 * @param {{ geojsonData?: { type?: string, features?: object[] } } | null} layer — taipei_sn4_a
 * @param {Array<Array<{ x: number, y: number }>>} polylinesWgs84
 * @param {{ red?: Array<{x:number,y:number}>, blue?: Array, green?: Array, station?: Array } | null} markersWgs84
 * @param {string[]} strokeColorsHex
 */
export function mergeSn4SketchIntoTaipeiSn4AGeojson(layer, polylinesWgs84, markersWgs84, strokeColorsHex) {
  if (!layer || layer.layerId !== 'taipei_sn4_a') return;

  const prev = layer.geojsonData;
  const existing = Array.isArray(prev?.features) ? prev.features : [];
  const kept = existing.filter((f) => !f?.properties?.sketch_sn4);
  const baseWayPolylines = extractWayPolylinesWgs84FromGeojsonFeatures(kept);

  const sketchMarkers = [];
  appendSn4SketchMarkerNodes(markersWgs84, sketchMarkers);

  const sketchWays = buildSn4SketchWayFeatures(polylinesWgs84 || [], strokeColorsHex || []);

  const allPolylinesForAutoStations = [...(polylinesWgs84 || []), ...baseWayPolylines];
  const autoStations = buildSn4AutoSketchStationFeatures(
    sketchMarkers.length,
    allPolylinesForAutoStations
  );

  const allFeatures = [...sketchMarkers, ...autoStations, ...sketchWays, ...kept];
  distributeBlackStationMarkersToWayProperties(allFeatures);
  layer.geojsonData = {
    type: 'FeatureCollection',
    features: allFeatures,
  };
}

/**
 * 由 layer.geojsonData 還原手繪折線對應之線上色（依 sketch_sn4_stroke_index 排序）。
 *
 * @param {{ geojsonData?: { features?: object[] } } | null} layer
 * @param {number} polylineCount
 * @returns {string[]}
 */
export function readSn4SketchWayColorsFromLayerGeojson(layer, polylineCount) {
  const fc = layer?.geojsonData;
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const byIdx = new Map();
  for (const f of features) {
    if (!f?.properties?.sketch_sn4_way) continue;
    const i = Number(f.properties?.sketch_sn4_stroke_index);
    if (!Number.isFinite(i) || i < 0) continue;
    const c = f.properties?.color;
    if (typeof c === 'string' && c.trim() !== '') byIdx.set(i, c);
  }
  const out = [];
  for (let i = 0; i < polylineCount; i++) {
    out.push(byIdx.get(i) || getNetworkDrawRouteColor(i));
  }
  return out;
}

/**
 * @param {{ geojsonData?: { features?: object[] } } | null | undefined} layer
 * @returns {Array<Array<{ x: number, y: number }>>}
 */
export function readSn4SketchPolylinesFromLayerGeojson(layer) {
  const fc = layer?.geojsonData;
  const features = Array.isArray(fc?.features) ? fc.features : [];
  /** @type {Array<{ i: number; pl: Array<{ x: number; y: number }> }>} */
  const rows = [];
  for (const f of features) {
    if (!f?.properties?.sketch_sn4_way) continue;
    const geom = f.geometry;
    if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) continue;
    const i = Number(f.properties?.sketch_sn4_stroke_index);
    if (!Number.isFinite(i) || i < 0) continue;
    const pl = geom.coordinates
      .map((c) => ({ x: Number(c?.[0]), y: Number(c?.[1]) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pl.length < 2) continue;
    rows.push({ i, pl });
  }
  rows.sort((a, b) => a.i - b.i);
  return rows.map((r) => r.pl);
}

/**
 * 還原手繪「加黑點站」：sketch_sn4 HD_S Point，及各 way 之 properties.stations（與 JSON 分頁一致）。
 *
 * @param {{ geojsonData?: { features?: object[] } } | null | undefined} layer
 * @returns {Array<{ x: number, y: number }>}
 */
export function readSn4SketchStationMarkersFromLayerGeojson(layer) {
  const fc = layer?.geojsonData;
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const keys = new Set();
  const out = [];

  const pushPt = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const k = `${Number(lng).toFixed(9)},${Number(lat).toFixed(9)}`;
    if (keys.has(k)) return;
    keys.add(k);
    out.push({ x: lng, y: lat });
  };

  for (const f of features) {
    const p = f?.properties;
    if (!p?.sketch_sn4 || p.sketch_sn4_way) continue;
    if (p.station_id !== SKETCH_MARKER_NODE_META.station.station_id) continue;
    const g = f.geometry;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
    pushPt(Number(g.coordinates[0]), Number(g.coordinates[1]));
  }

  for (const f of features) {
    if (!isGeoJsonWayLineFeature(f)) continue;
    const arr = f.properties?.stations;
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (!s || typeof s !== 'object') continue;
      pushPt(Number(s.lng ?? s.x), Number(s.lat ?? s.y));
    }
  }

  return out;
}
