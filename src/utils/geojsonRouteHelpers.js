/**
 * GeoJSON 路網要素辨識（OSM 匯出：properties.type；自訂匯出：properties.element_type）
 */

export function isGeoJsonWayLineFeature(feature) {
  if (!feature?.properties || !feature.geometry) return false;
  const p = feature.properties;
  const isWay = p.type === 'way' || p.element_type === 'way';
  const gt = feature.geometry.type;
  return isWay && (gt === 'LineString' || gt === 'MultiLineString');
}

export function isGeoJsonNodePointFeature(feature) {
  if (!feature?.properties || !feature.geometry) return false;
  const p = feature.properties;
  const isNode = p.type === 'node' || p.element_type === 'node';
  return isNode && feature.geometry.type === 'Point';
}

/** OSM 風格：標籤在 properties.tags；扁平匯出則整份 properties 即屬性 */
export function getGeoJsonFeatureTagProps(feature) {
  if (!feature?.properties) return {};
  return feature.properties.tags || feature.properties;
}

export function getGeoJsonRouteStableId(feature) {
  const tags = getGeoJsonFeatureTagProps(feature);
  const idFallback = feature.properties?.id ?? feature.properties?.osm_id ?? 'unknown';
  return tags.route_id || tags.route_name || `route_${idFallback}`;
}

/**
 * 路段 JSON segment 端點之 type：僅允許 terminal／intersection，其餘一律 normal（含缺省、未知字串）
 * @param {string|undefined|null} type
 * @returns {'terminal'|'intersection'|'normal'}
 */
export function normalizeRouteSegmentEndpointType(type) {
  if (type === 'terminal' || type === 'intersection') return type;
  return 'normal';
}
