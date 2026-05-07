/**
 * GeoJSON（路線 LineString + 車站 Point）→ 與 Python export_route_segments 相同語意的路段 JSON，
 * 並轉成 SpaceNetworkGridTab 可繪製的 Normalize segments（points + properties_start/end + way_properties）。
 */

import { normalizeRouteSegmentEndpointType } from './geojsonRouteHelpers.js';

/** GeoJSON feature.properties 可能為 { tags } 或已扁平 */
function flatFeatureProps(feature) {
  const p = feature?.properties;
  if (!p || typeof p !== 'object') return {};
  const tags = p.tags && typeof p.tags === 'object' ? p.tags : {};
  return { ...p, ...tags };
}

function coordKey(lon, lat) {
  return `${lon},${lat}`;
}

/**
 * 與使用者提供之 Python export_route_segments 等價：輸出陣列元素含 routeName、color、segment、routeCoordinates。
 * @param {Object} geojson GeoJSON FeatureCollection
 * @returns {Object[]}
 */
export function exportRouteSegmentsFromGeoJson(geojson) {
  const features = Array.isArray(geojson?.features) ? geojson.features : [];

  /** @type {Map<string, Object>} */
  const stations = new Map();
  const routes = [];

  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    const props = flatFeatureProps(feature);

    if (geom.type === 'Point') {
      const stName = props.station_name ?? props.name;
      if (!stName) continue;
      const c = geom.coordinates;
      if (!Array.isArray(c) || c.length < 2) continue;
      const lon = c[0];
      const lat = c[1];
      const key = coordKey(lon, lat);
      stations.set(key, {
        station_id: props.station_id ?? '',
        station_name: stName,
        x_grid: lon,
        y_grid: lat,
        route_name_list: [],
      });
    } else if (geom.type === 'LineString') {
      const coords = (geom.coordinates || []).map((pt) => [pt[0], pt[1]]);
      if (coords.length < 2) continue;
      const routeName = props.name ?? props.route_name ?? '未命名路線';
      const color = props.color ?? '#000000';
      routes.push({
        routeName,
        color,
        coordPairs: coords,
      });
    }
  }

  for (const route of routes) {
    const rName = route.routeName;
    for (const xy of route.coordPairs) {
      const key = coordKey(xy[0], xy[1]);
      const st = stations.get(key);
      if (st && !st.route_name_list.includes(rName)) {
        st.route_name_list.push(rName);
      }
    }
  }

  for (const st of stations.values()) {
    st.connect_number = st.route_name_list.length;
    if (st.connect_number > 1) {
      st.type = 'intersection';
    } else {
      st.type = 'normal';
    }
  }

  const outputSegments = [];

  for (const route of routes) {
    const rName = route.routeName;
    const rColor = route.color;
    const routeStations = [];
    for (const xy of route.coordPairs) {
      const key = coordKey(xy[0], xy[1]);
      const st = stations.get(key);
      if (st) routeStations.push(st);
    }

    if (routeStations.length < 2) continue;

    if (routeStations[0].type === 'normal') routeStations[0].type = 'terminal';
    if (routeStations[routeStations.length - 1].type === 'normal') {
      routeStations[routeStations.length - 1].type = 'terminal';
    }

    let currentSegmentStart = null;
    let currentMidStations = [];

    for (const st of routeStations) {
      const isKeyNode = st.type === 'intersection' || st.type === 'terminal';

      if (isKeyNode) {
        if (currentSegmentStart == null) {
          currentSegmentStart = st;
          currentMidStations = [];
        } else {
          const endNode = st;

          const midStationsFormatted = [];
          const midCoords = [];
          for (const ms of currentMidStations) {
            midStationsFormatted.push({
              station_id: ms.station_id,
              station_name: ms.station_name,
              x_grid: ms.x_grid,
              y_grid: ms.y_grid,
              type: 'normal',
            });
            midCoords.push([ms.x_grid, ms.y_grid]);
          }

          const segmentData = {
            routeName: rName,
            color: rColor,
            segment: {
              start: {
                station_id: currentSegmentStart.station_id,
                station_name: currentSegmentStart.station_name,
                route_name_list: currentSegmentStart.route_name_list,
                x_grid: currentSegmentStart.x_grid,
                y_grid: currentSegmentStart.y_grid,
                type: normalizeRouteSegmentEndpointType(currentSegmentStart.type),
                connect_number: currentSegmentStart.connect_number,
              },
              stations: midStationsFormatted,
              end: {
                station_id: endNode.station_id,
                station_name: endNode.station_name,
                route_name_list: endNode.route_name_list,
                x_grid: endNode.x_grid,
                y_grid: endNode.y_grid,
                type: normalizeRouteSegmentEndpointType(endNode.type),
                connect_number: endNode.connect_number,
              },
            },
            routeCoordinates: [
              [currentSegmentStart.x_grid, currentSegmentStart.y_grid],
              midCoords,
              [endNode.x_grid, endNode.y_grid],
            ],
          };
          outputSegments.push(segmentData);

          currentSegmentStart = endNode;
          currentMidStations = [];
        }
      } else if (currentSegmentStart != null) {
        currentMidStations.push(st);
      }
    }
  }

  return outputSegments;
}

function stationToGridProps(st) {
  if (!st) return null;
  return {
    type: 'node',
    station_id: st.station_id ?? '',
    station_name: st.station_name,
    x_grid: st.x_grid,
    y_grid: st.y_grid,
    tags: {
      station_id: st.station_id ?? '',
      station_name: st.station_name,
      name: st.station_name,
    },
    node_type: 'connect',
    connect_number: st.connect_number,
    route_name_list: Array.isArray(st.route_name_list) ? [...st.route_name_list] : [],
  };
}

/**
 * Python 匯出列 → SpaceNetworkGrid drawMap「1-1 / properties_start」分支用 segments。
 * @param {Object[]} exportRows exportRouteSegmentsFromGeoJson 回傳值
 * @returns {Object[]}
 */
export function routeSegmentsExportToSpaceNetworkSegments(exportRows) {
  if (!Array.isArray(exportRows)) return [];
  return exportRows.map((row) => {
    const rc = row.routeCoordinates;
    const midArr = Array.isArray(rc?.[1]) ? rc[1] : [];
    const points = [];
    if (Array.isArray(rc?.[0]) && rc[0].length >= 2) {
      points.push([rc[0][0], rc[0][1]]);
    }
    for (const m of midArr) {
      if (Array.isArray(m) && m.length >= 2) points.push([m[0], m[1]]);
    }
    if (Array.isArray(rc?.[2]) && rc[2].length >= 2) {
      points.push([rc[2][0], rc[2][1]]);
    }
    const sm = row.segment || {};
    return {
      name: row.routeName,
      points,
      way_properties: {
        type: 'way',
        tags: {
          color: row.color,
          route_name: row.routeName,
        },
      },
      properties_start: stationToGridProps(sm.start),
      properties_end: stationToGridProps(sm.end),
    };
  });
}

/**
 * 一次取得「Python 形狀匯出」與「空間網路網格用 segments」。
 * @param {Object} geojson
 * @returns {{ exportRows: Object[], spaceNetworkSegments: Object[] }}
 */
export function geoJsonToRouteSegmentsAndSpaceNetwork(geojson) {
  const exportRows = exportRouteSegmentsFromGeoJson(geojson);
  return {
    exportRows,
    spaceNetworkSegments: routeSegmentsExportToSpaceNetworkSegments(exportRows),
  };
}
