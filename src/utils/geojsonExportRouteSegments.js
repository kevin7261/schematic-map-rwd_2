/**
 * GeoJSON FeatureCollection → 路段 JSON 陣列（與 Python export_route_segments 相同語意）
 * 輸出：{ routeName, color, segment: { start, stations, end }, routeCoordinates }[]
 */

import { getGeoJsonFeatureTagProps, normalizeRouteSegmentEndpointType } from './geojsonRouteHelpers.js';

function num(v) {
  return Number(v);
}

/** OSM：colour／color 多在 properties.tags；扁平 GeoJSON 則在 properties */
function routeLineColorFromFeature(feature) {
  const t = getGeoJsonFeatureTagProps(feature);
  const props = feature?.properties || {};
  const candidates = [t.colour, t.color, t.route_colour, props.color];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c).trim();
  }
  return '#000000';
}

function routeDisplayNameFromFeature(feature) {
  const t = getGeoJsonFeatureTagProps(feature);
  const props = feature?.properties || {};
  const n = t.name ?? t.route_name ?? props.name ?? props.route_name;
  return n != null && String(n).trim() !== '' ? String(n).trim() : '未命名路線';
}

function coordTupleKey(coord) {
  return `${num(coord[0])},${num(coord[1])}`;
}

/** 線段—點距離（垂直距離，t 箝在 [0,1]）；密頂點弧線須略寬，否則 HD_S 無法插入 walk */
const ON_SEGMENT_MAX_DIST_DEG = 6e-4;

function paramAlongSegment01(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-22) return 0;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

function distPointToClosedSegmentSq(ax, ay, bx, by, px, py) {
  const t = paramAlongSegment01(ax, ay, bx, by, px, py);
  const qx = ax + t * (bx - ax);
  const qy = ay + t * (by - ay);
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

/**
 * 將落在折線任一邊上的車站座標（交叉點常在內插位置、非頂點）依走向插入，
 * 使 export_route_segments 能於該處切段並標為 intersection／connect（紅點）。
 *
 * @param {number[][]} coords - LineString 頂點
 * @param {Map<string, object>} stations
 * @returns {number[][]}
 */
function expandRouteCoordsWithStationsOnLine(coords, stations) {
  if (!Array.isArray(coords) || coords.length < 2) return coords ? [...coords] : [];
  const stationArr = [...stations.values()];
  const out = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = num(a[0]);
    const ay = num(a[1]);
    const bx = num(b[0]);
    const by = num(b[1]);
    if (i === 0) out.push([ax, ay]);

    const dMaxSq = ON_SEGMENT_MAX_DIST_DEG * ON_SEGMENT_MAX_DIST_DEG;
    /** @type {{ t: number, x: number, y: number }[]} */
    const hits = [];
    for (const st of stationArr) {
      const px = num(st.x_grid);
      const py = num(st.y_grid);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      if (distPointToClosedSegmentSq(ax, ay, bx, by, px, py) > dMaxSq) continue;
      const t = paramAlongSegment01(ax, ay, bx, by, px, py);
      hits.push({ t, x: px, y: py });
    }
    hits.sort((u, v) => u.t - v.t || u.x - v.x || u.y - v.y);
    for (const h of hits) {
      const c = [h.x, h.y];
      const last = out[out.length - 1];
      if (last && coordTupleKey(last) === coordTupleKey(c)) continue;
      out.push(c);
    }
    const end = [bx, by];
    const last = out[out.length - 1];
    if (!last || coordTupleKey(last) !== coordTupleKey(end)) out.push(end);
  }
  return out;
}

function snapStation(s) {
  return {
    station_id: s.station_id,
    station_name: s.station_name,
    route_name_list: [...(s.route_name_list || [])],
    x_grid: s.x_grid,
    y_grid: s.y_grid,
    type: normalizeRouteSegmentEndpointType(s.type),
    connect_number: s.connect_number,
  };
}

/**
 * @param {*} geojson - GeoJSON FeatureCollection
 * @returns {Array<Object>}
 */
export function exportRouteSegmentsFromGeoJson(geojson) {
  if (!geojson?.features || !Array.isArray(geojson.features)) return [];

  /** @type {Map<string, object>} */
  const stations = new Map();
  const routes = [];

  for (const feature of geojson.features) {
    const geom = feature.geometry;
    const props = feature.properties || {};
    if (!geom) continue;

    if (geom.type === 'Point') {
      const t = getGeoJsonFeatureTagProps(feature);
      const stName = t.station_name ?? t.name ?? props.station_name ?? props.name;
      if (!stName || String(stName).trim() === '') continue;
      const c = geom.coordinates;
      const coord = [num(c[0]), num(c[1])];
      const key = coordTupleKey(coord);
      const sidRaw = t.station_id ?? props.station_id;
      const presetFromSketchAuto =
        props.sketch_sn4_auto_station === true &&
        (props.type === 'terminal' || props.type === 'intersection')
          ? props.type
          : undefined;
      stations.set(key, {
        station_id: sidRaw != null && String(sidRaw).trim() !== '' ? String(sidRaw) : '',
        station_name: String(stName).trim(),
        x_grid: coord[0],
        y_grid: coord[1],
        route_name_list: [],
        ...(presetFromSketchAuto ? { type: presetFromSketchAuto } : {}),
      });
    } else if (geom.type === 'LineString') {
      const routeName = routeDisplayNameFromFeature(feature);
      const color = routeLineColorFromFeature(feature);
      const coords = (geom.coordinates || []).map((c) => [num(c[0]), num(c[1])]);
      routes.push({ routeName, color, coords });
    } else if (geom.type === 'MultiLineString') {
      const routeName = routeDisplayNameFromFeature(feature);
      const color = routeLineColorFromFeature(feature);
      for (const line of geom.coordinates || []) {
        const coords = line.map((c) => [num(c[0]), num(c[1])]);
        routes.push({ routeName, color, coords });
      }
    }
  }

  const routeWalkCoords = routes.map((r) => expandRouteCoordsWithStationsOnLine(r.coords, stations));

  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri];
    const rName = route.routeName;
    const walk = routeWalkCoords[ri];
    for (const coord of walk) {
      const st = stations.get(coordTupleKey(coord));
      if (st && !st.route_name_list.includes(rName)) {
        st.route_name_list.push(rName);
      }
    }
  }

  for (const st of stations.values()) {
    const deg = st.route_name_list.length;
    st.connect_number = deg;
    const preset = st.type === 'terminal' || st.type === 'intersection' ? st.type : null;
    if (preset) {
      st.type = preset;
    } else {
      st.type = deg > 1 ? 'intersection' : 'normal';
    }
  }

  const outputSegments = [];

  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri];
    const rName = route.routeName;
    const rColor = route.color;
    const routeStations = [];
    const walk = routeWalkCoords[ri];
    for (const coord of walk) {
      const st = stations.get(coordTupleKey(coord));
      if (st) routeStations.push(st);
    }

    /** 與 Python export_route_segments 相同：折線上須能對到至少兩個車站座標，否則略過該路線 */
    if (routeStations.length < 2) continue;

    if (routeStations[0].type === 'normal') routeStations[0].type = 'terminal';
    const last = routeStations[routeStations.length - 1];
    if (last.type === 'normal') last.type = 'terminal';

    let currentSegmentStart = null;
    let currentMidStations = [];

    for (const st of routeStations) {
      const isKeyNode = st.type === 'intersection' || st.type === 'terminal';

      if (isKeyNode) {
        if (currentSegmentStart === null) {
          currentSegmentStart = st;
          currentMidStations = [];
        } else {
          const endNode = st;
          const midStationsFormatted = currentMidStations.map((ms) => ({
            station_id: ms.station_id,
            station_name: ms.station_name,
            x_grid: ms.x_grid,
            y_grid: ms.y_grid,
            type: 'normal',
          }));
          const midCoords = currentMidStations.map((ms) => [ms.x_grid, ms.y_grid]);

          outputSegments.push({
            routeName: rName,
            color: rColor,
            segment: {
              start: snapStation(currentSegmentStart),
              stations: midStationsFormatted,
              end: snapStation(endNode),
            },
            routeCoordinates: [
              [currentSegmentStart.x_grid, currentSegmentStart.y_grid],
              midCoords,
              [endNode.x_grid, endNode.y_grid],
            ],
          });
          currentSegmentStart = endNode;
          currentMidStations = [];
        }
      } else if (currentSegmentStart !== null) {
        currentMidStations.push(st);
      }
    }
  }

  return outputSegments;
}
