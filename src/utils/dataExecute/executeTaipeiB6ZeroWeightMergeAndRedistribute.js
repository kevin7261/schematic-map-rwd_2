/* eslint-disable no-console */

/**
 * 以 taipei_b6 的 K3Tab（權威來源）為輸入跑零權重黑點合併，寫回 taipei_c6。
 * 與 b4→c4 等管線分檔，版面網格測試_3 專用；舊版 b5 管線已移除。
 *
 * 重要：**輸入固定讀 b6**，不讀 c6。
 */

import { useDataStore } from '@/stores/dataStore.js';
import { runTaipeiB6PipelineFromK3Routes } from '@/utils/dataExecute/taipeiB6PipelineFromK3.js';

export async function executeTaipeiB6ZeroWeightMergeAndRedistribute() {
  const dataStore = useDataStore();
  const a6 = dataStore.findLayerById('taipei_a6');
  const b6 = dataStore.findLayerById('taipei_b6');
  const c6 = dataStore.findLayerById('taipei_c6');
  if (!a6 || !b6 || !c6) {
    console.warn(
      'executeTaipeiB6ZeroWeightMergeAndRedistribute：缺少 taipei_a6／taipei_b6／taipei_c6 圖層'
    );
    return;
  }
  const k3 = b6.spaceNetworkGridJsonDataK3Tab;
  if (!Array.isArray(k3) || k3.length === 0) {
    console.warn(
      'executeTaipeiB6ZeroWeightMergeAndRedistribute：taipei_b6 尚無 K3Tab 路網，請先執行 a6→b6'
    );
    return;
  }

  const summariseWeights = (routes, label, filter) => {
    const rows = [];
    for (const r of routes || []) {
      const name = String(r?.route_name ?? r?.name ?? '');
      const pts = r?.points || [];
      const sw = Array.isArray(r?.station_weights) ? r.station_weights : [];
      const w = sw.map((x) => Number(x?.weight)).filter((v) => Number.isFinite(v));
      const pickSid = (p, fallback) => {
        const props =
          (Array.isArray(p) && p.length > 2 && p[2]) || (p && typeof p === 'object' ? p : null);
        const t = props?.tags;
        return (
          props?.station_name ??
          t?.station_name ??
          t?.name ??
          fallback?.station_name ??
          fallback?.tags?.station_name ??
          fallback?.tags?.name ??
          '?'
        );
      };
      const sName = pickSid(pts[0], r?.properties_start);
      const eName = pickSid(pts[pts.length - 1], r?.properties_end);
      const row = { route: name, from: sName, to: eName, wts: w.join(','), nav: r?.nav_weight };
      if (!filter || filter(row)) rows.push(row);
    }
    console.log(`[c6 merge debug] ${label}：${rows.length} rows`);
    console.table(rows);
  };

  const onlyBannan = (row) => row.route === '板南線';
  summariseWeights(k3, 'INPUT b6.K3Tab (板南線)', onlyBannan);

  const { removedBlackDots, scaledSegs, initialSegmentCount, blackPlacementStats } =
    await runTaipeiB6PipelineFromK3Routes(dataStore, a6, c6, k3, {
      zeroWeightMerge: true,
      mergeMaxWeightDiff: dataStore.taipeiK3MergeMaxWeightDiff,
      sourceLabel: 'executeTaipeiB6ZeroWeightMergeAndRedistribute',
    });

  summariseWeights(c6.spaceNetworkGridJsonDataK3Tab, 'OUTPUT c6.K3Tab (板南線)', onlyBannan);
  summariseWeights(
    c6.layoutGridJsonData,
    'OUTPUT c6.layoutGridJsonData ← LayoutGridTab 讀這個 (板南線)',
    onlyBannan
  );
  summariseWeights(c6.spaceNetworkGridJsonData, 'OUTPUT c6.spaceNetworkGridJsonData (板南線)', onlyBannan);

  const summariseProcessed = (rows, label) => {
    if (!Array.isArray(rows)) {
      console.log(`[c6 merge debug] ${label}: (not array)`, rows);
      return;
    }
    const out = [];
    for (const r of rows) {
      const routeName = String(r?.routeName ?? r?.route_name ?? r?.properties?.route_name ?? '');
      if (routeName !== '板南線') continue;
      const seg = r?.segment || r?.properties?.segment || {};
      const start = seg.start || {};
      const end = seg.end || {};
      const sw = Array.isArray(r?.station_weights)
        ? r.station_weights
        : Array.isArray(r?.properties?.station_weights)
          ? r.properties.station_weights
          : [];
      const w = sw.map((x) => Number(x?.weight)).filter((v) => Number.isFinite(v));
      out.push({
        route: routeName,
        from: start.station_name ?? '?',
        to: end.station_name ?? '?',
        wts: w.join(','),
        nav: r?.nav_weight ?? r?.properties?.nav_weight,
      });
    }
    console.log(`[c6 merge debug] ${label}：${out.length} rows`);
    console.table(out);
  };
  summariseProcessed(c6.processedJsonData, 'OUTPUT c6.processedJsonData (板南線)');
  summariseProcessed(c6.processedJsonDataK3Tab, 'OUTPUT c6.processedJsonDataK3Tab (板南線)');

  console.log(
    `c6 手動零權重合併完成：合併 ${removedBlackDots.length} 個零權重黑點；` +
      `黑點配置 ${blackPlacementStats.placedBlackSectionCount} 段，` +
      `切段後路段數 ${scaledSegs.length}（輸入 ${initialSegmentCount} 段）`
  );
}
