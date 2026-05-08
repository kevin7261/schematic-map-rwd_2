/* eslint-disable no-console */

/**
 * JSON·網格·座標正規化：Orthogonal layout（水平／垂直化）。
 *
 * 保守規則：
 * - 只保留原路段端點與原有節點順序，必要時插入 degree-2 的 line 折點。
 * - 不接受會與其他路段產生新交叉或共線重疊的候選路徑。
 * - 找不到安全候選時保留原路段，並回報 skippedEdges。
 */

import { useDataStore } from '@/stores/dataStore.js';
import { computeStationDataFromRoutes } from '@/utils/dataExecute/computeStationDataFromRoutes.js';
import { flatSegmentsToGeojsonStyleExportRows } from '@/utils/taipeiTest4/flatSegmentsToGeojsonStyleExportRows.js';
import { normalizeSpaceNetworkDataToFlatSegments } from '@/utils/gridNormalizationMinDistance.js';
import {
  resolveB3InputSpaceNetwork,
  writeLayoutNormalizedLayerDataOsmFromNetwork,
} from './jsonGridCoordNormalizeHelpers.js';
import { JSON_GRID_COORD_NORMALIZED_LAYER_ID } from './sessionJsonGridCoordNormalized.js';

const EPS = 1e-9;

function cloneJson(value) {
  if (value == null) return value;
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function toPoint(p) {
  return [Number(Array.isArray(p) ? p[0] : p?.x), Number(Array.isArray(p) ? p[1] : p?.y)];
}

function pointEq(a, b) {
  return Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;
}

function isHv(a, b) {
  return Math.abs(a[0] - b[0]) <= EPS || Math.abs(a[1] - b[1]) <= EPS;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return (
    Math.abs(orient(a, b, p)) <= EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS &&
    p[1] <= Math.max(a[1], b[1]) + EPS
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 * o2 < -EPS && o3 * o4 < -EPS) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function colinearOverlapLength(a, b, c, d) {
  if (Math.abs(orient(a, b, c)) > EPS || Math.abs(orient(a, b, d)) > EPS) return 0;
  const useX = Math.abs(a[0] - b[0]) >= Math.abs(a[1] - b[1]);
  const a0 = useX ? a[0] : a[1];
  const b0 = useX ? b[0] : b[1];
  const c0 = useX ? c[0] : c[1];
  const d0 = useX ? d[0] : d[1];
  const lo = Math.max(Math.min(a0, b0), Math.min(c0, d0));
  const hi = Math.min(Math.max(a0, b0), Math.max(c0, d0));
  return Math.max(0, hi - lo);
}

function sharedEndpointOnly(a, b, c, d) {
  return pointEq(a, c) || pointEq(a, d) || pointEq(b, c) || pointEq(b, d);
}

function lineSegConflict(a, b, c, d) {
  if (pointEq(a, b) || pointEq(c, d)) return false;
  const overlap = colinearOverlapLength(a, b, c, d);
  if (overlap > EPS) return true;
  if (!segmentsIntersect(a, b, c, d)) return false;
  return !sharedEndpointOnly(a, b, c, d);
}

function pathToLineSegs(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!pointEq(a, b)) out.push([a, b]);
  }
  return out;
}

function collectOtherLineSegs(segments, excludeIdx) {
  const out = [];
  segments.forEach((seg, idx) => {
    if (idx === excludeIdx || !Array.isArray(seg?.points)) return;
    const pts = seg.points.map(toPoint);
    out.push(...pathToLineSegs(pts));
  });
  return out;
}

function pathConflicts(candidateSegs, existingSegs) {
  for (const [a, b] of candidateSegs) {
    for (const [c, d] of existingSegs) {
      if (lineSegConflict(a, b, c, d)) return true;
    }
  }
  return false;
}

function selfConflicts(candidateSegs) {
  for (let i = 0; i < candidateSegs.length; i += 1) {
    for (let j = i + 1; j < candidateSegs.length; j += 1) {
      if (j === i + 1 && sharedEndpointOnly(...candidateSegs[i], ...candidateSegs[j])) continue;
      if (lineSegConflict(...candidateSegs[i], ...candidateSegs[j])) return true;
    }
  }
  return false;
}

function buildSawtoothCandidates(a, b, maxTurns = 60) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const candidates = [];

  for (let turns = 1; turns <= maxTurns; turns += 1) {
    const hFirst = [a];
    let hx = a[0];
    let hy = a[1];
    const hXSteps = Math.ceil((turns + 1) / 2);
    const hYSteps = Math.floor((turns + 1) / 2);
    for (let i = 1; i <= turns; i += 1) {
      if (i % 2 === 1) {
        hx += dx / hXSteps;
      } else {
        hy += dy / Math.max(1, hYSteps);
      }
      hFirst.push([hx, hy]);
    }
    hFirst.push(b);
    candidates.push(hFirst);

    const vFirst = [a];
    let vx = a[0];
    let vy = a[1];
    const vYSteps = Math.ceil((turns + 1) / 2);
    const vXSteps = Math.floor((turns + 1) / 2);
    for (let i = 1; i <= turns; i += 1) {
      if (i % 2 === 1) {
        vy += dy / vYSteps;
      } else {
        vx += dx / Math.max(1, vXSteps);
      }
      vFirst.push([vx, vy]);
    }
    vFirst.push(b);
    candidates.push(vFirst);
  }

  return candidates;
}

function findSafeOrthogonalEdgePath(a, b, existingSegs, committedSegs) {
  if (isHv(a, b)) return [a, b];
  for (const candidate of buildSawtoothCandidates(a, b)) {
    const candidateSegs = pathToLineSegs(candidate);
    if (candidateSegs.some(([p0, p1]) => !isHv(p0, p1))) continue;
    if (selfConflicts([...committedSegs, ...candidateSegs])) continue;
    if (pathConflicts(candidateSegs, existingSegs)) continue;
    return candidate;
  }
  return null;
}

function vertexProps(seg, index, nPts) {
  if (Array.isArray(seg.nodes) && seg.nodes.length === nPts) {
    return cloneJson(seg.nodes[index] || {});
  }
  if (index === 0) return cloneJson(seg.properties_start || {});
  if (index === nPts - 1) return cloneJson(seg.properties_end || {});
  return { node_type: 'line' };
}

function applyOrthogonalSegment(seg, newPoints, newNodes) {
  seg.points = newPoints.map((p) => [p[0], p[1]]);
  seg.nodes = newNodes;
  const first = seg.points[0];
  const last = seg.points[seg.points.length - 1];
  if (seg.properties_start) {
    seg.properties_start.x_grid = first[0];
    seg.properties_start.y_grid = first[1];
  }
  if (seg.properties_end) {
    seg.properties_end.x_grid = last[0];
    seg.properties_end.y_grid = last[1];
  }
  if (Array.isArray(seg.start_coord)) {
    seg.start_coord = [first[0], first[1]];
  }
  if (Array.isArray(seg.end_coord)) {
    seg.end_coord = [last[0], last[1]];
  }
  if (seg.way_properties?.nodes) {
    seg.way_properties.nodes = cloneJson(newNodes);
  }
}

function orthogonalizeFlatSegmentsSafely(flatSegments) {
  const segments = cloneJson(flatSegments);
  const stats = {
    segmentCount: segments.length,
    totalEdges: 0,
    diagonalEdges: 0,
    convertedEdges: 0,
    skippedEdges: 0,
    skippedSegments: 0,
  };

  for (let idx = 0; idx < segments.length; idx += 1) {
    const seg = segments[idx];
    const pts = Array.isArray(seg?.points) ? seg.points.map(toPoint) : [];
    if (pts.length < 2) continue;
    const originalNodes = [];
    const existingSegs = collectOtherLineSegs(segments, idx);
    const nextPts = [];
    const nextNodes = [];
    const committedSegs = [];
    let failed = false;

    for (let i = 0; i < pts.length; i += 1) {
      originalNodes.push(vertexProps(seg, i, pts.length));
    }

    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      stats.totalEdges += 1;
      if (!isHv(a, b)) stats.diagonalEdges += 1;
      const edgePath = findSafeOrthogonalEdgePath(a, b, existingSegs, committedSegs);
      if (!edgePath) {
        failed = true;
        stats.skippedEdges += 1;
        break;
      }
      const edgeSegs = pathToLineSegs(edgePath);
      committedSegs.push(...edgeSegs);
      if (!isHv(a, b) && edgePath.length > 2) stats.convertedEdges += 1;

      if (nextPts.length === 0) {
        nextPts.push(edgePath[0]);
        nextNodes.push(originalNodes[i]);
      }
      for (let j = 1; j < edgePath.length - 1; j += 1) {
        nextPts.push(edgePath[j]);
        nextNodes.push({ node_type: 'line' });
      }
      nextPts.push(edgePath[edgePath.length - 1]);
      nextNodes.push(originalNodes[i + 1]);
    }

    if (failed) {
      stats.skippedSegments += 1;
      continue;
    }
    applyOrthogonalSegment(seg, nextPts, nextNodes);
  }

  return { flatSegments: segments, stats };
}

export function executeJsonGridOrthogonalStraighten() {
  const dataStore = useDataStore();
  const layer = dataStore.findLayerById(JSON_GRID_COORD_NORMALIZED_LAYER_ID);
  if (!layer) {
    console.warn('executeJsonGridOrthogonalStraighten：找不到圖層', JSON_GRID_COORD_NORMALIZED_LAYER_ID);
    return { ok: false, message: '找不到圖層' };
  }

  const resolved = resolveB3InputSpaceNetwork(layer);
  if (!resolved?.spaceNetwork?.length) {
    return { ok: false, message: '本圖層無可用路網輸入' };
  }

  const flat = normalizeSpaceNetworkDataToFlatSegments(resolved.spaceNetwork);
  if (!Array.isArray(flat) || flat.length === 0) {
    return { ok: false, message: '路網格式無法轉為扁平 segments' };
  }

  const { flatSegments, stats } = orthogonalizeFlatSegmentsSafely(flat);
  const { sectionData, connectData, stationData } = computeStationDataFromRoutes(flatSegments);

  layer.spaceNetworkGridJsonData = flatSegments;
  layer.spaceNetworkGridJsonData_SectionData = sectionData;
  layer.spaceNetworkGridJsonData_ConnectData = connectData;
  layer.spaceNetworkGridJsonData_StationData = stationData;
  layer.showStationPlacement = false;
  layer.isLoaded = true;

  try {
    layer.processedJsonData = flatSegmentsToGeojsonStyleExportRows(flatSegments);
  } catch (e) {
    console.error('JSON 網格 Orthogonal layout：匯出 processedJsonData 失敗', e);
    layer.processedJsonData = null;
  }

  layer.dashboardData = {
    ...(layer.dashboardData || {}),
    sourceLayerId: JSON_GRID_COORD_NORMALIZED_LAYER_ID,
    routeSourceLayerId: resolved.fromExistingSn ? JSON_GRID_COORD_NORMALIZED_LAYER_ID : 'osm_2_geojson_2_json',
    orthogonalLayout: true,
    orthogonalLayoutSafe: stats.skippedEdges === 0,
    orthogonalLayoutStats: stats,
    straightened: true,
    coordNormalize: false,
  };

  writeLayoutNormalizedLayerDataOsmFromNetwork(layer, flatSegments);

  dataStore.saveLayerState(JSON_GRID_COORD_NORMALIZED_LAYER_ID, {
    spaceNetworkGridJsonData: layer.spaceNetworkGridJsonData,
    spaceNetworkGridJsonData_SectionData: layer.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_ConnectData: layer.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_StationData: layer.spaceNetworkGridJsonData_StationData,
    showStationPlacement: layer.showStationPlacement,
    processedJsonData: layer.processedJsonData,
    dashboardData: layer.dashboardData,
    dataOSM: layer.dataOSM,
    isLoaded: true,
  });

  return { ok: true, ...stats };
}
