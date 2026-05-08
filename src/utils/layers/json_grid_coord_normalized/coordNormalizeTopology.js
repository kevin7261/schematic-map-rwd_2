/**
 * 座標正規化後幾何拓撲比對（c3 vs d3）
 *
 *  1. 新增交叉點
 *  2. 新增路線重疊
 *  3. 自身折線轉彎方向翻轉（三點叉積符號變號）
 *  4. 相對「鄰路線邊」左右側翻轉（點相對他線法向從一側跑到另一側；南勢角類案例）
 */

import { normalizeSpaceNetworkDataToFlatSegments } from '@/utils/gridNormalizationMinDistance.js';

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function num(v) {
  return Number(v ?? 0);
}

function toPt(raw) {
  if (Array.isArray(raw)) return { x: num(raw[0]), y: num(raw[1]) };
  return { x: num(raw?.x), y: num(raw?.y) };
}

function clean(s) {
  const t = String(s ?? '').trim();
  return t === '—' || t === '－' ? '' : t;
}

/** 取得某段某頂點的車站顯示名 */
function stationAt(seg, pi, nPts) {
  const nodes = Array.isArray(seg?.nodes) ? seg.nodes : [];
  if (nodes.length === nPts && nodes[pi] && typeof nodes[pi] === 'object') {
    const n = nodes[pi];
    const sn = clean(n.station_name ?? n.tags?.station_name ?? n.tags?.name ?? '');
    const cn = n.connect_number ?? n.tags?.connect_number;
    if (sn && cn != null && String(cn) !== '') return `${sn}(轉乘#${cn})`;
    if (sn) return sn;
    if (cn != null && String(cn) !== '') return `轉乘#${cn}`;
    if (n.node_type === 'connect') return '轉乘點';
  }
  if (pi === 0 && seg?.properties_start) {
    const sn = clean(
      seg.properties_start.station_name ?? seg.properties_start.tags?.station_name ?? ''
    );
    if (sn) return sn;
  }
  if (pi === nPts - 1 && seg?.properties_end) {
    const sn = clean(
      seg.properties_end.station_name ?? seg.properties_end.tags?.station_name ?? ''
    );
    if (sn) return sn;
  }
  return '';
}

/**
 * @typedef {{ pts: Array<{x:number,y:number}>, routeName: string, sNames: string[] }} Run
 */

/** 將路段資料展平為 Run 陣列 */
function toRuns(rawSegs) {
  const flat = normalizeSpaceNetworkDataToFlatSegments(Array.isArray(rawSegs) ? rawSegs : []);
  const out = [];
  for (let k = 0; k < flat.length; k++) {
    const seg = flat[k];
    const pts = (seg.points || []).map(toPt);
    if (pts.length < 2) continue;
    const routeName = clean(seg.route_name ?? seg.name ?? '') || `路段#${k}`;
    out.push({
      pts,
      routeName,
      sNames: pts.map((_, pi) => stationAt(seg, pi, pts.length)),
    });
  }
  return out;
}

/** 格式化座標 */
function pFmt(p) {
  return `(${Math.round(p.x)},${Math.round(p.y)})`;
}

/** 格式化頂點（含路線名、車站名、座標） */
function vLabel(run, pi) {
  const sn = run.sNames[pi];
  const loc = pFmt(run.pts[pi]);
  return sn
    ? `路線「${run.routeName}」車站「${sn}」${loc}`
    : `路線「${run.routeName}」第${pi}點 ${loc}`;
}

/** 格式化邊（含路線名、兩端點車站名、座標） */
function eLabel(run, ei) {
  const a = run.sNames[ei]
    ? `「${run.sNames[ei]}」${pFmt(run.pts[ei])}`
    : pFmt(run.pts[ei]);
  const b = run.sNames[ei + 1]
    ? `「${run.sNames[ei + 1]}」${pFmt(run.pts[ei + 1])}`
    : pFmt(run.pts[ei + 1]);
  return `路線「${run.routeName}」${a}→${b}`;
}

// ─── 幾何計算 ─────────────────────────────────────────────────────────────────

const EPS = 1e-9;

function cross2d(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/**
 * 線段 (p1,p2) 與 (q1,q2) 的內部真交叉（不含端點碰觸）。
 * @returns {{ x:number, y:number }|null}
 */
function segCross(p1, p2, q1, q2) {
  const dx = p2.x - p1.x,
    dy = p2.y - p1.y;
  const ex = q2.x - q1.x,
    ey = q2.y - q1.y;
  const denom = cross2d(dx, dy, ex, ey);
  if (Math.abs(denom) < EPS) return null; // 平行
  const fx = q1.x - p1.x,
    fy = q1.y - p1.y;
  const t = cross2d(fx, fy, ex, ey) / denom;
  const s = cross2d(fx, fy, dx, dy) / denom;
  if (t > EPS && t < 1 - EPS && s > EPS && s < 1 - EPS) {
    return { x: p1.x + t * dx, y: p1.y + t * dy };
  }
  return null;
}

/**
 * 線段 (p1,p2) 與 (q1,q2) 的共線重合（超過一個點）。
 * @returns {{ x:number, y:number }|null} 重疊區間中點
 */
function segOverlap(p1, p2, q1, q2) {
  const dx = p2.x - p1.x,
    dy = p2.y - p1.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return null;
  const sqLen = Math.sqrt(len2);
  if (Math.abs(cross2d(dx, dy, q1.x - p1.x, q1.y - p1.y)) > EPS * sqLen) return null;
  if (Math.abs(cross2d(dx, dy, q2.x - p1.x, q2.y - p1.y)) > EPS * sqLen) return null;
  const tq1 = ((q1.x - p1.x) * dx + (q1.y - p1.y) * dy) / len2;
  const tq2 = ((q2.x - p1.x) * dx + (q2.y - p1.y) * dy) / len2;
  const lo = Math.max(0, Math.min(tq1, tq2));
  const hi = Math.min(1, Math.max(tq1, tq2));
  if (hi - lo < EPS) return null;
  const tm = (lo + hi) / 2;
  return { x: p1.x + tm * dx, y: p1.y + tm * dy };
}

/**
 * 折線轉彎叉積符號：+1 左轉（逆時針）、-1 右轉（順時針）、0 直行
 */
function bendSign(prev, curr, next) {
  const ax = curr.x - prev.x,
    ay = curr.y - prev.y;
  const bx = next.x - curr.x,
    by = next.y - curr.y;
  const z = cross2d(ax, ay, bx, by);
  const scale = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (scale < EPS) return 0;
  /* 略放寬：格點微調時小轉角易被當成共線；鄰線側向檢查會補捉「跑到另一邊」 */
  if (Math.abs(z) < scale * 1e-12) return 0;
  return z > 0 ? 1 : -1;
}

/** 點到有限線段之平方距離、垂足參數 t∈[0,1] */
function distSegFoot(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) {
    const ex = p.x - a.x,
      ey = p.y - a.y;
    return { dist2: ex * ex + ey * ey, t: 0 };
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx,
    cy = a.y + t * dy;
  const ex = p.x - cx,
    ey = p.y - cy;
  return { dist2: ex * ex + ey * ey, t };
}

/** 點 p 相對有向邊 a→b 的左右側：+1 / -1；幾乎在直線上則 0 */
function sideOfEdge(p, a, b) {
  const z = cross2d(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < EPS) return 0;
  if (Math.abs(z) < len * 2e-8) return 0;
  return z > 0 ? 1 : -1;
}

function bboxMaxSpan(runs) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const r of runs) {
    for (const q of r.pts) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  }
  const sx = maxX - minX;
  const sy = maxY - minY;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return 800;
  return Math.max(sx, sy, 1);
}

/**
 * 頂點相對「他路線」某邊，正規化前後是否在直線的另一側。
 *（同一遍歷序下 EC[k]／ED[k] 邊一一對齊時使用。）
 */
function collectNeighborSideFlips(C, D, EC, ED, opts) {
  const {
    maxReports = 24,
    rFactor = 0.068,
    rFloor = 22,
  } = opts || {};

  /** @type {string[]} */
  const issues = [];
  if (!C.length || EC.length !== ED.length) return issues;

  const span = Math.max(bboxMaxSpan(C), bboxMaxSpan(D));
  const Rnear = Math.max(rFloor, span * rFactor);
  const Rnear2 = Rnear * Rnear;

  const orderVerts = [];
  for (let ri = 0; ri < C.length; ri++) {
    for (let pi = 0; pi < C[ri].pts.length; pi++) {
      orderVerts.push({ ri, pi, named: !!C[ri].sNames[pi] });
    }
  }
  /* 有站名優先（如南勢角）*/
  orderVerts.sort((a, b) => Number(b.named) - Number(a.named));

  const seenVtx = new Set();

  for (const { ri, pi } of orderVerts) {
    if (issues.length >= maxReports) break;

    const vKey = `${ri}_${pi}`;
    if (seenVtx.has(vKey)) continue;

    const vc = C[ri].pts[pi];
    const vd = D[ri].pts[pi];

    let bestK = -1;
    let bestSumD2 = Infinity;
    let bestFc = /** @type {null | ReturnType<typeof distSegFoot>} */ (null);
    let bestFd = /** @type {null | ReturnType<typeof distSegFoot>} */ (null);

    for (let k = 0; k < EC.length; k++) {
      if (EC[k].ri === ri) continue;

      const ebc = EC[k];
      const ebd = ED[k];

      const fc = distSegFoot(vc, ebc.p1, ebc.p2);
      const fd = distSegFoot(vd, ebd.p1, ebd.p2);

      if (fc.dist2 > Rnear2 || fd.dist2 > Rnear2) continue;

      /* 垂足若在端點上，叉向不穩定；其餘整段皆可 */
      const edgeEps = 1e-5;
      if (
        fc.t <= edgeEps ||
        fc.t >= 1 - edgeEps ||
        fd.t <= edgeEps ||
        fd.t >= 1 - edgeEps
      )
        continue;

      const zc = sideOfEdge(vc, ebc.p1, ebc.p2);
      const zd = sideOfEdge(vd, ebd.p1, ebd.p2);
      if (zc === 0 || zd === 0 || zc === zd) continue;

      const sumD = fc.dist2 + fd.dist2;
      if (sumD < bestSumD2) {
        bestSumD2 = sumD;
        bestK = k;
        bestFc = fc;
        bestFd = fd;
      }
    }

    if (bestK < 0 || !bestFc || !bestFd) continue;

    seenVtx.add(vKey);
    const ebd = ED[bestK];
    const ecLabel = eLabel(ebd.run, ebd.ei);
    /* 對照後版座標報告使用者 */
    const distShow = Math.sqrt(Math.min(bestFc.dist2, bestFd.dist2));

    issues.push(
      `相對鄰線側向翻面：` +
        `${vLabel(D[ri], pi)}；` +
        `參考鄰線 ${ecLabel}（頂點距該線約 ${distShow.toFixed(1)} 格）。` +
        `相對此有向線段，正規化前後落在直線兩側（已跨到鄰線另一邊）。`
    );
  }

  return issues;
}

/**
 * @typedef {{ ri: number, ei: number, p1: {x:number,y:number}, p2: {x:number,y:number}, run: Run }} Edge
 */

/** 建立全部邊的扁平清單 */
function mkEdges(runs) {
  /** @type {Edge[]} */
  const E = [];
  for (let ri = 0; ri < runs.length; ri++) {
    for (let ei = 0; ei + 1 < runs[ri].pts.length; ei++) {
      E.push({ ri, ei, p1: runs[ri].pts[ei], p2: runs[ri].pts[ei + 1], run: runs[ri] });
    }
  }
  return E;
}

/** 同路段且相鄰（共用端點），不算交叉 */
function isAdj(a, b) {
  return a.ri === b.ri && Math.abs(a.ei - b.ei) <= 1;
}

/**
 * 路線對 (ri, rj) 在 edges 中是否有任何交叉（供結構不對齊時的備援比對）
 */
function routePairHasCross(edges, ri, rj) {
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].ri !== ri) continue;
    for (let j = 0; j < edges.length; j++) {
      if (edges[j].ri !== rj) continue;
      if (segCross(edges[i].p1, edges[i].p2, edges[j].p1, edges[j].p2)) return true;
    }
  }
  return false;
}

/**
 * 路線對 (ri, rj) 在 edges 中是否有任何重疊
 */
function routePairHasOverlap(edges, ri, rj) {
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].ri !== ri) continue;
    for (let j = 0; j < edges.length; j++) {
      if (edges[j].ri !== rj) continue;
      if (segOverlap(edges[i].p1, edges[i].p2, edges[j].p1, edges[j].p2)) return true;
    }
  }
  return false;
}

// ─── 主函式 ───────────────────────────────────────────────────────────────────

/**
 * 比對正規化前（c3）與正規化後（d3）的幾何拓撲。
 * @param {unknown[]} c3Segments
 * @param {unknown[]} d3Segments
 */
export function analyzeCoordNormalizeTopology(c3Segments, d3Segments) {
  const C = toRuns(c3Segments);
  const D = toRuns(d3Segments);

  const out = {
    skipped: false,
    topologyPreserved: true,
    summaryZh: '',
    reasons: /** @type {string[]} */ ([]),
    nonDegree2VertexCountBefore: 0,
    nonDegree2VertexCountAfter: 0,
    componentCountBefore: 0,
    componentCountAfter: 0,
    statsCaptionZh: '',
  };

  if (!C.length || !D.length) {
    out.skipped = true;
    out.summaryZh = '路網資料為空，略過比對。';
    return out;
  }

  // ── 結構對齊檢查 ──────────────────────────────────────────────────────────
  let structMatch = C.length === D.length;
  if (!structMatch) {
    out.topologyPreserved = false;
    out.reasons.push(`路段數不同：正規化前 ${C.length} 段，後 ${D.length} 段。`);
  } else {
    for (let i = 0; i < C.length; i++) {
      if (C[i].pts.length !== D[i].pts.length) {
        structMatch = false;
        out.topologyPreserved = false;
        out.reasons.push(
          `路線「${C[i].routeName}」的折線頂點數改變：${C[i].pts.length} → ${D[i].pts.length}（正規化可能截斷或增加了頂點）。`
        );
      }
    }
  }

  const EC = mkEdges(C);
  const ED = mkEdges(D);

  /* 邊太多時限速（避免 O(E²) 跑太久） */
  const EDGE_CAP = 4000;
  const edgeTooMany = EC.length > EDGE_CAP || ED.length > EDGE_CAP;
  if (edgeTooMany) {
    out.reasons.push(
      `邊數過多（正規化前 ${EC.length} 條、後 ${ED.length} 條），僅抽查前 ${EDGE_CAP} 條邊的交叉／重疊。`
    );
  }
  const ecCheck = edgeTooMany ? EC.slice(0, EDGE_CAP) : EC;
  const edCheck = edgeTooMany ? ED.slice(0, EDGE_CAP) : ED;

  const MAX = 12;

  // ── 檢查 1：新增交叉點 ────────────────────────────────────────────────────
  const crossIssues = /** @type {string[]} */ ([]);

  if (structMatch) {
    /* 精確模式：逐邊對比（ecCheck[k] 對應 edCheck[k]） */
    for (let i = 0; i < edCheck.length && crossIssues.length < MAX; i++) {
      for (let j = i + 1; j < edCheck.length && crossIssues.length < MAX; j++) {
        if (isAdj(edCheck[i], edCheck[j])) continue;
        const xD = segCross(edCheck[i].p1, edCheck[i].p2, edCheck[j].p1, edCheck[j].p2);
        if (!xD) continue;
        const xC =
          i < ecCheck.length && j < ecCheck.length
            ? segCross(ecCheck[i].p1, ecCheck[i].p2, ecCheck[j].p1, ecCheck[j].p2)
            : null;
        if (xC) continue; // 原本就有交叉
        crossIssues.push(
          `新增交叉點 ${pFmt(xD)}：${eLabel(edCheck[i].run, edCheck[i].ei)} 與 ${eLabel(edCheck[j].run, edCheck[j].ei)} 在正規化後互交。`
        );
      }
    }
  } else {
    /* 備援模式：路線對為單位 */
    const checked = new Set();
    for (let i = 0; i < edCheck.length && crossIssues.length < MAX; i++) {
      for (let j = i + 1; j < edCheck.length && crossIssues.length < MAX; j++) {
        if (edCheck[i].ri === edCheck[j].ri) continue;
        const pk = `${Math.min(edCheck[i].ri, edCheck[j].ri)}|${Math.max(edCheck[i].ri, edCheck[j].ri)}`;
        if (checked.has(pk)) continue;
        const xD = segCross(edCheck[i].p1, edCheck[i].p2, edCheck[j].p1, edCheck[j].p2);
        if (!xD) continue;
        checked.add(pk);
        if (routePairHasCross(ecCheck, edCheck[i].ri, edCheck[j].ri)) continue;
        crossIssues.push(
          `新增交叉：路線「${edCheck[i].run.routeName}」與「${edCheck[j].run.routeName}」在 ${pFmt(xD)} 附近相交，正規化前未相交。`
        );
      }
    }
  }

  // ── 檢查 2：新增路線重疊 ──────────────────────────────────────────────────
  const overlapIssues = /** @type {string[]} */ ([]);

  if (structMatch) {
    for (let i = 0; i < edCheck.length && overlapIssues.length < MAX; i++) {
      for (let j = i + 1; j < edCheck.length && overlapIssues.length < MAX; j++) {
        if (isAdj(edCheck[i], edCheck[j])) continue;
        const ovD = segOverlap(edCheck[i].p1, edCheck[i].p2, edCheck[j].p1, edCheck[j].p2);
        if (!ovD) continue;
        const ovC =
          i < ecCheck.length && j < ecCheck.length
            ? segOverlap(ecCheck[i].p1, ecCheck[i].p2, ecCheck[j].p1, ecCheck[j].p2)
            : null;
        if (ovC) continue;
        overlapIssues.push(
          `新增路線重疊（約 ${pFmt(ovD)}）：${eLabel(edCheck[i].run, edCheck[i].ei)} 與 ${eLabel(edCheck[j].run, edCheck[j].ei)} 在正規化後共線重合。`
        );
      }
    }
  } else {
    const checked = new Set();
    for (let i = 0; i < edCheck.length && overlapIssues.length < MAX; i++) {
      for (let j = i + 1; j < edCheck.length && overlapIssues.length < MAX; j++) {
        if (edCheck[i].ri === edCheck[j].ri) continue;
        const pk = `${Math.min(edCheck[i].ri, edCheck[j].ri)}|${Math.max(edCheck[i].ri, edCheck[j].ri)}`;
        if (checked.has(pk)) continue;
        const ovD = segOverlap(edCheck[i].p1, edCheck[i].p2, edCheck[j].p1, edCheck[j].p2);
        if (!ovD) continue;
        checked.add(pk);
        if (routePairHasOverlap(ecCheck, edCheck[i].ri, edCheck[j].ri)) continue;
        overlapIssues.push(
          `新增路線重疊：路線「${edCheck[i].run.routeName}」與「${edCheck[j].run.routeName}」在 ${pFmt(ovD)} 附近共線重合，正規化前未重疊。`
        );
      }
    }
  }

  // ── 檢查 3：轉彎方向翻轉（點跑到鄰邊另一側） ──────────────────────────
  const bendIssues = /** @type {string[]} */ ([]);

  if (structMatch) {
    for (let ri = 0; ri < C.length && bendIssues.length < MAX; ri++) {
      const rc = C[ri];
      const rd = D[ri];
      for (let pi = 1; pi + 1 < rc.pts.length && bendIssues.length < MAX; pi++) {
        const sc = bendSign(rc.pts[pi - 1], rc.pts[pi], rc.pts[pi + 1]);
        const sd = bendSign(rd.pts[pi - 1], rd.pts[pi], rd.pts[pi + 1]);
        if (sc !== 0 && sd !== 0 && sc !== sd) {
          bendIssues.push(
            `${vLabel(rd, pi)} 的轉彎方向翻轉（原${sc > 0 ? '左' : '右'}轉 → 現${sd > 0 ? '左' : '右'}轉），` +
              `此點正規化後可能跑到鄰近路段另一側。`
          );
        }
      }
    }
  }

  // ── 檢查 4：頂點相對「他路線」之左右側翻面（須結構對齊、邊索引一致） ────
  const neighborSideIssues =
    structMatch ? collectNeighborSideFlips(C, D, EC, ED, {}) : /** @type {string[]} */ ([]);

  // ── 彙整結果 ──────────────────────────────────────────────────────────────
  out.reasons.push(...crossIssues, ...overlapIssues, ...bendIssues, ...neighborSideIssues);
  if (out.reasons.length > 0) out.topologyPreserved = false;

  if (out.topologyPreserved) {
    out.summaryZh =
      '未偵測到新增路段相交／共線重合、自身折線轉向翻側，或未偵測到頂點對鄰線側向翻出。';
  } else {
    const ps = [];
    if (crossIssues.length) ps.push(`新增交叉 ${crossIssues.length} 處`);
    if (overlapIssues.length) ps.push(`新增重疊 ${overlapIssues.length} 處`);
    if (bendIssues.length) ps.push(`轉向翻側 ${bendIssues.length} 處`);
    if (neighborSideIssues.length) ps.push(`對鄰線側翻出 ${neighborSideIssues.length} 處`);
    out.summaryZh = ps.length ? ps.join('、') + '。' : '發現問題，請見下方列表。';
  }

  out.statsCaptionZh = `路線 ${C.length}、折線段 ${EC.length}；${structMatch ? '含頂點對「他路線邊」之側向對照（先處理有車站名的頂點）。' : '結構未對齊，僅能比對相交／重合。'}`;

  return out;
}
