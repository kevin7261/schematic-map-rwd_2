/**
 * 空間網絡網格測試_4：taipei_sn4_a 手繪 → GeoJSON FeatureCollection。
 * 與 executeOsmGeojsonToRouteSegmentsNd 內 resolveSketchFeatureCollectionForNd 分檔複製。
 */

import {
  readSn4SketchPolylinesFromLayerGeojson,
  readSn4SketchStationMarkersFromLayerGeojson,
} from '@/utils/mergeSn4SketchIntoLayerGeojson.js';
import { sketchPolylinesWgs84ToGeoJsonFeatureCollection } from '@/utils/networkDrawSketchToSpaceNetworkSegments.js';

/**
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
export function resolveTaipeiSn4ASketchFeatureCollection(dataStore, sketchLayer, sketchLayerId = 'taipei_sn4_a') {
  const exported = sketchLayer?.networkDrawSketchExportWgs84GeoJson;
  if (
    exported &&
    exported.type === 'FeatureCollection' &&
    Array.isArray(exported.features) &&
    exported.features.length > 0
  ) {
    return exported;
  }

  const lines = readSn4SketchPolylinesFromLayerGeojson(sketchLayer);
  const station = readSn4SketchStationMarkersFromLayerGeojson(sketchLayer);
  const markers = { red: [], blue: [], green: [], station };
  if (!dataStore.getNetworkDrawSketchSn4UseGeoForLayer(sketchLayerId)) {
    throw new Error('請使用 WGS84 手繪模式（測試_4 a 層手繪）');
  }
  if (!Array.isArray(lines) || !lines.some((pl) => pl && pl.length >= 2)) {
    throw new Error('手繪折線不足（至少一條含兩點以上），無法轉成路段資料');
  }

  return sketchPolylinesWgs84ToGeoJsonFeatureCollection(lines, {
    markersWgs84: markers,
  });
}
