/**
 * 圖層 osm_2_geojson_2_json：OSM XML → GeoJSON → 路段 JSON（模組分檔於本資料夾）。
 */

export { LAYER_ID, setOsm2GeojsonSessionOsmXml, getOsm2GeojsonSessionOsmXml } from './sessionOsmXml.js';
export {
  osmXmlStringToGeojsonData,
  geojson_2_json,
  osmXmlToOsm2GeojsonLoaderResult,
  parseLocalOsmXmlStringToRouteLoadResult,
} from './pipeline.js';
export {
  encodeOsm2ArtifactsDirForDataUrl,
  schedulePersistOsm2GeojsonArtifacts,
} from './artifactPersist.js';
export {
  mergeOsm2GeojsonLoaderResultIntoLayer,
  getOsm2GeojsonPersistPatchAfterLoaderMerge,
  applyOsm2GeojsonRouteFieldsFromGeojsonData,
} from './layerMerge.js';
export { executeOsmGeojsonToTaipeiSn4ASpaceGrid } from './executeOsmGeojsonToTaipeiSn4ASpaceGrid.js';
