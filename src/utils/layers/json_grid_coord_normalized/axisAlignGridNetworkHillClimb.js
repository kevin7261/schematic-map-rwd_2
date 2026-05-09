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
  const proj3 = Math.abs(dx1) >= Math.abs(dy1) ? (x3 - x1) : (y3 - y1);
  const proj4 = Math.abs(dx1) >= Math.abs(dy1) ? (x4 - x1) : (y4 - y1);
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
      message: '目前路網已有線段內部交叉或路線重疊（共線），無法在「不允許交叉／重疊」下自動橫豎化。',
    };
  }

  const initialGroupIdByVertex = buildInitialCoPointGroupIdByVertex(work);
  if (!occupancyNoDistinctCoPointsMerged(work, initialGroupIdByVertex)) {
    return {
      ok: false,
      reason: 'co-point-initial',
      message:
        '初值路網有同一格上屬於不同共點群組之頂點（非預期）；請檢查資料。',
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
