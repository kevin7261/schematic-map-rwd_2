// taipei_c → taipei_d：複製資料後，黑點沿軸向路網向示意圖幾何中心（藍虛線）滑動：
// 水平段僅左右、垂直段僅上下；每輪全網路各黑點各滑一次，直到一輪無人移動為止。
// 每格至多一點；遇轉折、紅點或他站前一格停止。

import { useDataStore } from '@/stores/dataStore.js';
import { resolveTaipeiTestPipelineStep } from '@/utils/taipeiTestPipeline.js';
import {
  collectLineStationGridPointsFromStationData,
  collectStationPlacementPoints,
  normalizeSpaceNetworkDataToFlatSegments,
} from '@/utils/gridNormalizationMinDistance.js';
import {
  getSchematicPlotBoundsFromLayer,
  mapNetworkToSchematicPlotXY,
} from '@/utils/schematicPlotMapper.js';

function deep(v) {
  return v != null ? JSON.parse(JSON.stringify(v)) : null;
}

function toNum(v) {
  return Number(v ?? 0);
}

function getC(p) {
  return Array.isArray(p) ? [toNum(p[0]), toNum(p[1])] : [toNum(p?.x), toNum(p?.y)];
}

const AXIS_EPS = 0.1;

function cellKey(x, y) {
  return `${Math.round(toNum(x))},${Math.round(toNum(y))}`;
}

function parseKey(k) {
  const [a, b] = String(k).split(',');
  return [Math.round(toNum(a)), Math.round(toNum(b))];
}

/**
 * 在鄰接圖頂點中找離 (bx,by) 最近者（必在路線格上）。
 * 勿用「Manhattan≤2 取任意一點」——平行近線時會貼錯邊，造成黑點漂離路線。
 */
function nearestGraphCell(bx, by, adj) {
  if (!adj?.size) return null;
  let bestX = 0;
  let bestY = 0;
  let bestD = Infinity;
  for (const k of adj.keys()) {
    const [cx, cy] = parseKey(k);
    const d = (bx - cx) ** 2 + (by - cy) ** 2;
    if (
      d < bestD - 1e-18 ||
      (Math.abs(d - bestD) <= 1e-18 && (cx < bestX || (cx === bestX && cy < bestY)))
    ) {
      bestD = d;
      bestX = cx;
      bestY = cy;
    }
  }
  return [bestX, bestY];
}

/** 將連續座標對齊到路網格點（已在圖上則四捨五入；否則最近圖上點） */
function alignStationToGraph(bx, by, adj) {
  const rx = Math.round(toNum(bx));
  const ry = Math.round(toNum(by));
  if (adj.has(cellKey(rx, ry))) return [rx, ry];
  return nearestGraphCell(bx, by, adj);
}

/** 軸對齊折線上之鄰接圖（單格一步） */
function buildLineAdjacency(flatSegs) {
  const adj = new Map();
  const addUndirected = (ax, ay, bx, by) => {
    const ka = cellKey(ax, ay);
    const kb = cellKey(bx, by);
    if (ka === kb) return;
    if (!adj.has(ka)) adj.set(ka, new Set());
    if (!adj.has(kb)) adj.set(kb, new Set());
    adj.get(ka).add(kb);
    adj.get(kb).add(ka);
  };

  for (const seg of flatSegs || []) {
    const pts = (seg.points || []).map(getC);
    for (let i = 0; i < pts.length - 1; i++) {
      let [x1, y1] = pts[i];
      let [x2, y2] = pts[i + 1];
      x1 = Math.round(x1);
      y1 = Math.round(y1);
      x2 = Math.round(x2);
      y2 = Math.round(y2);
      if (y1 === y2) {
        const ya = y1;
        const step = x2 >= x1 ? 1 : -1;
        for (let x = x1; x !== x2; x += step) {
          addUndirected(x, ya, x + step, ya);
        }
      } else if (x1 === x2) {
        const xa = x1;
        const step = y2 >= y1 ? 1 : -1;
        for (let y = y1; y !== y2; y += step) {
          addUndirected(xa, y, xa, y + step);
        }
      }
    }
  }
  return adj;
}

function redCellSetFromLayer(layer) {
  const set = new Set();
  for (const p of collectStationPlacementPoints(layer)) {
    if (p.kind === 'connect') set.add(cellKey(p.x, p.y));
  }
  return set;
}

function stationDedupeKeyFromRow(row) {
  const s = row.meta;
  const id = s?.station_id ?? s?.tags?.station_id;
  if (id != null && String(id).trim() !== '') return `id:${String(id).trim()}`;
  const fx = Number(row.x);
  const fy = Number(row.y);
  const nm = String(s?.station_name ?? s?.tags?.station_name ?? '')
    .trim()
    .replace(/^—$/, '')
    .replace(/^－$/, '');
  return nm ? `name:${nm}` : `pos:${nm}|${fx.toFixed(5)},${fy.toFixed(5)}`;
}

function hasHorizNeighbor(adj, cx, cy) {
  const k = cellKey(cx, cy);
  const nbr = adj.get(k);
  if (!nbr) return false;
  for (const nk of nbr) {
    const [nx, ny] = parseKey(nk);
    if (ny === cy && nx !== cx) return true;
  }
  return false;
}

function hasVertNeighbor(adj, cx, cy) {
  const k = cellKey(cx, cy);
  const nbr = adj.get(k);
  if (!nbr) return false;
  for (const nk of nbr) {
    const [nx, ny] = parseKey(nk);
    if (nx === cx && ny !== cy) return true;
  }
  return false;
}

function getCenteringBounds(layer) {
  const bounds = getSchematicPlotBoundsFromLayer(layer);
  if (!bounds) return null;

  let { xMin, xMax, yMin, yMax } = bounds;
  const addPt = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  };

  const rows = collectLineStationGridPointsFromStationData(
    layer.spaceNetworkGridJsonData_StationData
  );
  for (const row of rows) {
    const [px, py] = mapNetworkToSchematicPlotXY(layer, row.x, row.y);
    addPt(px, py);
  }

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    centerX: (xMin + xMax) / 2,
    centerY: (yMin + yMax) / 2,
  };
}

/**
 * 依與 towardCenterMoveLabel 一致之規則選擇水平／垂直位移方向（網格一步之符號）
 */
function chooseSlideDelta(layer, bounds, cx, cy, adj) {
  const tcx = Number(bounds.centerX);
  const tcy = Number(bounds.centerY);
  const [px, py] = mapNetworkToSchematicPlotXY(layer, cx, cy);

  const canH = hasHorizNeighbor(adj, cx, cy);
  const canV = hasVertNeighbor(adj, cx, cy);

  const tryH = () => {
    if (!canH) return null;
    if (Math.abs(px - tcx) < AXIS_EPS) return null;
    const signX = px < tcx ? 1 : -1;
    return { dx: signX, dy: 0 };
  };

  const tryV = () => {
    if (!canV) return null;
    if (Math.abs(py - tcy) < AXIS_EPS) return null;
    const signY = py < tcy ? 1 : -1;
    return { dx: 0, dy: signY };
  };

  if (canH && !canV) return tryH();
  if (canV && !canH) return tryV();
  if (canH && canV) {
    const adx = Math.abs(tcx - px);
    const ady = Math.abs(tcy - py);
    if (adx >= ady) {
      const h = tryH();
      if (h) return h;
      return tryV();
    }
    const v = tryV();
    if (v) return v;
    return tryH();
  }
  return null;
}

function axisDistanceToCenter(layer, bounds, x, y, dx) {
  const [px, py] = mapNetworkToSchematicPlotXY(layer, x, y);
  return dx !== 0 ? Math.abs(Number(bounds.centerX) - px) : Math.abs(Number(bounds.centerY) - py);
}

function slideMax(layer, bounds, curX, curY, dx, dy, adj, redSet, blackOccupied) {
  let x = curX;
  let y = curY;
  let curDist = axisDistanceToCenter(layer, bounds, x, y, dx);
  const cap = Math.max(adj.size, 1) + 4;
  for (let s = 0; s < cap; s++) {
    const nx = x + dx;
    const ny = y + dy;
    const nk = cellKey(nx, ny);
    const ck = cellKey(x, y);
    const nbr = adj.get(ck);
    if (!nbr || !nbr.has(nk)) break;
    if (redSet.has(nk)) break;
    if (blackOccupied.has(nk)) break;
    const nextDist = axisDistanceToCenter(layer, bounds, nx, ny, dx);
    if (nextDist > curDist + AXIS_EPS) break;
    x = nx;
    y = ny;
    curDist = nextDist;
  }
  return [x, y];
}

/** 結束後保險：任何黑點若不在路段鄰接圖上，拉回最近路線格 */
function clampBlackStationsOntoRouteGrid(layer, adj) {
  const rows = collectLineStationGridPointsFromStationData(
    layer.spaceNetworkGridJsonData_StationData
  );
  for (const row of rows) {
    const st = row.meta;
    if (!st || typeof st !== 'object') continue;
    const bx = toNum(st.x_grid ?? st.tags?.x_grid ?? row.x);
    const by = toNum(st.y_grid ?? st.tags?.y_grid ?? row.y);
    if (adj.has(cellKey(bx, by))) continue;
    const snap = nearestGraphCell(bx, by, adj);
    if (!snap) continue;
    const [cx, cy] = snap;
    st.x_grid = cx;
    st.y_grid = cy;
    if (!st.tags || typeof st.tags !== 'object') st.tags = {};
    st.tags.x_grid = cx;
    st.tags.y_grid = cy;
  }
}

/**
 * @returns {{ loops: number, movesInLastLoop: number, totalMoves: number }}
 */
function runBlackStationsTowardSchematicCenter(layer) {
  const flat = normalizeSpaceNetworkDataToFlatSegments(layer.spaceNetworkGridJsonData || []);
  const adj = buildLineAdjacency(flat);
  if (adj.size === 0) {
    return { loops: 0, movesInLastLoop: 0, totalMoves: 0 };
  }

  const bounds = getCenteringBounds(layer);
  if (!bounds) {
    return { loops: 0, movesInLastLoop: 0, totalMoves: 0 };
  }

  const redSet = redCellSetFromLayer(layer);
  let loops = 0;
  let totalMoves = 0;
  let movesInLastLoop = 0;
  const maxLoops = 100000;

  // 先對齊離線座標，否則 occupied／selfKey 與實際圖上格不一致
  clampBlackStationsOntoRouteGrid(layer, adj);

  while (loops < maxLoops) {
    movesInLastLoop = 0;
    const rows = collectLineStationGridPointsFromStationData(
      layer.spaceNetworkGridJsonData_StationData
    );
    rows.sort(
      (a, b) =>
        Number(a.y) - Number(b.y) ||
        Number(a.x) - Number(b.x) ||
        stationDedupeKeyFromRow(a).localeCompare(stationDedupeKeyFromRow(b), 'zh-Hant')
    );

    const blackOccupied = new Set();
    for (const r of rows) {
      blackOccupied.add(cellKey(r.x, r.y));
    }

    for (const row of rows) {
      const st = row.meta;
      if (!st || typeof st !== 'object') continue;

      const rawX = toNum(st.x_grid ?? st.tags?.x_grid ?? row.x);
      const rawY = toNum(st.y_grid ?? st.tags?.y_grid ?? row.y);
      const aligned = alignStationToGraph(rawX, rawY, adj);
      if (!aligned) continue;
      let [cx, cy] = aligned;

      const selfKey = cellKey(cx, cy);
      const delta = chooseSlideDelta(layer, bounds, cx, cy, adj);
      if (!delta) continue;

      blackOccupied.delete(selfKey);
      const occExcl = new Set(blackOccupied);

      let [nx, ny] = slideMax(layer, bounds, cx, cy, delta.dx, delta.dy, adj, redSet, occExcl);
      if (!adj.has(cellKey(nx, ny))) {
        const fix = alignStationToGraph(nx, ny, adj);
        if (fix) [nx, ny] = fix;
      }
      const newKey = cellKey(nx, ny);
      if (newKey !== selfKey) {
        st.x_grid = nx;
        st.y_grid = ny;
        if (!st.tags || typeof st.tags !== 'object') st.tags = {};
        st.tags.x_grid = nx;
        st.tags.y_grid = ny;
        movesInLastLoop += 1;
        totalMoves += 1;
      }
      blackOccupied.add(newKey);
    }

    loops += 1;
    if (movesInLastLoop === 0) break;
  }

  if (loops >= maxLoops) {
    console.warn('[c→d 向心滑動] 達迴圈上限，強制停止（請檢查路網或資料）');
  }

  clampBlackStationsOntoRouteGrid(layer, adj);

  return { loops, movesInLastLoop, totalMoves };
}

// eslint-disable-next-line no-unused-vars
export function execute_c_to_d_test(_jsonData) {
  const dataStore = useDataStore();
  const execId = dataStore.taipeiTestExecuteSourceLayerId || 'taipei_c';
  const step = resolveTaipeiTestPipelineStep(execId);
  if (!step || step.role !== 'c') {
    throw new Error(`execute_c_to_d_test：無效的來源圖層 ${execId}（須為 taipei_c 或 taipei_c2）`);
  }
  const { src: srcId, dst: dstId } = step;
  const layer2_9 = dataStore.findLayerById(srcId);
  const layer2_10 = dataStore.findLayerById(dstId);

  if (!layer2_9 || !layer2_9.spaceNetworkGridJsonData) {
    throw new Error(`找不到 ${srcId} 的資料 (請先執行上一步)`);
  }
  if (!layer2_10) {
    throw new Error(`找不到 ${dstId} 圖層`);
  }

  layer2_10.spaceNetworkGridJsonData = deep(layer2_9.spaceNetworkGridJsonData);
  layer2_10.spaceNetworkGridJsonData_SectionData =
    deep(layer2_9.spaceNetworkGridJsonData_SectionData) ?? [];
  layer2_10.spaceNetworkGridJsonData_ConnectData =
    deep(layer2_9.spaceNetworkGridJsonData_ConnectData) ?? [];
  layer2_10.spaceNetworkGridJsonData_StationData =
    deep(layer2_9.spaceNetworkGridJsonData_StationData) ?? [];
  layer2_10.showStationPlacement = !!layer2_9.showStationPlacement;
  layer2_10.dashboardData = deep(layer2_9.dashboardData) ?? { source: srcId };
  layer2_10.isLoaded = true;

  layer2_10.minSpacingOverlayCell = layer2_9.minSpacingOverlayCell
    ? deep(layer2_9.minSpacingOverlayCell)
    : null;
  layer2_10.emptyOverlayRows = Array.isArray(layer2_9.emptyOverlayRows)
    ? deep(layer2_9.emptyOverlayRows)
    : [];
  layer2_10.emptyOverlayCols = Array.isArray(layer2_9.emptyOverlayCols)
    ? deep(layer2_9.emptyOverlayCols)
    : [];
  layer2_10.overlayRemovalMaps = null;
  layer2_10.gridTooltipMaps =
    layer2_9.gridTooltipMaps != null ? deep(layer2_9.gridTooltipMaps) : null;
  layer2_10.overlayRetentionReasons =
    layer2_9.overlayRetentionReasons != null ? deep(layer2_9.overlayRetentionReasons) : null;

  const centering = runBlackStationsTowardSchematicCenter(layer2_10);
  layer2_10.dashboardData = {
    ...(typeof layer2_10.dashboardData === 'object' && layer2_10.dashboardData
      ? layer2_10.dashboardData
      : {}),
    source: dstId,
    centeringTowardSchematic: centering,
  };

  if (!layer2_10.visible) {
    layer2_10.visible = true;
    dataStore.saveLayerState(dstId, { visible: true });
  }
}
