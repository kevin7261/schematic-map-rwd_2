<script setup>
  /**
   * 📊 SpaceNetworkGridTab.vue - 空間網絡網格數據視覺化分頁組件
   *
   * 功能說明：
   * 1. 📑 圖層分頁導航 - 顯示所有可見圖層的標籤頁
   * 2. 📊 當前圖層資訊 - 顯示選中圖層的名稱和詳細信息
   * 3. 📈 圖層摘要資料 - 顯示總數量、行政區數量等統計信息
   * 4. 🎨 D3.js 圖表 - 使用 D3.js 繪製各種類型的圖表（網格示意圖、行政區示意圖）
   * 5. 🔄 自動切換功能 - 當新圖層開啟時自動切換到該圖層的分頁
   *
   * @component SpaceNetworkGridTab
   * @version 2.0.0
   * @author Kevin Cheng
   */

  import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
  import { useDataStore } from '@/stores/dataStore.js';
  import {
    buildStraightSegments,
    computeFlipAnalysis,
    buildNShapeList,
    computeNShapeAnalysis,
  } from '@/utils/segmentUtils.js';
  import {
    networkCoordToMinSpacingOverlayCell,
    closestPointOnPolyline,
    collectLineStationGridPointsFromStationData,
    collectStationPlacementPoints,
    normalizeSpaceNetworkDataToFlatSegments,
  } from '@/utils/gridNormalizationMinDistance.js';
  import { createReducedSchematicPlotMapper } from '@/utils/schematicPlotMapper.js';
  import {
    overlayCoordsBeforeRemovalFromReduced,
    overlayReducedTooltipPair,
    remapOverlayCellAfterRemoval,
  } from '@/utils/dataExecute/execute_d_to_e_test.js';
  import {
    bresenhamGridCells,
    resolveTaipeiFStationNameAndId,
    buildConnectNumberToNameIdMap,
    buildConnectGridKeyToNameIdMap,
    buildSectionRouteGridNameIdMap,
    buildSectionGridKeyToNameIdMap,
    buildBlackStationDisplayByGrid,
    applyTaipeiFMergePruneRebuildToLayer,
  } from '@/utils/randomConnectSegmentWeights.js';
  import { buildListedSectionRouteGridCellKeySet } from '@/utils/taipeiFColRouteHighlightPlan.js';
  import * as layerStationsTowardSchematicCenter from '@/utils/layerStationsTowardSchematicCenter.js';
  import { isTaipeiTestStraighteningLayerId } from '@/utils/taipeiTestStraighteningLayerIds.js';
  import {
    TAIPEI_TEST_SPACE_NETWORK_STATION_TAB_IDS,
    isTaipeiTestCDLayerTab,
    isTaipeiTestCDELayerTab,
    isTaipeiTestCLayerTab,
    isTaipeiTestDLayerTab,
    isTaipeiTestELayerTab,
    isTaipeiTestFghiSpaceLayerTab as isTaipeiEfinalSpaceLayerTab,
    isTaipeiTestGOrHWeightLayerTab as isTaipeiGOrHWeightLayer,
    isTaipeiTestFLayerTab,
    isTaipeiTestILayerTab,
    isTaipeiTest3BcdeLayerTab,
    isTaipeiTest3I3OrJ3LayerTab,
  } from '@/utils/taipeiTestPipeline.js';
  import { refreshTaipeiL3BlackDotHighlightFromLayer } from '@/utils/taipeiL3BlackDotReductionStep.js';
  import {
    isMapDrawnRoutesExportArray,
    mapDrawnExportRowsFromJsonDrawRoot,
    mergeSegmentStationsFromPriorExportRows,
    enrichExportRowStationsFromPool,
    expandLonLatChainFromRouteCoordinates,
  } from '@/utils/mapDrawnRoutesImport.js';
  import {
    getGeoJsonFeatureTagProps,
    normalizeRouteSegmentEndpointType,
    segmentNodeLon,
    segmentNodeLat,
  } from '@/utils/geojsonRouteHelpers.js';

  import * as d3 from 'd3';
  import {
    buildRouteWeightStrokeScaleLinear,
    collectWeightsFromGeoRouteFeatures,
    formatStrokeWidthPx,
    strokeWidthPxFromWeightScale,
  } from '@/utils/routeWeightStrokeScale.js';
  import {
    niceTickStepMultipleOf5,
    buildTicksInRange,
    snapCoarseGridStepToMultipleOf5,
    formatAxisTickLabelMaxTwoDecimals,
  } from '@/utils/gridAxisTicks.js';
  import {
    isSpaceLayoutUniformGridViewerLayerId,
    LAYER_ID as OSM_2_GEOJSON_2_JSON_LAYER_ID,
    getOsm2GeojsonSessionOsmXml,
  } from '@/utils/layers/osm_2_geojson_2_json/sessionOsmXml.js';
  import {
    JSON_GRID_COORD_NORMALIZED_LAYER_ID,
    POINT_ORTHOGONAL_LAYER_ID,
    COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID,
    LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
    LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID,
    isLineOrthogonalTowardCenterLayerId,
    isLayoutNetworkGridFromVhDrawLayerId,
    isSpaceGridVhDrawFamilyLayerId,
  } from '@/utils/layers/json_grid_coord_normalized/index.js';
  import { resolveB3InputSpaceNetwork } from '@/utils/layers/json_grid_coord_normalized/jsonGridCoordNormalizeHelpers.js';
  import { osmXmlStringToGeojsonData } from '@/utils/layers/osm_2_geojson_2_json/pipeline.js';
  import { uniformGridCellFromLayoutMeta } from '@/utils/stationUniformGridGeoJson.js';

  /**
   * 均勻網格族路線 hover：本層 dataJson 若曾由路網重算，segment.stations 可能被清空；
   * 先合併本層 processedJsonData，再自系譜父層（point_orthogonal／座標正規化／OSM 管線）補回同起迄之中段站。
   */
  function buildEnrichedMapDrawnRowsForUniformGridTooltip(dataStore, layerTab, activeLayer) {
    if (!isSpaceLayoutUniformGridViewerLayerId(layerTab) || !activeLayer) return null;
    const base = mapDrawnExportRowsFromJsonDrawRoot(activeLayer.jsonData, activeLayer.dataJson);
    if (!Array.isArray(base) || base.length === 0) return null;
    let out = JSON.parse(JSON.stringify(base));
    out = mergeSegmentStationsFromPriorExportRows(out, activeLayer.processedJsonData);

    const chainIds = [
      ...LINE_ORTHOGONAL_TOWARD_CENTER_LAYER_IDS,
      POINT_ORTHOGONAL_LAYER_ID,
      JSON_GRID_COORD_NORMALIZED_LAYER_ID,
      OSM_2_GEOJSON_2_JSON_LAYER_ID,
    ];
    for (const id of chainIds) {
      if (id === layerTab) continue;
      const src = dataStore.findLayerById(id);
      if (!src) continue;
      out = mergeSegmentStationsFromPriorExportRows(
        out,
        mapDrawnExportRowsFromJsonDrawRoot(src.jsonData, src.dataJson),
      );
      out = mergeSegmentStationsFromPriorExportRows(out, src.processedJsonData);
    }
    return out;
  }

  /**
   * 版面網格檢視：中段車站數來自 MapDrawn 匯出列 `segment.stations`（與 JSON 一致），
   * 並自系譜各層合併 stations（不強制已有本層 base 才建）。
   */
  function buildVhDrawStationRowsForLayoutMap(dataStore, drawLayer) {
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
        mapDrawnExportRowsFromJsonDrawRoot(src.jsonData, src.dataJson),
      );
      out = mergeSegmentStationsFromPriorExportRows(out, src.processedJsonData);
    }
    return out;
  }

  /**
   * 兩條縱軸刻度 x=t0、t1 所對應之垂直格線為邊界，取開帶 min(t0,t1) < x < max(t0,t1)：
   * 同一折線段子邊 `{fi,si}` 上，黑點之 gx 落入該帶區者數之極大值（與圖上中段黑點插補同源）。
   */
  function maxLayoutVhDrawBlackDotsOnLegInOpenXSlab(dotRows, t0, t1) {
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

  /**
   * 兩水平刻度線 y=t0、t1 所夾開帶區 `min<y<max`：同上，以 gy 判定。
   */
  function maxLayoutVhDrawBlackDotsOnLegInOpenYSlab(dotRows, t0, t1) {
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

  /**
   * `layout_network_grid_from_vh_draw`：與圖上中段黑點同源（弧長均分），
   * 紀錄每顆插補點 `{ gx, gy, fi, si }`；並保留整數線上「單一正交邊段」集中度供除錯或它用。
   */
  function buildLayoutNetworkVhDrawMaxBlackDotsPerOrthoLine(dataStore, routeFeatures, xScale, yScale) {
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
    const distPxSeg = (pa, pb) => {
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      return Math.hypot(dx, dy);
    };
    const gridXYAndSegAtPixelDistanceAlong = (gridPts, targetPx) => {
      if (!gridPts || gridPts.length < 2) return null;
      const pix = gridPts.map(([gx, gy]) => [xScale(gx), yScale(gy)]);
      const lens = [];
      let total = 0;
      for (let i = 0; i < pix.length - 1; i++) {
        const L = distPxSeg(pix[i], pix[i + 1]);
        lens.push(L);
        total += L;
      }
      if (!(total > 0) || !Number.isFinite(targetPx) || targetPx <= 0) {
        return { gx: gridPts[0][0], gy: gridPts[0][1], segIndex: 0 };
      }
      const d = Math.min(targetPx, total);
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
    };

    const vertEdgeKeyToCount = new Map();
    const horzEdgeKeyToCount = new Map();
    const bumpEdge = (map, key) => {
      map.set(key, (map.get(key) ?? 0) + 1);
    };

    const dotsForBandMax = [];
    const layoutLineFeatCount = routeFeatures.filter(
      (f) => f?.geometry?.type === 'LineString',
    ).length;
    let layoutLineFeatIdx = 0;

    for (let fi = 0; fi < routeFeatures.length; fi++) {
      const rf = routeFeatures[fi];
      if (!rf?.geometry || rf.geometry.type !== 'LineString') continue;
      const coords = rf.geometry.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const gridPts = coords.map((c) => [Number(c[0]), Number(c[1])]);
      let row = layoutFindRowForLineGrid(gridPts, exportRowsForSta);
      if (
        !row &&
        exportRowsForSta.length > 0 &&
        layoutLineFeatCount === exportRowsForSta.length
      ) {
        row = exportRowsForSta[layoutLineFeatIdx] ?? null;
      }
      layoutLineFeatIdx += 1;
      const nSta = row ? layoutMidStationCountFromJsonRow(row) : 0;
      if (nSta <= 0) continue;

      const pix = gridPts.map(([gx, gy]) => [xScale(gx), yScale(gy)]);
      let totalPx = 0;
      for (let i = 0; i < pix.length - 1; i++) totalPx += distPxSeg(pix[i], pix[i + 1]);
      if (!(totalPx > 0)) continue;

      for (let k = 1; k <= nSta; k++) {
        const target = (k * totalPx) / (nSta + 1);
        const hit = gridXYAndSegAtPixelDistanceAlong(gridPts, target);
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

  /** 與 MapTab 路段／站點 popup 同源（OSM／GeoJSON → JSON 檢視） */
  const escapeLayoutTooltipHtml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const routeRowStationsOrderedTooltipSection = (row) => {
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') return '';
    const ordered = [];
    if (seg.start) ordered.push(seg.start);
    if (Array.isArray(seg.stations)) {
      for (const st of seg.stations) ordered.push(st);
    }
    if (seg.end) ordered.push(seg.end);
    if (!ordered.length) return '';
    let html = `<strong>stations（依序）</strong> ${ordered.length}<br>`;
    ordered.forEach((node, idx) => {
      const sid = escapeLayoutTooltipHtml(node.station_id ?? node.tags?.station_id ?? '');
      const snm = escapeLayoutTooltipHtml(
        node.station_name ?? node.tags?.station_name ?? node.tags?.name ?? ''
      );
      html += `<strong>#${idx + 1}</strong> station_id ${sid} · station_name ${snm}<br>`;
    });
    return html;
  };

  const routeIdPrefixFromStationId = (stationId) => {
    const m = String(stationId ?? '')
      .trim()
      .match(/^[A-Za-z]+/);
    return m ? m[0] : '';
  };

  const routeIdForTooltipRow = (row) => {
    const explicit = String(row?.route_id ?? row?.tags?.route_id ?? '').trim();
    if (explicit) return explicit;
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') return '';
    const counts = new Map();
    const bump = (node) => {
      const prefix = routeIdPrefixFromStationId(node?.station_id ?? node?.tags?.station_id);
      if (!prefix) return;
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    };
    bump(seg.start);
    for (const st of Array.isArray(seg.stations) ? seg.stations : []) bump(st);
    bump(seg.end);
    let best = '';
    let bestCount = 0;
    for (const [prefix, count] of counts.entries()) {
      if (count > bestCount) {
        best = prefix;
        bestCount = count;
      }
    }
    return best;
  };

  const routeExportRowPolylineTooltipHtml = (row, chain) => {
    if (!row || typeof row !== 'object') return '';
    if (!chain || chain.length < 1) return '';
    const [flon, flat] = chain[0];
    const head = `<strong>routeName</strong> ${escapeLayoutTooltipHtml(row.routeName)}<br>
<strong>route_id</strong> ${escapeLayoutTooltipHtml(routeIdForTooltipRow(row))}<br>
<strong>color</strong> ${escapeLayoutTooltipHtml(row.color)}<br>
<strong>lon</strong> ${escapeLayoutTooltipHtml(flon)}<br>
<strong>lat</strong> ${escapeLayoutTooltipHtml(flat)}`;
    const stations = routeRowStationsOrderedTooltipSection(row);
    return stations ? `${head}<br>${stations}` : head;
  };

  const stationEndpointTooltipHtmlFromProps = (propBag, endpointType, lonVal, latVal) => {
    const p = propBag && typeof propBag === 'object' ? propBag : {};
    const tags = p.tags && typeof p.tags === 'object' ? p.tags : {};
    const sid = escapeLayoutTooltipHtml(p.station_id ?? tags.station_id ?? '');
    const snm = escapeLayoutTooltipHtml(p.station_name ?? tags.station_name ?? tags.name ?? '');
    const rnl = p.route_name_list ?? tags.route_name_list;
    const rnlStr = Array.isArray(rnl)
      ? escapeLayoutTooltipHtml(JSON.stringify(rnl))
      : escapeLayoutTooltipHtml(String(rnl ?? '[]'));
    const cn = p.connect_number ?? tags.connect_number ?? '';
    return `<strong>station_id</strong> ${sid}<br>
<strong>station_name</strong> ${snm}<br>
<strong>route_name_list</strong> ${rnlStr}<br>
<strong>type</strong> <code style="color:#c2185b">${escapeLayoutTooltipHtml(endpointType)}</code><br>
<strong>connect_number</strong> ${escapeLayoutTooltipHtml(cn)}<br>
<strong>lon</strong> ${escapeLayoutTooltipHtml(lonVal)}<br>
<strong>lat</strong> ${escapeLayoutTooltipHtml(latVal)}`;
  };

  /**
   * @param {*} meta — layoutUniformGridMeta（wgs84／compressed）
   */
  function buildLayoutViewerUniformAxisTicks(meta, approxPerAxis = 12) {
    if (!meta || typeof meta !== 'object') return null;
    const nApprox = Math.max(4, Math.floor(Number(approxPerAxis)) || 12);

    if (meta.mode === 'wgs84' && meta.bounds && Number.isFinite(meta.divisionsPerAxis)) {
      const b = meta.bounds;
      const div = Math.max(1, Math.floor(Number(meta.divisionsPerAxis)));
      const stride = Math.max(1, Math.ceil(div / nApprox));
      const lonSpan = b.maxLon - b.minLon;
      const latSpan = b.maxLat - b.minLat;
      const xTicks = [];
      for (let i = 0; i <= div; i += stride) {
        xTicks.push(div > 0 && lonSpan !== 0 ? b.minLon + (lonSpan * i) / div : b.minLon + i);
      }
      const lastX = div > 0 && lonSpan !== 0 ? b.maxLon : b.minLon + div;
      if (
        xTicks.length === 0 ||
        Math.abs(xTicks[xTicks.length - 1] - lastX) > 1e-9 * Math.max(1, Math.abs(lastX))
      ) {
        xTicks.push(lastX);
      }
      const yTicks = [];
      for (let j = 0; j <= div; j += stride) {
        yTicks.push(div > 0 && latSpan !== 0 ? b.minLat + (latSpan * j) / div : b.minLat + j);
      }
      const lastY = div > 0 && latSpan !== 0 ? b.maxLat : b.minLat + div;
      if (
        yTicks.length === 0 ||
        Math.abs(yTicks[yTicks.length - 1] - lastY) > 1e-9 * Math.max(1, Math.abs(lastY))
      ) {
        yTicks.push(lastY);
      }
      return {
        xTicks,
        yTicks,
        xLabelsAsFloat: true,
        yLabelsAsFloat: true,
        skipDefaultBackgroundGrid: true,
      };
    }

    if (meta.mode === 'compressed' && Number.isFinite(meta.nx) && Number.isFinite(meta.ny)) {
      const nx = Math.max(0, Math.floor(Number(meta.nx)));
      const ny = Math.max(0, Math.floor(Number(meta.ny)));
      const sx = Math.max(1, Math.ceil((nx + 1) / nApprox));
      const sy = Math.max(1, Math.ceil((ny + 1) / nApprox));
      const xTicks = [];
      for (let i = 0; i <= nx; i += sx) xTicks.push(i);
      if (xTicks.length === 0 || xTicks[xTicks.length - 1] !== nx) xTicks.push(nx);
      const yTicks = [];
      for (let j = 0; j <= ny; j += sy) yTicks.push(j);
      if (yTicks.length === 0 || yTicks[yTicks.length - 1] !== ny) yTicks.push(ny);
      return {
        xTicks,
        yTicks,
        xLabelsAsFloat: false,
        yLabelsAsFloat: false,
        skipDefaultBackgroundGrid: true,
      };
    }

    return null;
  }

  /** 與 MapTab circleStyleForJsonEndpointType 非 hover 狀之色塊對應（D3 無 pane／半徑略同 Leaflet px） */
  function mapTabApproxBaseSvgForEndpoint(normType) {
    const t = normalizeRouteSegmentEndpointType(normType);
    if (t === 'terminal') {
      return { fill: '#9ec5fe', stroke: '#0d6efd', r: 4, strokeW: 2 };
    }
    if (t === 'intersection') {
      return { fill: '#f1aeb5', stroke: '#dc3545', r: 4, strokeW: 2 };
    }
    return { fill: '#1a1a1a', stroke: '#000000', r: 3, strokeW: 1 };
  }

  /** 與 MapTab circleStyleForJsonEndpointType hover 對應 */
  function mapTabApproxHoverSvgForEndpoint(normType) {
    const t = normalizeRouteSegmentEndpointType(normType);
    if (t === 'terminal') {
      return { fill: '#6ea8fe', stroke: '#052c65', r: 7, strokeW: 3 };
    }
    if (t === 'intersection') {
      return { fill: '#f5c2c7', stroke: '#58151c', r: 7, strokeW: 3 };
    }
    return { fill: '#555555', stroke: '#000000', r: 6, strokeW: 2 };
  }

  const emit = defineEmits(['active-layer-change']);

  /** taipei_f／taipei_g：與邊緣欄／列最大權重標籤同源，供權重比例格寬／列高用 */
  function accumulateTaipeiFColRowWeightMaxFromFeatures(routeFeatures) {
    const colWeightMax = new Map();
    const rowWeightMax = new Map();
    const consumeGeom = (geomCoords, props) => {
      const sw = props?.station_weights;
      if (!Array.isArray(sw) || sw.length === 0) return;
      const refPoints = props.original_points || props.points || geomCoords;
      if (!Array.isArray(refPoints) || refPoints.length < 2) return;
      const refCoords = refPoints
        .map((pt) => {
          if (Array.isArray(pt)) {
            return pt.length >= 2 ? [pt[0], pt[1]] : null;
          }
          return pt && pt.x !== undefined && pt.y !== undefined ? [pt.x, pt.y] : null;
        })
        .filter((pt) => pt !== null);
      if (refCoords.length < 2) return;
      for (const weightInfo of sw) {
        const { start_idx, end_idx, weight } = weightInfo;
        const wn = Number(weight);
        if (
          !Number.isFinite(wn) ||
          typeof start_idx !== 'number' ||
          typeof end_idx !== 'number' ||
          start_idx < 0 ||
          end_idx < 0 ||
          start_idx >= refCoords.length ||
          end_idx >= refCoords.length ||
          start_idx >= end_idx
        ) {
          continue;
        }
        for (let i = start_idx; i < end_idx; i++) {
          const ax = Math.round(Number(refCoords[i][0]));
          const ay = Math.round(Number(refCoords[i][1]));
          const bx = Math.round(Number(refCoords[i + 1][0]));
          const by = Math.round(Number(refCoords[i + 1][1]));
          const verts = bresenhamGridCells(ax, ay, bx, by);
          for (let j = 0; j < verts.length - 1; j++) {
            const [x0, y0] = verts[j];
            const [x1, y1] = verts[j + 1];
            if (y0 === y1) {
              const ix = Math.min(x0, x1);
              colWeightMax.set(ix, Math.max(colWeightMax.get(ix) ?? -Infinity, wn));
            } else if (x0 === x1) {
              const iy = Math.min(y0, y1);
              rowWeightMax.set(iy, Math.max(rowWeightMax.get(iy) ?? -Infinity, wn));
            }
          }
        }
      }
    };
    for (const feature of routeFeatures || []) {
      if (!feature?.geometry) continue;
      const props = feature.properties || {};
      const geom = feature.geometry;
      if (geom.type === 'LineString') consumeGeom(geom.coordinates, props);
      else if (geom.type === 'MultiLineString') {
        for (const coords of geom.coordinates || []) consumeGeom(coords, props);
      }
    }
    return { colWeightMax, rowWeightMax };
  }

  /**
   * 欄寬 ∝ 該欄最大權重（預設平方；squareWeights=false 時為線性）
   * 全為 0 則均分
   */
  function createTaipeiFWeightedXScale(
    xMin,
    xMax,
    marginLeft,
    plotW,
    colWeightMax,
    squareWeights = true
  ) {
    const n = Math.max(0, Math.round(xMax - xMin));
    if (n <= 0) {
      const s = d3
        .scaleLinear()
        .domain([xMin, xMax])
        .range([marginLeft, marginLeft + plotW]);
      return { scale: s, minCellWFrac: 1 };
    }
    const contribs = [];
    for (let j = 0; j < n; j++) {
      const ix = xMin + j;
      const w = colWeightMax.get(ix);
      if (Number.isFinite(w) && w > 0) {
        contribs.push(squareWeights ? w * w : w);
      } else {
        contribs.push(0);
      }
    }
    const sum = contribs.reduce((a, b) => a + b, 0);
    const widthsPx = sum <= 0 ? Array(n).fill(plotW / n) : contribs.map((c) => (c / sum) * plotW);
    const minCellWFrac = Math.min(...widthsPx) / plotW;
    const xBorderPx = [marginLeft];
    for (let j = 0; j < n; j++) xBorderPx.push(xBorderPx[j] + widthsPx[j]);
    const scale = (x) => {
      const xf = Number(x);
      if (!Number.isFinite(xf)) return marginLeft;
      if (xf <= xMin) return xBorderPx[0];
      if (xf >= xMax) return xBorderPx[n];
      const j = Math.min(Math.max(0, Math.floor(xf - xMin)), n - 1);
      const t = xf - (xMin + j);
      return xBorderPx[j] + t * widthsPx[j];
    };
    scale.invert = (px) => {
      const p = Number(px);
      if (p <= xBorderPx[0]) return xMin;
      if (p >= xBorderPx[n]) return xMax;
      let j = 0;
      while (j < n && p > xBorderPx[j + 1]) j++;
      j = Math.min(j, n - 1);
      const denom = widthsPx[j] > 1e-12 ? widthsPx[j] : 1;
      return xMin + j + (p - xBorderPx[j]) / denom;
    };
    return { scale, minCellWFrac };
  }

  /**
   * 列高 ∝ 該列最大權重（預設平方；squareWeights=false 時為線性）
   * 全為 0 則均分；data y 大者在畫面上方
   */
  function createTaipeiFWeightedYScale(
    yMin,
    yMax,
    marginTop,
    plotH,
    rowWeightMax,
    squareWeights = true
  ) {
    const n = Math.max(0, Math.round(yMax - yMin));
    if (n <= 0) {
      const s = d3
        .scaleLinear()
        .domain([yMax, yMin])
        .range([marginTop, marginTop + plotH]);
      return { scale: s, minCellHFrac: 1 };
    }
    const contribs = [];
    for (let j = 0; j < n; j++) {
      const iy = yMin + j;
      const w = rowWeightMax.get(iy);
      if (Number.isFinite(w) && w > 0) {
        contribs.push(squareWeights ? w * w : w);
      } else {
        contribs.push(0);
      }
    }
    const sum = contribs.reduce((a, b) => a + b, 0);
    const heightsPx = sum <= 0 ? Array(n).fill(plotH / n) : contribs.map((c) => (c / sum) * plotH);
    const minCellHFrac = Math.min(...heightsPx) / plotH;
    const yLinePx = new Array(n + 1);
    yLinePx[n] = marginTop;
    for (let k = n - 1; k >= 0; k--) {
      yLinePx[k] = yLinePx[k + 1] + heightsPx[k];
    }
    const scale = (y) => {
      const yf = Number(y);
      if (!Number.isFinite(yf)) return marginTop + plotH / 2;
      if (yf <= yMin) return yLinePx[0];
      if (yf >= yMax) return yLinePx[n];
      const j = Math.min(Math.max(0, Math.floor(yf - yMin)), n - 1);
      const t = yf - (yMin + j);
      return yLinePx[j] + t * (yLinePx[j + 1] - yLinePx[j]);
    };
    scale.invert = (py) => {
      const p = Number(py);
      if (p <= marginTop) return yMax;
      if (p >= marginTop + plotH) return yMin;
      for (let k = 0; k < n; k++) {
        const yLo = yLinePx[k];
        const yHi = yLinePx[k + 1];
        const span = yHi - yLo;
        if (span === 0) continue;
        const lo = Math.min(yLo, yHi);
        const hi = Math.max(yLo, yHi);
        if (p >= lo && p <= hi) {
          return yMin + k + (p - yLo) / span;
        }
      }
      return (yMin + yMax) / 2;
    };
    return { scale, minCellHFrac };
  }

  // Props
  const props = defineProps({
    containerHeight: {
      type: Number,
      default: 600,
    },
    isPanelDragging: {
      type: Boolean,
      default: false,
    },
    activeMarkers: {
      type: Array,
      default: () => [],
    },
    /** 對應 UpperView 之 space-network-grid 分頁是否顯示（供手繪轉網格後切層） */
    isActive: {
      type: Boolean,
      default: true,
    },
    /** 若為函數，只顯示 visible 且 filter(layer)===true 的圖層（例如 space-layout-grid-viewer 專用分頁） */
    layerFilter: {
      type: Function,
      default: null,
    },
    /** 區分同台掛載多個元件時之 SVG 容器 id（預設與先前相同；勿含空格） */
    containerIdSuffix: {
      type: String,
      default: '',
    },
  });

  const dataStore = useDataStore();

  const activeLayerTab = ref(null); /** 📑 當前作用中的圖層分頁 */

  /** 與作用中圖層分頁一致（供 drawMap 內 layerTab 別名） */
  const spaceGridDataLayerTabId = computed(() => activeLayerTab.value);

  /**
   * 🆔 獲取動態容器 ID (Get Dynamic Container ID)
   * 基於當前活動圖層生成唯一的容器 ID，避免多圖層衝突；
   * 若 UpperView 同台掛兩個本元件（如 space-network-grid 與 space-layout-grid-viewer），須設定 containerIdSuffix 避免 getElementById 命中錯誤面板。
   */
  const getContainerId = () => {
    const layerId = activeLayerTab.value || 'default';
    const raw = typeof props.containerIdSuffix === 'string' ? props.containerIdSuffix.trim() : '';
    const safe = /^[a-zA-Z0-9_-]+$/.test(raw) ? raw : '';
    const suf = safe ? `-${safe}` : '';
    return `schematic-container-space-network-grid-${layerId}${suf}`;
  };

  // ==================== 📊 示意圖繪製相關狀態 (Schematic Drawing State) ====================

  /** 📊 網格數據狀態 (Grid Data State) */
  const gridData = ref(null);
  const gridDimensions = ref({ x: 10, y: 10 });

  /** 📊 行政區數據狀態 (Administrative District Data State) */
  const nodeData = ref(null);
  const linkData = ref(null);

  /** 📊 地圖數據狀態 (Map Data State) */
  const mapGeoJsonData = ref(null);

  /** taipei_g：resize 觸發自動合併時避免重入 */
  const taipeiFResizeAutoMergeRunning = ref(false);

  // ==================== 🎨 視覺化常數 (Visualization Constants) ====================

  /** 🎨 顏色配置 (Color Configuration) */
  const COLOR_CONFIG = {
    BACKGROUND: '#FFFFFF',
    GRID_LINE: '#666666',
    GRID_LINE_SECONDARY: '#333333',
    NODE_FILL: '#4CAF50',
    NODE_STROKE: '#2E7D32',
    TEXT_FILL: '#000000',
  };

  /** 🎨 顏色映射 (Color Mapping) */
  const colorMap = {
    red: '#ff0000',
    lightpink: '#ffb3ba',
    blue: '#0066cc',
    green: '#00aa44',
    lightgreen: '#90ee90',
    orange: '#ff8800',
    brown: '#8b4513',
    yellow: '#ffcc00',
    purple: '#800080',
    paleturquoise: '#afeeee',
    limegreen: '#32cd32',
  };

  // ResizeObserver 實例
  let resizeObserver = null;

  // 獲取所有開啟的圖層（可選僅列出 layerFilter 通過者）
  const visibleLayers = computed(() => {
    const allLayers = dataStore.getAllLayers().filter((layer) => layer.visible);
    const fn = props.layerFilter;
    if (typeof fn === 'function') {
      return allLayers.filter((layer) => {
        try {
          return Boolean(fn(layer));
        } catch (e) {
          void e;
          return false;
        }
      });
    }
    return allLayers;
  });

  /**
   * 📑 設定作用中圖層分頁 (Set Active Layer Tab)
   * @param {string} layerId - 圖層 ID
   */
  const setActiveLayerTab = (layerId) => {
    // 如果切換到相同圖層，不需要重新處理
    if (activeLayerTab.value === layerId) {
      return;
    }

    // 立即清除 SVG 內容和 tooltip，避免重疊
    const oldContainerId = getContainerId();
    d3.select(`#${oldContainerId}`).selectAll('svg').remove();
    d3.select('body').selectAll('.d3js-map-tooltip').remove();

    // 清除數據狀態
    gridData.value = null;
    nodeData.value = null;
    linkData.value = null;
    mapGeoJsonData.value = null;

    // 設置新的活動圖層
    activeLayerTab.value = layerId;

    dataStore.touchLastSpaceNetworkGridSketchTargetLayerId(layerId);

    // 通知父層目前 UpperView 的作用圖層
    emit('active-layer-change', activeLayerTab.value);
  };

  /**
   * 📊 當前圖層摘要 (Current Layer Summary)
   * 檢查圖層是否有任何可用的數據（dashboardData、spaceNetworkGridJsonData 等）
   */
  const currentLayerSummary = computed(() => {
    if (!activeLayerTab.value) {
      return null;
    }

    const layer = dataStore.findLayerById(activeLayerTab.value);
    if (!layer) return null;

    // 檢查是否有任何可用的數據（SpaceNetworkGridTab 只看 spaceNetworkGridJsonData）
    const hasData =
      (layer.dashboardData !== null && layer.dashboardData !== undefined) ||
      (layer.spaceNetworkGridJsonData !== null && layer.spaceNetworkGridJsonData !== undefined) ||
      (layer.dataTableData !== null && layer.dataTableData !== undefined);

    /** 資料處理 b3_dp→m3_dp 等：尚未執行「上一步」時尚無路網，仍應掛載繪圖容器以便有資料後重繪 */
    const hasSpaceNetworkGridTab =
      Array.isArray(layer.upperViewTabs) && layer.upperViewTabs.includes('space-network-grid');
    const hasSpaceLayoutGridViewerTab =
      Array.isArray(layer.upperViewTabs) &&
      layer.upperViewTabs.includes('space-layout-grid-viewer');

    // 如果有數據，返回 dashboardData（如果存在）或一個標記物件
    return hasData || hasSpaceNetworkGridTab || hasSpaceLayoutGridViewerTab
      ? layer.dashboardData || { hasData: true }
      : null;
  });

  /**
   * 📊 檢查當前圖層是否有 layerInfoData
   */
  const hasLayerInfoData = computed(() => {
    if (!activeLayerTab.value) {
      return false;
    }

    const layer = dataStore.findLayerById(activeLayerTab.value);

    return layer && layer.layerInfoData !== null && layer.layerInfoData !== undefined;
  });

  /**
   * 📊 取得圖層完整標題 (包含群組名稱) (Get Layer Full Title with Group Name)
   */
  const getLayerFullTitle = (layer) => {
    if (!layer) return { groupName: null, layerName: '未知圖層' };
    const groupName = dataStore.findGroupNameByLayerId(layer.layerId);
    return {
      groupName: groupName,
      layerName: layer.layerName,
    };
  };

  /**
   * 「版面網格·座標正規化」：自 OSM→GeoJSON 圖層（`osm_2_geojson_2_json`）之 dataOSM（或載入記憶之 session XML）解析路網 GeoJSON；
   * 不依賴本圖層之 osm-viewer 分頁。
   */
  const backingGeoJsonFromOsm2DataOsmForCoordNormViewer = (layer) => {
    if (!layer || layer.layerId !== JSON_GRID_COORD_NORMALIZED_LAYER_ID) return null;
    const osmLayer = dataStore.findLayerById(OSM_2_GEOJSON_2_JSON_LAYER_ID);
    let xml = osmLayer?.dataOSM;
    if (!xml || !String(xml).trim()) {
      xml = getOsm2GeojsonSessionOsmXml();
    }
    if (xml && String(xml).trim()) {
      try {
        const { geojsonData } = osmXmlStringToGeojsonData(String(xml));
        if (geojsonData?.features?.length) return geojsonData;
      } catch (_) {
        /* fallback 至圖層已快取之 GeoJSON */
      }
    }
    const gj = osmLayer?.geojsonData || osmLayer?.dataGeojson;
    return gj?.type === 'FeatureCollection' && Array.isArray(gj.features) && gj.features.length > 0
      ? gj
      : null;
  };

  /**
   * 📦 取得此分頁可用的主要示意圖資料
   * SpaceNetworkGridTab 只看 spaceNetworkGridJsonData
   */
  const getSchematicJsonData = (layer) => {
    if (!layer) return null;
    return layer.spaceNetworkGridJsonData ?? null;
  };

  /**
   * 🎨 判斷是否為網格示意圖圖層 (Check if Layer is Grid Schematic)
   * @param {string} layerId - 圖層 ID
   * @returns {boolean} 是否為網格示意圖圖層
   */
  const isGridSchematicLayer = (layerId) => {
    if (!layerId) return false;
    const layer = dataStore.findLayerById(layerId);
    return layer && layer.isGridSchematic === true;
  };

  /**
   * 🗺️ 判斷是否為地圖圖層 (Check if Layer has Map GeoJSON Data or Normalize Segments)
   * @param {string} layerId - 圖層 ID
   * @returns {boolean} 是否為地圖圖層
   */
  const getMapFeatureCollection = (layer) => {
    if (!layer) return null;
    const schematic = getSchematicJsonData(layer);
    /** @type {{ type:'FeatureCollection', features: unknown[] }|null} */
    let base = null;
    if (schematic && schematic.type === 'FeatureCollection' && Array.isArray(schematic.features)) {
      base = schematic;
    } else {
      const gj = layer.geojsonData;
      if (gj && gj.type === 'FeatureCollection' && Array.isArray(gj.features)) base = gj;
      else {
        base = backingGeoJsonFromOsm2DataOsmForCoordNormViewer(layer);
      }
    }
    if (!base) return null;
    const ug = layer.layoutUniformGridGeoJson;
    if (
      ug &&
      ug.type === 'FeatureCollection' &&
      Array.isArray(ug.features) &&
      ug.features.length > 0
    ) {
      return {
        type: 'FeatureCollection',
        features: [...base.features, ...ug.features],
      };
    }
    return base;
  };

  /**
   * 🗺️ 檢查是否為 Normalize Segments 格式
   * @param {any} data - 數據
   * @returns {boolean} 是否為 Normalize Segments 格式
   */
  const isNormalizeSegmentsFormat = (data) => {
    if (!Array.isArray(data) || data.length === 0) return false;
    // 檢查第一個元素是否有 Normalize Segments 的結構
    const firstItem = data[0];

    // 檢查是否為 2-5 格式（按路線分組）
    if (firstItem && firstItem.route_name && Array.isArray(firstItem.segments)) {
      return true;
    }

    // 檢查是否為一般 Normalize Segments 格式
    // points 可能是 [x,y]、[x,y,props] 或 { x, y }，皆視為可繪製路網
    const firstPoint = firstItem?.points?.[0];
    const isArrayPoint =
      Array.isArray(firstPoint) && firstPoint.length >= 2 && Number.isFinite(Number(firstPoint[0]));
    const isObjectPoint =
      firstPoint &&
      typeof firstPoint === 'object' &&
      !Array.isArray(firstPoint) &&
      Number.isFinite(Number(firstPoint.x)) &&
      Number.isFinite(Number(firstPoint.y));

    return (
      firstItem &&
      typeof firstItem === 'object' &&
      Array.isArray(firstItem.points) &&
      firstItem.points.length >= 2 &&
      (isArrayPoint || isObjectPoint)
    );
  };

  const isMapLayer = (layerId) => {
    if (!layerId) return false;
    const layer = dataStore.findLayerById(layerId);
    if (!layer) return false;

    // 檢查是否為 Normalize Segments 格式
    const d = getSchematicJsonData(layer);
    if (d && isNormalizeSegmentsFormat(d)) {
      return true;
    }

    // 檢查是否為 GeoJSON FeatureCollection 格式
    const fc = getMapFeatureCollection(layer);
    if (!fc) return false;

    // 檢查是否包含 Point / LineString / MultiLineString features
    return fc.features.some(
      (f) =>
        f &&
        f.geometry &&
        (f.geometry.type === 'Point' ||
          f.geometry.type === 'LineString' ||
          f.geometry.type === 'MultiLineString')
    );
  };

  // ==================== 📊 數據載入和處理函數 (Data Loading and Processing Functions) ====================

  /**
   * 📊 載入圖層數據 (Load Layer Data)
   * @param {string} layerId - 圖層 ID
   */
  const loadLayerData = async (layerId) => {
    try {
      // 找到指定的圖層
      const targetLayer = dataStore.findLayerById(layerId);
      if (!targetLayer) {
        throw new Error(`找不到圖層配置: ${layerId}`);
      }

      // 🎯 優先檢查是否為地圖圖層（有 GeoJSON 數據或 Normalize Segments）
      if (isMapLayer(layerId)) {
        const schematicData = getSchematicJsonData(targetLayer);
        // 檢查是否為 Normalize Segments 格式
        if (schematicData && isNormalizeSegmentsFormat(schematicData)) {
          // Normalize Segments 格式
          mapGeoJsonData.value = {
            type: 'NormalizeSegments',
            segments: schematicData,
          };
        } else {
          // 地圖數據（GeoJSON 格式）
          mapGeoJsonData.value = getMapFeatureCollection(targetLayer);
        }
        // 清除其他數據狀態
        gridData.value = null;
        nodeData.value = null;
        linkData.value = null;
      } else if (targetLayer.dataTableData && targetLayer.dataTableData.length > 0) {
        // 清除地圖數據狀態
        mapGeoJsonData.value = null;

        // 表格數據格式，轉換為示意圖格式
        const schematicData = targetLayer.dataTableData.map((item) => ({
          color: item.color,
          name: item.name,
          nodes: item.nodes || [],
        }));

        nodeData.value = schematicData;

        setLinkData();
      } else {
        // 如果有 spaceNetworkGridJsonData，嘗試作為其他格式處理
        // 清除地圖數據狀態
        mapGeoJsonData.value = null;

        const d = getSchematicJsonData(targetLayer);
        if (!d) {
          const mayShowEmptySpaceNetwork =
            Array.isArray(targetLayer.upperViewTabs) &&
            (targetLayer.upperViewTabs.includes('space-network-grid') ||
              targetLayer.upperViewTabs.includes('space-layout-grid-viewer'));
          if (mayShowEmptySpaceNetwork) {
            gridData.value = null;
            nodeData.value = null;
            linkData.value = null;
            return;
          }
          console.error('❌ 無法找到圖層數據:', {
            layerId: layerId,
            hasSpaceNetworkGridJsonData: !!targetLayer.spaceNetworkGridJsonData,
            hasDataTableData: !!targetLayer.dataTableData,
            isLoaded: targetLayer.isLoaded,
          });
          throw new Error('無法從圖層數據中提取示意圖數據');
        }

        // 嘗試將資料作為節點數據使用
        if (Array.isArray(d)) {
          nodeData.value = d;
          setLinkData();
        } else if (d.type === 'grid') {
          // 網格數據
          gridData.value = d;
          gridDimensions.value = {
            x: d.gridX,
            y: d.gridY,
          };
        } else {
          // 其他格式，直接使用
          nodeData.value = d;
          setLinkData();
        }
      }

      if (layerId === 'taipei_sn4_l') {
        refreshTaipeiL3BlackDotHighlightFromLayer(dataStore.findLayerById('taipei_sn4_l'));
      }
    } catch (error) {
      console.error('❌ 無法載入圖層數據:', error.message);
    }
  };

  /**
   * 📊 設定連接數據 (Set Link Data)
   */
  const setLinkData = () => {
    if (!nodeData.value) {
      console.warn('⚠️ setLinkData: nodeData.value 為空');
      linkData.value = [];
      return;
    }

    // 確保 nodeData.value 是數組
    if (!Array.isArray(nodeData.value)) {
      console.error('❌ setLinkData: nodeData.value 不是數組:', nodeData.value);
      linkData.value = [];
      return;
    }

    linkData.value = [];

    nodeData.value.forEach((path, index) => {
      // 確保 path 和 path.nodes 存在且是數組
      if (!path) {
        console.warn(`⚠️ setLinkData: 路徑 ${index} 為 null 或 undefined，跳過`);
        return;
      }
      if (!path.nodes) {
        console.warn(
          `⚠️ setLinkData: 路徑 ${index} (${path.name || '未命名'}) 缺少 nodes 屬性，跳過`
        );
        return;
      }
      if (!Array.isArray(path.nodes)) {
        console.warn(
          `⚠️ setLinkData: 路徑 ${index} (${path.name || '未命名'}) 的 nodes 不是數組 (${typeof path.nodes})，跳過`
        );
        return;
      }

      let thisX, thisY;
      let nodes = [];

      path.nodes.slice(0, path.nodes.length - 1).forEach((node) => {
        thisX = node.coord.x;
        thisY = node.coord.y;

        switch (node.type) {
          case 1:
          case 6:
          case 21:
          case 41:
            thisX = node.coord.x + 0.5;
            thisY = node.coord.y;
            break;
          case 2:
          case 8:
          case 12:
          case 32:
            thisX = node.coord.x;
            thisY = node.coord.y - 0.5;
            break;
          case 3:
          case 5:
          case 23:
          case 43:
            thisX = node.coord.x - 0.5;
            thisY = node.coord.y;
            break;
          case 4:
          case 7:
          case 14:
          case 34:
            thisX = node.coord.x;
            thisY = node.coord.y + 0.5;
            break;
        }

        nodes.push({
          value: node.value,
          type: node.type,
          coord: { x: thisX, y: thisY },
        });
      });

      let data = {
        color: colorMap[path.color] || path.color,
        name: path.name,
        nodes: nodes,
      };

      linkData.value.push(data);
    });
  };

  // ==================== 📏 容器尺寸和繪製函數 (Container Dimensions and Drawing Functions) ====================

  /**
   * 📏 獲取容器尺寸 (Get Container Dimensions)
   * @returns {Object} 包含 width 和 height 的尺寸物件
   */
  const getDimensions = () => {
    const container = document.getElementById(getContainerId());

    if (container) {
      // 獲取容器的實際可用尺寸
      const rect = container.getBoundingClientRect();
      const width = container.clientWidth || rect.width;
      const height = container.clientHeight || rect.height;

      const dimensions = {
        width: Math.max(width, 40),
        height: Math.max(height, 30),
      };

      // 更新 dataStore 中的尺寸狀態
      dataStore.updateD3jsDimensions(dimensions.width, dimensions.height);

      return dimensions;
    }

    // 如果找不到容器，使用預設尺寸
    const defaultDimensions = {
      width: 800,
      height: 600,
    };

    // 更新 dataStore 中的尺寸狀態
    dataStore.updateD3jsDimensions(defaultDimensions.width, defaultDimensions.height);

    return defaultDimensions;
  };

  /**
   * taipei_g 線性網格：依目前 SVG 版面、viewBox 與 d3 zoom 換算「一格」的螢幕 pt（與 Test4 相同 px→pt）
   */
  const refreshSpaceNetworkMinCellDimensions = () => {
    const b = dataStore.spaceNetworkSchematicPlotBounds;
    if (!b || !isTaipeiEfinalSpaceLayerTab(activeLayerTab.value)) {
      return;
    }
    const svgEl = document.querySelector(`#${getContainerId()} svg`);
    if (!svgEl || typeof svgEl.getBoundingClientRect !== 'function') {
      return;
    }
    const t = d3.zoomTransform(svgEl);
    const rect = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
    const vbw = vb && vb.width > 0 ? vb.width : 1;
    const vbh = vb && vb.height > 0 ? vb.height : 1;
    const scaleX = rect.width / vbw;
    const scaleY = rect.height / vbh;
    const xSpan = Math.max(1e-9, b.xSpan);
    const ySpan = Math.max(1e-9, b.ySpan);
    const cellWpxScreen =
      b.minCellWFrac != null && Number(b.minCellWFrac) > 0
        ? Number(b.minCellWFrac) * b.plotW * t.k * scaleX
        : (b.plotW / xSpan) * t.k * scaleX;
    const cellHpxScreen =
      b.minCellHFrac != null && Number(b.minCellHFrac) > 0
        ? Number(b.minCellHFrac) * b.plotH * t.k * scaleY
        : (b.plotH / ySpan) * t.k * scaleY;
    const ptWRaw = cellWpxScreen > 0 ? Math.max(1, Math.ceil(cellWpxScreen * 0.75)) : 0;
    const ptHRaw = cellHpxScreen > 0 ? Math.max(1, Math.ceil(cellHpxScreen * 0.75)) : 0;

    const rawMinW = Number(dataStore.taipeiFResizeMinWidthPtThreshold);
    const rawMinH = Number(dataStore.taipeiFResizeMinHeightPtThreshold);
    const MIN_W_PT = Number.isFinite(rawMinW) && rawMinW > 0 ? rawMinW : 10;
    const MIN_H_PT = Number.isFinite(rawMinH) && rawMinH > 0 ? rawMinH : 3;

    let reportMinW = ptWRaw;
    let reportMinH = ptHRaw;
    dataStore.updateSpaceNetworkGridMinCellDimensions(reportMinW, reportMinH);

    // 滑鼠縮放時不跑縮減網格（resize 依門檻自動合併）
    if (dataStore.taipeiFSpaceNetworkMouseZoom === true) {
      return;
    }
    const MAX_MERGE_DIFF = 4;
    if (taipeiFResizeAutoMergeRunning.value) return;
    const fLayer = isTaipeiEfinalSpaceLayerTab(activeLayerTab.value)
      ? dataStore.findLayerById(activeLayerTab.value)
      : null;
    if (
      !fLayer ||
      !Array.isArray(fLayer.spaceNetworkGridJsonData) ||
      fLayer.spaceNetworkGridJsonData.length === 0
    ) {
      return;
    }
    // taipei_i：僅路網顯示，不跑與 Control 相同的 resize 自動合併
    if (fLayer.layerId != null && isTaipeiTestILayerTab(fLayer.layerId)) return;

    if (ptWRaw >= MIN_W_PT) {
      fLayer.taipeiFResizeAutoMergeHorizontalNext = 0;
    }
    if (ptHRaw >= MIN_H_PT) {
      fLayer.taipeiFResizeAutoMergeVerticalNext = 0;
    }

    const hNext = fLayer.taipeiFResizeAutoMergeHorizontalNext ?? 0;
    const vNext = fLayer.taipeiFResizeAutoMergeVerticalNext ?? 0;

    let axis = null;
    let diff = 0;
    if (ptWRaw < MIN_W_PT && hNext <= MAX_MERGE_DIFF) {
      axis = 'horizontal';
      diff = hNext;
    } else if (ptHRaw < MIN_H_PT && vNext <= MAX_MERGE_DIFF) {
      axis = 'vertical';
      diff = vNext;
    }
    if (!axis) return;

    taipeiFResizeAutoMergeRunning.value = true;
    nextTick(() => {
      try {
        // 與 Control「合併黑點路段」相同：merge → rebuild → 刪空欄列 → rebuild → 表格（見 applyTaipeiFMergePruneRebuildToLayer）
        const mergeResult = applyTaipeiFMergePruneRebuildToLayer(fLayer, {
          maxWeightDiff: diff,
          mergeAxisConstraint: axis,
        });
        dataStore.setTaipeiFResizeLastAutoMergeInfo({
          maxWeightDiff: diff,
          mergeAxisConstraint: axis,
          mergeCount: mergeResult.mergeCount,
          removedColCount: mergeResult.removedColCount,
          removedRowCount: mergeResult.removedRowCount,
          removedCols: mergeResult.removedCols,
          removedRows: mergeResult.removedRows,
          source: 'resize',
          at: Date.now(),
        });
        if (axis === 'horizontal') {
          fLayer.taipeiFResizeAutoMergeHorizontalNext = hNext + 1;
        } else {
          fLayer.taipeiFResizeAutoMergeVerticalNext = vNext + 1;
        }
        dataStore.requestSpaceNetworkGridFullRedraw();
      } finally {
        taipeiFResizeAutoMergeRunning.value = false;
      }
    });
  };

  /**
   * 🎨 繪製網格示意圖 (Draw Grid Schematic)
   */
  const drawGridSchematic = () => {
    if (!gridData.value) {
      return;
    }

    // 獲取容器尺寸
    const dimensions = getDimensions();

    // 添加適當的邊距
    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    // 檢查是否已存在 SVG，如果存在且尺寸相同則不需要重繪
    const containerId = getContainerId();
    const existingSvg = d3.select(`#${containerId}`).select('svg');
    if (existingSvg.size() > 0) {
      const existingWidth = parseFloat(existingSvg.attr('width'));
      const existingHeight = parseFloat(existingSvg.attr('height'));

      // 如果尺寸變化很小（小於 2px），則只更新尺寸而不重繪
      // 降低閾值以確保寬度變化時能正確重繪
      if (
        Math.abs(existingWidth - (width + margin.left + margin.right)) < 2 &&
        Math.abs(existingHeight - (height + margin.top + margin.bottom)) < 2
      ) {
        return;
      }
    }

    // 清除之前的圖表
    d3.select(`#${containerId}`).selectAll('svg').remove();

    // 創建 SVG 元素
    const svg = d3
      .select(`#${containerId}`)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .style('background-color', COLOR_CONFIG.BACKGROUND)
      .style('transition', 'all 0.2s ease-in-out');

    // 🔍 創建可縮放的內容群組
    const zoomGroup = svg.append('g').attr('class', 'zoom-group');

    // 注意：現在使用實時計算的 columnMaxValues 和 rowMaxValues，不再需要預先計算的統計數據

    // 🎯 計算每列和每行的最大值（用於刪除邏輯）
    const columnMaxValues = new Array(gridDimensions.value.x).fill(0);
    const rowMaxValues = new Array(gridDimensions.value.y).fill(0);

    if (gridData.value && gridData.value.nodes) {
      gridData.value.nodes.forEach((node) => {
        columnMaxValues[node.x] = Math.max(columnMaxValues[node.x], node.value || 0);
        rowMaxValues[node.y] = Math.max(rowMaxValues[node.y], node.value || 0);
      });
    }

    // 遞歸計算需要隱藏的行列，直到所有單元格 >= 40px
    const computeHiddenIndices = () => {
      const hiddenCols = new Set();
      const hiddenRows = new Set();

      // 最多迭代次數，避免無限循環
      const maxIterations = Math.max(gridDimensions.value.x, gridDimensions.value.y);
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        // 🎯 計算當前可見列和行的最大值總和（用於比例分配）
        const visibleColumnMaxValues = columnMaxValues.filter((_, i) => !hiddenCols.has(i));
        const visibleRowMaxValues = rowMaxValues.filter((_, i) => !hiddenRows.has(i));

        const totalVisibleColumnValue = visibleColumnMaxValues.reduce((sum, val) => sum + val, 0);
        const totalVisibleRowValue = visibleRowMaxValues.reduce((sum, val) => sum + val, 0);

        // 🎯 計算每列的實際寬度和每行的實際高度
        const actualColumnWidths = columnMaxValues.map((maxVal, index) => {
          if (hiddenCols.has(index)) return 0;
          if (totalVisibleColumnValue === 0) {
            return width / visibleColumnMaxValues.length;
          }
          return (maxVal / totalVisibleColumnValue) * width;
        });

        const actualRowHeights = rowMaxValues.map((maxVal, index) => {
          if (hiddenRows.has(index)) return 0;
          if (totalVisibleRowValue === 0) {
            return height / visibleRowMaxValues.length;
          }
          return (maxVal / totalVisibleRowValue) * height;
        });

        let needAdjust = false;

        // 🎯 找出實際寬度 < 40 的列中，max 值最小的並隱藏
        const narrowColumns = columnMaxValues
          .map((max, index) => ({ index, max, width: actualColumnWidths[index] }))
          .filter((item) => !hiddenCols.has(item.index) && item.width < 40)
          .sort((a, b) => a.max - b.max);

        if (narrowColumns.length > 0 && visibleColumnMaxValues.length > 1) {
          hiddenCols.add(narrowColumns[0].index);
          needAdjust = true;
        }

        // 🎯 找出實際高度 < 40 的行中，max 值最小的並隱藏
        const shortRows = rowMaxValues
          .map((max, index) => ({ index, max, height: actualRowHeights[index] }))
          .filter((item) => !hiddenRows.has(item.index) && item.height < 40)
          .sort((a, b) => a.max - b.max);

        if (shortRows.length > 0 && visibleRowMaxValues.length > 1) {
          hiddenRows.add(shortRows[0].index);
          needAdjust = true;
        }

        // 如果這次迭代沒有調整，說明已達到穩定狀態
        if (!needAdjust) {
          break;
        }
      }

      return {
        hiddenColumnIndices: Array.from(hiddenCols),
        hiddenRowIndices: Array.from(hiddenRows),
      };
    };

    const { hiddenColumnIndices, hiddenRowIndices } = computeHiddenIndices();

    // 計算最終顯示的列數和行數
    const visibleColumns = gridDimensions.value.x - hiddenColumnIndices.length;
    const visibleRows = gridDimensions.value.y - hiddenRowIndices.length;

    // 🎯 最大值已經在上面計算過了，這裡直接使用

    // 過濾掉隱藏的列和行，只計算可見的最大值
    const visibleColumnMaxValues = columnMaxValues.filter(
      (_, i) => !hiddenColumnIndices.includes(i)
    );
    const visibleRowMaxValues = rowMaxValues.filter((_, i) => !hiddenRowIndices.includes(i));

    // 計算可見列/行的總和，用於比例分配
    const totalVisibleColumnValue = visibleColumnMaxValues.reduce((sum, val) => sum + val, 0);
    const totalVisibleRowValue = visibleRowMaxValues.reduce((sum, val) => sum + val, 0);

    // 🎯 根據最大值比例分配每列寬度和每行高度
    const columnWidths = columnMaxValues.map((maxVal, index) => {
      if (hiddenColumnIndices.includes(index)) {
        return 0; // 隱藏的列寬度為0
      }
      // 如果總和為0，平均分配
      if (totalVisibleColumnValue === 0) {
        return width / visibleColumns;
      }
      return (maxVal / totalVisibleColumnValue) * width;
    });

    const rowHeights = rowMaxValues.map((maxVal, index) => {
      if (hiddenRowIndices.includes(index)) {
        return 0; // 隱藏的行高度為0
      }
      // 如果總和為0，平均分配
      if (totalVisibleRowValue === 0) {
        return height / visibleRows;
      }
      return (maxVal / totalVisibleRowValue) * height;
    });

    // 計算累積位置（用於快速查找每列/行的起始位置）
    const columnPositions = [0];
    const rowPositions = [0];
    for (let i = 0; i < columnWidths.length; i++) {
      columnPositions.push(columnPositions[i] + columnWidths[i]);
    }
    for (let i = 0; i < rowHeights.length; i++) {
      rowPositions.push(rowPositions[i] + rowHeights[i]);
    }

    // 🎯 繪製邊界外框
    const borderGroup = zoomGroup.append('g').attr('class', 'border-group');
    borderGroup
      .append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('stroke', '#333333')
      .attr('stroke-width', 2);

    // 🔍 設置縮放行為
    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 10]) // 縮放範圍：0.1x 到 10x
      .on('zoom', (event) => {
        zoomGroup.attr('transform', event.transform);
      });

    // 將縮放行為應用到 SVG
    svg.call(zoom);

    // 繪製網格節點（使用 zoomGroup）
    drawGridNodes(
      zoomGroup,
      columnWidths,
      rowHeights,
      columnPositions,
      rowPositions,
      margin,
      hiddenColumnIndices,
      hiddenRowIndices,
      columnMaxValues,
      rowMaxValues
    );

    // 將此次重繪後的可見行列與單元尺寸寫入 store，供其他 Tab 讀取
    // 注意：這裡使用平均值作為參考，實際尺寸已經是動態的
    const avgCellWidth =
      visibleColumns > 0 ? width / visibleColumns : width / gridDimensions.value.x;
    const avgCellHeight = visibleRows > 0 ? height / visibleRows : height / gridDimensions.value.y;
    if (activeLayerTab.value) {
      dataStore.updateComputedGridState(activeLayerTab.value, {
        visibleX: visibleColumns,
        visibleY: visibleRows,
        cellWidth: avgCellWidth,
        cellHeight: avgCellHeight,
      });

      // 🔄 更新 drawJsonData，刪除被隱藏的行列
      updateDrawJsonData(hiddenColumnIndices, hiddenRowIndices);
    }
  };

  /**
   * 🔄 更新 drawJsonData（刪除被隱藏的行列）
   * @param {Array} hiddenColumnIndices - 被隱藏的列索引
   * @param {Array} hiddenRowIndices - 被隱藏的行索引
   */
  const updateDrawJsonData = (hiddenColumnIndices, hiddenRowIndices) => {
    if (!activeLayerTab.value || !gridData.value) return;

    const currentLayer = dataStore.findLayerById(activeLayerTab.value);
    if (!currentLayer || !currentLayer.drawJsonData) return;

    // 建立快速查找的 Map：(x,y) -> node
    const nodeMap = new Map();
    gridData.value.nodes.forEach((node) => {
      nodeMap.set(`${node.x},${node.y}`, node);
    });

    /**
     * 獲取相鄰被刪除的 grid 值
     * @param {number} x - 當前節點的 x 座標
     * @param {number} y - 當前節點的 y 座標
     * @returns {Object} 包含四個方向相鄰被刪除的 grid 值
     */
    const getAdjacentDeletedValues = (x, y) => {
      const deletedNeighbors = {
        left: [], // 左側被刪除的列的值
        right: [], // 右側被刪除的列的值
        top: [], // 上方被刪除的行的值
        bottom: [], // 下方被刪除的行的值
      };

      // 檢查左側被刪除的列
      for (let checkX = x - 1; checkX >= 0; checkX--) {
        if (hiddenColumnIndices.includes(checkX)) {
          const deletedNode = nodeMap.get(`${checkX},${y}`);
          if (deletedNode) {
            deletedNeighbors.left.push(deletedNode.value);
          }
        } else {
          // 遇到未被刪除的列就停止
          break;
        }
      }

      // 檢查右側被刪除的列
      for (let checkX = x + 1; checkX < gridDimensions.value.x; checkX++) {
        if (hiddenColumnIndices.includes(checkX)) {
          const deletedNode = nodeMap.get(`${checkX},${y}`);
          if (deletedNode) {
            deletedNeighbors.right.push(deletedNode.value);
          }
        } else {
          // 遇到未被刪除的列就停止
          break;
        }
      }

      // 檢查上方被刪除的行
      for (let checkY = y - 1; checkY >= 0; checkY--) {
        if (hiddenRowIndices.includes(checkY)) {
          const deletedNode = nodeMap.get(`${x},${checkY}`);
          if (deletedNode) {
            deletedNeighbors.top.push(deletedNode.value);
          }
        } else {
          // 遇到未被刪除的行就停止
          break;
        }
      }

      // 檢查下方被刪除的行
      for (let checkY = y + 1; checkY < gridDimensions.value.y; checkY++) {
        if (hiddenRowIndices.includes(checkY)) {
          const deletedNode = nodeMap.get(`${x},${checkY}`);
          if (deletedNode) {
            deletedNeighbors.bottom.push(deletedNode.value);
          }
        } else {
          // 遇到未被刪除的行就停止
          break;
        }
      }

      return deletedNeighbors;
    };

    // 建立列和行的映射（原始索引 -> 新索引）
    const columnMapping = new Map();
    const rowMapping = new Map();
    let newColIndex = 0;
    let newRowIndex = 0;

    for (let i = 0; i < gridDimensions.value.x; i++) {
      if (!hiddenColumnIndices.includes(i)) {
        columnMapping.set(i, newColIndex++);
      }
    }

    for (let i = 0; i < gridDimensions.value.y; i++) {
      if (!hiddenRowIndices.includes(i)) {
        rowMapping.set(i, newRowIndex++);
      }
    }

    // 過濾並重新映射節點
    const newNodes = gridData.value.nodes
      .filter((node) => !hiddenColumnIndices.includes(node.x) && !hiddenRowIndices.includes(node.y))
      .map((node) => {
        // 獲取相鄰被刪除的 grid 值（使用原始座標）
        const deletedNeighbors = getAdjacentDeletedValues(node.x, node.y);

        return {
          ...node,
          x: columnMapping.get(node.x),
          y: rowMapping.get(node.y),
          coord: {
            x: columnMapping.get(node.x),
            y: rowMapping.get(node.y),
          },
          // 相鄰被刪除的 grid 值
          deletedNeighbors: deletedNeighbors,
        };
      });

    // 重新計算統計數據
    const newGridX = gridDimensions.value.x - hiddenColumnIndices.length;
    const newGridY = gridDimensions.value.y - hiddenRowIndices.length;

    // 計算 X 排統計
    const xRowStats = [];
    for (let x = 0; x < newGridX; x++) {
      const values = newNodes.filter((node) => node.x === x).map((node) => node.value);
      if (values.length > 0) {
        xRowStats.push({
          row: x,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((sum, val) => sum + val, 0) / values.length,
          count: values.length,
        });
      }
    }

    // 計算 Y 排統計
    const yRowStats = [];
    for (let y = 0; y < newGridY; y++) {
      const values = newNodes.filter((node) => node.y === y).map((node) => node.value);
      if (values.length > 0) {
        yRowStats.push({
          row: y,
          min: Math.min(...values),
          max: Math.max(...values),
          avg: values.reduce((sum, val) => sum + val, 0) / values.length,
          count: values.length,
        });
      }
    }

    // 計算整體統計
    const allValues = newNodes.map((node) => node.value);
    const overallStats = {
      min: Math.min(...allValues),
      max: Math.max(...allValues),
      avg: allValues.reduce((sum, val) => sum + val, 0) / allValues.length,
      count: allValues.length,
    };

    // 更新 drawJsonData
    currentLayer.drawJsonData = {
      ...currentLayer.drawJsonData,
      gridX: newGridX,
      gridY: newGridY,
      nodes: newNodes,
      totalNodes: newNodes.length,
      statsLabels: {
        xRowStats,
        yRowStats,
        overallStats,
        color: currentLayer.drawJsonData.statsLabels?.color || '#4CAF50',
        highlightColumnIndices: [],
        highlightRowIndices: [],
      },
    };
  };

  /**
   * 🔢 繪製網格節點 (Draw Grid Nodes)
   * @param {Object} svg - D3 SVG 選擇器
   * @param {Array} columnWidths - 每列的寬度陣列
   * @param {Array} rowHeights - 每行的高度陣列
   * @param {Array} columnPositions - 每列的累積位置陣列
   * @param {Array} rowPositions - 每行的累積位置陣列
   * @param {Object} margin - 邊距配置
   * @param {Array} hiddenColumnIndices - 需要隱藏的列索引
   * @param {Array} hiddenRowIndices - 需要隱藏的行索引
   * @param {Array} columnMaxValues - 每列的最大值陣列
   * @param {Array} rowMaxValues - 每行的最大值陣列
   */
  const drawGridNodes = (
    svg,
    columnWidths,
    rowHeights,
    columnPositions,
    rowPositions,
    margin,
    hiddenColumnIndices,
    hiddenRowIndices,
    columnMaxValues,
    rowMaxValues
  ) => {
    if (!gridData.value || !gridData.value.nodes) return;

    // 獲取當前圖層的 drawJsonData（暫時保留以備將來使用）
    // const currentLayer = dataStore.findLayerById(activeLayerTab.value);
    // const drawJsonData = currentLayer ? currentLayer.drawJsonData : null;

    // 計算可見列和行的累積位置
    const visibleColumnPositions = [0];
    let cumX = 0;
    for (let i = 0; i < columnWidths.length; i++) {
      if (!hiddenColumnIndices.includes(i)) {
        cumX += columnWidths[i];
        visibleColumnPositions.push(cumX);
      }
    }

    const visibleRowPositions = [0];
    let cumY = 0;
    for (let i = 0; i < rowHeights.length; i++) {
      if (!hiddenRowIndices.includes(i)) {
        cumY += rowHeights[i];
        visibleRowPositions.push(cumY);
      }
    }

    // 建立原始索引到可見索引的映射
    const columnToVisibleIndex = new Map();
    const rowToVisibleIndex = new Map();
    let visibleColIdx = 0;
    let visibleRowIdx = 0;

    for (let i = 0; i < columnWidths.length; i++) {
      if (!hiddenColumnIndices.includes(i)) {
        columnToVisibleIndex.set(i, visibleColIdx++);
      }
    }

    for (let i = 0; i < rowHeights.length; i++) {
      if (!hiddenRowIndices.includes(i)) {
        rowToVisibleIndex.set(i, visibleRowIdx++);
      }
    }

    // 創建節點群組
    const nodeGroup = svg.append('g').attr('class', 'grid-nodes');

    // 獲取當前圖層的 drawJsonData 以取得 deletedNeighbors 資訊
    const currentLayer = dataStore.findLayerById(activeLayerTab.value);
    const drawJsonData = currentLayer ? currentLayer.drawJsonData : null;
    const drawNodes = drawJsonData ? drawJsonData.nodes : null;

    // 建立快速查找 drawNode 的 Map：(x,y) -> drawNode
    const drawNodeMap = new Map();
    if (drawNodes) {
      drawNodes.forEach((drawNode) => {
        drawNodeMap.set(`${drawNode.x},${drawNode.y}`, drawNode);
      });
    }

    // 繪製每個節點（只顯示數值文字，不顯示圓圈）
    gridData.value.nodes.forEach((node) => {
      // 檢查是否需要隱藏該節點
      if (hiddenColumnIndices.includes(node.x) || hiddenRowIndices.includes(node.y)) {
        return; // 不繪製此節點
      }

      const visibleColIdx = columnToVisibleIndex.get(node.x);
      const visibleRowIdx = rowToVisibleIndex.get(node.y);

      if (visibleColIdx === undefined || visibleRowIdx === undefined) return;

      // 計算節點中心位置
      const x = margin.left + visibleColumnPositions[visibleColIdx] + columnWidths[node.x] / 2;
      const y = margin.top + visibleRowPositions[visibleRowIdx] + rowHeights[node.y] / 2;

      // 節點數字顏色使用配置的文字顏色
      const nodeColor = COLOR_CONFIG.TEXT_FILL;

      // 使用固定字體大小，不受網格大小影響
      const fontSize = 14; // 固定字體大小

      // 只繪製節點數值文字，使用動態決定的顏色
      nodeGroup
        .append('text')
        .attr('x', x)
        .attr('y', y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', fontSize)
        .attr('font-weight', 'bold')
        .attr('fill', nodeColor)
        .text(node.value);

      // 🎯 繪製相鄰被刪除的 grid 值
      const drawNode = drawNodeMap.get(`${visibleColIdx},${visibleRowIdx}`);
      if (drawNode && drawNode.deletedNeighbors) {
        const deletedNeighbors = drawNode.deletedNeighbors;
        const deletedFontSize = 10; // 被刪除值的字體大小
        const deletedColor = '#FFA500'; // 橙色，用於區分

        // 計算當前格子的寬度和高度
        const cellWidth = columnWidths[node.x];
        const cellHeight = rowHeights[node.y];

        // 左側被刪除的值
        if (deletedNeighbors.left && deletedNeighbors.left.length > 0) {
          const leftText = deletedNeighbors.left.join(',');
          nodeGroup
            .append('text')
            .attr('x', x - cellWidth / 4)
            .attr('y', y)
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', deletedFontSize)
            .attr('fill', deletedColor)
            .text(leftText);
        }

        // 右側被刪除的值
        if (deletedNeighbors.right && deletedNeighbors.right.length > 0) {
          const rightText = deletedNeighbors.right.join(',');
          nodeGroup
            .append('text')
            .attr('x', x + cellWidth / 4)
            .attr('y', y)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', deletedFontSize)
            .attr('fill', deletedColor)
            .text(rightText);
        }

        // 上方被刪除的值
        if (deletedNeighbors.top && deletedNeighbors.top.length > 0) {
          const topText = deletedNeighbors.top.join(',');
          nodeGroup
            .append('text')
            .attr('x', x)
            .attr('y', y - cellHeight / 4)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'bottom')
            .attr('font-size', deletedFontSize)
            .attr('fill', deletedColor)
            .text(topText);
        }

        // 下方被刪除的值
        if (deletedNeighbors.bottom && deletedNeighbors.bottom.length > 0) {
          const bottomText = deletedNeighbors.bottom.join(',');
          nodeGroup
            .append('text')
            .attr('x', x)
            .attr('y', y + cellHeight / 4)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'top')
            .attr('font-size', deletedFontSize)
            .attr('fill', deletedColor)
            .text(bottomText);
        }
      }
    });

    // 繪製統計數據標籤
    drawStatisticsLabels(
      svg,
      columnWidths,
      rowHeights,
      columnPositions,
      rowPositions,
      margin,
      hiddenColumnIndices,
      hiddenRowIndices,
      columnMaxValues,
      rowMaxValues
    );
  };

  /**
   * 📊 繪製統計數據標籤 (Draw Statistics Labels)
   * @param {Object} svg - D3 SVG 選擇器
   * @param {Array} columnWidths - 每列的寬度陣列
   * @param {Array} rowHeights - 每行的高度陣列
   * @param {Array} columnPositions - 每列的累積位置陣列
   * @param {Array} rowPositions - 每行的累積位置陣列
   * @param {Object} margin - 邊距配置
   * @param {Array} hiddenColumnIndices - 需要隱藏的列索引
   * @param {Array} hiddenRowIndices - 需要隱藏的行索引
   * @param {Array} columnMaxValues - 每列的最大值陣列
   * @param {Array} rowMaxValues - 每行的最大值陣列
   */
  const drawStatisticsLabels = (
    svg,
    columnWidths,
    rowHeights,
    columnPositions,
    rowPositions,
    margin,
    hiddenColumnIndices,
    hiddenRowIndices,
    columnMaxValues,
    rowMaxValues
  ) => {
    if (!gridData.value || !columnMaxValues || !rowMaxValues) return;

    // 創建統計標籤群組
    const statsGroup = svg.append('g').attr('class', 'statistics-labels');

    // 使用固定字體大小，不受網格大小影響
    const fontSize = 12; // 固定字體大小（比節點數字稍小）
    const labelOffset = 5;

    // 使用實時計算的最大值數據，而不是預先計算的數據
    const currentLayer = dataStore.findLayerById(activeLayerTab.value);
    const drawJsonData = currentLayer ? currentLayer.drawJsonData : null;

    // 創建實時統計數據
    const xRowStats = columnMaxValues.map((maxVal, index) => ({
      row: index,
      max: maxVal,
    }));

    const yRowStats = rowMaxValues.map((maxVal, index) => ({
      row: index,
      max: maxVal,
    }));

    const color = drawJsonData?.statsLabels?.color || '#4CAF50';

    if (xRowStats && yRowStats) {
      // 計算可見列的累積位置
      const visibleColumnPositions = [0];
      let cumX = 0;
      for (let i = 0; i < columnWidths.length; i++) {
        if (!hiddenColumnIndices.includes(i)) {
          cumX += columnWidths[i];
          visibleColumnPositions.push(cumX);
        }
      }
      const totalVisibleGridWidth = cumX;

      // 計算可見行的累積位置
      const visibleRowPositions = [0];
      let cumY = 0;
      for (let i = 0; i < rowHeights.length; i++) {
        if (!hiddenRowIndices.includes(i)) {
          cumY += rowHeights[i];
          visibleRowPositions.push(cumY);
        }
      }

      // 建立原始索引到可見索引的映射
      const columnToVisibleIndex = new Map();
      const rowToVisibleIndex = new Map();
      let visibleColIdx = 0;
      let visibleRowIdx = 0;

      for (let i = 0; i < columnWidths.length; i++) {
        if (!hiddenColumnIndices.includes(i)) {
          columnToVisibleIndex.set(i, visibleColIdx++);
        }
      }

      for (let i = 0; i < rowHeights.length; i++) {
        if (!hiddenRowIndices.includes(i)) {
          rowToVisibleIndex.set(i, visibleRowIdx++);
        }
      }

      // 繪製 X 排（垂直方向）統計標籤 - 只顯示最大值
      if (xRowStats) {
        xRowStats.forEach((xStat, index) => {
          // 當該列被隱藏時，不顯示此標籤
          if (hiddenColumnIndices.includes(index)) {
            return; // 不繪製此標籤
          }

          const visibleColIdx = columnToVisibleIndex.get(xStat.row);
          if (visibleColIdx === undefined) return;

          const x =
            margin.left + visibleColumnPositions[visibleColIdx] + columnWidths[xStat.row] / 2;
          const y = margin.top - labelOffset;

          // 只顯示最大值標籤
          statsGroup
            .append('text')
            .attr('x', x)
            .attr('y', y)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'bottom')
            .attr('font-size', fontSize)
            .attr('font-weight', 'bold')
            .attr('fill', color) // 使用預設顏色
            .text(`${xStat.max}`);
        });
      }

      // 繪製 Y 排（水平方向）統計標籤 - 只顯示最大值
      if (yRowStats) {
        yRowStats.forEach((yStat, index) => {
          // 當該行被隱藏時，不顯示此標籤
          if (hiddenRowIndices.includes(index)) {
            return; // 不繪製此標籤
          }

          const visibleRowIdx = rowToVisibleIndex.get(yStat.row);
          if (visibleRowIdx === undefined) return;

          const x = margin.left + totalVisibleGridWidth + labelOffset;
          const y = margin.top + visibleRowPositions[visibleRowIdx] + rowHeights[yStat.row] / 2;

          // 只顯示最大值標籤（整個網格右側）
          statsGroup
            .append('text')
            .attr('x', x)
            .attr('y', y)
            .attr('text-anchor', 'start')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', fontSize)
            .attr('font-weight', 'bold')
            .attr('fill', color) // 使用預設顏色
            .text(`${yStat.max}`);
        });
      }
    }
  };

  /**
   * 🎨 繪製行政區示意圖 (Draw Administrative District Schematic)
   */
  const drawAdministrativeSchematic = () => {
    if (!nodeData.value) {
      console.warn('⚠️ drawAdministrativeSchematic: nodeData.value 為空');
      return;
    }

    // 確保 nodeData.value 是數組
    if (!Array.isArray(nodeData.value)) {
      console.error('❌ nodeData.value 不是數組:', nodeData.value);
      return;
    }

    // 檢查數據格式並記錄無效的路徑
    const invalidPaths = nodeData.value.filter((path, index) => {
      if (!path) {
        console.warn(`⚠️ 路徑 ${index} 為 null 或 undefined`);
        return true;
      }
      if (!path.nodes) {
        console.warn(`⚠️ 路徑 ${index} (${path.name || '未命名'}) 缺少 nodes 屬性`);
        return true;
      }
      if (!Array.isArray(path.nodes)) {
        console.warn(
          `⚠️ 路徑 ${index} (${path.name || '未命名'}) 的 nodes 不是數組:`,
          typeof path.nodes
        );
        return true;
      }
      return false;
    });

    if (invalidPaths.length > 0) {
      console.warn(`⚠️ 發現 ${invalidPaths.length} 個無效路徑，將跳過這些路徑`);
    }

    // 畫布長寬px
    let dimensions = getDimensions();

    // 添加適當的邊距，確保內容不被截斷
    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    // 獲取所有節點座標（使用兼容 flatMap 的方法）
    const allPoints = nodeData.value.reduce((acc, d) => {
      if (d.nodes && Array.isArray(d.nodes)) {
        const points = d.nodes
          .map((node) => ({
            x: node.coord?.x,
            y: node.coord?.y,
          }))
          .filter((p) => p.x !== undefined && p.y !== undefined);
        return acc.concat(points);
      }
      return acc;
    }, []);

    // 找到點的最大最小值
    let xMax = d3.max(allPoints, (d) => d.x);
    let yMax = d3.max(allPoints, (d) => d.y);

    // 檢查是否已存在 SVG，如果存在且尺寸相同則不需要重繪
    const containerId = getContainerId();
    const existingSvg = d3.select(`#${containerId}`).select('svg');
    if (existingSvg.size() > 0) {
      const existingWidth = parseFloat(existingSvg.attr('width'));
      const existingHeight = parseFloat(existingSvg.attr('height'));

      // 如果尺寸變化很小（小於 2px），則只更新尺寸而不重繪
      // 降低閾值以確保寬度變化時能正確重繪
      if (
        Math.abs(existingWidth - (width + margin.left + margin.right)) < 2 &&
        Math.abs(existingHeight - (height + margin.top + margin.bottom)) < 2
      ) {
        return;
      }
    }

    // 清除之前的圖表
    d3.select(`#${containerId}`).selectAll('svg').remove();

    // 創建 SVG 元素
    const svg = d3
      .select(`#${containerId}`)
      .append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .style('background-color', COLOR_CONFIG.BACKGROUND)
      .style('transition', 'all 0.2s ease-in-out'); // 添加平滑過渡效果

    // 🔍 創建可縮放的內容群組
    const zoomGroup = svg.append('g').attr('class', 'zoom-group');

    // 直接使用容器的完整尺寸，允許形狀變形以完全填滿容器
    const actualWidth = width;
    const actualHeight = height;

    // 繪製參數已準備就緒

    // 設定比例尺，使用實際繪圖區域
    const x = d3
      .scaleLinear()
      .domain([0, xMax])
      .range([margin.left, margin.left + actualWidth]);
    const y = d3
      .scaleLinear()
      .domain([yMax, 0])
      .range([margin.top, margin.top + actualHeight]);

    // 🎯 繪製邊界外框
    const borderGroup = zoomGroup.append('g').attr('class', 'border-group');
    borderGroup
      .append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', actualWidth)
      .attr('height', actualHeight)
      .attr('fill', 'none')
      .attr('stroke', '#333333')
      .attr('stroke-width', 2);

    // 🔍 設置縮放行為
    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 10]) // 縮放範圍：0.1x 到 10x
      .on('zoom', (event) => {
        zoomGroup.attr('transform', event.transform);
      });

    // 將縮放行為應用到 SVG
    svg.call(zoom);

    // 創建線條生成器
    const lineGenerator = d3
      .line()
      .x((d) => x(d.x))
      .y((d) => y(d.y))
      .curve(d3.curveNatural);

    // 繪製每個路徑的節點連接
    // 過濾掉無效的路徑
    const validPaths = nodeData.value.filter(
      (path) => path && path.nodes && Array.isArray(path.nodes)
    );
    validPaths.forEach((path) => {
      if (!path.nodes || !Array.isArray(path.nodes)) {
        return;
      }
      path.nodes.forEach((node) => {
        // 確保 node 和 node.coord 存在
        if (!node || !node.coord) {
          return;
        }

        let dString = '';
        let nodes = [];

        switch (node.type) {
          case 1:
            nodes = [
              { x: node.coord.x - 0.5, y: node.coord.y },
              { x: node.coord.x + 0.5, y: node.coord.y },
            ];
            dString = lineGenerator(nodes);
            break;
          case 2:
            nodes = [
              { x: node.coord.x, y: node.coord.y - 0.5 },
              { x: node.coord.x, y: node.coord.y + 0.5 },
            ];
            dString = lineGenerator(nodes);
            break;
          case 3:
            nodes = [
              { x: node.coord.x + 0.5, y: node.coord.y },
              { x: node.coord.x - 0.5, y: node.coord.y },
            ];
            dString = lineGenerator(nodes);
            break;
          case 4:
            nodes = [
              { x: node.coord.x, y: node.coord.y + 0.5 },
              { x: node.coord.x, y: node.coord.y - 0.5 },
            ];
            dString = lineGenerator(nodes);
            break;
          case 5:
            nodes = [
              { x: node.coord.x, y: node.coord.y },
              { x: node.coord.x - 0.5, y: node.coord.y },
            ];
            dString = lineGenerator(nodes);
            break;
          case 6:
            nodes = [
              { x: node.coord.x + 0.5, y: node.coord.y },
              { x: node.coord.x, y: node.coord.y },
            ];
            dString = lineGenerator(nodes);
            break;
          case 7:
            nodes = [
              { x: node.coord.x, y: node.coord.y + 0.5 },
              { x: node.coord.x, y: node.coord.y },
            ];
            dString = lineGenerator(nodes);
            break;
          case 8:
            nodes = [
              { x: node.coord.x, y: node.coord.y },
              { x: node.coord.x, y: node.coord.y - 0.5 },
            ];
            dString = lineGenerator(nodes);
            break;
          case 12:
          case 43: {
            let xWidth = Math.abs(x(node.coord.x - 0.5) - x(node.coord.x));
            let yHeight = Math.abs(y(node.coord.y) - y(node.coord.y - 0.5));

            let arcWidth = 0;

            if (xWidth < yHeight) {
              arcWidth = xWidth;

              nodes = [
                { x: node.coord.x, y: y.invert(y(node.coord.y) + arcWidth) },
                { x: node.coord.x, y: node.coord.y - 0.5 },
              ];
            } else {
              arcWidth = yHeight;

              nodes = [
                { x: node.coord.x - 0.5, y: node.coord.y },
                { x: x.invert(x(node.coord.x) - arcWidth), y: node.coord.y },
              ];
            }

            dString = lineGenerator(nodes);

            const arc = d3
              .arc()
              .innerRadius(arcWidth - 3)
              .outerRadius(arcWidth + 3)
              .startAngle(0)
              .endAngle(Math.PI / 2);

            zoomGroup
              .append('path')
              .attr('d', arc)
              .attr(
                'transform',
                `translate(${x(node.coord.x) - arcWidth}, ${y(node.coord.y) + arcWidth})`
              )
              .attr('fill', path.color);
            break;
          }
          case 21:
          case 34: {
            let xWidth = Math.abs(x(node.coord.x - 0.5) - x(node.coord.x));
            let yHeight = Math.abs(y(node.coord.y) - y(node.coord.y - 0.5));

            let arcWidth = 0;

            if (xWidth < yHeight) {
              arcWidth = xWidth;

              nodes = [
                { x: node.coord.x, y: y.invert(y(node.coord.y) - arcWidth) },
                { x: node.coord.x, y: node.coord.y + 0.5 },
              ];
            } else {
              arcWidth = yHeight;

              nodes = [
                { x: node.coord.x + 0.5, y: node.coord.y },
                { x: x.invert(x(node.coord.x) + arcWidth), y: node.coord.y },
              ];
            }

            dString = lineGenerator(nodes);

            const arc = d3
              .arc()
              .innerRadius(arcWidth - 3)
              .outerRadius(arcWidth + 3)
              .startAngle(-Math.PI / 2)
              .endAngle(-Math.PI);

            zoomGroup
              .append('path')
              .attr('d', arc)
              .attr(
                'transform',
                `translate(${x(node.coord.x) + arcWidth}, ${y(node.coord.y) - arcWidth})`
              )
              .attr('fill', path.color);
            break;
          }
          case 14:
          case 23: {
            let xWidth = Math.abs(x(node.coord.x - 0.5) - x(node.coord.x));
            let yHeight = Math.abs(y(node.coord.y) - y(node.coord.y - 0.5));

            let arcWidth = 0;

            if (xWidth < yHeight) {
              arcWidth = xWidth;

              nodes = [
                { x: node.coord.x, y: y.invert(y(node.coord.y) - arcWidth) },
                { x: node.coord.x, y: node.coord.y + 0.5 },
              ];
            } else {
              arcWidth = yHeight;

              nodes = [
                { x: node.coord.x - 0.5, y: node.coord.y },
                { x: x.invert(x(node.coord.x) - arcWidth), y: node.coord.y },
              ];
            }

            dString = lineGenerator(nodes);

            const arc = d3
              .arc()
              .innerRadius(arcWidth - 3)
              .outerRadius(arcWidth + 3)
              .startAngle(Math.PI / 2)
              .endAngle(Math.PI);

            zoomGroup
              .append('path')
              .attr('d', arc)
              .attr(
                'transform',
                `translate(${x(node.coord.x) - arcWidth}, ${y(node.coord.y) - arcWidth})`
              )
              .attr('fill', path.color);
            break;
          }
          case 32:
          case 41: {
            let xWidth = Math.abs(x(node.coord.x - 0.5) - x(node.coord.x));
            let yHeight = Math.abs(y(node.coord.y) - y(node.coord.y - 0.5));

            let arcWidth = 0;

            if (xWidth < yHeight) {
              arcWidth = xWidth;

              nodes = [
                { x: node.coord.x, y: y.invert(y(node.coord.y) + arcWidth) },
                { x: node.coord.x, y: node.coord.y - 0.5 },
              ];
            } else {
              arcWidth = yHeight;

              nodes = [
                { x: node.coord.x + 0.5, y: node.coord.y },
                { x: x.invert(x(node.coord.x) + arcWidth), y: node.coord.y },
              ];
            }

            dString = lineGenerator(nodes);

            const arc = d3
              .arc()
              .innerRadius(arcWidth - 3)
              .outerRadius(arcWidth + 3)
              .startAngle(0)
              .endAngle(-Math.PI / 2);

            zoomGroup
              .append('path')
              .attr('d', arc)
              .attr(
                'transform',
                `translate(${x(node.coord.x) + arcWidth}, ${y(node.coord.y) + arcWidth})`
              )
              .attr('fill', path.color);
            break;
          }
          default:
            break;
        }

        if (dString !== '') {
          zoomGroup
            .append('path')
            .attr('d', dString)
            .attr('stroke', path.color)
            .attr('fill', 'none')
            .attr('stroke-width', 6);
        }
      });
    });

    // 繪製節點數值標籤
    if (linkData.value && Array.isArray(linkData.value)) {
      // 獲取當前圖層的 drawJsonData（暫時保留以備將來使用）
      // const currentLayer = dataStore.findLayerById(activeLayerTab.value);
      // const drawJsonData = currentLayer ? currentLayer.drawJsonData : null;

      const allLinks = linkData.value
        .filter((line) => line && line.nodes && Array.isArray(line.nodes))
        .flatMap((line) =>
          line.nodes.map((node) => ({
            ...node,
          }))
        );

      allLinks.forEach((node) => {
        // 確保 node 和 node.coord 存在
        if (!node || !node.coord || node.coord.x === undefined || node.coord.y === undefined) {
          return;
        }

        // 節點數字顏色使用配置的文字顏色
        const nodeColor = COLOR_CONFIG.TEXT_FILL;

        zoomGroup
          .append('text')
          .attr('x', x(node.coord.x))
          .attr('y', y(node.coord.y))
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', '10px')
          .attr('fill', nodeColor)
          .text(`${node.value}`);
      });
    }
  };

  /** taipei_g 滑鼠縮放：強制重繪時保留 d3 zoom、焦點格索引 */
  let drawMapForceNext = false;
  let savedTaipeiFZoomTransform = null;
  const taipeiFMouseZoomHover = ref({ ix: null, iy: null });
  let taipeiFMouseZoomRaf = 0;
  let scheduleTaipeiFDrawForMouseZoom = () => {};

  /**
   * 🗺️ 繪製地圖 (Draw Map)
   * 使用 D3.js 繪製 GeoJSON 地圖數據或 Normalize Segments（站點和路線）
   * 背景強制為白色
   */
  const drawMap = () => {
    const layerTab = spaceGridDataLayerTabId.value;
    const uniformGridRouteFamilyTab = isSpaceLayoutUniformGridViewerLayerId(layerTab);
    const activeTabLayer = dataStore.findLayerById(layerTab);
    const layoutUniformGridTooltipJr = uniformGridRouteFamilyTab
      ? buildEnrichedMapDrawnRowsForUniformGridTooltip(dataStore, layerTab, activeTabLayer)
      : null;
    const forceThisDraw = drawMapForceNext;
    drawMapForceNext = false;
    if (!mapGeoJsonData.value) return;

    // 獲取容器尺寸
    const dimensions = getDimensions();

    // 添加適當的邊距（增加底部和左側邊距以容納刻度標籤）
    /** layout_network_grid_from_vh_draw：軸上座標下加一行「刻度間黑點max」；左側為欄區間標籤留寬 */
    const margin = isLayoutNetworkGridFromVhDrawLayerId(layerTab)
      ? { top: 20, right: 20, bottom: 52, left: 72 }
      : { top: 20, right: 20, bottom: 40, left: 50 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    // 檢查是否已存在 SVG，如果存在且尺寸相同則不需要重繪
    const containerId = getContainerId();
    const svgW = width + margin.left + margin.right;
    const svgH = height + margin.top + margin.bottom;
    const existingSvg = d3.select(`#${containerId}`).select('svg');
    if (forceThisDraw && existingSvg.size() > 0) {
      const node = existingSvg.node();
      if (node) {
        savedTaipeiFZoomTransform = d3.zoomTransform(node);
      }
    }
    if (existingSvg.size() > 0) {
      const ew = parseFloat(existingSvg.attr('data-inner-w'));
      const eh = parseFloat(existingSvg.attr('data-inner-h'));

      if (
        !forceThisDraw &&
        Number.isFinite(ew) &&
        Number.isFinite(eh) &&
        Math.abs(ew - svgW) < 2 &&
        Math.abs(eh - svgH) < 2
      ) {
        refreshSpaceNetworkMinCellDimensions();
        return;
      }
    }

    // 清除之前的圖表和 tooltip
    d3.select(`#${containerId}`).selectAll('svg').remove();
    d3.select('body').selectAll('.d3js-map-tooltip').remove();

    // 🎯 強制設置容器背景為白色（清除任何可能的殘留樣式）
    const container = document.getElementById(containerId);
    if (container) {
      container.style.backgroundColor = '#FFFFFF';
      container.style.background = '#FFFFFF';
      container.style.setProperty('background-color', '#FFFFFF', 'important');
      container.style.setProperty('background', '#FFFFFF', 'important');
    }

    // 創建 SVG 元素（強制白色背景）；viewBox + 100% 填滿容器，配合 preserveAspectRatio 適應版面
    const svg = d3
      .select(`#${containerId}`)
      .append('svg')
      .attr('viewBox', `0 0 ${svgW} ${svgH}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('data-inner-w', svgW)
      .attr('data-inner-h', svgH)
      .style('background-color', '#FFFFFF')
      .style('background', '#FFFFFF')
      .style('transition', 'all 0.2s ease-in-out');

    // 🎯 強制設置 SVG 背景色（使用 DOM 直接設置以確保生效）
    const svgElement = svg.node();
    if (svgElement) {
      svgElement.style.setProperty('background-color', '#FFFFFF', 'important');
      svgElement.style.setProperty('background', '#FFFFFF', 'important');
    }

    // 🎯 創建背景層群組（確保在最底層）
    const backgroundGroup = svg.append('g').attr('class', 'background-layer');

    // 🎯 添加白色背景矩形（最底層，確保背景是白色）
    backgroundGroup
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .attr('fill', '#FFFFFF')
      .attr('fill-opacity', 1);

    // 確保背景層在最底層
    backgroundGroup.lower();

    // 🔍 創建可縮放的內容群組
    const zoomGroup = svg.append('g').attr('class', 'zoom-group');

    // 創建 tooltip 元素（用於顯示 hover 信息）
    const tooltip = d3
      .select('body')
      .append('div')
      .attr('class', 'd3js-map-tooltip')
      .style('position', 'absolute')
      .style('padding', '8px 12px')
      .style('background-color', uniformGridRouteFamilyTab ? '#ffffff' : 'rgba(0, 0, 0, 0.8)')
      .style('color', uniformGridRouteFamilyTab ? '#1a1a1a' : '#FFFFFF')
      .style('border-radius', uniformGridRouteFamilyTab ? '6px' : '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 1000)
      .style('max-width', uniformGridRouteFamilyTab ? '340px' : '300px')
      .style('box-shadow', uniformGridRouteFamilyTab ? '0 3px 14px rgba(0,0,0,0.35)' : 'none')
      .style('border', uniformGridRouteFamilyTab ? '1px solid rgba(0,0,0,0.12)' : 'none');

    // 檢查是否為 Normalize Segments 格式
    const isNormalizeFormat = mapGeoJsonData.value.type === 'NormalizeSegments';
    let routeFeatures = [];
    let stationFeatures = [];
    /** 展開後路段（Normalize 分支內賦值；繪製階段供度數著色等使用） */
    let flatSegments = [];
    /** taipei_d：以「縮減疊加網格（空列／空行）後」座標繪製路網 */
    let taipeiCReducedOverlayDraw = false;
    /** 網路座標 (gx,gy) → 繪圖用縮減格座標；非縮減模式為 null */
    let reducedPlotMapper = null;
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;

    if (isNormalizeFormat) {
      // Normalize Segments 格式處理（優先使用 layer 當前資料，以反映 flip 後的狀態）
      const activeLayerForSegments = dataStore.findLayerById(layerTab);
      const jrForTooltipRowMatch = layoutUniformGridTooltipJr;
      const matchExportRowIndexForNormalizeSegment = (seg) => {
        if (!Array.isArray(jrForTooltipRowMatch) || jrForTooltipRowMatch.length === 0) return null;
        const pts = seg?.points;
        if (!Array.isArray(pts) || pts.length < 2) return null;
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        const ax = Number(Array.isArray(p0) ? p0[0] : p0?.x);
        const ay = Number(Array.isArray(p0) ? p0[1] : p0?.y);
        const bx = Number(Array.isArray(p1) ? p1[0] : p1?.x);
        const by = Number(Array.isArray(p1) ? p1[1] : p1?.y);
        if (
          !Number.isFinite(ax) ||
          !Number.isFinite(ay) ||
          !Number.isFinite(bx) ||
          !Number.isFinite(by)
        ) {
          return null;
        }
        const eps = 1e-3;
        for (let i = 0; i < jrForTooltipRowMatch.length; i++) {
          const r = jrForTooltipRowMatch[i];
          const s = r?.segment?.start;
          const e = r?.segment?.end;
          if (!s || !e) continue;
          const sax = Number(s.x_grid ?? s.lon);
          const say = Number(s.y_grid ?? s.lat);
          const ebx = Number(e.x_grid ?? e.lon);
          const eby = Number(e.y_grid ?? e.lat);
          if (
            Math.abs(sax - ax) <= eps &&
            Math.abs(say - ay) <= eps &&
            Math.abs(ebx - bx) <= eps &&
            Math.abs(eby - by) <= eps
          ) {
            return i;
          }
        }
        return null;
      };
      const currentLayerData = activeLayerForSegments?.spaceNetworkGridJsonData;
      const segments =
        Array.isArray(currentLayerData) && currentLayerData.length > 0
          ? currentLayerData
          : mapGeoJsonData.value.segments || [];

      // 檢查是否為 2-5 格式（按路線分組）
      const isMergedRoutesFormat =
        segments.length > 0 && segments[0].route_name && Array.isArray(segments[0].segments);

      flatSegments = [];
      if (isMergedRoutesFormat) {
        // 2-5 格式：展開所有路線的 segments
        segments.forEach((route) => {
          const routeColor = route.color || '#555555';
          route.segments.forEach((seg) => {
            flatSegments.push({
              ...seg,
              route_name: route.route_name,
              route_color: routeColor,
              original_props: route.original_props,
            });
          });
        });
      } else {
        flatSegments = segments;
      }

      // 從 segments 中提取所有座標點
      const allPoints = new Set();
      flatSegments.forEach((seg) => {
        seg.points.forEach((point) => {
          // 支持 [x, y] 或 [x, y, props] 格式
          const x = Array.isArray(point) ? point[0] : point.x || 0;
          const y = Array.isArray(point) ? point[1] : point.y || 0;
          allPoints.add(`${x},${y}`);
          xMin = Math.min(xMin, x);
          xMax = Math.max(xMax, x);
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
        });
      });

      /** 均勻網格族：路段 hover 需對齊 dataJson 匯出列（與 MapTab）；僅座標比對易因格線／經緯度空間不一致或同路線多段而失敗 */
      const matchExportRowIndexByEndpointStationIds = (seg) => {
        if (!Array.isArray(jrForTooltipRowMatch) || jrForTooltipRowMatch.length === 0) return null;
        const nodes = seg?.nodes;
        if (!Array.isArray(nodes) || nodes.length < 2) return null;
        const sidA = String(nodes[0]?.station_id ?? nodes[0]?.tags?.station_id ?? '').trim();
        const sidB = String(
          nodes[nodes.length - 1]?.station_id ?? nodes[nodes.length - 1]?.tags?.station_id ?? ''
        ).trim();
        if (!sidA || !sidB) return null;
        for (let i = 0; i < jrForTooltipRowMatch.length; i++) {
          const r = jrForTooltipRowMatch[i];
          const sm = r?.segment;
          if (!sm?.start || !sm?.end) continue;
          const rs = String(sm.start.station_id ?? sm.start.tags?.station_id ?? '').trim();
          const re = String(sm.end.station_id ?? sm.end.tags?.station_id ?? '').trim();
          if (rs === sidA && re === sidB) return i;
          if (rs === sidB && re === sidA) return i;
        }
        return null;
      };

      const resolveMapStyleExportRowIndexForSegment = (seg, flatSegmentIndex) => {
        if (!isSpaceLayoutUniformGridViewerLayerId(layerTab)) {
          return matchExportRowIndexForNormalizeSegment(seg);
        }
        let idx = matchExportRowIndexForNormalizeSegment(seg);
        if (idx != null) return idx;
        idx = matchExportRowIndexByEndpointStationIds(seg);
        if (idx != null) return idx;
        if (
          Array.isArray(jrForTooltipRowMatch) &&
          jrForTooltipRowMatch.length === flatSegments.length &&
          flatSegmentIndex >= 0 &&
          flatSegmentIndex < jrForTooltipRowMatch.length
        ) {
          const r = jrForTooltipRowMatch[flatSegmentIndex];
          if (r) return flatSegmentIndex;
        }
        return null;
      };

      // 將 segments 轉換為 routeFeatures 格式
      // 檢查是否為 2-3/2-4/2-5 格式（有 start_coord/end_coord）
      const isZLayoutFormat = flatSegments.length > 0 && flatSegments[0].start_coord;

      routeFeatures = flatSegments.map((seg, flatSegmentIndex) => {
        // 檢查是否為 2-6/2-7/2-8/2-9/2-10/3-1/4-1/6-1 格式（points 為 [x, y, props]）
        const isHydratedFormat =
          seg.points &&
          seg.points.length > 0 &&
          Array.isArray(seg.points[0]) &&
          seg.points[0].length > 2;

        // 提取純座標（如果是 [x, y, props] 格式，只取前兩個元素）
        let coordinates = seg.points.map((point) => {
          if (Array.isArray(point) && point.length >= 2) {
            return [point[0], point[1]];
          }
          return point;
        });
        if (isZLayoutFormat || isHydratedFormat) {
          // 2-3/2-4/2-5/2-6/2-7/2-8/2-9/2-10/3-1/4-1/6-1 格式：從 props 或 original_props 獲取屬性
          const props = seg.props || seg.original_props || {};
          return {
            geometry: {
              type: 'LineString',
              coordinates: coordinates,
            },
            properties: {
              tags: props.way_properties?.tags || props.properties?.tags || {},
              name: seg.route_name || props.name || props.route_name,
              color: seg.route_color,
              station_weights: seg.station_weights, // 傳遞 station_weights
              nav_weight:
                seg.nav_weight != null && Number.isFinite(Number(seg.nav_weight))
                  ? Number(seg.nav_weight)
                  : 1,
              original_points: seg.original_points || seg.points, // 傳遞原始點用於計算距離
              points: seg.points, // 傳遞 points 用於計算距離
              l3_black_dot_reduced_weight_green: Boolean(seg.l3_black_dot_reduced_weight_green),
              _flatSegmentIndex: flatSegmentIndex,
              map_draw_row_index: resolveMapStyleExportRowIndexForSegment(seg, flatSegmentIndex),
            },
          };
        } else {
          // Normalize Segments 格式
          return {
            geometry: {
              type: 'LineString',
              coordinates: coordinates,
            },
            properties: {
              tags: seg.way_properties?.tags || {},
              name: seg.name,
              station_weights: seg.station_weights, // 傳遞 station_weights
              nav_weight:
                seg.nav_weight != null && Number.isFinite(Number(seg.nav_weight))
                  ? Number(seg.nav_weight)
                  : 1,
              original_points: seg.original_points || seg.points, // 傳遞原始點用於計算距離
              points: seg.points, // 傳遞 points 用於計算距離
              l3_black_dot_reduced_weight_green: Boolean(seg.l3_black_dot_reduced_weight_green),
              _flatSegmentIndex: flatSegmentIndex,
              map_draw_row_index: resolveMapStyleExportRowIndexForSegment(seg, flatSegmentIndex),
            },
          };
        }
      });

      // 從 segments 中提取站點
      // 測試3：若已具 MapDrawn 匯出 JSON（processedJsonData），站點僅依該單一資料繪製，勿與 flatSegments 的 nodes／折線轉折混用
      const stationMap = new Map();
      const useTest3JsonStations =
        isTaipeiTest3BcdeLayerTab(layerTab) &&
        !isTaipeiTest3I3OrJ3LayerTab(layerTab) &&
        activeLayerForSegments &&
        isMapDrawnRoutesExportArray(activeLayerForSegments.processedJsonData);

      if (useTest3JsonStations) {
        const rows = activeLayerForSegments.processedJsonData;
        for (const row of rows) {
          const seg = row.segment || {};
          const routeColor = row.color;
          const addEndpoint = (pt) => {
            if (!pt || typeof pt !== 'object') return;
            const x = Number(pt.x_grid);
            const y = Number(pt.y_grid);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const k = `${x},${y}`;
            if (!stationMap.has(k)) {
              stationMap.set(k, {
                geometry: { type: 'Point', coordinates: [x, y] },
                properties: {
                  ...pt,
                  x_grid: x,
                  y_grid: y,
                  color: routeColor,
                  node_type: 'connect',
                },
                nodeType: 'connect',
              });
            }
          };
          addEndpoint(seg.start);
          addEndpoint(seg.end);
          for (const st of seg.stations || []) {
            const x = Number(st.x_grid);
            const y = Number(st.y_grid);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            const k = `${x},${y}`;
            const midIsConnect = String(st.node_type ?? '').trim() === 'connect';
            stationMap.set(k, {
              geometry: { type: 'Point', coordinates: [x, y] },
              properties: {
                ...st,
                x_grid: x,
                y_grid: y,
                color: routeColor,
                node_type: midIsConnect ? 'connect' : 'line',
              },
              nodeType: midIsConnect ? 'connect' : 'line',
            });
          }
        }
      } else {
        flatSegments.forEach((seg) => {
          // 檢查是否為 2-6/2-7/2-8/2-9/2-10/3-1/4-1/6-1 格式（points 為 [x, y, props]）
          const isHydratedFormat =
            seg.points &&
            seg.points.length > 0 &&
            Array.isArray(seg.points[0]) &&
            seg.points[0].length > 2;

          if (isHydratedFormat) {
            // 2-6/2-7/2-8/2-9/2-10/3-1/4-1/6-1 格式：從 points 陣列中提取端點屬性
            const pts = seg.points || [];
            if (pts.length > 0) {
              // 起點
              const startPt = pts[0];
              const [x1, y1] = Array.isArray(startPt)
                ? [startPt[0], startPt[1]]
                : [startPt.x || 0, startPt.y || 0];
              const startProps = Array.isArray(startPt) && startPt.length > 2 ? startPt[2] : {};
              const key1 = `${x1},${y1}`;
              if (!stationMap.has(key1)) {
                stationMap.set(key1, {
                  geometry: {
                    type: 'Point',
                    coordinates: [x1, y1],
                  },
                  properties: {
                    ...startProps,
                    x_grid: x1,
                    y_grid: y1,
                  },
                  nodeType: startProps.node_type || 'connect',
                });
              }

              // 終點
              if (pts.length > 1) {
                const endPt = pts[pts.length - 1];
                const [x2, y2] = Array.isArray(endPt)
                  ? [endPt[0], endPt[1]]
                  : [endPt.x || 0, endPt.y || 0];
                const endProps = Array.isArray(endPt) && endPt.length > 2 ? endPt[2] : {};
                const key2 = `${x2},${y2}`;
                if (!stationMap.has(key2)) {
                  stationMap.set(key2, {
                    geometry: {
                      type: 'Point',
                      coordinates: [x2, y2],
                    },
                    properties: {
                      ...endProps,
                      x_grid: x2,
                      y_grid: y2,
                    },
                    nodeType: endProps.node_type || 'connect',
                  });
                }
              }

              // 2-6/2-7/2-8/2-9/2-10/3-1/4-1/6-1 格式：提取所有中間點（只繪製真正的車站，不繪製幾何轉折點）
              // 對於 6-1 格式，points 數組中每個點都是 [x, y, props]，直接提取所有中間點的屬性
              // 對於其他格式，使用 original_points 和 original_nodes 來分佈中間站點
              if (pts.length > 2) {
                // 直接從 points 數組中提取所有中間點（跳過起點和終點）
                for (let i = 1; i < pts.length - 1; i++) {
                  const midPt = pts[i];
                  const [x, y] = Array.isArray(midPt)
                    ? [midPt[0], midPt[1]]
                    : [midPt.x || 0, midPt.y || 0];
                  const midFromPt = Array.isArray(midPt) && midPt.length > 2 ? midPt[2] : {};
                  const midFromNode =
                    seg.nodes?.[i] && typeof seg.nodes[i] === 'object' ? seg.nodes[i] : {};
                  const midProps = { ...midFromNode, ...midFromPt };
                  const key = `${x},${y}`;

                  // 判斷是否為真正的車站（不是幾何轉折點）
                  // 真正的車站：node_type === 'connect' 或有 station_name
                  // 不繪製：node_type === 'line' 的幾何轉折點
                  // taipei_h3：tags._forceDrawBlackDot（見 g3ToH3PlaceBlackStationsFromA3Rows）
                  const isRealStation =
                    midProps.node_type === 'connect' ||
                    midProps.station_name ||
                    midProps.tags?.station_name ||
                    midProps.tags?._forceDrawBlackDot;

                  // 只添加真正的車站（避免重複），不添加 node_type === 'line' 的幾何轉折點
                  if (!stationMap.has(key) && isRealStation) {
                    stationMap.set(key, {
                      geometry: {
                        type: 'Point',
                        coordinates: [x, y],
                      },
                      properties: {
                        ...midProps,
                        x_grid: x,
                        y_grid: y,
                      },
                      nodeType: midProps.node_type || 'line', // 保留原始 node_type
                    });
                  }
                }
              }

              // 如果沒有從 points 中提取到中間點，則使用 original_points 和 original_nodes 來分佈（兼容舊格式）
              if (
                seg.original_points &&
                Array.isArray(seg.original_points) &&
                seg.points &&
                Array.isArray(seg.points) &&
                seg.original_points.length > seg.points.length
              ) {
                const numStations = Math.max(0, seg.original_points.length - 2); // 減去起點和終點
                const originalNodes = seg.original_nodes || [];
                if (numStations > 0 && seg.points.length >= 2) {
                  // 計算路徑總長度
                  const dist = (p1, p2) => {
                    const x1 = Array.isArray(p1) ? p1[0] : p1.x || 0;
                    const y1 = Array.isArray(p1) ? p1[1] : p1.y || 0;
                    const x2 = Array.isArray(p2) ? p2[0] : p2.x || 0;
                    const y2 = Array.isArray(p2) ? p2[1] : p2.y || 0;
                    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
                  };

                  let totalLen = 0;
                  const segments = [];
                  for (let i = 0; i < seg.points.length - 1; i++) {
                    const d = dist(seg.points[i], seg.points[i + 1]);
                    totalLen += d;
                    segments.push({ len: d, p1: seg.points[i], p2: seg.points[i + 1] });
                  }

                  if (totalLen > 0) {
                    const stepDist = totalLen / (numStations + 1);
                    let currentTarget = stepDist;
                    let segIdx = 0;
                    let coveredLen = 0;

                    for (let i = 0; i < numStations; i++) {
                      // 計算對應的 original_points 索引（跳過起點，從 1 開始）
                      const originalIndex = i + 1;
                      // 優先從 original_points 中提取屬性（如果是 [x, y, props] 格式）
                      let nodeProps = {};
                      if (
                        seg.original_points[originalIndex] &&
                        Array.isArray(seg.original_points[originalIndex]) &&
                        seg.original_points[originalIndex].length > 2
                      ) {
                        nodeProps = seg.original_points[originalIndex][2] || {};
                      } else {
                        nodeProps = originalNodes[originalIndex] || {};
                      }

                      while (segIdx < segments.length) {
                        const segData = segments[segIdx];
                        if (coveredLen + segData.len >= currentTarget) {
                          const localDist = currentTarget - coveredLen;
                          const ratio = localDist / segData.len;
                          const p1x = Array.isArray(segData.p1) ? segData.p1[0] : segData.p1.x || 0;
                          const p1y = Array.isArray(segData.p1) ? segData.p1[1] : segData.p1.y || 0;
                          const p2x = Array.isArray(segData.p2) ? segData.p2[0] : segData.p2.x || 0;
                          const p2y = Array.isArray(segData.p2) ? segData.p2[1] : segData.p2.y || 0;
                          const nx = p1x + (p2x - p1x) * ratio;
                          const ny = p1y + (p2y - p1y) * ratio;
                          const key = `${nx},${ny}`;

                          // 判斷是否為真正的車站（不是幾何轉折點）
                          // 真正的車站：node_type === 'connect' 或有 station_name
                          // 不繪製：node_type === 'line' 的幾何轉折點
                          const isRealStation =
                            nodeProps.node_type === 'connect' ||
                            nodeProps.station_name ||
                            nodeProps.tags?.station_name;

                          // 只添加真正的車站（避免重複），不添加 node_type === 'line' 的幾何轉折點
                          if (!stationMap.has(key) && isRealStation) {
                            stationMap.set(key, {
                              geometry: {
                                type: 'Point',
                                coordinates: [nx, ny],
                              },
                              properties: {
                                ...nodeProps, // 使用 original_points 或 original_nodes 中的屬性
                                x_grid: nx,
                                y_grid: ny,
                              },
                              nodeType: nodeProps.node_type || 'line', // 保留原始 node_type
                            });
                          }
                          break;
                        } else {
                          coveredLen += segData.len;
                          segIdx++;
                        }
                      }
                      currentTarget += stepDist;
                    }
                  }
                }
              }
            }
          } else if (isZLayoutFormat) {
            // 2-3/2-4/2-5 格式：從 start_coord/end_coord 和 start_props/end_props 提取
            if (seg.start_coord && seg.start_props) {
              const [x, y] = seg.start_coord;
              const key = `${x},${y}`;
              if (!stationMap.has(key)) {
                stationMap.set(key, {
                  geometry: {
                    type: 'Point',
                    coordinates: [x, y],
                  },
                  properties: {
                    ...seg.start_props,
                    x_grid: x,
                    y_grid: y,
                  },
                  nodeType: seg.start_props.node_type || 'connect',
                });
              }
            }
            if (seg.end_coord && seg.end_props) {
              const [x, y] = seg.end_coord;
              const key = `${x},${y}`;
              if (!stationMap.has(key)) {
                stationMap.set(key, {
                  geometry: {
                    type: 'Point',
                    coordinates: [x, y],
                  },
                  properties: {
                    ...seg.end_props,
                    x_grid: x,
                    y_grid: y,
                  },
                  nodeType: seg.end_props.node_type || 'connect',
                });
              }
            }

            // 2-3/2-4/2-5 格式：在路徑上分佈中間站點（黑點）
            if (
              isZLayoutFormat &&
              seg.original_points &&
              Array.isArray(seg.original_points) &&
              seg.points &&
              Array.isArray(seg.points)
            ) {
              const numStations = Math.max(0, seg.original_points.length - 2); // 減去起點和終點
              const originalNodes = seg.original_nodes || [];
              if (numStations > 0 && seg.points.length >= 2) {
                // 計算路徑總長度
                const dist = (p1, p2) => {
                  // 支持 [x, y] 或 [x, y, props] 格式
                  const x1 = Array.isArray(p1) ? p1[0] : p1.x || 0;
                  const y1 = Array.isArray(p1) ? p1[1] : p1.y || 0;
                  const x2 = Array.isArray(p2) ? p2[0] : p2.x || 0;
                  const y2 = Array.isArray(p2) ? p2[1] : p2.y || 0;
                  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
                };

                let totalLen = 0;
                const segments = [];
                for (let i = 0; i < seg.points.length - 1; i++) {
                  const d = dist(seg.points[i], seg.points[i + 1]);
                  totalLen += d;
                  segments.push({ len: d, p1: seg.points[i], p2: seg.points[i + 1] });
                }

                if (totalLen > 0) {
                  const stepDist = totalLen / (numStations + 1);
                  let currentTarget = stepDist;
                  let segIdx = 0;
                  let coveredLen = 0;

                  for (let i = 0; i < numStations; i++) {
                    // 計算對應的 original_points 索引（跳過起點，從 1 開始）
                    const originalIndex = i + 1;
                    const nodeProps = originalNodes[originalIndex] || {};

                    while (segIdx < segments.length) {
                      const segData = segments[segIdx];
                      if (coveredLen + segData.len >= currentTarget) {
                        const localDist = currentTarget - coveredLen;
                        const ratio = localDist / segData.len;
                        // 支持 [x, y] 或 [x, y, props] 格式
                        const p1x = Array.isArray(segData.p1) ? segData.p1[0] : segData.p1.x || 0;
                        const p1y = Array.isArray(segData.p1) ? segData.p1[1] : segData.p1.y || 0;
                        const p2x = Array.isArray(segData.p2) ? segData.p2[0] : segData.p2.x || 0;
                        const p2y = Array.isArray(segData.p2) ? segData.p2[1] : segData.p2.y || 0;
                        const nx = p1x + (p2x - p1x) * ratio;
                        const ny = p1y + (p2y - p1y) * ratio;
                        const key = `${nx},${ny}`;

                        // 判斷是否為真正的車站（不是幾何轉折點）
                        // 真正的車站：node_type === 'connect' 或有 station_name
                        // 不繪製：node_type === 'line' 的幾何轉折點
                        const isRealStation =
                          nodeProps.node_type === 'connect' ||
                          nodeProps.station_name ||
                          nodeProps.tags?.station_name;

                        // 只添加真正的車站（避免重複），不添加 node_type === 'line' 的幾何轉折點
                        if (!stationMap.has(key) && isRealStation) {
                          stationMap.set(key, {
                            geometry: {
                              type: 'Point',
                              coordinates: [nx, ny],
                            },
                            properties: {
                              ...nodeProps, // 使用 original_nodes 中的屬性
                              x_grid: nx,
                              y_grid: ny,
                            },
                            nodeType: nodeProps.node_type || 'line', // 保留原始 node_type
                          });
                        }
                        break;
                      } else {
                        coveredLen += segData.len;
                        segIdx++;
                      }
                    }
                    currentTarget += stepDist;
                  }
                }
              }
            }
          } else if (
            seg.nodes &&
            Array.isArray(seg.nodes) &&
            seg.points &&
            Array.isArray(seg.points)
          ) {
            // 2-1 格式：從 nodes 陣列提取所有點（只繪製真正的車站，不繪製幾何轉折點）
            seg.points.forEach((point, index) => {
              const [x, y] = point;
              const nodeProps = seg.nodes[index] || {};
              // flip 後紅點位移：若有 display_x/display_y 則用於繪製紅點，線仍用 points
              const drawX = nodeProps.display_x ?? x;
              const drawY = nodeProps.display_y ?? y;
              const key = `${drawX},${drawY}`;

              // 判斷是否為真正的車站（不是幾何轉折點）
              // 真正的車站：node_type === 'connect' 或有 station_name
              // 不繪製：node_type === 'line' 的幾何轉折點
              // taipei_h3：g3→h3 插入之中段站帶 tags._forceDrawBlackDot（可无站名仍畫黑點）
              const isRealStation =
                nodeProps.node_type === 'connect' ||
                nodeProps.station_name ||
                nodeProps.tags?.station_name ||
                nodeProps.tags?._forceDrawBlackDot;

              // 只添加真正的車站（避免重複），不添加 node_type === 'line' 的幾何轉折點
              if (!stationMap.has(key) && isRealStation) {
                stationMap.set(key, {
                  geometry: {
                    type: 'Point',
                    coordinates: [drawX, drawY],
                  },
                  properties: {
                    ...nodeProps,
                    x_grid: drawX,
                    y_grid: drawY,
                  },
                  nodeType: nodeProps.node_type || 'line', // 用於區分 connect 和 line
                });
              }
            });
          } else {
            // 1-1, 1-2 格式：從 properties_start 和 properties_end 提取
            if (seg.properties_start) {
              const x = seg.properties_start.x_grid;
              const y = seg.properties_start.y_grid;
              const key = `${x},${y}`;
              if (!stationMap.has(key)) {
                stationMap.set(key, {
                  geometry: {
                    type: 'Point',
                    coordinates: [x, y],
                  },
                  properties: seg.properties_start,
                  nodeType: 'connect',
                });
              }
            }
            if (seg.properties_end) {
              const x = seg.properties_end.x_grid;
              const y = seg.properties_end.y_grid;
              const key = `${x},${y}`;
              if (!stationMap.has(key)) {
                stationMap.set(key, {
                  geometry: {
                    type: 'Point',
                    coordinates: [x, y],
                  },
                  properties: seg.properties_end,
                  nodeType: 'connect',
                });
              }
            }
          }
        });
      }
      stationFeatures = Array.from(stationMap.values());

      // taipei_d：路網／站點改在「縮減疊加網格」座標空間繪製（overlayRemovalMaps 由 execute_d_to_e_test 寫入 taipei_d）
      const tcLayerDraw = dataStore.findLayerById(layerTab);
      if (
        isTaipeiTestCDLayerTab(layerTab) &&
        tcLayerDraw?.minSpacingOverlayCell &&
        Number(tcLayerDraw.minSpacingOverlayCell.cellW) > 0 &&
        Number(tcLayerDraw.minSpacingOverlayCell.cellH) > 0
      ) {
        taipeiCReducedOverlayDraw = true;
        // 與 schematicPlotMapper／Control 表格 mapNetworkToSchematicPlotXY 一致（taipei_c 無 rm 時勿再 floor(g/cell)）
        reducedPlotMapper =
          createReducedSchematicPlotMapper(tcLayerDraw) || ((gx, gy) => [Number(gx), Number(gy)]);

        const mapCoordPair = (p) => {
          if (!Array.isArray(p) || p.length < 2) return p;
          const [nx, ny] = reducedPlotMapper(Number(p[0]), Number(p[1]));
          return p.length > 2 ? [nx, ny, p[2]] : [nx, ny];
        };

        const mapCoordArray = (arr) => {
          if (!Array.isArray(arr)) return arr;
          return arr.map(mapCoordPair);
        };

        routeFeatures = routeFeatures.map((f) => {
          const coords = f.geometry?.coordinates;
          if (!coords) return f;
          const isMulti =
            coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] !== 'number';
          const newCoords = isMulti
            ? coords.map((line) => mapCoordArray(line))
            : mapCoordArray(coords);
          return {
            ...f,
            geometry: { ...f.geometry, coordinates: newCoords },
            properties: {
              ...f.properties,
              original_points: f.properties.original_points
                ? mapCoordArray(f.properties.original_points)
                : f.properties.original_points,
              points: f.properties.points
                ? mapCoordArray(f.properties.points)
                : f.properties.points,
            },
          };
        });

        stationFeatures = stationFeatures.map((f) => {
          const [x, y] = f.geometry.coordinates;
          const [nx, ny] = reducedPlotMapper(Number(x), Number(y));
          return {
            ...f,
            geometry: { ...f.geometry, coordinates: [nx, ny] },
            properties: { ...f.properties, x_grid: nx, y_grid: ny },
          };
        });

        xMin = Infinity;
        xMax = -Infinity;
        yMin = Infinity;
        yMax = -Infinity;
        const addB = (x, y) => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          xMin = Math.min(xMin, x);
          xMax = Math.max(xMax, x);
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
        };
        routeFeatures.forEach((f) => {
          const coords = f.geometry?.coordinates;
          if (!coords) return;
          const isMulti =
            coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] !== 'number';
          if (isMulti) {
            coords.forEach((line) => {
              line.forEach((c) => addB(c[0], c[1]));
            });
          } else {
            coords.forEach((c) => addB(c[0], c[1]));
          }
        });
        stationFeatures.forEach((f) => {
          const c = f.geometry?.coordinates;
          if (c) addB(c[0], c[1]);
        });
        if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
          xMin = 0;
          xMax = 1;
          yMin = 0;
          yMax = 1;
        } else {
          // 縮減疊加繪圖時不加邊界 padding，避免多畫一圈「空」網格線
          const pad = taipeiCReducedOverlayDraw ? 0 : 1;
          xMin -= pad;
          xMax += pad;
          yMin -= pad;
          yMax += pad;
        }
        // taipei_c：縮減網格 ix′/iy′ 為 0…n−1 之稠密索引；畫滿每一欄／列（僅用幾何 bbox 會漏掉無頂點但保留的格）
        if (
          isTaipeiTestCLayerTab(layerTab) &&
          taipeiCReducedOverlayDraw &&
          !tcLayerDraw?.overlayShrinkApplyPending &&
          tcLayerDraw?.gridTooltipMaps?.collapseSortedX?.length &&
          tcLayerDraw?.gridTooltipMaps?.collapseSortedY?.length
        ) {
          const nx = tcLayerDraw.gridTooltipMaps.collapseSortedX.length;
          const ny = tcLayerDraw.gridTooltipMaps.collapseSortedY.length;
          xMin = -0.5;
          xMax = nx - 0.5;
          yMin = -0.5;
          yMax = ny - 0.5;
        }
      }
    } else {
      // GeoJSON 格式處理
      // 分離路線和站點
      routeFeatures = mapGeoJsonData.value.features.filter(
        (f) =>
          f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
      );
      stationFeatures = mapGeoJsonData.value.features.filter(
        (f) => f.geometry && f.geometry.type === 'Point'
      );

      // 計算邊界（使用網格座標）
      mapGeoJsonData.value.features.forEach((feature) => {
        if (!feature || !feature.geometry) return;
        const geom = feature.geometry;

        if (geom.type === 'Point') {
          const [x, y] = geom.coordinates;
          xMin = Math.min(xMin, x);
          xMax = Math.max(xMax, x);
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
        } else if (geom.type === 'LineString') {
          geom.coordinates.forEach((coord) => {
            const [x, y] = coord;
            xMin = Math.min(xMin, x);
            xMax = Math.max(xMax, x);
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
          });
        } else if (geom.type === 'MultiLineString') {
          geom.coordinates.forEach((line) => {
            line.forEach((coord) => {
              const [x, y] = coord;
              xMin = Math.min(xMin, x);
              xMax = Math.max(xMax, x);
              yMin = Math.min(yMin, y);
              yMax = Math.max(yMax, y);
            });
          });
        }
      });
    }

    /**
     * taipei_g：資料為整數格索引 (ix, iy)；路線／站點對齊格線交點 (ix, iy)。
     * 背景僅依軸刻度步長畫線（與刻度一致），不與縮減疊加繪圖、疊加網格對齊併用。
     */
    const overlayForSnap = taipeiCReducedOverlayDraw ? null : dataStore.shortestPairOverlayGrid;
    const useSchematicCellCenterGrid =
      isNormalizeFormat &&
      !taipeiCReducedOverlayDraw &&
      isTaipeiEfinalSpaceLayerTab(layerTab) &&
      !overlayForSnap;

    if (
      useSchematicCellCenterGrid &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax)
    ) {
      const gx0 = Math.floor(xMin);
      const gx1 = Math.ceil(xMax);
      const gy0 = Math.floor(yMin);
      const gy1 = Math.ceil(yMax);
      xMin = gx0;
      xMax = gx1 + 1;
      yMin = gy0;
      yMax = gy1 + 1;
    }

    /** taipei_g 邊緣欄／列最大權重（繪上／右緣前即算好，供比例尺與標籤共用） */
    const colWeightMax = new Map();
    const rowWeightMax = new Map();
    let taipeiFMinCellWFrac;
    let taipeiFMinCellHFrac;
    if (useSchematicCellCenterGrid && isTaipeiEfinalSpaceLayerTab(layerTab)) {
      const acc = accumulateTaipeiFColRowWeightMaxFromFeatures(routeFeatures);
      acc.colWeightMax.forEach((v, k) => colWeightMax.set(k, v));
      acc.rowWeightMax.forEach((v, k) => rowWeightMax.set(k, v));
    }

    // 權重比例格寬／滑鼠焦點縮放僅 taipei_g；taipei_f 固定等寬等高（僅檢視）
    const mouseZoomOn =
      useSchematicCellCenterGrid &&
      isTaipeiGOrHWeightLayer(layerTab) &&
      dataStore.taipeiFSpaceNetworkMouseZoom === true;
    if (mouseZoomOn) {
      const hh = taipeiFMouseZoomHover.value;
      const hx = Number.isFinite(hh.ix) ? hh.ix : null;
      const hy = Number.isFinite(hh.iy) ? hh.iy : null;
      colWeightMax.clear();
      rowWeightMax.clear();
      const nx = Math.max(0, Math.round(xMax - xMin));
      const ny = Math.max(0, Math.round(yMax - yMin));
      for (let j = 0; j < nx; j++) {
        const ix = xMin + j;
        const d = hx == null ? 999 : Math.abs(ix - hx);
        colWeightMax.set(ix, d <= 4 ? 5 - d : 1);
      }
      for (let j = 0; j < ny; j++) {
        const iy = yMin + j;
        const d = hy == null ? 999 : Math.abs(iy - hy);
        rowWeightMax.set(iy, d <= 4 ? 5 - d : 1);
      }
    }

    const taipeiFWeightScalingEffective = dataStore.taipeiFSpaceNetworkGridScaling !== false;
    const taipeiFApplyWeightPixelScaling =
      useSchematicCellCenterGrid &&
      isTaipeiGOrHWeightLayer(layerTab) &&
      (mouseZoomOn || taipeiFWeightScalingEffective);

    // 設定比例尺（網格座標）；taipei_g 且開啟權重放大時欄寬／列高依權重比例；否則等寬等高
    let xScale;
    let yScale;
    if (taipeiFApplyWeightPixelScaling) {
      const squareWeightsForScale = !mouseZoomOn;
      const xs = createTaipeiFWeightedXScale(
        xMin,
        xMax,
        margin.left,
        width,
        colWeightMax,
        squareWeightsForScale
      );
      const ys = createTaipeiFWeightedYScale(
        yMin,
        yMax,
        margin.top,
        height,
        rowWeightMax,
        squareWeightsForScale
      );
      xScale = xs.scale;
      yScale = ys.scale;
      taipeiFMinCellWFrac = xs.minCellWFrac;
      taipeiFMinCellHFrac = ys.minCellHFrac;
    } else if (
      isTaipeiTest3BcdeLayerTab(layerTab) &&
      dataStore.findLayerById(layerTab)?.squareGridCellsTaipeiTest3 === true
    ) {
      /** 測試3且 Control 選「正方形」：與版面網格測試3一致，依繪區寬高取 min 並置中 */
      const spanX = xMax - xMin;
      const spanY = yMax - yMin;
      const sx = spanX > 0 ? spanX : 1;
      const sy = spanY > 0 ? spanY : 1;
      const cellSize = Math.min(width / sx, height / sy);
      const gridW = sx * cellSize;
      const gridH = sy * cellSize;
      const gridLeft = margin.left + (width - gridW) / 2;
      const gridTop = margin.top + (height - gridH) / 2;
      xScale = d3
        .scaleLinear()
        .domain([xMin, xMax])
        .range([gridLeft, gridLeft + gridW]);
      yScale = d3
        .scaleLinear()
        .domain([yMax, yMin])
        .range([gridTop, gridTop + gridH]);
    } else {
      xScale = d3
        .scaleLinear()
        .domain([xMin, xMax])
        .range([margin.left, margin.left + width]);
      yScale = d3
        .scaleLinear()
        .domain([yMax, yMin])
        .range([margin.top, margin.top + height]);
    }

    if (useSchematicCellCenterGrid && isTaipeiEfinalSpaceLayerTab(layerTab)) {
      const bounds = {
        xSpan: xMax - xMin,
        ySpan: yMax - yMin,
        plotW: width,
        plotH: height,
      };
      if (taipeiFApplyWeightPixelScaling) {
        bounds.minCellWFrac = taipeiFMinCellWFrac;
        bounds.minCellHFrac = taipeiFMinCellHFrac;
      }
      dataStore.setSpaceNetworkSchematicPlotBounds(bounds);
    } else {
      dataStore.clearSpaceNetworkSchematicPlotBounds();
      dataStore.clearSpaceNetworkGridMinCellDimensions();
    }

    const offsetPathToSchematicCellCenters = (pathCoords) => pathCoords;

    /** 最小間距疊加網格 hover：taipei_c／d／e 有 minSpacingOverlayCell 且非縮減繪圖時，以 floor 算疊加格 */
    const minSpacingStLayer = dataStore.findLayerById(layerTab);
    let minSpacingOverlay = null;
    if (
      minSpacingStLayer &&
      isTaipeiTestCDELayerTab(layerTab) &&
      !taipeiCReducedOverlayDraw &&
      minSpacingStLayer.minSpacingOverlayCell &&
      Number(minSpacingStLayer.minSpacingOverlayCell.cellW) > 0 &&
      Number(minSpacingStLayer.minSpacingOverlayCell.cellH) > 0
    ) {
      minSpacingOverlay = {
        cellW: Number(minSpacingStLayer.minSpacingOverlayCell.cellW),
        cellH: Number(minSpacingStLayer.minSpacingOverlayCell.cellH),
      };
    }

    /** 等分網格座標 → 像素（滑鼠縮放時用於焦點欄／列索引，避免與權重比例尺循環） */
    const xPickLinear = d3
      .scaleLinear()
      .domain([xMin, xMax])
      .range([margin.left, margin.left + width]);
    const yPickLinear = d3
      .scaleLinear()
      .domain([yMax, yMin])
      .range([margin.top, margin.top + height]);

    /** 疊加與縮減數字相同時：避免誤以為未執行 b→c／縮減 */
    const eventToNetworkXY = (event) => {
      const t = d3.zoomTransform(svg.node());
      const [mouseX, mouseY] = d3.pointer(event, svg.node());
      const lx = (mouseX - t.x) / t.k;
      const ly = (mouseY - t.y) / t.k;
      return [xScale.invert(lx), yScale.invert(ly)];
    };

    const minSpacingInline = (gx, gy) => {
      const rm = minSpacingStLayer?.overlayRemovalMaps;
      const gtm = minSpacingStLayer?.gridTooltipMaps;
      if (taipeiCReducedOverlayDraw) {
        const ix = Math.round(Number(gx));
        const iy = Math.round(Number(gy));
        if (rm?.mapX) {
          const ov = overlayCoordsBeforeRemovalFromReduced(ix, iy, rm);
          if (ov && (ov[0] !== ix || ov[1] !== iy)) {
            return ` <span style="color:#c9f">[刪空前疊加 ${ov[0]},${ov[1]}] <span style="color:#a8f">[縮減 ${ix},${iy}]</span></span>`;
          }
          return ` <span style="color:#c9f">[縮減 ${ix},${iy}]</span>`;
        }
        const pair = gtm ? overlayReducedTooltipPair(ix, iy, gtm) : null;
        const ov = pair?.overlay;
        const red = pair?.reduced ?? [ix, iy];
        if (ov && (ov[0] !== red[0] || ov[1] !== red[1])) {
          return ` <span style="color:#c9f">[刪空／塌縮前 ${ov[0]},${ov[1]}] <span style="color:#a8f">[縮減 ${red[0]},${red[1]}]</span></span>`;
        }
        return ` <span style="color:#c9f">[縮減 ${red[0]},${red[1]}]</span>`;
      }
      if (!minSpacingOverlay) return '';
      const c = networkCoordToMinSpacingOverlayCell(
        gx,
        gy,
        minSpacingOverlay.cellW,
        minSpacingOverlay.cellH
      );
      if (!c) return '';
      const red = rm?.mapX ? remapOverlayCellAfterRemoval(c.ix, c.iy, rm) : null;
      return red && (red[0] !== c.ix || red[1] !== c.iy)
        ? ` <span style="color:#c9f">[疊加 ${c.ix},${c.iy}] <span style="color:#a8f">[縮減疊加 ${red[0]},${red[1]}]</span></span>`
        : ` <span style="color:#c9f">[疊加 ${c.ix},${c.iy}]</span>`;
    };

    /**
     * @param {'full' | 'supplementOnly'} mode — supplementOnly：主行已標「縮減網格索引」，此處僅在與刪空前不同時補一行對照
     */
    const minSpacingTooltipBlock = (gx, gy, mode = 'full') => {
      const supplementOnly = mode === 'supplementOnly';
      const rm = minSpacingStLayer?.overlayRemovalMaps;
      const gtm = minSpacingStLayer?.gridTooltipMaps;
      if (taipeiCReducedOverlayDraw) {
        const ix = Math.round(Number(gx));
        const iy = Math.round(Number(gy));
        if (rm?.mapX) {
          const ov = overlayCoordsBeforeRemovalFromReduced(ix, iy, rm);
          if (supplementOnly) {
            if (!ov || (ov[0] === ix && ov[1] === iy)) return '';
            return `<br><strong>刪空列／行前疊加 (ix, iy):</strong> (${ov[0]}, ${ov[1]})`;
          }
          let block = `<br><strong>縮減網格索引 (ix′, iy′):</strong> (${ix}, ${iy})`;
          if (ov && (ov[0] !== ix || ov[1] !== iy)) {
            block = `<br><strong>刪空列／行前疊加 (ix, iy):</strong> (${ov[0]}, ${ov[1]})` + block;
          }
          return block;
        }
        const pair = gtm ? overlayReducedTooltipPair(ix, iy, gtm) : null;
        const ov = pair?.overlay;
        const red = pair?.reduced ?? [ix, iy];
        if (supplementOnly) {
          if (!ov || (ov[0] === red[0] && ov[1] === red[1])) return '';
          return `<br><strong>刪空／塌縮前疊加 (ix, iy):</strong> (${ov[0]}, ${ov[1]})`;
        }
        let block = `<br><strong>縮減網格索引 (ix′, iy′):</strong> (${red[0]}, ${red[1]})`;
        if (ov && (ov[0] !== red[0] || ov[1] !== red[1])) {
          block = `<br><strong>刪空／塌縮前疊加 (ix, iy):</strong> (${ov[0]}, ${ov[1]})` + block;
        }
        return block;
      }
      if (!minSpacingOverlay) return '';
      const c = networkCoordToMinSpacingOverlayCell(
        gx,
        gy,
        minSpacingOverlay.cellW,
        minSpacingOverlay.cellH
      );
      if (!c) return '';
      const red = rm?.mapX ? remapOverlayCellAfterRemoval(c.ix, c.iy, rm) : null;
      let block = `<br><strong>疊加網格座標 (ix, iy):</strong> (${c.ix}, ${c.iy})`;
      if (red && (red[0] !== c.ix || red[1] !== c.iy)) {
        block += `<br><strong>縮減疊加網格座標 (ix′, iy′):</strong> (${red[0]}, ${red[1]})`;
      }
      return block;
    };

    // 🔍 設置縮放行為
    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 10]) // 縮放範圍：0.1x 到 10x
      .on('zoom', (event) => {
        zoomGroup.attr('transform', event.transform);
        if (useSchematicCellCenterGrid && isTaipeiEfinalSpaceLayerTab(layerTab)) {
          refreshSpaceNetworkMinCellDimensions();
        }
      });

    // 將縮放行為應用到 SVG
    svg.call(zoom);
    if (savedTaipeiFZoomTransform != null && isTaipeiEfinalSpaceLayerTab(layerTab)) {
      svg.call(zoom.transform, savedTaipeiFZoomTransform);
    }
    savedTaipeiFZoomTransform = null;
    if (useSchematicCellCenterGrid && isTaipeiEfinalSpaceLayerTab(layerTab)) {
      refreshSpaceNetworkMinCellDimensions();
    }

    // taipei_f／g：同步滑鼠網格座標到 dataStore（與 LayoutGridTab_Test4 同源）。
    // 其餘 map 圖層在 store「顯示滑鼠網格座標」開啟時亦同步，供 Control「空間網路圖」專區顯示。
    svg.on('mousemove.spaceNetworkFGridCoord', null);
    svg.on('mouseleave.spaceNetworkFGridCoord', null);
    const excludedMouseCoordLayers =
      layerTab === 'taipei_6_1_test3' || layerTab === 'taipei_6_1_test4';
    const showSpaceNetworkMouseGridCoord = dataStore.spaceNetworkGridShowMouseGridCoordinate;

    if (isTaipeiEfinalSpaceLayerTab(layerTab)) {
      svg
        .on('mousemove.spaceNetworkFGridCoord', function (event) {
          let roundedGridX;
          let roundedGridY;
          if (mouseZoomOn) {
            const t = d3.zoomTransform(svg.node());
            const [mouseX, mouseY] = d3.pointer(event, svg.node());
            const lx = (mouseX - t.x) / t.k;
            const ly = (mouseY - t.y) / t.k;
            const gxL = xPickLinear.invert(lx);
            const gyL = yPickLinear.invert(ly);
            roundedGridX = Math.round(gxL);
            roundedGridY = Math.round(gyL);
            const nx = Math.max(0, Math.round(xMax - xMin));
            const ny = Math.max(0, Math.round(yMax - yMin));
            const inGrid =
              nx > 0 &&
              ny > 0 &&
              roundedGridX >= xMin &&
              roundedGridX <= xMin + nx - 1 &&
              roundedGridY >= yMin &&
              roundedGridY <= yMin + ny - 1;
            const nix = inGrid ? roundedGridX : null;
            const niy = inGrid ? roundedGridY : null;
            const prev = taipeiFMouseZoomHover.value;
            if (prev.ix !== nix || prev.iy !== niy) {
              taipeiFMouseZoomHover.value = { ix: nix, iy: niy };
              scheduleTaipeiFDrawForMouseZoom();
            }
          } else {
            const [gx, gy] = eventToNetworkXY(event);
            roundedGridX = Math.round(gx);
            roundedGridY = Math.round(gy);
          }
          if (
            roundedGridX >= Math.floor(xMin) - 1 &&
            roundedGridX <= Math.ceil(xMax) + 1 &&
            roundedGridY >= Math.floor(yMin) - 1 &&
            roundedGridY <= Math.ceil(yMax) + 1
          ) {
            dataStore.updateLayoutGridTabTest4MouseGridCoordinate(roundedGridX, roundedGridY);
          } else {
            dataStore.clearLayoutGridTabTest4MouseGridCoordinate();
          }
        })
        .on('mouseleave.spaceNetworkFGridCoord', function () {
          dataStore.clearLayoutGridTabTest4MouseGridCoordinate();
          if (mouseZoomOn) {
            const prev = taipeiFMouseZoomHover.value;
            if (prev.ix != null || prev.iy != null) {
              taipeiFMouseZoomHover.value = { ix: null, iy: null };
              scheduleTaipeiFDrawForMouseZoom();
            }
          }
        });
    } else if (
      showSpaceNetworkMouseGridCoord &&
      isMapLayer(layerTab) &&
      !excludedMouseCoordLayers
    ) {
      svg
        .on('mousemove.spaceNetworkFGridCoord', function (event) {
          const [gx, gy] = eventToNetworkXY(event);
          const roundedGridX = Math.round(gx);
          const roundedGridY = Math.round(gy);
          if (
            roundedGridX >= Math.floor(xMin) - 1 &&
            roundedGridX <= Math.ceil(xMax) + 1 &&
            roundedGridY >= Math.floor(yMin) - 1 &&
            roundedGridY <= Math.ceil(yMax) + 1
          ) {
            dataStore.updateLayoutGridTabTest4MouseGridCoordinate(roundedGridX, roundedGridY);
          } else {
            dataStore.clearLayoutGridTabTest4MouseGridCoordinate();
          }
        })
        .on('mouseleave.spaceNetworkFGridCoord', function () {
          dataStore.clearLayoutGridTabTest4MouseGridCoordinate();
        });
    } else if (!excludedMouseCoordLayers) {
      dataStore.clearLayoutGridTabTest4MouseGridCoordinate();
    }

    // 🎯 繪製邊界外框
    const borderGroup = zoomGroup.append('g').attr('class', 'border-group');
    borderGroup
      .append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('stroke', '#333333')
      .attr('stroke-width', 2);

    // 計算網格間距（根據座標範圍自動調整）
    const xRange = xMax - xMin;
    const yRange = yMax - yMin;

    /** taipei_d3／e3／…、`json_grid_coord_normalized`／衍生正交層：整數座標系，背景與軸每 1 單位一條線／一個刻度（每格一線） */
    const isTaipeiD3CoordNormalizeLayer =
      layerTab === 'taipei_d3' ||
      layerTab === 'taipei_sn4_d' ||
      layerTab === 'taipei_e3' ||
      layerTab === 'taipei_sn4_e' ||
      layerTab === 'taipei_f3' ||
      layerTab === 'taipei_sn4_f' ||
      layerTab === 'taipei_g3' ||
      layerTab === 'taipei_sn4_g' ||
      layerTab === 'taipei_h3' ||
      layerTab === 'taipei_sn4_h' ||
      layerTab === 'taipei_d3_dp' ||
      layerTab === 'taipei_e3_dp' ||
      layerTab === 'taipei_f3_dp' ||
      layerTab === 'taipei_g3_dp' ||
      layerTab === 'taipei_h3_dp' ||
      layerTab === 'taipei_d3_dp_2' ||
      layerTab === 'taipei_e3_dp_2' ||
      layerTab === 'taipei_f3_dp_2' ||
      layerTab === 'taipei_g3_dp_2' ||
      layerTab === 'taipei_h3_dp_2' ||
      layerTab === JSON_GRID_COORD_NORMALIZED_LAYER_ID ||
      layerTab === POINT_ORTHOGONAL_LAYER_ID ||
      layerTab === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
      isLineOrthogonalTowardCenterLayerId(layerTab) ||
      isSpaceGridVhDrawFamilyLayerId(layerTab) ||
      isTaipeiTest3I3OrJ3LayerTab(layerTab);

    /** 經緯度或小範圍連續座標：整數步長會變成 1 導致刻度迴圈為空，改以 d3.ticks 產生網格與軸刻度 */
    const preferContinuousGridTicks =
      !isTaipeiD3CoordNormalizeLayer &&
      !taipeiCReducedOverlayDraw &&
      !useSchematicCellCenterGrid &&
      Number.isFinite(xRange) &&
      Number.isFinite(yRange) &&
      xRange > 1e-9 &&
      yRange > 1e-9 &&
      Math.max(xRange, yRange) <= 30;

    const layoutUniformTickOverride = isSpaceLayoutUniformGridViewerLayerId(layerTab)
      ? buildLayoutViewerUniformAxisTicks(dataStore.findLayerById(layerTab)?.layoutUniformGridMeta)
      : null;

    // 縮減疊加／taipei_g：背景與軸皆每個整數一條線／一個刻度；其餘圖層網格與軸標籤可抽稀（粗步長為 5 的倍數）
    const xGridStep = isTaipeiD3CoordNormalizeLayer
      ? 1
      : taipeiCReducedOverlayDraw || useSchematicCellCenterGrid
        ? 1
        : snapCoarseGridStepToMultipleOf5(Math.max(1, Math.ceil(xRange / 15)));
    const yGridStep = isTaipeiD3CoordNormalizeLayer
      ? 1
      : taipeiCReducedOverlayDraw || useSchematicCellCenterGrid
        ? 1
        : snapCoarseGridStepToMultipleOf5(Math.max(1, Math.ceil(yRange / 15)));
    const tickXStep = isTaipeiD3CoordNormalizeLayer
      ? 1
      : taipeiCReducedOverlayDraw
        ? snapCoarseGridStepToMultipleOf5(Math.max(1, Math.ceil(xRange / 15)))
        : useSchematicCellCenterGrid
          ? 1
          : xGridStep;
    const tickYStep = isTaipeiD3CoordNormalizeLayer
      ? 1
      : taipeiCReducedOverlayDraw
        ? snapCoarseGridStepToMultipleOf5(Math.max(1, Math.ceil(yRange / 15)))
        : useSchematicCellCenterGrid
          ? 1
          : yGridStep;

    // 軸／網格共用刻度位置（json 繪製均勻格：與 meta 對齊；taipei_g：整數格；連續座標：nice step；其餘：抽稀）
    const xTicks = [];
    const yTicks = [];
    let xAxisLabelsAsFloat = false;
    let yAxisLabelsAsFloat = false;

    if (layoutUniformTickOverride) {
      xTicks.push(...layoutUniformTickOverride.xTicks);
      yTicks.push(...layoutUniformTickOverride.yTicks);
      xAxisLabelsAsFloat = layoutUniformTickOverride.xLabelsAsFloat;
      yAxisLabelsAsFloat = layoutUniformTickOverride.yLabelsAsFloat;
    } else if (useSchematicCellCenterGrid) {
      for (let tx = Math.ceil(xMin / tickXStep) * tickXStep; tx <= xMax; tx += tickXStep) {
        xTicks.push(tx);
      }
      for (let ty = Math.ceil(yMin / tickYStep) * tickYStep; ty <= yMax; ty += tickYStep) {
        yTicks.push(ty);
      }
    } else if (preferContinuousGridTicks) {
      const xTickStep = niceTickStepMultipleOf5(xRange, 10);
      const yTickStep = niceTickStepMultipleOf5(yRange, 8);
      xTicks.push(...buildTicksInRange(xMin, xMax, xTickStep));
      yTicks.push(...buildTicksInRange(yMin, yMax, yTickStep));
      xAxisLabelsAsFloat = true;
      yAxisLabelsAsFloat = true;
    } else {
      for (let x = Math.ceil(xMin / tickXStep) * tickXStep; x <= xMax; x += tickXStep) {
        xTicks.push(x);
      }
      for (let y = Math.ceil(yMin / tickYStep) * tickYStep; y <= yMax; y += tickYStep) {
        yTicks.push(y);
      }
    }

    const skipDefaultLightBackgroundGrid = Boolean(
      layoutUniformTickOverride?.skipDefaultBackgroundGrid
    );

    // 🎯 繪製淺灰色網格線（在背景層）；json 繪製疊均勻格時略過以免與自訂直角格重疊
    const gridGroup = zoomGroup.append('g').attr('class', 'grid-group');

    if (!skipDefaultLightBackgroundGrid) {
      if (useSchematicCellCenterGrid) {
        if (dataStore.showGrid) {
          xTicks.forEach((tick) => {
            const xPos = xScale(tick);
            gridGroup
              .append('line')
              .attr('x1', xPos)
              .attr('y1', margin.top)
              .attr('x2', xPos)
              .attr('y2', margin.top + height)
              .attr('stroke', '#E0E0E0')
              .attr('stroke-width', 0.5)
              .attr('opacity', 0.6);
          });
          yTicks.forEach((tick) => {
            const yPos = yScale(tick);
            gridGroup
              .append('line')
              .attr('x1', margin.left)
              .attr('y1', yPos)
              .attr('x2', margin.left + width)
              .attr('y2', yPos)
              .attr('stroke', '#E0E0E0')
              .attr('stroke-width', 0.5)
              .attr('opacity', 0.6);
          });
        }
      } else {
        xTicks.forEach((tick) => {
          const xPos = xScale(tick);
          gridGroup
            .append('line')
            .attr('x1', xPos)
            .attr('y1', margin.top)
            .attr('x2', xPos)
            .attr('y2', margin.top + height)
            .attr('stroke', '#E0E0E0')
            .attr('stroke-width', 0.5)
            .attr('opacity', 0.6);
        });
        yTicks.forEach((tick) => {
          const yPos = yScale(tick);
          gridGroup
            .append('line')
            .attr('x1', margin.left)
            .attr('y1', yPos)
            .attr('x2', margin.left + width)
            .attr('y2', yPos)
            .attr('stroke', '#E0E0E0')
            .attr('stroke-width', 0.5)
            .attr('opacity', 0.6);
        });
      }
    }

    // 將網格線移到最底層
    gridGroup.lower();

    // 疊加縮減預覽：高亮目前步驟「會保留」的整欄或整列（刪空前 ix／iy）
    const shrinkStrip = dataStore.highlightedOverlayShrinkStrip;
    if (
      shrinkStrip &&
      shrinkStrip.layerId === layerTab &&
      (shrinkStrip.kind === 'col' || shrinkStrip.kind === 'row') &&
      Number.isFinite(shrinkStrip.index)
    ) {
      const stripG = zoomGroup.append('g').attr('class', 'overlay-shrink-strip-highlight');
      const si = shrinkStrip.index;
      if (shrinkStrip.kind === 'col') {
        const xa = useSchematicCellCenterGrid ? xScale(si) : xScale(si - 0.5);
        const xb = useSchematicCellCenterGrid ? xScale(si + 1) : xScale(si + 0.5);
        const left = Math.min(xa, xb);
        const rw = Math.abs(xb - xa);
        stripG
          .append('rect')
          .attr('x', left)
          .attr('y', margin.top)
          .attr('width', rw)
          .attr('height', height)
          .attr('fill', 'rgba(180, 100, 255, 0.2)')
          .attr('stroke', 'rgba(120, 50, 200, 0.55)')
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none');
      } else {
        const ya = useSchematicCellCenterGrid ? yScale(si) : yScale(si - 0.5);
        const yb = useSchematicCellCenterGrid ? yScale(si + 1) : yScale(si + 0.5);
        const top = Math.min(ya, yb);
        const rh = Math.abs(yb - ya);
        stripG
          .append('rect')
          .attr('x', margin.left)
          .attr('y', top)
          .attr('width', width)
          .attr('height', rh)
          .attr('fill', 'rgba(180, 100, 255, 0.2)')
          .attr('stroke', 'rgba(120, 50, 200, 0.55)')
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none');
      }
    }

    const layoutVhDrawOrthoBlackMax = isLayoutNetworkGridFromVhDrawLayerId(layerTab)
      ? buildLayoutNetworkVhDrawMaxBlackDotsPerOrthoLine(dataStore, routeFeatures, xScale, yScale)
      : null;

    // 🎯 繪製座標軸和刻度（在邊界外）
    const axisGroup = zoomGroup.append('g').attr('class', 'axis-group');

    // X軸刻度（taipei_g：標籤在格線座標 tick，與路線／站點一致）
    xTicks.forEach((tick) => {
      const xPos = xScale(tick);

      // 繪製刻度線（在底部邊界外）
      axisGroup
        .append('line')
        .attr('x1', xPos)
        .attr('y1', margin.top + height)
        .attr('x2', xPos)
        .attr('y2', margin.top + height + 5)
        .attr('stroke', '#666666')
        .attr('stroke-width', 1);

      // 繪製刻度標籤（layout_network_grid_from_vh_draw：列／垂直線之黑點區間標註繪於相鄰刻度之間）
      const xTickLabel = formatAxisTickLabelMaxTwoDecimals(tick, xAxisLabelsAsFloat);
      axisGroup
        .append('text')
        .attr('x', xPos)
        .attr('y', margin.top + height + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#666666')
        .text(xTickLabel);
    });

    if (layoutVhDrawOrthoBlackMax && xTicks.length >= 2) {
      for (let xi = 0; xi < xTicks.length - 1; xi++) {
        const t0 = xTicks[xi];
        const t1 = xTicks[xi + 1];
        const xv = maxLayoutVhDrawBlackDotsOnLegInOpenXSlab(
          layoutVhDrawOrthoBlackMax.dotsForBandMax ?? [],
          t0,
          t1
        );
        const cx = (xScale(t0) + xScale(t1)) / 2;
        axisGroup
          .append('text')
          .attr('class', 'layout-vh-draw-axis-interval-black-max-x')
          .attr('x', cx)
          .attr('y', margin.top + height + 28)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('font-weight', '600')
          .attr('fill', '#1565C0')
          .text(`垂直 max ${xv}`);
      }
    }

    // Y軸刻度
    yTicks.forEach((tick) => {
      const yPos = yScale(tick);

      // 繪製刻度線（在左側邊界外）
      axisGroup
        .append('line')
        .attr('x1', margin.left)
        .attr('y1', yPos)
        .attr('x2', margin.left - 5)
        .attr('y2', yPos)
        .attr('stroke', '#666666')
        .attr('stroke-width', 1);

      // 繪製刻度標籤（layout_network_grid_from_vh_draw：欄／水平線之黑點區間標註繪於相鄰刻度之間）
      const yTickLabel = formatAxisTickLabelMaxTwoDecimals(tick, yAxisLabelsAsFloat);
      axisGroup
        .append('text')
        .attr('x', margin.left - 8)
        .attr('y', yPos)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#666666')
        .text(yTickLabel);
    });

    if (layoutVhDrawOrthoBlackMax && yTicks.length >= 2) {
      const yBandLabelX = margin.left - 46;
      for (let yi = 0; yi < yTicks.length - 1; yi++) {
        const t0 = yTicks[yi];
        const t1 = yTicks[yi + 1];
        const yv = maxLayoutVhDrawBlackDotsOnLegInOpenYSlab(
          layoutVhDrawOrthoBlackMax.dotsForBandMax ?? [],
          t0,
          t1
        );
        const cy = (yScale(t0) + yScale(t1)) / 2;
        axisGroup
          .append('text')
          .attr('class', 'layout-vh-draw-axis-interval-black-max-y')
          .attr('x', yBandLabelX)
          .attr('y', cy)
          .attr('text-anchor', 'end')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', '9px')
          .attr('font-weight', '600')
          .attr('fill', '#1565C0')
          .text(`水平 max ${yv}`);
      }
    }

    // 創建線條生成器
    const lineGenerator = d3
      .line()
      .x((d) => xScale(d[0]))
      .y((d) => yScale(d[1]))
      .curve(d3.curveLinear);

    /** taipei_h2 導航：僅由 store 寫入 station_weights（路徑 10／其餘 0），此處不畫額外 highlight */
    const matchH2TrafficConnect = () => false;
    const matchH2TrafficBlack = () => false;

    // 疊加網格時：將紅點（交叉點）對齊到所在疊加網格單元中心
    // 縮減疊加格繪圖時座標已是格索引空間，不可再套用 shortestPair 疊加網格位移
    const overlayCellCenter = (gx, gy) => {
      if (!overlayForSnap || overlayForSnap.xLength <= 0 || overlayForSnap.yLength <= 0)
        return [gx, gy];
      const ox = overlayForSnap.xLength;
      const oy = overlayForSnap.yLength;
      const cx = (Math.floor(gx / ox) + 0.5) * ox;
      const cy = (Math.floor(gy / oy) + 0.5) * oy;
      return [cx, cy];
    };
    // 黑點重分配：位移交叉點後，黑點在「兩交叉點之間」的新線段上平均配置（僅疊加網格開啟時用）
    const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
    /** 測試3：折線邊的端點度數；度數≤1 之 connect 為末端（藍），≥2 為交叉（紅）。i3／j3 用 h3 全路網計度（切段後子折線度數會誤判） */
    let taipeiTest3ConnectDegreeMap = null;
    let segmentsForTest3ConnectDegree = flatSegments;
    if (isTaipeiTest3I3OrJ3LayerTab(layerTab)) {
      const tab = layerTab;
      const h3LayerId =
        typeof tab === 'string' && tab.endsWith('_dp_2')
          ? 'taipei_h3_dp_2'
          : typeof tab === 'string' && tab.endsWith('_dp')
            ? 'taipei_h3_dp'
            : 'taipei_h3';
      const h3Layer = dataStore.findLayerById(h3LayerId);
      const h3Data = h3Layer?.spaceNetworkGridJsonData;
      if (Array.isArray(h3Data) && h3Data.length > 0) {
        try {
          segmentsForTest3ConnectDegree = normalizeSpaceNetworkDataToFlatSegments(h3Data);
        } catch {
          segmentsForTest3ConnectDegree = flatSegments;
        }
      }
    }
    if (
      isTaipeiTest3BcdeLayerTab(layerTab) &&
      Array.isArray(segmentsForTest3ConnectDegree) &&
      segmentsForTest3ConnectDegree.length > 0
    ) {
      taipeiTest3ConnectDegreeMap = new Map();
      const bumpDeg = (k) =>
        taipeiTest3ConnectDegreeMap.set(k, (taipeiTest3ConnectDegreeMap.get(k) || 0) + 1);
      const mapPt = reducedPlotMapper
        ? (gx, gy) => reducedPlotMapper(Number(gx), Number(gy))
        : (gx, gy) => [Number(gx), Number(gy)];
      for (const seg of segmentsForTest3ConnectDegree) {
        const pts = seg.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[i];
          const p1 = pts[i + 1];
          const ax = Array.isArray(p0) ? Number(p0[0]) : Number(p0?.x ?? 0);
          const ay = Array.isArray(p0) ? Number(p0[1]) : Number(p0?.y ?? 0);
          const bx = Array.isArray(p1) ? Number(p1[0]) : Number(p1?.x ?? 0);
          const by = Array.isArray(p1) ? Number(p1[1]) : Number(p1?.y ?? 0);
          const [x1, y1] = mapPt(ax, ay);
          const [x2, y2] = mapPt(bx, by);
          const k1 = key(x1, y1);
          const k2 = key(x2, y2);
          if (k1 === k2) continue;
          bumpDeg(k1);
          bumpDeg(k2);
        }
      }
    }
    const taipeiTest3ConnectFill = (isConn, lx, ly) => {
      if (!isConn || !taipeiTest3ConnectDegreeMap) return null;
      const deg = taipeiTest3ConnectDegreeMap.get(key(lx, ly)) ?? 0;
      if (deg <= 1) return '#1565c0';
      return null;
    };

    /** 與度數≤1 末端同色：資料若標 terminal／terminus 等，不依全路網度數強制紅（與 SpaceNetworkGridTabK3 一致） */
    const connectBlueFromTaggedTerminal = (props, tags) => {
      const p = props && typeof props === 'object' ? props : {};
      const t = tags && typeof tags === 'object' ? tags : {};
      const raw =
        p.type ?? t.type ?? p.connect_type ?? t.connect_type ?? p.station_type ?? t.station_type;
      const s = raw == null ? '' : String(raw).trim().toLowerCase();
      if (!s) return false;
      return (
        s === 'terminal' || s === 'terminus' || s === 'end' || s === 'endpoint' || s === 'line_end'
      );
    };

    const connectKeys = new Set(
      stationFeatures
        .filter((f) => f.nodeType === 'connect')
        .map((f) => key(f.geometry.coordinates[0], f.geometry.coordinates[1]))
    );
    const blackRedistributeMap = new Map(); // key(x,y) -> [newX, newY]
    // 路線座標轉換：疊加網格時，線也一起移動（紅點→網格中心，黑點→平均配置）
    const transformPathCoords = (pathCoords) => {
      if (!overlayForSnap || !Array.isArray(pathCoords) || pathCoords.length < 2) return pathCoords;
      const indices = pathCoords
        .map((c, i) => (connectKeys.has(key(c[0], c[1])) ? i : -1))
        .filter((i) => i >= 0);
      if (indices.length < 2) return pathCoords;
      const result = [];
      for (let s = 0; s < indices.length - 1; s++) {
        const i0 = indices[s];
        const i1 = indices[s + 1];
        const start = overlayCellCenter(pathCoords[i0][0], pathCoords[i0][1]);
        const end = overlayCellCenter(pathCoords[i1][0], pathCoords[i1][1]);
        const blacks = pathCoords.slice(i0 + 1, i1);
        const N = blacks.length;
        result.push(start);
        for (let idx = 0; idx < N; idx++) {
          const t = (idx + 1) / (N + 1);
          const nx = start[0] + t * (end[0] - start[0]);
          const ny = start[1] + t * (end[1] - start[1]);
          result.push([nx, ny]);
          blackRedistributeMap.set(key(blacks[idx][0], blacks[idx][1]), [nx, ny]);
        }
        if (s === indices.length - 2) result.push(end);
      }
      return result.length > 0 ? result : pathCoords;
    };

    // 計算兩點之間的距離
    const dist = (p1, p2) => {
      const dx = p1[0] - p2[0];
      const dy = p1[1] - p2[1];
      return Math.sqrt(dx * dx + dy * dy);
    };

    // 在折線上找到距離起點 target_dist 的座標
    const getPointAtDistance = (polyline, targetDist) => {
      if (targetDist <= 0) return polyline[0];
      let currentDist = 0;
      for (let i = 0; i < polyline.length - 1; i++) {
        const p1 = polyline[i];
        const p2 = polyline[i + 1];
        const segLen = dist(p1, p2);
        if (currentDist + segLen >= targetDist) {
          const remain = targetDist - currentDist;
          const ratio = segLen > 0 ? remain / segLen : 0;
          return [p1[0] + (p2[0] - p1[0]) * ratio, p1[1] + (p2[1] - p1[1]) * ratio];
        }
        currentDist += segLen;
      }
      return polyline[polyline.length - 1];
    };

    // 計算某個車站點在折線上的路徑距離
    const getStationDistOnPolyline = (stationPt, polyline) => {
      let bestDist = 0;
      let minDistSq = Infinity;
      let currentAccumulatedDist = 0;

      for (let i = 0; i < polyline.length - 1; i++) {
        const p1 = polyline[i];
        const p2 = polyline[i + 1];
        const segLen = dist(p1, p2);

        // 投影點到線段
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
          currentAccumulatedDist += segLen;
          continue;
        }

        const t = Math.max(
          0,
          Math.min(1, ((stationPt[0] - p1[0]) * dx + (stationPt[1] - p1[1]) * dy) / lenSq)
        );
        const projPt = [p1[0] + t * dx, p1[1] + t * dy];
        const dSq = (stationPt[0] - projPt[0]) ** 2 + (stationPt[1] - projPt[1]) ** 2;

        if (dSq < minDistSq) {
          minDistSq = dSq;
          bestDist = currentAccumulatedDist + segLen * t;
        }

        currentAccumulatedDist += segLen;
      }

      return bestDist;
    };

    /** 路線 tooltip：單一數值完整顯示（整數不帶小數；非整數保留必要位數） */
    const formatPathCoordNumber = (n) => {
      if (!Number.isFinite(n)) return '';
      const r = Math.round(n);
      if (Math.abs(n - r) < 1e-9) return String(r);
      return n.toFixed(10).replace(/\.?0+$/, '');
    };

    /** space-network-grid 分頁：路段匯出 stations 附錄（含格線／lon·lat；非 layout-viewer） */
    const tooltipHtmlSegmentStationsOrderedVerbose = (seg) => {
      if (!seg || typeof seg !== 'object') return '';
      const esc = (t) =>
        String(t ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      const ordered = [];
      if (seg.start) ordered.push(seg.start);
      if (Array.isArray(seg.stations)) {
        for (const s of seg.stations) ordered.push(s);
      }
      if (seg.end) ordered.push(seg.end);
      if (!ordered.length) return '';
      let h = `<br><strong>stations（依序）</strong> ${ordered.length}<br>`;
      ordered.forEach((n, idx) => {
        const lo = segmentNodeLon(n);
        const la = segmentNodeLat(n);
        let posFrag = '';
        if (Number.isFinite(lo) && Number.isFinite(la)) {
          posFrag = ` lon/lat (${formatPathCoordNumber(lo)}, ${formatPathCoordNumber(la)})`;
        }
        let gridFrag = '';
        if (Number.isFinite(Number(n.grid_simp_x)) && Number.isFinite(Number(n.grid_simp_y))) {
          gridFrag = ` · grid_simp (${n.grid_simp_x}, ${n.grid_simp_y})`;
        } else if (Number.isFinite(Number(n.grid_x)) && Number.isFinite(Number(n.grid_y))) {
          gridFrag = ` · grid (${n.grid_x}, ${n.grid_y})`;
        }
        h += `<strong>#${idx + 1}</strong>${posFrag}${gridFrag} · station_id ${esc(
          n.station_id ?? n.tags?.station_id ?? ''
        )} · station_name ${esc(n.station_name ?? n.tags?.station_name ?? n.tags?.name ?? '')}<br>`;
      });
      return h;
    };

    const routeStrokeScaleLinear = dataStore.showRouteThickness
      ? buildRouteWeightStrokeScaleLinear(collectWeightsFromGeoRouteFeatures(routeFeatures))
      : null;

    const drawRoutePath = (
      coords,
      tags,
      name,
      color,
      stationWeights,
      originalPoints,
      points,
      isHvZTest3E3F3Highlight = false,
      l3BlackDotReducedWeightGreen = false,
      routeFeatureRouteId = '',
      exportRowIndexHint = null
    ) => {
      // 與 MapTab 一致：tags.color／tags.colour，否則 feature.properties.color（如路段匯出列），預設 #666666
      const trimColour = (s) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : '');
      const routeColor =
        trimColour(tags?.colour) || trimColour(tags?.color) || trimColour(color) || '#666666';
      const pathData = lineGenerator(coords);
      if (!pathData) return;

      const baseStroke = isHvZTest3E3F3Highlight ? '#c2185b' : routeColor;

      const resolveWeightForRouteLineWidth = () => {
        if (Array.isArray(stationWeights) && stationWeights.length > 0) {
          let mx = 0;
          for (const w of stationWeights) {
            const n = Number(w?.weight);
            if (Number.isFinite(n) && n > mx) mx = n;
          }
          if (mx > 0) return mx;
        }
        const tw = Number(tags?.weight ?? tags?.route_weight ?? tags?.routeWeight);
        if (Number.isFinite(tw) && tw > 0) return tw;
        return 1;
      };

      const linePx =
        dataStore.showRouteThickness && routeStrokeScaleLinear
          ? strokeWidthPxFromWeightScale(routeStrokeScaleLinear, resolveWeightForRouteLineWidth())
          : null;
      const baseStrokeW =
        linePx != null ? formatStrokeWidthPx(linePx) : isHvZTest3E3F3Highlight ? 7 : 3;
      const hoverStrokeW =
        linePx != null ? formatStrokeWidthPx(linePx * 1.5) : isHvZTest3E3F3Highlight ? 9 : 5;

      let routeTooltipHtml = '';
      let routeTooltipAppendNearLine = true;

      const pathElement = zoomGroup
        .append('path')
        .attr('d', pathData)
        .attr('stroke', baseStroke)
        .attr('fill', 'none')
        .attr('stroke-width', baseStrokeW)
        .attr('opacity', 0.9)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .style('cursor', 'pointer');

      // 添加 hover 效果
      pathElement
        .on('mouseover', function (event) {
          d3.select(this).attr('stroke-width', hoverStrokeW).attr('opacity', 1);

          const buildLegacyLineTooltip = () => {
            let tooltipContent = '';
            if (name) {
              tooltipContent += `<strong>路線名稱:</strong> ${name}<br>`;
            }
            const interiorCoords = coords.length > 2 ? coords.slice(1, -1) : [];
            const fmt = (p) => {
              if (!p) return '';
              const gx = Number(p[0]);
              const gy = Number(p[1]);
              const show = `(${formatPathCoordNumber(gx)}, ${formatPathCoordNumber(gy)})`;
              return `${show}${minSpacingInline(gx, gy)}`;
            };
            tooltipContent += `<strong>這一個路段的轉折點數:</strong> ${interiorCoords.length}`;
            if (coords.length >= 2) {
              tooltipContent += `<br><strong>起點座標:</strong> ${fmt(coords[0])}<br><strong>終點座標:</strong> ${fmt(coords[coords.length - 1])}`;
            }
            if (interiorCoords.length > 0) {
              tooltipContent += `<br><strong>轉折點座標（依序）:</strong> ${interiorCoords.map((p) => fmt(p)).join('；')}`;
            } else if (coords.length >= 2) {
              tooltipContent += `<br><strong>轉折點座標:</strong> （無）`;
            }
            tooltipContent += '<br>';
            if (tags) {
              const tagsHtml = Object.entries(tags)
                .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
                .join('<br>');
              tooltipContent += tagsHtml || '無標籤資訊';
            }
            if (stationWeights && Array.isArray(stationWeights) && stationWeights.length > 0) {
              tooltipContent += '<br><strong>站間權重 (station_weights):</strong><br>';
              stationWeights.forEach((w, wi) => {
                const sw = w?.start_idx;
                const ew = w?.end_idx;
                const wt = w?.weight;
                tooltipContent += `  #${wi + 1} start_idx=${sw} → end_idx=${ew}，weight=${wt}<br>`;
              });
            }
            if (uniformGridRouteFamilyTab) {
              const jl = dataStore.findLayerById(layerTab);
              const jr =
                layoutUniformGridTooltipJr ??
                mapDrawnExportRowsFromJsonDrawRoot(jl?.jsonData, jl?.dataJson);
              if (Array.isArray(jr)) {
                const idxHint =
                  exportRowIndexHint != null && Number.isFinite(Number(exportRowIndexHint))
                    ? Number(exportRowIndexHint)
                    : null;
                let segMatch = null;
                if (
                  idxHint != null &&
                  idxHint >= 0 &&
                  idxHint < jr.length &&
                  jr[idxHint] &&
                  typeof jr[idxHint] === 'object'
                ) {
                  segMatch = jr[idxHint]?.segment ?? null;
                }
                const rid = routeFeatureRouteId != null ? String(routeFeatureRouteId) : '';
                const rnm = name != null ? String(name) : '';
                if (!segMatch && rid !== '') {
                  const hits = jr.filter((r) => r && String(r.route_id ?? '') === rid);
                  segMatch = hits.length === 1 ? (hits[0]?.segment ?? null) : null;
                }
                if (!segMatch && rnm !== '') {
                  const hitsNm = jr.filter((r) => r && String(r.routeName ?? '') === rnm);
                  segMatch = hitsNm.length === 1 ? (hitsNm[0]?.segment ?? null) : null;
                }
                if (segMatch) {
                  const jrFile = mapDrawnExportRowsFromJsonDrawRoot(jl?.jsonData, jl?.dataJson) ?? [];
                  const stationHoverPool = [
                    ...jrFile,
                    ...(Array.isArray(layoutUniformGridTooltipJr) ? layoutUniformGridTooltipJr : []),
                  ];
                  const segForTip = enrichExportRowStationsFromPool(
                    { segment: segMatch, routeName: rnm },
                    stationHoverPool,
                  ).segment;
                  tooltipContent += tooltipHtmlSegmentStationsOrderedVerbose(segForTip);
                }
              }
            }
            return tooltipContent || '無標籤資訊';
          };

          if (uniformGridRouteFamilyTab) {
            routeTooltipAppendNearLine = false;
            const jl = dataStore.findLayerById(layerTab);
            const jr =
              layoutUniformGridTooltipJr ??
              mapDrawnExportRowsFromJsonDrawRoot(jl?.jsonData, jl?.dataJson);
            let rowMatch = null;
            if (Array.isArray(jr)) {
              const idxHint =
                exportRowIndexHint != null && Number.isFinite(Number(exportRowIndexHint))
                  ? Number(exportRowIndexHint)
                  : null;
              if (
                idxHint != null &&
                idxHint >= 0 &&
                idxHint < jr.length &&
                jr[idxHint] &&
                typeof jr[idxHint] === 'object'
              ) {
                rowMatch = jr[idxHint];
              }
              const rid = routeFeatureRouteId != null ? String(routeFeatureRouteId) : '';
              const rnm = name != null ? String(name) : '';
              if (!rowMatch && rid !== '') {
                const hits = jr.filter((r) => r && String(r.route_id ?? '') === rid);
                rowMatch = hits.length === 1 ? hits[0] : null;
              }
              if (!rowMatch && rnm !== '') {
                const hitsNm = jr.filter((r) => r && String(r.routeName ?? '') === rnm);
                if (hitsNm.length === 1) {
                  rowMatch = hitsNm[0];
                } else if (
                  hitsNm.length > 1 &&
                  idxHint != null &&
                  idxHint >= 0 &&
                  idxHint < jr.length &&
                  jr[idxHint] &&
                  String(jr[idxHint]?.routeName ?? '') === rnm
                ) {
                  rowMatch = jr[idxHint];
                }
              }
            }
            if (rowMatch) {
              const jrFile = mapDrawnExportRowsFromJsonDrawRoot(jl?.jsonData, jl?.dataJson) ?? [];
              const stationHoverPool = [
                ...jrFile,
                ...(Array.isArray(layoutUniformGridTooltipJr) ? layoutUniformGridTooltipJr : []),
              ];
              const rowForTip = enrichExportRowStationsFromPool(rowMatch, stationHoverPool);
              const chain = expandLonLatChainFromRouteCoordinates(rowForTip.routeCoordinates);
              routeTooltipHtml = routeExportRowPolylineTooltipHtml(rowForTip, chain);
            } else {
              routeTooltipAppendNearLine = true;
              routeTooltipHtml = buildLegacyLineTooltip();
            }
          } else {
            routeTooltipAppendNearLine = true;
            routeTooltipHtml = buildLegacyLineTooltip();
          }

          tooltip
            .html(routeTooltipHtml)
            .style('opacity', 1)
            .style('left', event.pageX + 10 + 'px')
            .style('top', event.pageY - 10 + 'px');
        })
        .on('mousemove', function (event) {
          tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 10 + 'px');
          if (!routeTooltipAppendNearLine) return;
          if ((!minSpacingOverlay && !taipeiCReducedOverlayDraw) || !routeTooltipHtml) return;
          const [gx, gy] = eventToNetworkXY(event);
          const near = closestPointOnPolyline(coords, gx, gy);
          if (!near) return;
          const [qx, qy] = near;
          const nqx = qx;
          const nqy = qy;
          const nearCoordStr = `(${formatPathCoordNumber(nqx)}, ${formatPathCoordNumber(nqy)})`;
          const nearLine = `<br><strong>游標鄰近路徑點:</strong> ${nearCoordStr}${minSpacingTooltipBlock(nqx, nqy)}`;
          tooltip.html(routeTooltipHtml + nearLine);
        })
        .on('mouseout', function () {
          // 恢復路線樣式
          d3.select(this)
            .attr('stroke-width', baseStrokeW)
            .attr('opacity', 0.9)
            .attr('stroke', baseStroke);

          // 隱藏 tooltip
          tooltip.style('opacity', 0);
        });

      // 繪製 station_weights；示意格層依 showWeightLabels；與 K3 分頁共用 spaceNetworkGridShowRouteWeights
      if (
        stationWeights &&
        Array.isArray(stationWeights) &&
        stationWeights.length > 0 &&
        (!useSchematicCellCenterGrid || dataStore.showWeightLabels) &&
        dataStore.spaceNetworkGridShowRouteWeights
      ) {
        if (!Array.isArray(coords) || coords.length < 2) {
          /* skip weights */
        } else {
          const refPoints = originalPoints || points || coords;
          if (!Array.isArray(refPoints) || refPoints.length < 2) {
            /* skip */
          } else {
            const refCoords = refPoints
              .map((pt) => {
                if (Array.isArray(pt)) {
                  return pt.length >= 2 ? [pt[0], pt[1]] : null;
                }
                return pt && pt.x !== undefined && pt.y !== undefined ? [pt.x, pt.y] : null;
              })
              .filter((pt) => pt !== null);

            if (refCoords.length >= 2) {
              const stationDists = refCoords.map((pt) => getStationDistOnPolyline(pt, coords));
              const useL3MergedWeightGreenFill =
                (layerTab === 'taipei_sn4_l' || layerTab === 'taipei_sn4_m') &&
                l3BlackDotReducedWeightGreen;

              const appendWeightLabel = (px, py) => {
                const textGroup = zoomGroup.append('g').attr('class', 'edge-weight-label');
                textGroup
                  .append('text')
                  .attr('x', xScale(px))
                  .attr('y', yScale(py))
                  .attr('text-anchor', 'middle')
                  .attr('dominant-baseline', 'middle')
                  .attr('font-size', useSchematicCellCenterGrid ? '9px' : '7px')
                  .attr('font-weight', 'bold')
                  .attr('fill', useL3MergedWeightGreenFill ? '#0a8f2e' : '#1a1a1a')
                  .attr('stroke', useL3MergedWeightGreenFill ? '#f0fff4' : '#ffffff')
                  .attr('stroke-width', useL3MergedWeightGreenFill ? 0.55 : 0.4)
                  .attr('paint-order', 'stroke')
                  .style('pointer-events', 'none');
                return textGroup;
              };

              stationWeights.forEach((weightInfo) => {
                const { start_idx, end_idx, weight } = weightInfo;
                if (
                  typeof start_idx !== 'number' ||
                  typeof end_idx !== 'number' ||
                  start_idx < 0 ||
                  end_idx < 0 ||
                  start_idx >= stationDists.length ||
                  end_idx >= stationDists.length ||
                  start_idx >= end_idx
                ) {
                  return;
                }

                // 一律取「畫面上此路段折線」的弧長中點，權重數字落在路線上（含 taipei_g 格線座標）
                const startDist = stationDists[start_idx];
                const endDist = stationDists[end_idx];
                const midDist = (startDist + endDist) / 2;
                const midPoint = getPointAtDistance(coords, midDist);
                const [midX, midY] = midPoint;
                appendWeightLabel(midX, midY).select('text').text(String(weight));
              });
            }
          }
        }
      }
    };

    const hvTransformPath = (path) => path;

    const drawLayoutUniformGridLines = (coords) => {
      if (!Array.isArray(coords) || coords.length < 2) return;
      const transformed = offsetPathToSchematicCellCenters(
        hvTransformPath(transformPathCoords(coords))
      );
      const d = lineGenerator(transformed);
      if (!d) return;
      zoomGroup
        .append('path')
        .attr('d', d)
        .attr('class', 'layout-uniform-station-grid-line')
        .attr('stroke', '#5c6b7a')
        .attr('fill', 'none')
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('opacity', 0.88)
        .attr('stroke-linecap', 'round')
        .style('stroke-width', '1pt')
        .style('pointer-events', 'none');
    };

    // 均勻细分網格線（繪於路線之下）
    for (const uf of routeFeatures) {
      if (!uf || !uf.geometry || uf.geometry.type !== 'LineString') continue;
      const pq = uf.properties || {};
      if (pq.layoutUniformStationGrid !== true) continue;
      drawLayoutUniformGridLines(uf.geometry.coordinates);
    }

    const tabLyrRouteHl = dataStore.findLayerById(layerTab);
    const vhDrawRouteStrokeHlIdx =
      isSpaceGridVhDrawFamilyLayerId(layerTab) &&
      tabLyrRouteHl &&
      Array.isArray(tabLyrRouteHl.highlightedSegmentIndex) &&
      tabLyrRouteHl.highlightedSegmentIndex[0] === 'vhDrawRoute' &&
      Number.isFinite(Number(tabLyrRouteHl.highlightedSegmentIndex[1]))
        ? Number(tabLyrRouteHl.highlightedSegmentIndex[1])
        : null;

    // 繪製路線（支援 LineString / MultiLineString）；有疊加網格時線一起移動
    routeFeatures.forEach((feature) => {
      if (!feature || !feature.geometry) return;
      const props = feature.properties || {};
      if (props.layoutUniformStationGrid === true) return;
      const tags = props.tags || {};
      const geom = feature.geometry;
      const isHvZHl = false;

      const routeFeatId =
        props.route_id != null && props.route_id !== '' ? String(props.route_id) : '';
      const exportRowIdx =
        props.map_draw_row_index != null && Number.isFinite(Number(props.map_draw_row_index))
          ? Number(props.map_draw_row_index)
          : props.export_row_index != null && Number.isFinite(Number(props.export_row_index))
            ? Number(props.export_row_index)
            : null;

      const isVhDrawRouteHl =
        vhDrawRouteStrokeHlIdx != null &&
        exportRowIdx != null &&
        exportRowIdx === vhDrawRouteStrokeHlIdx;

      if (geom.type === 'LineString') {
        drawRoutePath(
          offsetPathToSchematicCellCenters(hvTransformPath(transformPathCoords(geom.coordinates))),
          tags,
          props.name,
          props.color,
          props.station_weights,
          props.original_points,
          props.points,
          isHvZHl || isVhDrawRouteHl,
          Boolean(props.l3_black_dot_reduced_weight_green),
          routeFeatId,
          exportRowIdx
        );
      } else if (geom.type === 'MultiLineString') {
        geom.coordinates.forEach((coords) => {
          drawRoutePath(
            offsetPathToSchematicCellCenters(hvTransformPath(transformPathCoords(coords))),
            tags,
            props.name,
            props.color,
            props.station_weights,
            props.original_points,
            props.points,
            isHvZHl || isVhDrawRouteHl,
            Boolean(props.l3_black_dot_reduced_weight_green),
            routeFeatId,
            exportRowIdx
          );
        });
      }
    });

    // taipei_f：欄高亮——垂直線 overlay（SectionData 路段紅色，其餘綠色；無 per-path 色則橘色）
    const colHl = dataStore.taipeiFColRouteHighlight;
    if (
      isTaipeiTestFLayerTab(layerTab) &&
      colHl &&
      colHl.layerId === layerTab &&
      Array.isArray(colHl.verticalPaths) &&
      colHl.verticalPaths.length > 0
    ) {
      const colHlG = zoomGroup.append('g').attr('class', 'taipei-f-col-vertical-highlight');
      colHl.verticalPaths.forEach((pathCoords, pi) => {
        if (!Array.isArray(pathCoords) || pathCoords.length < 2) return;
        const transformed = offsetPathToSchematicCellCenters(
          hvTransformPath(transformPathCoords(pathCoords))
        );
        const d = lineGenerator(transformed);
        if (!d) return;
        const stroke =
          Array.isArray(colHl.verticalPathColors) && colHl.verticalPathColors[pi]
            ? colHl.verticalPathColors[pi]
            : '#ff6600';
        colHlG
          .append('path')
          .attr('d', d)
          .attr('stroke', stroke)
          .attr('fill', 'none')
          .attr('stroke-width', 8)
          .attr('opacity', 0.65)
          .attr('stroke-linecap', 'round')
          .style('pointer-events', 'none');
      });
    }

    // taipei_f：列高亮——水平線 overlay（SectionData 紅／其他綠；無 per-path 色則青綠）
    const rowHl = dataStore.taipeiFRowRouteHighlight;
    if (
      isTaipeiTestFLayerTab(layerTab) &&
      rowHl &&
      rowHl.layerId === layerTab &&
      Array.isArray(rowHl.horizontalPaths) &&
      rowHl.horizontalPaths.length > 0
    ) {
      const rowHlG = zoomGroup.append('g').attr('class', 'taipei-f-row-horizontal-highlight');
      rowHl.horizontalPaths.forEach((pathCoords, pi) => {
        if (!Array.isArray(pathCoords) || pathCoords.length < 2) return;
        const transformed = offsetPathToSchematicCellCenters(
          hvTransformPath(transformPathCoords(pathCoords))
        );
        const dRow = lineGenerator(transformed);
        if (!dRow) return;
        const stroke =
          Array.isArray(rowHl.horizontalPathColors) && rowHl.horizontalPathColors[pi]
            ? rowHl.horizontalPathColors[pi]
            : '#009688';
        rowHlG
          .append('path')
          .attr('d', dRow)
          .attr('stroke', stroke)
          .attr('fill', 'none')
          .attr('stroke-width', 8)
          .attr('opacity', 0.65)
          .attr('stroke-linecap', 'round')
          .style('pointer-events', 'none');
      });
    }

    if (
      useSchematicCellCenterGrid &&
      dataStore.showWeightLabels &&
      dataStore.spaceNetworkGridShowRouteWeights &&
      !isTaipeiTestILayerTab(layerTab) &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax) &&
      xMax > xMin &&
      yMax > yMin
    ) {
      const marginMaxG = zoomGroup.append('g').attr('class', 'taipei-f-grid-margin-weight-max');
      const edgeLabelFill = '#1565C0';
      const edgeFs = '11px';
      // 每欄／每列皆顯示；無水平線之欄、無垂直線之列顯示 0
      for (let ix = xMin; ix < xMax; ix++) {
        const maxW = colWeightMax.get(ix);
        const label = Number.isFinite(maxW) ? String(maxW) : '0';
        marginMaxG
          .append('text')
          .attr('x', xScale(ix + 0.5))
          .attr('y', margin.top - 3)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'bottom')
          .attr('font-size', edgeFs)
          .attr('font-weight', 'bold')
          .attr('fill', edgeLabelFill)
          .text(label);
      }
      for (let iy = yMin; iy < yMax; iy++) {
        const maxW = rowWeightMax.get(iy);
        const label = Number.isFinite(maxW) ? String(maxW) : '0';
        marginMaxG
          .append('text')
          .attr('x', margin.left + width + 4)
          .attr('y', yScale(iy + 0.5))
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'middle')
          .attr('font-size', edgeFs)
          .attr('font-weight', 'bold')
          .attr('fill', edgeLabelFill)
          .text(label);
      }
    }

    // layout_network_grid_from_vh_draw：JSON segment.stations 中段車站沿折線以視圖像素弧長均分（每次 drawMap／縮放重算），黑點
    if (isLayoutNetworkGridFromVhDrawLayerId(layerTab)) {
      const drawLayer = dataStore.findLayerById(LINE_ORTHOGONAL_VERT_FIRST_MIRROR_DRAW_LAYER_ID);
      const exportRowsForSta = buildVhDrawStationRowsForLayoutMap(dataStore, drawLayer);
      const layoutEpXY = (ep) => {
        if (!ep || typeof ep !== 'object') return [NaN, NaN];
        const x = Number(ep.x_grid ?? ep.lon);
        const y = Number(ep.y_grid ?? ep.lat);
        return [x, y];
      };
      const layoutFindRowForLineGrid = (gridPts, rows) => {
        const eps = 1e-3;
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
      const distPxSeg = (pa, pb) => {
        const dx = pb[0] - pa[0];
        const dy = pb[1] - pa[1];
        return Math.hypot(dx, dy);
      };
      const gridXYAtPixelDistanceAlong = (gridPts, targetPx) => {
        if (!gridPts || gridPts.length < 2) return null;
        const pix = gridPts.map(([gx, gy]) => [xScale(gx), yScale(gy)]);
        const lens = [];
        let total = 0;
        for (let i = 0; i < pix.length - 1; i++) {
          const L = distPxSeg(pix[i], pix[i + 1]);
          lens.push(L);
          total += L;
        }
        if (!(total > 0) || !Number.isFinite(targetPx) || targetPx <= 0) {
          const g0 = gridPts[0];
          return [g0[0], g0[1]];
        }
        const d = Math.min(targetPx, total);
        let acc = 0;
        for (let i = 0; i < lens.length; i++) {
          const L = lens[i];
          if (acc + L >= d) {
            const t = L > 0 ? (d - acc) / L : 0;
            const g0 = gridPts[i];
            const g1 = gridPts[i + 1];
            return [g0[0] + t * (g1[0] - g0[0]), g0[1] + t * (g1[1] - g0[1])];
          }
          acc += L;
        }
        const last = gridPts[gridPts.length - 1];
        return [last[0], last[1]];
      };

      /** 與 `layoutMidStationCountFromJsonRow` 對齊：弧長分段黑點 k 對應第 k 筆中端站 JSON */
      const layoutMidStationsAlignedWithArc = (r) => {
        const mids = (Array.isArray(r?.segment?.stations) ? r.segment.stations : []).filter(
          (m) => m && typeof m === 'object',
        );
        if (!mids.length) return [];
        const nc = mids.filter((m) => m.node_type !== 'connect');
        return nc.length > 0 ? nc : mids;
      };

      /** 中段黑點：與本站點圓 hover 同源（版面 JSON：`stationEndpointTooltipHtmlFromProps`） */
      const showLayoutVHDrawMidStationTooltip = (event, stationPropBag, gx, gy) => {
        const gxLbl = formatAxisTickLabelMaxTwoDecimals(
          Number.isFinite(Number(gx)) ? Number(gx) : gx,
          xAxisLabelsAsFloat,
        );
        const gyLbl = formatAxisTickLabelMaxTwoDecimals(
          Number.isFinite(Number(gy)) ? Number(gy) : gy,
          yAxisLabelsAsFloat,
        );
        const gridCoordLine = `<strong>網格座標</strong> (${escapeLayoutTooltipHtml(gxLbl)}, ${escapeLayoutTooltipHtml(gyLbl)})<br>`;
        if (uniformGridRouteFamilyTab) {
          const jlStation = dataStore.findLayerById(layerTab);
          const jrStation =
            layoutUniformGridTooltipJr ??
            mapDrawnExportRowsFromJsonDrawRoot(jlStation?.jsonData, jlStation?.dataJson);
          const props = stationPropBag && typeof stationPropBag === 'object' ? stationPropBag : {};
          const tags = props.tags || {};
          const sidTip = String(props.station_id ?? tags.station_id ?? '').trim();
          const hasRnl =
            (Array.isArray(props.route_name_list) && props.route_name_list.length > 0) ||
            (Array.isArray(tags.route_name_list) && tags.route_name_list.length > 0);
          let propBagForStation = props;
          if (Array.isArray(jrStation) && jrStation.length > 0 && sidTip && !hasRnl) {
            const nameSet = new Set();
            const idMatches = (n) =>
              String(n?.station_id ?? n?.tags?.station_id ?? '').trim() === sidTip;
            for (const rowJr of jrStation) {
              const sm = rowJr?.segment;
              if (!sm) continue;
              const hitsMid = Array.isArray(sm.stations) && sm.stations.some(idMatches);
              if (idMatches(sm.start) || idMatches(sm.end) || hitsMid) {
                const nm = String(rowJr.routeName ?? '').trim();
                if (nm) nameSet.add(nm);
              }
            }
            if (nameSet.size > 0) {
              propBagForStation = { ...props, route_name_list: [...nameSet] };
            }
          }
          const lonTip = Number.isFinite(segmentNodeLon(props)) ? segmentNodeLon(props) : gx;
          const latTip = Number.isFinite(segmentNodeLat(props)) ? segmentNodeLat(props) : gy;
          const tagMerged = getGeoJsonFeatureTagProps({ properties: props });
          const typeForTooltip = normalizeRouteSegmentEndpointType(
            props.type ?? tags.type ?? tagMerged.type ?? 'normal',
          );
          tooltip
            .html(
              gridCoordLine +
                stationEndpointTooltipHtmlFromProps(
                  propBagForStation,
                  typeForTooltip,
                  lonTip,
                  latTip,
                ),
            )
            .style('opacity', 1)
            .style('left', `${event.pageX + 10}px`)
            .style('top', `${event.pageY - 10}px`);
          return;
        }
        const props = stationPropBag && typeof stationPropBag === 'object' ? stationPropBag : {};
        const tags = props.tags || {};
        const tagMergedFb = getGeoJsonFeatureTagProps({ properties: props });
        tooltip
          .html(
            gridCoordLine +
              stationEndpointTooltipHtmlFromProps(
                props,
                normalizeRouteSegmentEndpointType(
                  props.type ?? tags.type ?? tagMergedFb.type ?? 'normal',
                ),
                gx,
                gy,
              ),
          )
          .style('opacity', 1)
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`);
      };

      const layoutStaG = zoomGroup.append('g').attr('class', 'layout-vh-draw-line-stations-pt');
      const layoutLineFeatCount = routeFeatures.filter(
        (f) => f?.geometry?.type === 'LineString',
      ).length;
      let layoutLineFeatIdx = 0;
      for (const rf of routeFeatures) {
        if (!rf?.geometry || rf.geometry.type !== 'LineString') continue;
        const coords = rf.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const gridPts = coords.map((c) => [Number(c[0]), Number(c[1])]);
        let row = layoutFindRowForLineGrid(gridPts, exportRowsForSta);
        if (
          !row &&
          exportRowsForSta.length > 0 &&
          layoutLineFeatCount === exportRowsForSta.length
        ) {
          row = exportRowsForSta[layoutLineFeatIdx] ?? null;
        }
        layoutLineFeatIdx += 1;
        const nSta = row ? layoutMidStationCountFromJsonRow(row) : 0;
        if (nSta <= 0) continue;
        const midsArc = layoutMidStationsAlignedWithArc(row);
        const pix = gridPts.map(([gx, gy]) => [xScale(gx), yScale(gy)]);
        let totalPx = 0;
        for (let i = 0; i < pix.length - 1; i++) totalPx += distPxSeg(pix[i], pix[i + 1]);
        if (!(totalPx > 0)) continue;
        const dotRadius = 2.5;
        for (let k = 1; k <= nSta; k++) {
          const target = (k * totalPx) / (nSta + 1);
          const gxy = gridXYAtPixelDistanceAlong(gridPts, target);
          if (!gxy) continue;
          const sta = midsArc[k - 1] ?? {};
          layoutStaG
            .append('circle')
            .attr('cx', xScale(gxy[0]))
            .attr('cy', yScale(gxy[1]))
            .attr('r', dotRadius)
            .attr('fill', '#000000')
            .attr('stroke', '#000000')
            .attr('stroke-width', 1)
            .style('cursor', 'pointer')
            .style('pointer-events', 'all')
            .on('mouseover', function (event) {
              d3.select(this).attr('r', 5).attr('stroke-width', 2);
              showLayoutVHDrawMidStationTooltip(event, sta, gxy[0], gxy[1]);
            })
            .on('mousemove', function (event) {
              tooltip.style('left', `${event.pageX + 10}px`).style('top', `${event.pageY - 10}px`);
            })
            .on('mouseout', function () {
              d3.select(this).attr('r', dotRadius).attr('stroke-width', 1);
              tooltip.style('opacity', 0);
            });
        }
      }
    }

    // 繪製站點（根據 nodeType 區分 connect 和 line）
    stationFeatures.forEach((feature) => {
      const [x, y] = feature.geometry.coordinates;
      const props = feature.properties || {};
      const tags = props.tags || {};
      const nodeType = feature.nodeType || 'line'; // connect 或 line

      // 根據 nodeType 決定顏色和大小
      const isConnect = nodeType === 'connect';
      // 直線化測試／網格正規化：僅在「車站配置」開啟且已有 SectionData 時改由下方專區繪製，避免與 segment.nodes 重疊
      // taipei_h3／taipei_h3_dp：g3→h3 黑點僅存在於 segment.nodes／stationFeatures，專區未畫中段站，須走本迴圈
      const stLayer = dataStore.findLayerById(layerTab);
      if (
        TAIPEI_TEST_SPACE_NETWORK_STATION_TAB_IDS.includes(layerTab) &&
        layerTab !== 'taipei_h3' &&
        layerTab !== 'taipei_sn4_h' &&
        layerTab !== 'taipei_h3_dp' &&
        layerTab !== 'taipei_h3_dp_2' &&
        !isTaipeiTest3I3OrJ3LayerTab(layerTab) &&
        stLayer?.spaceNetworkGridJsonData_SectionData?.length > 0 &&
        stLayer?.showStationPlacement
      )
        return;

      // 經緯度路段（MapTab／json-derived）之站點：與 Map 分頁 terminal／intersection／normal 同色
      const mapLonLatEndpoints = props.endpointFromRouteLonLatSegment === true;

      // 有疊加網格時：紅點對齊網格單元中心；黑點依重分配表畫在兩交叉點間平均位置（勿套用於經緯度路段點）
      let drawX = x;
      let drawY = y;
      if (overlayForSnap && !mapLonLatEndpoints) {
        if (isConnect) {
          [drawX, drawY] = overlayCellCenter(x, y);
        } else {
          const redist = blackRedistributeMap.get(key(x, y));
          if (redist) [drawX, drawY] = redist;
        }
      }
      const degGx =
        props.x_grid !== undefined && Number.isFinite(Number(props.x_grid))
          ? Number(props.x_grid)
          : Number(x);
      const degGy =
        props.y_grid !== undefined && Number.isFinite(Number(props.y_grid))
          ? Number(props.y_grid)
          : Number(y);
      let fillColor;
      let radius;
      let strokeWidth;
      /** @type {'terminal'|'intersection'|'normal'} */
      let endpointNormForHover = 'normal';
      let strokeColor;
      let isHighlighted = false;
      let isOnOtherRoute = false;
      const hlStroke = '#ff6600';
      let cn;

      if (mapLonLatEndpoints) {
        const tagMerged = getGeoJsonFeatureTagProps(feature);
        endpointNormForHover = normalizeRouteSegmentEndpointType(
          props.type ?? tagMerged.type ?? 'normal'
        );
        const b = mapTabApproxBaseSvgForEndpoint(endpointNormForHover);
        fillColor = b.fill;
        strokeColor = b.stroke;
        radius = b.r;
        strokeWidth = b.strokeW;
        cn = props.connect_number ?? tags.connect_number;
      } else {
        const tagMergedGrid = getGeoJsonFeatureTagProps(feature);
        endpointNormForHover = normalizeRouteSegmentEndpointType(
          props.type ?? tags.type ?? tagMergedGrid.type ?? 'normal'
        );
        fillColor =
          isConnect && connectBlueFromTaggedTerminal(props, tags)
            ? '#1565c0'
            : (taipeiTest3ConnectFill(isConnect, degGx, degGy) ??
              (isConnect ? '#ff0000' : '#000000'));
        cn = props.connect_number ?? tags.connect_number;
        const sidLine = props.station_id ?? tags.station_id;
        const gxLine = props.x_grid !== undefined ? Number(props.x_grid) : Number(x);
        const gyLine = props.y_grid !== undefined ? Number(props.y_grid) : Number(y);
        const isConnectHl =
          isConnect &&
          dataStore.highlightedConnectNumber != null &&
          cn === dataStore.highlightedConnectNumber;
        const isH2ConnectHl = isConnect && matchH2TrafficConnect(cn);
        const isH2BlackHl = !isConnect && matchH2TrafficBlack(gxLine, gyLine, sidLine);
        const hbL3 = dataStore.highlightedBlackStation;
        const coordEpsL3 = 0.08;
        const hbSidL3 = hbL3?.stationId;
        const isL3ReductionBlackHl =
          !isConnect &&
          hbL3 &&
          hbL3.layerId === layerTab &&
          (layerTab === 'taipei_l3' ||
            layerTab === 'taipei_sn4_l' ||
            layerTab === 'taipei_l3_dp' ||
            layerTab === 'taipei_l3_dp_2') &&
          (hbSidL3 != null && String(hbSidL3).trim() !== ''
            ? String(sidLine ?? '').trim() === String(hbSidL3).trim()
            : Math.abs(Number(gxLine) - Number(hbL3.x)) < coordEpsL3 &&
              Math.abs(Number(gyLine) - Number(hbL3.y)) < coordEpsL3);
        isHighlighted = isConnectHl || isH2ConnectHl;
        isOnOtherRoute = isHighlighted || isH2BlackHl || isL3ReductionBlackHl;
        radius = isHighlighted || isH2BlackHl || isL3ReductionBlackHl ? 5 : isConnect ? 2.5 : 1.5;
        strokeWidth = isHighlighted || isH2BlackHl || isL3ReductionBlackHl ? 2.5 : 1;
        strokeColor =
          isHighlighted || isH2BlackHl || isL3ReductionBlackHl
            ? isL3ReductionBlackHl &&
              hbL3?.color &&
              typeof hbL3.color === 'string' &&
              hbL3.color.trim() !== ''
              ? hbL3.color.trim()
              : hlStroke
            : fillColor;
      }

      const circleElement = zoomGroup
        .append('circle')
        .attr('cx', xScale(drawX))
        .attr('cy', yScale(drawY))
        .attr('r', radius)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', strokeWidth)
        .attr('class', isOnOtherRoute ? 'highlighted-connect-point' : '')
        .style('cursor', 'pointer');

      if (dataStore.showStationNames && isConnect) {
        let labelName = props.station_name !== undefined ? props.station_name : tags.station_name;
        if (labelName == null || String(labelName).trim() === '') {
          labelName = tags.name;
        }
        labelName = labelName != null ? String(labelName).trim() : '';
        if (labelName) {
          zoomGroup
            .append('text')
            .attr('x', xScale(drawX))
            .attr('y', yScale(drawY) - radius - 4)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'bottom')
            .attr('font-size', '11px')
            .attr('font-weight', 'bold')
            .attr('fill', '#1a1a1a')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.35)
            .attr('paint-order', 'stroke')
            .style('pointer-events', 'none')
            .text(labelName);
        }
      } else if (dataStore.showBlackDotStationNames && !isConnect) {
        let labelName = props.station_name !== undefined ? props.station_name : tags.station_name;
        if (labelName == null || String(labelName).trim() === '') {
          labelName = tags.name;
        }
        labelName = labelName != null ? String(labelName).trim() : '';
        if (labelName) {
          zoomGroup
            .append('text')
            .attr('x', xScale(drawX))
            .attr('y', yScale(drawY) - radius - 4)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'bottom')
            .attr('font-size', '10px')
            .attr('font-weight', 'bold')
            .attr('fill', '#1a1a1a')
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.35)
            .attr('paint-order', 'stroke')
            .style('pointer-events', 'none')
            .text(labelName);
        }
      }

      // 添加 hover 效果
      circleElement
        .on('mouseover', function (event) {
          if (mapLonLatEndpoints) {
            const hov = mapTabApproxHoverSvgForEndpoint(endpointNormForHover);
            d3.select(this)
              .attr('r', hov.r)
              .attr('stroke-width', hov.strokeW)
              .attr('fill', hov.fill)
              .attr('stroke', hov.stroke);
          } else {
            const highlightRadius = isConnect ? 4 : 3;
            d3.select(this).attr('r', highlightRadius).attr('stroke-width', 2);
          }

          // 顯示 tooltip（包含座標和標籤）
          /** 版面網格／座標正規化家族：站點 hover 與 MapTab popup 同欄位（含 type／route_name_list） */
          if (uniformGridRouteFamilyTab) {
            const jlStation = dataStore.findLayerById(layerTab);
            const jrStation =
              layoutUniformGridTooltipJr ??
              mapDrawnExportRowsFromJsonDrawRoot(jlStation?.jsonData, jlStation?.dataJson);
            const sidTip = String(props.station_id ?? tags.station_id ?? '').trim();
            const hasRnl =
              (Array.isArray(props.route_name_list) && props.route_name_list.length > 0) ||
              (Array.isArray(tags.route_name_list) && tags.route_name_list.length > 0);
            let propBagForStation = props;
            if (Array.isArray(jrStation) && jrStation.length > 0 && sidTip && !hasRnl) {
              const nameSet = new Set();
              const idMatches = (n) =>
                String(n?.station_id ?? n?.tags?.station_id ?? '').trim() === sidTip;
              for (const row of jrStation) {
                const sm = row?.segment;
                if (!sm) continue;
                const hitsMid = Array.isArray(sm.stations) && sm.stations.some(idMatches);
                if (idMatches(sm.start) || idMatches(sm.end) || hitsMid) {
                  const nm = String(row.routeName ?? '').trim();
                  if (nm) nameSet.add(nm);
                }
              }
              if (nameSet.size > 0) {
                propBagForStation = { ...props, route_name_list: [...nameSet] };
              }
            }
            const lonTip = Number.isFinite(segmentNodeLon(props))
              ? segmentNodeLon(props)
              : Number(x);
            const latTip = Number.isFinite(segmentNodeLat(props))
              ? segmentNodeLat(props)
              : Number(y);
            const tagForStationType = getGeoJsonFeatureTagProps(feature);
            const typeForTooltip = normalizeRouteSegmentEndpointType(
              props.type ?? tags.type ?? tagForStationType.type ?? endpointNormForHover
            );
            const tooltipContent = stationEndpointTooltipHtmlFromProps(
              propBagForStation,
              typeForTooltip,
              lonTip,
              latTip
            );
            tooltip
              .html(tooltipContent)
              .style('opacity', 1)
              .style('left', event.pageX + 10 + 'px')
              .style('top', event.pageY - 10 + 'px');
            return;
          }

          const gridGx =
            props.x_proj !== undefined && props.y_proj !== undefined
              ? Number(props.x_proj)
              : props.x_grid !== undefined
                ? Number(props.x_grid)
                : Number(x);
          const gridGy =
            props.y_proj !== undefined && props.y_proj !== undefined
              ? Number(props.y_proj)
              : props.y_grid !== undefined
                ? Number(props.y_grid)
                : Number(y);

          let coordinateHtml;
          if (taipeiCReducedOverlayDraw) {
            coordinateHtml = `<strong>縮減網格索引 (ix′, iy′):</strong> (${Math.round(gridGx)}, ${Math.round(gridGy)})`;
          } else if (props.x_proj !== undefined && props.y_proj !== undefined) {
            coordinateHtml = `<strong>座標:</strong> (${props.x_proj}, ${props.y_proj})`;
          } else if (props.x_grid !== undefined && props.y_grid !== undefined) {
            coordinateHtml = `<strong>座標:</strong> (${props.x_grid}, ${props.y_grid})`;
          } else {
            coordinateHtml = `<strong>座標:</strong> (${x}, ${y})`;
          }

          const spacingBlock = taipeiCReducedOverlayDraw
            ? minSpacingTooltipBlock(gridGx, gridGy, 'supplementOnly')
            : minSpacingTooltipBlock(gridGx, gridGy);
          let tooltipParts = [coordinateHtml + spacingBlock];

          if (mapLonLatEndpoints && isSpaceLayoutUniformGridViewerLayerId(layerTab)) {
            const layoutLyr = dataStore.findLayerById(layerTab);
            const gc = uniformGridCellFromLayoutMeta(
              layoutLyr?.layoutUniformGridMeta,
              Number(x),
              Number(y)
            );
            if (gc) {
              tooltipParts.push(
                `<strong>${gc.labelX}:</strong> ${gc.ix}<br><strong>${gc.labelY}:</strong> ${gc.iy}`
              );
            }
          }

          // 優先顯示 station_id 和 station_name（同時支援 props 直屬與 props.tags）
          const stationId = props.station_id !== undefined ? props.station_id : tags.station_id;
          const stationName =
            props.station_name !== undefined ? props.station_name : tags.station_name;
          if (stationId !== undefined) {
            tooltipParts.push(`<strong>站點ID:</strong> ${stationId}`);
          }
          if (stationName !== undefined) {
            tooltipParts.push(`<strong>站點名稱:</strong> ${stationName}`);
          }

          if (mapLonLatEndpoints) {
            tooltipParts.push(`<strong>節點類型:</strong> ${endpointNormForHover}`);
          }

          // 顯示 connect_number（如果存在，用紅色標示）
          if (props.connect_number !== undefined) {
            tooltipParts.push(
              `<strong style="color: #ff0000;">Connect #:</strong> <span style="color: #ff0000;">${props.connect_number}</span>`
            );
          }

          // 顯示 node_type
          if (props.node_type !== undefined) {
            tooltipParts.push(`<strong>節點類型:</strong> ${props.node_type}`);
          }

          // 顯示其他 tags
          const tagsHtml = Object.entries(tags)
            .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
            .join('<br>');
          if (tagsHtml) {
            tooltipParts.push(tagsHtml);
          }

          const tooltipContent = tooltipParts.join('<br>');

          tooltip
            .html(tooltipContent)
            .style('opacity', 1)
            .style('left', event.pageX + 10 + 'px')
            .style('top', event.pageY - 10 + 'px');
        })
        .on('mousemove', function (event) {
          // 更新 tooltip 位置
          tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 10 + 'px');
        })
        .on('mouseout', function () {
          if (mapLonLatEndpoints) {
            d3.select(this)
              .attr('r', radius)
              .attr('stroke-width', strokeWidth)
              .attr('fill', fillColor)
              .attr('stroke', strokeColor);
          } else {
            d3.select(this).attr('r', radius).attr('stroke-width', 1);
          }

          // 隱藏 tooltip
          tooltip.style('opacity', 0);
        });
    });

    // 🎯 車站配置：ConnectData(紅點) -> SectionData(黑點順序) -> StationData(完整站屬性)
    if (TAIPEI_TEST_SPACE_NETWORK_STATION_TAB_IDS.includes(layerTab)) {
      const stLayer = dataStore.findLayerById(layerTab);
      // taipei_h3／taipei_h3_dp：黑／紅／藍皆已由上方 stationFeatures 迴圈繪製，勿再由此區塊重畫
      if (
        stLayer?.showStationPlacement &&
        layerTab !== 'taipei_h3' &&
        layerTab !== 'taipei_sn4_h' &&
        layerTab !== 'taipei_h3_dp' &&
        layerTab !== 'taipei_h3_dp_2' &&
        !isTaipeiTest3I3OrJ3LayerTab(layerTab)
      ) {
        const connectData = stLayer.spaceNetworkGridJsonData_ConnectData;
        const sectionData = stLayer.spaceNetworkGridJsonData_SectionData;
        const stationData = stLayer.spaceNetworkGridJsonData_StationData;
        const rtData = stLayer.spaceNetworkGridJsonData;
        // taipei_g：預建完整站名查詢 ctx（含 SectionData connect_start/end 站名補查）
        const taipeiFLabelCtx =
          isTaipeiEfinalSpaceLayerTab(layerTab) &&
          Array.isArray(connectData) &&
          Array.isArray(sectionData)
            ? {
                connectNumberToNameId: buildConnectNumberToNameIdMap(connectData, sectionData),
                connectGridKeyToNameId: buildConnectGridKeyToNameIdMap(connectData, sectionData),
                sectionRouteGridNameIdMap: buildSectionRouteGridNameIdMap(sectionData),
                sectionGridKeyToNameIdMap: buildSectionGridKeyToNameIdMap(sectionData),
                blackLabelsByGrid: buildBlackStationDisplayByGrid(stationData),
                stationData,
                connectData,
              }
            : null;
        if (Array.isArray(connectData) && Array.isArray(sectionData) && Array.isArray(rtData)) {
          const flatSegs =
            rtData.length > 0 && rtData[0]?.segments && !rtData[0]?.points
              ? rtData.flatMap((r) =>
                  (r.segments || []).map((s) => ({
                    ...s,
                    route_name: s.route_name ?? r.route_name ?? r.name,
                    name: s.name ?? r.route_name ?? r.name,
                  }))
                )
              : rtData;

          const toNum = (v) => Number(v ?? 0);
          const getC = (p) =>
            Array.isArray(p) ? [toNum(p[0]), toNum(p[1])] : [toNum(p?.x), toNum(p?.y)];
          const pointKey = (x, y) => `${toNum(x)},${toNum(y)}`;
          const normalizeRouteKey = (arr) =>
            (Array.isArray(arr) ? arr : [])
              .map((r) => String(r ?? '').trim())
              .filter((r) => r !== '')
              .sort()
              .join('|');

          const stationLookup = new Map();
          if (Array.isArray(stationData)) {
            stationData.forEach((s) => {
              if (s.station_id) stationLookup.set(s.station_id, s);
            });
          }

          // 從當前路段端點建立「當前紅點」：座標 + 經過的路線名（route_list）
          const currentConnects = new Map();
          flatSegs.forEach((seg) => {
            const routeName = seg.route_name ?? seg.name ?? 'Unknown';
            const pts = seg.points?.map(getC) || [];
            if (pts.length < 2) return;
            for (const pt of [pts[0], pts[pts.length - 1]]) {
              const k = pointKey(pt[0], pt[1]);
              if (!currentConnects.has(k)) {
                currentConnects.set(k, { x: pt[0], y: pt[1], routeNames: new Set() });
              }
              currentConnects.get(k).routeNames.add(routeName);
            }
          });

          // 依 route_list 分組儲存的 ConnectData（同一 route_list 可能多筆，用座標接近度區分）
          const connectByRouteKey = new Map();
          connectData.forEach((cd) => {
            if (!cd) return;
            const rk = normalizeRouteKey(cd.route_list);
            if (!rk) return;
            if (!connectByRouteKey.has(rk)) connectByRouteKey.set(rk, []);
            connectByRouteKey.get(rk).push(cd);
          });

          const connectByNumber = new Map();
          const connectByCoord = new Map();
          connectData.forEach((c) => {
            if (!c) return;
            const cn = c.connect_number ?? c.tags?.connect_number;
            const cx = c.x_grid ?? c.tags?.x_grid;
            const cy = c.y_grid ?? c.tags?.y_grid;
            if (cn != null && !connectByNumber.has(cn)) connectByNumber.set(cn, c);
            if (cx != null && cy != null) {
              const pk = pointKey(cx, cy);
              if (!connectByCoord.has(pk)) connectByCoord.set(pk, c);
            }
          });
          const resolveConnect = (props, fallbackPoint) => {
            const cn = props?.connect_number ?? props?.tags?.connect_number;
            if (cn != null && connectByNumber.has(cn)) return connectByNumber.get(cn);
            const x = props?.x_grid ?? props?.tags?.x_grid ?? fallbackPoint?.[0];
            const y = props?.y_grid ?? props?.tags?.y_grid ?? fallbackPoint?.[1];
            if (x != null && y != null) return connectByCoord.get(pointKey(x, y)) || null;
            return null;
          };
          const connectId = (cd) => {
            if (!cd) return null;
            const cn = cd.connect_number ?? cd.tags?.connect_number;
            if (cn != null) return `cn:${cn}`;
            const cx = cd.x_grid ?? cd.tags?.x_grid;
            const cy = cd.y_grid ?? cd.tags?.y_grid;
            if (cx != null && cy != null) return `xy:${pointKey(cx, cy)}`;
            return null;
          };
          const pairKey = (a, b) => [a, b].sort().join(' <-> ');
          const sectionBuckets = new Map();
          sectionData.forEach((sd) => {
            if (!sd) return;
            const startCd = resolveConnect(sd.connect_start, null);
            const endCd = resolveConnect(sd.connect_end, null);
            const startCid = connectId(startCd);
            const endCid = connectId(endCd);
            const key = startCid && endCid ? pairKey(startCid, endCid) : null;
            if (key) {
              if (!sectionBuckets.has(key)) sectionBuckets.set(key, []);
              sectionBuckets.get(key).push(sd);
            }
          });

          const expectedBlackCount = sectionData.reduce((sum, sd) => {
            if (!sd) return sum;
            const connectSids = new Set();
            const startSid = (
              sd.connect_start?.station_id ??
              sd.connect_start?.tags?.station_id ??
              ''
            )
              .toString()
              .trim();
            const endSid = (sd.connect_end?.station_id ?? sd.connect_end?.tags?.station_id ?? '')
              .toString()
              .trim();
            if (startSid) connectSids.add(startSid);
            if (endSid) connectSids.add(endSid);
            const stList = (sd.station_list || []).filter(
              (s) => !s.station_id || !connectSids.has(String(s.station_id ?? '').trim())
            );
            return sum + stList.length;
          }, 0);

          const drawDot = (cx, cy, props, isConnect, isBlackHighlighted = false) => {
            // taipei_c／taipei_d／taipei_e：黑點改由專用區塊繪製（c＝弧長；d＝向心滑動；e＝d→e 縮減後 StationData）
            if (
              !isConnect &&
              (isTaipeiTestCDELayerTab(layerTab) || isTaipeiEfinalSpaceLayerTab(layerTab))
            )
              return;
            const mapped = reducedPlotMapper ? reducedPlotMapper(cx, cy) : [cx, cy];
            let [px, py] =
              isConnect && overlayForSnap && !reducedPlotMapper
                ? overlayCellCenter(cx, cy)
                : mapped;
            let fillColor = isConnect ? '#ff0000' : '#000000';
            if (isConnect) {
              const tagsDot = props.tags || {};
              if (connectBlueFromTaggedTerminal(props, tagsDot)) {
                fillColor = '#1565c0';
              } else {
                const gxD =
                  props.x_grid != null && Number.isFinite(Number(props.x_grid))
                    ? Number(props.x_grid)
                    : cx;
                const gyD =
                  props.y_grid != null && Number.isFinite(Number(props.y_grid))
                    ? Number(props.y_grid)
                    : cy;
                const [degX, degY] = reducedPlotMapper ? reducedPlotMapper(gxD, gyD) : [gxD, gyD];
                fillColor = taipeiTest3ConnectFill(true, degX, degY) ?? '#ff0000';
              }
            }
            const cnDot = props.connect_number ?? props.tags?.connect_number;
            const isH2Conn = isConnect && matchH2TrafficConnect(cnDot);
            const isHighlighted = isConnect
              ? (dataStore.highlightedConnectNumber != null &&
                  cnDot === dataStore.highlightedConnectNumber) ||
                isH2Conn
              : isBlackHighlighted;
            const r = isHighlighted ? 5 : isConnect ? 2.5 : 1.5;
            const strokeColor = isHighlighted ? '#ff6600' : fillColor;
            const strokeWidth = isHighlighted ? 2.5 : 1;
            const el = zoomGroup
              .append('circle')
              .attr('cx', xScale(px))
              .attr('cy', yScale(py))
              .attr('r', r)
              .attr('fill', fillColor)
              .attr('stroke', strokeColor)
              .attr('stroke-width', strokeWidth)
              .attr('class', isHighlighted ? 'highlighted-connect-point' : '')
              .style('cursor', 'pointer');
            if (dataStore.showStationNames && isConnect) {
              let sname = (props.station_name ?? props.tags?.station_name ?? props.tags?.name ?? '')
                .toString()
                .trim();
              if (isTaipeiEfinalSpaceLayerTab(layerTab) && taipeiFLabelCtx) {
                const filled = resolveTaipeiFStationNameAndId(props, taipeiFLabelCtx);
                if (!sname) sname = (filled.station_name ?? '').toString().trim();
              }
              if (sname) {
                zoomGroup
                  .append('text')
                  .attr('x', xScale(px))
                  .attr('y', yScale(py) - r - 4)
                  .attr('text-anchor', 'middle')
                  .attr('dominant-baseline', 'bottom')
                  .attr('font-size', '11px')
                  .attr('font-weight', 'bold')
                  .attr('fill', '#1a1a1a')
                  .attr('stroke', '#ffffff')
                  .attr('stroke-width', 0.35)
                  .attr('paint-order', 'stroke')
                  .style('pointer-events', 'none')
                  .text(sname);
              }
            } else if (dataStore.showBlackDotStationNames && !isConnect) {
              let sname = (props.station_name ?? props.tags?.station_name ?? props.tags?.name ?? '')
                .toString()
                .trim();
              if (isTaipeiEfinalSpaceLayerTab(layerTab) && taipeiFLabelCtx) {
                const filled = resolveTaipeiFStationNameAndId(props, taipeiFLabelCtx);
                if (!sname) sname = (filled.station_name ?? '').toString().trim();
              }
              if (sname) {
                zoomGroup
                  .append('text')
                  .attr('x', xScale(px))
                  .attr('y', yScale(py) - r - 4)
                  .attr('text-anchor', 'middle')
                  .attr('dominant-baseline', 'bottom')
                  .attr('font-size', '10px')
                  .attr('font-weight', 'bold')
                  .attr('fill', '#1a1a1a')
                  .attr('stroke', '#ffffff')
                  .attr('stroke-width', 0.35)
                  .attr('paint-order', 'stroke')
                  .style('pointer-events', 'none')
                  .text(sname);
              }
            }
            el.on('mouseover', function (event) {
              d3.select(this)
                .attr('r', isConnect ? 4 : 3)
                .attr('stroke-width', 2);
              const dispX = cx;
              const dispY = cy;
              const dispFmt = (v) =>
                typeof v === 'number' && v.toFixed
                  ? taipeiCReducedOverlayDraw
                    ? String(Math.round(v))
                    : useSchematicCellCenterGrid
                      ? String(Math.round(Number(v)))
                      : v.toFixed(2)
                  : v;
              const coordLine = taipeiCReducedOverlayDraw
                ? `<strong>縮減網格索引 (ix′, iy′):</strong> (${dispFmt(dispX)}, ${dispFmt(dispY)})${minSpacingTooltipBlock(Number(dispX), Number(dispY), 'supplementOnly')}`
                : `<strong>座標:</strong> (${dispFmt(dispX)}, ${dispFmt(dispY)})${minSpacingTooltipBlock(Number(dispX), Number(dispY))}`;
              const parts = [coordLine];
              let sid = (props.station_id ?? props.tags?.station_id ?? '').toString().trim();
              let sname = (
                props.station_name ??
                props.tags?.station_name ??
                props.tags?.name ??
                ''
              ).trim();
              // taipei_g：紅點僅依 ConnectData／SectionData 對照（見 resolveTaipeiFStationNameAndId）
              if (isTaipeiEfinalSpaceLayerTab(layerTab) && taipeiFLabelCtx) {
                const filled = resolveTaipeiFStationNameAndId(props, taipeiFLabelCtx);
                if (!sname) sname = filled.station_name;
                if (!sid) sid = filled.station_id;
              }
              if (sid !== undefined && sid !== '') parts.push(`<strong>站點ID:</strong> ${sid}`);
              if (sname !== undefined && sname !== '')
                parts.push(`<strong>站點名稱:</strong> ${sname}`);
              if (props.connect_number != null)
                parts.push(
                  `<strong style="color:#ff0000;">Connect #:</strong> <span style="color:#ff0000;">${props.connect_number}</span>`
                );
              parts.push(`<strong>節點類型:</strong> ${isConnect ? 'connect' : 'line (station)'}`);
              const tags = props.tags || {};
              const skipTagKeys =
                isTaipeiEfinalSpaceLayerTab(layerTab) && isConnect
                  ? new Set(['station_name', 'station_id', 'name', 'x_grid', 'y_grid'])
                  : null;
              const tagsHtml = Object.entries(tags)
                .filter(([k]) => !skipTagKeys?.has(k))
                .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
                .join('<br>');
              if (tagsHtml) parts.push(tagsHtml);
              tooltip
                .html(parts.join('<br>'))
                .style('opacity', 1)
                .style('left', event.pageX + 10 + 'px')
                .style('top', event.pageY - 10 + 'px');
            })
              .on('mousemove', function (event) {
                tooltip
                  .style('left', event.pageX + 10 + 'px')
                  .style('top', event.pageY - 10 + 'px');
              })
              .on('mouseout', function () {
                d3.select(this).attr('r', r).attr('stroke-width', strokeWidth);
                tooltip.style('opacity', 0);
              });
          };

          // 1) 紅點：畫在「當前路段端點」位置，用 route_list 對應儲存的 ConnectData 屬性；同 route_list 多筆時以座標接近度配對
          const usedConnectData = new Set();
          const endpointConnectMap = new Map();
          currentConnects.forEach(({ x, y, routeNames }) => {
            // taipei_g：同格僅單一路線為黑點（StationData），多路線才畫紅點
            if (isTaipeiEfinalSpaceLayerTab(layerTab) && routeNames.size < 2) return;
            const rk = normalizeRouteKey([...routeNames]);
            const storedList = (rk && connectByRouteKey.get(rk)) || [];
            let chosen = null;
            if (storedList.length === 1) {
              chosen = storedList[0];
            } else if (storedList.length > 1) {
              let bestDist = Infinity;
              for (const cd of storedList) {
                if (usedConnectData.has(cd)) continue;
                const sx = toNum(cd?.x_grid ?? cd?.tags?.x_grid ?? 0);
                const sy = toNum(cd?.y_grid ?? cd?.tags?.y_grid ?? 0);
                const d = (x - sx) ** 2 + (y - sy) ** 2;
                if (d < bestDist) {
                  bestDist = d;
                  chosen = cd;
                }
              }
            }
            if (chosen) usedConnectData.add(chosen);
            endpointConnectMap.set(pointKey(x, y), chosen);
            drawDot(x, y, chosen || {}, true);
          });

          // 2) 黑點：每筆 SectionData 對應一個 segment（兩紅點之間）；以 connectId 雙端鍵 + route_name 配對，僅在該段內弧長均分
          const segmentPoly = (seg) => (seg.points || []).map(getC);
          const placeBlackAlongPoly = (poly, stList) => {
            if (stList.length === 0 || poly.length < 2) return 0;
            let totalLen = 0;
            const pathSegs = [];
            for (let i = 0; i < poly.length - 1; i++) {
              const dx = poly[i + 1][0] - poly[i][0];
              const dy = poly[i + 1][1] - poly[i][1];
              const len = Math.hypot(dx, dy);
              totalLen += len;
              pathSegs.push({ len, p1: poly[i], p2: poly[i + 1] });
            }
            if (totalLen <= 0) return 0;
            const step = totalLen / (stList.length + 1);
            for (let si = 0; si < stList.length; si++) {
              const target = step * (si + 1);
              let covered = 0;
              for (const ps of pathSegs) {
                if (covered + ps.len >= target) {
                  const ratio = (target - covered) / ps.len;
                  const sx = ps.p1[0] + (ps.p2[0] - ps.p1[0]) * ratio;
                  const sy = ps.p1[1] + (ps.p2[1] - ps.p1[1]) * ratio;
                  const fullProps = stationLookup.get(stList[si].station_id) || stList[si];
                  const hb = dataStore.highlightedBlackStation;
                  const coordEps = 0.08;
                  const gxb = Number(fullProps.x_grid ?? fullProps.tags?.x_grid ?? sx);
                  const gyb = Number(fullProps.y_grid ?? fullProps.tags?.y_grid ?? sy);
                  const sidB =
                    fullProps.station_id ?? fullProps.tags?.station_id ?? stList[si].station_id;
                  const isBlackHighlighted =
                    (hb &&
                      layerTab === hb.layerId &&
                      Math.abs(Number(sx) - Number(hb.x)) < coordEps &&
                      Math.abs(Number(sy) - Number(hb.y)) < coordEps) ||
                    matchH2TrafficBlack(gxb, gyb, sidB);
                  drawDot(sx, sy, fullProps, false, isBlackHighlighted);
                  break;
                }
                covered += ps.len;
              }
            }
            return stList.length;
          };

          const usedSection = new Set();
          const unmatchedSegments = [];
          let actualBlackCount = 0;

          // taipei_g：切段後黑點改由 StationData（與 rebuildTaipeiFStationConnectAfterSplit 一致），
          // 不再用 Section 弧長配對（端點紅／黑語意已變）。
          if (!isTaipeiEfinalSpaceLayerTab(layerTab)) {
            flatSegs.forEach((seg) => {
              if (!seg?.points || seg.points.length < 2) return;
              const pts = seg.points.map(getC);
              const startK = pointKey(pts[0][0], pts[0][1]);
              const endK = pointKey(pts[pts.length - 1][0], pts[pts.length - 1][1]);
              const segRoute = seg.route_name ?? seg.name ?? 'Unknown';
              const startCd = endpointConnectMap.get(startK);
              const endCd = endpointConnectMap.get(endK);
              const startCid = connectId(startCd);
              const endCid = connectId(endCd);
              const key = startCid && endCid ? pairKey(startCid, endCid) : null;
              const info = { routeName: segRoute, startPt: pts[0], endPt: pts[pts.length - 1] };

              if (!key) {
                unmatchedSegments.push({
                  ...info,
                  reason: !startCd
                    ? '起點未配對到 ConnectData'
                    : !endCd
                      ? '終點未配對到 ConnectData'
                      : !startCid
                        ? '起點 ConnectData 無 connect_number / x_grid,y_grid'
                        : '終點 ConnectData 無 connect_number / x_grid,y_grid',
                });
                return;
              }
              const candidates = sectionBuckets.get(key) || [];
              const avail = candidates.filter((sd) => !usedSection.has(sd));
              const byRoute = avail.filter((sd) => (sd.route_name ?? '').trim() === segRoute);
              let matched =
                byRoute.length === 1
                  ? byRoute[0]
                  : byRoute.length > 1
                    ? byRoute[0]
                    : avail.length === 1
                      ? avail[0]
                      : null;
              if (!matched && avail.length > 1) {
                matched = avail.find((sd) => !(sd.route_name ?? '').trim()) || null;
              }
              if (!matched) {
                unmatchedSegments.push({
                  ...info,
                  key,
                  reason:
                    avail.length === 0
                      ? candidates.length > 0
                        ? '該路段鍵的 SectionData 已全部被其他 segment 使用'
                        : `bucket 不存在 (key: ${key})`
                      : `同鍵多筆且無法依 route_name「${segRoute}」唯一對應`,
                });
                return;
              }
              usedSection.add(matched);

              const connectSids = new Set();
              if (matched.connect_start?.station_id)
                connectSids.add(matched.connect_start.station_id);
              if (matched.connect_end?.station_id) connectSids.add(matched.connect_end.station_id);
              const stList = (matched.station_list || []).filter(
                (s) => !s.station_id || !connectSids.has(s.station_id)
              );
              if (stList.length === 0) {
                unmatchedSegments.push({
                  ...info,
                  reason: '已配對 SectionData，但 station_list 過濾後為空',
                });
                return;
              }
              // 依 connect_start / connect_end 確保 poly 方向與 station_list 一致，避免黑點畫反
              const sdStartCd = resolveConnect(matched.connect_start, null);
              const sdEndCd = resolveConnect(matched.connect_end, null);
              let poly = segmentPoly(seg);
              if (
                sdStartCd &&
                sdEndCd &&
                connectId(startCd) === connectId(sdEndCd) &&
                connectId(endCd) === connectId(sdStartCd)
              ) {
                poly = [...poly].reverse();
              }
              actualBlackCount += placeBlackAlongPoly(poly, stList);
            });

            const unusedSections = sectionData.filter((sd) => !usedSection.has(sd));
            if (unusedSections.length > 0) {
              console.warn(
                `[車站配置] ⚠️ 有 ${unusedSections.length} 筆 SectionData 未被任何畫面上的 segment 使用（常見於 reconfigure 切段後 segment 數與儲存時不同，請再按「儲存車站資訊」）`,
                unusedSections.map((s) => ({
                  route_name: s.route_name,
                  nStations: (s.station_list || []).length,
                }))
              );
            }
            if (unmatchedSegments.length > 0) {
              console.warn(
                `[車站配置] ⚠️ ${unmatchedSegments.length} 個畫面上的 segment 無法配對 SectionData：`,
                unmatchedSegments
              );
            }
            if (!isTaipeiTestCLayerTab(layerTab) && expectedBlackCount !== actualBlackCount) {
              console.error(
                `[車站配置] 🚨 重大 bug：原始黑點數 ${expectedBlackCount} 與重新配置後黑點數 ${actualBlackCount} 不符`,
                {
                  expectedBlackCount,
                  actualBlackCount,
                  unmatchedCount: unmatchedSegments.length,
                  unusedSectionCount: unusedSections.length,
                }
              );
            }
          }
        }
      }
    }

    // taipei_c／c2：黑點沿路段弧長位置繪製（與 JSON StationData 座標同源，100% 在路線上）
    if (isTaipeiTestCLayerTab(layerTab)) {
      const stLayerC = dataStore.findLayerById(layerTab);
      if (stLayerC && Array.isArray(stLayerC.spaceNetworkGridJsonData)) {
        const rawPl = collectStationPlacementPoints(stLayerC).filter((p) => p.kind === 'station');
        const seenBlack = new Set();
        for (const p of rawPl) {
          const id = p.meta?.station_id ?? p.meta?.tags?.station_id;
          const dedupeKey =
            id != null && String(id).trim() !== ''
              ? `id:${String(id).trim()}`
              : `pos:${String(p.name ?? '')}|${Number(p.x).toFixed(5)},${Number(p.y).toFixed(5)}`;
          if (seenBlack.has(dedupeKey)) continue;
          seenBlack.add(dedupeKey);
          const x = Number(p.x);
          const y = Number(p.y);
          const [px, py] = reducedPlotMapper ? reducedPlotMapper(x, y) : [x, y];

          const hb = dataStore.highlightedBlackStation;
          const coordEps = 0.08;
          const props = p.meta || {};
          const tags = props.tags || {};
          const sid = props.station_id ?? tags.station_id;
          const hbSid = hb?.stationId;
          const isBlackHighlighted =
            hb &&
            hb.layerId === layerTab &&
            (hbSid != null && String(hbSid).trim() !== ''
              ? String(sid ?? '').trim() === String(hbSid).trim()
              : Math.abs(Number(x) - Number(hb.x)) < coordEps &&
                Math.abs(Number(y) - Number(hb.y)) < coordEps);
          const radius = isBlackHighlighted ? 5 : 1.5;
          const strokeWidth = isBlackHighlighted ? 2.5 : 1;
          const fillColor = '#000000';
          const strokeColor = isBlackHighlighted ? '#ff6600' : fillColor;

          const el = zoomGroup
            .append('circle')
            .attr('cx', xScale(px))
            .attr('cy', yScale(py))
            .attr('r', radius)
            .attr('fill', fillColor)
            .attr('stroke', strokeColor)
            .attr('stroke-width', strokeWidth)
            .attr('class', isBlackHighlighted ? 'highlighted-connect-point' : '')
            .style('cursor', 'pointer');

          if (dataStore.showBlackDotStationNames) {
            let arcLabel = (props.station_name ?? tags.station_name ?? tags.name ?? '')
              .toString()
              .trim();
            if (arcLabel) {
              zoomGroup
                .append('text')
                .attr('x', xScale(px))
                .attr('y', yScale(py) - radius - 4)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'bottom')
                .attr('font-size', '10px')
                .attr('font-weight', 'bold')
                .attr('fill', '#1a1a1a')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 0.35)
                .attr('paint-order', 'stroke')
                .style('pointer-events', 'none')
                .text(arcLabel);
            }
          }

          el.on('mouseover', function (event) {
            d3.select(this)
              .attr('r', isBlackHighlighted ? 5 : 3)
              .attr('stroke-width', 2);
            const dispFmt = (v) =>
              typeof v === 'number' && v.toFixed
                ? taipeiCReducedOverlayDraw
                  ? String(Math.round(v))
                  : v.toFixed(2)
                : v;
            const parts = [`<strong>座標（刪減後）:</strong> (${dispFmt(x)}, ${dispFmt(y)})`];
            const sname = props.station_name ?? tags.station_name;
            if (sid !== undefined && sid !== '') parts.push(`<strong>站點ID:</strong> ${sid}`);
            if (sname !== undefined && sname !== '')
              parts.push(`<strong>站點名稱:</strong> ${sname}`);
            parts.push(`<strong>來源:</strong> 路段弧長（與 StationData 座標同源）`);
            tooltip
              .html(parts.join('<br>'))
              .style('opacity', 1)
              .style('left', event.pageX + 10 + 'px')
              .style('top', event.pageY - 10 + 'px');
          })
            .on('mousemove', function (event) {
              tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 10 + 'px');
            })
            .on('mouseout', function () {
              d3.select(this).attr('r', radius).attr('stroke-width', strokeWidth);
              tooltip.style('opacity', 0);
            });
        }
      }
    }

    // taipei_e／e2／taipei_f／taipei_g：黑點以 StationData 座標繪製（d→e 縮減後；f／g 層載入 e_final JSON 與 e 同源）
    if (isTaipeiTestELayerTab(layerTab) || isTaipeiEfinalSpaceLayerTab(layerTab)) {
      const stLayerE = dataStore.findLayerById(layerTab);
      if (
        stLayerE?.showStationPlacement &&
        Array.isArray(stLayerE.spaceNetworkGridJsonData_StationData)
      ) {
        // taipei_g：預建站名查詢 ctx 供黑點 tooltip 補查
        const _stationDataE = stLayerE.spaceNetworkGridJsonData_StationData;
        const _connectDataE = stLayerE.spaceNetworkGridJsonData_ConnectData || [];
        const _sectionDataE = stLayerE.spaceNetworkGridJsonData_SectionData || [];
        const taipeiFBlackCtx = isTaipeiEfinalSpaceLayerTab(layerTab)
          ? {
              connectNumberToNameId: buildConnectNumberToNameIdMap(_connectDataE, _sectionDataE),
              connectGridKeyToNameId: buildConnectGridKeyToNameIdMap(_connectDataE, _sectionDataE),
              sectionRouteGridNameIdMap: buildSectionRouteGridNameIdMap(_sectionDataE),
              sectionGridKeyToNameIdMap: buildSectionGridKeyToNameIdMap(_sectionDataE),
              blackLabelsByGrid: buildBlackStationDisplayByGrid(_stationDataE),
              stationData: _stationDataE,
              connectData: _connectDataE,
            }
          : null;

        const rows = collectLineStationGridPointsFromStationData(
          stLayerE.spaceNetworkGridJsonData_StationData
        );
        // taipei_f 灰底：即「紅點間路段」SectionData 清單內、Control 向心／SectionData-only 位移會處理的黑點。
        // station_list 身分鍵 ∪ 列入路段最短路徑格（與 layer 滑動邏輯同源；含無 id／站名之端點格）。
        layerStationsTowardSchematicCenter.ensureTaipeiFListedGrayHighlightSnapshot(stLayerE);
        const taipeiFListedGrayCtx = isTaipeiTestFLayerTab(layerTab)
          ? {
              stationKeySet:
                Array.isArray(_sectionDataE) && _sectionDataE.length > 0
                  ? (stLayerE._taipeiFListedGrayStationKeySet ??
                    layerStationsTowardSchematicCenter.buildListedSectionStationKeySet(
                      _sectionDataE,
                      stLayerE
                    ))
                  : null,
              routeCellKeySet:
                stLayerE._taipeiFListedGrayRouteCellKeySet ??
                buildListedSectionRouteGridCellKeySet(stLayerE),
            }
          : null;
        for (const row of rows) {
          const x = Number(row.x);
          const y = Number(row.y);
          // 與 drawRoutePath／drawDot 一致：taipei_g 時站點在格線交點 (ix, iy)
          let px;
          let py;
          if (reducedPlotMapper) {
            [px, py] = reducedPlotMapper(x, y);
          } else {
            px = x;
            py = y;
          }

          const gridKeyXY = `${Math.round(Number(x))},${Math.round(Number(y))}`;
          const isListedSectionStationGray =
            taipeiFListedGrayCtx != null &&
            ((taipeiFListedGrayCtx.stationKeySet &&
              layerStationsTowardSchematicCenter.isLineStationRowOnListedSectionKeySet(
                row,
                taipeiFListedGrayCtx.stationKeySet
              )) ||
              (taipeiFListedGrayCtx.routeCellKeySet &&
                taipeiFListedGrayCtx.routeCellKeySet.has(gridKeyXY)));

          const hb = dataStore.highlightedBlackStation;
          const coordEps = 0.08;
          const props = row.meta || {};
          const tags = props.tags || {};
          const sid = props.station_id ?? tags.station_id;
          const hbSid = hb?.stationId;
          const isBlackHighlighted =
            (hb &&
              hb.layerId === layerTab &&
              (hbSid != null && String(hbSid).trim() !== ''
                ? String(sid ?? '').trim() === String(hbSid).trim()
                : Math.abs(Number(x) - Number(hb.x)) < coordEps &&
                  Math.abs(Number(y) - Number(hb.y)) < coordEps)) ||
            matchH2TrafficBlack(x, y, sid);
          const radius = isBlackHighlighted ? 5 : 1.5;
          const strokeWidth = isBlackHighlighted ? 2.5 : 1;
          const fillColor = '#000000';
          const hlColor =
            isBlackHighlighted && hb?.color && typeof hb.color === 'string' ? hb.color : '#ff6600';
          const strokeColor = isBlackHighlighted ? hlColor : fillColor;

          if (isListedSectionStationGray) {
            zoomGroup
              .append('circle')
              .attr('cx', xScale(px))
              .attr('cy', yScale(py))
              .attr('r', 4.5)
              .attr('fill', '#9e9e9e')
              .attr('opacity', 0.5)
              .style('pointer-events', 'none');
          }

          const el = zoomGroup
            .append('circle')
            .attr('cx', xScale(px))
            .attr('cy', yScale(py))
            .attr('r', radius)
            .attr('fill', fillColor)
            .attr('stroke', strokeColor)
            .attr('stroke-width', strokeWidth)
            .attr('class', isBlackHighlighted ? 'highlighted-connect-point' : '')
            .style('cursor', 'pointer');

          if (dataStore.showBlackDotStationNames) {
            let snameLabel = (props.station_name ?? tags.station_name ?? tags.name ?? '')
              .toString()
              .trim();
            if (isTaipeiEfinalSpaceLayerTab(layerTab) && taipeiFBlackCtx) {
              const routeHintForRes = String(tags.route_hint ?? props.route_hint ?? '').trim();
              const filled = resolveTaipeiFStationNameAndId(props, {
                ...taipeiFBlackCtx,
                routeName: routeHintForRes,
              });
              if (!snameLabel) snameLabel = (filled.station_name ?? '').toString().trim();
            }
            if (snameLabel) {
              zoomGroup
                .append('text')
                .attr('x', xScale(px))
                .attr('y', yScale(py) - radius - 4)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'bottom')
                .attr('font-size', '10px')
                .attr('font-weight', 'bold')
                .attr('fill', '#1a1a1a')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 0.35)
                .attr('paint-order', 'stroke')
                .style('pointer-events', 'none')
                .text(snameLabel);
            }
          }

          el.on('mouseover', function (event) {
            d3.select(this)
              .attr('r', isBlackHighlighted ? 5 : 3)
              .attr('stroke-width', 2);
            const dispFmt = (v) => (typeof v === 'number' && v.toFixed ? String(Math.round(v)) : v);
            const parts = [
              `<strong>座標（縮減後 ix′, iy′）:</strong> (${dispFmt(x)}, ${dispFmt(y)})`,
            ];
            let snameBlack = (props.station_name ?? tags.station_name ?? tags.name ?? '').trim();
            let sidBlack = (sid ?? '').toString().trim();
            // taipei_g：同時補齊站名與站點ID（含 Section 全格點表、tags.route_hint 路線）
            if (isTaipeiEfinalSpaceLayerTab(layerTab) && taipeiFBlackCtx) {
              const routeHint = String(tags.route_hint ?? '').trim();
              const filled = resolveTaipeiFStationNameAndId(props, {
                ...taipeiFBlackCtx,
                routeName: routeHint,
              });
              if (!snameBlack) snameBlack = filled.station_name;
              if (!sidBlack) sidBlack = filled.station_id;
            }
            if (sidBlack !== undefined && sidBlack !== '')
              parts.push(`<strong>站點ID:</strong> ${sidBlack}`);
            if (snameBlack !== undefined && snameBlack !== '')
              parts.push(`<strong>站名:</strong> ${snameBlack}`);
            parts.push(
              `<strong>來源:</strong> StationData（d→e 縮減網格後${
                isTaipeiTestFLayerTab(layerTab)
                  ? '；f 與 e 下載 JSON 同源'
                  : isTaipeiTestILayerTab(layerTab)
                    ? '；i 路網上顯示權重（無權重網格縮放）'
                    : isTaipeiGOrHWeightLayer(layerTab)
                      ? '；g／h 與 e 下載 JSON 同源'
                      : ''
              }）`
            );
            tooltip
              .html(parts.join('<br>'))
              .style('opacity', 1)
              .style('left', event.pageX + 10 + 'px')
              .style('top', event.pageY - 10 + 'px');
          })
            .on('mousemove', function (event) {
              tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 10 + 'px');
            })
            .on('mouseout', function () {
              d3.select(this).attr('r', radius).attr('stroke-width', strokeWidth);
              tooltip.style('opacity', 0);
            });
        }
      }
    }

    // taipei_d／d2：黑點以 StationData 座標繪製（execute_c_to_d_test 向心滑動結果）
    if (isTaipeiTestDLayerTab(layerTab)) {
      const stLayerD = dataStore.findLayerById(layerTab);
      if (stLayerD && Array.isArray(stLayerD.spaceNetworkGridJsonData_StationData)) {
        const rows = collectLineStationGridPointsFromStationData(
          stLayerD.spaceNetworkGridJsonData_StationData
        );
        for (const row of rows) {
          const x = Number(row.x);
          const y = Number(row.y);
          const [px, py] = reducedPlotMapper ? reducedPlotMapper(x, y) : [x, y];

          const hb = dataStore.highlightedBlackStation;
          const coordEps = 0.08;
          const props = row.meta || {};
          const tags = props.tags || {};
          const sid = props.station_id ?? tags.station_id;
          const hbSid = hb?.stationId;
          const isBlackHighlighted =
            hb &&
            hb.layerId === layerTab &&
            (hbSid != null && String(hbSid).trim() !== ''
              ? String(sid ?? '').trim() === String(hbSid).trim()
              : Math.abs(Number(x) - Number(hb.x)) < coordEps &&
                Math.abs(Number(y) - Number(hb.y)) < coordEps);
          const radius = isBlackHighlighted ? 5 : 1.5;
          const strokeWidth = isBlackHighlighted ? 2.5 : 1;
          const fillColor = '#000000';
          const strokeColor = isBlackHighlighted ? '#ff6600' : fillColor;

          const el = zoomGroup
            .append('circle')
            .attr('cx', xScale(px))
            .attr('cy', yScale(py))
            .attr('r', radius)
            .attr('fill', fillColor)
            .attr('stroke', strokeColor)
            .attr('stroke-width', strokeWidth)
            .attr('class', isBlackHighlighted ? 'highlighted-connect-point' : '')
            .style('cursor', 'pointer');

          el.on('mouseover', function (event) {
            d3.select(this)
              .attr('r', isBlackHighlighted ? 5 : 3)
              .attr('stroke-width', 2);
            const dispFmt = (v) =>
              typeof v === 'number' && v.toFixed
                ? taipeiCReducedOverlayDraw
                  ? String(Math.round(v))
                  : v.toFixed(2)
                : v;
            const parts = [`<strong>座標（刪減後）:</strong> (${dispFmt(x)}, ${dispFmt(y)})`];
            const sname = props.station_name ?? tags.station_name;
            if (sid !== undefined && sid !== '') parts.push(`<strong>站點ID:</strong> ${sid}`);
            if (sname !== undefined && sname !== '') parts.push(`<strong>站名:</strong> ${sname}`);
            parts.push(`<strong>來源:</strong> StationData（d 網格向心正規化）`);
            tooltip
              .html(parts.join('<br>'))
              .style('opacity', 1)
              .style('left', event.pageX + 10 + 'px')
              .style('top', event.pageY - 10 + 'px');
          })
            .on('mousemove', function (event) {
              tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 10 + 'px');
            })
            .on('mouseout', function () {
              d3.select(this).attr('r', radius).attr('stroke-width', strokeWidth);
              tooltip.style('opacity', 0);
            });
        }
      }
    }

    // 🎯 繪製路段高亮覆蓋層（taipei_a：串接Flip L 型，依 hvFlipNextIndex 選中）
    if (isNormalizeFormat) {
      const activeLayer = dataStore.findLayerById(layerTab);
      const routesData = activeLayer?.spaceNetworkGridJsonData;
      let layoutData = Array.isArray(routesData) ? routesData : [];
      if (layoutData.length > 0 && layoutData[0]?.segments && !layoutData[0]?.points) {
        layoutData = layoutData.flatMap((r) =>
          (r.segments || []).map((s) => ({ ...s, name: r.route_name || r.name || 'Unknown' }))
        );
      }
      const straightSegments = buildStraightSegments(layoutData);
      const totalL = Math.max(0, (straightSegments?.length ?? 0) - 1);

      let segStartIdx = null;
      if (
        isTaipeiTestStraighteningLayerId(activeLayer?.layerId) &&
        totalL > 0 &&
        dataStore.connectFlipOverlayVisible
      ) {
        segStartIdx = dataStore.hvFlipNextIndex % totalL;
      }

      if (segStartIdx !== null && segStartIdx !== undefined && segStartIdx >= 0) {
        const seg = straightSegments[segStartIdx];
        const segNext = straightSegments[segStartIdx + 1];
        const EPS = 1e-4;
        const samePoint = (a, b) =>
          a && b && Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
        const isConnected =
          seg &&
          segNext &&
          seg.points?.length >= 2 &&
          segNext.points?.length >= 2 &&
          samePoint(seg.points[1], segNext.points[0]);
        const lShapePoints = isConnected ? [seg.points[0], seg.points[1], segNext.points[1]] : null;
        if (lShapePoints && lShapePoints.length >= 3) {
          // 選中的 L 型路線：高亮（金黃實線）
          const pathData = lineGenerator(lShapePoints);
          if (pathData) {
            zoomGroup
              .append('path')
              .attr('class', 'highlight-segment-overlay')
              .attr('d', pathData)
              .attr('stroke', '#FFD700')
              .attr('fill', 'none')
              .attr('stroke-width', '10pt')
              .attr('opacity', 0.55)
              .style('pointer-events', 'none');
          }
          // Flip 路線：可行＝綠虛線，不可行＝紅虛線（串接Flip L型 用放寬規則）
          const [a, b, c] = lShapePoints;
          const d = [a[0] + c[0] - b[0], a[1] + c[1] - b[1]];
          const connectFlipOptions = {
            skipConnectMove: true,
            skipCrossing: true,
            useRectangleOtherRouteCheck: true,
          };
          const { flipColor } = computeFlipAnalysis(
            straightSegments,
            segStartIdx,
            layoutData,
            connectFlipOptions
          );
          const flipPathData = lineGenerator([a, d, c]);
          if (flipPathData) {
            zoomGroup
              .append('path')
              .attr('class', 'highlight-flip-overlay')
              .attr('d', flipPathData)
              .attr('stroke', flipColor)
              .attr('fill', 'none')
              .attr('stroke-width', '6pt')
              .attr('stroke-dasharray', '8,5')
              .attr('opacity', 0.7)
              .style('pointer-events', 'none');
          }
          lShapePoints.forEach((coord) => {
            zoomGroup
              .append('circle')
              .attr('class', 'highlight-endpoint-overlay')
              .attr('cx', xScale(coord[0]))
              .attr('cy', yScale(coord[1]))
              .attr('r', 7)
              .attr('fill', 'rgba(255, 215, 0, 0.85)')
              .attr('stroke', '#FF8800')
              .attr('stroke-width', 2)
              .style('pointer-events', 'none');
          });
        }
      }
    }

    // 🎯 繪製 ㄈ 型高亮覆蓋層（taipei_a：ㄈ縮減 依 nShapeNextIndex 選中）
    if (
      isNormalizeFormat &&
      isTaipeiTestStraighteningLayerId(layerTab) &&
      dataStore.nShapeOverlayVisible
    ) {
      const nLayer = dataStore.findLayerById(layerTab);
      const nRoutesData = nLayer?.spaceNetworkGridJsonData;
      let nLayoutData = Array.isArray(nRoutesData) ? nRoutesData : [];
      if (nLayoutData.length > 0 && nLayoutData[0]?.segments && !nLayoutData[0]?.points) {
        nLayoutData = nLayoutData.flatMap((r) =>
          (r.segments || []).map((s) => ({ ...s, name: r.route_name || r.name || 'Unknown' }))
        );
      }
      const nStraightSegs = buildStraightSegments(nLayoutData);
      const nList = buildNShapeList(nStraightSegs);
      if (nList.length > 0) {
        const nIdx = dataStore.nShapeNextIndex % nList.length;
        const segStartIdx = nList[nIdx];
        const s0 = nStraightSegs[segStartIdx];
        const s1 = nStraightSegs[segStartIdx + 1];
        const s2 = nStraightSegs[segStartIdx + 2];
        const EPS2 = 1e-4;
        const sameP = (a, b) =>
          a && b && Math.abs(a[0] - b[0]) < EPS2 && Math.abs(a[1] - b[1]) < EPS2;
        if (
          s0?.points?.length >= 2 &&
          s1?.points?.length >= 2 &&
          s2?.points?.length >= 2 &&
          sameP(s0.points[1], s1.points[0]) &&
          sameP(s1.points[1], s2.points[0])
        ) {
          const a = s0.points[0],
            b = s0.points[1],
            c = s1.points[1],
            d = s2.points[1];
          const REDUCE_N_OPT = {
            skipConnectMove: true,
            skipCrossing: true,
            useRectangleOtherRouteCheck: true,
          };
          const analysis = computeNShapeAnalysis(nStraightSegs, segStartIdx, REDUCE_N_OPT);
          const { reduceColor, newCorner: e } = analysis;

          // 金黃實線高亮：ㄈ 型現狀 A->B->C->D
          const nShapePath = lineGenerator([a, b, c, d]);
          if (nShapePath) {
            zoomGroup
              .append('path')
              .attr('class', 'highlight-nshape-overlay')
              .attr('d', nShapePath)
              .attr('stroke', '#FFD700')
              .attr('fill', 'none')
              .attr('stroke-width', '10pt')
              .attr('opacity', 0.55)
              .style('pointer-events', 'none');
          }
          // 虛線：縮減後的 L 型 A->E->D
          if (e) {
            const lPath = lineGenerator([a, e, d]);
            if (lPath) {
              zoomGroup
                .append('path')
                .attr('class', 'highlight-nshape-reduce-overlay')
                .attr('d', lPath)
                .attr('stroke', reduceColor)
                .attr('fill', 'none')
                .attr('stroke-width', '6pt')
                .attr('stroke-dasharray', '8,5')
                .attr('opacity', 0.7)
                .style('pointer-events', 'none');
            }
          }
          // 標示 4 個頂點
          for (const coord of [a, b, c, d]) {
            zoomGroup
              .append('circle')
              .attr('class', 'highlight-nshape-endpoint-overlay')
              .attr('cx', xScale(coord[0]))
              .attr('cy', yScale(coord[1]))
              .attr('r', 7)
              .attr('fill', 'rgba(255, 215, 0, 0.85)')
              .attr('stroke', '#FF8800')
              .attr('stroke-width', 2)
              .style('pointer-events', 'none');
          }
        }
      }
    }

    // 診斷高亮：只畫重疊區段，hover 顯示轉折點數
    if (
      isNormalizeFormat &&
      Array.isArray(dataStore.overlappingSegmentRanges) &&
      dataStore.overlappingSegmentRanges.length > 0
    ) {
      const overlapLineGen = d3
        .line()
        .x((d) => xScale(d[0]))
        .y((d) => yScale(d[1]));
      const overlapGroup = zoomGroup.append('g').attr('class', 'overlapping-segments-overlay');
      dataStore.overlappingSegmentRanges.forEach((range) => {
        const pts = range.points;
        if (!Array.isArray(pts) || pts.length < 2) return;
        const pathData = overlapLineGen(pts);
        if (!pathData) return;
        const turnCounts = range.turnCounts || [];
        const displayText =
          turnCounts.length === 0
            ? '這一個路段的轉折點數：—'
            : turnCounts.length === 1
              ? `這一個路段的轉折點數：${turnCounts[0].turnCount}`
              : `這一個路段的轉折點數：${turnCounts.map((t) => `${t.routeName} ${t.turnCount}`).join('；')}`;
        overlapGroup
          .append('path')
          .attr('d', pathData)
          .attr('stroke', '#e60000')
          .attr('fill', 'none')
          .attr('stroke-width', '8pt')
          .attr('opacity', 0.75)
          .attr('title', displayText)
          .style('pointer-events', 'stroke')
          .style('cursor', 'pointer')
          .on('mouseover', function (event) {
            d3.select('body').selectAll('.d3js-map-tooltip').remove();
            d3.select('body')
              .append('div')
              .attr('class', 'd3js-map-tooltip')
              .style('position', 'absolute')
              .style('z-index', 1000)
              .style('background', 'rgba(0,0,0,0.85)')
              .style('color', '#fff')
              .style('padding', '6px 10px')
              .style('border-radius', '4px')
              .style('font-size', '12px')
              .style('pointer-events', 'none')
              .style('left', `${event.pageX + 10}px`)
              .style('top', `${event.pageY + 10}px`)
              .text(displayText);
          })
          .on('mousemove', function (event) {
            d3.select('.d3js-map-tooltip')
              .style('left', `${event.pageX + 10}px`)
              .style('top', `${event.pageY + 10}px`);
          })
          .on('mouseout', function () {
            d3.select('body').selectAll('.d3js-map-tooltip').remove();
          });
      });
    }

    // taipei_c／d／e（含測試2）／f：繪圖座標空間之幾何中心十字參考線（與 xScale／yScale 定義域一致）
    if (
      isNormalizeFormat &&
      (isTaipeiTestCDELayerTab(layerTab) || isTaipeiTestFLayerTab(layerTab)) &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax)
    ) {
      const crossCx = (xMin + xMax) / 2;
      const crossCy = (yMin + yMax) / 2;
      const crossG = zoomGroup
        .append('g')
        .attr('class', 'schematic-center-cross')
        .style('pointer-events', 'none');
      crossG
        .append('line')
        .attr('x1', xScale(crossCx))
        .attr('y1', margin.top)
        .attr('x2', xScale(crossCx))
        .attr('y2', margin.top + height)
        .attr('stroke', '#0046E3')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '5 4')
        .attr('opacity', 0.65);
      crossG
        .append('line')
        .attr('x1', margin.left)
        .attr('y1', yScale(crossCy))
        .attr('x2', margin.left + width)
        .attr('y2', yScale(crossCy))
        .attr('stroke', '#0046E3')
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '5 4')
        .attr('opacity', 0.65);
    }

    // 手繪網路線「執行下一步」：以包圍盒對齊目前圖幅資料域之疊加層（與既有路網同一 xScale／yScale）
    const sketchOv = dataStore.networkDrawSketchGridOverlay;
    if (
      sketchOv &&
      sketchOv.layerId === activeLayerTab.value &&
      Array.isArray(sketchOv.polylinesNorm) &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax)
    ) {
      const xSpan = xMax - xMin || 1;
      const ySpan = yMax - yMin || 1;
      const sketchLine = d3
        .line()
        .x((d) => xScale(xMin + d[0] * xSpan))
        .y((d) => yScale(yMax - d[1] * ySpan))
        .curve(d3.curveLinear);
      const gSk = zoomGroup
        .append('g')
        .attr('class', 'network-draw-sketch-grid-overlay')
        .style('pointer-events', 'none');
      for (const pl of sketchOv.polylinesNorm) {
        if (!pl || pl.length < 2) continue;
        const pts = [];
        for (const p of pl) {
          const nx = Number(p.nx);
          const ny = Number(p.ny);
          if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
          pts.push([nx, ny]);
        }
        if (pts.length < 2) continue;
        const dPath = sketchLine(pts);
        if (!dPath) continue;
        gSk
          .append('path')
          .attr('d', dPath)
          .attr('fill', 'none')
          .attr('stroke', '#c51162')
          .attr('stroke-width', 3)
          .attr('stroke-dasharray', '10,6')
          .attr('opacity', 0.92);
      }
    }

    // 手繪匯出之紅（交叉）／藍（懸空端）／綠（相接端）圓點（與 NetworkDrawTab 同色同半徑）；寫在目前分頁圖層之 networkDrawSketchMarkersPlot
    const sketchMarkersLayerForTab = dataStore.findLayerById(layerTab);
    const plotPts = sketchMarkersLayerForTab?.networkDrawSketchMarkersPlot;
    if (
      Array.isArray(plotPts) &&
      plotPts.length > 0 &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      Number.isFinite(yMin) &&
      Number.isFinite(yMax)
    ) {
      const gMk = zoomGroup
        .append('g')
        .attr('class', 'network-draw-export-markers')
        .style('pointer-events', 'none');
      for (const m of plotPts) {
        if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
        gMk
          .append('circle')
          .attr('cx', xScale(m.x))
          .attr('cy', yScale(m.y))
          .attr('r', m.r != null && Number.isFinite(Number(m.r)) ? Number(m.r) : 4)
          .attr('fill', m.fill || '#333333')
          .attr('stroke', m.stroke || '#ffffff')
          .attr('stroke-width', 1);
      }
    }

    // point_orthogonal／temp／先直後橫 VH 繪製：Control「下一頂點」— 橘圈；temp「朝紅十字」列＝橘線／點，欄＝藍虛線／點；VH 另支援 orthoBundle（L 形青線）
    if (
      layerTab === POINT_ORTHOGONAL_LAYER_ID ||
      layerTab === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
      isLineOrthogonalTowardCenterLayerId(layerTab) ||
      isSpaceGridVhDrawFamilyLayerId(layerTab)
    ) {
      const hlLayer = dataStore.findLayerById(layerTab);
      const hl = hlLayer?.highlightedSegmentIndex;
      /** 橘圈：作用中分頁無 [seg,pt] 時，改讀可見之「紅藍點列表」層（Control 在該層操作時仍顯示於座標正規化／垂直化等分頁） */
      const rbConnectVertexHlLayer = (() => {
        const tabL = hlLayer;
        const hTab = tabL?.highlightedSegmentIndex;
        if (
          Array.isArray(hTab) &&
          hTab.length >= 2 &&
          Number.isFinite(Number(hTab[0])) &&
          Number.isFinite(Number(hTab[1]))
        ) {
          return tabL;
        }
        const rb = dataStore.findLayerById(COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID);
        if (!rb?.visible) return tabL;
        const hRb = rb.highlightedSegmentIndex;
        if (
          !Array.isArray(hRb) ||
          hRb.length < 2 ||
          !Number.isFinite(Number(hRb[0])) ||
          !Number.isFinite(Number(hRb[1]))
        ) {
          return tabL;
        }
        if (
          layerTab === JSON_GRID_COORD_NORMALIZED_LAYER_ID ||
          layerTab === POINT_ORTHOGONAL_LAYER_ID ||
          layerTab === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
          isLineOrthogonalTowardCenterLayerId(layerTab)
        ) {
          return rb;
        }
        return tabL;
      })();
      /** temp「朝紅十字」列／欄：列＝橘實線；欄＝藍虛線（便於區分水平／垂直階段）。 */
      const towardCrossAxis = isLineOrthogonalTowardCenterLayerId(layerTab)
        ? hlLayer?.lineOrthoTowardCrossHighlightTableAxis
        : null;
      const isColTowardCrossHl = towardCrossAxis === 'col';
      const towardCrossLineStroke = isColTowardCrossHl ? '#0d47a1' : '#ff6600';
      const towardCrossLineDash = isColTowardCrossHl ? '10,5' : null;
      const towardCrossPtFill = isColTowardCrossHl
        ? 'rgba(13, 71, 161, 0.28)'
        : 'rgba(255, 152, 0, 0.28)';
      const towardCrossPtStroke = isColTowardCrossHl ? '#0d47a1' : '#ff6600';

      const orthoBundleLineStroke = isSpaceGridVhDrawFamilyLayerId(layerTab)
        ? '#00acc1'
        : towardCrossLineStroke;
      const orthoBundleLineDash = isSpaceGridVhDrawFamilyLayerId(layerTab)
        ? null
        : towardCrossLineDash;

      if (
        (isLineOrthogonalTowardCenterLayerId(layerTab) ||
          isSpaceGridVhDrawFamilyLayerId(layerTab)) &&
        hlLayer &&
        Array.isArray(hl) &&
        hl[0] === 'orthoBundle' &&
        Array.isArray(hl[1])
      ) {
        const resolved = resolveB3InputSpaceNetwork(hlLayer, { routeLineFromExportRows: 'full' });
        const flat =
          resolved?.spaceNetwork?.length > 0
            ? normalizeSpaceNetworkDataToFlatSegments(
                JSON.parse(JSON.stringify(resolved.spaceNetwork))
              )
            : [];
        const lines = hl[1];
        for (let li = 0; li < lines.length; li++) {
          const spec = lines[li];
          if (!Array.isArray(spec) || spec[0] !== 'ortho' || spec.length < 4) continue;
          const si = Number(spec[1]);
          const e0 = Number(spec[2]);
          const e1 = Number(spec[3]);
          const seg = flat[si];
          const pts = seg?.points;
          if (
            Array.isArray(pts) &&
            Number.isFinite(e0) &&
            Number.isFinite(e1) &&
            e0 <= e1 &&
            e1 < pts.length - 1
          ) {
            const pA = pts[e0];
            const pB = pts[e1 + 1];
            const gx0 = Array.isArray(pA) ? Number(pA[0]) : Number(pA?.x);
            const gy0 = Array.isArray(pA) ? Number(pA[1]) : Number(pA?.y);
            const gx1 = Array.isArray(pB) ? Number(pB[0]) : Number(pB?.x);
            const gy1 = Array.isArray(pB) ? Number(pB[1]) : Number(pB?.y);
            if (
              Number.isFinite(gx0) &&
              Number.isFinite(gy0) &&
              Number.isFinite(gx1) &&
              Number.isFinite(gy1)
            ) {
              zoomGroup
                .append('g')
                .attr('class', 'json-grid-line-orthogonal-axis-highlight')
                .style('pointer-events', 'none')
                .append('line')
                .attr('x1', xScale(gx0))
                .attr('y1', yScale(gy0))
                .attr('x2', xScale(gx1))
                .attr('y2', yScale(gy1))
                .attr('stroke', orthoBundleLineStroke)
                .attr('stroke-width', 5)
                .attr('stroke-dasharray', orthoBundleLineDash ?? '')
                .attr('stroke-linecap', 'round')
                .attr('stroke-linejoin', 'round')
                .attr('fill', 'none');
            }
          }
        }
      }

      if (
        isLineOrthogonalTowardCenterLayerId(layerTab) &&
        hlLayer &&
        Array.isArray(hl) &&
        hl[0] === 'ortho' &&
        hl.length >= 4
      ) {
        const resolved = resolveB3InputSpaceNetwork(hlLayer, { routeLineFromExportRows: 'full' });
        const flat =
          resolved?.spaceNetwork?.length > 0
            ? normalizeSpaceNetworkDataToFlatSegments(
                JSON.parse(JSON.stringify(resolved.spaceNetwork))
              )
            : [];
        const si = Number(hl[1]);
        const e0 = Number(hl[2]);
        const e1 = Number(hl[3]);
        const seg = flat[si];
        const pts = seg?.points;
        if (
          Array.isArray(pts) &&
          Number.isFinite(e0) &&
          Number.isFinite(e1) &&
          e0 <= e1 &&
          e1 < pts.length - 1
        ) {
          const pA = pts[e0];
          const pB = pts[e1 + 1];
          const gx0 = Array.isArray(pA) ? Number(pA[0]) : Number(pA?.x);
          const gy0 = Array.isArray(pA) ? Number(pA[1]) : Number(pA?.y);
          const gx1 = Array.isArray(pB) ? Number(pB[0]) : Number(pB?.x);
          const gy1 = Array.isArray(pB) ? Number(pB[1]) : Number(pB?.y);
          if (
            Number.isFinite(gx0) &&
            Number.isFinite(gy0) &&
            Number.isFinite(gx1) &&
            Number.isFinite(gy1)
          ) {
            zoomGroup
              .append('g')
              .attr('class', 'json-grid-line-orthogonal-axis-highlight')
              .style('pointer-events', 'none')
              .append('line')
              .attr('x1', xScale(gx0))
              .attr('y1', yScale(gy0))
              .attr('x2', xScale(gx1))
              .attr('y2', yScale(gy1))
              .attr('stroke', towardCrossLineStroke)
              .attr('stroke-width', 5)
              .attr('stroke-dasharray', towardCrossLineDash ?? '')
              .attr('stroke-linecap', 'round')
              .attr('stroke-linejoin', 'round')
              .attr('fill', 'none');
          }
        }
      }

      /** 紅藍 connect 移動：灰圈＝移動前格、青圈＝移動後格（先畫，橘圈最後疊上＝目前頂點） */
      const rbPrevLyr = dataStore.findLayerById(COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID);
      const rbMp = rbPrevLyr?.rbConnectMovePreview;
      if (
        rbMp &&
        Number.isFinite(Number(rbMp.fromGx)) &&
        Number.isFinite(Number(rbMp.fromGy)) &&
        Number.isFinite(Number(rbMp.toGx)) &&
        Number.isFinite(Number(rbMp.toGy)) &&
        (layerTab === JSON_GRID_COORD_NORMALIZED_LAYER_ID ||
          layerTab === POINT_ORTHOGONAL_LAYER_ID ||
          layerTab === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
          isLineOrthogonalTowardCenterLayerId(layerTab))
      ) {
        const fgx = Math.round(Number(rbMp.fromGx));
        const fgy = Math.round(Number(rbMp.fromGy));
        const tgx = Math.round(Number(rbMp.toGx));
        const tgy = Math.round(Number(rbMp.toGy));
        zoomGroup
          .append('g')
          .attr('class', 'rb-connect-move-preview-from')
          .style('pointer-events', 'none')
          .append('circle')
          .attr('cx', xScale(fgx))
          .attr('cy', yScale(fgy))
          .attr('r', 12)
          .attr('fill', 'rgba(120, 120, 120, 0.2)')
          .attr('stroke', '#616161')
          .attr('stroke-width', 3)
          .attr('stroke-dasharray', '6,4');
        zoomGroup
          .append('g')
          .attr('class', 'rb-connect-move-preview-to')
          .style('pointer-events', 'none')
          .append('circle')
          .attr('cx', xScale(tgx))
          .attr('cy', yScale(tgy))
          .attr('r', 12)
          .attr('fill', 'rgba(0, 137, 123, 0.22)')
          .attr('stroke', '#00695c')
          .attr('stroke-width', 3);
      }

      /** 本輪已 highlight／處理過的紅藍 connect 點：綠圈 */
      if (
        rbPrevLyr?.visible &&
        Array.isArray(rbPrevLyr.rbConnectVisitedKeys) &&
        rbPrevLyr.rbConnectVisitedKeys.length > 0 &&
        (layerTab === JSON_GRID_COORD_NORMALIZED_LAYER_ID ||
          layerTab === POINT_ORTHOGONAL_LAYER_ID ||
          layerTab === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
          isLineOrthogonalTowardCenterLayerId(layerTab))
      ) {
        const resolved = resolveB3InputSpaceNetwork(rbPrevLyr, { routeLineFromExportRows: 'full' });
        const flat =
          resolved?.spaceNetwork?.length > 0
            ? normalizeSpaceNetworkDataToFlatSegments(
                JSON.parse(JSON.stringify(resolved.spaceNetwork))
              )
            : [];
        const seen = new Set(rbPrevLyr.rbConnectVisitedKeys);
        for (const key of seen) {
          const [siRaw, piRaw] = String(key).split(',');
          const si = Number(siRaw);
          const pi = Number(piRaw);
          const pt = flat[si]?.points?.[pi];
          if (!pt) continue;
          const gx = Array.isArray(pt) ? Number(pt[0]) : Number(pt?.x);
          const gy = Array.isArray(pt) ? Number(pt[1]) : Number(pt?.y);
          if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
          zoomGroup
            .append('g')
            .attr('class', 'rb-connect-visited-highlight')
            .style('pointer-events', 'none')
            .append('circle')
            .attr('cx', xScale(gx))
            .attr('cy', yScale(gy))
            .attr('r', 11)
            .attr('fill', 'rgba(46, 125, 50, 0.2)')
            .attr('stroke', '#2e7d32')
            .attr('stroke-width', 3);
        }
      }

      const vhl = rbConnectVertexHlLayer?.highlightedSegmentIndex;
      if (
        rbConnectVertexHlLayer &&
        Array.isArray(vhl) &&
        vhl.length >= 2 &&
        Number.isFinite(Number(vhl[0])) &&
        Number.isFinite(Number(vhl[1]))
      ) {
        const resolved = resolveB3InputSpaceNetwork(rbConnectVertexHlLayer, {
          routeLineFromExportRows: 'full',
        });
        const flat =
          resolved?.spaceNetwork?.length > 0
            ? normalizeSpaceNetworkDataToFlatSegments(
                JSON.parse(JSON.stringify(resolved.spaceNetwork))
              )
            : [];
        const si = Number(vhl[0]);
        const pi = Number(vhl[1]);
        const seg = flat[si];
        const pt = seg?.points?.[pi];
        if (pt) {
          const gx = Array.isArray(pt) ? Number(pt[0]) : Number(pt?.x);
          const gy = Array.isArray(pt) ? Number(pt[1]) : Number(pt?.y);
          if (Number.isFinite(gx) && Number.isFinite(gy)) {
            const ptFill = isLineOrthogonalTowardCenterLayerId(layerTab)
              ? towardCrossPtFill
              : 'rgba(255, 152, 0, 0.28)';
            const ptStroke = isLineOrthogonalTowardCenterLayerId(layerTab)
              ? towardCrossPtStroke
              : '#ff6600';
            zoomGroup
              .append('g')
              .attr('class', 'json-grid-from-coord-vertex-highlight')
              .style('pointer-events', 'none')
              .append('circle')
              .attr('cx', xScale(gx))
              .attr('cy', yScale(gy))
              .attr('r', 14)
              .attr('fill', ptFill)
              .attr('stroke', ptStroke)
              .attr('stroke-width', 3.5);
          }
        }
      }

      const sg = hlLayer?.jsonGridFromCoordSuggestTargetGrid;
      const sx = sg != null ? Number(sg.x) : NaN;
      const sy = sg != null ? Number(sg.y) : NaN;
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        zoomGroup
          .append('g')
          .attr('class', 'json-grid-from-coord-suggest-highlight')
          .style('pointer-events', 'none')
          .append('circle')
          .attr('cx', xScale(sx))
          .attr('cy', yScale(sy))
          .attr('r', 14)
          .attr('fill', 'rgba(76, 175, 80, 0.22)')
          .attr('stroke', '#2e7d32')
          .attr('stroke-width', 3.5);
      }

      /** temp：最近一次「朝紅十字縮進」之格位移預覽（灰圈＝舊、青圈＝新；與線網資料一致） */
      if (isLineOrthogonalTowardCenterLayerId(layerTab) && hlLayer) {
        const mp = hlLayer.lineOrthoTowardCrossMovePreview;
        const fx = mp != null ? Number(mp.fromGx) : NaN;
        const fy = mp != null ? Number(mp.fromGy) : NaN;
        const tx = mp != null ? Number(mp.toGx) : NaN;
        const ty = mp != null ? Number(mp.toGy) : NaN;
        if (
          Number.isFinite(fx) &&
          Number.isFinite(fy) &&
          Number.isFinite(tx) &&
          Number.isFinite(ty) &&
          (fx !== tx || fy !== ty)
        ) {
          const preG = zoomGroup
            .append('g')
            .attr('class', 'line-orthogonal-toward-cross-move-preview')
            .style('pointer-events', 'none');
          preG
            .append('circle')
            .attr('cx', xScale(fx))
            .attr('cy', yScale(fy))
            .attr('r', 12)
            .attr('fill', 'rgba(97, 97, 97, 0.18)')
            .attr('stroke', '#757575')
            .attr('stroke-width', 2.5)
            .attr('stroke-dasharray', '5,4');
          preG
            .append('circle')
            .attr('cx', xScale(tx))
            .attr('cy', yScale(ty))
            .attr('r', 13)
            .attr('fill', 'rgba(0, 131, 143, 0.2)')
            .attr('stroke', '#00838f')
            .attr('stroke-width', 3);
          preG
            .append('line')
            .attr('x1', xScale(fx))
            .attr('y1', yScale(fy))
            .attr('x2', xScale(tx))
            .attr('y2', yScale(ty))
            .attr('stroke', '#546e7a')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '6,5')
            .attr('opacity', 0.85);
          preG.raise();
        }
      }

      /** temp：紅虛線十字 — 若有鎖定中心格則固定於該格，否則為繪區 bbox 幾何中點（四捨五入） */
      if (isLineOrthogonalTowardCenterLayerId(layerTab)) {
        const fc = hlLayer?.lineOrthoTowardCrossFrozenCenter;
        const useFrozen =
          fc != null && Number.isFinite(Number(fc.cx)) && Number.isFinite(Number(fc.cy));
        const bboxOk =
          Number.isFinite(xMin) &&
          Number.isFinite(xMax) &&
          Number.isFinite(yMin) &&
          Number.isFinite(yMax);
        const spanOk = bboxOk && xMax > xMin && yMax > yMin;
        if (useFrozen || (bboxOk && spanOk)) {
          const cxG = useFrozen ? Math.round(Number(fc.cx)) : Math.round((xMin + xMax) / 2);
          const cyG = useFrozen ? Math.round(Number(fc.cy)) : Math.round((yMin + yMax) / 2);
          const crossG = zoomGroup
            .append('g')
            .attr('class', 'line-orthogonal-grid-center-crosshair')
            .style('pointer-events', 'none');
          const xL = margin.left;
          const xR = margin.left + width;
          const yT = margin.top;
          const yB = margin.top + height;
          const xP = xScale(cxG);
          const yP = yScale(cyG);
          const dash = '8,5';
          const applyStrokeAttrs = (el) =>
            el
              .attr('stroke', '#e53935')
              .attr('stroke-width', 2)
              .attr('stroke-dasharray', dash)
              .attr('opacity', 0.92)
              .attr('vector-effect', 'non-scaling-stroke');
          applyStrokeAttrs(
            crossG.append('line').attr('x1', xP).attr('y1', yT).attr('x2', xP).attr('y2', yB)
          );
          applyStrokeAttrs(
            crossG.append('line').attr('x1', xL).attr('y1', yP).attr('x2', xR).attr('y2', yP)
          );
          crossG.raise();
        }
      }
    }
  };

  /**
   * 🎨 統一繪製函數 (Unified Drawing Function)
   * 根據圖層類型選擇相應的繪製方法
   */
  const drawSchematic = () => {
    const srcId = spaceGridDataLayerTabId.value;
    if (!srcId) return;
    if (isMapLayer(srcId)) {
      drawMap();
    } else if (isGridSchematicLayer(srcId)) {
      drawGridSchematic();
    } else {
      drawAdministrativeSchematic();
    }
  };

  scheduleTaipeiFDrawForMouseZoom = () => {
    if (taipeiFMouseZoomRaf) return;
    taipeiFMouseZoomRaf = requestAnimationFrame(() => {
      taipeiFMouseZoomRaf = 0;
      drawMapForceNext = true;
      drawSchematic();
    });
  };

  /**
   * 📏 調整尺寸 (Resize)
   * 響應容器尺寸變化，重新繪製示意圖
   */
  const resize = () => {
    // 確保容器存在且可見
    const container = document.getElementById(getContainerId());
    if (!container) {
      return;
    }

    // 檢查容器是否可見（寬度和高度都大於 0）
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      // 如果容器不可見，延遲執行
      setTimeout(() => {
        resize();
      }, 100);
      return;
    }

    // 先更新尺寸狀態，再重新繪製
    getDimensions();
    drawSchematic();
    refreshSpaceNetworkMinCellDimensions();
  };

  // 記錄上一次的圖層列表用於比較
  const previousLayers = ref([]);

  /**
   * 與操作分頁（ControlTab）選取對齊。
   */
  watch(
    () => dataStore.controlActiveLayerId,
    (id) => {
      if (!id) return;
      if (!visibleLayers.value.some((l) => l.layerId === id)) return;
      if (activeLayerTab.value === id) return;
      setActiveLayerTab(id);
    },
    { flush: 'post' }
  );

  /**
   * 手繪「執行下一步」後：Upper 切到 space-network-grid 時，將圖層分頁對齊目標 layerId。
   */
  watch(
    () => props.isActive,
    (on) => {
      if (!on) return;
      nextTick(() => {
        if (!dataStore.networkSketchAfterDrawSwitchLayerPending) return;
        const id =
          dataStore.networkSketchAfterDrawTargetLayerId ||
          dataStore.networkDrawSketchGridOverlay?.layerId;
        dataStore.setNetworkSketchAfterDrawSwitchLayerPending(false);
        dataStore.setNetworkSketchAfterDrawTargetLayerId(null);
        if (!id) return;
        if (visibleLayers.value.some((l) => l.layerId === id)) {
          setActiveLayerTab(id);
        }
      });
    },
    { flush: 'post' }
  );

  /**
   * 👀 監聽可見圖層變化，自動切換到新開啟的圖層分頁
   */
  watch(
    () => visibleLayers.value,
    (newLayers) => {
      // 如果沒有可見圖層，清除選中的分頁
      if (newLayers.length === 0) {
        activeLayerTab.value = null;
        previousLayers.value = [];
        return;
      }

      // 找出新增的圖層（比較新舊圖層列表）
      const previousLayerIds = previousLayers.value.map((layer) => layer.layerId);
      const newLayerIds = newLayers.map((layer) => layer.layerId);
      const addedLayerIds = newLayerIds.filter((id) => !previousLayerIds.includes(id));

      // 如果有新增的圖層，自動切換到最新新增的圖層
      if (addedLayerIds.length > 0) {
        const newestAddedLayerId = addedLayerIds[addedLayerIds.length - 1];
        activeLayerTab.value = newestAddedLayerId;
        dataStore.touchLastSpaceNetworkGridSketchTargetLayerId(newestAddedLayerId);
        emit('active-layer-change', activeLayerTab.value);
      }
      // 如果當前沒有選中分頁，或選中的分頁不在可見列表中，選中第一個
      else if (
        !activeLayerTab.value ||
        !newLayers.find((layer) => layer.layerId === activeLayerTab.value)
      ) {
        activeLayerTab.value = newLayers[0].layerId;
        dataStore.touchLastSpaceNetworkGridSketchTargetLayerId(newLayers[0].layerId);
        emit('active-layer-change', activeLayerTab.value);
      }

      // 更新記錄的圖層列表
      previousLayers.value = [...newLayers];
    },
    { deep: true, immediate: true }
  );

  /**
   * 👀 監聽活動圖層變化，載入數據並繪製示意圖
   */
  watch(
    () => activeLayerTab.value,
    async (newLayerId, oldLayerId) => {
      if (newLayerId && newLayerId !== oldLayerId) {
        if (oldLayerId === 'taipei_l3' && newLayerId !== 'taipei_l3') {
          const hb = dataStore.highlightedBlackStation;
          if (hb?.layerId === 'taipei_l3') dataStore.setHighlightedBlackStation(null);
        }
        if (oldLayerId === 'taipei_sn4_l' && newLayerId !== 'taipei_sn4_l') {
          const hb = dataStore.highlightedBlackStation;
          if (hb?.layerId === 'taipei_sn4_l') dataStore.setHighlightedBlackStation(null);
        }
        if (oldLayerId === 'taipei_l3_dp' && newLayerId !== 'taipei_l3_dp') {
          const hb = dataStore.highlightedBlackStation;
          if (hb?.layerId === 'taipei_l3_dp') dataStore.setHighlightedBlackStation(null);
        }
        if (oldLayerId === 'taipei_l3_dp_2' && newLayerId !== 'taipei_l3_dp_2') {
          const hb = dataStore.highlightedBlackStation;
          if (hb?.layerId === 'taipei_l3_dp_2') dataStore.setHighlightedBlackStation(null);
        }
        // 確保 SVG 內容和 tooltip 已清除（雙重保險）
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();

        // 清除舊數據（雙重保險）
        gridData.value = null;
        nodeData.value = null;
        linkData.value = null;
        mapGeoJsonData.value = null;

        // 載入新圖層數據

        await loadLayerData(newLayerId);

        // 等待 DOM 更新後繪製
        await nextTick();

        drawSchematic();
      }
    }
  );

  /**
   * 👀 監聽當前圖層的主要示意圖資料變化
   * 當圖層數據載入完成時，自動載入並繪製示意圖
   */
  watch(
    () => {
      if (!activeLayerTab.value) return null;
      const layer = dataStore.findLayerById(activeLayerTab.value);
      if (!layer) return null;
      const osmLay =
        activeLayerTab.value === JSON_GRID_COORD_NORMALIZED_LAYER_ID
          ? dataStore.findLayerById(OSM_2_GEOJSON_2_JSON_LAYER_ID)
          : null;
      /** OSM／a3 等僅有 geojsonData 時，異步載入完成須觸發重繪（原本只監聽 spaceNetworkGridJsonData） */
      /** 版面網格·座標正規化：父層 dataOSM／GeoJSON 變動須連動重繪 */
      return {
        sn: layer.spaceNetworkGridJsonData,
        gj: layer.geojsonData,
        ug: layer.layoutUniformGridGeoJson,
        um: layer.layoutUniformGridMeta,
        parentDataOsm: osmLay?.dataOSM,
        parentGj: osmLay?.geojsonData,
        parentDataGj: osmLay?.dataGeojson,
      };
    },
    async () => {
      if (!activeLayerTab.value) return;
      const layer = dataStore.findLayerById(activeLayerTab.value);
      if (!layer) return;
      const hasSn = layer.spaceNetworkGridJsonData != null;
      const gj = layer.geojsonData;
      const hasGj =
        gj &&
        gj.type === 'FeatureCollection' &&
        Array.isArray(gj.features) &&
        gj.features.length > 0;
      const ugFc = layer.layoutUniformGridGeoJson;
      const hasUg =
        ugFc &&
        ugFc.type === 'FeatureCollection' &&
        Array.isArray(ugFc.features) &&
        ugFc.features.length > 0;
      let hasOsmBackedMap = false;
      if (layer.layerId === JSON_GRID_COORD_NORMALIZED_LAYER_ID) {
        hasOsmBackedMap = !!backingGeoJsonFromOsm2DataOsmForCoordNormViewer(layer);
      }
      if (!hasSn && !hasGj && !hasUg && !hasOsmBackedMap) return;
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await loadLayerData(activeLayerTab.value);
      await nextTick();
      drawSchematic();
    },
    { deep: true }
  );

  /**
   * 👀 監聽路段高亮索引變化，重繪以更新高亮
   */
  watch(
    () => {
      if (!activeLayerTab.value) return null;
      const lid = activeLayerTab.value;
      const layer = dataStore.findLayerById(lid);
      if (!layer) return null;
      if (
        layer.layerId === POINT_ORTHOGONAL_LAYER_ID ||
        layer.layerId === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
        isLineOrthogonalTowardCenterLayerId(layer.layerId)
      ) {
        const hl = layer.highlightedSegmentIndex;
        const sg = layer.jsonGridFromCoordSuggestTargetGrid;
        const mp = isLineOrthogonalTowardCenterLayerId(layer.layerId)
          ? (layer.lineOrthoTowardCrossMovePreview ?? null)
          : null;
        const fz = isLineOrthogonalTowardCenterLayerId(layer.layerId)
          ? (layer.lineOrthoTowardCrossFrozenCenter ?? null)
          : null;
        const hxAxis = isLineOrthogonalTowardCenterLayerId(layer.layerId)
          ? (layer.lineOrthoTowardCrossHighlightTableAxis ?? null)
          : null;
        return JSON.stringify([
          hl == null ? null : hl,
          sg?.x ?? null,
          sg?.y ?? null,
          mp == null ? null : mp,
          fz == null ? null : { cx: fz.cx, cy: fz.cy },
          hxAxis,
        ]);
      }
      if (isSpaceGridVhDrawFamilyLayerId(layer.layerId)) {
        return JSON.stringify(layer.highlightedSegmentIndex ?? null);
      }
      return layer.highlightedSegmentIndex ?? null;
    },
    async (newVal, oldVal) => {
      const same =
        Array.isArray(newVal) && Array.isArray(oldVal)
          ? newVal[0] === oldVal[0] && newVal[1] === oldVal[1]
          : newVal === oldVal;
      if (!same && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  /** 「紅藍點列表」層 highlight／移動預覽變化時，在座標正規化／垂直化等分頁也重繪 */
  watch(
    () => {
      const rb = dataStore.findLayerById(COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID);
      return JSON.stringify([
        rb?.visible,
        rb?.highlightedSegmentIndex ?? null,
        rb?.rbConnectMovePreview ?? null,
        rb?.rbConnectVisitedKeys ?? null,
      ]);
    },
    async (nv, ov) => {
      if (nv === ov || !activeLayerTab.value) return;
      const lid = activeLayerTab.value;
      if (
        !(
          lid === JSON_GRID_COORD_NORMALIZED_LAYER_ID ||
          lid === POINT_ORTHOGONAL_LAYER_ID ||
          lid === COORD_NORMALIZED_RED_BLUE_LIST_LAYER_ID ||
          isLineOrthogonalTowardCenterLayerId(lid)
        )
      ) {
        return;
      }
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await nextTick();
      drawSchematic();
    }
  );

  /**
   * 👀 監聽車站配置開關變化（直線化測試／網格正規化），重繪以顯示/隱藏車站
   */
  watch(
    () => {
      if (!activeLayerTab.value) return null;
      const layer = dataStore.findLayerById(activeLayerTab.value);
      return layer?.showStationPlacement ?? null;
    },
    async (newVal, oldVal) => {
      if (newVal !== oldVal && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  /** taipei_f／taipei_g：dataStore「顯示網格／顯示權重／…」切換時重繪（Control 專屬操作僅 taipei_g） */
  watch(
    () => [
      dataStore.showGrid,
      dataStore.showWeightLabels,
      dataStore.showRouteThickness,
      dataStore.taipeiFSpaceNetworkGridScaling,
      dataStore.taipeiFSpaceNetworkMouseZoom,
    ],
    async () => {
      if (!isTaipeiEfinalSpaceLayerTab(activeLayerTab.value)) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (!hasData) return;
      taipeiFMouseZoomHover.value = { ix: null, iy: null };
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await nextTick();
      drawSchematic();
    }
  );

  /** 空間網路主分頁：路線權重數字開關（與 space-network-grid-k3／l3 共用 store） */
  watch(
    () => [
      dataStore.spaceNetworkGridShowRouteWeights,
      dataStore.showWeightLabels,
      dataStore.showRouteThickness,
      dataStore.spaceNetworkGridShowMouseGridCoordinate,
    ],
    async () => {
      const hasData = gridData.value || mapGeoJsonData.value;
      if (!hasData || !activeLayerTab.value || !isMapLayer(activeLayerTab.value)) return;
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await nextTick();
      drawMapForceNext = true;
      drawSchematic();
    },
    { flush: 'post' }
  );

  /** 顯示紅／藍或黑點站名：地圖示意層重繪 */
  watch(
    () => [dataStore.showStationNames, dataStore.showBlackDotStationNames],
    async () => {
      if (!activeLayerTab.value || !isMapLayer(activeLayerTab.value)) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (!hasData) return;
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await nextTick();
      drawSchematic();
    }
  );

  /** 測試3：Control「正方形／預設」切換時重繪路網示意 */
  watch(
    () =>
      activeLayerTab.value && isTaipeiTest3BcdeLayerTab(activeLayerTab.value)
        ? dataStore.findLayerById(activeLayerTab.value)?.squareGridCellsTaipeiTest3
        : null,
    async () => {
      if (!activeLayerTab.value || !isTaipeiTest3BcdeLayerTab(activeLayerTab.value)) return;
      if (!isMapLayer(activeLayerTab.value)) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (!hasData) return;
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await nextTick();
      drawSchematic();
    }
  );

  /** 隨機權重等：強制卸載 SVG 後重載，避免 drawMap 同尺寸快取略過整圖重繪 */
  watch(
    () => dataStore.spaceNetworkGridFullRedrawTrigger,
    async (n) => {
      if (n < 1) return;
      if (!activeLayerTab.value || !isMapLayer(activeLayerTab.value)) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (!hasData) return;
      const containerId = getContainerId();
      d3.select(`#${containerId}`).selectAll('svg').remove();
      d3.select('body').selectAll('.d3js-map-tooltip').remove();
      await loadLayerData(activeLayerTab.value);
      await nextTick();
      drawSchematic();
    }
  );

  /** taipei_f：欄（Col）路段逐步高亮 */
  watch(
    () => dataStore.taipeiFColRouteHighlightRedrawTrigger,
    async (n) => {
      if (n < 1) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (hasData && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  /** taipei_f：列（Row）路段逐步高亮 */
  watch(
    () => dataStore.taipeiFRowRouteHighlightRedrawTrigger,
    async (n) => {
      if (n < 1) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (hasData && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  /** 黑點車站逐步 highlight：store 變更時重繪，否則圓點樣式不會更新 */
  watch(
    () => dataStore.blackStationHighlightRedrawTrigger,
    async (n) => {
      if (n < 1) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (hasData && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  /** taipei_c6 路線導航：起迄／路徑樣式更新時重繪 */
  watch(
    () => dataStore.taipeiC6TrafficHighlightRedrawTrigger,
    async (n) => {
      if (n < 1) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (hasData && activeLayerTab.value === 'taipei_c6') {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  /** 疊加縮減預覽：欄／列帶狀高亮 */
  watch(
    () => dataStore.overlayShrinkStripRedrawTrigger,
    async (n) => {
      if (n < 1) return;
      const hasData = gridData.value || mapGeoJsonData.value;
      if (hasData && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    }
  );

  watch(
    () => [
      dataStore.hvZStepTrigger,
      dataStore.hvFlipStepTrigger,
      dataStore.nShapeStepTrigger,
      dataStore.highlightDiagnosticsTrigger,
    ],
    async () => {
      const hasData = gridData.value || mapGeoJsonData.value;
      if (hasData && activeLayerTab.value) {
        const containerId = getContainerId();
        d3.select(`#${containerId}`).selectAll('svg').remove();
        d3.select('body').selectAll('.d3js-map-tooltip').remove();
        await nextTick();
        drawSchematic();
      }
    },
    { deep: true }
  );

  /**
   * 👀 監聽容器高度變化，觸發示意圖重繪
   */
  watch(
    () => props.containerHeight,
    () => {
      // 觸發示意圖重繪以適應新高度
      nextTick(() => {
        resize();
      });
    }
  );

  /**
   * 🚀 組件掛載事件 (Component Mounted Event)
   */
  onMounted(async () => {
    // 初始化第一個可見圖層為作用中分頁
    if (visibleLayers.value.length > 0 && !activeLayerTab.value) {
      activeLayerTab.value = visibleLayers.value[0].layerId;

      // 載入初始數據
      await loadLayerData(activeLayerTab.value);
      await nextTick();
      drawSchematic();

      emit('active-layer-change', activeLayerTab.value);
    }

    // 監聽窗口大小變化
    window.addEventListener('resize', resize);

    // 監聽容器尺寸變化
    const container = document.getElementById(getContainerId());
    if (container && window.ResizeObserver) {
      resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            resize();
          }
        }
      });
      resizeObserver.observe(container);

      // 同時監聽父容器
      const parentContainer = container.parentElement;
      if (parentContainer) {
        resizeObserver.observe(parentContainer);
      }
    }
  });

  /**
   * 🚀 組件卸載事件 (Component Unmounted Event)
   */
  onUnmounted(() => {
    if (taipeiFMouseZoomRaf) {
      cancelAnimationFrame(taipeiFMouseZoomRaf);
      taipeiFMouseZoomRaf = 0;
    }
    window.removeEventListener('resize', resize);

    // 清理 ResizeObserver
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  // 暴露方法給父組件使用
  defineExpose({
    resize, // 調整尺寸方法
  });
</script>

<template>
  <!-- 📊 多圖層 D3.js 數據視覺化儀表板視圖組件 -->
  <div class="d-flex flex-column my-bgcolor-gray-200 h-100">
    <!-- 📑 圖層分頁導航 -->
    <div v-if="visibleLayers.length > 0" class="">
      <ul class="nav nav-tabs nav-fill">
        <li
          v-for="layer in visibleLayers"
          :key="layer.layerId"
          class="nav-item d-flex flex-column align-items-center"
        >
          <!-- tab按鈕 -->
          <div
            class="btn nav-link rounded-0 border-0 position-relative d-flex align-items-center justify-content-center my-bgcolor-gray-200"
            :class="{
              active: activeLayerTab === layer.layerId,
            }"
            @click="setActiveLayerTab(layer.layerId)"
          >
            <span>
              <span v-if="getLayerFullTitle(layer).groupName" class="my-title-xs-gray"
                >{{ getLayerFullTitle(layer).groupName }} -
              </span>
              <span class="my-title-sm-black">{{ getLayerFullTitle(layer).layerName }}</span>
            </span>
          </div>
          <div class="w-100" :class="`my-bgcolor-${layer.colorName}`" style="min-height: 4px"></div>
        </li>
      </ul>
    </div>

    <!-- 有開啟圖層時的內容 -->
    <div
      v-if="visibleLayers.length > 0"
      class="flex-grow-1 d-flex flex-column my-bgcolor-white"
      style="min-height: 0"
    >
      <!-- 📊 圖層摘要資料 -->
      <div v-if="currentLayerSummary" class="flex-grow-1 d-flex flex-column" style="min-height: 0">
        <!-- D3.js 示意圖 - 以彈性高度填滿可用空間 -->
        <div class="flex-grow-1 d-flex flex-column" style="min-height: 0">
          <div class="flex-grow-1" style="min-height: 0">
            <!-- 🎨 統一示意圖容器 (Unified Schematic Container) -->
            <div
              :id="getContainerId()"
              class="w-100 h-100"
              style="min-height: 0; overflow: hidden; background-color: #ffffff"
            ></div>
          </div>
        </div>
      </div>
      <div v-else class="flex-grow-1 d-flex align-items-center justify-content-center">
        <div class="text-center">
          <div class="my-title-md-gray" v-if="hasLayerInfoData">有資料</div>
          <div class="my-title-md-gray" v-else>此圖層沒有可用的摘要資訊</div>
        </div>
      </div>
    </div>

    <!-- 沒有開啟圖層時的空狀態 -->
    <div v-else class="flex-grow-1 d-flex align-items-center justify-content-center">
      <div class="text-center">
        <div class="my-title-md-gray p-3">沒有開啟的圖層</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  /**
   * 🎨 SpaceNetworkGridTab 組件樣式 (SpaceNetworkGridTab Component Styles)
   *
   * 定義組件內部元素的樣式規則，使用 scoped 避免樣式污染
   * 主要樣式規則已在 common.css 中定義，此處僅包含組件特定調整
   */

  /* 📊 示意圖容器樣式 (Schematic Container Styles) */
  [id^='schematic-container-space-network-grid'] {
    position: relative;
    overflow: hidden;
    background-color: #ffffff !important;
    background: #ffffff !important;
  }

  /* 🗺️ 地圖模式時強制白色背景 */
  [id^='schematic-container-space-network-grid'] svg {
    display: block;
    max-width: 100%;
    max-height: 100%;
    background-color: #ffffff !important;
    background: #ffffff !important;
  }

  /* 🔍 縮放功能樣式 */
  [id^='schematic-container-space-network-grid'] svg {
    cursor: grab;
  }

  [id^='schematic-container-space-network-grid'] svg:active {
    cursor: grabbing;
  }

  /* 📝 網格文字樣式 (Grid Text Styles) */
  :deep(.grid-nodes text) {
    pointer-events: none;
    user-select: none;
  }

  /* 🎯 D3.js 圖表互動樣式 (D3.js Chart Interaction Styles) */
  :deep(.bar:hover) {
    cursor: pointer;
  }

  :deep(.scatter:hover) {
    cursor: pointer;
  }

  :deep(.dot:hover) {
    cursor: pointer;
  }
</style>
