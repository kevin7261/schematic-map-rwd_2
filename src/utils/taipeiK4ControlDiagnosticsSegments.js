/**
 * ControlTab／K3 診斷：taipei_b5／c5（測試5，k4 繪製）須與 SpaceNetworkGridTabK3 主圖一致——
 * 黑點經 rebuildTaipeiK4DrawFromFlatSegments 依螢幕 px 弧長重算後再 snap，不可只用 taipeiK4MapK3TabJsonToPlotPxForDisplay 對原始頂點做線性映射。
 */
import * as d3 from 'd3';
import {
  TAIPEI_K4_SPACE_NETWORK_MARGIN,
  collectBoundsFromFlatSegments,
} from '@/utils/taipeiK4SpaceNetworkPlotPx.js';
import { rebuildTaipeiK4DrawFromFlatSegments } from '@/utils/taipeiK4RedrawChains.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * 與 SpaceNetworkGridTabK3「nodes + points」分支一致：擷取可繪製之 connect／黑點（供 k4 rebuild）。
 */
export function collectTaipeiK4StationFeaturesForK4Rebuild(flatSegments) {
  const out = [];
  if (!Array.isArray(flatSegments)) return out;
  for (const seg of flatSegments) {
    if (!seg?.points?.length) continue;
    const pts = seg.points;
    const nodes = Array.isArray(seg.nodes) ? seg.nodes : [];
    const routeName = seg.route_name ?? seg.name ?? '';
    const routeColor = seg.route_color ?? seg.color ?? '';
    for (let i = 0; i < pts.length; i++) {
      const point = pts[i];
      let x;
      let y;
      if (Array.isArray(point) && point.length >= 2) {
        x = point[0];
        y = point[1];
      } else if (point && typeof point === 'object') {
        x = point.x;
        y = point.y;
      } else continue;
      const fromPt =
        Array.isArray(point) && point.length > 2 && typeof point[2] === 'object' ? point[2] : {};
      const midFromNode = nodes[i] && typeof nodes[i] === 'object' ? nodes[i] : {};
      const nodeProps = { ...midFromNode, ...fromPt };
      const drawX = Number.isFinite(Number(nodeProps.display_x))
        ? Number(nodeProps.display_x)
        : Number(x);
      const drawY = Number.isFinite(Number(nodeProps.display_y))
        ? Number(nodeProps.display_y)
        : Number(y);
      if (!Number.isFinite(drawX) || !Number.isFinite(drawY)) continue;
      const tags = nodeProps.tags && typeof nodeProps.tags === 'object' ? nodeProps.tags : {};
      const isBlackLike = nodeProps.station_name || tags.station_name || tags._forceDrawBlackDot;
      const nt = String(nodeProps.node_type ?? '').trim();
      const isRealStation = nt === 'connect' || (isBlackLike && nodeProps.display !== false);
      if (!isRealStation) continue;
      out.push({
        geometry: { type: 'Point', coordinates: [drawX, drawY] },
        properties: {
          ...nodeProps,
          x_grid: drawX,
          y_grid: drawY,
          _diagRouteName: routeName,
          _diagRouteColor: routeColor,
        },
        nodeType: nt || 'line',
      });
    }
  }
  return out;
}

function buildK4InnerScales(layer, flatSegments, fullChartW, fullChartH) {
  const margin = TAIPEI_K4_SPACE_NETWORK_MARGIN;
  const innerW = Math.max(1, fullChartW - margin.left - margin.right);
  const innerH = Math.max(1, fullChartH - margin.top - margin.bottom);
  const { xMin, xMax, yMin, yMax } = collectBoundsFromFlatSegments(flatSegments);
  let xScale;
  let yScale;
  if (layer?.squareGridCellsTaipeiTest3 === true) {
    const spanX = xMax - xMin;
    const spanY = yMax - yMin;
    const sx = spanX > 0 ? spanX : 1;
    const sy = spanY > 0 ? spanY : 1;
    const cellSize = Math.min(innerW / sx, innerH / sy);
    const gridW = sx * cellSize;
    const gridH = sy * cellSize;
    const gridLeft = margin.left + (innerW - gridW) / 2;
    const gridTop = margin.top + (innerH - gridH) / 2;
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
      .range([margin.left, margin.left + innerW]);
    yScale = d3
      .scaleLinear()
      .domain([yMax, yMin])
      .range([margin.top, margin.top + innerH]);
  }
  return { xScale, yScale, margin, innerW, innerH };
}

/** 與 SpaceNetworkGridTabK3 formatPathCoordPairForTooltipHtml（k4）一致：內繪區 px、snap */
function gridToInnerPxSnapped(gx, gy, xScale, yScale, margin, innerH, snapGridPx) {
  const sg = Math.max(1, Math.round(Number(snapGridPx) || 10));
  const px = Math.round((xScale(num(gx)) - margin.left) / sg) * sg;
  const py = Math.round((innerH - (yScale(num(gy)) - margin.top)) / sg) * sg;
  return [px, py];
}

function nodeFromStationFeature(f) {
  const props = f?.properties && typeof f.properties === 'object' ? f.properties : {};
  const ntRaw = f?.nodeType ?? props.node_type ?? '';
  const nt = String(ntRaw).trim();
  return {
    ...props,
    node_type: nt === 'connect' ? 'connect' : nt || 'line',
  };
}

/**
 * 產出與主圖 layout-network-grid-k3（taipei_b5／c5）對齊之 flat segments：座標為「內繪區 px」（左下原點、y 向上），
 * 供 ControlTab 重疊點／重疊路線／座標列表掃描。
 * @returns {Array<object>|null} 失敗時 null（呼叫端可退回舊映射）
 */
export function buildTaipeiB5DiagnosticsSegmentsLikeLayoutGrid(
  layer,
  flatSegmentsSrc,
  fullChartW,
  fullChartH,
  snapGridPx
) {
  if (!layer || !Array.isArray(flatSegmentsSrc) || flatSegmentsSrc.length === 0) return null;
  const clonedSegs = JSON.parse(JSON.stringify(flatSegmentsSrc));
  const scales = buildK4InnerScales(layer, clonedSegs, fullChartW, fullChartH);
  const stationFeatures = collectTaipeiK4StationFeaturesForK4Rebuild(clonedSegs);
  const rebuilt = rebuildTaipeiK4DrawFromFlatSegments(clonedSegs, [], stationFeatures, {
    xScale: scales.xScale,
    yScale: scales.yScale,
    margin: scales.margin,
    snapGridPx,
    plotInnerHeight: scales.innerH,
  });
  if (!Array.isArray(rebuilt.routeFeatures) || rebuilt.routeFeatures.length === 0) {
    return null;
  }

  const { xScale, yScale, margin, innerH } = scales;
  const out = [];

  for (const rf of rebuilt.routeFeatures) {
    const coords = rf?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const props = rf.properties || {};
    const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
    const routeName = String(props.name ?? tags.name ?? '').trim() || 'route';
    const routeColor = String(props.color ?? tags.colour ?? tags.color ?? '').trim();
    const tagsOut = { ...tags, ...(routeColor ? { colour: routeColor } : {}) };
    const points = [];
    const nodes = [];
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!Array.isArray(c) || c.length < 2) continue;
      const [px, py] = gridToInnerPxSnapped(c[0], c[1], xScale, yScale, margin, innerH, snapGridPx);
      points.push([px, py, {}]);
      nodes.push({});
    }
    out.push({
      route_name: routeName,
      route_color: routeColor,
      original_props: {
        name: routeName,
        color: routeColor,
        way_properties: { tags: tagsOut },
        properties: { tags: tagsOut },
      },
      points,
      nodes,
    });
  }

  const byRoute = new Map();
  for (const f of rebuilt.stationFeatures || []) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const [px, py] = gridToInnerPxSnapped(c[0], c[1], xScale, yScale, margin, innerH, snapGridPx);
    const props = f.properties || {};
    const routeName = String(props._diagRouteName ?? '').trim() || 'route';
    const routeColor = String(props._diagRouteColor ?? '').trim();
    const rk = `${routeColor}\t${routeName}`;
    if (!byRoute.has(rk)) {
      byRoute.set(rk, { route_name: routeName, route_color: routeColor, pts: [], nds: [] });
    }
    const bucket = byRoute.get(rk);
    const node = nodeFromStationFeature(f);
    delete node._diagRouteName;
    delete node._diagRouteColor;
    bucket.pts.push([px, py, node]);
    bucket.nds.push(node);
  }
  for (const b of byRoute.values()) {
    if (!b.pts.length) continue;
    const tags = {};
    if (b.routeColor) tags.colour = b.routeColor;
    if (b.route_name) tags.name = b.route_name;
    out.push({
      route_name: b.route_name,
      route_color: b.route_color,
      original_props: {
        name: b.route_name,
        color: b.route_color,
        way_properties: { tags },
        properties: { tags },
      },
      points: b.pts,
      nodes: b.nds,
    });
  }

  return out.length ? out : null;
}

/**
 * 產出與主圖 layout-network-grid-k3（taipei_b6／c6）對齊之 flat segments：座標為「內繪區 px」（左下原點、y 向上），
 * 供 ControlTab 重疊點／重疊路線／座標列表掃描。
 * （與 buildTaipeiB5DiagnosticsSegmentsLikeLayoutGrid 分函式複製，版面網格測試_2／版面網格測試_3 不共用本體。）
 * @returns {Array<object>|null} 失敗時 null（呼叫端可退回舊映射）
 */
export function buildTaipeiB6DiagnosticsSegmentsLikeLayoutGrid(
  layer,
  flatSegmentsSrc,
  fullChartW,
  fullChartH,
  snapGridPx
) {
  if (!layer || !Array.isArray(flatSegmentsSrc) || flatSegmentsSrc.length === 0) return null;
  const clonedSegs = JSON.parse(JSON.stringify(flatSegmentsSrc));
  const scales = buildK4InnerScales(layer, clonedSegs, fullChartW, fullChartH);
  const stationFeatures = collectTaipeiK4StationFeaturesForK4Rebuild(clonedSegs);
  const rebuilt = rebuildTaipeiK4DrawFromFlatSegments(clonedSegs, [], stationFeatures, {
    xScale: scales.xScale,
    yScale: scales.yScale,
    margin: scales.margin,
    snapGridPx,
    plotInnerHeight: scales.innerH,
  });
  if (!Array.isArray(rebuilt.routeFeatures) || rebuilt.routeFeatures.length === 0) {
    return null;
  }

  const { xScale, yScale, margin, innerH } = scales;
  const out = [];

  for (const rf of rebuilt.routeFeatures) {
    const coords = rf?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const props = rf.properties || {};
    const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
    const routeName = String(props.name ?? tags.name ?? '').trim() || 'route';
    const routeColor = String(props.color ?? tags.colour ?? tags.color ?? '').trim();
    const tagsOut = { ...tags, ...(routeColor ? { colour: routeColor } : {}) };
    const points = [];
    const nodes = [];
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!Array.isArray(c) || c.length < 2) continue;
      const [px, py] = gridToInnerPxSnapped(c[0], c[1], xScale, yScale, margin, innerH, snapGridPx);
      points.push([px, py, {}]);
      nodes.push({});
    }
    out.push({
      route_name: routeName,
      route_color: routeColor,
      original_props: {
        name: routeName,
        color: routeColor,
        way_properties: { tags: tagsOut },
        properties: { tags: tagsOut },
      },
      points,
      nodes,
    });
  }

  const byRoute = new Map();
  for (const f of rebuilt.stationFeatures || []) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const [px, py] = gridToInnerPxSnapped(c[0], c[1], xScale, yScale, margin, innerH, snapGridPx);
    const props = f.properties || {};
    const routeName = String(props._diagRouteName ?? '').trim() || 'route';
    const routeColor = String(props._diagRouteColor ?? '').trim();
    const rk = `${routeColor}\t${routeName}`;
    if (!byRoute.has(rk)) {
      byRoute.set(rk, { route_name: routeName, route_color: routeColor, pts: [], nds: [] });
    }
    const bucket = byRoute.get(rk);
    const node = nodeFromStationFeature(f);
    delete node._diagRouteName;
    delete node._diagRouteColor;
    bucket.pts.push([px, py, node]);
    bucket.nds.push(node);
  }
  for (const b of byRoute.values()) {
    if (!b.pts.length) continue;
    const tags = {};
    if (b.routeColor) tags.colour = b.routeColor;
    if (b.route_name) tags.name = b.route_name;
    out.push({
      route_name: b.route_name,
      route_color: b.route_color,
      original_props: {
        name: b.route_name,
        color: b.route_color,
        way_properties: { tags },
        properties: { tags },
      },
      points: b.pts,
      nodes: b.nds,
    });
  }

  return out.length ? out : null;
}

/**
 * 產出與主圖 layout-network-grid-k3（taipei_b4／c4）對齊之 flat segments：座標為「內繪區 px」（左下原點、y 向上），
 * 供 ControlTab 重疊點／重疊路線／座標列表掃描。
 * （與 buildTaipeiB5DiagnosticsSegmentsLikeLayoutGrid 分函式複製，測試4／測試5 不共用本體。）
 * @returns {Array<object>|null} 失敗時 null（呼叫端可退回舊映射）
 */
export function buildTaipeiB4DiagnosticsSegmentsLikeLayoutGrid(
  layer,
  flatSegmentsSrc,
  fullChartW,
  fullChartH,
  snapGridPx
) {
  if (!layer || !Array.isArray(flatSegmentsSrc) || flatSegmentsSrc.length === 0) return null;
  const clonedSegs = JSON.parse(JSON.stringify(flatSegmentsSrc));
  const scales = buildK4InnerScales(layer, clonedSegs, fullChartW, fullChartH);
  const stationFeatures = collectTaipeiK4StationFeaturesForK4Rebuild(clonedSegs);
  const rebuilt = rebuildTaipeiK4DrawFromFlatSegments(clonedSegs, [], stationFeatures, {
    xScale: scales.xScale,
    yScale: scales.yScale,
    margin: scales.margin,
    snapGridPx,
    plotInnerHeight: scales.innerH,
  });
  if (!Array.isArray(rebuilt.routeFeatures) || rebuilt.routeFeatures.length === 0) {
    return null;
  }

  const { xScale, yScale, margin, innerH } = scales;
  const out = [];

  for (const rf of rebuilt.routeFeatures) {
    const coords = rf?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const props = rf.properties || {};
    const tags = props.tags && typeof props.tags === 'object' ? props.tags : {};
    const routeName = String(props.name ?? tags.name ?? '').trim() || 'route';
    const routeColor = String(props.color ?? tags.colour ?? tags.color ?? '').trim();
    const tagsOut = { ...tags, ...(routeColor ? { colour: routeColor } : {}) };
    const points = [];
    const nodes = [];
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!Array.isArray(c) || c.length < 2) continue;
      const [px, py] = gridToInnerPxSnapped(c[0], c[1], xScale, yScale, margin, innerH, snapGridPx);
      points.push([px, py, {}]);
      nodes.push({});
    }
    out.push({
      route_name: routeName,
      route_color: routeColor,
      original_props: {
        name: routeName,
        color: routeColor,
        way_properties: { tags: tagsOut },
        properties: { tags: tagsOut },
      },
      points,
      nodes,
    });
  }

  const byRoute = new Map();
  for (const f of rebuilt.stationFeatures || []) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const [px, py] = gridToInnerPxSnapped(c[0], c[1], xScale, yScale, margin, innerH, snapGridPx);
    const props = f.properties || {};
    const routeName = String(props._diagRouteName ?? '').trim() || 'route';
    const routeColor = String(props._diagRouteColor ?? '').trim();
    const rk = `${routeColor}\t${routeName}`;
    if (!byRoute.has(rk)) {
      byRoute.set(rk, { route_name: routeName, route_color: routeColor, pts: [], nds: [] });
    }
    const bucket = byRoute.get(rk);
    const node = nodeFromStationFeature(f);
    delete node._diagRouteName;
    delete node._diagRouteColor;
    bucket.pts.push([px, py, node]);
    bucket.nds.push(node);
  }
  for (const b of byRoute.values()) {
    if (!b.pts.length) continue;
    const tags = {};
    if (b.routeColor) tags.colour = b.routeColor;
    if (b.route_name) tags.name = b.route_name;
    out.push({
      route_name: b.route_name,
      route_color: b.route_color,
      original_props: {
        name: b.route_name,
        color: b.route_color,
        way_properties: { tags },
        properties: { tags },
      },
      points: b.pts,
      nodes: b.nds,
    });
  }

  return out.length ? out : null;
}
