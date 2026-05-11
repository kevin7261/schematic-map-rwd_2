/**
 * 圖層 json_grid_coord_normalized：座標正規化（模組分檔於本資料夾，對齊 osm_2_geojson_2_json）。
 */

export {
  JSON_GRID_COORD_NORMALIZED_LAYER_ID,
  JSON_GRID_FROM_COORD_NORMALIZED_LAYER_ID,
  POINT_ORTHOGONAL_LAYER_ID,
  LINE_ORTHOGONAL_LAYER_ID,
  LINE_ORTHOGONAL_VERT_FIRST_LAYER_ID,
  LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
  COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID,
  LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
  isLineOrthogonalTowardCenterLayerId,
  isOrthogonalVhDataJsonDrawMirrorLayerId,
  isCoordNormalizedDataJsonMirrorFollowonLayerId,
} from './layerIds.js';
export {
  applyOsm2DataJsonSyncedLayerFromParent,
  resetJsonGridCoordNormalizedPipelineFields,
  syncJsonGridCoordNormalizedDataJsonFromPipeline,
  syncOsm2DataJsonMirrorFromParent,
  jsonGridCoordNormalizedPersistPayload,
  mirrorResetAndPersistJsonGridCoordNormalized,
  reloadJsonGridCoordNormalizedLayer,
} from './mirrorFromOsm2Layer.js';
export {
  applyCoordNormalizedLayerDataJsonToFollowon,
  resetJsonGridFromCoordNormalizedPipelineFields,
  jsonGridFromCoordNormalizedPersistPayload,
  mirrorResetAndPersistJsonGridFromCoordNormalized,
  reloadJsonGridFromCoordNormalizedLayer,
  syncJsonGridFromCoordNormalizedMirrorFromParent,
  refreshLineOrthogonalFromPointOrthogonalIfVisible,
  refreshOrthogonalVhMirrorDrawLayerIfVisible,
  syncJsonGridFromCoordDataJsonFromPipeline,
} from './mirrorFromCoordNormalizedLayer.js';
export { minimalOsmXmlFromLonLatFeatureCollection } from './minimalOsmXmlFromGeoJson.js';
export {
  lineStringFeatureCollectionFromSpaceNetwork,
  writeLayoutNormalizedLayerDataOsmFromNetwork,
  resolveB3InputSpaceNetwork,
  buildC3NetworkForCoordNormalize,
} from './jsonGridCoordNormalizeHelpers.js';
export {
  executeJsonGridCoordNormalize,
  executeJsonGridCoordNormalizedPruneEmptyGridLines,
  executeJsonGridNeighborTopologyFix,
} from './executeJsonGridCoordNormalize.js';
export {
  executeJsonGridFromCoordNormalizedAxisAlign,
  executeJsonGridFromCoordNormalizedPruneEmptyGridLines,
} from './executeJsonGridFromCoordNormalizedAxisAlign.js';
export { replaceDiagonalEdgesWithLOrtho } from './replaceDiagonalEdgesWithLOrtho.js';
export {
  findBestCoPointGroupTargetOnGrid,
  applyBestCoPointGroupMoveOnGrid,
  findBestConnectPointMoveForHV,
} from './axisAlignGridNetworkHillClimb.js';
export { tryOrthoTowardCrossNudgeFromReportItem } from './orthoNudgeTowardCrossCenter.js';
export { applyLineOrthoHubBlueDiagonalPrepassSegments } from './lineOrthoHubBlueDiagonalPrepass.js';
export {
  shallowCloneOrthoSegmentsSynced,
  buildInitialOrthoCoPointGroups,
} from './axisAlignGridNetworkHillClimb.js';
