// taipei_b → taipei_c：複製路段與車站輔助資料；疊加網格改為「版面反覆四等分（2^k×2^k）」至單格紅+黑點最大數為 1，
// 再「疊加正規化網格座標」（刪空列／空行並塌縮）寫入 taipei_c。

import { useDataStore } from '@/stores/dataStore.js';
import { resolveTaipeiTestPipelineStep } from '@/utils/taipeiTestPipeline.js';
import {
  collectStationPlacementPoints,
  getMinSpacingCellSizesFromLayer,
  normalizeSpaceNetworkDataToFlatSegments,
  mapSegmentListToOverlayCellIndices,
  overlayQuadCellIndex1D,
} from '@/utils/gridNormalizationMinDistance.js';
import {
  applyOverlayNormalizedGridCoordinates,
  ensureOverlayGridCoordinatesInteger,
} from '@/utils/dataExecute/execute_d_to_e_test.js';

function deep(v) {
  return v != null ? JSON.parse(JSON.stringify(v)) : null;
}

const BBOX_EPS = 1e-6;
const MAX_SUBDIV_LEVEL = 28; // 2^28 邊長，防無限迴圈

function toNum(v) {
  return Number(v ?? 0);
}

function getC(p) {
  return Array.isArray(p) ? [toNum(p[0]), toNum(p[1])] : [toNum(p?.x), toNum(p?.y)];
}

/** 將 Connect / Station / Section 端點之 x_grid,y_grid（含 tags）平移 */
function translateConnectLikeCoords(obj, dx, dy) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.x_grid != null) obj.x_grid = toNum(obj.x_grid) - dx;
  if (obj.y_grid != null) obj.y_grid = toNum(obj.y_grid) - dy;
  if (obj.tags && typeof obj.tags === 'object') {
    if (obj.tags.x_grid != null) obj.tags.x_grid = toNum(obj.tags.x_grid) - dx;
    if (obj.tags.y_grid != null) obj.tags.y_grid = toNum(obj.tags.y_grid) - dy;
  }
}

/** 路段 points／original_points 與 properties_start/end 平移 */
function translateFlatSegmentsInPlace(segments, dx, dy) {
  if (!Array.isArray(segments)) return;
  for (const seg of segments) {
    if (!seg) continue;
    for (const key of ['points', 'original_points']) {
      const arr = seg[key];
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        if (Array.isArray(p) && p.length >= 2) {
          p[0] = toNum(p[0]) - dx;
          p[1] = toNum(p[1]) - dy;
        }
      }
    }
    for (const pk of ['properties_start', 'properties_end']) {
      translateConnectLikeCoords(seg[pk], dx, dy);
    }
  }
}

/** 整層輔助資料平移（與路段一致，供 remap 仍用 floor(x/cw)） */
function translateLayerAuxiliaryGridOrigin(dst, dx, dy) {
  for (const c of dst.spaceNetworkGridJsonData_ConnectData || []) {
    translateConnectLikeCoords(c, dx, dy);
  }
  for (const s of dst.spaceNetworkGridJsonData_StationData || []) {
    translateConnectLikeCoords(s, dx, dy);
  }
  for (const sec of dst.spaceNetworkGridJsonData_SectionData || []) {
    if (sec?.connect_start) translateConnectLikeCoords(sec.connect_start, dx, dy);
    if (sec?.connect_end) translateConnectLikeCoords(sec.connect_end, dx, dy);
  }
}

/**
 * 由路段端點與 collectStationPlacementPoints 計算包圍盒。
 */
function computeBboxFromFlatAndPlacement(dataFlat, dst) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const add = (x, y) => {
    const vx = toNum(x);
    const vy = toNum(y);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
    xMin = Math.min(xMin, vx);
    xMax = Math.max(xMax, vx);
    yMin = Math.min(yMin, vy);
    yMax = Math.max(yMax, vy);
  };
  for (const seg of dataFlat || []) {
    for (const p of seg.points || []) add(...getC(p));
    for (const p of seg.original_points || []) add(...getC(p));
  }
  const layerForPl = {
    spaceNetworkGridJsonData: dataFlat,
    spaceNetworkGridJsonData_ConnectData: dst.spaceNetworkGridJsonData_ConnectData,
    spaceNetworkGridJsonData_SectionData: dst.spaceNetworkGridJsonData_SectionData,
    spaceNetworkGridJsonData_StationData: dst.spaceNetworkGridJsonData_StationData,
    showStationPlacement: dst.showStationPlacement,
  };
  for (const p of collectStationPlacementPoints(layerForPl)) {
    add(p.x, p.y);
  }
  if (!Number.isFinite(xMin)) return null;
  if (xMax - xMin < BBOX_EPS) {
    xMax = xMin + 1;
  }
  if (yMax - yMin < BBOX_EPS) {
    yMax = yMin + 1;
  }
  return { xMin, xMax, yMin, yMax, width: xMax - xMin, height: yMax - yMin };
}

/**
 * 紅+黑點（與 collectStationPlacementPoints 同源）在四等分網格下，單格最大點數。
 */
/**
 * 刪減後 StationData 中多個 line 站若 x_grid,y_grid 相同（顯示會共點），依 station_id 排序後施加極小位移。
 */
function separateCoincidentLineStationGridCoords(dst) {
  const list = dst.spaceNetworkGridJsonData_StationData;
  if (!Array.isArray(list) || list.length < 2) return;
  const lineLike = list.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    const nt = String(s.node_type ?? s.tags?.node_type ?? '').toLowerCase();
    if (nt === 'connect') return false;
    if ((s.connect_number ?? s.tags?.connect_number) != null) return false;
    const x = s.x_grid ?? s.tags?.x_grid;
    const y = s.y_grid ?? s.tags?.y_grid;
    return x != null && y != null;
  });
  if (lineLike.length < 2) return;
  const gkey = (x, y) =>
    `${Math.round(toNum(x) * 1e6) / 1e6},${Math.round(toNum(y) * 1e6) / 1e6}`;
  const buckets = new Map();
  for (const s of lineLike) {
    const x = toNum(s.x_grid ?? s.tags?.x_grid);
    const y = toNum(s.y_grid ?? s.tags?.y_grid);
    const k = gkey(x, y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => {
      const ida = String(a.station_id ?? a.tags?.station_id ?? a.station_name ?? '');
      const idb = String(b.station_id ?? b.tags?.station_id ?? b.station_name ?? '');
      return ida.localeCompare(idb, 'zh-Hant');
    });
    for (let i = 1; i < arr.length; i++) {
      const s = arr[i];
      const step = i * 1e-5;
      const nx = toNum(s.x_grid ?? s.tags?.x_grid) + step;
      const ny = toNum(s.y_grid ?? s.tags?.y_grid);
      s.x_grid = nx;
      s.y_grid = ny;
      if (!s.tags || typeof s.tags !== 'object') s.tags = {};
      s.tags.x_grid = nx;
      s.tags.y_grid = ny;
    }
  }
}

/**
 * 單格至多 1 點：以「格中心」為準——連續座標換算後 nx＝(x−xMin)/cw，第 ix 格對應 nx∈[ix−0.5, ix+0.5]（round），
 * 不是 floor(x/cw) 的左下角對齊矩形。
 */
function maxRedBlackCountInQuadGrid(placementXY, xMin, yMin, width, height, g) {
  const cw = width / g;
  const ch = height / g;
  const counts = new Map();
  for (const [x, y] of placementXY) {
    const ix = overlayQuadCellIndex1D(toNum(x) - xMin, cw, g);
    const iy = overlayQuadCellIndex1D(toNum(y) - yMin, ch, g);
    const k = `${ix},${iy}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let mx = 0;
  for (const v of counts.values()) {
    if (v > mx) mx = v;
  }
  return mx;
}

// eslint-disable-next-line no-unused-vars
export function execute_b_to_c_test(_jsonData) {
  const dataStore = useDataStore();
  const execId = dataStore.taipeiTestExecuteSourceLayerId || 'taipei_b';
  const step = resolveTaipeiTestPipelineStep(execId);
  if (!step || step.role !== 'b') {
    throw new Error(`execute_b_to_c_test：無效的來源圖層 ${execId}（須為 taipei_b 或 taipei_b2）`);
  }
  const { src: srcId, dst: dstId } = step;
  const src = dataStore.findLayerById(srcId);
  const dst = dataStore.findLayerById(dstId);

  if (!src || !src.spaceNetworkGridJsonData) {
    throw new Error(`找不到 ${srcId} 的資料 (請先執行上一步)`);
  }
  if (!dst) {
    throw new Error(`找不到 ${dstId} 圖層`);
  }

  // 1. 複製 taipei_b → taipei_c（此時仍為直線化／非疊加格座標）
  dst.spaceNetworkGridJsonData = deep(src.spaceNetworkGridJsonData);
  dst.spaceNetworkGridJsonData_SectionData = deep(src.spaceNetworkGridJsonData_SectionData) ?? [];
  dst.spaceNetworkGridJsonData_ConnectData = deep(src.spaceNetworkGridJsonData_ConnectData) ?? [];
  dst.spaceNetworkGridJsonData_StationData = deep(src.spaceNetworkGridJsonData_StationData) ?? [];
  dst.showStationPlacement = !!src.showStationPlacement;
  dst.dashboardData = deep(src.dashboardData) ?? { source: srcId };
  dst.isLoaded = true;

  const dataInput = deep(dst.spaceNetworkGridJsonData);
  const dataFlat = normalizeSpaceNetworkDataToFlatSegments(dataInput);

  if (dataFlat.length) {
    const bbox = computeBboxFromFlatAndPlacement(dataFlat, dst);
    if (!bbox) {
      console.warn('[b→c 疊加網格] 無法計算包圍盒，改用最小白／黑點間距疊加格');
      const { cellW, cellH } = getMinSpacingCellSizesFromLayer(dst);
      mapSegmentListToOverlayCellIndices(dataFlat, cellW, cellH);
      ensureOverlayGridCoordinatesInteger(dataFlat);
      dst.spaceNetworkGridJsonData = dataFlat;
      dst.minSpacingOverlayCell = { cellW, cellH };
    } else {
      const layerForPl = {
        spaceNetworkGridJsonData: dataFlat,
        spaceNetworkGridJsonData_ConnectData: dst.spaceNetworkGridJsonData_ConnectData,
        spaceNetworkGridJsonData_SectionData: dst.spaceNetworkGridJsonData_SectionData,
        spaceNetworkGridJsonData_StationData: dst.spaceNetworkGridJsonData_StationData,
        showStationPlacement: dst.showStationPlacement,
      };
      let placementXY = collectStationPlacementPoints(layerForPl).map((p) => [p.x, p.y]);
      if (placementXY.length === 0) {
        for (const seg of dataFlat) {
          for (const p of seg.points || []) placementXY.push(getC(p));
        }
      }

      let level = 0;
      let g = 1;
      let maxInCell = maxRedBlackCountInQuadGrid(
        placementXY,
        bbox.xMin,
        bbox.yMin,
        bbox.width,
        bbox.height,
        g
      );
      console.log(
        `[b→c 疊加網格] 目前網格 ${g}x${g}（四等分層級 ${level}），單格最大紅+黑點數: ${maxInCell}`
      );

      let prevMax = maxInCell;
      let stuck = 0;
      while (maxInCell > 1 && level < MAX_SUBDIV_LEVEL) {
        level += 1;
        g = 2 ** level;
        maxInCell = maxRedBlackCountInQuadGrid(
          placementXY,
          bbox.xMin,
          bbox.yMin,
          bbox.width,
          bbox.height,
          g
        );
        console.log(
          `[b→c 疊加網格] 目前網格 ${g}x${g}（四等分層級 ${level}），單格最大紅+黑點數: ${maxInCell}`
        );
        if (maxInCell >= prevMax) {
          stuck += 1;
        } else {
          stuck = 0;
        }
        if (stuck >= 2) {
          console.warn(
            `[b→c 疊加網格] 單格最大紅+黑點數未再下降（可能多站共點），停止於 ${g}x${g}，當前最大: ${maxInCell}`
          );
          break;
        }
        prevMax = maxInCell;
      }

      const origCellW = bbox.width / g;
      const origCellH = bbox.height / g;

      translateFlatSegmentsInPlace(dataFlat, bbox.xMin, bbox.yMin);
      translateLayerAuxiliaryGridOrigin(dst, bbox.xMin, bbox.yMin);

      mapSegmentListToOverlayCellIndices(dataFlat, origCellW, origCellH, g);
      ensureOverlayGridCoordinatesInteger(dataFlat);
      dst.spaceNetworkGridJsonData = dataFlat;

      dst.minSpacingOverlayCell = { cellW: origCellW, cellH: origCellH };

      dst.dashboardData = {
        ...(typeof dst.dashboardData === 'object' && dst.dashboardData ? dst.dashboardData : {}),
        overlayQuadSubdivide: {
          level,
          gridN: g,
          maxRedBlackPerCellEnd: maxInCell,
          bboxTranslatedOrigin: true,
          bboxOriginal: {
            xMin: bbox.xMin,
            xMax: bbox.xMax,
            yMin: bbox.yMin,
            yMax: bbox.yMax,
          },
          cellW: origCellW,
          cellH: origCellH,
        },
      };

      console.log(
        `[b→c 疊加網格] 採用 ${g}x${g} 網格，cellW=${origCellW}, cellH=${origCellH}（已平移原點至包圍盒左下角）`
      );
    }
  }

  // 3. 疊加正規化網格座標：刪無點且無橫線之列／無點且無直線之行，再塌縮為稠密 (ix,iy)
  if (dataFlat.length) {
    applyOverlayNormalizedGridCoordinates(dst);
  }

  // 3b. 塌縮完成後，StationData 的 x_grid/y_grid 透過 remapConnectLikePropsFor2_10 的 floor 路徑
  //     只能對齊「端點整數格」，弧長中間位置不在 collapse map 裡 → 座標空間對不上路段 points。
  //     正確做法：以 collectStationPlacementPoints（在已塌縮 segment points 上做弧長插值，座標已是刪減後空間）
  //     回寫 StationData.x_grid/y_grid，讓 JSON 儲存的黑點座標與地圖 segment 完全同源。
  if (dataFlat.length && Array.isArray(dst.spaceNetworkGridJsonData_StationData)) {
    const placements = collectStationPlacementPoints(dst).filter((p) => p.kind === 'station');
    const placementById = new Map();
    const placementByName = new Map();
    for (const p of placements) {
      const sid = String(p.meta?.station_id ?? p.meta?.tags?.station_id ?? '').trim();
      const sname = String(p.name ?? '').trim();
      if (sid) placementById.set(sid, p);
      else if (sname && sname !== '黑點') placementByName.set(sname, p);
    }
    for (const s of dst.spaceNetworkGridJsonData_StationData) {
      if (!s || typeof s !== 'object') continue;
      const nt = String(s.node_type ?? s.tags?.node_type ?? '').toLowerCase();
      if (nt === 'connect') continue;
      if ((s.connect_number ?? s.tags?.connect_number) != null) continue;
      const sid = String(s.station_id ?? s.tags?.station_id ?? '').trim();
      const sname = String(s.station_name ?? s.tags?.station_name ?? '').trim();
      const p = (sid && placementById.get(sid)) || (sname && placementByName.get(sname)) || null;
      if (!p) continue;
      s.x_grid = p.x;
      s.y_grid = p.y;
      if (s.tags && typeof s.tags === 'object') {
        s.tags.x_grid = p.x;
        s.tags.y_grid = p.y;
      }
    }
    console.log(
      `[b→c] 已將 ${placements.length} 個黑點弧長座標回寫至 StationData（刪減後空間，與路段 points 同源）`
    );
  }

  // 3c. 不同站點若被映射到相同 (x_grid,y_grid)（弧長落點完全一致），沿路段微移以區分顯示
  separateCoincidentLineStationGridCoords(dst);

  // 4. 塌縮後示意圖座標以「整格索引」為單位；勿再用「任兩站最小 |Δx|／|Δy|」覆寫 cellW/cellH
  if (dataFlat.length) {
    dst.minSpacingOverlayCell = { cellW: 1, cellH: 1 };
  } else {
    dst.minSpacingOverlayCell = null;
  }

  if (!dst.visible) {
    dst.visible = true;
    dataStore.saveLayerState(dstId, { visible: true });
  }
}
