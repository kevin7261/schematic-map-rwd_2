/* eslint-disable no-console */

/**
 * 以 taipei_b5 的 K3Tab（權威來源）為輸入跑零權重黑點合併，寫回 taipei_c5。
 *
 * 重要：**輸入固定讀 b5**，不讀 c5。否則重複按「開始執行」會把上一次合併後的
 * max(97,78)=97 回填進 c5，再次合併時 78 已消失、下一輪變成把其他鄰段也拉成 97，
 * 永久污染 c5（「根本沒改」現象即此因）。
 */

import { useDataStore } from '@/stores/dataStore.js';
import { runTaipeiB5PipelineFromK3Routes } from '@/utils/dataExecute/taipeiB5PipelineFromK3.js';

export async function executeTaipeiB5ZeroWeightMergeAndRedistribute() {
  const dataStore = useDataStore();
  const a5 = dataStore.findLayerById('taipei_a5');
  const b5 = dataStore.findLayerById('taipei_b5');
  const c5 = dataStore.findLayerById('taipei_c5');
  if (!a5 || !b5 || !c5) {
    console.warn(
      'executeTaipeiB5ZeroWeightMergeAndRedistribute：缺少 taipei_a5／taipei_b5／taipei_c5 圖層'
    );
    return;
  }
  const k3 = b5.spaceNetworkGridJsonDataK3Tab;
  if (!Array.isArray(k3) || k3.length === 0) {
    console.warn(
      'executeTaipeiB5ZeroWeightMergeAndRedistribute：taipei_b5 尚無 K3Tab 路網，請先執行 a5→b5'
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
    console.log(`[c5 merge debug] ${label}：${rows.length} rows`);
    console.table(rows);
  };

  const onlyBannan = (row) => row.route === '板南線';
  summariseWeights(k3, 'INPUT b5.K3Tab (板南線)', onlyBannan);

  const { removedBlackDots, scaledSegs, initialSegmentCount, blackPlacementStats } =
    await runTaipeiB5PipelineFromK3Routes(dataStore, a5, c5, k3, {
      zeroWeightMerge: true,
      mergeMaxWeightDiff: dataStore.taipeiK3MergeMaxWeightDiff,
      sourceLabel: 'executeTaipeiB5ZeroWeightMergeAndRedistribute',
    });

  summariseWeights(c5.spaceNetworkGridJsonDataK3Tab, 'OUTPUT c5.K3Tab (板南線)', onlyBannan);
  summariseWeights(
    c5.layoutGridJsonData,
    'OUTPUT c5.layoutGridJsonData ← LayoutGridTab 讀這個 (板南線)',
    onlyBannan
  );
  summariseWeights(
    c5.spaceNetworkGridJsonData,
    'OUTPUT c5.spaceNetworkGridJsonData (板南線)',
    onlyBannan
  );

  const summariseProcessed = (rows, label) => {
    if (!Array.isArray(rows)) {
      console.log(`[c5 merge debug] ${label}: (not array)`, rows);
      return;
    }
    const out = [];
    for (const r of rows) {
      const routeName = String(
        r?.routeName ?? r?.route_name ?? r?.properties?.route_name ?? ''
      );
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
    console.log(`[c5 merge debug] ${label}：${out.length} rows`);
    console.table(out);
  };
  summariseProcessed(c5.processedJsonData, 'OUTPUT c5.processedJsonData (板南線)');
  summariseProcessed(
    c5.processedJsonDataK3Tab,
    'OUTPUT c5.processedJsonDataK3Tab (板南線)'
  );

  console.log(
    `c5 手動零權重合併完成：合併 ${removedBlackDots.length} 個零權重黑點；` +
      `黑點配置 ${blackPlacementStats.placedBlackSectionCount} 段，` +
      `切段後路段數 ${scaledSegs.length}（輸入 ${initialSegmentCount} 段）`
  );
}
