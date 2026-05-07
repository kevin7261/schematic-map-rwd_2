/**
 * 圖層 osm_2_geojson_2_json：OSM XML → GeoJSON → 路段 JSON（模組分檔於本資料夾）。
 */

export { LAYER_ID, setOsm2GeojsonSessionOsmXml, getOsm2GeojsonSessionOsmXml } from './sessionOsmXml.js';
export {
  osm_2_geojson,
  geojson_2_json,
  osmXmlToOsm2GeojsonLoaderResult,
  parseLocalOsmXmlStringToRouteLoadResult,
} from './pipeline.js';
export {
  mergeOsm2GeojsonLoaderResultIntoLayer,
  getOsm2GeojsonPersistPatchAfterLoaderMerge,
  applyOsm2GeojsonRouteFieldsFromGeojsonData,
} from './layerMerge.js';
export { executeOsmGeojsonToTaipeiSn4ASpaceGrid } from './executeOsmGeojsonToTaipeiSn4ASpaceGrid.js';
