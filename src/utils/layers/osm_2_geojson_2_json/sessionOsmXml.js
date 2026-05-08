/** osm_2_geojson_2_json：Upper「OSM XML」檢視用 session；不入 Pinia persist */

export const LAYER_ID = 'osm_2_geojson_2_json';

/** Upper「json 繪製」子圖層：內容自 {@link LAYER_ID} 之 dataJson／jsonData 同步；不上地圖 */
export const SPACE_LAYOUT_GRID_VIEWER_LAYER_ID = 'json_draw';

/** Upper「json 繪製·讀檔」：唯讀複製 {@link SPACE_LAYOUT_GRID_VIEWER_LAYER_ID} 之 dataJson／格線；不上地圖 */
export const JSON_DRAW_LAYOUT_READ_LAYER_ID = 'json_draw_layout_read';

/** 版面均勻格／JSON 檢視：含主圖層與讀檔鏡像 */
export function isSpaceLayoutUniformGridViewerLayerId(layerId) {
  return (
    layerId === SPACE_LAYOUT_GRID_VIEWER_LAYER_ID ||
    layerId === JSON_DRAW_LAYOUT_READ_LAYER_ID
  );
}

let sessionOsmXmlSourceText = '';

export function setOsm2GeojsonSessionOsmXml(text) {
  sessionOsmXmlSourceText = typeof text === 'string' ? text : '';
}

export function getOsm2GeojsonSessionOsmXml() {
  return sessionOsmXmlSourceText;
}
