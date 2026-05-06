/**
 * 空間網絡網格測試_2：a2→b2→c2→d2→e2 管線
 */

export const TAIPEI_TEST_PIPELINES = [
  { a: 'taipei_a2', b: 'taipei_b2', c: 'taipei_c2', d: 'taipei_d2', e: 'taipei_e2' },
];

/** 會觸發 executeFunction 的圖層（a～d） */
export const TAIPEI_TEST_PIPELINE_EXECUTE_LAYER_IDS = TAIPEI_TEST_PIPELINES.flatMap((p) => [
  p.a,
  p.b,
  p.c,
  p.d,
]);

export function getTaipeiTestPipelineByExecuteLayer(layerId) {
  if (layerId == null) return null;
  for (const p of TAIPEI_TEST_PIPELINES) {
    if (p.a === layerId || p.b === layerId || p.c === layerId || p.d === layerId) return p;
  }
  return null;
}

/**
 * @returns {{ pipeline: object, role: 'a'|'b'|'c'|'d', targetB?: string, src?: string, dst?: string } | null}
 */
export function resolveTaipeiTestPipelineStep(layerId) {
  const pipeline = getTaipeiTestPipelineByExecuteLayer(layerId);
  if (!pipeline) return null;
  if (pipeline.a === layerId) return { pipeline, role: 'a', targetB: pipeline.b };
  if (pipeline.b === layerId) return { pipeline, role: 'b', src: pipeline.b, dst: pipeline.c };
  if (pipeline.c === layerId) return { pipeline, role: 'c', src: pipeline.c, dst: pipeline.d };
  if (pipeline.d === layerId) return { pipeline, role: 'd', src: pipeline.d, dst: pipeline.e };
  return null;
}

const C_IDS = ['taipei_c2'];
const D_IDS = ['taipei_d2'];
const E_IDS = ['taipei_e2'];
const B_IDS = ['taipei_b2'];

export function isTaipeiTestBLayerTab(tab) {
  return tab != null && B_IDS.includes(tab);
}

export function isTaipeiTestCLayerTab(tab) {
  return tab != null && C_IDS.includes(tab);
}

export function isTaipeiTestDLayerTab(tab) {
  return tab != null && D_IDS.includes(tab);
}

export function isTaipeiTestELayerTab(tab) {
  return tab != null && E_IDS.includes(tab);
}

export function isTaipeiTestCDLayerTab(tab) {
  return isTaipeiTestCLayerTab(tab) || isTaipeiTestDLayerTab(tab);
}

export function isTaipeiTestCDELayerTab(tab) {
  return isTaipeiTestCLayerTab(tab) || isTaipeiTestDLayerTab(tab) || isTaipeiTestELayerTab(tab);
}

export function isTaipeiTestGridNormLayerTab(tab) {
  return isTaipeiTestCDELayerTab(tab);
}

const F_IDS = ['taipei_f2'];
const G_IDS = ['taipei_g2'];
const H_IDS = ['taipei_h2'];
const I_IDS = [];

export function isTaipeiTestFLayerTab(tab) {
  return tab != null && F_IDS.includes(tab);
}

export function isTaipeiTestGLayerTab(tab) {
  return tab != null && G_IDS.includes(tab);
}

export function isTaipeiTestHLayerTab(tab) {
  return tab != null && H_IDS.includes(tab);
}

export function isTaipeiTestILayerTab(tab) {
  return tab != null && I_IDS.includes(tab);
}

/** f～i 路網／權重層（與原 isTaipeiEfinalSpaceLayerTab 語意相同，含測試2） */
export function isTaipeiTestFghiSpaceLayerTab(tab) {
  return (
    isTaipeiTestFLayerTab(tab) ||
    isTaipeiTestGLayerTab(tab) ||
    isTaipeiTestHLayerTab(tab) ||
    isTaipeiTestILayerTab(tab) ||
    tab === 'taipei_i2'
  );
}

export function isTaipeiTestGOrHWeightLayerTab(tab) {
  return isTaipeiTestGLayerTab(tab) || isTaipeiTestHLayerTab(tab) || tab === 'taipei_i2';
}

/** f～i 含測試2：供 dataProcessor／prune／randomConnect 等 id 判斷 */
export const TAIPEI_TEST_FGHI_LAYER_IDS = [...F_IDS, ...G_IDS, ...H_IDS, ...I_IDS, 'taipei_i2'];

export function isTaipeiTestFghiLayerId(id) {
  return id != null && TAIPEI_TEST_FGHI_LAYER_IDS.includes(id);
}

/** 空間網絡網格測試_3／測試_4（sn4_*）／版面網格測試_1：a3～m3 路網層（含版面網格測試_1 之 k4；末端 connect 藍、交叉 connect 紅、沿線站黑；j3／k3／k4 為 CSV 流量權重語意） */
export const TAIPEI_TEST3_BCDEFG_LAYER_IDS = [
  'taipei_a3',
  'taipei_b3',
  'taipei_c3',
  'taipei_d3',
  'taipei_e3',
  'taipei_f3',
  'taipei_g3',
  'taipei_h3',
  'taipei_i3',
  'taipei_j3',
  'taipei_k3',
  'taipei_sn4_a',
  'taipei_sn4_b',
  'taipei_sn4_c',
  'taipei_sn4_d',
  'taipei_sn4_e',
  'taipei_sn4_f',
  'taipei_sn4_g',
  'taipei_sn4_h',
  'taipei_sn4_i',
  'taipei_sn4_j',
  'taipei_sn4_k',
  'taipei_a5',
  /** 版面網格測試_2：a5→b5；b5→c5 複製後 c5 為 K3 主操作圖層 */
  'taipei_b5',
  'taipei_c5',
  /** 版面網格測試_3：（與測試_2 分群複製）a6→b6；b6→c6 */
  'taipei_a6',
  'taipei_b6',
  'taipei_c6',
  'taipei_l3',
  'taipei_m3',
  'taipei_sn4_l',
  'taipei_sn4_m',
  /** 資料處理_2：分群與 execute 模組複製，圖層 id 尾碼 _2 */
  'taipei_b3_dp_2',
  'taipei_c3_dp_2',
  'taipei_d3_dp_2',
  'taipei_e3_dp_2',
  'taipei_f3_dp_2',
  'taipei_g3_dp_2',
  'taipei_h3_dp_2',
  'taipei_i3_dp_2',
  'taipei_j3_dp_2',
  'taipei_k3_dp_2',
  'taipei_l3_dp_2',
  'taipei_m3_dp_2',
  /** 網格繪製_2：手繪 network_draw_sketch_2 → taipei_*_dp_nd_2 */
  'network_draw_sketch_2',
  'taipei_b3_dp_nd_2',
  'taipei_c3_dp_nd_2',
  'taipei_d3_dp_nd_2',
  'taipei_e3_dp_nd_2',
  'taipei_f3_dp_nd_2',
  'taipei_g3_dp_nd_2',
  'taipei_h3_dp_nd_2',
  'taipei_i3_dp_nd_2',
  'taipei_j3_dp_nd_2',
  'taipei_k3_dp_nd_2',
  'taipei_l3_dp_nd_2',
  'taipei_m3_dp_nd_2',
];

/** @deprecated 請改用 TAIPEI_TEST3_BCDEFG_LAYER_IDS */
export const TAIPEI_TEST3_BCDEF_LAYER_IDS = TAIPEI_TEST3_BCDEFG_LAYER_IDS;

/** @deprecated 請改用 TAIPEI_TEST3_BCDEFG_LAYER_IDS */
export const TAIPEI_TEST3_BCDE_LAYER_IDS = TAIPEI_TEST3_BCDEFG_LAYER_IDS;

/** i3／j3／k3：站點勿用匯出列強制起迄為 connect（改依 nodes，黑點維持黑）；connect 藍／紅依 taipei_h3 全路網度數，勿用切段後子折線度數 */
export function isTaipeiTest3I3OrJ3LayerTab(tab) {
  return (
    tab === 'taipei_i3' ||
    tab === 'taipei_j3' ||
    tab === 'taipei_k3' ||
    tab === 'taipei_a5' ||
    tab === 'taipei_b5' ||
    tab === 'taipei_c5' ||
    tab === 'taipei_a6' ||
    tab === 'taipei_b6' ||
    tab === 'taipei_c6' ||
    tab === 'taipei_l3' ||
    tab === 'taipei_m3' ||
    tab === 'taipei_sn4_i' ||
    tab === 'taipei_sn4_j' ||
    tab === 'taipei_sn4_k' ||
    tab === 'taipei_sn4_l' ||
    tab === 'taipei_sn4_m' ||
    tab === 'taipei_i3_dp_2' ||
    tab === 'taipei_j3_dp_2' ||
    tab === 'taipei_k3_dp_2' ||
    tab === 'taipei_l3_dp_2' ||
    tab === 'taipei_m3_dp_2' ||
    tab === 'taipei_i3_dp_nd_2' ||
    tab === 'taipei_j3_dp_nd_2' ||
    tab === 'taipei_k3_dp_nd_2' ||
    tab === 'taipei_l3_dp_nd_2' ||
    tab === 'taipei_m3_dp_nd_2'
  );
}

/** j3／j3_dp／j3_dp_2／j3_dp_nd：路段流量（CSV）；ControlTab 匯出 JSON 與 taipei_j3 相同語意 */
export function isTaipeiTest3J3TrafficExportLayerTab(tab) {
  return (
    tab === 'taipei_j3' ||
    tab === 'taipei_sn4_j' ||
    tab === 'taipei_j3_dp_2' ||
    tab === 'taipei_j3_dp_nd_2'
  );
}

export function isTaipeiTest3BcdeLayerTab(tab) {
  return tab != null && TAIPEI_TEST3_BCDEFG_LAYER_IDS.includes(tab);
}

export function isTaipeiTest3BcdefLayerTab(tab) {
  return tab != null && TAIPEI_TEST3_BCDEFG_LAYER_IDS.includes(tab);
}

export function isTaipeiTest3BcdefgLayerTab(tab) {
  return tab != null && TAIPEI_TEST3_BCDEFG_LAYER_IDS.includes(tab);
}

/** dataStore 群組「版面網格測試_3」：a6／b6／c6 */
export const LAYOUT_GRID_TEST_3_LAYER_IDS = ['taipei_a6', 'taipei_b6', 'taipei_c6'];

export function isLayoutGridTest3LayerTab(tab) {
  return tab != null && LAYOUT_GRID_TEST_3_LAYER_IDS.includes(tab);
}

/** 與 SpaceNetworkGridTab 車站配置專區一致：a～i 測試路網圖層（含測試2） */
export const TAIPEI_TEST_SPACE_NETWORK_STATION_TAB_IDS = [
  'taipei_a2',
  'taipei_b2',
  'taipei_c2',
  'taipei_d2',
  'taipei_e2',
  'taipei_a3',
  'taipei_b3',
  'taipei_c3',
  'taipei_d3',
  'taipei_e3',
  'taipei_f3',
  'taipei_h3',
  'taipei_i3',
  'taipei_j3',
  'taipei_k3',
  'taipei_sn4_a',
  'taipei_sn4_b',
  'taipei_sn4_c',
  'taipei_sn4_d',
  'taipei_sn4_e',
  'taipei_sn4_f',
  'taipei_sn4_h',
  'taipei_sn4_i',
  'taipei_sn4_j',
  'taipei_sn4_k',
  'taipei_a5',
  'taipei_b5',
  'taipei_c5',
  'taipei_a6',
  'taipei_b6',
  'taipei_c6',
  'taipei_l3',
  'taipei_m3',
  'taipei_sn4_l',
  'taipei_sn4_m',
  'taipei_b3_dp_2',
  'taipei_c3_dp_2',
  'taipei_d3_dp_2',
  'taipei_e3_dp_2',
  'taipei_f3_dp_2',
  'taipei_g3_dp_2',
  'taipei_h3_dp_2',
  'taipei_i3_dp_2',
  'taipei_j3_dp_2',
  'taipei_k3_dp_2',
  'taipei_l3_dp_2',
  'taipei_m3_dp_2',
  'network_draw_sketch_2',
  'taipei_b3_dp_nd_2',
  'taipei_c3_dp_nd_2',
  'taipei_d3_dp_nd_2',
  'taipei_e3_dp_nd_2',
  'taipei_f3_dp_nd_2',
  'taipei_g3_dp_nd_2',
  'taipei_h3_dp_nd_2',
  'taipei_i3_dp_nd_2',
  'taipei_j3_dp_nd_2',
  'taipei_k3_dp_nd_2',
  'taipei_l3_dp_nd_2',
  'taipei_m3_dp_nd_2',
  ...TAIPEI_TEST_FGHI_LAYER_IDS,
];

export function isReducedSchematicPlotLayerId(layerId) {
  return isTaipeiTestCLayerTab(layerId) || isTaipeiTestDLayerTab(layerId);
}

/** 網格正規化 c／d／e 圖層對應的「b」圖層（疊加網格前座標對照） */
export function getTaipeiTestLayerBForGridNormLayer(layerId) {
  if (layerId == null) return null;
  for (const p of TAIPEI_TEST_PIPELINES) {
    if (p.c === layerId || p.d === layerId || p.e === layerId) return p.b;
  }
  return null;
}
