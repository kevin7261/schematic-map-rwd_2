/**
 * 手繪折線（包圍盒正規化 nx,ny）→ 與底層 space-network-grid 圖幅對齊之中間格式（Normalize Segments 陣列），
 * Normalize Segments 可寫入目標圖層的 spaceNetworkGridJsonData（由 store 決定），或經 {@link sketchNormalizeSegmentsToGeoJsonFeatureCollection} 轉成圖幅 GeoJSON。
 */

import { getSchematicPlotBoundsFromLayer } from '@/utils/schematicPlotMapper.js';
import { getNetworkDrawRouteColor } from '@/utils/networkDrawSketchPalette.js';
import { buildSn4AutoSketchStationFeatures } from '@/utils/mergeSn4SketchIntoLayerGeojson.js';

/**
 * @param {object|null} baseLayer - 對齊用之可見資料圖層（需已有 spaceNetworkGridJsonData 等可算邊界者）
 * @param {Array<Array<{nx:number, ny:number}>>} polylinesNorm
 * @param {{ routeNamePrefix?: string, strokeColorIndices?: number[] }} [options]
 *   strokeColorIndices：與 polylinesNorm 對齊，各筆在手繪列表之 0-based 索引（與 NetworkDrawTab routeColor(i) 一致）
 * @returns {Array<object>|null}
 */
export function buildNormalizeSegmentsFromSketchPolylinesNorm(
  baseLayer,
  polylinesNorm,
  options = {}
) {
  let b = baseLayer ? getSchematicPlotBoundsFromLayer(baseLayer) : null;
  /** 無參考路網或尚未載入資料時，與手繪 nx,ny∈[0,1] 對齊之單位圖幅（與舊疊加邏輯一致） */
  if (!b) {
    b = { xMin: 0, xMax: 1, yMin: 0, yMax: 1, centerX: 0.5, centerY: 0.5 };
  }
  const { xMin, xMax, yMin, yMax } = b;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const prefix = options.routeNamePrefix ?? '路線';
  const colorIdxArr = options.strokeColorIndices;
  const segments = [];
  let idx = 0;
  let segPos = 0;
  for (const pl of polylinesNorm || []) {
    if (!pl || pl.length < 2) continue;
    const points = [];
    for (const p of pl) {
      const nx = Number(p.nx);
      const ny = Number(p.ny);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      const gx = xMin + nx * xSpan;
      const gy = yMax - ny * ySpan;
      points.push([gx, gy]);
    }
    if (points.length < 2) continue;
    const colorSourceIdx =
      Array.isArray(colorIdxArr) && colorIdxArr[segPos] != null ? colorIdxArr[segPos] : segPos;
    const color = getNetworkDrawRouteColor(colorSourceIdx);
    segPos += 1;
    idx += 1;
    const routeName = `${prefix}_${idx}`;
    const nodes = points.map(([x, y]) => ({
      node_type: 'line',
      x_grid: x,
      y_grid: y,
      tags: {},
    }));
    segments.push({
      points,
      nodes,
      route_name: routeName,
      name: routeName,
      way_properties: {
        type: 'way',
        tags: {
          route_name: routeName,
          color,
        },
      },
    });
  }
  return segments.length ? segments : null;
}

/**
 * 將 {@link buildNormalizeSegmentsFromSketchPolylinesNorm} 產生的 segments 轉成 GeoJSON FeatureCollection。
 * LineString 之 coordinates 為示意圖圖幅座標 [x, y]（與既有 space-network-grid 路網 GeoJSON 分支相同）。
 *
 * @param {Array<object>|null} segments
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
export function sketchNormalizeSegmentsToGeoJsonFeatureCollection(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (const seg of segments) {
    if (!seg || !Array.isArray(seg.points) || seg.points.length < 2) continue;
    const coordinates = [];
    for (const point of seg.points) {
      let x;
      let y;
      if (Array.isArray(point) && point.length >= 2) {
        x = Number(point[0]);
        y = Number(point[1]);
      } else if (point && typeof point === 'object') {
        x = Number(point.x);
        y = Number(point.y);
      } else continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      coordinates.push([x, y]);
    }
    if (coordinates.length < 2) continue;
    const tags = (seg.way_properties && seg.way_properties.tags) || {};
    const routeName = seg.route_name || seg.name || tags.route_name || 'route';
    const color = tags.color != null ? tags.color : tags.colour;
    features.push({
      type: 'Feature',
      properties: {
        name: seg.name || routeName,
        tags: {
          ...tags,
          route_name: routeName,
          ...(color != null ? { color } : {}),
        },
        nav_weight:
          seg.nav_weight != null && Number.isFinite(Number(seg.nav_weight))
            ? Number(seg.nav_weight)
            : 1,
      },
      geometry: {
        type: 'LineString',
        coordinates,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** 與 data/taipei/taipei.geojson 之 node／way properties 鍵名一致 */
const SKETCH_MARKER_NODE_META = {
  red: { station_id: 'HD_X', station_name: '交叉點' },
  blue: { station_id: 'HD_E', station_name: '懸空端' },
  green: { station_id: 'HD_J', station_name: '相接端' },
  station: { station_id: 'HD_S', station_name: '加註站點' },
};

/**
 * @param {{ red?: Array<{x:number,y:number}>, blue?: Array, green?: Array, station?: Array }|null|undefined} markersWgs84
 * @param {object[]} features
 */
function appendSketchMarkerPointFeaturesTaipeiShape(markersWgs84, features) {
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
      features.push({
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
        },
      });
    }
  }
}

/**
 * 手繪折線（NetworkDrawTab：x=經度、y=緯度，WGS84）→ GeoJSON FeatureCollection（形與 taipei.geojson 一致：先 Point 標記、再 LineString 路段）。
 * way：properties 含 osm_id、element_type、color、railway、route_company、route_id、route_name（扁平欄位，無巢狀 tags）。
 *
 * @param {Array<Array<{ x: number, y: number }>>|null} polylines
 * @param {{
 *   routeNamePrefix?: string,
 *   routeCompany?: string,
 *   markersWgs84?: { red?: Array<{x:number,y:number}>, blue?: Array, green?: Array, station?: Array } | null,
 * }} [options]
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
export function sketchPolylinesWgs84ToGeoJsonFeatureCollection(polylines, options = {}) {
  const prefix = options.routeNamePrefix ?? '路線';
  const routeCompany = options.routeCompany ?? '路線';
  const features = [];

  appendSketchMarkerPointFeaturesTaipeiShape(options.markersWgs84, features);
  features.push(...buildSn4AutoSketchStationFeatures(features.length, polylines || []));

  const indexed = (polylines || [])
    .map((pl, i) => ({ pl, i }))
    .filter(({ pl }) => pl && pl.length >= 2);
  let idx = 0;
  for (const { pl, i } of indexed) {
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
    const color = getNetworkDrawRouteColor(i);
    const routeName = `${prefix}_${idx}`;
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
        railway: 'other',
        route_company: routeCompany,
        route_id: String(idx),
        route_name: routeName,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * 手繪 SVG 像素 → 與路段相同之圖幅座標（sketchBounds 須與 polylinesPxToNormalizedSketch 一致）。
 */
export function mapSketchPixelToPlotCoord(px, py, sketchBounds, plotBounds) {
  const minX = sketchBounds.minX;
  const maxX = sketchBounds.maxX;
  const minY = sketchBounds.minY;
  const maxY = sketchBounds.maxY;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const nx = (px - minX) / w;
  const ny = (py - minY) / h;
  const xSpan = plotBounds.xMax - plotBounds.xMin || 1;
  const ySpan = plotBounds.yMax - plotBounds.yMin || 1;
  return {
    x: plotBounds.xMin + nx * xSpan,
    y: plotBounds.yMax - ny * ySpan,
  };
}

/**
 * 手繪 WGS84（p.x=lng, p.y=lat；sketchBounds 之 minX/maxX 為經度、minY/maxY 為緯度）→ 圖幅座標。
 * ny 與畫面一致：北（大緯度）在「上」對應紙面上方（與舊版 SVG 由上到下的 0–1 一致）。
 */
export function mapSketchGeoToPlotCoord(lng, lat, sketchBounds, plotBounds) {
  const minLng = sketchBounds.minX;
  const maxLng = sketchBounds.maxX;
  const minLat = sketchBounds.minY;
  const maxLat = sketchBounds.maxY;
  const w = maxLng - minLng || 1e-12;
  const h = maxLat - minLat || 1e-12;
  const nx = (lng - minLng) / w;
  const ny = (maxLat - lat) / h;
  const xSpan = plotBounds.xMax - plotBounds.xMin || 1;
  const ySpan = plotBounds.yMax - plotBounds.yMin || 1;
  return {
    x: plotBounds.xMin + nx * xSpan,
    y: plotBounds.yMax - ny * ySpan,
  };
}

/**
 * @param {{ red?: Array<{x:number,y:number}>, blue?: Array, green?: Array, station?: Array }|null} markersPx
 * @param {{ minX: number, maxX: number, minY: number, maxY: number }} sketchBounds
 * @param {{ xMin: number, xMax: number, yMin: number, yMax: number }} plotBounds
 * @returns {Array<{ x: number, y: number, fill: string, stroke: string, r: number }>}
 */
export function buildPlotMarkersFromSketchMarkersPx(markersPx, sketchBounds, plotBounds) {
  if (!markersPx || !sketchBounds || !plotBounds) return [];
  const out = [];
  const push = (arr, fill, stroke, r) => {
    for (const p of arr || []) {
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
      const q = mapSketchPixelToPlotCoord(Number(p.x), Number(p.y), sketchBounds, plotBounds);
      out.push({ x: q.x, y: q.y, fill, stroke, r });
    }
  };
  /** 與 NetworkDrawTab 圓點樣式一致 */
  push(markersPx.red, '#e53935', '#ffebee', 4.5);
  push(markersPx.green, '#43a047', '#e8f5e9', 4);
  push(markersPx.blue, '#1e88e5', '#e3f2fd', 4);
  push(markersPx.station, '#8e24aa', '#f3e5f5', 4.5);
  return out;
}

/**
 * 標記同 {@link buildPlotMarkersFromSketchMarkersPx}，但座標為 WGS84（x=經度, y=緯度）。
 */
export function buildPlotMarkersFromSketchMarkersGeo(markersGeo, sketchBounds, plotBounds) {
  if (!markersGeo || !sketchBounds || !plotBounds) return [];
  const out = [];
  const push = (arr, fill, stroke, r) => {
    for (const p of arr || []) {
      if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
      const q = mapSketchGeoToPlotCoord(Number(p.x), Number(p.y), sketchBounds, plotBounds);
      out.push({ x: q.x, y: q.y, fill, stroke, r });
    }
  };
  push(markersGeo.red, '#e53935', '#ffebee', 4.5);
  push(markersGeo.green, '#43a047', '#e8f5e9', 4);
  push(markersGeo.blue, '#1e88e5', '#e3f2fd', 4);
  push(markersGeo.station, '#8e24aa', '#f3e5f5', 4.5);
  return out;
}
