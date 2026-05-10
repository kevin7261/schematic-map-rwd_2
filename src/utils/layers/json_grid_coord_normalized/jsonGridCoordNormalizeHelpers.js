/* eslint-disable no-console */

import { straightenSpaceNetworkAfterStrippingBlackStations } from '@/utils/dataExecute/straightenRoutesCurrentLayer.js';
import { buildTaipeiB3ExecuteLayerFieldsFromGeojson } from '@/utils/taipeiTest4/buildTaipeiA3StyleLayerFieldsFromGeojson.js';
import { buildTaipeiC3StyleLayerFieldsFromStraightenedNetwork } from '@/utils/taipeiTest4/buildTaipeiC3StyleLayerFieldsFromStraightenedNetwork.js';
import { minimalLineStringFeatureCollectionFromRouteExportRows } from '@/utils/mapDrawnRoutesImport.js';
import { normalizeSpaceNetworkDataToFlatSegments } from '@/utils/gridNormalizationMinDistance.js';
import { minimalOsmXmlFromLonLatFeatureCollection } from './minimalOsmXmlFromGeoJson.js';

/**
 * @returns {{ type:'FeatureCollection', features: unknown[] }}
 */
export function lineStringFeatureCollectionFromSpaceNetwork(spaceNetworkJsonData) {
  const flat = normalizeSpaceNetworkDataToFlatSegments(spaceNetworkJsonData);
  const features = [];
  if (!Array.isArray(flat)) {
    return { type: 'FeatureCollection', features: [] };
  }
  for (const seg of flat) {
    const points = Array.isArray(seg?.points) ? seg.points : [];
    const coords = [];
    for (const p of points) {
      const x = Number(Array.isArray(p) ? p[0] : p?.x);
      const y = Number(Array.isArray(p) ? p[1] : p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      coords.push([x, y]);
    }
    if (coords.length < 2) continue;
    const routeName = String(seg.route_name ?? seg.name ?? 'Unknown');
    const wtags = seg.way_properties?.tags || {};
    const color =
      typeof wtags.color === 'string' && wtags.color.trim() !== '' ? wtags.color.trim() : '#666666';
    features.push({
      type: 'Feature',
      properties: {
        name: routeName,
        route_id: routeName,
        color,
      },
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function writeLayoutNormalizedLayerDataOsmFromNetwork(layer, spaceNetworkJsonData) {
  if (!layer) return;
  if (spaceNetworkJsonData == null) {
    layer.dataOSM = null;
    return;
  }
  const fc = lineStringFeatureCollectionFromSpaceNetwork(spaceNetworkJsonData);
  layer.dataOSM = minimalOsmXmlFromLonLatFeatureCollection(fc);
}

/**
 * 本圖層路網輸入（b 或已存在之路網格狀資料）。
 *
 * @param {{ routeLineFromExportRows?: 'endpoints' | 'full' }} [options]
 *   `full`：在僅有匯出列、`geojsonData` 曾以起迄視圖產製時，改自 `dataJson`／`jsonData` 還原
 *   完整 routeCoordinates 折鏈（與 HV 統計／頂點表一致）。
 * @returns {{ spaceNetwork: unknown[], fromExistingSn: boolean } | null}
 */
export function resolveB3InputSpaceNetwork(coordLayer, options = {}) {
  const routeLineFromRows =
    options.routeLineFromExportRows === 'full' ? 'full' : 'endpoints';

  if (
    Array.isArray(coordLayer?.spaceNetworkGridJsonData) &&
    coordLayer.spaceNetworkGridJsonData.length > 0
  ) {
    return { spaceNetwork: coordLayer.spaceNetworkGridJsonData, fromExistingSn: true };
  }

  const raw = Array.isArray(coordLayer?.dataJson)
    ? coordLayer.dataJson
    : Array.isArray(coordLayer?.jsonData)
      ? coordLayer.jsonData
      : null;
  const hasRaw = Array.isArray(raw) && raw.length > 0;

  let geojsonForExport = null;

  if (routeLineFromRows === 'full' && hasRaw) {
    geojsonForExport = minimalLineStringFeatureCollectionFromRouteExportRows(raw, {
      stationPoints: 'all',
      routeLine: 'full',
    });
  }

  if (!geojsonForExport?.features?.length) {
    const gj = coordLayer?.geojsonData;
    if (gj?.type === 'FeatureCollection' && Array.isArray(gj.features) && gj.features.length > 0) {
      geojsonForExport = gj;
    }
  }

  if (!geojsonForExport?.features?.length && hasRaw) {
    geojsonForExport = minimalLineStringFeatureCollectionFromRouteExportRows(raw, {
      stationPoints: routeLineFromRows === 'full' ? 'all' : 'endpoints',
      routeLine: routeLineFromRows,
    });
  }
  if (!geojsonForExport?.features?.length) {
    console.warn(
      'executeJsonGridCoordNormalize：本圖層無路網輸入（請於左側先開啟本圖層以自「OSM／GeoJSON → JSON」複製 dataJson／geojsonData，或貼入 spaceNetworkGridJsonData）'
    );
    return null;
  }

  const derived = buildTaipeiB3ExecuteLayerFieldsFromGeojson(geojsonForExport, {});
  const sn = derived?.spaceNetworkGridJsonData;
  if (!Array.isArray(sn) || sn.length === 0) {
    console.warn('executeJsonGridCoordNormalize：自本層 geojson／dataJson 建立 b3 路網失敗');
    return null;
  }
  return { spaceNetwork: sn, fromExistingSn: false };
}

/**
 * @returns {{ c3Network: unknown[], resolved: { fromExistingSn: boolean } } | null}
 */
export function buildC3NetworkForCoordNormalize(coordLayer) {
  const resolved = resolveB3InputSpaceNetwork(coordLayer);
  if (!resolved?.spaceNetwork?.length) return null;

  const straightened = straightenSpaceNetworkAfterStrippingBlackStations(resolved.spaceNetwork);
  if (!straightened) {
    console.warn('executeJsonGridCoordNormalize：內部 B3→C3（路線整形）失敗');
    return null;
  }

  const c3Derived = buildTaipeiC3StyleLayerFieldsFromStraightenedNetwork(straightened);
  const c3Network = c3Derived?.spaceNetworkGridJsonData;
  if (!Array.isArray(c3Network) || c3Network.length === 0) {
    console.warn('executeJsonGridCoordNormalize：無法取得 c3 路網');
    return null;
  }

  return { c3Network, resolved };
}
