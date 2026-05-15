/**
 * 衍生圖層：`point_orthogonal` 自「座標正規化」複製 dataJson／jsonData；
 * 「站點與路線往中心聚集」兩種線網層優先自 `point_orthogonal` 複製；若尚無陣列則改讀「座標正規化」同一欄位（便於只開本層也能顯示）。
 * `orthogonal_toward_center_vh_draw` 僅鏡像 `orthogonal_toward_center_vh` 之 dataJson／geojson 供繪製；
 * `layout_network_grid_from_vh_draw` 自繪製層複製 **dataOSM**（並解析為 geojson 供網格檢視）。
 */

import {
  mapDrawnExportRowsFromJsonDrawRoot,
  mergeSegmentStationsFromPriorExportRows,
  minimalLineStringFeatureCollectionFromRouteExportRows,
} from '../../mapDrawnRoutesImport.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest4/flatSegmentsToGeojsonStyleExportRows.js';
import { osmXmlStringToGeojsonData } from '@/utils/layers/osm_2_geojson_2_json/pipeline.js';
import {
  resolveB3InputSpaceNetwork,
  writeLayoutNormalizedLayerDataOsmFromNetwork,
} from './jsonGridCoordNormalizeHelpers.js';
import {
  JSON_GRID_COORD_NORMALIZED_LAYER_ID,
  JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID,
  POINT_ORTHOGONAL_LAYER_ID,
  isLineOrthogonalTowardCenterLayerId,
  LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
  LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID,
  LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID,
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY,
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2,
  LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2,
  COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID,
} from './layerIds.js';
import { buildVhDrawStationRowsForLayoutMap } from './layoutVhDrawFineIntegerGrid.js';

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
  const priorExportRows = mapDrawnExportRowsFromJsonDrawRoot(layer.jsonData, layer.dataJson);
  let arr = JSON.parse(JSON.stringify(rows));
  arr = mergeSegmentStationsFromPriorExportRows(arr, priorExportRows);
  layer.jsonData = arr;
  layer.dataJson = arr;
  layer.geojsonData = minimalLineStringFeatureCollectionFromRouteExportRows(arr, {
    stationPoints: 'endpoints',
    routeLine: 'endpoints',
  });
  if (layer.layerId === LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID) {
    const resolved = resolveB3InputSpaceNetwork(layer, { routeLineFromExportRows: 'full' });
    if (resolved?.spaceNetwork?.length) {
      writeLayoutNormalizedLayerDataOsmFromNetwork(layer, resolved.spaceNetwork);
    } else {
      layer.dataOSM = null;
    }
  }
}

export function applyCoordNormalizedLayerDataJsonToFollowon(findLayerById, derivedLayer) {
  if (derivedLayer?.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID) {
    const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
    const osm =
      draw?.dataOSM != null && String(draw.dataOSM).trim() !== '' ? String(draw.dataOSM) : null;
    derivedLayer.dataOSM = osm;
    if (osm) {
      try {
        const { geojsonData } = osmXmlStringToGeojsonData(osm);
        const lineFeats =
          geojsonData?.type === 'FeatureCollection' && Array.isArray(geojsonData.features)
            ? geojsonData.features.filter(
                (f) =>
                  f?.geometry &&
                  (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
              )
            : [];
        const drawGj = draw?.geojsonData;
        const pointFeats =
          drawGj?.type === 'FeatureCollection' && Array.isArray(drawGj.features)
            ? drawGj.features.filter((f) => f?.geometry?.type === 'Point')
            : [];
        derivedLayer.geojsonData =
          lineFeats.length || pointFeats.length
            ? { type: 'FeatureCollection', features: [...lineFeats, ...pointFeats] }
            : null;
      } catch {
        derivedLayer.geojsonData = null;
      }
    } else {
      derivedLayer.geojsonData = null;
    }
    derivedLayer.isLoaded = true;
    syncLayoutNetworkGridRoutesDataJsonFromVhDraw(findLayerById, derivedLayer);
    return;
  }

  if (derivedLayer?.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY) {
    const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
    const osm =
      draw?.dataOSM != null && String(draw.dataOSM).trim() !== '' ? String(draw.dataOSM) : null;
    derivedLayer.dataOSM = osm;
    if (osm) {
      try {
        const { geojsonData } = osmXmlStringToGeojsonData(osm);
        const lineFeats =
          geojsonData?.type === 'FeatureCollection' && Array.isArray(geojsonData.features)
            ? geojsonData.features.filter(
                (f) =>
                  f?.geometry &&
                  (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
              )
            : [];
        const drawGj = draw?.geojsonData;
        const pointFeats =
          drawGj?.type === 'FeatureCollection' && Array.isArray(drawGj.features)
            ? drawGj.features.filter((f) => f?.geometry?.type === 'Point')
            : [];
        derivedLayer.geojsonData =
          lineFeats.length || pointFeats.length
            ? { type: 'FeatureCollection', features: [...lineFeats, ...pointFeats] }
            : null;
      } catch {
        derivedLayer.geojsonData = null;
      }
    } else {
      derivedLayer.geojsonData = null;
    }
    derivedLayer.isLoaded = true;
    syncLayoutNetworkGridRoutesDataJsonFromVhDrawCopy(findLayerById, derivedLayer);
    return;
  }

  if (derivedLayer?.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) {
    const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
    const osm =
      draw?.dataOSM != null && String(draw.dataOSM).trim() !== '' ? String(draw.dataOSM) : null;
    derivedLayer.dataOSM = osm;
    if (osm) {
      try {
        const { geojsonData } = osmXmlStringToGeojsonData(osm);
        const lineFeats =
          geojsonData?.type === 'FeatureCollection' && Array.isArray(geojsonData.features)
            ? geojsonData.features.filter(
                (f) =>
                  f?.geometry &&
                  (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
              )
            : [];
        const drawGj = draw?.geojsonData;
        const pointFeats =
          drawGj?.type === 'FeatureCollection' && Array.isArray(drawGj.features)
            ? drawGj.features.filter((f) => f?.geometry?.type === 'Point')
            : [];
        derivedLayer.geojsonData =
          lineFeats.length || pointFeats.length
            ? { type: 'FeatureCollection', features: [...lineFeats, ...pointFeats] }
            : null;
      } catch {
        derivedLayer.geojsonData = null;
      }
    } else {
      derivedLayer.geojsonData = null;
    }
    derivedLayer.isLoaded = true;
    syncLayoutNetworkGridRoutesDataJsonFromVhDraw2(findLayerById, derivedLayer);
    return;
  }

  if (derivedLayer?.layerId === LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID) {
    const vh = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID);
    const raw =
      vh && Array.isArray(vh.dataJson)
        ? vh.dataJson
        : vh && Array.isArray(vh.jsonData)
          ? vh.jsonData
          : null;
    const arr = Array.isArray(raw) ? JSON.parse(JSON.stringify(raw)) : null;
    derivedLayer.jsonData = arr;
    derivedLayer.dataJson = arr;
    derivedLayer.geojsonData = minimalLineStringFeatureCollectionFromRouteExportRows(
      Array.isArray(raw) ? raw : [],
      { stationPoints: 'endpoints', routeLine: 'endpoints' }
    );
    const resolved = resolveB3InputSpaceNetwork(derivedLayer, { routeLineFromExportRows: 'full' });
    if (resolved?.spaceNetwork?.length) {
      writeLayoutNormalizedLayerDataOsmFromNetwork(derivedLayer, resolved.spaceNetwork);
    } else {
      derivedLayer.dataOSM = null;
    }
    derivedLayer.isLoaded = true;
    return;
  }

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
    { stationPoints: 'endpoints', routeLine: 'endpoints' }
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
  if (
    lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID ||
    lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY ||
    lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2
  ) {
    lyr.layoutVhDrawFineGridTurnRbMidDots = false;
  }
  if (
    lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID ||
    lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY ||
    lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2 ||
    lyr.layerId === LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2
  ) {
    lyr.layoutVhDrawShowBlackDotRowColRatioOverlay = false;
  }
  lyr.layoutVhDrawFineGrid = null;
  lyr.layoutVhDrawBlackDotRowColRatioReport = null;
  lyr.showStationPlacement = true;
}

/**
 * 「路網網格」：寫入與 Upper **json-viewer** 第一段優先順序同源之路由陣列（`mapDrawnExportRowsFromJsonDrawRoot`，深拷貝；含 VH 來源 segment 之 `traffic_weight`）。
 *
 * **必須** `jsonData` 為 null、僅 **`dataJson` 為匯出列陣列**，與 `SpaceNetworkGridJsonDataTab` 一致。
 *
 * @param {(id:string)=>*|null} findLayerById
 * @param {object|null} [layoutLayer] — 若傳入則寫入該物件（鏡像 apply 時）。
 */
export function syncLayoutNetworkGridRoutesDataJsonFromVhDraw(findLayerById, layoutLayer) {
  const layout = layoutLayer ?? findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID);
  const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
  if (!layout || layout.layerId !== LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID || !draw) return;

  const rows = buildVhDrawStationRowsForLayoutMap({ findLayerById }, draw);
  layout.jsonData = null;
  layout.dataJson =
    Array.isArray(rows) && rows.length > 0 ? JSON.parse(JSON.stringify(rows)) : null;
}

/** 同組複本：與 {@link syncLayoutNetworkGridRoutesDataJsonFromVhDraw} 相同邏輯，綁定 `layout_network_grid_from_vh_draw_copy`（實作重複，不呼叫前者）。 */
export function syncLayoutNetworkGridRoutesDataJsonFromVhDrawCopy(findLayerById, layoutLayer) {
  const layout = layoutLayer ?? findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY);
  const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
  if (!layout || layout.layerId !== LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY || !draw) return;

  const rows = buildVhDrawStationRowsForLayoutMap({ findLayerById }, draw);
  layout.jsonData = null;
  layout.dataJson =
    Array.isArray(rows) && rows.length > 0 ? JSON.parse(JSON.stringify(rows)) : null;
}

/** 版面網絡網格_2：與 {@link syncLayoutNetworkGridRoutesDataJsonFromVhDraw} 相同邏輯，綁定 `layout_network_grid_from_vh_draw_2`。 */
export function syncLayoutNetworkGridRoutesDataJsonFromVhDraw2(findLayerById, layoutLayer) {
  const layout = layoutLayer ?? findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2);
  const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
  if (!layout || layout.layerId !== LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2 || !draw) return;

  const rows = buildVhDrawStationRowsForLayoutMap({ findLayerById }, draw);
  layout.jsonData = null;
  layout.dataJson =
    Array.isArray(rows) && rows.length > 0 ? JSON.parse(JSON.stringify(rows)) : null;
}

/** `layout_network_grid_read_layout_data_json_2`：深拷自 `layout_network_grid_from_vh_draw_2`。 */
export function syncLayoutNetworkGridReadLayerFromLayoutRoutesDataJson2(
  findLayerById,
  readerLayer = null
) {
  const src = findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2);
  const target =
    readerLayer?.layerId === LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2
      ? readerLayer
      : findLayerById(LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2);
  if (!src || !target || src.layerId !== LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) return;

  const jsonCloneOrNull = (v) =>
    v == null ? null : JSON.parse(JSON.stringify(v));

  target.jsonData = jsonCloneOrNull(src.jsonData);
  target.dataJson = jsonCloneOrNull(src.dataJson);
  target.geojsonData = jsonCloneOrNull(src.geojsonData);
  target.dataOSM =
    src.dataOSM != null && String(src.dataOSM).trim() !== ''
      ? String(src.dataOSM)
      : null;

  target.layoutVhDrawFineGrid = jsonCloneOrNull(src.layoutVhDrawFineGrid);
  target.layoutVhDrawFineGridTurnRbMidDots = !!src.layoutVhDrawFineGridTurnRbMidDots;
  target.layoutVhDrawBlackDotRowColRatioReport = jsonCloneOrNull(src.layoutVhDrawBlackDotRowColRatioReport);
  target.layoutVhDrawShowBlackDotRowColRatioOverlay =
    src.layoutVhDrawShowBlackDotRowColRatioOverlay === true;

  target.csvFileName_traffic = src.csvFileName_traffic ?? null;
  target.layoutVhDrawTrafficData = jsonCloneOrNull(src.layoutVhDrawTrafficData);
  target.layoutVhDrawTrafficMissing = Array.isArray(src.layoutVhDrawTrafficMissing)
    ? JSON.parse(JSON.stringify(src.layoutVhDrawTrafficMissing))
    : [];
  target.layoutVhDrawShowTrafficWeights = src.layoutVhDrawShowTrafficWeights !== false;

  target.layoutUniformGridGeoJson = jsonCloneOrNull(src.layoutUniformGridGeoJson);
  target.layoutUniformGridMeta = jsonCloneOrNull(src.layoutUniformGridMeta);

  target.isLoaded = !!src.isLoaded;
}

/**
 * 重設管線並 persist 「讀 dataJson」圖層（版面網絡網格_2）。
 */
export function mirrorResetAndPersistLayoutNetworkGridReadLayoutDataJsonLayer2(
  findLayerById,
  saveLayerState,
  readerLayer = null
) {
  const layer =
    readerLayer?.layerId === LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2
      ? readerLayer
      : findLayerById(LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2);
  if (!layer || layer.layerId !== LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2) return;
  resetJsonGridFromCoordNormalizedPipelineFields(layer);
  syncLayoutNetworkGridReadLayerFromLayoutRoutesDataJson2(findLayerById, layer);
  saveLayerState(
    layer.layerId,
    jsonGridFromCoordNormalizedPersistPayload(layer, { omitLoadingFlags: true })
  );
}

/** `layout_network_grid_read_layout_data_json_2`：若該層存在則深拷並 persist（不論可見與否，避免再次開啟時為過期快照）。 */
export function refreshLayoutNetworkGridReadLayoutDataJsonLayerIfVisible2(
  findLayerById,
  saveLayerState
) {
  const r = findLayerById(LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2);
  if (!r) return;
  mirrorResetAndPersistLayoutNetworkGridReadLayoutDataJsonLayer2(findLayerById, saveLayerState, r);
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
    layoutVhDrawFineGrid: layer.layoutVhDrawFineGrid ?? null,
    layoutVhDrawFineGridTurnRbMidDots: !!layer.layoutVhDrawFineGridTurnRbMidDots,
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
  if (layer.layerId === LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID) {
    payload.vhDrawUserJsonOverride = !!layer.vhDrawUserJsonOverride;
    payload.jsonFileName = layer.jsonFileName ?? null;
  }
  if (
    layer.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID ||
    layer.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY ||
    layer.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2
  ) {
    payload.csvFileName_traffic = layer.csvFileName_traffic ?? null;
    payload.layoutVhDrawTrafficData = layer.layoutVhDrawTrafficData ?? null;
    payload.layoutVhDrawTrafficMissing = Array.isArray(layer.layoutVhDrawTrafficMissing)
      ? layer.layoutVhDrawTrafficMissing
      : [];
    payload.layoutVhDrawShowTrafficWeights = layer.layoutVhDrawShowTrafficWeights !== false;
    payload.layoutVhDrawBlackDotRowColRatioReport = layer.layoutVhDrawBlackDotRowColRatioReport ?? null;
    payload.layoutVhDrawShowBlackDotRowColRatioOverlay =
      layer.layoutVhDrawShowBlackDotRowColRatioOverlay === true;
  }
  if (layer.layerId === LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2) {
    payload.csvFileName_traffic = layer.csvFileName_traffic ?? null;
    payload.layoutVhDrawTrafficData = layer.layoutVhDrawTrafficData ?? null;
    payload.layoutVhDrawTrafficMissing = Array.isArray(layer.layoutVhDrawTrafficMissing)
      ? layer.layoutVhDrawTrafficMissing
      : [];
    payload.layoutVhDrawShowTrafficWeights = layer.layoutVhDrawShowTrafficWeights !== false;
    payload.layoutVhDrawBlackDotRowColRatioReport = layer.layoutVhDrawBlackDotRowColRatioReport ?? null;
    payload.layoutVhDrawShowBlackDotRowColRatioOverlay =
      layer.layoutVhDrawShowBlackDotRowColRatioOverlay === true;
  }
  if (!omitLoadingFlags) {
    payload.isLoading = layer.isLoading;
  }
  return payload;
}

/** 「版面網絡網格」層若可見，自 `orthogonal_toward_center_vh_draw` 重複製 **dataOSM** 並 persist */
export function refreshLayoutNetworkGridFromVhDrawIfVisible(findLayerById, saveLayerState) {
  const layout = findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID);
  if (!layout?.visible) return;
  mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, layout);
}

/** 版面網絡網格_2：若可見則自 `orthogonal_toward_center_vh_draw` 重複製並 persist（平行於 {@link refreshLayoutNetworkGridFromVhDrawIfVisible}）。 */
export function refreshLayoutNetworkGridFromVhDrawIfVisible2(findLayerById, saveLayerState) {
  const layout = findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2);
  if (!layout?.visible) return;
  mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, layout);
}

/** 同組複本：若可見則自 `orthogonal_toward_center_vh_draw` 重複製並 persist（平行於 {@link refreshLayoutNetworkGridFromVhDrawIfVisible}，實作重複）。 */
export function refreshLayoutNetworkGridFromVhDrawIfVisibleCopy(findLayerById, saveLayerState) {
  const layout = findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY);
  if (!layout?.visible) return;
  mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, layout);
}

export function mirrorResetAndPersistJsonGridFromCoordNormalized(
  findLayerById,
  saveLayerState,
  layer
) {
  applyCoordNormalizedLayerDataJsonToFollowon(findLayerById, layer);
  resetJsonGridFromCoordNormalizedPipelineFields(layer);
  saveLayerState(
    layer.layerId,
    jsonGridFromCoordNormalizedPersistPayload(layer, { omitLoadingFlags: true })
  );
  if (layer.layerId === LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID) {
    refreshOrthogonalVhMirrorDrawLayerIfVisible(findLayerById, saveLayerState);
  }
  if (layer.layerId === LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID) {
    refreshLayoutNetworkGridFromVhDrawIfVisible(findLayerById, saveLayerState);
    refreshLayoutNetworkGridFromVhDrawIfVisibleCopy(findLayerById, saveLayerState);
    refreshLayoutNetworkGridFromVhDrawIfVisible2(findLayerById, saveLayerState);
  }
  if (layer.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) {
    refreshLayoutNetworkGridReadLayoutDataJsonLayerIfVisible2(findLayerById, saveLayerState);
  }
}

export function reloadJsonGridFromCoordNormalizedLayer(findLayerById, saveLayerState, layer) {
  applyCoordNormalizedLayerDataJsonToFollowon(findLayerById, layer);
  resetJsonGridFromCoordNormalizedPipelineFields(layer);
  layer.isLoaded = true;
  layer.isLoading = false;
  saveLayerState(layer.layerId, jsonGridFromCoordNormalizedPersistPayload(layer));
  if (layer.layerId === LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID) {
    refreshOrthogonalVhMirrorDrawLayerIfVisible(findLayerById, saveLayerState);
  }
  if (layer.layerId === LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID) {
    refreshLayoutNetworkGridFromVhDrawIfVisible(findLayerById, saveLayerState);
    refreshLayoutNetworkGridFromVhDrawIfVisibleCopy(findLayerById, saveLayerState);
    refreshLayoutNetworkGridFromVhDrawIfVisible2(findLayerById, saveLayerState);
  }
  if (layer.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) {
    refreshLayoutNetworkGridReadLayoutDataJsonLayerIfVisible2(findLayerById, saveLayerState);
  }
}

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
  refreshOrthogonalVhMirrorDrawLayerIfVisible(findLayerById, saveLayerState);
}

/** `orthogonal_toward_center_vh_draw`：自 VH 往中心層複製 dataJson（VH 層或其他鏡像更新後呼叫） */
export function refreshOrthogonalVhMirrorDrawLayerIfVisible(findLayerById, saveLayerState) {
  const draw = findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
  if (draw?.visible && !draw.vhDrawUserJsonOverride) {
    mirrorResetAndPersistJsonGridFromCoordNormalized(findLayerById, saveLayerState, draw);
  } else if (draw?.visible) {
    refreshLayoutNetworkGridFromVhDrawIfVisible(findLayerById, saveLayerState);
    refreshLayoutNetworkGridFromVhDrawIfVisibleCopy(findLayerById, saveLayerState);
    refreshLayoutNetworkGridFromVhDrawIfVisible2(findLayerById, saveLayerState);
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
  refreshOrthogonalVhMirrorDrawLayerIfVisible(findLayerById, saveLayerState);
}
