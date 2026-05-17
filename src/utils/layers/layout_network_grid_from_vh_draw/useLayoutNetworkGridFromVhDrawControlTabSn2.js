/**
 * Control 分頁：版面網絡網格／版面網絡網格_2 家族（layout_network_grid_from_vh_draw*_sn2）
 * 與 {@link ./useLayoutNetworkGridFromVhDrawControlTab.js} 同源，程式路徑改為 json_grid_coord_normalized_sn2（不依賴主群組實作）。
 */
import { nextTick, reactive } from 'vue';
import {
  LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID,
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY,
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2,
  LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2,
  LAYOUT_VH_DRAW_COPY_GRID_NEIGHBOR_HIDE_MIN_PT,
  jsonGridFromCoordNormalizedPersistPayload,
  syncLayoutNetworkGridRoutesDataJsonFromVhDraw,
  syncLayoutNetworkGridRoutesDataJsonFromVhDrawCopy,
  syncLayoutNetworkGridRoutesDataJsonFromVhDraw2,
  mirrorResetAndPersistLayoutNetworkGridReadLayoutDataJsonLayer2,
  applyLayoutTrafficCsvToVhDrawLayerRoots,
  buildSyntheticTrafficRowsFromVhDrawLayer,
} from '@/utils/layers/json_grid_coord_normalized_sn2/index.js';

/**
 * @param {{
 *   dataStore: import('@/stores/dataStore.js').ReturnType;
 *   pickOrthogonalVhDrawLocalJsonClick: () => void;
 * }} opts
 */
export function useLayoutNetworkGridFromVhDrawControlTabSn2({
  dataStore,
  pickOrthogonalVhDrawLocalJsonClick,
}) {
  const persistLayoutVhDrawGridRoutesDataJsonSnapshot = () => {
    syncLayoutNetworkGridRoutesDataJsonFromVhDraw((id) => dataStore.findLayerById(id));
    const lay = dataStore.findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID);
    if (lay) {
      dataStore.saveLayerState(
        lay.layerId,
        jsonGridFromCoordNormalizedPersistPayload(lay, { omitLoadingFlags: true })
      );
    }
  };

  const persistLayoutVhDrawGridRoutesDataJsonSnapshotCopy = () => {
    syncLayoutNetworkGridRoutesDataJsonFromVhDrawCopy((id) => dataStore.findLayerById(id));
    const lay = dataStore.findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY);
    if (lay) {
      dataStore.saveLayerState(
        lay.layerId,
        jsonGridFromCoordNormalizedPersistPayload(lay, { omitLoadingFlags: true })
      );
    }
  };

  const persistLayoutVhDrawGridRoutesDataJsonSnapshot2 = () => {
    syncLayoutNetworkGridRoutesDataJsonFromVhDraw2((id) => dataStore.findLayerById(id));
    const lay = dataStore.findLayerById(LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2);
    if (lay) {
      dataStore.saveLayerState(
        lay.layerId,
        jsonGridFromCoordNormalizedPersistPayload(lay, { omitLoadingFlags: true })
      );
    }
    const readLyr = dataStore.findLayerById(LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID_2);
    if (readLyr) {
      mirrorResetAndPersistLayoutNetworkGridReadLayoutDataJsonLayer2(
        (id) => dataStore.findLayerById(id),
        dataStore.saveLayerState,
        readLyr
      );
    }
  };

  const isLayoutNetworkGridFromVhDrawControlLayer = (lyr) =>
    lyr &&
    (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID ||
      lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY ||
      lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2);

  const layoutVhDrawCopyRowsSortedByWeightDiffAsc = (lyr) => {
    if (!lyr || lyr.layerId !== LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY) return [];
    const rows = lyr.dataTableData;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return [...rows].sort((a, b) => {
      const da = Number(a?.weight_差值);
      const db = Number(b?.weight_差值);
      const na = Number.isFinite(da) ? da : 0;
      const nb = Number.isFinite(db) ? db : 0;
      if (na !== nb) return na - nb;
      const ia = Number(a?.['#']);
      const ib = Number(b?.['#']);
      if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
      return 0;
    });
  };

  const onLayoutNetworkLoadTrafficCsvClick = async (lyr) => {
    if (!isLayoutNetworkGridFromVhDrawControlLayer(lyr)) return;
    try {
      const rel = String(lyr.csvFileName_traffic ?? '').trim();
      if (!rel || rel.includes('..')) throw new Error('無效的 csvFileName_traffic');
      const base = process.env.BASE_URL ?? '/';
      const csvUrl = `${base.endsWith('/') ? base : `${base}/`}data/${rel}`;
      const resp = await fetch(csvUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 2) throw new Error('CSV 內容不足');
      const header = lines[0].split(',');
      const aIdx = header.findIndex((c) => c.includes('站點A'));
      const bIdx = header.findIndex((c) => c.includes('站點B'));
      const wIdx = header.findIndex((c) => c.includes('總人次') || c === 'weight');
      if (aIdx < 0 || bIdx < 0 || wIdx < 0)
        throw new Error(`CSV 欄位未找到（header: ${header.join(',')}）`);
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length <= Math.max(aIdx, bIdx, wIdx)) continue;
        const a = parts[aIdx].trim();
        const b = parts[bIdx].trim();
        const w = Number(parts[wIdx]);
        if (!a || !b || !Number.isFinite(w)) continue;
        data.push({ a, b, weight: w });
      }
      lyr.layoutVhDrawTrafficData = data;
      lyr.layoutVhDrawTrafficMissing = [];
      applyLayoutTrafficCsvToVhDrawLayerRoots(
        dataStore,
        LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
        data
      );
      const vhDraw = dataStore.findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
      if (vhDraw) {
        dataStore.saveLayerState(vhDraw.layerId, {
          jsonData: vhDraw.jsonData,
          dataJson: vhDraw.dataJson,
          processedJsonData: vhDraw.processedJsonData,
        });
      }
      if (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) {
        persistLayoutVhDrawGridRoutesDataJsonSnapshot2();
      } else if (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY) {
        persistLayoutVhDrawGridRoutesDataJsonSnapshotCopy();
      } else {
        persistLayoutVhDrawGridRoutesDataJsonSnapshot();
      }
      await nextTick();
      dataStore.requestSpaceNetworkGridFullRedraw();
    } catch (err) {
      console.error(err);
      window.alert('載入 CSV 失敗：' + err.message);
    }
  };

  const onLayoutNetworkClearTrafficCsvClick = async (lyr) => {
    if (!isLayoutNetworkGridFromVhDrawControlLayer(lyr)) return;
    lyr.layoutVhDrawTrafficData = null;
    lyr.layoutVhDrawTrafficMissing = [];
    applyLayoutTrafficCsvToVhDrawLayerRoots(
      dataStore,
      LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
      null
    );
    const vhDrawClear = dataStore.findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
    if (vhDrawClear) {
      dataStore.saveLayerState(vhDrawClear.layerId, {
        jsonData: vhDrawClear.jsonData,
        dataJson: vhDrawClear.dataJson,
        processedJsonData: vhDrawClear.processedJsonData,
      });
    }
    if (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) {
      persistLayoutVhDrawGridRoutesDataJsonSnapshot2();
    } else if (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY) {
      persistLayoutVhDrawGridRoutesDataJsonSnapshotCopy();
    } else {
      persistLayoutVhDrawGridRoutesDataJsonSnapshot();
    }
    await nextTick();
    dataStore.requestSpaceNetworkGridFullRedraw();
  };

  const onLayoutVhDrawShowTrafficWeightsChange = async (lyr, checked) => {
    if (!isLayoutNetworkGridFromVhDrawControlLayer(lyr)) return;
    lyr.layoutVhDrawShowTrafficWeights = checked;
    await nextTick();
    dataStore.requestSpaceNetworkGridFullRedraw();
  };

  const onLayoutVhDrawShowBlackDotRowColRatioOverlayChange = async (lyr, checked) => {
    if (!isLayoutNetworkGridFromVhDrawControlLayer(lyr)) return;
    lyr.layoutVhDrawShowBlackDotRowColRatioOverlay = checked === true;
    dataStore.saveLayerState(
      lyr.layerId,
      jsonGridFromCoordNormalizedPersistPayload(lyr, { omitLoadingFlags: true })
    );
    await nextTick();
    dataStore.requestSpaceNetworkGridFullRedraw();
  };

  const onLayoutVhDrawCopyWeightedNeighborHideMinPtChange = async (lyr, ev) => {
    if (!lyr || lyr.layerId !== LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY) return;
    let v = Number(ev?.target?.value);
    if (!Number.isFinite(v)) v = LAYOUT_VH_DRAW_COPY_GRID_NEIGHBOR_HIDE_MIN_PT;
    v = Math.min(99, Math.max(0.25, v));
    lyr.layoutVhDrawWeightedNeighborHideMinPt = v;
    dataStore.saveLayerState(
      lyr.layerId,
      jsonGridFromCoordNormalizedPersistPayload(lyr, { omitLoadingFlags: true })
    );
    await nextTick();
    dataStore.requestSpaceNetworkGridFullRedraw();
  };

  const sampleLayoutTrafficWeight1to9InverseGeometric = (ratio = 2) => {
    const r = Math.max(1.0001, Number(ratio));
    const weights = [];
    let sum = 0;
    for (let k = 1; k <= 9; k++) {
      const w = 1 / r ** k;
      weights.push(w);
      sum += w;
    }
    let u = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) {
      u -= weights[i];
      if (u <= 0) return i + 1;
    }
    return 9;
  };

  const onLayoutNetworkRandomizeTrafficWeightsClick = async (lyr) => {
    if (!isLayoutNetworkGridFromVhDrawControlLayer(lyr)) return;
    const vhDraw = dataStore.findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
    if (!vhDraw) {
      window.alert('找不到 VH 繪製層（orthogonal_toward_center_vh_draw_sn2）。');
      return;
    }

    let dataRows = lyr.layoutVhDrawTrafficData;
    if (!Array.isArray(dataRows) || dataRows.length === 0) {
      const synthetic = buildSyntheticTrafficRowsFromVhDrawLayer(vhDraw, () =>
        sampleLayoutTrafficWeight1to9InverseGeometric(2)
      );
      if (!synthetic.length) {
        window.alert(
          '尚無具站名的相鄰路段可產生 weight。請確認 VH 繪製層已有路網與站名，或改用載入 CSV。'
        );
        return;
      }
      lyr.layoutVhDrawTrafficData = synthetic;
      dataRows = synthetic;
    } else {
      for (const row of dataRows) {
        if (!row || typeof row !== 'object') continue;
        row.weight = sampleLayoutTrafficWeight1to9InverseGeometric(2);
      }
    }

    lyr.layoutVhDrawTrafficMissing = [];
    applyLayoutTrafficCsvToVhDrawLayerRoots(
      dataStore,
      LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
      lyr.layoutVhDrawTrafficData
    );
    const vhDrawRand = dataStore.findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
    if (vhDrawRand) {
      dataStore.saveLayerState(vhDrawRand.layerId, {
        jsonData: vhDrawRand.jsonData,
        dataJson: vhDrawRand.dataJson,
        processedJsonData: vhDrawRand.processedJsonData,
      });
    }
    if (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2) {
      persistLayoutVhDrawGridRoutesDataJsonSnapshot2();
    } else if (lyr.layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY) {
      persistLayoutVhDrawGridRoutesDataJsonSnapshotCopy();
    } else {
      persistLayoutVhDrawGridRoutesDataJsonSnapshot();
    }
    await nextTick();
    dataStore.requestSpaceNetworkGridFullRedraw();
  };

  return reactive({
    LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID,
    LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY,
    LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_2,
    LAYOUT_VH_DRAW_COPY_GRID_NEIGHBOR_HIDE_MIN_PT,
    isLayoutNetworkGridFromVhDrawControlLayer,
    layoutVhDrawCopyRowsSortedByWeightDiffAsc,
    pickOrthogonalVhDrawLocalJsonClick,
    onLayoutNetworkLoadTrafficCsvClick,
    onLayoutNetworkClearTrafficCsvClick,
    onLayoutVhDrawShowTrafficWeightsChange,
    onLayoutVhDrawShowBlackDotRowColRatioOverlayChange,
    onLayoutVhDrawCopyWeightedNeighborHideMinPtChange,
    onLayoutNetworkRandomizeTrafficWeightsClick,
  });
}
