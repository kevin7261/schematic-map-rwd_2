/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';
import { LAYER_ID } from './sessionOsmXml.js';

const TARGET_LAYER_ID_FOR_EXECUTE = 'taipei_sn4_a';

export function executeOsmGeojsonToTaipeiSn4ASpaceGrid() {
  const dataStore = useDataStore();
  const src = dataStore.findLayerById(LAYER_ID);
  const tgt = dataStore.findLayerById(TARGET_LAYER_ID_FOR_EXECUTE);

  if (!src?.geojsonData?.features?.length) {
    throw new Error(`請先開啟並載入圖層「${LAYER_ID}」`);
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
