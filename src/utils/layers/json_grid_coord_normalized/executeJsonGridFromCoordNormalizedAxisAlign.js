/* eslint-disable no-console */

/**
 * 「自座標正規化 dataJson」圖層：格點路網橫豎化（見 dataStore 該 layerId 註解）。
 */

import { useDataStore } from '@/stores/dataStore.js';
import { normalizeSpaceNetworkDataToFlatSegments } from '@/utils/gridNormalizationMinDistance.js';
import { resolveB3InputSpaceNetwork, writeLayoutNormalizedLayerDataOsmFromNetwork } from './jsonGridCoordNormalizeHelpers.js';
import { runAxisAlignHillClimb } from './axisAlignGridNetworkHillClimb.js';
import { computeStationDataFromRoutes } from '@/utils/dataExecute/computeStationDataFromRoutes.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest4/flatSegmentsToGeojsonStyleExportRows.js';
import {
  jsonGridFromCoordNormalizedPersistPayload,
  syncJsonGridFromCoordDataJsonFromPipeline,
} from './mirrorFromCoordNormalizedLayer.js';

const LAYER_ID = 'json_grid_from_coord_normalized';

/**
 * @returns {{ ok: boolean, noop?: boolean, message?: string, iterations?: number, costBefore?: number, costAfter?: number }}
 */
export function executeJsonGridFromCoordNormalizedAxisAlign(opts = {}) {
  const dataStore = useDataStore();
  const layer = dataStore.findLayerById(LAYER_ID);
  if (!layer) {
    console.warn('executeJsonGridFromCoordNormalizedAxisAlign：找不到圖層', LAYER_ID);
    return { ok: false, message: '找不到圖層' };
  }

  const resolved = resolveB3InputSpaceNetwork(layer);
  if (!resolved?.spaceNetwork?.length) {
    return {
      ok: false,
      message:
        '沒有路網輸入。請先開啟本圖層複製父層 dataJson，或在父層「座標正規化」後再開本層；若本層有 dataJson，亦請貼入或載入 spaceNetworkGridJsonData。',
    };
  }

  const flat = normalizeSpaceNetworkDataToFlatSegments(
    JSON.parse(JSON.stringify(resolved.spaceNetwork)),
  );

  const r = runAxisAlignHillClimb(flat, { maxRounds: opts.maxRounds ?? 120 });
  if (!r.ok) {
    return { ok: false, message: r.message || '無法執行' };
  }

  if (!r.improved && r.costBefore === r.costAfter) {
    return {
      ok: true,
      noop: true,
      message: '已無法在鄰格內更橫豎（或已全為橫／豎線）。',
      iterations: r.iterations,
      costBefore: r.costBefore,
      costAfter: r.costAfter,
    };
  }

  layer.spaceNetworkGridJsonData = r.segments;
  const computed = computeStationDataFromRoutes(r.segments);
  layer.spaceNetworkGridJsonData_SectionData = computed.sectionData;
  layer.spaceNetworkGridJsonData_ConnectData = computed.connectData;
  layer.spaceNetworkGridJsonData_StationData = computed.stationData;
  layer.showStationPlacement = false;

  try {
    layer.processedJsonData = flatSegmentsToGeojsonStyleExportRows(r.segments);
  } catch (e) {
    console.error('橫豎化：匯出 processedJsonData 失敗', e);
  }

  const prevDash = layer.dashboardData && typeof layer.dashboardData === 'object' ? layer.dashboardData : {};
  layer.dashboardData = {
    ...prevDash,
    axisAlignAt: Date.now(),
    axisAlignIterations: r.iterations,
    axisAlignCostBefore: r.costBefore,
    axisAlignCostAfter: r.costAfter,
    segmentCount: r.segments.length,
  };

  writeLayoutNormalizedLayerDataOsmFromNetwork(layer, r.segments);
  syncJsonGridFromCoordDataJsonFromPipeline(layer);
  dataStore.saveLayerState(LAYER_ID, jsonGridFromCoordNormalizedPersistPayload(layer));

  return {
    ok: true,
    message: `橫豎化完成（${r.iterations} 輪改善；斜段權重 ${r.costBefore} → ${r.costAfter}）`,
    iterations: r.iterations,
    costBefore: r.costBefore,
    costAfter: r.costAfter,
  };
}
