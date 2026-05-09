/** osm_2_geojson_2_json：Upper「OSM XML」檢視用 session；不入 Pinia persist */

export const LAYER_ID = 'osm_2_geojson_2_json';

/** 版面均勻格／JSON 檢視（與 OSM 管線鏡像）：圖層 id 為 json_grid_coord_normalized */
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
