/**
 * layout_network_grid_from_vh_draw：將 CSV／合成 traffic 對應之數值寫入 VH 繪製層 segment **起點側**站點物件。
 *
 * 規則（與沿路順序 chain = start → stations[] → end 一致）：
 * - `traffic_weight` 僅存在於 **segment.start** 以及 **segment.stations** 各元素（每一條邊的「起點」）。
 * - 語意：該站連向 **沿路下一站** 的 weight。
 * - **segment.end（終點）不得出現 `traffic_weight`**（會清除）。
 *
 * 範例（起點 terminal 掛 weight；迄站無）：
 *   { "station_id":"R01", "station_name":"…", "type":"terminal", "traffic_weight": 1 }
 */

import {
  mapDrawnExportRowsFromJsonDrawRoot,
  mergeSegmentStationsFromPriorExportRows,
} from '@/utils/mapDrawnRoutesImport.js';

/** 根屬性（與 tags 分離）；寫入／清除時會同步清掉同名 tags 避免重複 */
export const LAYOUT_SEGMENT_TRAFFIC_WEIGHT_KEY = 'traffic_weight';

/** @param {*} node */
export function layoutTrafficStationDisplayName(node) {
  if (!node || typeof node !== 'object') return '';
  const tags = node.tags && typeof node.tags === 'object' ? node.tags : {};
  return String(node.station_name ?? tags.station_name ?? tags.name ?? '').trim();
}

export function layoutTrafficUndirectedPairKey(a, b) {
  return [String(a).trim(), String(b).trim()].sort().join('\x00');
}

/**
 * 依 VH 繪製層匯出路段（含 merged 中段站）列舉具站名之相鄰邊，每一無向站對給一筆隨機 weight。
 * @param {*} drawLayer — orthogonal_toward_center_vh_draw 圖層
 * @param {() => number} sampleWeightFn — 應回傳有限數字（例如 1–9）
 * @returns {{a:string,b:string,weight:number}[]}
 */
export function buildSyntheticTrafficRowsFromVhDrawLayer(drawLayer, sampleWeightFn) {
  const sample =
    typeof sampleWeightFn === 'function'
      ? sampleWeightFn
      : () => {
          return 1;
        };
  if (!drawLayer) return [];
  let arr = mapDrawnExportRowsFromJsonDrawRoot(drawLayer.jsonData, drawLayer.dataJson);
  if (!Array.isArray(arr)) arr = [];
  mergeSegmentStationsFromPriorExportRows(arr, drawLayer.processedJsonData);
  const byKey = new Map();
  for (const row of arr) {
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') continue;
    const ordered = [];
    if (seg.start) ordered.push(seg.start);
    if (Array.isArray(seg.stations)) {
      for (const st of seg.stations) ordered.push(st);
    }
    if (seg.end) ordered.push(seg.end);
    for (let i = 0; i < ordered.length - 1; i++) {
      const na = layoutTrafficStationDisplayName(ordered[i]);
      const nb = layoutTrafficStationDisplayName(ordered[i + 1]);
      if (!na || !nb) continue;
      const k = layoutTrafficUndirectedPairKey(na, nb);
      if (byKey.has(k)) continue;
      const w = Number(sample());
      byKey.set(k, {
        a: na,
        b: nb,
        weight: Number.isFinite(w) ? w : 0,
      });
    }
  }
  return [...byKey.values()];
}

/** @param {*} node */
function clearNodeTrafficWeight(node) {
  if (!node || typeof node !== 'object') return;
  delete node[LAYOUT_SEGMENT_TRAFFIC_WEIGHT_KEY];
  const tags = node.tags;
  if (tags && typeof tags === 'object') delete tags[LAYOUT_SEGMENT_TRAFFIC_WEIGHT_KEY];
}

/** @param {unknown[]} exportRows */
export function clearTrafficWeightsFromExportRows(exportRows) {
  if (!Array.isArray(exportRows)) return;
  for (const row of exportRows) {
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') continue;
    clearNodeTrafficWeight(seg.start);
    clearNodeTrafficWeight(seg.end);
    if (Array.isArray(seg.stations)) {
      for (const st of seg.stations) clearNodeTrafficWeight(st);
    }
  }
}

/**
 * @param {unknown[]} exportRows — mapDrawn 匯出列（會就地修改）
 * @param {{a:string,b:string,weight:number}[]} trafficCsvRows
 */
export function applyCsvTrafficWeightsToExportRows(exportRows, trafficCsvRows) {
  clearTrafficWeightsFromExportRows(exportRows);
  if (!Array.isArray(exportRows) || exportRows.length === 0) return;
  if (!Array.isArray(trafficCsvRows) || trafficCsvRows.length === 0) return;

  const trafficMap = new Map();
  for (const r of trafficCsvRows) {
    if (!r || typeof r !== 'object') continue;
    const k = layoutTrafficUndirectedPairKey(r.a, r.b);
    trafficMap.set(k, Number(r.weight));
  }

  for (const row of exportRows) {
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') continue;
    const chain = [];
    if (seg.start) chain.push(seg.start);
    if (Array.isArray(seg.stations)) {
      for (const st of seg.stations) chain.push(st);
    }
    if (seg.end) chain.push(seg.end);
    if (chain.length < 2) continue;

    // 僅邊的起點：chain[0]==start、chain[1..n-2]==stations[*]；終點 chain[last]==end 永不寫入
    for (let i = 0; i < chain.length - 1; i++) {
      const origin = chain[i];
      const dest = chain[i + 1];
      const na = layoutTrafficStationDisplayName(origin);
      const nb = layoutTrafficStationDisplayName(dest);
      if (!na || !nb) continue;
      const w = trafficMap.get(layoutTrafficUndirectedPairKey(na, nb));
      origin[LAYOUT_SEGMENT_TRAFFIC_WEIGHT_KEY] = Number.isFinite(w) ? w : 0;
    }

    clearNodeTrafficWeight(seg.end);
  }
}

/**
 * @param {{ findLayerById: Function }} dataStore — 沿用專案中 dataStore.findLayerById
 * @param {string} vhDrawLayerId
 * @param {{a:string,b:string,weight:number}[]|null|undefined} trafficCsvRows — 清空時傳 [] 或 null
 */
export function applyLayoutTrafficCsvToVhDrawLayerRoots(dataStore, vhDrawLayerId, trafficCsvRows) {
  const drawLayer = dataStore?.findLayerById?.(vhDrawLayerId);
  if (!drawLayer) return;

  /** @type {unknown[][]} */
  const bundles = [];
  const pushUnique = (arr) => {
    if (Array.isArray(arr) && arr.length && !bundles.includes(arr)) bundles.push(arr);
  };

  pushUnique(mapDrawnExportRowsFromJsonDrawRoot(drawLayer.jsonData, drawLayer.dataJson));
  pushUnique(mapDrawnExportRowsFromJsonDrawRoot(drawLayer.processedJsonData, null));

  const hasCsv = Array.isArray(trafficCsvRows) && trafficCsvRows.length > 0;
  for (const rows of bundles) {
    if (hasCsv) applyCsvTrafficWeightsToExportRows(rows, trafficCsvRows);
    else clearTrafficWeightsFromExportRows(rows);
  }
}
