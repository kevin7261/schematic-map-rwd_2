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
  LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID,
  COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID,
  LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
  isLineOrthogonalTowardCenterLayerId,
  isOrthogonalVhDataJsonDrawMirrorLayerId,
  isLayoutNetworkGridFromVhDrawLayerId,
  isSpaceGridVhDrawFamilyLayerId,
  isCoordNormalizedDataJsonMirrorFollowonLayerId,
} from './layerIds.js';
export { jsonViewerPayloadForCoordNormalizedFamilyLayer } from './jsonViewerPayloadForCoordNormalizedFamilyLayer.js';
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
  refreshLayoutNetworkGridFromVhDrawIfVisible,
  syncJsonGridFromCoordDataJsonFromPipeline,
} from './mirrorFromCoordNormalizedLayer.js';
export { minimalOsmXmlFromLonLatFeatureCollection } from './minimalOsmXmlFromGeoJson.js';
export {
  buildVhDrawStationRowsForLayoutMap,
  maxLayoutVhDrawBlackDotsOnLegInOpenXSlab,
  maxLayoutVhDrawBlackDotsOnLegInOpenYSlab,
  buildLayoutNetworkVhDrawMaxBlackDotsPerOrthoLine,
  featureCollectionGridBounds,
  computeLayoutVhDrawFineGridSpec,
  applyLayoutVhDrawFineGridToFeatureCollection,
  gridXYAtGridDistanceAlongLineString,
  integerLatticeBlackDotAtGridArcLengthAlongOrthoLineString,
  integerLatticeBlackDotAtPixelArcLengthAlongLineString,
  layoutVhDrawInteriorTurnVertexIndices,
  computeLayoutVhDrawFineBlackDotsTurnRbRedistribute,
  snapSegmentInteriorToIntegerLattice,
} from './layoutVhDrawFineIntegerGrid.js';
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
export {
  replaceDiagonalEdgesWithLOrtho,
  replaceOneDiagonalInRoute,
  replaceDiagonalsInRouteUntilClear,
} from './replaceDiagonalEdgesWithLOrtho.js';
export {
  listOrthogonalLShapesInFlatSegments,
  orthoBundleHighlightForLShape,
  orthoBundleHighlightForAllLShapes,
} from './listOrthogonalLShapesInFlatSegments.js';
export {
  tryFlipOrthogonalLShapeInFlatSegments,
  flipFirstPossibleOrthogonalLShapeInFlatSegments,
} from './flipOrthogonalLShapeInFlatSegments.js';
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
