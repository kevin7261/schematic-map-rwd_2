/** 圖層 id 單一來源，供本資料夾模組共用（避免 index ↔ 子檔 circular import） */

export const JSON_GRID_COORD_NORMALIZED_LAYER_ID = 'json_grid_coord_normalized';

/** 衍生圖層：開啟時自 {@link JSON_GRID_COORD_NORMALIZED_LAYER_ID} 複製 dataJson／geojson（預留後續功能） */
export const JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID = 'json_grid_from_coord_normalized';
