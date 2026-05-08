/**
 * 圖層 `layerId`：比對時請使用 **JSON_GRID_COORD_NORMALIZED_LAYER_ID**（或字面量 `'json_grid_coord_normalized'`）。
 */

export const JSON_GRID_COORD_NORMALIZED_LAYER_ID = 'json_grid_coord_normalized';

export { minimalOsmXmlFromLonLatFeatureCollection } from './minimalOsmXmlFromGeoJson.js';
export {
  lineStringFeatureCollectionFromSpaceNetwork,
  writeLayoutNormalizedLayerDataOsmFromNetwork,
  resolveB3InputSpaceNetwork,
  buildC3NetworkForCoordNormalize,
} from './jsonGridCoordNormalizeHelpers.js';
export { executeJsonGridCoordNormalize } from './executeJsonGridCoordNormalize.js';
