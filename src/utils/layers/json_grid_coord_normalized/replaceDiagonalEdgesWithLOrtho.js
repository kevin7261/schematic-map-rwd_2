/**
 * 將各折線上「非水平／非垂直」的單一邊改為 L（兩段正交），
 * 並以 ortho 硬約束過濾交叉／共線重疊／頂點落線，以及「正交線段開放內部壓過紅／藍 connect 顯示格」（含 display_x/y）；
 * 另：L 轉角格不得落在**他線**紅／藍 connect 的顯示格上（除非與該斜邊兩端點之 connect 允許重合），否則略過不改此斜邊。
 * 若兩種 L 皆可，`preferVertFirst` 為 true 時平手優先「先直後橫」（先豎再橫），否則仍優先先橫後豎；
 * 其餘以與前後鄰邊「串成直線」評分為主。
 */

import {
  orthoFlatSegmentsGeometryInvalid,
  shallowCloneOrthoSegmentsSynced,
  syncOrthoFlatSegmentEndpoints,
} from './axisAlignGridNetworkHillClimb.js';

function num(v) {
  return Math.round(Number(v ?? 0));
}

function getXY(pt) {
  if (Array.isArray(pt)) return [num(pt[0]), num(pt[1])];
  return [num(pt?.x), num(pt?.y)];
}

function cloneVertexFromTemplate(template, x, y) {
  const rx = num(x);
  const ry = num(y);
  const t = template ?? [0, 0];
  const j = JSON.parse(JSON.stringify(t));
  if (Array.isArray(j)) {
    j[0] = rx;
    j[1] = ry;
    return j;
  }
  if (j && typeof j === 'object') {
    j.x = rx;
    j.y = ry;
    const tg = j.tags && typeof j.tags === 'object' ? j.tags : {};
    j.tags = { ...tg, x_grid: rx, y_grid: ry };
    return j;
  }
  return [rx, ry];
}

/** @returns {[number, number]} */
function vec(ax, ay, bx, by) {
  return [bx - ax, by - ay];
}

function isAxisAlignedNonZero(v) {
  const [vx, vy] = v;
  return (vx === 0 && vy !== 0) || (vy === 0 && vx !== 0);
}

/** 折線上連續三點 prev→mid→next 是否為同一水平或垂直線之同向延伸 */
function straightAligned(px, py, mx, my, nx, ny) {
  const vIn = vec(px, py, mx, my);
  const vOut = vec(mx, my, nx, ny);
  if (!isAxisAlignedNonZero(vIn) || !isAxisAlignedNonZero(vOut)) return false;
  const dot = vIn[0] * vOut[0] + vIn[1] * vOut[1];
  if (dot <= 0) return false;
  const sameAxis =
    (vIn[0] === 0 && vOut[0] === 0 && vIn[1] !== 0 && vOut[1] !== 0) ||
    (vIn[1] === 0 && vOut[1] === 0 && vIn[0] !== 0 && vOut[0] !== 0);
  return sameAxis;
}

/**
 * @param {number} x0,y0,x1,y1 斜向邊端點
 * @param {number} cx,cy 轉角
 * @param {(number|null)} px0,py0 前一站（可無）
 * @param {(number|null)} nx1,ny1 下一站（可無）
 */
function straightContinuationScore(x0, y0, x1, y1, cx, cy, px0, py0, nx1, ny1) {
  let s = 0;
  if (px0 != null && py0 != null) {
    if (straightAligned(px0, py0, x0, y0, cx, cy)) s++;
  }
  if (nx1 != null && ny1 != null) {
    if (straightAligned(cx, cy, x1, y1, nx1, ny1)) s++;
  }
  return s;
}

function isConnectLikeNode(node) {
  if (!node || typeof node !== 'object') return false;
  const nt = node.node_type ?? node.tags?.node_type;
  if (nt === 'connect') return true;
  return node.connect_number != null || node.tags?.connect_number != null;
}

function nodeAtPolylineVertex(seg, pi, pts) {
  if (!seg || !Array.isArray(pts)) return null;
  const L = pts.length;
  if (pi < 0 || pi >= L) return null;
  const inline = seg.nodes?.[pi];
  if (inline && typeof inline === 'object') return inline;
  if (pi === 0 && seg.properties_start && typeof seg.properties_start === 'object')
    return seg.properties_start;
  if (pi === L - 1 && seg.properties_end && typeof seg.properties_end === 'object')
    return seg.properties_end;
  return null;
}

/** connect 繪製用格：有 display_x/y 時與繪製一致（與 segmentUtils collectRedPointPositions 一致）。 */
function connectEffectiveGridAtVertex(seg, pi) {
  const pts = seg?.points;
  if (!Array.isArray(pts) || pi < 0 || pi >= pts.length) return null;
  const node = nodeAtPolylineVertex(seg, pi, pts);
  if (!isConnectLikeNode(node)) return null;
  const dx = Number(node?.display_x);
  const dy = Number(node?.display_y);
  if (Number.isFinite(dx) && Number.isFinite(dy)) return [num(dx), num(dy)];
  return getXY(pts[pi]);
}

/** 點是否在正交線段開放內部（非端點） */
function pointStrictlyInteriorOnOrthoSegment(px, py, ax, ay, bx, by) {
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

/**
 * 任一段水平／垂直邊之**開放內部**若落在任一紅／藍 connect 的顯示格上（與線上頂點座標可分離），視為無效。
 */
export function orthoFlatSegmentsOverlapsForeignConnectDisplay(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  const grids = [];
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = 0; pi < pts.length; pi++) {
      const g = connectEffectiveGridAtVertex(segments[si], pi);
      if (g) grids.push({ gx: g[0], gy: g[1] });
    }
  }
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      const [ax, ay] = getXY(pts[pi]);
      const [bx, by] = getXY(pts[pi + 1]);
      if (ax !== bx && ay !== by) continue;
      for (const { gx, gy } of grids) {
        if (pointStrictlyInteriorOnOrthoSegment(gx, gy, ax, ay, bx, by)) return true;
      }
    }
  }
  return false;
}

/** 某一（候選／實際）L 型轉角格是否落在「別條線上的」紅／藍 connect 顯示格；僅允許與**當前要替換的斜邊兩個端點**上既有 connect 的顯示格重合。 */
export function orthoLcCornerTouchesForeignRbConnectDisplay(
  cornerGx,
  cornerGy,
  segments,
  diagonalSi,
  diagonalPiLow,
  diagonalPiHigh,
  allowedCornerCellKeys,
) {
  const cx = num(cornerGx);
  const cy = num(cornerGy);
  if (!segments?.length || allowedCornerCellKeys == null) return false;
  if (allowedCornerCellKeys.has(`${cx},${cy}`)) return false;
  let lo = diagonalPiLow;
  let hi = diagonalPiHigh;
  if (lo > hi) [lo, hi] = [hi, lo];
  for (let sj = 0; sj < segments.length; sj++) {
    const pts = segments[sj]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pj = 0; pj < pts.length; pj++) {
      if (sj === diagonalSi && pj >= lo && pj <= hi) continue;
      if (!isConnectLikeNode(nodeAtPolylineVertex(segments[sj], pj, pts))) continue;
      const g = connectEffectiveGridAtVertex(segments[sj], pj);
      if (!g) continue;
      if (g[0] === cx && g[1] === cy) return true;
    }
  }
  return false;
}

function rbConnectAllowedCornerKeysForDiagonalEdge(segments, diagonalSi, diagonalPi) {
  const allowed = new Set();
  const seg = segments?.[diagonalSi];
  const pts = seg?.points;
  if (!Array.isArray(pts)) return allowed;
  for (const pIdx of [diagonalPi, diagonalPi + 1]) {
    if (pIdx < 0 || pIdx >= pts.length) continue;
    if (!isConnectLikeNode(nodeAtPolylineVertex(seg, pIdx, pts))) continue;
    const g = connectEffectiveGridAtVertex(seg, pIdx);
    if (g) allowed.add(`${g[0]},${g[1]}`);
  }
  return allowed;
}

export function orthoDiagonalToLOrthoGeometryOrConnectInvalid(segments) {
  return orthoFlatSegmentsGeometryInvalid(segments) || orthoFlatSegmentsOverlapsForeignConnectDisplay(segments);
}

function insertCorner(segments, si, pi, cornerX, cornerY) {
  const seg = segments[si];
  const pts = seg?.points;
  if (!Array.isArray(pts) || pi < 0 || pi >= pts.length - 1) return false;
  const template = pts[pi];
  const corner = cloneVertexFromTemplate(template, cornerX, cornerY);
  const lenBefore = pts.length;
  pts.splice(pi + 1, 0, corner);
  const nodes = seg.nodes;
  if (Array.isArray(nodes) && nodes.length === lenBefore) {
    const bend = {
      node_type: 'line',
      tags: { x_grid: num(cornerX), y_grid: num(cornerY) },
    };
    nodes.splice(pi + 1, 0, bend);
  }
  return true;
}

/**
 * @param {Array<object>} flatSegments normalizeSpaceNetworkDataToFlatSegments 結果
 * @param {{ preferVertFirst?: boolean }} [options]
 * @returns {{ ok: boolean, segments: Array<object>, replacedCount: number, message?: string }}
 */
export function replaceDiagonalEdgesWithLOrtho(flatSegments, options = {}) {
  const { preferVertFirst = false } = options;
  if (!Array.isArray(flatSegments) || flatSegments.length === 0) {
    return {
      ok: false,
      segments: flatSegments ?? [],
      replacedCount: 0,
      message: '沒有路段資料。',
    };
  }

  let work = shallowCloneOrthoSegmentsSynced(flatSegments);
  if (orthoDiagonalToLOrthoGeometryOrConnectInvalid(work)) {
    return {
      ok: false,
      segments: work,
      replacedCount: 0,
      message:
        '目前路網已有交叉、重疊、頂點落線，或有線段穿過（壓過）非端點上之紅／藍 connect 顯示格；請先修正。',
    };
  }

  let replacedCount = 0;
  const maxPasses = Math.max(64, flatSegments.length * 32);
  let passes = 0;

  while (passes++ < maxPasses) {
    let replacedThisRound = false;

    outer: for (let si = 0; si < work.length; si++) {
      const pts = work[si]?.points;
      if (!Array.isArray(pts) || pts.length < 2) continue;

      for (let pi = 0; pi < pts.length - 1; pi++) {
        const [x0, y0] = getXY(pts[pi]);
        const [x1, y1] = getXY(pts[pi + 1]);
        if (x0 === x1 || y0 === y1) continue;

        const px0 = pi > 0 ? getXY(pts[pi - 1])[0] : null;
        const py0 = pi > 0 ? getXY(pts[pi - 1])[1] : null;
        const nx1 = pi + 2 < pts.length ? getXY(pts[pi + 2])[0] : null;
        const ny1 = pi + 2 < pts.length ? getXY(pts[pi + 2])[1] : null;

        /** 先橫後豎：(x1,y0)；先豎後橫：(x0,y1) */
        const cand = [
          { cx: x1, cy: y0, horizFirst: true },
          { cx: x0, cy: y1, horizFirst: false },
        ];

        const allowedCornerKeys = rbConnectAllowedCornerKeysForDiagonalEdge(work, si, pi);
        const viable = [];
        for (const { cx, cy, horizFirst } of cand) {
          if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
          const trial = JSON.parse(JSON.stringify(work));
          if (!insertCorner(trial, si, pi, cx, cy)) continue;
          syncOrthoFlatSegmentEndpoints(trial);
          if (
            orthoLcCornerTouchesForeignRbConnectDisplay(
              cx,
              cy,
              trial,
              si,
              pi,
              pi + 2,
              allowedCornerKeys,
            ) ||
            orthoDiagonalToLOrthoGeometryOrConnectInvalid(trial)
          )
            continue;
          const score = straightContinuationScore(x0, y0, x1, y1, cx, cy, px0, py0, nx1, ny1);
          viable.push({ trial, score, horizFirst });
        }

        if (viable.length === 0) continue;

        viable.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.horizFirst !== b.horizFirst) {
            if (preferVertFirst) return a.horizFirst ? 1 : -1;
            return a.horizFirst ? -1 : 1;
          }
          return 0;
        });

        work = viable[0].trial;
        replacedCount += 1;
        replacedThisRound = true;
        syncOrthoFlatSegmentEndpoints(work);
        break outer;
      }
    }

    if (!replacedThisRound) break;
  }

  return {
    ok: true,
    segments: work,
    replacedCount,
    message:
      replacedCount === 0
        ? '沒有可替換的非正交邊，或兩種 L 皆違反約束。'
        : `已替換 ${replacedCount} 條非正交邊。`,
  };
}
