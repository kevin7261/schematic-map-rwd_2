/** 圖層 id 單一來源，供本資料夾模組共用（避免 index ↔ 子檔 circular import） */

export const JSON_GRID_COORD_NORMALIZED_LAYER_ID = 'json_grid_coord_normalized';

/** 站點移動水平垂直化（layerId：point_orthogonal） */
export const POINT_ORTHOGONAL_LAYER_ID = 'point_orthogonal';

/** 站點與路線往示意圖中心聚集（橫／豎正交路網）；dataJson 優先自 {@link POINT_ORTHOGONAL_LAYER_ID}，空則自座標正規化層 */
export const LINE_ORTHOGONAL_LAYER_ID = 'orthogonal_toward_center';

/** 與 {@link LINE_ORTHOGONAL_LAYER_ID} 同一演算法與管線；控制台佇列順序改為**欄→列**循環 */
export const LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID = 'orthogonal_toward_center_vert_first';

export const LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS = Object.freeze([
  LINE_ORTHOGONAL_LAYER_ID,
  LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID,
]);

/** @param {string|undefined|null} layerId */
export function isLineOrthogonalTowardCenterLayerId(layerId) {
  return layerId != null && LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS.includes(layerId);
}

/** @deprecated 請用 {@link POINT_ORTHOGONAL_LAYER_ID} */
export const JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID = POINT_ORTHOGONAL_LAYER_ID;
