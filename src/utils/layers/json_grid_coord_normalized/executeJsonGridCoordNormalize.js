/* eslint-disable no-console */

/**
 * 「JSON·網格·座標正規化」圖層：單一入口 **b→c→d**
 *
 * 開啟本圖層時已由 dataStore 自 `osm_2_geojson_2_json` 複製 `dataJson`／`geojsonData`。
 *
 * @returns {boolean} 成功為 true
 */

import { useDataStore } from '@/stores/dataStore.js';
import { buildTaipeiD3FromC3Network } from '@/utils/taipeiTest4/c3ToD3CoordNormalize.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest4/flatSegmentsToGeojsonStyleExportRows.js';
import { LAYER_ID as OSM_2_LAYER_ID } from '@/utils/layers/osm_2_geojson_2_json/sessionOsmXml.js';
import {
  buildC3NetworkForCoordNormalize,
  writeLayoutNormalizedLayerDataOsmFromNetwork,
} from './jsonGridCoordNormalizeHelpers.js';
import { JSON_GRID_COORD_NORMALIZED_LAYER_ID } from './sessionJsonGridCoordNormalized.js';

export function executeJsonGridCoordNormalize() {
  const dataStore = useDataStore();
  const layer = dataStore.findLayerById(JSON_GRID_COORD_NORMALIZED_LAYER_ID);
  if (!layer) {
    console.warn('executeJsonGridCoordNormalize：找不到圖層', JSON_GRID_COORD_NORMALIZED_LAYER_ID);
    return false;
  }

  const c3Prep = buildC3NetworkForCoordNormalize(layer);
  if (!c3Prep) return false;

  const { c3Network, resolved } = c3Prep;
  const out = buildTaipeiD3FromC3Network(c3Network);

  layer.spaceNetworkGridJsonData = out.flatSegs;
  layer.spaceNetworkGridJsonData_SectionData = out.sectionData;
  layer.spaceNetworkGridJsonData_ConnectData = out.connectData;
  layer.spaceNetworkGridJsonData_StationData = out.stationData;
  layer.showStationPlacement = false;
  layer.isLoaded = true;

  try {
    layer.processedJsonData = flatSegmentsToGeojsonStyleExportRows(out.flatSegs);
  } catch (e) {
    console.error('JSON 網格座標正規化：匯出 processedJsonData 失敗', e);
    layer.processedJsonData = out.rows ?? null;
  }

  layer.dashboardData = {
    segmentCount: out.flatSegs.length,
    exportRowCount: Array.isArray(layer.processedJsonData) ? layer.processedJsonData.length : 0,
    sourceLayerId: JSON_GRID_COORD_NORMALIZED_LAYER_ID,
    routeSourceLayerId: resolved.fromExistingSn
      ? JSON_GRID_COORD_NORMALIZED_LAYER_ID
      : OSM_2_LAYER_ID,
    coordNormalize: true,
    straightened: true,
    ...out.meta,
  };

  writeLayoutNormalizedLayerDataOsmFromNetwork(layer, out.flatSegs);

  dataStore.saveLayerState(JSON_GRID_COORD_NORMALIZED_LAYER_ID, {
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
