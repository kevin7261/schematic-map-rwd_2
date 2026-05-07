/* eslint-disable no-console */

/**
 * taipei_b6 → taipei_c6：複製路網與衍生欄位（與 b4→c4 相同語意）。b6 為 a6→b6 產出；後續手動合併在 c6。
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

export async function execute_B6_To_C6() {
  const dataStore = useDataStore();
  const b6 = dataStore.findLayerById('taipei_b6');
  const c6 = dataStore.findLayerById('taipei_c6');
  if (!b6 || !c6) {
    console.warn('execute_B6_To_C6：缺少 taipei_b6 或 taipei_c6 圖層');
    return;
  }

  const b6Routes = b6.spaceNetworkGridJsonDataK3Tab;
  if (!Array.isArray(b6Routes) || b6Routes.length === 0) {
    console.warn('execute_B6_To_C6：taipei_b6 尚無 layout-network（K3Tab）路網，請先執行 a6→b6');
    return;
  }

  const finalSegs = deepCloneJson(b6Routes);
  const computed = computeStationDataFromRoutes(finalSegs);

  let processedJsonData;
  try {
    processedJsonData = flatSegmentsToGeojsonStyleExportRows(finalSegs);
  } catch (e) {
    console.error('execute_B6_To_C6：processedJsonData 轉換失敗', e);
    processedJsonData = [];
  }
  const c = deepCloneJson;

  c6.jsonData = c(b6.jsonData);
  c6.trafficData = c(b6.trafficData);

  c6.spaceNetworkGridJsonDataK3Tab = c(finalSegs);
  c6.spaceNetworkGridJsonDataK3Tab_SectionData = c(computed.sectionData);
  c6.spaceNetworkGridJsonDataK3Tab_ConnectData = c(computed.connectData);
  c6.spaceNetworkGridJsonDataK3Tab_StationData = c(computed.stationData);

  c6.spaceNetworkGridJsonData = c(finalSegs);
  c6.spaceNetworkGridJsonData_SectionData = c(computed.sectionData);
  c6.spaceNetworkGridJsonData_ConnectData = c(computed.connectData);
  c6.spaceNetworkGridJsonData_StationData = c(computed.stationData);

  c6.processedJsonDataK3Tab = processedJsonData != null ? c(processedJsonData) : null;
  c6.processedJsonData = c(processedJsonData);
  c6.dataTableData = buildTaipeiK3JunctionDataTableRows(c(c6.spaceNetworkGridJsonDataK3Tab));

  c6.layoutGridJsonData = c(finalSegs);
  c6.layoutGridJsonData_Test = c(finalSegs);
  c6.layoutGridJsonData_Test2 = c(finalSegs);
  c6.layoutGridJsonData_Test3 = c(finalSegs);
  c6.layoutGridJsonData_Test4 = c(finalSegs);

  const baseInfo = c(b6.layerInfoData);
  c6.layerInfoData =
    baseInfo && typeof baseInfo === 'object'
      ? {
          ...baseInfo,
          copiedFromLayerId: 'taipei_b6',
          weightScaledDivisor: 100,
          weightScaleRule: 'floor_divide_min_1',
        }
      : {
          copiedFromLayerId: 'taipei_b6',
          weightScaledDivisor: 100,
          weightScaleRule: 'floor_divide_min_1',
        };

  const baseDash = c(b6.dashboardData);
  c6.dashboardData =
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

  c6.drawJsonData = c(b6.drawJsonData);
  c6.squareGridCellsTaipeiTest3 = b6.squareGridCellsTaipeiTest3 === true;
  c6.showStationPlacement = b6.showStationPlacement !== false;
  c6.removedZeroWeightBlackDots = c(b6.removedZeroWeightBlackDots);
  c6.isLoaded = true;

  if (!c6.visible) {
    c6.visible = true;
    dataStore.saveLayerState('taipei_c6', { visible: true });
  }

  dataStore.saveLayerState('taipei_c6', {
    isLoaded: c6.isLoaded,
    jsonData: c6.jsonData,
    trafficData: c6.trafficData,
    spaceNetworkGridJsonDataK3Tab: c6.spaceNetworkGridJsonDataK3Tab,
    spaceNetworkGridJsonDataK3Tab_SectionData: c6.spaceNetworkGridJsonDataK3Tab_SectionData,
    spaceNetworkGridJsonDataK3Tab_ConnectData: c6.spaceNetworkGridJsonDataK3Tab_ConnectData,
    spaceNetworkGridJsonDataK3Tab_StationData: c6.spaceNetworkGridJsonDataK3Tab_StationData,
    spaceNetworkGridJsonData: c6.spaceNetworkGridJsonData,
    spaceNetworkGridJsonData_SectionData: c6.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_ConnectData: c6.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_StationData: c6.spaceNetworkGridJsonData_StationData,
    processedJsonDataK3Tab: c6.processedJsonDataK3Tab,
    processedJsonData: c6.processedJsonData,
    dataTableData: c6.dataTableData,
    layerInfoData: c6.layerInfoData,
    dashboardData: c6.dashboardData,
    drawJsonData: c6.drawJsonData,
    layoutGridJsonData: c6.layoutGridJsonData,
    layoutGridJsonData_Test: c6.layoutGridJsonData_Test,
    layoutGridJsonData_Test2: c6.layoutGridJsonData_Test2,
    layoutGridJsonData_Test3: c6.layoutGridJsonData_Test3,
    layoutGridJsonData_Test4: c6.layoutGridJsonData_Test4,
    squareGridCellsTaipeiTest3: c6.squareGridCellsTaipeiTest3,
    showStationPlacement: c6.showStationPlacement,
    removedZeroWeightBlackDots: c6.removedZeroWeightBlackDots,
  });

  console.log(`execute_B6_To_C6 完成：${finalSegs.length} 段路線已複製至 taipei_c6`);
}
