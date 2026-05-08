import { minimalLineStringFeatureCollectionFromRouteExportRows } from '@/utils/mapDrawnRoutesImport.js';

import { schedulePersistOsm2GeojsonArtifacts } from './artifactPersist.js';
import { LAYER_ID } from './sessionOsmXml.js';
import { geojson_2_json } from './pipeline.js';

/**
 * @param {object} layer
 * @param {object} result
 * @param {{ groupName?: string, sourceOsmXmlText?: string } | null} [persistence]
 */
export function mergeOsm2GeojsonLoaderResultIntoLayer(layer, result, persistence = null) {
  layer.jsonData = result.jsonData ?? null;
  layer.processedJsonData = result.processedJsonData ?? null;
  layer.geojsonData = result.geojsonData ?? null;
  layer.dashboardData = result.dashboardData ?? null;
  layer.dataTableData = result.dataTableData ?? null;
  layer.layerInfoData = result.layerInfoData ?? null;
  layer.isLoaded = true;
  layer.isLoading = false;
  if (
    layer.layerId === LAYER_ID &&
    persistence?.groupName &&
    typeof persistence.groupName === 'string'
  ) {
    schedulePersistOsm2GeojsonArtifacts({
      groupName: persistence.groupName,
      layer,
      sourceOsmXmlText:
        typeof persistence.sourceOsmXmlText === 'string'
          ? persistence.sourceOsmXmlText
          : result?.sourceOsmXmlText,
    });
  }
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

/**
 * MapTab 手繪／交叉後：依 jsonData 還原路線 LineString GeoJSON，`schedulePersist…` 仍會附帶 session 內之 OSM（若有）。
 *
 * @param {object} layer
 * @param {string|null|undefined} groupName
 */
export function syncOsm2LayerDerivedGeoJsonAndScheduleArtifactsPersist(layer, groupName) {
  if (!layer || layer.layerId !== LAYER_ID || !groupName || String(groupName).trim() === '') {
    return null;
  }
  const gj = minimalLineStringFeatureCollectionFromRouteExportRows(
    Array.isArray(layer.jsonData) ? layer.jsonData : []
  );
  layer.geojsonData = gj;
  schedulePersistOsm2GeojsonArtifacts({ groupName, layer });
  return { geojsonData: gj };
}
