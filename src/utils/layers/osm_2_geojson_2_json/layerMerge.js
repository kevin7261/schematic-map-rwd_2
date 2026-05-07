import { geojson_2_json } from './pipeline.js';

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
 * 依目前 geojsonData 再跑 geojson_2_json，寫回圖層
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
