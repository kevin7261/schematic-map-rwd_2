<script setup>
  /** 網路手繪 Sketch 標籤（底圖為 Leaflet 圖磚，折線以 WGS84 存點，x=經度、y=緯度）。 */
  import { ref, computed, onMounted, onUnmounted, watch, nextTick, shallowRef } from 'vue';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { useDataStore } from '@/stores/dataStore.js';
  import { useDefineStore } from '@/stores/defineStore.js';
  import { getNetworkDrawRouteColor } from '@/utils/networkDrawSketchPalette.js';
  import {
    getAllNetworkDrawSketchLayerIds,
    isRegisteredNetworkDrawSketchLayerId,
  } from '@/utils/networkDrawSketchPipelineLayers.js';

  const PRIMARY_SKETCH_FALLBACK =
    getAllNetworkDrawSketchLayerIds()[0] || 'network_draw_sketch';

  const dataStore = useDataStore();
  const mapStore = useDefineStore();

  const map = shallowRef(null);
  const mapEl = ref(null);
  const mapViewEpoch = ref(0);
  let tileRef = null;
  /** 僅影響底圖瓦片（0.35=最深，1.5=最淺，1=預設） */
  const basemapBrightness = ref(1);

  /** 經緯度平面近似用於幾合／叉點（本島尺度可接受） */
  const SKEY = 1e6;
  /** @param {{ x: number; y: number }} p — x=經度, y=緯度 */
  const ptKey = (p) =>
    `${Math.round(p.x * SKEY) / SKEY},${Math.round(p.y * SKEY) / SKEY}`;

  const ENDPOINT_DEG = 0.0001;
  const ENDPOINT_DEG2 = ENDPOINT_DEG * ENDPOINT_DEG;
  const ENDPOINT_LINK_DEG2 = ENDPOINT_DEG2;
  const NEAR_CROSS_DEG2 = 1.5e-8;

  /**
   * @param {{ x: number; y: number }} a
   * @param {{ x: number; y: number }} b
   * @param {{ x: number; y: number }} c
   * @param {{ x: number; y: number }} d
   * @returns {{ t: number; u: number; pt: { x: number; y: number } } | null}
   */
  const segIntersect = (a, b, c, d) => {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    const denom = rx * sy - ry * sx;
    const EPS = 1e-10;
    if (Math.abs(denom) < EPS) return null;
    const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
    const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
    if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
    return {
      t,
      u,
      pt: { x: a.x + t * rx, y: a.y + t * ry },
    };
  };

  const routeColor = (i) => getNetworkDrawRouteColor(i);

  /**
   * 點到線段的最短距離（px）
   * @param {number} px
   * @param {number} py
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   */
  const distPointToSeg = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    return Math.hypot(px - qx, py - qy);
  };

  const emit = defineEmits(['active-layer-change']);

  const props = defineProps({
    containerHeight: { type: Number, default: 500 },
    isPanelDragging: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  });

  const svgRef = ref(null);
  /**
   * 'hover'：檢視（含線／頂點 hover）；'draw'：手繪折線；'delete'：點擊靠近之路線予以刪除
   */
  const interactionMode = ref('hover');

  const isDrawLikeMode = (m) => m === 'draw';
  const isDrawing = ref(false);
  /** 線／頂點 hover；檢視時由 map-stack capture 更新（見 updateSketchHoverFromEvent） */
  const hoverHit = ref(null);
  /** @type {import('vue').Ref<Array<{ x: number; y: number }>>} */
  const draftPoints = ref([]);
  /** @type {import('vue').Ref<Array<Array<{ x: number; y: number }>>>} */
  const finishedPolylines = ref([]);
  /** 與 finishedPolylines 同索引：路段匯入列（routeName、segment…）；手繪新增者為 null */
  /** @type {import('vue').Ref<Array<object | null>>} */
  const finishedRouteExportRows = ref([]);
  /** 「加站點」成功插入之頂點（經緯度），供紫色圓點與 Control 統計 */
  const sketchStationVertices = ref([]);
  const activeLayerTab = ref(PRIMARY_SKETCH_FALLBACK);

  /** 左側已開啟目前分頁所選手繪圖層時才可編輯畫布 */
  const sketchLayerReady = computed(() => {
    const l = dataStore.findLayerById(activeLayerTab.value);
    return !!(l && l.visible);
  });

  const visibleLayers = computed(() =>
    dataStore
      .getAllLayers()
      .filter(
        (l) =>
          l?.visible &&
          Array.isArray(l.upperViewTabs) &&
          l.upperViewTabs.includes('network-draw-lines')
      )
  );

  const getLayerFullTitle = (layer) => {
    if (!layer) return { groupName: null, layerName: '未知圖層' };
    return {
      groupName: dataStore.findGroupNameByLayerId(layer.layerId),
      layerName: layer.layerName,
    };
  };

  /** 路段匯入列之 x_grid／y_grid 與手繪頂點比對門檻（約 2m） */
  const GRID_LONLAT_TOL = 2e-5;

  const nodeLonLatFromExportNode = (node) => {
    if (!node || typeof node !== 'object') return null;
    const x = Number(node.x_grid ?? node.tags?.x_grid);
    const y = Number(node.y_grid ?? node.tags?.y_grid);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    return null;
  };

  const exportNodeNearVertex = (node, lng, lat) => {
    const c = nodeLonLatFromExportNode(node);
    if (!c) return false;
    return Math.abs(c.x - lng) < GRID_LONLAT_TOL && Math.abs(c.y - lat) < GRID_LONLAT_TOL;
  };

  /**
   * 檢視模式 hover：顯示用 JSON（整列匯出屬性，或頂點對應之起迄／中間站）
   */
  const sketchHoverTooltipPayload = computed(() => {
    const hit = hoverHit.value;
    if (!hit || interactionMode.value !== 'hover') return null;
    const ri = hit.routeIndex;
    if (ri == null || !finishedPolylines.value[ri]) return null;
    const row = finishedRouteExportRows.value[ri];
    const vi = hit.vertexIndex;
    const pl = finishedPolylines.value[ri];

    if (row && typeof row === 'object') {
      const base = {
        routeName: row.routeName,
        color: row.color,
        segment: row.segment,
        routeCoordinates: row.routeCoordinates,
      };
      if (vi != null && pl[vi]) {
        const { x: lng, y: lat } = pl[vi];
        const seg = row.segment;
        if (seg && exportNodeNearVertex(seg.start, lng, lat)) {
          return { ...base, hoverTarget: 'point', matched: 'segment.start', point: seg.start };
        }
        if (seg && exportNodeNearVertex(seg.end, lng, lat)) {
          return { ...base, hoverTarget: 'point', matched: 'segment.end', point: seg.end };
        }
        const stations = Array.isArray(seg?.stations) ? seg.stations : [];
        for (let si = 0; si < stations.length; si++) {
          if (exportNodeNearVertex(stations[si], lng, lat)) {
            return {
              ...base,
              hoverTarget: 'point',
              matched: 'segment.stations',
              stationIndex: si,
              point: stations[si],
            };
          }
        }
        return {
          ...base,
          hoverTarget: 'vertex',
          polylineVertexIndex: vi,
          lon: lng,
          lat,
        };
      }
      return { ...base, hoverTarget: 'polyline' };
    }

    if (vi != null && pl[vi]) {
      const { x: lng, y: lat } = pl[vi];
      return {
        hoverTarget: 'vertex',
        routeIndex: ri,
        routeName: `路線_${ri + 1}`,
        color: routeColor(ri),
        polylineVertexIndex: vi,
        lon: lng,
        lat,
        note: '此折線無匯入路段屬性（僅手繪座標）',
      };
    }
    return {
      hoverTarget: 'polyline',
      routeIndex: ri,
      routeName: `路線_${ri + 1}`,
      color: routeColor(ri),
      note: '此折線無匯入路段屬性（僅手繪座標）',
    };
  });

  const sketchHoverTooltipJson = computed(() => {
    const p = sketchHoverTooltipPayload.value;
    if (!p) return '';
    try {
      return JSON.stringify(p, null, 2);
    } catch {
      return '';
    }
  });

  const sketchHoverTooltipVisible = computed(
    () =>
      sketchLayerReady.value &&
      interactionMode.value === 'hover' &&
      !isDrawing.value &&
      !!hoverHit.value &&
      hoverHit.value.routeIndex != null &&
      sketchHoverTooltipJson.value.length > 0
  );

  const hoverTipOffset = 14;
  const hoverTipLeftPx = computed(() => (hoverHit.value?.clientX ?? 0) + hoverTipOffset);
  const hoverTipTopPx = computed(() => (hoverHit.value?.clientY ?? 0) + hoverTipOffset);

  const MIN_SAMPLE_DIST = 2;
  const HOVER_SEG_PX = 12;
  /** 檢視／刪除：頂點與標記（紅／藍／綠／站點）之 hover 半徑 */
  const VERTEX_HOVER_HIT_PX = 12;

  const finishedPolylinesPx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return finishedPolylines.value.map((pl) =>
      (pl || []).map((p) => {
        const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
        return { x: c.x, y: c.y };
      })
    );
  });

  const draftPointsPx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return draftPoints.value.map((p) => {
      const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
      return { x: c.x, y: c.y };
    });
  });

  const draftPointsAttr = computed(() =>
    draftPointsPx.value.length ? draftPointsPx.value.map((p) => `${p.x},${p.y}`).join(' ') : ''
  );

  /**
   * 線段相交之交叉點（segIntersect，ptKey 去重）。
   * 若交點處已有 ≥2 條不同路線之端點匯聚，視為節點相接（綠點），不標紅。
   */
  const drawIntersectionPoints = computed(() => {
    const list = finishedPolylines.value.filter((pl) => pl && pl.length >= 2);
    /** @type {Array<{ x: number; y: number; polyIdx: number }>} */
    const ends = [];
    list.forEach((pl, pi) => {
      ends.push({ x: pl[0].x, y: pl[0].y, polyIdx: pi });
      ends.push({ x: pl[pl.length - 1].x, y: pl[pl.length - 1].y, polyIdx: pi });
    });

    const distinctPolysWithEndpointNear = (pt) => {
      const polys = new Set();
      for (const e of ends) {
        const dx = e.x - pt.x;
        const dy = e.y - pt.y;
        if (dx * dx + dy * dy <= ENDPOINT_LINK_DEG2) polys.add(e.polyIdx);
      }
      return polys.size;
    };

    const segs = [];
    for (let pi = 0; pi < list.length; pi++) {
      const pts = list[pi];
      for (let si = 0; si < pts.length - 1; si++) {
        segs.push({ pi, si, a: pts[si], b: pts[si + 1] });
      }
    }
    const seen = new Set();
    const out = [];
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const A = segs[i];
        const B = segs[j];
        if (A.pi === B.pi && Math.abs(A.si - B.si) <= 1) continue;
        const hit = segIntersect(A.a, A.b, B.a, B.b);
        if (!hit) continue;
        if (distinctPolysWithEndpointNear(hit.pt) >= 2) continue;
        const k = ptKey(hit.pt);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x: hit.pt.x, y: hit.pt.y });
      }
    }
    return out;
  });

  /**
   * 末端標記：藍＝未與其他路線端點相接；綠＝與他線端點相接；紅＝純線段交叉（非多端點匯流）。
   */
  const drawEndpointMarkers = computed(() => {
    const list = finishedPolylines.value.filter((pl) => pl && pl.length >= 2);
    const crosses = drawIntersectionPoints.value;
    /** @type {Array<{ x: number; y: number; polyIdx: number }>} */
    const ends = [];
    list.forEach((pl, pi) => {
      ends.push({ x: pl[0].x, y: pl[0].y, polyIdx: pi });
      ends.push({ x: pl[pl.length - 1].x, y: pl[pl.length - 1].y, polyIdx: pi });
    });

    const nearCross = (p) => {
      for (const c of crosses) {
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        if (dx * dx + dy * dy <= NEAR_CROSS_DEG2) return true;
      }
      return false;
    };

    const blue = [];
    const green = [];
    for (const e of ends) {
      if (nearCross(e)) continue;
      let otherTouches = false;
      for (const f of ends) {
        if (f.polyIdx === e.polyIdx) continue;
        const dx = e.x - f.x;
        const dy = e.y - f.y;
        if (dx * dx + dy * dy <= ENDPOINT_LINK_DEG2) {
          otherTouches = true;
          break;
        }
      }
      const pt = { x: e.x, y: e.y };
      if (otherTouches) green.push(pt);
      else blue.push(pt);
    }
    return { blue, green };
  });

  const drawIntersectionPointsPx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return drawIntersectionPoints.value.map((p) => {
      const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
      return { x: c.x, y: c.y };
    });
  });

  const drawEndpointMarkersBluePx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return drawEndpointMarkers.value.blue.map((p) => {
      const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
      return { x: c.x, y: c.y };
    });
  });

  const drawEndpointMarkersGreenPx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return drawEndpointMarkers.value.green.map((p) => {
      const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
      return { x: c.x, y: c.y };
    });
  });

  const sketchStationVerticesPx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return sketchStationVertices.value.map((p) => {
      const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
      return { x: c.x, y: c.y };
    });
  });

  /** 與 store 回填比對用（避免繪製→persist→watch 無限來回） */
  const stringifySketchLinesForCompare = (lines) =>
    JSON.stringify(
      (Array.isArray(lines) ? lines : []).map((pl) =>
        Array.isArray(pl) ? pl.map((p) => [Number(p.x), Number(p.y)]) : []
      )
    );

  const loadLocalSketchFromStore = (layerId) => {
    if (!isRegisteredNetworkDrawSketchLayerId(layerId)) return;
    const lines = dataStore.getNetworkDrawSketchPolylinesForLayer(layerId);
    finishedPolylines.value = Array.isArray(lines)
      ? lines.map((pl) =>
          Array.isArray(pl) ? pl.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : []
        )
      : [];
    const n = finishedPolylines.value.length;
    const rows = dataStore.getNetworkDrawSketchRouteExportRowsForLayer(layerId);
    finishedRouteExportRows.value = Array.from({ length: n }, (_, i) =>
      Array.isArray(rows) && i < rows.length && rows[i] != null
        ? JSON.parse(JSON.stringify(rows[i]))
        : null
    );
    const m = dataStore.getNetworkDrawSketchMarkersForLayer(layerId);
    sketchStationVertices.value = Array.isArray(m.station)
      ? m.station.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      : [];
  };

  const persistLocalSketchToStore = (layerId) => {
    if (!isRegisteredNetworkDrawSketchLayerId(layerId)) return;
    dataStore.setNetworkDrawSketchUseGeo(true, layerId);
    dataStore.setNetworkDrawSketchPolylines(
      finishedPolylines.value,
      layerId,
      finishedRouteExportRows.value
    );
    dataStore.setNetworkDrawSketchMarkers(
      {
        red: drawIntersectionPoints.value.map((p) => ({ x: p.x, y: p.y })),
        blue: drawEndpointMarkers.value.blue.map((p) => ({ x: p.x, y: p.y })),
        green: drawEndpointMarkers.value.green.map((p) => ({ x: p.x, y: p.y })),
        station: sketchStationVertices.value.map((p) => ({ x: p.x, y: p.y })),
      },
      layerId
    );
    dataStore.refreshNetworkDrawSketchLayerExportJsonFields(layerId);
  };

  const setActiveLayerTab = (layerId) => {
    const prev = activeLayerTab.value;
    if (prev && prev !== layerId && isRegisteredNetworkDrawSketchLayerId(prev)) {
      persistLocalSketchToStore(prev);
    }
    activeLayerTab.value = layerId;
    if (isRegisteredNetworkDrawSketchLayerId(layerId)) {
      loadLocalSketchFromStore(layerId);
    }
    emit('active-layer-change', layerId);
  };

  /** 路網仍含有的加站點頂點（刪線／復原後移除非折點者） */
  const pruneSketchStationVertices = () => {
    const keys = new Set();
    for (const pl of finishedPolylines.value) {
      for (const p of pl || []) {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) keys.add(ptKey(p));
      }
    }
    const next = sketchStationVertices.value.filter((p) => keys.has(ptKey(p)));
    if (next.length !== sketchStationVertices.value.length) {
      sketchStationVertices.value = next;
    }
  };

  /** 與 dataStore 同步折線＋紅／藍／綠點（供 Control「執行下一步」與 store 對齊） */
  const syncNetworkDrawSketchToStore = () => {
    const lid = activeLayerTab.value;
    // 左欄未開啟圖層時僅不落筆到此分頁，勿清空 store（否則 JSON 匯入會被擦掉）
    if (!sketchLayerReady.value) return;
    persistLocalSketchToStore(lid);
  };

  /** 繪製時游標與紅（交叉）／藍（懸空端）／綠（與他線相接端）標記距離在此內則吸附 */
  const SNAP_MARKER_PX = 14;

  /**
   * @param {{ x: number; y: number }} p
   * @returns {{ x: number; y: number }}
   */
  /** @param {{ x: number; y: number }} p 經緯度 */
  const snapDrawPointToMarkers = (p) => {
    const m = map.value;
    if (!m) return p;
    const pPx = m.latLngToContainerPoint(L.latLng(p.y, p.x));
    let bx = p.x;
    let by = p.y;
    let bestD = SNAP_MARKER_PX * SNAP_MARKER_PX;
    const tryQ = (qGeo) => {
      const qPx = m.latLngToContainerPoint(L.latLng(qGeo.y, qGeo.x));
      const dx = pPx.x - qPx.x;
      const dy = pPx.y - qPx.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD) {
        bestD = d2;
        bx = qGeo.x;
        by = qGeo.y;
      }
    };
    for (const q of drawIntersectionPoints.value) tryQ(q);
    for (const q of drawEndpointMarkers.value.blue) tryQ(q);
    for (const q of drawEndpointMarkers.value.green) tryQ(q);
    return { x: bx, y: by };
  };

  const setBasemap = () => {
    const m = map.value;
    if (!m) return;
    if (tileRef) {
      m.removeLayer(tileRef);
      tileRef = null;
    }
    const config = mapStore.basemaps.find((b) => b.value === mapStore.selectedBasemap);
    if (config?.url) {
      tileRef = L.tileLayer(config.url, { attribution: '' });
      tileRef.addTo(m);
    }
    const el = mapEl.value;
    if (el) {
      if (mapStore.selectedBasemap === 'blank') el.style.backgroundColor = '#ffffff';
      else if (mapStore.selectedBasemap === 'black') el.style.backgroundColor = '#000000';
      else el.style.backgroundColor = '#ffffff';
    }
    applyTilePaneBrightness();
  };

  /** 套在 Leaflet 根節點上（含瓦片、底色、+/- 控制鈕）；上層手繪 SVG 為兄弟節點，不受影響。 */
  const applyTilePaneBrightness = () => {
    const m = map.value;
    if (!m) return;
    const c = m.getContainer();
    if (!c) return;
    const b = basemapBrightness.value;
    const v = typeof b === 'number' && Number.isFinite(b) ? b : 1;
    c.style.filter = `brightness(${v})`;
  };

  const applyMapPointerMode = () => {
    const m = map.value;
    if (!m) return;
    if (props.isPanelDragging) return;
    /** 捲動縮放：所有模式皆啟用（手繪時由 SVG 轉交 wheel 到底圖） */
    m.scrollWheelZoom?.enable();
    if (interactionMode.value === 'hover') {
      m.dragging?.enable();
      m.doubleClickZoom?.enable();
    } else {
      m.dragging?.disable();
      m.doubleClickZoom?.disable();
    }
  };

  /**
   * 上層 SVG 擋住地圖時，將滾輪轉成 Leaflet 縮放（游標下縮放）。
   * 「檢視」模式 SVG 為 pointer-events:none，事件直接到地圖，此處不會觸發。
   */
  const onMapOverlayWheel = (e) => {
    const m = map.value;
    if (!m || props.isPanelDragging) return;
    e.preventDefault();
    e.stopPropagation();
    const swz = m.scrollWheelZoom;
    if (swz && typeof swz._onWheelScroll === 'function') {
      swz._onWheelScroll(e);
      return;
    }
    const ll = m.mouseEventToLatLng(e);
    let deltaY = e.deltaY;
    if (e.deltaMode === 1) deltaY *= 18;
    else if (e.deltaMode === 2) deltaY *= 52;
    if (Math.abs(deltaY) < 1) return;
    const nxp = m.getZoom() + (deltaY > 0 ? -1 : 1);
    if (nxp < m.getMinZoom() || nxp > m.getMaxZoom()) return;
    m.setZoomAround(ll, nxp);
  };

  const ensureMap = () => {
    if (map.value && mapEl.value) {
      try {
        map.value.invalidateSize();
        return;
      } catch (err) {
        try {
          map.value.remove();
        } catch (e) {
          void e;
        }
        map.value = null;
      }
    }
    if (!mapEl.value) return;
    const rect = mapEl.value.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      setTimeout(() => ensureMap(), 100);
      return;
    }
    if (mapEl.value._leaflet_id) {
      delete mapEl.value._leaflet_id;
      mapEl.value.innerHTML = '';
      mapEl.value.className = mapEl.value.className
        .split(' ')
        .filter((c) => !c.startsWith('leaflet-'))
        .join(' ');
    }
    const m = L.map(mapEl.value, {
      center: mapStore.mapView.center,
      zoom: mapStore.mapView.zoom,
      zoomControl: false,
      attributionControl: false,
    });
    map.value = m;
    setBasemap();
    m.on('moveend zoomend', () => {
      mapViewEpoch.value += 1;
      const c = m.getCenter();
      mapStore.setMapView([c.lat, c.lng], m.getZoom());
    });
    nextTick(() => {
      m.invalidateSize();
      mapViewEpoch.value += 1;
      applyTilePaneBrightness();
    });
  };

  const eventToLatLngClamped = (evt) => {
    const m = map.value;
    if (!m || !evt) return null;
    const c = m.getContainer();
    const rect = c.getBoundingClientRect();
    const px = Math.min(Math.max(0, evt.clientX - rect.left), rect.width);
    const py = Math.min(Math.max(0, evt.clientY - rect.top), rect.height);
    const ll = m.containerPointToLatLng(L.point(px, py));
    return { x: ll.lng, y: ll.lat, px, py };
  };

  const notifyLayer = () => {
    const visible = visibleLayers.value;
    const preferred = visible.find((l) => l.layerId === activeLayerTab.value) || visible[0];
    const layerId = preferred?.layerId || PRIMARY_SKETCH_FALLBACK;
    if (layerId !== activeLayerTab.value) {
      setActiveLayerTab(layerId);
    } else {
      /** 同上層 tab 不切分頁時仍須反映 store（例：下半 Control 匯入 JSON → 此地圖讀 bundle） */
      if (isRegisteredNetworkDrawSketchLayerId(layerId)) loadLocalSketchFromStore(layerId);
      emit('active-layer-change', layerId);
    }
  };

  const getBasemapLabel = (value) => {
    const b = mapStore.basemaps.find((x) => x.value === value);
    return b ? b.label : value;
  };

  const changeBasemap = (value) => {
    mapStore.setSelectedBasemap(value);
  };

  onMounted(() => {
    notifyLayer();
    nextTick(() => {
      ensureMap();
      applyMapPointerMode();
    });
  });

  watch(
    () => props.isActive,
    (on) => {
      if (on) {
        notifyLayer();
        nextTick(() => {
          ensureMap();
          map.value?.invalidateSize();
          mapViewEpoch.value += 1;
        });
      }
    }
  );

  /** Control 側匯入 JSON 等非本視圖寫 store 後，將 bundle 拉回本地繪區（無此則地圖仍顯示舊 finishedPolylines） */
  watch(
    () => dataStore.getNetworkDrawSketchPolylinesForLayer(activeLayerTab.value),
    () => {
      if (!props.isActive) return;
      const lid = activeLayerTab.value;
      if (!isRegisteredNetworkDrawSketchLayerId(lid)) return;
      const fromStore = stringifySketchLinesForCompare(dataStore.getNetworkDrawSketchPolylinesForLayer(lid));
      const local = stringifySketchLinesForCompare(finishedPolylines.value);
      if (fromStore === local) return;
      loadLocalSketchFromStore(lid);
    },
    { deep: true }
  );

  /** 上次因圖層未開啟而跳過繪製時不清 store；開啟可見後與 Pinia 對齊 */
  watch(sketchLayerReady, (ready) => {
    if (!ready || !props.isActive) return;
    const lid = activeLayerTab.value;
    if (!isRegisteredNetworkDrawSketchLayerId(lid)) return;
    loadLocalSketchFromStore(lid);
  });

  watch(
    () => props.containerHeight,
    () => {
      nextTick(() => {
        map.value?.invalidateSize();
        mapViewEpoch.value += 1;
      });
    }
  );

  watch(
    () => mapStore.selectedBasemap,
    () => {
      setBasemap();
    }
  );

  watch(basemapBrightness, () => {
    applyTilePaneBrightness();
  });

  watch(
    visibleLayers,
    (layers) => {
      if (!layers.length) {
        activeLayerTab.value = PRIMARY_SKETCH_FALLBACK;
        return;
      }
      if (!layers.some((l) => l.layerId === activeLayerTab.value)) {
        setActiveLayerTab(layers[0].layerId);
      }
    },
    { immediate: true }
  );

  const shouldAppendPoint = (p) => {
    if (draftPoints.value.length === 0) return true;
    const m = map.value;
    if (!m) return true;
    const last = draftPoints.value[draftPoints.value.length - 1];
    const a = m.latLngToContainerPoint(L.latLng(last.y, last.x));
    const b = m.latLngToContainerPoint(L.latLng(p.y, p.x));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy >= MIN_SAMPLE_DIST * MIN_SAMPLE_DIST;
  };

  const endStrokeIfAny = () => {
    if (draftPoints.value.length >= 2) {
      const line = draftPoints.value.map((p) => ({ x: p.x, y: p.y }));
      finishedPolylines.value = [...finishedPolylines.value, line];
      finishedRouteExportRows.value = [...finishedRouteExportRows.value, null];
    }
    draftPoints.value = [];
    isDrawing.value = false;
  };

  const removeWindowListeners = () => {
    window.removeEventListener('pointermove', onPointerMoveWindow);
    window.removeEventListener('pointerup', onPointerUpWindow);
    window.removeEventListener('pointercancel', onPointerUpWindow);
  };

  const onPointerMoveWindow = (evt) => {
    if (!sketchLayerReady.value || !isDrawing.value) return;
    const ev = eventToLatLngClamped(evt);
    if (!ev) return;
    const p = snapDrawPointToMarkers({ x: ev.x, y: ev.y });
    if (shouldAppendPoint(p)) {
      draftPoints.value = [...draftPoints.value, p];
    }
  };

  const onPointerUpWindow = (evt) => {
    if (!sketchLayerReady.value || !isDrawing.value) return;
    const ev = evt && eventToLatLngClamped(evt);
    if (ev && draftPoints.value.length >= 1) {
      const p = snapDrawPointToMarkers({ x: ev.x, y: ev.y });
      draftPoints.value =
        draftPoints.value.length === 1
          ? [p]
          : [...draftPoints.value.slice(0, -1), p];
    }
    removeWindowListeners();
    endStrokeIfAny();
  };

  watch(interactionMode, (m) => {
    if (!isDrawLikeMode(m) && isDrawing.value) {
      removeWindowListeners();
      endStrokeIfAny();
    }
    if (isDrawLikeMode(m)) {
      hoverHit.value = null;
    }
    applyMapPointerMode();
  });

  watch(
    () => props.isPanelDragging,
    () => {
      applyMapPointerMode();
    }
  );

  /**
   * 游標與各路線的最短距離中取最小者，若在門檻內則回傳該路線索引（整條 polyline，非細線段）。
   * @param {{ x: number; y: number }} p 螢幕座標（px）
   * @param {number} maxDistPx
   * @returns {number | null}
   */
  const findRouteIndexNearPoint = (p, maxDistPx) => {
    let bestRi = null;
    let bestD = maxDistPx;
    const pxList = finishedPolylinesPx.value;
    finishedPolylines.value.forEach((_, ri) => {
      const pts = pxList[ri];
      if (!pts || pts.length < 2) return;
      let routeMin = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = distPointToSeg(p.x, p.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (d < routeMin) routeMin = d;
      }
      if (routeMin < bestD) {
        bestD = routeMin;
        bestRi = ri;
      }
    });
    return bestRi;
  };

  /**
   * 檢視模式時 SVG 為 pointer-events:none（地圖可拖曳），改在父層 capture 做線／點 hover。
   */
  const updateSketchHoverFromEvent = (evt) => {
    if (!sketchLayerReady.value) {
      hoverHit.value = null;
      return;
    }
    const mode = interactionMode.value;
    if ((mode !== 'hover' && mode !== 'delete') || isDrawing.value) {
      hoverHit.value = null;
      return;
    }
    const ev = eventToLatLngClamped(evt);
    if (!ev) return;
    const px = ev.px;
    const py = ev.py;

    const maxV2 = VERTEX_HOVER_HIT_PX * VERTEX_HOVER_HIT_PX;
    let bestD2 = Infinity;
    /** @type {{ x: number, y: number, ri: number | null, vi: number | null } | null} */
    let bestVtx = null;

    const tryVtx = (x, y, ri, vi = null) => {
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (d2 <= maxV2 && d2 < bestD2) {
        bestD2 = d2;
        bestVtx = { x, y, ri, vi };
      }
    };

    finishedPolylinesPx.value.forEach((pts, ri) => {
      for (let vi = 0; vi < pts.length; vi += 1) {
        tryVtx(pts[vi].x, pts[vi].y, ri, vi);
      }
    });
    for (const p of drawIntersectionPointsPx.value) tryVtx(p.x, p.y, null, null);
    for (const p of drawEndpointMarkersBluePx.value) tryVtx(p.x, p.y, null, null);
    for (const p of drawEndpointMarkersGreenPx.value) tryVtx(p.x, p.y, null, null);
    for (const p of sketchStationVerticesPx.value) tryVtx(p.x, p.y, null, null);

    let focusPx = null;
    let routeIndex = null;

    /** 僅折線頂點帶 vertexIndex（紅／藍／綠／紫標記上不設，避免錯對 station） */
    let vertexIndex =
      bestVtx != null &&
      bestVtx.ri != null &&
      typeof bestVtx.vi === 'number' &&
      Number.isFinite(bestVtx.vi)
        ? bestVtx.vi
        : undefined;

    if (bestVtx) {
      focusPx = { x: bestVtx.x, y: bestVtx.y };
      routeIndex =
        bestVtx.ri != null
          ? bestVtx.ri
          : findRouteIndexNearPoint(
              { x: px, y: py },
              Math.max(HOVER_SEG_PX, VERTEX_HOVER_HIT_PX * 1.2)
            );
      if (routeIndex == null) {
        routeIndex = findRouteIndexNearPoint({ x: px, y: py }, HOVER_SEG_PX * 2);
      }
      if (bestVtx.ri == null) vertexIndex = undefined;
    } else {
      routeIndex = findRouteIndexNearPoint({ x: px, y: py }, HOVER_SEG_PX);
      vertexIndex = undefined;
    }

    const next = {
      clientX: evt.clientX,
      clientY: evt.clientY,
    };
    if (routeIndex != null) next.routeIndex = routeIndex;
    if (focusPx) next.focusPx = focusPx;
    if (vertexIndex !== undefined) next.vertexIndex = vertexIndex;

    if (routeIndex == null && focusPx == null) hoverHit.value = null;
    else hoverHit.value = next;
  };

  const onMapStackPointerLeave = () => {
    hoverHit.value = null;
  };

  const onSvgPointerDown = (evt) => {
    if (!sketchLayerReady.value) return;
    if (interactionMode.value === 'delete') {
      if (props.isPanelDragging) return;
      if (evt.button !== 0) return;
      evt.preventDefault();
      const ev = eventToLatLngClamped(evt);
      if (!ev) return;
      const ri = findRouteIndexNearPoint({ x: ev.px, y: ev.py }, HOVER_SEG_PX);
      if (ri === null) return;
      finishedPolylines.value = finishedPolylines.value.filter((_, i) => i !== ri);
      finishedRouteExportRows.value = finishedRouteExportRows.value.filter((_, i) => i !== ri);
      hoverHit.value = null;
      return;
    }

    if (!isDrawLikeMode(interactionMode.value)) return;
    if (props.isPanelDragging) return;
    if (evt.button !== 0) return;
    evt.preventDefault();

    const ev = eventToLatLngClamped(evt);
    if (!ev) return;
    const p = snapDrawPointToMarkers({ x: ev.x, y: ev.y });

    if (isDrawing.value) {
      removeWindowListeners();
      endStrokeIfAny();
    }

    isDrawing.value = true;
    draftPoints.value = [p];

    window.addEventListener('pointermove', onPointerMoveWindow);
    window.addEventListener('pointerup', onPointerUpWindow);
    window.addEventListener('pointercancel', onPointerUpWindow);
  };

  onUnmounted(() => {
    removeWindowListeners();
    if (map.value) {
      try {
        map.value.remove();
      } catch (e) {
        void e;
      }
      map.value = null;
    }
    tileRef = null;
  });

  watch(
    finishedPolylines,
    () => {
      pruneSketchStationVertices();
      const n = finishedPolylines.value.length;
      if (finishedRouteExportRows.value.length !== n) {
        finishedRouteExportRows.value = finishedPolylines.value.map(
          (_, i) => finishedRouteExportRows.value[i] ?? null
        );
      }
    },
    { deep: true, flush: 'sync' }
  );

  watch(
    [finishedPolylines, drawIntersectionPoints, drawEndpointMarkers, sketchLayerReady, sketchStationVertices],
    () => {
      syncNetworkDrawSketchToStore();
      if (!sketchLayerReady.value && isDrawing.value) {
        removeWindowListeners();
        endStrokeIfAny();
      }
    },
    { deep: true, flush: 'sync' }
  );
</script>

<template>
  <div
    class="network-draw-tab d-flex flex-column h-100 my-bgcolor-white"
    style="min-height: 0"
  >
    <!-- 📑 圖層分頁導航：與 MapTab / SpaceNetworkGridTab 相同的上方 tab 方塊 -->
    <div v-if="visibleLayers.length > 0" class="">
      <ul class="nav nav-tabs nav-fill">
        <li
          v-for="layer in visibleLayers"
          :key="layer.layerId"
          class="nav-item d-flex flex-column align-items-center"
        >
          <div
            class="btn nav-link rounded-0 border-0 position-relative d-flex align-items-center justify-content-center my-bgcolor-gray-200"
            :class="{ active: activeLayerTab === layer.layerId }"
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

    <div class="network-draw-canvas flex-grow-1 position-relative" style="min-height: 0">
      <div
        class="network-draw-map-stack w-100 h-100 position-absolute top-0 start-0 overflow-hidden"
        @pointermove.capture="updateSketchHoverFromEvent"
        @pointerleave.capture="onMapStackPointerLeave"
      >
        <div v-if="!sketchLayerReady" class="canvas-blocker" aria-hidden="true"></div>
        <div ref="mapEl" class="network-draw-leaflet" />
        <svg
          ref="svgRef"
          class="network-draw-svg w-100 h-100"
          :class="{
            'network-draw-svg--dim': !sketchLayerReady,
            'network-draw-svg--map-pan': interactionMode === 'hover',
          }"
          :style="{
            cursor:
              interactionMode === 'draw' ? 'crosshair' : interactionMode === 'delete' ? 'pointer' : 'default',
            touchAction: interactionMode === 'draw' ? 'none' : 'auto',
          }"
          @pointerdown="onSvgPointerDown"
          @wheel.prevent="onMapOverlayWheel"
        >
        <g
          v-if="hoverHit && (interactionMode === 'hover' || interactionMode === 'delete')"
          class="hover-highlight"
          pointer-events="none"
        >
          <template
            v-if="
              hoverHit.routeIndex != null &&
              finishedPolylinesPx[hoverHit.routeIndex] &&
              finishedPolylinesPx[hoverHit.routeIndex].length >= 2
            "
          >
            <polyline
              :points="
                finishedPolylinesPx[hoverHit.routeIndex]
                  .map((pt) => `${pt.x},${pt.y}`)
                  .join(' ')
              "
              fill="none"
              :stroke="interactionMode === 'delete' ? '#ffcdd2' : '#ffffff'"
              stroke-width="7"
              stroke-linejoin="round"
              stroke-linecap="round"
              :opacity="interactionMode === 'delete' ? 0.55 : 0.38"
            />
            <polyline
              :points="
                finishedPolylinesPx[hoverHit.routeIndex]
                  .map((pt) => `${pt.x},${pt.y}`)
                  .join(' ')
              "
              fill="none"
              :stroke="
                interactionMode === 'delete' ? '#ef5350' : routeColor(hoverHit.routeIndex)
              "
              stroke-width="4"
              stroke-linejoin="round"
              stroke-linecap="round"
              opacity="0.95"
            />
          </template>
          <g v-if="hoverHit.focusPx">
            <circle
              :cx="hoverHit.focusPx.x"
              :cy="hoverHit.focusPx.y"
              r="10"
              fill="none"
              :stroke="interactionMode === 'delete' ? '#ffebee' : '#fafafa'"
              stroke-width="3"
              :opacity="interactionMode === 'delete' ? 0.95 : 0.75"
            />
            <circle
              :cx="hoverHit.focusPx.x"
              :cy="hoverHit.focusPx.y"
              r="5.5"
              fill="none"
              :stroke="interactionMode === 'delete' ? '#c62828' : '#fbc02d'"
              stroke-width="2.25"
              opacity="0.95"
            />
          </g>
        </g>
        <g class="finished">
          <polyline
            v-for="(pts, i) in finishedPolylinesPx"
            :key="'f-' + i"
            :points="pts.map((p) => `${p.x},${p.y}`).join(' ')"
            fill="none"
            :stroke="routeColor(i)"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </g>
        <g class="network-draw-markers" pointer-events="none">
          <circle
            v-for="(p, i) in drawIntersectionPointsPx"
            :key="'ix-' + i"
            :cx="p.x"
            :cy="p.y"
            r="4.5"
            fill="#e53935"
            stroke="#ffebee"
            stroke-width="1"
          />
          <circle
            v-for="(p, i) in drawEndpointMarkersGreenPx"
            :key="'term-g-' + i"
            :cx="p.x"
            :cy="p.y"
            r="4"
            fill="#43a047"
            stroke="#e8f5e9"
            stroke-width="1"
          />
          <circle
            v-for="(p, i) in drawEndpointMarkersBluePx"
            :key="'term-b-' + i"
            :cx="p.x"
            :cy="p.y"
            r="4"
            fill="#1e88e5"
            stroke="#e3f2fd"
            stroke-width="1"
          />
          <circle
            v-for="(p, i) in sketchStationVerticesPx"
            :key="'st-' + i"
            :cx="p.x"
            :cy="p.y"
            r="4.5"
            fill="#8e24aa"
            stroke="#f3e5f5"
            stroke-width="1"
          />
        </g>
        <polyline
          v-if="draftPoints.length >= 2"
          :points="draftPointsAttr"
          fill="none"
          stroke="#FFB74D"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <circle
          v-if="draftPoints.length === 1 && draftPointsPx.length === 1"
          :cx="draftPointsPx[0].x"
          :cy="draftPointsPx[0].y"
          r="3"
          fill="#FFB74D"
          stroke="#fff"
          stroke-width="1"
          pointer-events="none"
        />
        </svg>
        <div
          v-if="sketchHoverTooltipVisible"
          class="network-draw-sketch-hover-tip text-start"
          :style="{ left: hoverTipLeftPx + 'px', top: hoverTipTopPx + 'px' }"
        >
          <pre class="network-draw-sketch-hover-tip__pre">{{ sketchHoverTooltipJson }}</pre>
        </div>
      </div>

      <!--
        外層 flex 置中、勿在含 dropdown 的節點用 transform；霧面在 ::before，避免 backdrop-filter
        讓 Popper position:fixed 變成以視窗為參考而被 overflow 裁切
      -->
      <div
        class="map-bottom-controls-wrap position-absolute bottom-0 start-0 end-0 d-flex justify-content-center mb-3"
        style="pointer-events: none; z-index: 2000"
      >
        <div
          class="map-bottom-controls network-draw-controls-surface rounded-pill shadow p-2"
          role="toolbar"
          style="pointer-events: auto"
          aria-label="手繪網絡控制"
        >
        <div
          class="d-flex flex-nowrap align-items-center justify-content-center gap-1 map-bottom-controls-row"
        >
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap my-cursor-pointer"
          :class="interactionMode === 'hover' ? 'my-btn-white' : 'my-btn-transparent'"
          :disabled="!sketchLayerReady"
          @click="interactionMode = 'hover'"
        >
          檢視
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap my-cursor-pointer"
          :class="interactionMode === 'draw' ? 'my-btn-white' : 'my-btn-transparent'"
          :disabled="!sketchLayerReady"
          @click="interactionMode = 'draw'"
        >
          手繪
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap my-cursor-pointer"
          :class="
            interactionMode === 'delete' ? 'my-btn-white text-danger' : 'my-btn-transparent'
          "
          :disabled="!sketchLayerReady"
          @click="interactionMode = 'delete'"
        >
          刪除
        </button>
        <div class="d-flex align-items-center">
          <div class="dropdown dropup">
            <button
              class="btn rounded-pill border-0 my-btn-transparent my-font-size-xs text-nowrap"
              type="button"
              data-bs-toggle="dropdown"
              data-bs-config='{"popperConfig":{"strategy":"fixed"}}'
              aria-expanded="false"
            >
              {{ getBasemapLabel(mapStore.selectedBasemap) }}
            </button>
            <ul class="dropdown-menu">
              <li v-for="basemap in mapStore.basemaps" :key="basemap.value">
                <a
                  class="dropdown-item my-content-xs-black py-1"
                  href="#"
                  @click.prevent="changeBasemap(basemap.value)"
                >
                  {{ basemap.label }}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div class="d-flex align-items-center">
          <div class="dropdown dropup">
            <button
              class="btn rounded-pill border-0 my-btn-transparent my-font-size-xs text-nowrap"
              type="button"
              data-bs-toggle="dropdown"
              data-bs-config='{"autoClose":"outside","popperConfig":{"strategy":"fixed"}}'
              aria-expanded="false"
              title="底圖明暗：上下滑動調整"
            >
              深淺
            </button>
            <ul class="dropdown-menu dropdown-menu-end network-draw-brightness-menu p-0">
              <li>
                <div
                  class="d-flex flex-column align-items-center py-2 px-2 my-bgcolor-white rounded"
                  @click.stop
                >
                  <span class="my-content-xs-gray mb-1">淺</span>
                  <div class="network-draw-brightness-rotate">
                    <input
                      v-model.number="basemapBrightness"
                      type="range"
                      class="form-range"
                      min="0.35"
                      max="1.5"
                      step="0.01"
                      aria-label="底圖深淺，上淺下深"
                    />
                  </div>
                  <span class="my-content-xs-gray mt-1">深</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .network-draw-tab {
    min-height: 0;
  }

  .network-draw-canvas {
    min-height: 0;
  }

  .map-bottom-controls {
    width: fit-content;
    max-width: calc(100% - 1.5rem);
    box-sizing: border-box;
    overflow-x: auto;
    overflow-y: visible;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }

  /* 霧面畫在 ::before，本體不設 backdrop-filter，讓 BS Dropdown（fixed）以視窗為參考、不被裁切 */
  .network-draw-controls-surface {
    position: relative;
  }

  .network-draw-controls-surface::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: 9999px;
    pointer-events: none;
    background-color: rgba(255, 255, 255, 0.4);
    backdrop-filter: blur(4px) saturate(160%);
    -webkit-backdrop-filter: blur(4px) saturate(160%);
  }

  .map-bottom-controls-row {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
  }

  .map-bottom-controls-row > * {
    flex-shrink: 0;
  }

  .map-bottom-controls :deep(.btn:disabled) {
    opacity: 0.45;
  }

  /* fixed Popper 選單在視窗上層，避免被地圖或底列 overflow 裁切；高於 Leaflet 圖層 */
  .map-bottom-controls :deep(.dropdown-menu) {
    z-index: 10050;
  }

  .network-draw-leaflet {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-color: #f0f0f0;
  }

  .network-draw-svg {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .network-draw-svg--map-pan {
    pointer-events: none !important;
  }

  /* 上淺下深：旋轉 90° 使軌道直向，min 在下方、max 在上方 */
  .network-draw-brightness-rotate {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    min-height: 5.5rem;
    margin: 0.15rem 0;
  }

  .network-draw-brightness-rotate .form-range {
    width: 5.25rem;
    height: 0.45rem;
    margin: 0;
    transform: rotate(90deg);
    transform-origin: center center;
    cursor: pointer;
  }

  .canvas-blocker {
    position: absolute;
    inset: 0;
    z-index: 2;
    background: rgba(0, 0, 0, 0.42);
    cursor: not-allowed;
  }

  .network-draw-svg--dim {
    filter: brightness(0.62);
    pointer-events: none;
  }

  .network-draw-sketch-hover-tip {
    position: fixed;
    z-index: 3200;
    max-width: min(440px, calc(100vw - 24px));
    max-height: min(72vh, 520px);
    overflow: auto;
    pointer-events: none;
    padding: 8px 10px;
    background: rgba(32, 36, 42, 0.94);
    color: #e3f2fd;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.4;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.38);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .network-draw-sketch-hover-tip__pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, Menlo, monospace;
  }
</style>
