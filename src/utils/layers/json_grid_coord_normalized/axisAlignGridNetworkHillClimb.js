/**
 * integer 格點路網：在「不新增／刪除頂點、不插入轉折」前提下，
 * 以「同一座標」聯動移動（頭尾共點、多段重複頂點一併平移），使折線盡量橫平豎直。
 * 硬約束：無線段內部交叉、零長邊禁止；
 * 同一格可有多個頂點若且唯若其為同一共點群組（以執行當下初值之格座標分群）；禁止兩個不同共點群組移入同一格。
 */

import { segmentIntersectionInterior2D } from '@/utils/routeSegmentIntersections.js';

function num(v) {
  return Math.round(Number(v ?? 0));
}

function getXY(pt) {
  if (Array.isArray(pt)) return [num(pt[0]), num(pt[1])];
  return [num(pt?.x), num(pt?.y)];
}

function setXY(seg, idx, x, y) {
  const rx = num(x);
  const ry = num(y);
  const pt = seg.points[idx];
  if (Array.isArray(pt)) {
    pt[0] = rx;
    pt[1] = ry;
  } else if (pt && typeof pt === 'object') {
    pt.x = rx;
    pt.y = ry;
  }
  const n = seg.nodes?.[idx];
  if (n && typeof n === 'object') {
    n.tags = { ...(n.tags || {}), x_grid: rx, y_grid: ry };
  }
}

function syncSegEndpointsProps(seg) {
  const pts = seg.points;
  if (!Array.isArray(pts) || pts.length < 2) return;
  const c0 = getXY(pts[0]);
  const cL = getXY(pts[pts.length - 1]);
  const ps = seg.properties_start;
  const pe = seg.properties_end;
  if (ps?.tags) {
    ps.tags = { ...ps.tags, x_grid: c0[0], y_grid: c0[1] };
  }
  if (pe?.tags) {
    pe.tags = { ...pe.tags, x_grid: cL[0], y_grid: cL[1] };
  }
}

function syncAllEndpoints(segments) {
  for (const seg of segments) syncSegEndpointsProps(seg);
}

/** @returns {Array<{si:number,pi:number,x1:number,y1:number,x2:number,y2:number}>|null} */
function buildEdges(segments) {
  const edges = [];
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      const a = getXY(pts[pi]);
      const b = getXY(pts[pi + 1]);
      if (a[0] === b[0] && a[1] === b[1]) return null;
      edges.push({ si, pi, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    }
  }
  return edges;
}

function shareEndpoint(e1, e2) {
  if (e1.si === e2.si && Math.abs(e1.pi - e2.pi) === 1) return true;
  const eq = (xa, ya, xb, yb) => xa === xb && ya === yb;
  if (eq(e1.x1, e1.y1, e2.x1, e2.y1)) return true;
  if (eq(e1.x1, e1.y1, e2.x2, e2.y2)) return true;
  if (eq(e1.x2, e1.y2, e2.x1, e2.y1)) return true;
  if (eq(e1.x2, e1.y2, e2.x2, e2.y2)) return true;
  return false;
}

/**
 * 判斷兩線段是否共線且**實質重疊**（超過端點接觸）。
 * 使用整數格座標（已四捨五入），所以以整數精度比較。
 */
function segmentsCollinearOverlap(x1, y1, x2, y2, x3, y3, x4, y4) {
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = x4 - x3;
  const dy2 = y4 - y3;
  // 平行判定：cross product = 0
  if (dx1 * dy2 - dy1 * dx2 !== 0) return false;
  // 共線判定：(p3-p1) × dir1 = 0
  if ((x3 - x1) * dy1 - (y3 - y1) * dx1 !== 0) return false;
  // 投影到線段 1 的參數軸（以 Manhattan 長代替 Euclidean 避免除法）
  const len1 = Math.abs(dx1) + Math.abs(dy1);
  if (len1 === 0) return false;
  // 投影用同方向分量（取較大者以避免除以 0）
  const ref = Math.abs(dx1) >= Math.abs(dy1) ? dx1 : dy1;
  const proj3 = Math.abs(dx1) >= Math.abs(dy1) ? x3 - x1 : y3 - y1;
  const proj4 = Math.abs(dx1) >= Math.abs(dy1) ? x4 - x1 : y4 - y1;
  const t3 = proj3 / ref;
  const t4 = proj4 / ref;
  const tMin = Math.min(t3, t4);
  const tMax = Math.max(t3, t4);
  // 超過端點接觸才算重疊（tMax > 0+ε 且 tMin < 1−ε）
  const eps = 1e-9;
  return tMax > eps && tMin < 1 - eps;
}

function hasInvalidGeometry(segments) {
  const edges = buildEdges(segments);
  if (!edges) return true;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (shareEndpoint(edges[i], edges[j])) continue;
      const e1 = edges[i];
      const e2 = edges[j];
      // 內部交叉
      if (segmentIntersectionInterior2D(e1.x1, e1.y1, e1.x2, e1.y2, e2.x1, e2.y1, e2.x2, e2.y2)) {
        return true;
      }
      // 共線重疊（路線疊在同一格線上）
      if (segmentsCollinearOverlap(e1.x1, e1.y1, e1.x2, e1.y2, e2.x1, e2.y1, e2.x2, e2.y2)) {
        return true;
      }
    }
  }
  if (hasVertexStrictlyOnForeignOpenEdge(segments)) return true;
  return false;
}

/** 頂點落在**其他**線段之開放內部（非該線段端點座標） */
function pointStrictlyInteriorOnSegment(px, py, ax, ay, bx, by) {
  const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (cross !== 0) return false;
  const minx = Math.min(ax, bx);
  const maxx = Math.max(ax, bx);
  const miny = Math.min(ay, by);
  const maxy = Math.max(ay, by);
  if (px < minx || px > maxx || py < miny || py > maxy) return false;
  if ((px === ax && py === ay) || (px === bx && py === by)) return false;
  return true;
}

function hasVertexStrictlyOnForeignOpenEdge(segments) {
  const edges = buildEdges(segments);
  if (!edges) return true;
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = 0; pi < pts.length; pi++) {
      const [px, py] = getXY(pts[pi]);
      for (const e of edges) {
        const onEnd = (px === e.x1 && py === e.y1) || (px === e.x2 && py === e.y2);
        if (onEnd) continue;
        if (pointStrictlyInteriorOnSegment(px, py, e.x1, e.y1, e.x2, e.y2)) return true;
      }
    }
  }
  return false;
}

/** 以「執行開始時」之格座標為共點群組 id；同格之多頂點共用同一 id。 */
function buildInitialCoPointGroupIdByVertex(segments) {
  const m = buildGroups(segments);
  const map = new Map();
  for (const [cellKey, refs] of m) {
    for (const { si, pi } of refs) {
      map.set(`${si},${pi}`, cellKey);
    }
  }
  return map;
}

/**
 * 每個格子上所有頂點須屬同一共點群組（允許頭尾共點之多筆頂點同格；禁止兩站原本不同格卻移進同一格）。
 */
function occupancyNoDistinctCoPointsMerged(segments, initialGroupIdByVertex) {
  const cellToIds = new Map();
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = 0; pi < pts.length; pi++) {
      const [x, y] = getXY(pts[pi]);
      const cell = `${x},${y}`;
      const gid = initialGroupIdByVertex.get(`${si},${pi}`);
      if (gid === undefined) return false;
      if (!cellToIds.has(cell)) cellToIds.set(cell, new Set());
      cellToIds.get(cell).add(gid);
    }
  }
  for (const idSet of cellToIds.values()) {
    if (idSet.size > 1) return false;
  }
  return true;
}

function edgeSlantCost(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 || dy === 0) return 0;
  return Math.abs(dx) + Math.abs(dy);
}

function totalCost(segments) {
  let c = 0;
  for (const seg of segments) {
    const pts = seg?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = getXY(pts[i]);
      const b = getXY(pts[i + 1]);
      c += edgeSlantCost(a[0], a[1], b[0], b[1]);
    }
  }
  return c;
}

function buildGroups(segments) {
  const m = new Map();
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = 0; pi < pts.length; pi++) {
      const [x, y] = getXY(pts[pi]);
      const k = `${x},${y}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ si, pi });
    }
  }
  return m;
}

function applyGroupDelta(segments, group, dx, dy) {
  for (const { si, pi } of group) {
    const seg = segments[si];
    const [x, y] = getXY(seg.points[pi]);
    setXY(seg, pi, x + dx, y + dy);
  }
  const touched = new Set(group.map((g) => g.si));
  for (const si of touched) syncSegEndpointsProps(segments[si]);
}

const DELTAS = (() => {
  const d = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) d.push([dx, dy]);
    }
  }
  return d;
})();

/** findBestCoPointGroupTargetOnGrid 專用：錨點四方向鄰格（不含斜向） */
const DELTAS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function tryImproveOnce(current, currentCost, initialGroupIdByVertex) {
  const groupMap = buildGroups(current);
  const keys = [...groupMap.keys()].sort();
  for (const k of keys) {
    const g = groupMap.get(k);
    for (const [dx, dy] of DELTAS) {
      const trial = JSON.parse(JSON.stringify(current));
      applyGroupDelta(trial, g, dx, dy);
      if (!occupancyNoDistinctCoPointsMerged(trial, initialGroupIdByVertex)) continue;
      if (!buildEdges(trial)) continue;
      if (hasInvalidGeometry(trial)) continue;
      const c = totalCost(trial);
      if (c < currentCost) {
        return { next: trial, cost: c, changed: true };
      }
    }
  }
  return { next: current, cost: currentCost, changed: false };
}

/**
 * @param {Array<object>} flatSegments - normalizeSpaceNetworkDataToFlatSegments 結果（會被 deep clone）
 * @param {{ maxRounds?: number }} [opts]
 * @returns {{ ok: boolean, segments?: Array, iterations?: number, costBefore?: number, costAfter?: number, improved?: boolean, reason?: string, message?: string }}
 */
export function runAxisAlignHillClimb(flatSegments, opts = {}) {
  const maxRounds = opts.maxRounds ?? 120;
  if (!Array.isArray(flatSegments) || flatSegments.length === 0) {
    return { ok: false, reason: 'empty', message: '沒有路段資料' };
  }

  const work = JSON.parse(JSON.stringify(flatSegments));
  syncAllEndpoints(work);

  if (hasInvalidGeometry(work)) {
    return {
      ok: false,
      reason: 'crossing-initial',
      message:
        '目前路網已有線段內部交叉、路線重疊（共線）或頂點落於他線之上，無法在「不允許交叉／重疊」下自動橫豎化。',
    };
  }

  const initialGroupIdByVertex = buildInitialCoPointGroupIdByVertex(work);
  if (!occupancyNoDistinctCoPointsMerged(work, initialGroupIdByVertex)) {
    return {
      ok: false,
      reason: 'co-point-initial',
      message: '初值路網有同一格上屬於不同共點群組之頂點（非預期）；請檢查資料。',
    };
  }

  const costBefore = totalCost(work);
  let best = work;
  let cost = costBefore;
  let iterations = 0;

  for (; iterations < maxRounds; iterations++) {
    const { next, cost: c2, changed } = tryImproveOnce(best, cost, initialGroupIdByVertex);
    if (!changed) break;
    best = next;
    cost = c2;
  }

  return {
    ok: true,
    segments: best,
    iterations,
    costBefore,
    costAfter: cost,
    improved: cost < costBefore,
  };
}

/**
 * 在目前路網下，將與 (segIdx,ptIdx) 共點之群組移至**錨點周邊 4 鄰格**（上下左右，曼哈頓距離 1，不含斜向與原地），
 * 使總斜段權重嚴格下降且滿足共點／無交叉／無共線重疊／無頂點落於他線開放內部。
 * 若多個目標同權重，取曼哈頓距離最近者（四鄰皆為 1，可另以方向次序打破平手）。
 *
 * @returns {{ ok: boolean, target: {x:number,y:number}|null, costBefore?: number, costAfter?: number, improved?: boolean, message?: string }}
 */
export function findBestCoPointGroupTargetOnGrid(flatSegments, segIdx, ptIdx) {
  if (!Array.isArray(flatSegments) || flatSegments.length === 0) {
    return { ok: false, target: null, message: '沒有路段資料' };
  }
  const work = JSON.parse(JSON.stringify(flatSegments));
  syncAllEndpoints(work);
  if (hasInvalidGeometry(work)) {
    return {
      ok: false,
      target: null,
      message: '目前路網已有交叉、重疊或頂點落線，無法評估建議格。',
    };
  }
  const initialGroupIdByVertex = buildInitialCoPointGroupIdByVertex(work);
  if (!occupancyNoDistinctCoPointsMerged(work, initialGroupIdByVertex)) {
    return { ok: false, target: null, message: '共點群組資料異常。' };
  }

  const groupMap = buildGroups(work);
  const anchor = work[segIdx]?.points?.[ptIdx];
  if (!anchor) return { ok: false, target: null, message: '頂點不存在。' };
  const [cx, cy] = getXY(anchor);
  const key = `${cx},${cy}`;
  const group = groupMap.get(key);
  if (!group?.length || !group.some((g) => g.si === segIdx && g.pi === ptIdx)) {
    return { ok: false, target: null, message: '無法對齊共點群組。' };
  }
  const groupRefs = [...group];

  const cost0 = totalCost(work);

  let bestCost = Infinity;
  let bestDist = Infinity;
  let bestTarget = null;

  for (const [ndx, ndy] of DELTAS_4) {
    const tx = cx + ndx;
    const ty = cy + ndy;
    const trial = JSON.parse(JSON.stringify(work));
    applyGroupDelta(trial, groupRefs, ndx, ndy);
    if (!occupancyNoDistinctCoPointsMerged(trial, initialGroupIdByVertex)) continue;
    if (!buildEdges(trial)) continue;
    if (hasInvalidGeometry(trial)) continue;
    const c = totalCost(trial);
    if (c >= cost0) continue;
    const dist = Math.abs(tx - cx) + Math.abs(ty - cy);
    if (c < bestCost || (c === bestCost && dist < bestDist)) {
      bestCost = c;
      bestDist = dist;
      bestTarget = { x: tx, y: ty };
    }
  }

  if (bestTarget == null) {
    return { ok: true, target: null, costBefore: cost0, costAfter: cost0, improved: false };
  }
  return {
    ok: true,
    target: bestTarget,
    costBefore: cost0,
    costAfter: bestCost,
    improved: true,
  };
}

/**
 * 若 {@link findBestCoPointGroupTargetOnGrid} 能找到嚴格改善格，將共點群組平移至該格並回傳新路網（於 deep clone 上修改）。
 *
 * @returns {{ ok: boolean, applied: boolean, segments?: Array|null, target?: {x:number,y:number}, costBefore?: number, costAfter?: number, message?: string }}
 */
export function applyBestCoPointGroupMoveOnGrid(flatSegments, segIdx, ptIdx) {
  const pick = findBestCoPointGroupTargetOnGrid(flatSegments, segIdx, ptIdx);
  if (!pick.ok) {
    return { ok: false, applied: false, segments: null, message: pick.message };
  }
  if (!pick.improved || !pick.target) {
    return {
      ok: true,
      applied: false,
      segments: null,
      costBefore: pick.costBefore,
      costAfter: pick.costAfter,
    };
  }

  const work = JSON.parse(JSON.stringify(flatSegments));
  syncAllEndpoints(work);
  const initialGroupIdByVertex = buildInitialCoPointGroupIdByVertex(work);
  const groupMap = buildGroups(work);
  const anchor = work[segIdx]?.points?.[ptIdx];
  if (!anchor) {
    return { ok: false, applied: false, segments: null, message: '頂點不存在' };
  }
  const [cx, cy] = getXY(anchor);
  const key = `${cx},${cy}`;
  const group = groupMap.get(key);
  if (!group?.length || !group.some((g) => g.si === segIdx && g.pi === ptIdx)) {
    return { ok: false, applied: false, segments: null, message: '無法對齊共點群組' };
  }
  const groupRefs = [...group];
  const dx = pick.target.x - cx;
  const dy = pick.target.y - cy;
  applyGroupDelta(work, groupRefs, dx, dy);
  syncAllEndpoints(work);
  if (!occupancyNoDistinctCoPointsMerged(work, initialGroupIdByVertex)) {
    return { ok: false, applied: false, segments: null, message: '套用後共點約束失敗' };
  }
  if (!buildEdges(work)) {
    return { ok: false, applied: false, segments: null, message: '套用後零長邊' };
  }
  if (hasInvalidGeometry(work)) {
    return { ok: false, applied: false, segments: null, message: '套用後出現交叉／重疊／頂點落線' };
  }
  if (totalCost(work) !== pick.costAfter) {
    return { ok: false, applied: false, segments: null, message: '套用後權重與預期不一致' };
  }
  return {
    ok: true,
    applied: true,
    segments: work,
    target: pick.target,
    costBefore: pick.costBefore,
    costAfter: pick.costAfter,
  };
}

/** Deep clone／同步端點屬性，供外向式試算／套用前使用 */
export function shallowCloneOrthoSegmentsSynced(segments) {
  const work = JSON.parse(JSON.stringify(segments));
  syncAllEndpoints(work);
  return work;
}

/** 格鍵 「gx,gy」→ 共址頂點 ref 列表（與共點平移／約束同源） */
export function buildOrthoCellGroups(segments) {
  return buildGroups(segments);
}

/** 「執行當初」之分群 id，約束套用後仍可併格者須同源 */
export function buildInitialOrthoCoPointGroups(segments) {
  return buildInitialCoPointGroupIdByVertex(segments);
}

/**
 * 共點佔格、零長邊、交叉／共線重疊／頂點落於他線開放內部。
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkOrthoGridHardConstraints(segments, initialGroupIds) {
  if (!occupancyNoDistinctCoPointsMerged(segments, initialGroupIds)) {
    return { ok: false, reason: '點重合（不同共點群組不可併格）' };
  }
  if (!buildEdges(segments)) {
    return { ok: false, reason: '零長邊' };
  }
  if (hasInvalidGeometry(segments)) {
    return { ok: false, reason: '線交叉、路線共線重疊，或頂點落在他線段開放內部' };
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// connect 紅／藍點最佳化：H/V 線段數最大化，步距 ≤ 2 格
// ──────────────────────────────────────────────────────────────────────────

/** 計算路網中「水平＋垂直」邊的總數 */
function countHVEdges(segments) {
  let c = 0;
  for (const seg of segments) {
    const pts = seg?.points;
    if (!Array.isArray(pts)) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = getXY(pts[i]);
      const [x2, y2] = getXY(pts[i + 1]);
      if (x1 === x2 || y1 === y2) c++;
    }
  }
  return c;
}

/**
 * 計算在 (nx,ny) 格上，路網中通過此點的最長連續水平或垂直線段長度（格數）。
 * 水平：所有 y=ny 的 H-edge；垂直：所有 x=nx 的 V-edge。
 * 對同方向上相接的邊做 interval union，取包含此點的最長段。
 */
function maxHVRunThroughPoint(segments, nx, ny) {
  const hIntervals = [];
  const vIntervals = [];
  for (const seg of segments) {
    const pts = seg?.points;
    if (!Array.isArray(pts)) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = getXY(pts[i]);
      const [x2, y2] = getXY(pts[i + 1]);
      if (y1 === ny && y2 === ny) hIntervals.push([Math.min(x1, x2), Math.max(x1, x2)]);
      if (x1 === nx && x2 === nx) vIntervals.push([Math.min(y1, y2), Math.max(y1, y2)]);
    }
  }
  const spanThrough = (intervals, coord) => {
    if (!intervals.length) return 0;
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [lo, hi] of intervals) {
      if (!merged.length || lo > merged[merged.length - 1][1]) {
        merged.push([lo, hi]);
      } else {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], hi);
      }
    }
    for (const [lo, hi] of merged) {
      if (lo <= coord && coord <= hi) return hi - lo;
    }
    return 0;
  };
  return Math.max(spanThrough(hIntervals, nx), spanThrough(vIntervals, ny));
}

function isAcuteTurnAt(segments, si, pi) {
  const pts = segments?.[si]?.points;
  if (!Array.isArray(pts) || pi <= 0 || pi >= pts.length - 1) return false;
  // 任一路網路段（單一 polyline）：內頂點之前後邊夾角若小於 90°（銳角）則視為無效。
  const [px, py] = getXY(pts[pi]);
  const [ax, ay] = getXY(pts[pi - 1]);
  const [bx, by] = getXY(pts[pi + 1]);
  const v1x = ax - px;
  const v1y = ay - py;
  const v2x = bx - px;
  const v2y = by - py;
  if ((v1x === 0 && v1y === 0) || (v2x === 0 && v2y === 0)) return false;
  // dot product > 0 means the smaller angle is less than 90 degrees.
  return v1x * v2x + v1y * v2y > 0;
}

/**
 * 移動某共點群組後，檢查受影響之 polyline 內頂點 pi-1／pi／pi+1；
 * 任一段折線若在該頂形成小於 90° 銳角，則汰除此候選移動。
 */
function hasAcuteSameRouteTurnNearMovedRefs(segments, refs) {
  const toCheck = new Set();
  for (const r of refs) {
    for (let dpi = -1; dpi <= 1; dpi++) {
      toCheck.add(`${r.si},${r.pi + dpi}`);
    }
  }
  for (const k of toCheck) {
    const [siRaw, piRaw] = k.split(',');
    const si = Number(siRaw);
    const pi = Number(piRaw);
    if (!Number.isFinite(si) || !Number.isFinite(pi)) continue;
    if (isAcuteTurnAt(segments, si, pi)) return true;
  }
  return false;
}

/**
 * connect 紅／藍點最佳化移動：
 * 在路網格點內試驗 (segIdx, ptIdx) 所在共點群組往曼哈頓距離 ≤ maxDist 的每一整數格位移，
 * 取能使 H/V 邊總數**嚴格增加**的候選；若多個候選，優先取「通過新格之最長連續 H/V 線」最大者，
 * 再以距離遠近打破平手。
 * 硬約束與 applyBestCoPointGroupMoveOnGrid 相同（無交叉、無共線重疊、無頂點落於他線、無零長邊）。
 *
 * @param {Array<object>} flatSegments
 * @param {number} segIdx
 * @param {number} ptIdx
 * @param {number} [maxDist=2]
 * @returns {{ ok: boolean, applied: boolean, segments?: Array|null, target?: {x:number,y:number}, hvBefore?: number, hvAfter?: number, maxRunAfter?: number, message?: string }}
 */
export function findBestConnectPointMoveForHV(flatSegments, segIdx, ptIdx, maxDist = 2) {
  if (!Array.isArray(flatSegments) || flatSegments.length === 0) {
    return { ok: false, applied: false, segments: null, message: '沒有路段資料' };
  }
  const work = JSON.parse(JSON.stringify(flatSegments));
  syncAllEndpoints(work);
  if (hasInvalidGeometry(work)) {
    return {
      ok: false,
      applied: false,
      segments: null,
      message: '目前路網已有交叉、重疊或頂點落線，無法移動。',
    };
  }
  const initialGroupIdByVertex = buildInitialCoPointGroupIdByVertex(work);
  if (!occupancyNoDistinctCoPointsMerged(work, initialGroupIdByVertex)) {
    return { ok: false, applied: false, segments: null, message: '共點群組資料異常。' };
  }

  const groupMap = buildGroups(work);
  const anchor = work[segIdx]?.points?.[ptIdx];
  if (!anchor) return { ok: false, applied: false, segments: null, message: '頂點不存在。' };
  const [cx, cy] = getXY(anchor);
  const key = `${cx},${cy}`;
  const group = groupMap.get(key);
  if (!group?.length || !group.some((g) => g.si === segIdx && g.pi === ptIdx)) {
    return { ok: false, applied: false, segments: null, message: '無法對齊共點群組。' };
  }
  const groupRefs = [...group];
  const hvBefore = countHVEdges(work);

  const candidates = [];
  for (let dx = -maxDist; dx <= maxDist; dx++) {
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.abs(dx) + Math.abs(dy) > maxDist) continue;
      const tx = cx + dx;
      const ty = cy + dy;
      const trial = JSON.parse(JSON.stringify(work));
      applyGroupDelta(trial, groupRefs, dx, dy);
      if (!occupancyNoDistinctCoPointsMerged(trial, initialGroupIdByVertex)) continue;
      if (!buildEdges(trial)) continue;
      if (hasInvalidGeometry(trial)) continue;
      if (hasAcuteSameRouteTurnNearMovedRefs(trial, groupRefs)) continue;
      const hvAfter = countHVEdges(trial);
      if (hvAfter <= hvBefore) continue;
      const maxRun = maxHVRunThroughPoint(trial, tx, ty);
      const dist = Math.abs(dx) + Math.abs(dy);
      candidates.push({ dx, dy, tx, ty, hvAfter, maxRun, dist, trial });
    }
  }

  if (!candidates.length) {
    return { ok: true, applied: false, hvBefore, hvAfter: hvBefore };
  }

  candidates.sort((a, b) => {
    if (b.hvAfter !== a.hvAfter) return b.hvAfter - a.hvAfter;
    if (b.maxRun !== a.maxRun) return b.maxRun - a.maxRun;
    return a.dist - b.dist;
  });

  const best = candidates[0];
  return {
    ok: true,
    applied: true,
    segments: best.trial,
    target: { x: best.tx, y: best.ty },
    hvBefore,
    hvAfter: best.hvAfter,
    maxRunAfter: best.maxRun,
  };
}

/**
 * 將指定頂點 ref 一併平移 (dx,dy)（整數格）；同步各段端點 tags。
 * @param {Array<{ si: number, pi: number }>} refs
 */
export function applyOrthoVertexRefsDelta(segments, refs, dx, dy) {
  for (const r of refs) {
    const seg = segments[r.si];
    if (!seg?.points?.[r.pi]) continue;
    const [x, y] = getXY(seg.points[r.pi]);
    setXY(seg, r.pi, x + dx, y + dy);
  }
  const touched = new Set(refs.map((r) => r.si));
  for (const si of touched) syncSegEndpointsProps(segments[si]);
}
