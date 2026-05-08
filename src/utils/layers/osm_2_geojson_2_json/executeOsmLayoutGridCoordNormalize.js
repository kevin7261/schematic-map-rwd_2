/* eslint-disable no-console */

/**
 * 「版面網格·座標正規化」圖層：兩步分開呼叫
 *
 * 開啟本圖層時已由 dataStore 自 `osm_2_geojson_2_json` 複製 `dataJson`／`geojsonData`；
 * **`executeOsmLayoutGridStraighten`** 僅依序使用（1）本圖層非空 **spaceNetworkGridJsonData（b）**（2）否則本圖層 **geojsonData** 或由 **dataJson／jsonData** 組出之 LineString FeatureCollection → **B3**，再 **B3→C3**；
 * 成功後將路網匯為極簡 OSM XML 寫入本圖層 **dataOSM**。
 *
 * **`executeOsmLayoutGridCoordNormalize`**（座標正規化，同 C3→D3）
 *   僅使用本圖層現有 spaceNetworkGridJsonData（請先按直線化或手貼 c3）；
 *   成功後將路網匯為極簡 OSM XML 寫入本圖層 **dataOSM**。
 *
 * @returns {boolean} 各自成功為 true
 */

import { useDataStore } from '@/stores/dataStore.js';
import { straightenSpaceNetworkAfterStrippingBlackStations } from '@/utils/dataExecute/straightenRoutesCurrentLayer.js';
import { buildTaipeiD3FromC3Network } from '@/utils/taipeiTest4/c3ToD3CoordNormalize.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest4/flatSegmentsToGeojsonStyleExportRows.js';
import { buildTaipeiB3ExecuteLayerFieldsFromGeojson } from '@/utils/taipeiTest4/buildTaipeiA3StyleLayerFieldsFromGeojson.js';
import { buildTaipeiC3StyleLayerFieldsFromStraightenedNetwork } from '@/utils/taipeiTest4/buildTaipeiC3StyleLayerFieldsFromStraightenedNetwork.js';
import { minimalLineStringFeatureCollectionFromRouteExportRows } from '@/utils/mapDrawnRoutesImport.js';
import { minimalOsmXmlFromLonLatFeatureCollection } from './minimalOsmXmlFromGeoJson.js';
import { normalizeSpaceNetworkDataToFlatSegments } from '@/utils/gridNormalizationMinDistance.js';
import {
  LAYER_ID as OSM_2_LAYER_ID,
  OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID,
} from './sessionOsmXml.js';

/**
 * 將路網（扁平或 2-5 式）轉成僅含 LineString 之 FeatureCollection，座標視為 lon/lat 寫入極簡 OSM XML（與 layerMerge／手繪匯出一致）。
 * @returns {{ type:'FeatureCollection', features: unknown[] }}
 */
function lineStringFeatureCollectionFromSpaceNetwork(spaceNetworkJsonData) {
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
      typeof wtags.color === 'string' && wtags.color.trim() !== ''
        ? wtags.color.trim()
        : '#666666';
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

/** 將目前路網寫回本圖層 `dataOSM`（generator 標記 schematic-map／版面網格流程） */
function writeLayoutNormalizedLayerDataOsmFromNetwork(layer, spaceNetworkJsonData) {
  if (!layer) return;
  if (spaceNetworkJsonData == null) {
    layer.dataOSM = null;
    return;
  }
  const fc = lineStringFeatureCollectionFromSpaceNetwork(spaceNetworkJsonData);
  layer.dataOSM = minimalOsmXmlFromLonLatFeatureCollection(fc);
}

/**
 * 直線化輸入：**只**來自本圖層已複製／編輯之資料（非父層 dataOSM 即時串流）。
 * @returns {{ spaceNetwork: unknown[], fromExistingSn: boolean } | null}
 */
function resolveB3InputSpaceNetwork(coordLayer) {
  if (
    Array.isArray(coordLayer?.spaceNetworkGridJsonData) &&
    coordLayer.spaceNetworkGridJsonData.length > 0
  ) {
    return { spaceNetwork: coordLayer.spaceNetworkGridJsonData, fromExistingSn: true };
  }

  let geojsonForExport = null;
  const gj = coordLayer?.geojsonData;
  if (
    gj?.type === 'FeatureCollection' &&
    Array.isArray(gj.features) &&
    gj.features.length > 0
  ) {
    geojsonForExport = gj;
  }
  if (!geojsonForExport?.features?.length) {
    const raw = Array.isArray(coordLayer?.dataJson)
      ? coordLayer.dataJson
      : Array.isArray(coordLayer?.jsonData)
        ? coordLayer.jsonData
        : null;
    if (Array.isArray(raw) && raw.length > 0) {
      geojsonForExport = minimalLineStringFeatureCollectionFromRouteExportRows(raw, {
        stationPoints: 'endpoints',
        routeLine: 'endpoints',
      });
    }
  }
  if (!geojsonForExport?.features?.length) {
    console.warn(
      'executeOsmLayoutGridStraighten：本圖層無路網輸入（請於左側先開啟本圖層以自「OSM → GeoJSON → JSON」複製 dataJson／geojsonData，或將 b3 貼入 spaceNetworkGridJsonData）'
    );
    return null;
  }

  const derived = buildTaipeiB3ExecuteLayerFieldsFromGeojson(geojsonForExport, {});
  const sn = derived?.spaceNetworkGridJsonData;
  if (!Array.isArray(sn) || sn.length === 0) {
    console.warn('executeOsmLayoutGridStraighten：自本層 geojson／dataJson 建立 b3 路網失敗');
    return null;
  }
  return { spaceNetwork: sn, fromExistingSn: false };
}

/** 路線直線化（測試_4／B3→C3），結果寫回本圖層 */
export function executeOsmLayoutGridStraighten() {
  const dataStore = useDataStore();
  const layer = dataStore.findLayerById(OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID);
  if (!layer) {
    console.warn('executeOsmLayoutGridStraighten：找不到圖層', OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID);
    return false;
  }

  const resolved = resolveB3InputSpaceNetwork(layer);
  if (!resolved?.spaceNetwork?.length) return false;

  const straightened = straightenSpaceNetworkAfterStrippingBlackStations(resolved.spaceNetwork);
  if (!straightened) {
    console.warn('executeOsmLayoutGridStraighten：路線直線化失敗（無資料或直線化錯誤）');
    return false;
  }

  const derived = buildTaipeiC3StyleLayerFieldsFromStraightenedNetwork(straightened);
  layer.processedJsonData = derived.processedJsonData;
  layer.spaceNetworkGridJsonData = derived.spaceNetworkGridJsonData;
  layer.spaceNetworkGridJsonData_SectionData = derived.spaceNetworkGridJsonData_SectionData;
  layer.spaceNetworkGridJsonData_ConnectData = derived.spaceNetworkGridJsonData_ConnectData;
  layer.spaceNetworkGridJsonData_StationData = derived.spaceNetworkGridJsonData_StationData;
  layer.showStationPlacement = derived.showStationPlacement;
  layer.isLoaded = true;

  layer.dashboardData = {
    ...derived.dashboardData,
    routeSourceLayerId: resolved.fromExistingSn
      ? OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID
      : OSM_2_LAYER_ID,
    coordNormalize: false,
  };

  writeLayoutNormalizedLayerDataOsmFromNetwork(layer, layer.spaceNetworkGridJsonData);

  dataStore.saveLayerState(OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID, {
    processedJsonData: layer.processedJsonData,
    spaceNetworkGridJsonData: layer.spaceNetworkGridJsonData,
    spaceNetworkGridJsonData_SectionData: layer.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_ConnectData: layer.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_StationData: layer.spaceNetworkGridJsonData_StationData,
    showStationPlacement: layer.showStationPlacement,
    dashboardData: layer.dashboardData,
    dataOSM: layer.dataOSM,
    isLoaded: true,
  });

  return true;
}

/** 座標正規化（測試_4／C3→D3），僅處理本圖層現有之路網 */
export function executeOsmLayoutGridCoordNormalize() {
  const dataStore = useDataStore();
  const layer = dataStore.findLayerById(OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID);
  if (!layer) {
    console.warn('executeOsmLayoutGridCoordNormalize：找不到圖層', OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID);
    return false;
  }

  if (!Array.isArray(layer.spaceNetworkGridJsonData) || layer.spaceNetworkGridJsonData.length === 0) {
    console.warn(
      'executeOsmLayoutGridCoordNormalize：本圖層無 spaceNetworkGridJsonData，請先執「路線直線化」或貼入 c3'
    );
    return false;
  }

  const out = buildTaipeiD3FromC3Network(layer.spaceNetworkGridJsonData);

  layer.spaceNetworkGridJsonData = out.flatSegs;
  layer.spaceNetworkGridJsonData_SectionData = out.sectionData;
  layer.spaceNetworkGridJsonData_ConnectData = out.connectData;
  layer.spaceNetworkGridJsonData_StationData = out.stationData;
  layer.showStationPlacement = false;
  layer.isLoaded = true;

  try {
    layer.processedJsonData = flatSegmentsToGeojsonStyleExportRows(out.flatSegs);
  } catch (e) {
    console.error('版面網格座標正規化：匯出 processedJsonData 失敗', e);
    layer.processedJsonData = out.rows ?? null;
  }

  const prevRoute = layer.dashboardData?.routeSourceLayerId;

  layer.dashboardData = {
    segmentCount: out.flatSegs.length,
    exportRowCount: Array.isArray(layer.processedJsonData) ? layer.processedJsonData.length : 0,
    sourceLayerId: OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID,
    ...(prevRoute != null ? { routeSourceLayerId: prevRoute } : {}),
    coordNormalize: true,
    straightened: true,
    ...out.meta,
  };

  writeLayoutNormalizedLayerDataOsmFromNetwork(layer, out.flatSegs);

  dataStore.saveLayerState(OSM_LAYOUT_GRID_COORD_NORMALIZE_LAYER_ID, {
    spaceNetworkGridJsonData: layer.spaceNetworkGridJsonData,
    spaceNetworkGridJsonData_SectionData: layer.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_ConnectData: layer.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_StationData: layer.spaceNetworkGridJsonData_StationData,
    showStationPlacement: false,
    processedJsonData: layer.processedJsonData,
    dashboardData: layer.dashboardData,
    dataOSM: layer.dataOSM,
    isLoaded: true,
  });

  return true;
}
