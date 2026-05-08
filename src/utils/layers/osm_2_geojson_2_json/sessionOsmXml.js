/** osm_2_geojson_2_json：Upper「OSM XML」檢視用 session；不入 Pinia persist */

export const LAYER_ID = 'osm_2_geojson_2_json';

/** Upper 專用 D3 示意：內容自 {@link LAYER_ID} 之 dataJson／jsonData 同步；不上地圖 */
export const SPACE_LAYOUT_GRID_VIEWER_LAYER_ID = 'osm_2_geojson_2_json__space_layout_grid';

let sessionOsmXmlSourceText = '';

export function setOsm2GeojsonSessionOsmXml(text) {
  sessionOsmXmlSourceText = typeof text === 'string' ? text : '';
}

export function getOsm2GeojsonSessionOsmXml() {
  return sessionOsmXmlSourceText;
}
