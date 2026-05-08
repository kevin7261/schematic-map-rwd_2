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

/** 路段 JSON／segment 節點：優先 lon/lat（地理），否則 x_grid／y_grid（舊鍵） */
export function segmentNodeLon(node) {
  if (!node || typeof node !== 'object') return NaN;
  const v =
    node.lon ?? node.x_grid ?? node.tags?.lon ?? node.tags?.x_grid ?? node.tags?.lng;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** 見 {@link segmentNodeLon} */
export function segmentNodeLat(node) {
  if (!node || typeof node !== 'object') return NaN;
  const v =
    node.lat ?? node.y_grid ?? node.tags?.lat ?? node.tags?.y_grid;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * GeoJSON Way LineString／路線標籤上之路線編號（如捷運網頁示例 "R"）
 */
export function routeIdFromGeoJsonWayTags(tags) {
  if (!tags || typeof tags !== 'object') return '';
  const raw =
    tags.route_id ?? tags.route_ref ?? tags.ref ?? tags.line_id ?? tags.line ?? '';
  return raw != null && String(raw).trim() !== '' ? String(raw).trim() : '';
}

/** 無正式站碼時，用座標百萬分度當穩定後備 id */
export function fallbackStationIdFromLonLat(lon, lat) {
  const x = Number(lon);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 's_unknown';
  return `s_${Math.round(x * 1e6)}_${Math.round(y * 1e6)}`;
}

/** 無站名時之預設顯示字串 */
export function fallbackStationNameFromLonLat(lon, lat) {
  return `未命名站_${fallbackStationIdFromLonLat(lon, lat)}`;
}

/**
 * 路段 JSON 之每個站點皆應帶齊 station_id、station_name（非空字串；缺則依座標後備）。
 */
export function ensureSegmentStationStrings(partial = {}, lon, lat) {
  const lo = Number(lon);
  const la = Number(lat);
  const fb = fallbackStationIdFromLonLat(lo, la);
  const sid =
    partial.station_id != null && String(partial.station_id).trim() !== ''
      ? String(partial.station_id).trim()
      : fb;
  const sna =
    partial.station_name != null && String(partial.station_name).trim() !== ''
      ? String(partial.station_name).trim()
      : fallbackStationNameFromLonLat(lo, la);
  return { ...partial, station_id: sid, station_name: sna };
}
