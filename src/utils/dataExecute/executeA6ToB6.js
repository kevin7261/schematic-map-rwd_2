/**
 * taipei_a6 → taipei_b6：版面網格測試_3 管線（舊 a5→b5 已移除）
 * mergeConnectSpansPlaceBlackStationsAndSplit 切段（有 mapDrawnRoutes 時）、掛載 CSV 流量、權重 ÷100。
 * **零權重黑點合併**請於 Control 按「b6：零權重合併…」手動執行。
 */

/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';
import { runTaipeiB6PipelineFromK3Routes } from '@/utils/dataExecute/taipeiB6PipelineFromK3.js';

export async function execute_A6_To_B6() {
  const dataStore = useDataStore();
  const a6 = dataStore.findLayerById('taipei_a6');
  const b6 = dataStore.findLayerById('taipei_b6');
  if (!a6 || !b6) {
    console.warn('executeA6ToB6：缺少 taipei_a6 或 taipei_b6 圖層');
    return;
  }
  const k3Routes = a6.spaceNetworkGridJsonDataK3Tab;
  if (!Array.isArray(k3Routes) || k3Routes.length === 0) {
    console.warn('executeA6ToB6：taipei_a6 尚無 layout-network（K3Tab）路網，請先載入 a6 JSON');
    return;
  }

  const { scaledSegs, initialSegmentCount, blackPlacementStats } =
    await runTaipeiB6PipelineFromK3Routes(dataStore, a6, b6, k3Routes, {
      zeroWeightMerge: false,
      sourceLabel: 'executeA6ToB6',
    });

  console.log(
    `executeA6ToB6 完成：權重已除以 100；黑點配置 ${blackPlacementStats.placedBlackSectionCount} 段，` +
      `切段後路段數 ${scaledSegs.length}（原 ${initialSegmentCount}）`
  );
}
