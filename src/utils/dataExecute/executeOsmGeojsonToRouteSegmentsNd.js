/**
 * 網絡／網格繪製群組：手繪 sketch 之 GeoJSON → 路段 JSON → 對應 b 層。
 * 使用 buildTaipeiB3ExecuteLayerFieldsFromGeojson（@/utils/taipeiTest3）。
 */

/* eslint-disable no-console */

import { useDataStore } from '@/stores/dataStore.js';
import { buildTaipeiB3ExecuteLayerFieldsFromGeojson } from '@/utils/taipeiTest3/buildTaipeiA3StyleLayerFieldsFromGeojson.js';
import { sketchPolylinesWgs84ToGeoJsonFeatureCollection } from '@/utils/networkDrawSketchToSpaceNetworkSegments.js';

/**
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
function resolveSketchFeatureCollectionForNd(dataStore, sketchLayer, sketchLayerId) {
  const exported = sketchLayer?.networkDrawSketchExportWgs84GeoJson;
  if (
    exported &&
    exported.type === 'FeatureCollection' &&
    Array.isArray(exported.features) &&
    exported.features.length > 0
  ) {
    return exported;
  }

  const lines = dataStore.getNetworkDrawSketchPolylinesForLayer(sketchLayerId);
  const markers = dataStore.getNetworkDrawSketchMarkersForLayer(sketchLayerId);
  if (!dataStore.getNetworkDrawSketchUseGeoForLayer(sketchLayerId)) {
    throw new Error('請使用 WGS84 手繪模式，或先在空間網格執行下一步以產生匯出 GeoJSON');
  }
  if (!Array.isArray(lines) || !lines.some((pl) => pl && pl.length >= 2)) {
    throw new Error('手繪折線不足（至少一條含兩點以上），無法轉成路段資料');
  }

  return sketchPolylinesWgs84ToGeoJsonFeatureCollection(lines, {
    markersWgs84: markers,
  });
}

/**
 * @param {string} sketchLayerId
 * @param {string} targetB3LayerId
 */
function executeOsmGeojsonToRouteSegmentsNdWithPair(sketchLayerId, targetB3LayerId) {
  const dataStore = useDataStore();
  const sketchLayer = dataStore.findLayerById(sketchLayerId);
  const tgt = dataStore.findLayerById(targetB3LayerId);

  if (!sketchLayer) {
    throw new Error(`找不到手繪圖層 ${sketchLayerId}`);
  }
  if (!tgt) {
    throw new Error(`找不到目標圖層 ${targetB3LayerId}`);
  }

  const fc = resolveSketchFeatureCollectionForNd(dataStore, sketchLayer, sketchLayerId);
  if (sketchLayer.networkDrawSketchExportWgs84GeoJson == null) {
    sketchLayer.networkDrawSketchExportWgs84GeoJson = JSON.parse(JSON.stringify(fc));
  }

  const derived = buildTaipeiB3ExecuteLayerFieldsFromGeojson(fc, { compactStationNumericIds: true });
  tgt.processedJsonData = derived.processedJsonData;
  tgt.spaceNetworkGridJsonData = derived.spaceNetworkGridJsonData;
  tgt.spaceNetworkGridJsonData_SectionData = derived.spaceNetworkGridJsonData_SectionData;
  tgt.spaceNetworkGridJsonData_ConnectData = derived.spaceNetworkGridJsonData_ConnectData;
  tgt.spaceNetworkGridJsonData_StationData = derived.spaceNetworkGridJsonData_StationData;
  tgt.showStationPlacement = derived.showStationPlacement;
  tgt.dashboardData = {
    ...derived.dashboardData,
    sourceLayerId: sketchLayerId,
  };
  tgt.isLoaded = true;
  tgt.isLoading = false;

  if (!tgt.visible) {
    tgt.visible = true;
    dataStore.saveLayerState(targetB3LayerId, { visible: true });
  }

  console.log(`executeOsmGeojsonToRouteSegmentsNd：已由 ${sketchLayerId} 寫入 ${targetB3LayerId}`);
}

/** 空間網絡網格群組 `network_draw_sketch_2`：手繪 sketch → taipei_b3_dp_nd_2（管線圖層仍於「網格繪製_2」） */
export function executeOsmGeojsonToRouteSegmentsNdSketch2() {
  executeOsmGeojsonToRouteSegmentsNdWithPair('network_draw_sketch_2', 'taipei_b3_dp_nd_2');
}
