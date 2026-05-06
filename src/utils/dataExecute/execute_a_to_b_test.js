// # @title 測試流程：直線化 → b 層 (Pass-through)
// ==============================================================================
// 📝 程式說明：
// 1. 讀取當前管線 a 圖層（taipei_a 或 taipei_a2）的輸出資料。
// 2. 將 spaceNetworkGridJsonData 與 Section/Connect/Station 車站資料、showStationPlacement 一併傳給同管線 b 層。
// 3. 自動開啟該 b 圖層以便查看。
// ==============================================================================
/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';
import { resolveTaipeiTestPipelineStep } from '@/utils/taipeiTestPipeline.js';

// eslint-disable-next-line no-unused-vars
export function execute_a_to_b_test(_jsonData) {
  const dataStore = useDataStore();
  const execId = dataStore.taipeiTestExecuteSourceLayerId || 'taipei_a';
  const step = resolveTaipeiTestPipelineStep(execId);
  if (!step || step.role !== 'a') {
    throw new Error(`execute_a_to_b_test：無效的來源圖層 ${execId}（須為 taipei_a 或 taipei_a2）`);
  }
  const { pipeline, targetB } = step;
  const straighteningLayer = dataStore.findLayerById(pipeline.a);
  const targetBL = dataStore.findLayerById(targetB);

  console.log('='.repeat(60));
  console.log('📂 [設定] 測試流程：直線化 → b 層');
  console.log(`   - 輸入: ${pipeline.a} 圖層`);
  console.log(`   - 輸出: ${targetB} 圖層`);
  console.log('='.repeat(60));

  dataStore.runTaipeiTestStraighteningPipeline();

  if (!straighteningLayer || !straighteningLayer.spaceNetworkGridJsonData) {
    console.error(`❌ 錯誤: 找不到 ${pipeline.a} 的資料`);
    throw new Error(`找不到 ${pipeline.a} 的資料 (請先載入圖層)`);
  }

  if (!targetBL) {
    throw new Error(`找不到 ${targetB} 圖層`);
  }

  try {
    const deepClone = (v) => (v != null ? JSON.parse(JSON.stringify(v)) : null);
    const inputData = deepClone(straighteningLayer.spaceNetworkGridJsonData);
    console.log(`📊 輸入資料: ${inputData.length} 個 segments`);

    targetBL.spaceNetworkGridJsonData = inputData;
    targetBL.spaceNetworkGridJsonData_SectionData = deepClone(
      straighteningLayer.spaceNetworkGridJsonData_SectionData
    );
    targetBL.spaceNetworkGridJsonData_ConnectData = deepClone(
      straighteningLayer.spaceNetworkGridJsonData_ConnectData
    );
    targetBL.spaceNetworkGridJsonData_StationData = deepClone(
      straighteningLayer.spaceNetworkGridJsonData_StationData
    );
    targetBL.showStationPlacement = !!straighteningLayer.showStationPlacement;
    console.log(`✅ 資料已傳給 ${targetB} 圖層（含 Section/Connect/Station 與車站配置開關）`);

    if (!targetBL.visible) {
      targetBL.visible = true;
      dataStore.saveLayerState(targetB, { visible: true });
    }

    targetBL.dashboardData = {
      inputSegmentCount: inputData.length,
      source: pipeline.a,
    };
  } catch (error) {
    console.error(`\n❌ [例外狀況] 執行過程中發生錯誤：${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}
