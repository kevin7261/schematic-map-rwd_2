/**
 * 衍生圖層：`point_orthogonal` 自「座標正規化」複製 dataJson／jsonData；
 * 「站點與路線往中心聚集」兩種線網層優先自 `point_orthogonal` 複製；若尚無陣列則改讀「座標正規化」同一欄位（便於只開本層也能顯示）。
 */

import { minimalLineStringFeatureCollectionFromRouteExportRows } from '../../mapDrawnRoutesImport.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest4/flatSegmentsToGeojsonStyleExportRows.js';
import {
  JSON_GRID_COORD_NORMALIZED_LAYER_ID,
  JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID,
  POINT_ORTHOGONAL_LAYER_ID,
  isLineOrthogonalTowardCenterLayerId,
  LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
  COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID,
} from './layerIds.js';

/**
 * 將本圖層路網匯出列寫入 dataJson／jsonData／geojsonData（與座標正規化父層語意一致）。
 */
export function syncJsonGridFromCoordDataJsonFromPipeline(layer) {
  if (!layer) return;
  let rows = Array.isArray(layer.processedJsonData) ? layer.processedJsonData : null;
  if (
    (!rows || rows.length === 0) &&
    Array.isArray(layer.spaceNetworkGridJsonData) &&
    layer.spaceNetworkGridJsonData.length > 0
  ) {
    try {
      rows = flatSegmentsToGeojsonStyleExportRows(layer.spaceNetworkGridJsonData);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('syncJsonGridFromCoordDataJsonFromPipeline：自路網匯出列失敗', e);
      rows = null;
    }
  }
  if (!Array.isArray(rows) || rows.length === 0) return;
  const arr = JSON.parse(JSON.stringify(rows));
  layer.jsonData = arr;
  layer.dataJson = arr;
  layer.geojsonData = minimalLineStringFeatureCollectionFromRouteExportRows(arr, {
    stationPoints: 'endpoints',
    routeLine: 'endpoints',
  });
}

export function applyCoordNormalizedLayerDataJsonToFollowon(findLayerById, derivedLayer) {
  const sourceId = isLineOrthogonalTowardCenterLayerId(derivedLayer?.layerId)
    ? POINT_ORTHOGONAL_LAYER_ID
    : JSON_GRID_COORD_NORMALIZED_LAYER_ID;
  const parentOrtho = findLayerById(sourceId);
  let raw =
    parentOrtho && Array.isArray(parentOrtho.dataJson)
      ? parentOrtho.dataJson
      : parentOrtho && Array.isArray(parentOrtho.jsonData)
        ? parentOrtho.jsonData
        : null;
  if (
    isLineOrthogonalTowardCenterLayerId(derivedLayer?.layerId) &&
    (!Array.isArray(raw) || raw.length === 0)
  ) {
    const norm = findLayerById(JSON_GRID_COORD_NORMALIZED_LAYER_ID);
    raw =
      norm && Array.isArray(norm.dataJson)
        ? norm.dataJson
        : norm && Array.isArray(norm.jsonData)
          ? norm.jsonData
          : null;
  }
  const arr = Array.isArray(raw) ? JSON.parse(JSON.stringify(raw)) : null;
  derivedLayer.jsonData = arr;
  derivedLayer.dataJson = arr;
  derivedLayer.geojsonData = minimalLineStringFeatureCollectionFromRouteExportRows(
    Array.isArray(raw) ? raw : [],
    { stationPoints: 'endpoints', routeLine: 'endpoints' },
  );
  derivedLayer.isLoaded = true;
}

/** 清除後續管線欄位，改以最新複製之 dataJson 為準 */
export function resetJsonGridFromCoordNormalizedPipelineFields(lyr) {
  lyr.spaceNetworkGridJsonData = null;
  lyr.spaceNetworkGridJsonData_SectionData = null;
  lyr.spaceNetworkGridJsonData_ConnectData = null;
  lyr.spaceNetworkGridJsonData_StationData = null;
  lyr.processedJsonData = null;
  lyr.dashboardData = null;
  lyr.drawJsonData = null;
  lyr.dataOSM = null;
  lyr.dataTableData = null;
  lyr.layerInfoData = null;
  lyr.highlightedSegmentIndex = null;
  if (lyr.layerId === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID) {
    lyr.rbConnectMovePreview = null;
    lyr.rbConnectVisitedKeys = [];
  }
  lyr.jsonGridFromCoordSuggestTargetGrid = null;
  lyr.lineOrthoTowardCrossHighlightTableAxis = null;
  lyr.lineOrthoTowardCrossFrozenCenter = null;
  lyr.layoutUniformGridGeoJson = null;
  lyr.layoutUniformGridMeta = null;
  lyr.showStationPlacement = true;
}

/**
 * Pinia persist：開啟／reload 與 dataStore.toggle 共用。
 * @param {{ omitLoadingFlags?: boolean }} [opts]
 */
export function jsonGridFromCoordNormalizedPersistPayload(layer, opts = {}) {
  const { omitLoadingFlags = false } = opts;
  const payload = {
    isLoaded: layer.isLoaded,
    jsonData: layer.jsonData,
    geojsonData: layer.geojsonData,
    dataJson: layer.dataJson,
    layoutUniformGridGeoJson: layer.layoutUniformGridGeoJson ?? null,
    layoutUniformGridMeta: layer.layoutUniformGridMeta ?? null,
    spaceNetworkGridJsonData: layer.spaceNetworkGridJsonData,
    spaceNetworkGridJsonData_SectionData: layer.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_ConnectData: layer.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_StationData: layer.spaceNetworkGridJsonData_StationData,
    processedJsonData: layer.processedJsonData,
    dashboardData: layer.dashboardData,
    drawJsonData: layer.drawJsonData,
    dataOSM: layer.dataOSM,
    dataTableData: layer.dataTableData,
    layerInfoData: layer.layerInfoData,
    highlightedSegmentIndex: layer.highlightedSegmentIndex,
    rbConnectMovePreview: layer.rbConnectMovePreview ?? null,
    rbConnectVisitedKeys: Array.isArray(layer.rbConnectVisitedKeys)
      ? layer.rbConnectVisitedKeys
      : [],
    jsonGridFromCoordSuggestTargetGrid: layer.jsonGridFromCoordSuggestTargetGrid ?? null,
    lineOrthoTowardCrossHighlightTableAxis: layer.lineOrthoTowardCrossHighlightTableAxis ?? null,
    lineOrthoTowardCrossFrozenCenter: layer.lineOrthoTowardCrossFrozenCenter ?? null,
    showStationPlacement: layer.showStationPlacement,
  };
  if (!omitLoadingFlags) {
    payload.isLoading = layer.isLoading;
  }
  return payload;
}

export function mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, layer) {
  applyCoordNormalizedLayerDataJsonToFollowon(findLayerById, layer);
  resetJsonGridFromCoordNormalizedPipelineFields(layer);
  saveLayerState(
    layer.layerId,
    jsonGridFromCoordNormalizedPersistPayload(layer, { omitLoadingFlags: true }),
  );
}

export function reloadJsonGridFromCoordNormalizedLayer(findLayerById, saveLayerState, layer) {
  applyCoordNormalizedLayerDataJsonToFollowon(findLayerById, layer);
  resetJsonGridFromCoordNormalizedPipelineFields(layer);
  layer.isLoaded = true;
  layer.isLoading = false;
  saveLayerState(layer.layerId, jsonGridFromCoordNormalizedPersistPayload(layer));
}

/**
 * OSM 管線同步至座標正規化後，若本衍生圖層為開啟狀態則跟進複製父層 dataJson。
 */
export function syncJsonGridFromCoordNormalizedMirrorFromParent(findLayerById, saveLayerState) {
  const follow = findLayerById(JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID);
  if (follow?.visible) {
    mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, follow);
  }
  for (const id of LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS) {
    const lineOrtho = findLayerById(id);
    if (lineOrtho?.visible) {
      mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, lineOrtho);
    }
  }
  const rb = findLayerById(COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID);
  if (rb?.visible) {
    mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, rb);
  }
}

/** 站點層寫入後，任一「往中心聚集」線網層開啟則自 `point_orthogonal` 重鏡像並 persist */
export function refreshLineOrthogonalFromPointOrthogonalIfVisible(findLayerById, saveLayerState) {
  for (const id of LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS) {
    const line = findLayerById(id);
    if (line?.visible) {
      mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, line);
    }
  }
}
