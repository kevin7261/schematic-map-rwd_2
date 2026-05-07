/**
 * 空間網絡網格測試_4：taipei_osm_geojson_sn4（geojsonData）→ 寫入 taipei_sn4_a.geojsonData，
 * 作為「a 讀取 GeoJSON 檔案」之輸入（此處只複製 GeoJSON，不寫入 b 之路網欄位）。
 */

/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';

const SOURCE_LAYER_ID = 'taipei_osm_geojson_sn4';
const TARGET_LAYER_ID = 'taipei_sn4_a';

export function executeOsmGeojsonToTaipeiSn4A() {
  const dataStore = useDataStore();
  const src = dataStore.findLayerById(SOURCE_LAYER_ID);
  const tgt = dataStore.findLayerById(TARGET_LAYER_ID);

  if (!src?.geojsonData?.features?.length) {
    throw new Error(`請先開啟並載入「Taipei OSM → GeoJSON（測試_4）」圖層（${SOURCE_LAYER_ID}）`);
  }
  if (!tgt) {
    throw new Error(`找不到目標圖層 ${TARGET_LAYER_ID}`);
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
  dataStore.saveLayerState(TARGET_LAYER_ID, statePatch);

  console.log(`executeOsmGeojsonToTaipeiSn4A：已將 GeoJSON 複製至 ${TARGET_LAYER_ID}（請於該層執行「下一步」a→b）`);
}
