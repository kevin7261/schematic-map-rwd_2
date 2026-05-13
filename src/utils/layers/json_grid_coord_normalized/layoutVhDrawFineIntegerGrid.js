/**
 * layout_network_grid_from_vh_draw：依邊緣區間黑點 max 之全域極大值 M，將粗格座標放大為整數細格 (m+1) 倍並四捨五入，
 * 供軸刻度與線頂點檢視（資料層 geojson 仍為粗格，僅檢視變換）。
 * 套用細格後：中段黑點先依 **沿路徑的像素長度（pt／畫面上的弧長）** 按比例定位（與未套用細格時相同），再將該內插格座標 **對齊到整數格線交叉點**（見 `integerLatticeBlackDotAtPixelArcLengthAlongLineString`）。
 */

import {
  mapDrawnExportRowsFromJsonDrawRoot,
  mergeSegmentStationsFromPriorExportRows,
} from '@/utils/mapDrawnRoutesImport.js';
import { LAYER_ID as OSM_2_GEOJSON_2_JSON_LAYER_ID } from '@/utils/layers/osm_2_geojson_2_json/sessionOsmXml.js';
import {
  JSON_GRID_COORD_NORMALIZED_LAYER_ID,
  LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
  LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
  POINT_ORTHOGONAL_LAYER_ID,
} from './layerIds.js';

export function buildVhDrawStationRowsForLayoutMap(dataStore, drawLayer) {
  if (!drawLayer) return [];
  let base = mapDrawnExportRowsFromJsonDrawRoot(drawLayer.jsonData, drawLayer.dataJson);
  if (!Array.isArray(base)) base = [];
  let out = base.length ? JSON.parse(JSON.stringify(base)) : [];
  out = mergeSegmentStationsFromPriorExportRows(out, drawLayer.processedJsonData);
  const chainIds = [
    ...LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
    POINT_ORTHOGONAL_LAYER_ID,
    JSON_GRID_COORD_NORMALIZED_LAYER_ID,
    OSM_2_GEOJSON_2_JSON_LAYER_ID,
  ];
  for (const id of chainIds) {
    if (id === drawLayer.layerId) continue;
    const src = dataStore.findLayerById(id);
    if (!src) continue;
    out = mergeSegmentStationsFromPriorExportRows(
      out,
      mapDrawnExportRowsFromJsonDrawRoot(src.jsonData, src.dataJson)
    );
    out = mergeSegmentStationsFromPriorExportRows(out, src.processedJsonData);
  }
  return out;
}

export function maxLayoutVhDrawBlackDotsOnLegInOpenXSlab(dotRows, t0, t1) {
  const lo = Math.min(Number(t0), Number(t1));
  const hi = Math.max(Number(t0), Number(t1));
  const tol = 1e-9;
  if (!(hi > lo)) return 0;
  const byLeg = new Map();
  for (let i = 0; i < dotRows.length; i++) {
    const d = dotRows[i];
    const gx = Number(d.gx);
    if (!(gx > lo + tol && gx < hi - tol)) continue;
    const k = `${d.fi}|${d.si}`;
    byLeg.set(k, (byLeg.get(k) ?? 0) + 1);
  }
  let m = 0;
  for (const cnt of byLeg.values()) {
    if (cnt > m) m = cnt;
  }
  return m;
}

export function maxLayoutVhDrawBlackDotsOnLegInOpenYSlab(dotRows, t0, t1) {
  const lo = Math.min(Number(t0), Number(t1));
  const hi = Math.max(Number(t0), Number(t1));
  const tol = 1e-9;
  if (!(hi > lo)) return 0;
  const byLeg = new Map();
  for (let i = 0; i < dotRows.length; i++) {
    const d = dotRows[i];
    const gy = Number(d.gy);
    if (!(gy > lo + tol && gy < hi - tol)) continue;
    const k = `${d.fi}|${d.si}`;
    byLeg.set(k, (byLeg.get(k) ?? 0) + 1);
  }
  let m = 0;
  for (const cnt of byLeg.values()) {
    if (cnt > m) m = cnt;
  }
  return m;
}

function gcdNonNegative(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y > 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function gridXYAndSegAtGridDistanceAlong(gridPts, targetDist) {
  if (!gridPts || gridPts.length < 2) return null;
  const lens = [];
  let total = 0;
  for (let i = 0; i < gridPts.length - 1; i++) {
    const L = Math.hypot(
      gridPts[i + 1][0] - gridPts[i][0],
      gridPts[i + 1][1] - gridPts[i][1]
    );
    lens.push(L);
    total += L;
  }
  if (!(total > 0) || !Number.isFinite(targetDist) || targetDist <= 0) {
    return { gx: gridPts[0][0], gy: gridPts[0][1], segIndex: 0 };
  }
  const d = Math.min(targetDist, total);
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const L = lens[i];
    if (acc + L >= d) {
      const t = L > 0 ? (d - acc) / L : 0;
      const g0 = gridPts[i];
      const g1 = gridPts[i + 1];
      return {
        gx: g0[0] + t * (g1[0] - g0[0]),
        gy: g0[1] + t * (g1[1] - g0[1]),
        segIndex: i,
      };
    }
    acc += L;
  }
  const last = gridPts[gridPts.length - 1];
  return { gx: last[0], gy: last[1], segIndex: gridPts.length - 2 };
}

/**
 * 沿路徑之 **像素** 歐氏長度累積至 targetDist，回傳該處以格座標線性內插之 (gx,gy) 與所在邊 index（與僅畫線時之弧長比例一致）。
 *
 * @param {[number,number][]} gridPts
 * @param {number} targetDist
 * @param {(gx: number, gy: number) => [number, number]} gridToPx
 */
function gridXYAndSegAtPixelDistanceAlong(gridPts, targetDist, gridToPx) {
  if (!gridPts || gridPts.length < 2 || typeof gridToPx !== 'function') return null;
  const lens = [];
  let total = 0;
  for (let i = 0; i < gridPts.length - 1; i++) {
    const g0 = gridPts[i];
    const g1 = gridPts[i + 1];
    const p0 = gridToPx(g0[0], g0[1]);
    const p1 = gridToPx(g1[0], g1[1]);
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    lens.push(L);
    total += L;
  }
  if (!(total > 0) || !Number.isFinite(targetDist) || targetDist <= 0) {
    return { gx: gridPts[0][0], gy: gridPts[0][1], segIndex: 0 };
  }
  const d = Math.min(targetDist, total);
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    const L = lens[i];
    if (acc + L >= d) {
      const t = L > 0 ? (d - acc) / L : 0;
      const g0 = gridPts[i];
      const g1 = gridPts[i + 1];
      return {
        gx: g0[0] + t * (g1[0] - g0[0]),
        gy: g0[1] + t * (g1[1] - g0[1]),
        segIndex: i,
      };
    }
    acc += L;
  }
  const last = gridPts[gridPts.length - 1];
  return { gx: last[0], gy: last[1], segIndex: gridPts.length - 2 };
}

export function gridXYAtGridDistanceAlongLineString(gridPts, targetDist) {
  const hit = gridXYAndSegAtGridDistanceAlong(gridPts, targetDist);
  if (!hit) return null;
  return [hit.gx, hit.gy];
}

/**
 * 與 {@link gridXYAtGridDistanceAlongLineString} 相同弧長目標，但座標對齊至該邊開區間內之 **整數格線交叉點**
 * （正交由線段約束取整數；對角／斜線取 gcd 格點中弧長最接近者）。
 * 若該邊段內無任何允許之中段格點（例如 gcd=1），回傳 null。
 *
 * @param {[number,number][]} gridPts
 * @param {number} targetDist
 * @param {number} [eps=1e-3]
 * @returns {[number,number]|null}
 */
export function integerLatticeBlackDotAtGridArcLengthAlongOrthoLineString(
  gridPts,
  targetDist,
  eps = 1e-3
) {
  const hit = gridXYAndSegAtGridDistanceAlong(gridPts, targetDist);
  if (!hit) return null;
  const g0 = gridPts[hit.segIndex];
  const g1 = gridPts[hit.segIndex + 1];
  if (!g0 || !g1) return null;
  return snapSegmentInteriorToIntegerLattice(
    g0[0],
    g0[1],
    g1[0],
    g1[1],
    hit.gx,
    hit.gy,
    eps
  );
}

/**
 * 沿路徑 **像素弧長** 定位（與僅視覺按比例之中段相同），再以格線整數對齊至合法網格交叉點。
 *
 * @param {[number,number][]} gridPts
 * @param {number} targetPx
 * @param {(gx: number, gy: number) => [number, number]} gridToPx
 * @param {number} [eps=1e-3]
 */
export function integerLatticeBlackDotAtPixelArcLengthAlongLineString(
  gridPts,
  targetPx,
  gridToPx,
  eps = 1e-3
) {
  const hit = gridXYAndSegAtPixelDistanceAlong(gridPts, targetPx, gridToPx);
  if (!hit) return null;
  const g0 = gridPts[hit.segIndex];
  const g1 = gridPts[hit.segIndex + 1];
  if (!g0 || !g1) return null;
  return snapSegmentInteriorToIntegerLattice(
    g0[0],
    g0[1],
    g1[0],
    g1[1],
    hit.gx,
    hit.gy,
    eps
  );
}

/**
 * 弧長插值點 (rawGx,rawGy) 為參考，回傳同邊開區間內之 **整數格點**，且須為粗／細格細分化後仍可落在線段上的格子（對角為 gcd 內插）。
 *
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} rawGx
 * @param {number} rawGy
 * @param {number} eps
 * @returns {[number,number]|null}
 */
export function snapSegmentInteriorToIntegerLattice(ax, ay, bx, by, rawGx, rawGy, eps = 1e-3) {
  if (![ax, ay, bx, by, rawGx, rawGy].every(Number.isFinite)) return null;
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < eps && Math.abs(dy) < eps) {
    return [Math.round(ax), Math.round(ay)];
  }
  if (Math.abs(dx) < eps && Math.abs(dy) >= eps) {
    const x = Math.round(ax);
    const lo = Math.min(ay, by);
    const hi = Math.max(ay, by);
    const loI = Math.ceil(lo + eps);
    const hiI = Math.floor(hi - eps);
    if (loI > hiI) return null;
    const y = Math.max(loI, Math.min(hiI, Math.round(rawGy)));
    return [x, y];
  }
  if (Math.abs(dy) < eps && Math.abs(dx) >= eps) {
    const y = Math.round(ay);
    const lo = Math.min(ax, bx);
    const hi = Math.max(ax, bx);
    const loI = Math.ceil(lo + eps);
    const hiI = Math.floor(hi - eps);
    if (loI > hiI) return null;
    const x = Math.max(loI, Math.min(hiI, Math.round(rawGx)));
    return [x, y];
  }

  const ax0 = Math.round(ax);
  const ay0 = Math.round(ay);
  const bx0 = Math.round(bx);
  const by0 = Math.round(by);
  const rdx = bx0 - ax0;
  const rdy = by0 - ay0;
  const gstep = gcdNonNegative(rdx, rdy);
  if (!(gstep > 1)) return null;

  const sx = rdx / gstep;
  const sy = rdy / gstep;
  const stepLen = Math.hypot(sx, sy);
  if (!(stepLen > 0)) return null;

  const wx = bx - ax;
  const wy = by - ay;
  const vv = wx * wx + wy * wy;
  const distAlong =
    vv > 1e-24
      ? Math.min(
          1,
          Math.max(
            0,
            ((rawGx - ax) * wx + (rawGy - ay) * wy) / vv
          )
        ) * Math.sqrt(vv)
      : 0;

  let bestK = 1;
  let bestErr = Infinity;
  for (let k = 1; k <= gstep - 1; k++) {
    const err = Math.abs(k * stepLen - distAlong);
    if (err < bestErr) {
      bestErr = err;
      bestK = k;
    }
  }
  return [ax0 + sx * bestK, ay0 + sy * bestK];
}

/**
 * 與網格示意中段黑點同源，但弧長以 **格座標歐氏長度** 計（與縮放無關）。
 */
export function buildLayoutNetworkVhDrawMaxBlackDotsPerOrthoLine(dataStore, routeFeatures) {
  const drawLayer = dataStore.findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
  const exportRowsForSta = buildVhDrawStationRowsForLayoutMap(dataStore, drawLayer);
  const eps = 1e-3;
  const layoutEpXY = (ep) => {
    if (!ep || typeof ep !== 'object') return [NaN, NaN];
    const x = Number(ep.x_grid ?? ep.lon);
    const y = Number(ep.y_grid ?? ep.lat);
    return [x, y];
  };
  const layoutFindRowForLineGrid = (gridPts, rows) => {
    if (!Array.isArray(gridPts) || gridPts.length < 2 || !Array.isArray(rows)) return null;
    const g0 = gridPts[0];
    const g1 = gridPts[gridPts.length - 1];
    for (const row of rows) {
      const seg = row?.segment;
      if (!seg) continue;
      const [ax, ay] = layoutEpXY(seg.start);
      const [bx, by] = layoutEpXY(seg.end);
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      const fw =
        Math.abs(g0[0] - ax) < eps &&
        Math.abs(g0[1] - ay) < eps &&
        Math.abs(g1[0] - bx) < eps &&
        Math.abs(g1[1] - by) < eps;
      const bw =
        Math.abs(g0[0] - bx) < eps &&
        Math.abs(g0[1] - by) < eps &&
        Math.abs(g1[0] - ax) < eps &&
        Math.abs(g1[1] - ay) < eps;
      if (fw || bw) return row;
    }
    return null;
  };
  const layoutMidStationCountFromJsonRow = (row) => {
    const mids = Array.isArray(row?.segment?.stations) ? row.segment.stations : [];
    if (mids.length === 0) return 0;
    let n = 0;
    for (const m of mids) {
      if (!m || typeof m !== 'object') continue;
      if (m.node_type === 'connect') continue;
      n++;
    }
    return n > 0 ? n : mids.length;
  };

  const vertEdgeKeyToCount = new Map();
  const horzEdgeKeyToCount = new Map();
  const bumpEdge = (map, key) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  const dotsForBandMax = [];
  const layoutLineFeatCount = routeFeatures.filter(
    (f) => f?.geometry?.type === 'LineString'
  ).length;
  let layoutLineFeatIdx = 0;

  for (let fi = 0; fi < routeFeatures.length; fi++) {
    const rf = routeFeatures[fi];
    if (!rf?.geometry || rf.geometry.type !== 'LineString') continue;
    const coords = rf.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const gridPts = coords.map((c) => [Number(c[0]), Number(c[1])]);
    let row = layoutFindRowForLineGrid(gridPts, exportRowsForSta);
    if (!row && exportRowsForSta.length > 0 && layoutLineFeatCount === exportRowsForSta.length) {
      row = exportRowsForSta[layoutLineFeatIdx] ?? null;
    }
    layoutLineFeatIdx += 1;
    const nSta = row ? layoutMidStationCountFromJsonRow(row) : 0;
    if (nSta <= 0) continue;

    let totalGrid = 0;
    for (let i = 0; i < gridPts.length - 1; i++) {
      totalGrid += Math.hypot(
        gridPts[i + 1][0] - gridPts[i][0],
        gridPts[i + 1][1] - gridPts[i][1]
      );
    }
    if (!(totalGrid > 0)) continue;

    for (let k = 1; k <= nSta; k++) {
      const target = (k * totalGrid) / (nSta + 1);
      const hit = gridXYAndSegAtGridDistanceAlong(gridPts, target);
      if (!hit) continue;
      dotsForBandMax.push({
        gx: hit.gx,
        gy: hit.gy,
        fi,
        si: hit.segIndex,
      });
      const si = hit.segIndex;
      const g0 = gridPts[si];
      const g1 = gridPts[si + 1];
      if (!g0 || !g1) continue;
      const ax = g0[0];
      const ay = g0[1];
      const bx = g1[0];
      const by = g1[1];
      if (Math.abs(ax - bx) < eps && Math.abs(ay - by) >= eps) {
        const xLine = Math.round(ax);
        bumpEdge(vertEdgeKeyToCount, `${xLine}|${fi}|${si}`);
      } else if (Math.abs(ay - by) < eps && Math.abs(ax - bx) >= eps) {
        const yLine = Math.round(ay);
        bumpEdge(horzEdgeKeyToCount, `${yLine}|${fi}|${si}`);
      }
    }
  }

  const maxVertLineByX = new Map();
  for (const [key, cnt] of vertEdgeKeyToCount) {
    const xLine = Number(String(key).split('|')[0]);
    if (!Number.isFinite(xLine)) continue;
    maxVertLineByX.set(xLine, Math.max(maxVertLineByX.get(xLine) ?? 0, cnt));
  }
  const maxHorzLineByY = new Map();
  for (const [key, cnt] of horzEdgeKeyToCount) {
    const yLine = Number(String(key).split('|')[0]);
    if (!Number.isFinite(yLine)) continue;
    maxHorzLineByY.set(yLine, Math.max(maxHorzLineByY.get(yLine) ?? 0, cnt));
  }
  return { maxVertLineByX, maxHorzLineByY, dotsForBandMax };
}

export function featureCollectionGridBounds(fc) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  };
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    return { xMin, xMax, yMin, yMax };
  }
  for (const f of fc.features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'Point' && Array.isArray(g.coordinates)) {
      add(g.coordinates[0], g.coordinates[1]);
    } else if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      for (const c of g.coordinates) {
        if (Array.isArray(c) && c.length >= 2) add(c[0], c[1]);
      }
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      for (const line of g.coordinates) {
        if (Array.isArray(line)) {
          for (const c of line) {
            if (Array.isArray(c) && c.length >= 2) add(c[0], c[1]);
          }
        }
      }
    }
  }
  return { xMin, xMax, yMin, yMax };
}

/**
 * 取邊緣區間藍字之 **全域** 極大值 M，以及粗格原點 (x0,y0)=floor bbox。
 * @returns {{ m: number, x0: number, y0: number } | null}
 */
export function computeLayoutVhDrawFineGridSpec(dataStore, coarseFc) {
  if (!coarseFc || coarseFc.type !== 'FeatureCollection' || !Array.isArray(coarseFc.features))
    return null;
  const routeFeatures = coarseFc.features.filter((f) => f?.geometry?.type === 'LineString');
  if (!routeFeatures.length) return null;
  const { xMin, xMax, yMin, yMax } = featureCollectionGridBounds(coarseFc);
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax))
    return null;
  const x0 = Math.floor(xMin);
  const x1 = Math.ceil(xMax);
  const y0 = Math.floor(yMin);
  const y1 = Math.ceil(yMax);
  const xTicks = [];
  for (let x = x0; x <= x1; x++) xTicks.push(x);
  const yTicks = [];
  for (let y = y0; y <= y1; y++) yTicks.push(y);

  const { dotsForBandMax } = buildLayoutNetworkVhDrawMaxBlackDotsPerOrthoLine(dataStore, routeFeatures);
  let M = 0;
  for (let i = 0; i < xTicks.length - 1; i++) {
    M = Math.max(
      M,
      maxLayoutVhDrawBlackDotsOnLegInOpenXSlab(dotsForBandMax, xTicks[i], xTicks[i + 1])
    );
  }
  for (let i = 0; i < yTicks.length - 1; i++) {
    M = Math.max(
      M,
      maxLayoutVhDrawBlackDotsOnLegInOpenYSlab(dotsForBandMax, yTicks[i], yTicks[i + 1])
    );
  }
  return { m: M, x0, y0 };
}

function mapPair(coord, spec) {
  const gx = Number(coord[0]);
  const gy = Number(coord[1]);
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return [coord[0], coord[1]];
  const s = spec.m + 1;
  return [Math.round((gx - spec.x0) * s), Math.round((gy - spec.y0) * s)];
}

/**
 * @param {{ type:'FeatureCollection', features: object[] }} fc - 會就地修改 features
 */
export function applyLayoutVhDrawFineGridToFeatureCollection(fc, spec) {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || !spec) return fc;
  if (!Number.isFinite(spec.m) || !Number.isFinite(spec.x0) || !Number.isFinite(spec.y0)) return fc;
  const mapLine = (coords) => {
    if (!Array.isArray(coords)) return coords;
    return coords.map((c) => (Array.isArray(c) && c.length >= 2 ? mapPair(c, spec) : c));
  };
  for (const f of fc.features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === 'Point' && Array.isArray(g.coordinates)) {
      g.coordinates = mapPair(g.coordinates, spec);
    } else if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      g.coordinates = mapLine(g.coordinates);
    } else if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) {
      g.coordinates = g.coordinates.map((line) => mapLine(line));
    }
  }
  return fc;
}
