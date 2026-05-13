/** 圖層 id 單一來源，供本資料夾模組共用（避免 index ↔ 子檔 circular import） */

export const JSON_GRID_COORD_NORMALIZED_LAYER_ID = 'json_grid_coord_normalized';

/** 站點移動水平垂直化（layerId：point_orthogonal） */
export const POINT_ORTHOGONAL_LAYER_ID = 'point_orthogonal';

/** 站點與路線往示意圖中心聚集（橫／豎正交路網），佇序列→欄（HV）；layerId：`orthogonal_toward_center_hv`；dataJson 優先自 {@link POINT_ORTHOGONAL_LAYER_ID}，空則自座標正規化層 */
export const LINE_ORTHOGONAL_LAYER_ID = 'orthogonal_toward_center_hv';

/** 與 {@link LINE_ORTHOGONAL_LAYER_ID} 同一演算法與管線；控制台佇列順序為欄→列（VH）；layerId：`orthogonal_toward_center_vh` */
export const LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID = 'orthogonal_toward_center_vh';

/** 僅繪製／檢視：鏡像 {@link LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID} 之 dataJson（無編輯管線）；layerId：`orthogonal_toward_center_vh_draw` */
export const LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID = 'orthogonal_toward_center_vh_draw';

/**
 * 版面網絡網格：僅檢視，**dataOSM** 自 {@link LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID} 複製（geojson 由該 OSM 解析）。
 * layerId：`layout_network_grid_from_vh_draw`
 */
export const LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID = 'layout_network_grid_from_vh_draw';

/**
 * 僅檢視：深拷 **`layout_network_grid_from_vh_draw`** 之 **dataJson**／**jsonData**（與 Upper json-viewer 同源之匯出列）。
 * layerId：`layout_network_grid_read_layout_data_json`
 */
export const LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID =
  'layout_network_grid_read_layout_data_json';

/** @param {string|undefined|null} layerId */
export function isLayoutNetworkGridReadLayoutDataJsonLayerId(layerId) {
  return layerId === LAYOUT_NETWORK_GRID_READ_LAYOUT_DATA_JSON_LAYER_ID;
}

/** @param {string|undefined|null} layerId */
export function isOrthogonalVhDataJsonDrawMirrorLayerId(layerId) {
  return layerId === LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID;
}

/** @param {string|undefined|null} layerId */
export function isLayoutNetworkGridFromVhDrawLayerId(layerId) {
  return layerId === LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID;
}

/** 先直後橫·繪製層與其版面網絡複本（示意網格／orthoBundle 等同一套繪製邏輯） */
export function isSpaceGridVhDrawFamilyLayerId(layerId) {
  return (
    isOrthogonalVhDataJsonDrawMirrorLayerId(layerId) ||
    isLayoutNetworkGridFromVhDrawLayerId(layerId) ||
    isLayoutNetworkGridReadLayoutDataJsonLayerId(layerId)
  );
}

/** 僅檢視：列出「座標正規化」dataJson 路網之 connect 紅／藍點（與父層同資料來源） */
export const COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID = 'coord_normalized_red_blue_connect';

export const LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS = Object.freeze([
  LINE_ORTHOGONAL_LAYER_ID,
  LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID,
]);

/** @param {string|undefined|null} layerId */
export function isLineOrthogonalTowardCenterLayerId(layerId) {
  return layerId != null && LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS.includes(layerId);
}

/** 自 {@link JSON_GRID_COORD_NORMALIZED_LAYER_ID} 鏡像 dataJson 之衍生層（站點垂直化、紅藍點表、線網往中心、VH 繪製鏡像） */
export function isCoordNormalizedDataJsonMirrorFollowonLayerId(layerId) {
  return (
    layerId === POINT_ORTHOGONAL_LAYER_ID ||
    layerId === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
    isLineOrthogonalTowardCenterLayerId(layerId) ||
    isOrthogonalVhDataJsonDrawMirrorLayerId(layerId) ||
    isLayoutNetworkGridFromVhDrawLayerId(layerId)
  );
}

/** @deprecated 請用 {@link POINT_ORTHOGONAL_LAYER_ID} */
export const JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID = POINT_ORTHOGONAL_LAYER_ID;
