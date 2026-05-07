/**
 * osm_2_geojson 圖層：OSM → GeoJSON（osm_2_geojson）→ 路網衍生欄位（geojson_2_json）；
 * 複製至 taipei_sn4_a（executeOsmGeojsonToTaipeiSn4ASpaceGrid）。
 */

/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';
import { buildStandardRouteGeoJsonLoadResult } from '@/utils/dataProcessor.js';
import { osmXmlStringToGeoJsonFeatureCollection } from '@/utils/osmXmlToGeoJson.js';
import { LAYER_ID } from './sessionOsmXml.js';

export { LAYER_ID, setOsm2GeojsonSessionOsmXml, getOsm2GeojsonSessionOsmXml } from './sessionOsmXml.js';

const TARGET_LAYER_ID_FOR_EXECUTE = 'taipei_sn4_a';

/** OSM XML 字串 → FeatureCollection（僅幾何／要素，不含儀表板欄位） */
export function osm_2_geojson(osmXmlString) {
  return { geojsonData: osmXmlStringToGeoJsonFeatureCollection(osmXmlString) };
}

/**
 * 路網 GeoJSON → 與 loadGeoJsonForRoutes 一致之衍生欄位（processedJsonData、dashboard…）
 * @param {Object} geojsonData - FeatureCollection
 */
export function geojson_2_json(geojsonData) {
  return buildStandardRouteGeoJsonLoadResult(geojsonData);
}

/**
 * 單次載入：先 osm_2_geojson 再 geojson_2_json，供本機選檔與 geojsonLoader（osm_2_geojson 圖層）使用。
 * @returns {Object} 含 sourceOsmXmlText，其餘欄位與 parseOsmXmlStringToRouteGeoJsonLoadResult 相同形狀
 */
export function osmXmlToOsm2GeojsonLoaderResult(osmXmlString) {
  const { geojsonData } = osm_2_geojson(osmXmlString);
  return {
    ...geojson_2_json(geojsonData),
    sourceOsmXmlText: osmXmlString,
  };
}

/** @deprecated 請用 osmXmlToOsm2GeojsonLoaderResult */
export function parseLocalOsmXmlStringToRouteLoadResult(xmlString) {
  return osmXmlToOsm2GeojsonLoaderResult(xmlString);
}

export function mergeOsm2GeojsonLoaderResultIntoLayer(layer, result) {
  layer.jsonData = result.jsonData ?? null;
  layer.processedJsonData = result.processedJsonData ?? null;
  layer.geojsonData = result.geojsonData ?? null;
  layer.dashboardData = result.dashboardData ?? null;
  layer.dataTableData = result.dataTableData ?? null;
  layer.layerInfoData = result.layerInfoData ?? null;
  layer.isLoaded = true;
  layer.isLoading = false;
}

/** 供本機載入後 saveLayerState 使用 */
export function getOsm2GeojsonPersistPatchAfterLoaderMerge(layer) {
  return {
    osmFileName: layer.osmFileName,
    jsonData: layer.jsonData,
    processedJsonData: layer.processedJsonData,
    geojsonData: layer.geojsonData,
    dashboardData: layer.dashboardData,
    dataTableData: layer.dataTableData,
    layerInfoData: layer.layerInfoData,
    isLoaded: layer.isLoaded,
    isLoading: layer.isLoading,
  };
}

/**
 * 依目前 geojsonData 再跑 geojson_2_json，寫回圖層（供手動重算或編輯 GeoJSON 後使用）。
 * @returns {Object|null} saveLayerState 用之 patch；無資料時 null
 */
export function applyOsm2GeojsonRouteFieldsFromGeojsonData(layer) {
  const gj = layer?.geojsonData;
  if (!gj?.features?.length) return null;
  const result = geojson_2_json(gj);
  layer.processedJsonData = result.processedJsonData ?? null;
  layer.dashboardData = result.dashboardData ?? null;
  layer.dataTableData = result.dataTableData ?? null;
  layer.layerInfoData = result.layerInfoData ?? null;
  layer.jsonData = result.jsonData ?? null;
  return {
    processedJsonData: layer.processedJsonData,
    dashboardData: layer.dashboardData,
    dataTableData: layer.dataTableData,
    layerInfoData: layer.layerInfoData,
    jsonData: layer.jsonData,
  };
}

export function executeOsmGeojsonToTaipeiSn4ASpaceGrid() {
  const dataStore = useDataStore();
  const src = dataStore.findLayerById(LAYER_ID);
  const tgt = dataStore.findLayerById(TARGET_LAYER_ID_FOR_EXECUTE);

  if (!src?.geojsonData?.features?.length) {
    throw new Error(`請先開啟並載入「Taipei OSM → GeoJSON（空間網絡網格）」圖層（${LAYER_ID}）`);
  }
  if (!tgt) {
    throw new Error(`找不到目標圖層 ${TARGET_LAYER_ID_FOR_EXECUTE}`);
  }

  tgt.geojsonData = JSON.parse(JSON.stringify(src.geojsonData));
  tgt.processedJsonData = null;
  tgt.spaceNetworkGridJsonData = null;
  tgt.spaceNetworkGridJsonData_SectionData = null;
  tgt.spaceNetworkGridJsonData_ConnectData = null;
  tgt.spaceNetworkGridJsonData_StationData = null;
  tgt.dashboardData = null;
  tgt.drawJsonData = null;
  tgt.jsonData = null;
  tgt.dataTableData = null;
  tgt.layerInfoData = null;
  tgt.isLoaded = false;
  tgt.isLoading = false;

  const statePatch = {
    geojsonData: tgt.geojsonData,
    processedJsonData: null,
    spaceNetworkGridJsonData: null,
    spaceNetworkGridJsonData_SectionData: null,
    spaceNetworkGridJsonData_ConnectData: null,
    spaceNetworkGridJsonData_StationData: null,
    dashboardData: null,
    drawJsonData: null,
    jsonData: null,
    dataTableData: null,
    layerInfoData: null,
    isLoaded: false,
    isLoading: false,
  };
  if (!tgt.visible) {
    tgt.visible = true;
    statePatch.visible = true;
  }
  dataStore.saveLayerState(TARGET_LAYER_ID_FOR_EXECUTE, statePatch);

  console.log(
    `executeOsmGeojsonToTaipeiSn4ASpaceGrid：已將 GeoJSON 複製至 ${TARGET_LAYER_ID_FOR_EXECUTE}（請於該層執行「下一步」a→b）`
  );
}
