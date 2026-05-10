/** 圖層 id 單一來源，供本資料夾模組共用（避免 index ↔ 子檔 circular import） */

export const JSON_GRID_COORD_NORMALIZED_LAYER_ID = 'json_grid_coord_normalized';

/** 站點移動水平垂直化（layerId：point_orthogonal） */
export const POINT_ORTHOGONAL_LAYER_ID = 'point_orthogonal';

/** 站點與路線往示意圖中心聚集（橫／豎正交路網）；dataJson 優先自 {@link POINT_ORTHOGONAL_LAYER_ID}，空則自座標正規化層 */
export const LINE_ORTHOGONAL_LAYER_ID = 'orthogonal_toward_center';

/** @deprecated 請用 {@link POINT_ORTHOGONAL_LAYER_ID} */
export const JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID = POINT_ORTHOGONAL_LAYER_ID;
