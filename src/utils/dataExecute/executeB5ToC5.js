/* eslint-disable no-console */

/**
 * taipei_b5 → taipei_c5：複製路網與衍生欄位（與 b4→c4 相同語意）。b5 為 a5→b5 產出；後續手動合併等操作在 c5。
 */

import { useDataStore } from '@/stores/dataStore.js';
import { computeStationDataFromRoutes } from '@/utils/dataExecute/computeStationDataFromRoutes.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest3/flatSegmentsToGeojsonStyleExportRows.js';
import { buildTaipeiK3JunctionDataTableRows } from '@/utils/taipeiK3JunctionDataTable.js';

function deepCloneJson(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export async function execute_B5_To_C5() {
  const dataStore = useDataStore();
  const b5 = dataStore.findLayerById('taipei_b5');
  const c5 = dataStore.findLayerById('taipei_c5');
  if (!b5 || !c5) {
    console.warn('execute_B5_To_C5：缺少 taipei_b5 或 taipei_c5 圖層');
    return;
  }

  const b5Routes = b5.spaceNetworkGridJsonDataK3Tab;
  if (!Array.isArray(b5Routes) || b5Routes.length === 0) {
    console.warn('execute_B5_To_C5：taipei_b5 尚無 layout-network（K3Tab）路網，請先執行 a5→b5');
    return;
  }

  const finalSegs = deepCloneJson(b5Routes);
  const computed = computeStationDataFromRoutes(finalSegs);

  let processedJsonData;
  try {
    processedJsonData = flatSegmentsToGeojsonStyleExportRows(finalSegs);
  } catch (e) {
    console.error('execute_B5_To_C5：processedJsonData 轉換失敗', e);
    processedJsonData = [];
  }
  const c = deepCloneJson;

  c5.jsonData = c(b5.jsonData);
  c5.trafficData = c(b5.trafficData);

  c5.spaceNetworkGridJsonDataK3Tab = c(finalSegs);
  c5.spaceNetworkGridJsonDataK3Tab_SectionData = c(computed.sectionData);
  c5.spaceNetworkGridJsonDataK3Tab_ConnectData = c(computed.connectData);
  c5.spaceNetworkGridJsonDataK3Tab_StationData = c(computed.stationData);

  c5.spaceNetworkGridJsonData = c(finalSegs);
  c5.spaceNetworkGridJsonData_SectionData = c(computed.sectionData);
  c5.spaceNetworkGridJsonData_ConnectData = c(computed.connectData);
  c5.spaceNetworkGridJsonData_StationData = c(computed.stationData);

  c5.processedJsonDataK3Tab = processedJsonData != null ? c(processedJsonData) : null;
  c5.processedJsonData = c(processedJsonData);
  c5.dataTableData = buildTaipeiK3JunctionDataTableRows(c(c5.spaceNetworkGridJsonDataK3Tab));

  c5.layoutGridJsonData = c(finalSegs);
  c5.layoutGridJsonData_Test = c(finalSegs);
  c5.layoutGridJsonData_Test2 = c(finalSegs);
  c5.layoutGridJsonData_Test3 = c(finalSegs);
  c5.layoutGridJsonData_Test4 = c(finalSegs);

  const baseInfo = c(b5.layerInfoData);
  c5.layerInfoData =
    baseInfo && typeof baseInfo === 'object'
      ? {
          ...baseInfo,
          copiedFromLayerId: 'taipei_b5',
          weightScaledDivisor: 100,
          weightScaleRule: 'floor_divide_min_1',
        }
      : {
          copiedFromLayerId: 'taipei_b5',
          weightScaledDivisor: 100,
          weightScaleRule: 'floor_divide_min_1',
        };

  const baseDash = c(b5.dashboardData);
  c5.dashboardData =
    baseDash && typeof baseDash === 'object'
      ? {
          ...baseDash,
          segmentCount: finalSegs.length,
          weightScaledDivisor: 100,
        }
      : {
          segmentCount: finalSegs.length,
          weightScaledDivisor: 100,
        };

  c5.drawJsonData = c(b5.drawJsonData);
  c5.squareGridCellsTaipeiTest3 = b5.squareGridCellsTaipeiTest3 === true;
  c5.showStationPlacement = b5.showStationPlacement !== false;
  c5.removedZeroWeightBlackDots = c(b5.removedZeroWeightBlackDots);
  c5.isLoaded = true;

  if (!c5.visible) {
    c5.visible = true;
    dataStore.saveLayerState('taipei_c5', { visible: true });
  }

  dataStore.saveLayerState('taipei_c5', {
    isLoaded: c5.isLoaded,
    jsonData: c5.jsonData,
    trafficData: c5.trafficData,
    spaceNetworkGridJsonDataK3Tab: c5.spaceNetworkGridJsonDataK3Tab,
    spaceNetworkGridJsonDataK3Tab_SectionData: c5.spaceNetworkGridJsonDataK3Tab_SectionData,
    spaceNetworkGridJsonDataK3Tab_ConnectData: c5.spaceNetworkGridJsonDataK3Tab_ConnectData,
    spaceNetworkGridJsonDataK3Tab_StationData: c5.spaceNetworkGridJsonDataK3Tab_StationData,
    spaceNetworkGridJsonData: c5.spaceNetworkGridJsonData,
    spaceNetworkGridJsonData_SectionData: c5.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_ConnectData: c5.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_StationData: c5.spaceNetworkGridJsonData_StationData,
    processedJsonDataK3Tab: c5.processedJsonDataK3Tab,
    processedJsonData: c5.processedJsonData,
    dataTableData: c5.dataTableData,
    layerInfoData: c5.layerInfoData,
    dashboardData: c5.dashboardData,
    drawJsonData: c5.drawJsonData,
    layoutGridJsonData: c5.layoutGridJsonData,
    layoutGridJsonData_Test: c5.layoutGridJsonData_Test,
    layoutGridJsonData_Test2: c5.layoutGridJsonData_Test2,
    layoutGridJsonData_Test3: c5.layoutGridJsonData_Test3,
    layoutGridJsonData_Test4: c5.layoutGridJsonData_Test4,
    squareGridCellsTaipeiTest3: c5.squareGridCellsTaipeiTest3,
    showStationPlacement: c5.showStationPlacement,
    removedZeroWeightBlackDots: c5.removedZeroWeightBlackDots,
  });

  console.log(`execute_B5_To_C5 完成：${finalSegs.length} 段路線已複製至 taipei_c5`);
}
