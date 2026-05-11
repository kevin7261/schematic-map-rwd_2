/**
 * 將各折線上「非水平／非垂直」的單一邊改為 L（兩段正交），
 * 並以既有 ortho 硬約束過濾交叉／共線重疊／頂點落線。
 * 若兩種 L（先橫後豎／先豎後橫）皆可，選較能與前後鄰邊「串成直線」者。
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
 * @returns {{ ok: boolean, segments: Array<object>, replacedCount: number, message?: string }}
 */
export function replaceDiagonalEdgesWithLOrtho(flatSegments) {
  if (!Array.isArray(flatSegments) || flatSegments.length === 0) {
    return {
      ok: false,
      segments: flatSegments ?? [],
      replacedCount: 0,
      message: '沒有路段資料。',
    };
  }

  let work = shallowCloneOrthoSegmentsSynced(flatSegments);
  if (orthoFlatSegmentsGeometryInvalid(work)) {
    return {
      ok: false,
      segments: work,
      replacedCount: 0,
      message: '目前路網已有交叉、重疊或頂點落線，請先修正。',
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

        const viable = [];
        for (const { cx, cy, horizFirst } of cand) {
          if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
          const trial = JSON.parse(JSON.stringify(work));
          if (!insertCorner(trial, si, pi, cx, cy)) continue;
          syncOrthoFlatSegmentEndpoints(trial);
          if (orthoFlatSegmentsGeometryInvalid(trial)) continue;
          const score = straightContinuationScore(x0, y0, x1, y1, cx, cy, px0, py0, nx1, ny1);
          viable.push({ trial, score, horizFirst });
        }

        if (viable.length === 0) continue;

        viable.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.horizFirst !== b.horizFirst) return a.horizFirst ? -1 : 1;
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
