/**
 * OSM XML → GeoJSON FeatureCollection → 路段匯出 JSON（與 taipei_city_2026 同形之陣列寫入 jsonData）
 */

import { buildStandardRouteGeoJsonLoadResult } from '@/utils/dataProcessor.js';
import { exportRouteSegmentsFromGeoJson } from '@/utils/geojsonExportRouteSegments.js';
import { osmXmlStringToGeoJsonFeatureCollection } from '@/utils/osmXmlToGeoJson.js';

/** OSM XML 字串 → { geojsonData }（圖層 osm_2_geojson_2_json 管線第一步，非 layerId） */
export function osmXmlStringToGeojsonData(osmXmlString) {
  return { geojsonData: osmXmlStringToGeoJsonFeatureCollection(osmXmlString) };
}

/**
 * 路網 GeoJSON → 儀表板／表格＋路段匯出陣列（僅 jsonData；processedJsonData 為 null）
 * @param {Object} geojsonData - FeatureCollection
 */
export function geojson_2_json(geojsonData) {
  const base = buildStandardRouteGeoJsonLoadResult(geojsonData);
  const routeExportRows = exportRouteSegmentsFromGeoJson(geojsonData);
  return {
    ...base,
    jsonData: routeExportRows,
    processedJsonData: null,
  };
}

/**
 * 單次載入：osmXmlStringToGeojsonData → geojson_2_json；供 geojsonLoader／本機選檔。
 * @returns {Object} 含 sourceOsmXmlText
 */
export function osmXmlToOsm2GeojsonLoaderResult(osmXmlString) {
  const { geojsonData } = osmXmlStringToGeojsonData(osmXmlString);
  return {
    ...geojson_2_json(geojsonData),
    sourceOsmXmlText: osmXmlString,
  };
}

/** @deprecated 請用 osmXmlToOsm2GeojsonLoaderResult */
export function parseLocalOsmXmlStringToRouteLoadResult(xmlString) {
  return osmXmlToOsm2GeojsonLoaderResult(xmlString);
}
