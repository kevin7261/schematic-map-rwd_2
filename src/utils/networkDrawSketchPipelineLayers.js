/**
 * 手繪 sketch 與「網絡／網格繪製」管線 b 層一對一對應（執行下一步寫入目標）。
 * 各條管線圖層 id 獨立，不與其他群組共用。
 */
export const NETWORK_DRAW_SKETCH_TO_B3_LAYER_ID = {
  network_draw_sketch_2: 'taipei_b3_dp_nd_2',
};

/** @returns {string[]} */
export function getAllNetworkDrawSketchLayerIds() {
  return Object.keys(NETWORK_DRAW_SKETCH_TO_B3_LAYER_ID);
}

/**
 * @param {string} sketchLayerId
 * @returns {string|null}
 */
export function networkDrawPipelineB3LayerIdForSketch(sketchLayerId) {
  if (sketchLayerId == null) return null;
  return NETWORK_DRAW_SKETCH_TO_B3_LAYER_ID[sketchLayerId] ?? null;
}

/**
 * @param {string} layerId
 * @returns {boolean}
 */
export function isRegisteredNetworkDrawSketchLayerId(layerId) {
  return layerId != null && Object.prototype.hasOwnProperty.call(NETWORK_DRAW_SKETCH_TO_B3_LAYER_ID, layerId);
}

/**
 * @param {string} layerId
 * @returns {boolean}
 */
export function isNetworkDrawSketchPipelineB3LayerId(layerId) {
  if (layerId == null) return false;
  if (Object.values(NETWORK_DRAW_SKETCH_TO_B3_LAYER_ID).includes(layerId)) return true;
  return typeof layerId === 'string' && /_dp_nd_2$/.test(layerId);
}
