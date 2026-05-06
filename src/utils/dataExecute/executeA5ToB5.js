/**
 * taipei_a5 → taipei_b5：mergeConnectSpansPlaceBlackStationsAndSplit 切段（有 mapDrawnRoutes 時）、
 * 掛載 CSV 流量、權重 ÷100。**零權重黑點合併**請於 Control 按「b5：零權重合併…」手動執行。
 *
 * 流程：
 *  1. 深拷貝 taipei_a5 的 K3Tab 路網並正規化為 flat segments。
 *  2. 對黑點標 display=true。
 *  3. mergeConnectSpansPlaceBlackStationsAndSplit 或 splitFlatH3SegmentsAtBlackVerticesOnly 切段。
 *  4. 對切段後路網套用 taipei_a5 之 CSV 流量（applyMrtTrafficVolumesToTaipeiRoutes，zeroUnmatchedTraffic）。
 *  5. 權重縮小 1/100（與舊 execute_B5_To_C5 相同規則）。
 */

/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';
import { runTaipeiB5PipelineFromK3Routes } from '@/utils/dataExecute/taipeiB5PipelineFromK3.js';

export async function execute_A5_To_B5() {
  const dataStore = useDataStore();
  const a5 = dataStore.findLayerById('taipei_a5');
  const b5 = dataStore.findLayerById('taipei_b5');
  if (!a5 || !b5) {
    console.warn('executeA5ToB5：缺少 taipei_a5 或 taipei_b5 圖層');
    return;
  }
  const k3Routes = a5.spaceNetworkGridJsonDataK3Tab;
  if (!Array.isArray(k3Routes) || k3Routes.length === 0) {
    console.warn('executeA5ToB5：taipei_a5 尚無 layout-network（K3Tab）路網，請先載入 a5 JSON');
    return;
  }

  const { scaledSegs, initialSegmentCount, blackPlacementStats } =
    await runTaipeiB5PipelineFromK3Routes(dataStore, a5, b5, k3Routes, {
      zeroWeightMerge: false,
      sourceLabel: 'executeA5ToB5',
    });

  console.log(
    `executeA5ToB5 完成：權重已除以 100；黑點配置 ${blackPlacementStats.placedBlackSectionCount} 段，` +
      `切段後路段數 ${scaledSegs.length}（原 ${initialSegmentCount}）`
  );
}
