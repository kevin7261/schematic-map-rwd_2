/**
 * `temp` 列／欄表：**單次最多往紅虛線／紅十字所定中心線移一格**網格（列→Δy；欄→Δx），
 * 並以 {@link checkOrthoGridHardConstraints} 驗證（無交叉／共線重疊／頂點落他線、無非法併格、無零長邊）。
 * 繼續逼近須再由外層多按數次／自動排程迭代。
 *
 * **Pulse 前置：** {@link snapRedBlueTerminalEdgesTowardOrthoBeforeRound} 將紅／藍 connect 末端斜邊盡先拉直（藍端平移）。
 *
 * **決策準則：** 僅評估該一格位移；須硬約束通過，且須維持或增加全路網水平／垂直邊數（若以「正交」分數並列，視為沿用唯一候選）。
 * 頂點收集時**自動展開共點夥伴**（避免共點中只動部分頂點而造成拓撲斷開）。
 */

import {
  applyOrthoVertexRefsDelta,
  buildInitialOrthoCoPointGroups,
  buildOrthoCellGroups,
  checkOrthoGridHardConstraints,
  shallowCloneOrthoSegmentsSynced,
} from './axisAlignGridNetworkHillClimb.js';

function parseParenCoord(str) {
  const m = String(str ?? '').match(/\((-?\d+),(-?\d+)\)/);
  if (!m) return null;
  return { gx: Number(m[1]), gy: Number(m[2]) };
}

/** @param {Array<object>} segments */
function roundedGridPt(segments, segIdx, ptIdx) {
  const pt = segments[segIdx]?.points?.[ptIdx];
  if (!pt) return null;
  const x = Array.isArray(pt) ? Number(pt[0]) : Number(pt?.x);
  const y = Array.isArray(pt) ? Number(pt[1]) : Number(pt?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { gx: Math.round(x), gy: Math.round(y) };
}

/** @returns {Array<{ si: number, pi: number }>} */
function dedupeRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const r of refs) {
    const k = `${r.si},${r.pi}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * 從 orthoRuns 收集頂點 ref，**並展開至同格所有共點夥伴**。
 * 不展開時，共點群中只有部分頂點被移動，造成拓撲斷開（連線飄離節點）。
 * @param {Array<{ segIdx:number, pi0:number, pi1:number }>} runs
 */
function refsFromOrthoVertexRuns(segments, runs) {
  const raw = [];
  if (!Array.isArray(runs)) return raw;
  for (const rn of runs) {
    const si = rn?.segIdx;
    const pLo = Math.min(Number(rn?.pi0), Number(rn?.pi1));
    const pHi = Math.max(Number(rn?.pi0), Number(rn?.pi1));
    if (!Number.isFinite(si) || !Number.isFinite(pLo) || !Number.isFinite(pHi)) continue;
    const pts = segments[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = pLo; pi <= pHi; pi++) {
      if (pts[pi] == null) continue;
      raw.push({ si, pi });
    }
  }
  // Expand each collected vertex's cell to include ALL co-located vertices from ANY segment.
  // This is critical: if vertex A (si=0,pi=2) and vertex B (si=3,pi=0) are co-located (same grid
  // cell), moving only A leaves B behind, breaking the topology connection.
  const gm = buildOrthoCellGroups(segments);
  const seen = new Set();
  const expanded = [];
  for (const r of dedupeRefs(raw)) {
    const pt = segments[r.si]?.points?.[r.pi];
    if (!pt) continue;
    const x = Array.isArray(pt) ? Math.round(Number(pt[0])) : Math.round(Number(pt?.x));
    const y = Array.isArray(pt) ? Math.round(Number(pt[1])) : Math.round(Number(pt?.y));
    for (const cp of (gm.get(`${x},${y}`) ?? [])) {
      const k = `${cp.si},${cp.pi}`;
      if (seen.has(k)) continue;
      seen.add(k);
      expanded.push(cp);
    }
  }
  return expanded;
}

/** @returns {Array<{ si: number, pi: number }>} */
function collectRefsAtCell(segments, gx, gy) {
  const gm = buildOrthoCellGroups(segments);
  return gm.get(`${gx},${gy}`) ?? [];
}

/** 列：網格 y = yy 且 lo≤gx≤hi 之所有共點 ref */
function collectRefsHorizontalBand(segments, yy, lo, hi) {
  const gm = buildOrthoCellGroups(segments);
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const refs = [];
  const seen = new Set();
  for (const [key, grp] of gm.entries()) {
    const [gx, gy] = key.split(',').map(Number);
    if (gy !== yy || gx < a || gx > b) continue;
    for (const g of grp) {
      const k = `${g.si},${g.pi}`;
      if (seen.has(k)) continue;
      seen.add(k);
      refs.push(g);
    }
  }
  return refs;
}

/** 欄：網格 x = xx 且 lo≤gy≤hi 之所有共點 ref */
function collectRefsVerticalBand(segments, xx, lo, hi) {
  const gm = buildOrthoCellGroups(segments);
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const refs = [];
  const seen = new Set();
  for (const [key, grp] of gm.entries()) {
    const [gx, gy] = key.split(',').map(Number);
    if (gx !== xx || gy < a || gy > b) continue;
    for (const g of grp) {
      const k = `${g.si},${g.pi}`;
      if (seen.has(k)) continue;
      seen.add(k);
      refs.push(g);
    }
  }
  return refs;
}

/**
 * 計算路網中水平（dx=0）或垂直（dy=0）的邊數。
 * 用於判斷移動是否破壞正交性：若移動後邊數減少，則不應移動。
 */
function countOrthoEdges(segments) {
  let count = 0;
  for (const seg of segments) {
    const pts = seg?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ax = Array.isArray(a) ? Math.round(Number(a[0])) : Math.round(Number(a?.x));
      const ay = Array.isArray(a) ? Math.round(Number(a[1])) : Math.round(Number(a?.y));
      const bx = Array.isArray(b) ? Math.round(Number(b[0])) : Math.round(Number(b?.x));
      const by = Array.isArray(b) ? Math.round(Number(b[1])) : Math.round(Number(b?.y));
      if (ax === bx || ay === by) count++;
    }
  }
  return count;
}

function orthoRoundedXY(pt) {
  const x = Array.isArray(pt) ? Number(pt[0]) : Number(pt?.x);
  const y = Array.isArray(pt) ? Number(pt[1]) : Number(pt?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [Math.round(x), Math.round(y)];
}

function hasNonEmptyProp(v) {
  return v != null && String(v).trim() !== '';
}

/** 與 ControlTab／示意圖：terminal 標記視為末端（藍），不依賴度數。 */
function connectTaggedTerminalBlueHue(nodes, pi) {
  const n = Array.isArray(nodes) ? nodes[pi] : null;
  if (!n || typeof n !== 'object') return false;
  const tags = n.tags && typeof n.tags === 'object' ? n.tags : {};
  const raw =
    n.type ?? tags.type ?? n.connect_type ?? tags.connect_type ?? n.station_type ?? tags.station_type;
  const s = raw == null ? '' : String(raw).trim().toLowerCase();
  if (!s) return false;
  return (
    s === 'terminal' || s === 'terminus' || s === 'end' || s === 'endpoint' || s === 'line_end'
  );
}

function vertexIsConnectNode(seg, pi) {
  const nodes = Array.isArray(seg?.nodes) ? seg.nodes : [];
  const n = nodes[pi];
  if (!n || typeof n !== 'object') return false;
  const nt = String(n.node_type ?? '').trim();
  const tags = n.tags && typeof n.tags === 'object' ? n.tags : {};
  return nt === 'connect' || hasNonEmptyProp(n.connect_number) || hasNonEmptyProp(tags.connect_number);
}

/** 全路網：每個格點上所「掛」的折線段端次數之和（繪圖上紅／藍分界與 taipei_h3 一致）。 */
function buildGridConnectEdgeIncidence(segments) {
  const deg = new Map();
  const bump = (gx, gy) => {
    const k = `${gx},${gy}`;
    deg.set(k, (deg.get(k) ?? 0) + 1);
  };
  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si]?.points;
    if (!Array.isArray(pts)) continue;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      const a = orthoRoundedXY(pts[pi]);
      const b = orthoRoundedXY(pts[pi + 1]);
      if (!a || !b) continue;
      if (a[0] === b[0] && a[1] === b[1]) continue;
      bump(a[0], a[1]);
      bump(b[0], b[1]);
    }
  }
  return deg;
}

function isBlueHueConnectVertex(seg, pi, incidence) {
  if (!vertexIsConnectNode(seg, pi)) return false;
  const nodes = seg?.nodes ?? [];
  if (connectTaggedTerminalBlueHue(nodes, pi)) return true;
  const coords = orthoRoundedXY(seg.points?.[pi]);
  if (!coords) return false;
  const d = incidence.get(`${coords[0]},${coords[1]}`) ?? 0;
  return d <= 1;
}

function isRedHueConnectVertex(seg, pi, incidence) {
  return vertexIsConnectNode(seg, pi) && !isBlueHueConnectVertex(seg, pi, incidence);
}

/** 統計<strong>同名路線</strong>各路網段上之正交邊朝向（不含被排除的那一條）。 */
function countOrthoHVExcludeEdgeOnSameRoute(segments, routeKey, excludeSi, excludePi) {
  let h = 0;
  let v = 0;
  const rk = String(routeKey ?? '').trim();
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const rn = String(seg?.route_name ?? seg?.name ?? '').trim();
    if (rn !== rk) continue;
    const pts = seg?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      if (si === excludeSi && pi === excludePi) continue;
      const ax = orthoRoundedXY(pts[pi]);
      const bx = orthoRoundedXY(pts[pi + 1]);
      if (!ax || !bx) continue;
      if (ax[0] === bx[0] && ax[1] === bx[1]) continue;
      if (ax[0] === bx[0]) v += 1;
      else if (ax[1] === bx[1]) h += 1;
    }
  }
  return { h, v };
}

/**
 * 「站點與路線往中心聚集」：**每次 pulse 開始前**將紅（交叉／非末端）連接點與藍（末端）連接點間之**斜邊**，
 * 嘗試平移<strong>藍端</strong>使之與紅端對齊成水平段或垂直段；二擇時依<strong>同名路線</strong>其他正交邊之水平／垂直多數決。
 * 會重複掃描直至本輪無可套用者；每步均經 {@link checkOrthoGridHardConstraints}，且維持或增加 {@link countOrthoEdges}。
 *
 * @param {Array<object>} segments — 已 clone 之 flat 路網（**原地修改**）
 * @param {Map<string,string>} initialGroupIds — 本 pulse 起始共點群組（與朝中心縮進相同）
 * @param {{ maxPasses?: number }} [opts]
 * @returns {{ appliedAny: boolean, cellsMovedSum: number }}
 */
export function snapRedBlueTerminalEdgesTowardOrthoBeforeRound(segments, initialGroupIds, opts = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { appliedAny: false, cellsMovedSum: 0 };
  }
  const maxPasses = opts.maxPasses ?? Math.max(256, segments.length * 32);
  let cellsMovedSum = 0;
  let appliedAny = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    const incidence = buildGridConnectEdgeIncidence(segments);
    const snapped = trySnapOneRedBlueDiagonalEdge(segments, initialGroupIds, incidence);
    if (!snapped) break;
    appliedAny = true;
    cellsMovedSum += snapped.manhattan;
  }
  return { appliedAny, cellsMovedSum };
}

/** @returns {{ manhattan: number }|null} */
function trySnapOneRedBlueDiagonalEdge(segments, initialGroupIds, incidence) {
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const pts = seg?.points;
    const nPts = Array.isArray(pts) ? pts.length : 0;
    if (nPts < 2) continue;
    const routeKey = String(seg?.route_name ?? seg?.name ?? '').trim();

    for (let pi = 0; pi < nPts - 1; pi++) {
      const a = orthoRoundedXY(pts[pi]);
      const bc = orthoRoundedXY(pts[pi + 1]);
      if (!a || !bc) continue;
      const [ax, ay] = a;
      const [bxGrid, byGrid] = bc;
      if (ax === bxGrid || ay === byGrid) continue;

      if (!vertexIsConnectNode(seg, pi) || !vertexIsConnectNode(seg, pi + 1)) continue;

      let bluePi = null;
      let redPi = null;
      if (isBlueHueConnectVertex(seg, pi, incidence) && isRedHueConnectVertex(seg, pi + 1, incidence)) {
        bluePi = pi;
        redPi = pi + 1;
      } else if (
        isBlueHueConnectVertex(seg, pi + 1, incidence) &&
        isRedHueConnectVertex(seg, pi, incidence)
      ) {
        bluePi = pi + 1;
        redPi = pi;
      } else continue;

      const rxy = orthoRoundedXY(pts[redPi]);
      const bxy = orthoRoundedXY(pts[bluePi]);
      if (!rxy || !bxy) continue;
      const [rx, ry] = rxy;
      const [blx, bly] = bxy;

      const deltaH = { dx: 0, dy: ry - bly, kind: 'H' };
      const deltaV = { dx: rx - blx, dy: 0, kind: 'V' };

      const gm = buildOrthoCellGroups(segments);
      const rawRefs = dedupeRefs(gm.get(`${blx},${bly}`) ?? []);
      if (rawRefs.length === 0) continue;

      const baseOrtho = countOrthoEdges(segments);
      const { h: prefH, v: prefV } = countOrthoHVExcludeEdgeOnSameRoute(
        segments,
        routeKey,
        si,
        pi,
      );
      const routePrefer = prefH === prefV ? 0 : prefH > prefV ? 1 : -1;

      const evaluate = (d) => {
        if (d.dx === 0 && d.dy === 0) return null;
        const trial = shallowCloneOrthoSegmentsSynced(segments);
        const trialGm = buildOrthoCellGroups(trial);
        const refs = dedupeRefs(trialGm.get(`${blx},${bly}`) ?? []);
        applyOrthoVertexRefsDelta(trial, refs, d.dx, d.dy);
        if (!checkOrthoGridHardConstraints(trial, initialGroupIds).ok) return null;
        const o = countOrthoEdges(trial);
        if (o < baseOrtho) return null;
        let orthoScore = o * 10_000;
        if (routePrefer === 1 && d.kind === 'H') orthoScore += 500;
        else if (routePrefer === -1 && d.kind === 'V') orthoScore += 500;
        else if (routePrefer === 0 && d.kind === 'H') orthoScore += 1;
        return {
          dx: d.dx,
          dy: d.dy,
          kind: d.kind,
          orthoEdges: o,
          orthoScore,
          manhattanAbs: Math.abs(d.dx) + Math.abs(d.dy),
        };
      };

      const cH = evaluate(deltaH);
      const cV = evaluate(deltaV);
      let winner = null;
      if (!cH) winner = cV;
      else if (!cV) winner = cH;
      else if (cH.orthoEdges !== cV.orthoEdges) winner = cH.orthoEdges >= cV.orthoEdges ? cH : cV;
      else if (cH.orthoScore !== cV.orthoScore) winner = cH.orthoScore >= cV.orthoScore ? cH : cV;
      /** 仍平手則優先位移量較小者（常見為單邊為 1 格）。 */
      else winner = cH.manhattanAbs <= cV.manhattanAbs ? cH : cV;

      if (!winner) continue;

      applyOrthoVertexRefsDelta(segments, rawRefs, winner.dx, winner.dy);
      return { manhattan: winner.manhattanAbs };
    }
  }
  return null;
}

/** 單次 Pulse 最多往中心方向位移的網格整數數（規格為 1 格） */
const MAX_GRID_UNITS_TOWARD_RED_CROSS_LINE = 1;

/**
 * @param {Array<object>} flatSegments - normalizeSpaceNetworkDataToFlatSegments 結果
 * @param {'row'|'col'} tableAxis 列表用 row（動 y）、欄表用 col（動 x）
 * @param {{ kind: string, axisY?: number|null, axisX?: number|null, startCoord?: string, endCoord?: string,
 *   orthoV?: { segIdx: number, ptIdx: number },
 *   orthoRuns?: Array<{ segIdx: number, pi0: number, pi1: number }> }} item
 * @param {number} centerCx
 * @param {number} centerCy
 * @param {{ frozenVertexGroupIds?: Map<string, string> }} [opts]
 *   連續多步縮進時請傳**第一次按下前**對原路網之 `buildInitialOrthoCoPointGroups` 結果，以維持共點併格規則與第一次狀態一致。
 * @returns {{ ok: boolean, applied: boolean, skip?: boolean, segments?: Array|null, cellsMoved?: number, message?: string }}
 */
export function tryOrthoTowardCrossNudgeFromReportItem(
  flatSegments,
  tableAxis,
  item,
  centerCx,
  centerCy,
  opts = {},
) {
  const tcx = Math.round(Number(centerCx));
  const tcy = Math.round(Number(centerCy));
  const frozenVertexGroupIds = opts.frozenVertexGroupIds ?? null;
  if (!Array.isArray(flatSegments) || flatSegments.length === 0) {
    return { ok: false, applied: false, message: '沒有路網' };
  }
  const work = shallowCloneOrthoSegmentsSynced(flatSegments);
  const initialIds =
    frozenVertexGroupIds != null ? frozenVertexGroupIds : buildInitialOrthoCoPointGroups(work);

  // --- 收集 refs 與判斷移動方向 ---
  let baseDx = 0;
  let baseDy = 0;
  let refs = [];
  let currentAxisCoord = null; // gy for row, gx for col

  if (tableAxis === 'row') {
    if (item.kind === '點') {
      const ov = item.orthoV;
      if (ov?.segIdx != null && ov?.ptIdx != null) {
        const rc = roundedGridPt(work, ov.segIdx, ov.ptIdx);
        if (!rc) return { ok: true, applied: false, skip: true, message: '此項對應頂點已不存在' };
        if (rc.gy === tcy)
          return { ok: true, applied: false, skip: true, message: '已在水平中心線' };
        baseDy = rc.gy < tcy ? 1 : -1;
        currentAxisCoord = rc.gy;
        refs = collectRefsAtCell(work, rc.gx, rc.gy);
      } else {
        const p = parseParenCoord(item.startCoord);
        if (!p) return { ok: false, applied: false, message: '無法解析點座標' };
        if (p.gy === tcy)
          return { ok: true, applied: false, skip: true, message: '已在水平中心線' };
        baseDy = p.gy < tcy ? 1 : -1;
        currentAxisCoord = p.gy;
        refs = collectRefsAtCell(work, p.gx, p.gy);
      }
    } else if (item.kind === '線') {
      const runs = item.orthoRuns;
      if (Array.isArray(runs) && runs.length > 0) {
        refs = refsFromOrthoVertexRuns(work, runs);
        if (!refs.length) return { ok: true, applied: false, skip: true, message: '此項無對應頂點' };
        let leadGy = null;
        for (const r of refs) {
          const c = roundedGridPt(work, r.si, r.pi);
          if (!c) continue;
          if (leadGy == null) leadGy = c.gy;
          else if (c.gy !== leadGy)
            return { ok: true, applied: false, skip: true, message: '合併橫線縱跨多列（非預期）' };
        }
        if (leadGy == null) return { ok: true, applied: false, skip: true, message: '此項無有效格座標' };
        if (leadGy === tcy)
          return { ok: true, applied: false, skip: true, message: '已在水平中心線' };
        baseDy = leadGy < tcy ? 1 : -1;
        currentAxisCoord = leadGy;
      } else {
        const yy =
          item.axisY != null && Number.isFinite(Number(item.axisY)) ? Number(item.axisY) : null;
        if (yy === null)
          return { ok: false, applied: false, message: '列「線」缺少網格 y' };
        if (yy === tcy)
          return { ok: true, applied: false, skip: true, message: '已在水平中心線' };
        baseDy = yy < tcy ? 1 : -1;
        currentAxisCoord = yy;
        const a = parseParenCoord(item.startCoord);
        const b = parseParenCoord(item.endCoord ?? '');
        if (!a || !b) return { ok: false, applied: false, message: '無法解析線端點座標' };
        const lo = Math.min(a.gx, b.gx);
        const hi = Math.max(a.gx, b.gx);
        refs = collectRefsHorizontalBand(work, yy, lo, hi);
      }
    } else return { ok: false, applied: false, message: '未知項目型態' };
  } else if (tableAxis === 'col') {
    if (item.kind === '點') {
      const ov = item.orthoV;
      if (ov?.segIdx != null && ov?.ptIdx != null) {
        const rc = roundedGridPt(work, ov.segIdx, ov.ptIdx);
        if (!rc) return { ok: true, applied: false, skip: true, message: '此項對應頂點已不存在' };
        if (rc.gx === tcx)
          return { ok: true, applied: false, skip: true, message: '已在垂直中心線' };
        baseDx = rc.gx < tcx ? 1 : -1;
        currentAxisCoord = rc.gx;
        refs = collectRefsAtCell(work, rc.gx, rc.gy);
      } else {
        const p = parseParenCoord(item.startCoord);
        if (!p) return { ok: false, applied: false, message: '無法解析點座標' };
        if (p.gx === tcx)
          return { ok: true, applied: false, skip: true, message: '已在垂直中心線' };
        baseDx = p.gx < tcx ? 1 : -1;
        currentAxisCoord = p.gx;
        refs = collectRefsAtCell(work, p.gx, p.gy);
      }
    } else if (item.kind === '線') {
      const runs = item.orthoRuns;
      if (Array.isArray(runs) && runs.length > 0) {
        refs = refsFromOrthoVertexRuns(work, runs);
        if (!refs.length) return { ok: true, applied: false, skip: true, message: '此項無對應頂點' };
        let leadGx = null;
        for (const r of refs) {
          const c = roundedGridPt(work, r.si, r.pi);
          if (!c) continue;
          if (leadGx == null) leadGx = c.gx;
          else if (c.gx !== leadGx)
            return { ok: true, applied: false, skip: true, message: '合併縱線橫跨多欄（非預期）' };
        }
        if (leadGx == null) return { ok: true, applied: false, skip: true, message: '此項無有效格座標' };
        if (leadGx === tcx)
          return { ok: true, applied: false, skip: true, message: '已在垂直中心線' };
        baseDx = leadGx < tcx ? 1 : -1;
        currentAxisCoord = leadGx;
      } else {
        const xx =
          item.axisX != null && Number.isFinite(Number(item.axisX)) ? Number(item.axisX) : null;
        if (xx === null)
          return { ok: false, applied: false, message: '欄「線」缺少網格 x' };
        if (xx === tcx)
          return { ok: true, applied: false, skip: true, message: '已在垂直中心線' };
        baseDx = xx < tcx ? 1 : -1;
        currentAxisCoord = xx;
        const a = parseParenCoord(item.startCoord);
        const b = parseParenCoord(item.endCoord ?? '');
        if (!a || !b) return { ok: false, applied: false, message: '無法解析線端點座標' };
        const lo = Math.min(a.gy, b.gy);
        const hi = Math.max(a.gy, b.gy);
        refs = collectRefsVerticalBand(work, xx, lo, hi);
      }
    } else return { ok: false, applied: false, message: '未知項目型態' };
  } else {
    return { ok: false, applied: false, message: '內部：tableAxis' };
  }

  refs = dedupeRefs(refs);
  if (refs.length === 0) {
    return { ok: true, applied: false, skip: true, message: '此項無頂點可動' };
  }

  // --- 僅評估「往中心方向一整格」（不再於單次內連跳多格） ---
  const targetAxisCoord = tableAxis === 'row' ? tcy : tcx;
  const distToCenter = Math.abs(targetAxisCoord - currentAxisCoord);
  const maxSteps = Math.min(distToCenter, MAX_GRID_UNITS_TOWARD_RED_CROSS_LINE);

  const currentOrtho = countOrthoEdges(work);

  let bestStep = null;
  let bestOrtho = -1;

  for (let step = 1; step <= maxSteps; step++) {
    const dx = baseDx * step;
    const dy = baseDy * step;
    const trial = shallowCloneOrthoSegmentsSynced(work);
    applyOrthoVertexRefsDelta(trial, refs, dx, dy);
    const ck = checkOrthoGridHardConstraints(trial, initialIds);
    if (!ck.ok) continue;
    const n = countOrthoEdges(trial);
    if (n > bestOrtho || (n === bestOrtho && step > bestStep)) {
      bestOrtho = n;
      bestStep = step;
    }
  }

  if (bestStep === null) {
    return {
      ok: true,
      applied: false,
      message: '朝中心移一格無法通過硬約束，本次未移動。',
    };
  }

  if (bestOrtho < currentOrtho) {
    return {
      ok: true,
      applied: false,
      message: `移一格後水平垂直邊數 ${bestOrtho} < 目前 ${currentOrtho}，正交性下降，跳過。`,
    };
  }

  applyOrthoVertexRefsDelta(work, refs, baseDx * bestStep, baseDy * bestStep);

  return { ok: true, applied: true, segments: work, cellsMoved: bestStep };
}
