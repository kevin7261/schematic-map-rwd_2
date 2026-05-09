/** osm_2_geojson_2_json：Upper「OSM XML」檢視用 session；不入 Pinia persist */

export const LAYER_ID = 'osm_2_geojson_2_json';

/** 是否為「座標正規化」圖層（json_grid_coord_normalized）；供 OSM 管線 JSON 檢視等沿用 */
export function isSpaceLayoutUniformGridViewerLayerId(layerId) {
  return layerId === 'json_grid_coord_normalized';
}

let sessionOsmXmlSourceText = '';

export function setOsm2GeojsonSessionOsmXml(text) {
  sessionOsmXmlSourceText = typeof text === 'string' ? text : '';
}

export function getOsm2GeojsonSessionOsmXml() {
  return sessionOsmXmlSourceText;
}
