<script setup>
  /** 網路手繪 Sketch 標籤（底圖為 Leaflet 圖磚，折線以 WGS84 存點，x=經度、y=緯度）。 */
  import { ref, computed, onMounted, onUnmounted, watch, nextTick, shallowRef } from 'vue';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { useDataStore } from '@/stores/dataStore.js';
  import { useDefineStore } from '@/stores/defineStore.js';
  import { getNetworkDrawRouteColor } from '@/utils/networkDrawSketchPalette.js';
  import {
    getAllNetworkDrawSketchSn4LayerIds,
    isRegisteredNetworkDrawSketchSn4LayerId,
  } from '@/utils/networkDrawSketchSn4PipelineLayers.js';
  import {
    getGeoJsonFeatureTagProps,
    isGeoJsonNodePointFeature,
    isGeoJsonWayLineFeature,
  } from '@/utils/geojsonRouteHelpers.js';
  import {
    extractWayPolylinesWgs84FromGeojsonFeatures,
    mergeSn4SketchIntoTaipeiSn4AGeojson,
    randomSketchRouteColorHex,
    readSn4SketchPolylinesFromLayerGeojson,
    readSn4SketchStationMarkersFromLayerGeojson,
    readSn4SketchWayColorsFromLayerGeojson,
  } from '@/utils/mergeSn4SketchIntoLayerGeojson.js';
  import { buildTaipeiA3LoadLayerFieldsFromGeojson } from '@/utils/taipeiTest4/buildTaipeiA3StyleLayerFieldsFromGeojson.js';

  const PRIMARY_SKETCH_FALLBACK =
    getAllNetworkDrawSketchSn4LayerIds()[0] || 'taipei_sn4_a';

  const dataStore = useDataStore();
  const mapStore = useDefineStore();

  const map = shallowRef(null);
  const mapEl = ref(null);
  const mapViewEpoch = ref(0);
  let tileRef = null;
  /** 僅影響底圖瓦片（0.35=最深，1.5=最淺，1=預設） */
  const basemapBrightness = ref(1);

  /** 經緯度鍵：9 位小數，避免誤判重複、與 hydrate 一致 */
  const SKEY = 1e9;
  /** @param {{ x: number; y: number }} p — x=經度, y=緯度 */
  const ptKey = (p) =>
    `${Math.round(p.x * SKEY) / SKEY},${Math.round(p.y * SKEY) / SKEY}`;

  /** 與 merge 至 geojsonData 之折線序對齊；新筆畫於 pointerdown 決定 pendingStrokeColor */
  const sketchWayColors = ref([]);
  const pendingStrokeColor = ref('#666666');
  /** 與寫入 geojsonData 之 sketch way color 一致（SVG hover 提示） */
  const sketchStrokeColor = (i) =>
    sketchWayColors.value[i] || getNetworkDrawRouteColor(i);

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
  /** 'hover'：檢視／拖曳地圖；'draw'：手繪折線；'addBlackStation'：沿路點擊加黑點站（中段） */
  const interactionMode = ref('draw');

  const isDrawLikeMode = (m) => m === 'draw' || m === 'addBlackStation';
  const isDrawing = ref(false);
  /** @type {import('vue').Ref<{ routeIndex: number } | null>} 整條路線 hover，非單一細線段 */
  const hoverHit = ref(null);
  /** @type {import('vue').Ref<Array<{ x: number; y: number }>>} */
  const draftPoints = ref([]);
  /** @type {import('vue').Ref<Array<Array<{ x: number; y: number }>>>} */
  const finishedPolylines = ref([]);
  /** 與 store 對齊之 station 頂點列表（載入既有圖層時保留；手繪介面不再繪製標記） */
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
          l.upperViewTabs.includes('network-draw-lines-sn4')
      )
  );

  const getLayerFullTitle = (layer) => {
    if (!layer) return { groupName: null, layerName: '未知圖層' };
    return {
      groupName: dataStore.findGroupNameByLayerId(layer.layerId),
      layerName: layer.layerName,
    };
  };

  const MIN_SAMPLE_DIST = 2;
  const HOVER_SEG_PX = 12;
  /** 與 geojsonExportRouteSegments／hydrate 內插站容許誤差一致（度） */
  const ON_STATION_SEG_DEG = 6e-4;
  const ON_STATION_SEG_DEG_SQ = ON_STATION_SEG_DEG * ON_STATION_SEG_DEG;

  function paramAlongSegment01LngLat(ax, ay, bx, by, px, py) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-22) return 0;
    return Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  }

  function distPointToClosedSegmentSqLngLat(ax, ay, bx, by, px, py) {
    const t = paramAlongSegment01LngLat(ax, ay, bx, by, px, py);
    const qx = ax + t * (bx - ax);
    const qy = ay + t * (by - ay);
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
  }

  /** 目前圖層可用路線（優先 geojsonData 內全部 way，否則手繪折線） */
  const polylinesWgs84ForHitTest = () => {
    const layer = dataStore.findLayerById(activeLayerTab.value);
    const feats = layer?.geojsonData?.features;
    if (Array.isArray(feats) && feats.length) {
      const fromGj = extractWayPolylinesWgs84FromGeojsonFeatures(feats);
      if (fromGj.length) return fromGj;
    }
    return (finishedPolylines.value || []).filter((pl) => pl && pl.length >= 2);
  };

  /** 站點落在任一路線頂點或線段上（含內插） */
  const stationVertexOrInteriorOnPolylines = (p, pls) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    const px = Number(p.x);
    const py = Number(p.y);
    for (const pl of pls || []) {
      if (!pl || pl.length < 2) continue;
      for (const vtx of pl) {
        if (vtx && Number.isFinite(vtx.x) && Number.isFinite(vtx.y) && ptKey(vtx) === ptKey(p)) {
          return true;
        }
      }
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i];
        const b = pl[i + 1];
        if (!a || !b) continue;
        if (
          distPointToClosedSegmentSqLngLat(a.x, a.y, b.x, b.y, px, py) <= ON_STATION_SEG_DEG_SQ
        ) {
          return true;
        }
      }
    }
    return false;
  };

  /**
   * 螢幕座標投影到最近路線線段，回傳 WGS84；距離門檻為 px（與 hover 路線相近）。
   */
  const snapPointerToNearestRouteLngLat = (px, py, maxDistPx) => {
    const m = map.value;
    if (!m) return null;
    const pls = polylinesWgs84ForHitTest();
    let bestD = maxDistPx;
    let bestLngLat = null;
    for (const pl of pls) {
      if (!pl || pl.length < 2) continue;
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i];
        const b = pl[i + 1];
        if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
        const ap = m.latLngToContainerPoint(L.latLng(a.y, a.x));
        const bp = m.latLngToContainerPoint(L.latLng(b.y, b.x));
        const d = distPointToSeg(px, py, ap.x, ap.y, bp.x, bp.y);
        if (d >= bestD) continue;
        const abx = bp.x - ap.x;
        const aby = bp.y - ap.y;
        const len2 = abx * abx + aby * aby;
        let t = 0;
        if (len2 > 1e-12) {
          t = Math.max(0, Math.min(1, ((px - ap.x) * abx + (py - ap.y) * aby) / len2));
        }
        const qx = ap.x + t * abx;
        const qy = ap.y + t * aby;
        const ll = m.containerPointToLatLng(L.point(qx, qy));
        bestD = d;
        bestLngLat = { x: ll.lng, y: ll.lat };
      }
    }
    return bestLngLat;
  };

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

  const sketchStationVerticesPx = computed(() => {
    void mapViewEpoch.value;
    const m = map.value;
    if (!m) return [];
    return sketchStationVertices.value.map((p) => {
      const c = m.latLngToContainerPoint(L.latLng(p.y, p.x));
      return { x: c.x, y: c.y };
    });
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

  /** taipei_sn4_a：依目前 geojsonData 重算 processedJsonData／網格 JSON 等（與 persist 一致） */
  const applyTaipeiSn4ADerivedFieldsFromGeojson = (layer) => {
    if (!layer || layer.layerId !== 'taipei_sn4_a') return;
    const gj = layer.geojsonData || { type: 'FeatureCollection', features: [] };
    const derived = buildTaipeiA3LoadLayerFieldsFromGeojson(gj);
    layer.processedJsonData = derived.processedJsonData;
    layer.spaceNetworkGridJsonData = derived.spaceNetworkGridJsonData;
    layer.spaceNetworkGridJsonData_SectionData = derived.spaceNetworkGridJsonData_SectionData;
    layer.spaceNetworkGridJsonData_ConnectData = derived.spaceNetworkGridJsonData_ConnectData;
    layer.spaceNetworkGridJsonData_StationData = derived.spaceNetworkGridJsonData_StationData;
    layer.showStationPlacement = derived.showStationPlacement;
    layer.dataTableData = derived.dataTableData;
    layer.layerInfoData = derived.layerInfoData;
    layer.dashboardData = derived.dashboardData;
  };

  const loadLocalSketchFromStore = (layerId) => {
    if (!isRegisteredNetworkDrawSketchSn4LayerId(layerId)) return;
    const layer = dataStore.findLayerById(layerId);
    finishedPolylines.value = readSn4SketchPolylinesFromLayerGeojson(layer);
    sketchStationVertices.value = readSn4SketchStationMarkersFromLayerGeojson(layer);
    sketchWayColors.value = readSn4SketchWayColorsFromLayerGeojson(
      layer,
      finishedPolylines.value.length
    );
  };

  const persistLocalSketchToStore = (layerId) => {
    if (!isRegisteredNetworkDrawSketchSn4LayerId(layerId)) return;
    dataStore.setNetworkDrawSketchSn4UseGeo(true, layerId);

    const layer = dataStore.findLayerById(layerId);
    if (layer?.layerId === 'taipei_sn4_a') {
      const markersPayload = {
        red: [],
        blue: [],
        green: [],
        station: sketchStationVertices.value.map((p) => ({ x: p.x, y: p.y })),
      };
      mergeSn4SketchIntoTaipeiSn4AGeojson(
        layer,
        finishedPolylines.value,
        markersPayload,
        sketchWayColors.value
      );
      applyTaipeiSn4ADerivedFieldsFromGeojson(layer);
    }
  };

  const setActiveLayerTab = (layerId) => {
    const prev = activeLayerTab.value;
    if (prev && prev !== layerId && isRegisteredNetworkDrawSketchSn4LayerId(prev)) {
      persistLocalSketchToStore(prev);
    }
    activeLayerTab.value = layerId;
    if (isRegisteredNetworkDrawSketchSn4LayerId(layerId)) {
      loadLocalSketchFromStore(layerId);
      persistLocalSketchToStore(layerId);
    }
    emit('active-layer-change', layerId);
  };

  /** 路網仍含有的加站點（頂點或線段內插；刪線／改圖後移除脫離路線者） */
  const pruneSketchStationVertices = () => {
    const pls = polylinesWgs84ForHitTest();
    const next = sketchStationVertices.value.filter((p) => stationVertexOrInteriorOnPolylines(p, pls));
    if (next.length !== sketchStationVertices.value.length) {
      sketchStationVertices.value = next;
    }
  };

  /** 與 dataStore 同步：僅透過 merge 寫入 taipei_sn4_a.geojsonData（無另行 bundle） */
  const syncNetworkDrawSketchSn4ToStore = () => {
    const lid = activeLayerTab.value;
    if (!sketchLayerReady.value) return;
    persistLocalSketchToStore(lid);
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
      refreshImportedGeojsonOverlay();
    });
  };

  /** taipei_sn4_a 等：自 MapTab 複製之「載入 GeoJSON」底圖疊加（非與 ND / MapTab 共用函式） */
  let importedGeojsonFetchGen = 0;

  const removeImportedGeojsonLayers = () => {
    const m = map.value;
    if (!m) return;
    const toRemove = [];
    m.eachLayer((layer) => {
      if (layer?.options?.sn4ImportedGeojson) toRemove.push(layer);
    });
    for (const layer of toRemove) {
      try {
        m.removeLayer(layer);
      } catch (e) {
        void e;
      }
    }
  };

  /** 載入 GeoJSON ＋手繪對齊視窗（與 MapTab 類似：有檔案資料時以 GeoJSON 範圍為主，避免端點標記把視窗拉到全台） */
  const fitSn4MapToVisibleContent = () => {
    const m = map.value;
    if (!m || !props.isActive) return;

    try {
      m.invalidateSize();
    } catch (e) {
      void e;
    }

    const boundsImported = L.latLngBounds([]);
    let hasImported = false;
    m.eachLayer((layer) => {
      if (!layer?.options?.sn4ImportedGeojson || typeof layer.getBounds !== 'function') return;
      const b = layer.getBounds();
      if (b?.isValid?.()) {
        boundsImported.extend(b);
        hasImported = true;
      }
    });

    const boundsSketch = L.latLngBounds([]);
    let hasSketch = false;
    const extendSketchPt = (p) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      boundsSketch.extend(L.latLng(p.y, p.x));
      hasSketch = true;
    };
    for (const pl of finishedPolylines.value) {
      if (!pl || !pl.length) continue;
      for (const p of pl) extendSketchPt(p);
    }
    for (const p of sketchStationVertices.value) extendSketchPt(p);

    let bounds = null;
    if (hasImported && boundsImported.isValid()) {
      bounds = boundsImported;
    } else if (hasSketch && boundsSketch.isValid()) {
      bounds = boundsSketch;
    }

    if (!bounds?.isValid?.()) return;

    try {
      m.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });
    } catch (e) {
      void e;
    }
  };

  /** 分頁／面板剛顯示時容器尺寸尚未穩定，延遲 fit 才會生效（對齊 MapTab 的 nextTick + setTimeout） */
  const scheduleFitSn4MapToVisibleContent = (expectedGen = null) => {
    if (!props.isActive || !map.value) return;
    nextTick(() => {
      try {
        map.value?.invalidateSize();
      } catch (e) {
        void e;
      }
      setTimeout(() => {
        if (!props.isActive || !map.value) return;
        if (expectedGen !== null && expectedGen !== importedGeojsonFetchGen) return;
        try {
          map.value.invalidateSize();
        } catch (e) {
          void e;
        }
        fitSn4MapToVisibleContent();
      }, 120);
    });
  };

  const refreshImportedGeojsonOverlay = async () => {
    const m = map.value;
    if (!m || !props.isActive) return;
    const gen = ++importedGeojsonFetchGen;
    removeImportedGeojsonLayers();

    const lid = activeLayerTab.value;
    if (!lid || !isRegisteredNetworkDrawSketchSn4LayerId(lid)) {
      await nextTick();
      if (gen === importedGeojsonFetchGen) scheduleFitSn4MapToVisibleContent(gen);
      return;
    }

    const currentLayer = dataStore.findLayerById(lid);
    if (!currentLayer) {
      await nextTick();
      if (gen === importedGeojsonFetchGen) scheduleFitSn4MapToVisibleContent(gen);
      return;
    }

    let geojson = null;
    if (
      currentLayer.geojsonData &&
      currentLayer.geojsonData.features &&
      Array.isArray(currentLayer.geojsonData.features)
    ) {
      geojson = currentLayer.geojsonData;
    } else if (currentLayer.geojsonFileName) {
      const baseUrl = process.env.BASE_URL || '/';
      const dataPath = `${baseUrl}data/${currentLayer.geojsonFileName}`;
      try {
        const response = await fetch(dataPath);
        if (response.ok) geojson = await response.json();
        else {
          const fallbackPath = `/data/${currentLayer.geojsonFileName}`;
          const fallbackResponse = await fetch(fallbackPath);
          if (fallbackResponse.ok) geojson = await fallbackResponse.json();
        }
      } catch (fetchError) {
        // eslint-disable-next-line no-console
        console.warn(
          'Sn4 hand-draw tab: failed to load GeoJSON file:',
          currentLayer.geojsonFileName,
          fetchError
        );
      }
    }

    if (gen !== importedGeojsonFetchGen) return;
    if (!geojson?.features || !Array.isArray(geojson.features)) {
      await nextTick();
      if (gen === importedGeojsonFetchGen) scheduleFitSn4MapToVisibleContent(gen);
      return;
    }

    try {
      const routeFeatures = geojson.features.filter(isGeoJsonWayLineFeature);
      const stationFeatures = geojson.features.filter(isGeoJsonNodePointFeature);

      const routeLayerGroup = L.featureGroup([], { sn4ImportedGeojson: true });
      routeFeatures.forEach((feature) => {
        const tags = getGeoJsonFeatureTagProps(feature);
        const routeColor = tags.color || '#666666';

        const baseRouteStyle = {
          color: routeColor,
          weight: 3,
          opacity: 0.9,
          fillColor: routeColor,
          fillOpacity: 0.8,
        };

        const routeLayer = L.geoJSON(feature, {
          style: baseRouteStyle,
          pane: 'overlayPane',
        });

        routeLayer.eachLayer((layer) => {
          if (layer.setPane) layer.setPane('overlayPane');
          const tagsHtml = Object.entries(tags)
            .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
            .join('<br>');
          layer.bindPopup(`<div style="max-width: 300px;">${tagsHtml || '無標籤資訊'}</div>`, {
            closeButton: true,
          });
          layer.on('mouseover', function () {
            this.setStyle({ ...baseRouteStyle, weight: 10, opacity: 1 });
            this.openPopup();
          });
          layer.on('mouseout', function () {
            this.setStyle(baseRouteStyle);
          });
        });

        routeLayerGroup.addLayer(routeLayer);
      });

      const stationLayerGroup = L.featureGroup([], { sn4ImportedGeojson: true });
      stationFeatures.forEach((feature) => {
        const tags = getGeoJsonFeatureTagProps(feature);

        const baseStationStyle = {
          radius: 1.5,
          color: '#000000',
          weight: 1,
          fillColor: '#000000',
          fillOpacity: 1,
          pane: 'markerPane',
        };

        const stationLayer = L.geoJSON(feature, {
          pointToLayer: (_feature, latlng) => L.circleMarker(latlng, baseStationStyle),
        });

        stationLayer.eachLayer((layer) => {
          if (layer.setPane) layer.setPane('markerPane');
          const tagsHtml = Object.entries(tags)
            .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
            .join('<br>');
          layer.bindPopup(`<div style="max-width: 300px;">${tagsHtml || '無標籤資訊'}</div>`, {
            closeButton: true,
          });
          layer.on('mouseover', function () {
            this.setStyle({ ...baseStationStyle, radius: 5, weight: 2 });
            this.openPopup();
          });
          layer.on('mouseout', function () {
            this.setStyle(baseStationStyle);
          });
        });

        stationLayerGroup.addLayer(stationLayer);
      });

      routeLayerGroup.addTo(m);
      stationLayerGroup.addTo(m);

      await nextTick();
      if (gen !== importedGeojsonFetchGen) return;
      scheduleFitSn4MapToVisibleContent(gen);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Sn4 hand-draw tab: GeoJSON overlay failed:', lid, e);
      await nextTick();
      if (gen === importedGeojsonFetchGen) scheduleFitSn4MapToVisibleContent(gen);
    }
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
          const lid = activeLayerTab.value;
          if (
            sketchLayerReady.value &&
            isRegisteredNetworkDrawSketchSn4LayerId(lid)
          ) {
            persistLocalSketchToStore(lid);
          }
          refreshImportedGeojsonOverlay();
        });
      } else {
        removeImportedGeojsonLayers();
      }
    }
  );

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

  watch(
    () => activeLayerTab.value,
    () => {
      nextTick(() => refreshImportedGeojsonOverlay());
    }
  );

  watch(
    () => dataStore.findLayerById(activeLayerTab.value)?.geojsonData,
    () => {
      nextTick(() => refreshImportedGeojsonOverlay());
    },
    { deep: true }
  );

  /** 手繪折線／站點變更後自動 zoom 到內容（與 MapTab 載入 GeoJSON 後對齊） */
  watch(
    [finishedPolylines, sketchStationVertices],
    () => {
      if (!props.isActive || !map.value) return;
      nextTick(() => scheduleFitSn4MapToVisibleContent());
    },
    { deep: true }
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
      const color = pendingStrokeColor.value || randomSketchRouteColorHex();
      /** 須先加長 sketchWayColors，再動 finishedPolylines：後者有 flush:'sync' 會立刻 persist／merge GeoJSON */
      sketchWayColors.value = [...sketchWayColors.value, color];
      finishedPolylines.value = [...finishedPolylines.value, line];
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
    const p = { x: ev.x, y: ev.y };
    if (shouldAppendPoint(p)) {
      draftPoints.value = [...draftPoints.value, p];
    }
  };

  const onPointerUpWindow = (evt) => {
    if (!sketchLayerReady.value || !isDrawing.value) return;
    const ev = evt && eventToLatLngClamped(evt);
    if (ev && draftPoints.value.length >= 1) {
      const p = { x: ev.x, y: ev.y };
      draftPoints.value =
        draftPoints.value.length === 1
          ? [p]
          : [...draftPoints.value.slice(0, -1), p];
    }
    removeWindowListeners();
    endStrokeIfAny();
  };

  watch(interactionMode, (m) => {
    if (isDrawing.value && m !== 'draw') {
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
    if (!pxList.length) return null;
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


  const onSvgPointerMove = (evt) => {
    if (!sketchLayerReady.value || interactionMode.value !== 'hover' || isDrawing.value) return;
    const ev = eventToLatLngClamped(evt);
    if (!ev) return;
    const ri = findRouteIndexNearPoint({ x: ev.px, y: ev.py }, HOVER_SEG_PX);
    hoverHit.value = ri !== null ? { routeIndex: ri } : null;
  };

  const onSvgPointerLeave = () => {
    hoverHit.value = null;
  };

  const onSvgPointerDown = (evt) => {
    if (!sketchLayerReady.value) return;
    if (props.isPanelDragging) return;
    if (evt.button !== 0) return;
    evt.preventDefault();

    if (interactionMode.value === 'addBlackStation') {
      const ev0 = eventToLatLngClamped(evt);
      if (!ev0) return;
      const snapped = snapPointerToNearestRouteLngLat(ev0.px, ev0.py, HOVER_SEG_PX);
      if (!snapped) return;
      const k = ptKey(snapped);
      if (sketchStationVertices.value.some((p) => ptKey(p) === k)) return;
      sketchStationVertices.value = [...sketchStationVertices.value, snapped];
      return;
    }

    if (interactionMode.value !== 'draw') return;

    const ev = eventToLatLngClamped(evt);
    if (!ev) return;
    const p = { x: ev.x, y: ev.y };

    if (isDrawing.value) {
      removeWindowListeners();
      endStrokeIfAny();
    }

    pendingStrokeColor.value = randomSketchRouteColorHex();

    isDrawing.value = true;
    draftPoints.value = [p];

    window.addEventListener('pointermove', onPointerMoveWindow);
    window.addEventListener('pointerup', onPointerUpWindow);
    window.addEventListener('pointercancel', onPointerUpWindow);
  };

  const undoLastStroke = () => {
    if (!sketchLayerReady.value || finishedPolylines.value.length === 0) return;
    sketchWayColors.value = sketchWayColors.value.slice(0, -1);
    finishedPolylines.value = finishedPolylines.value.slice(0, -1);
  };

  const clearAll = () => {
    if (!sketchLayerReady.value) return;
    removeWindowListeners();
    draftPoints.value = [];
    isDrawing.value = false;
    hoverHit.value = null;

    const lid = activeLayerTab.value;
    const layer = dataStore.findLayerById(lid);
    if (layer?.layerId === 'taipei_sn4_a') {
      layer.geojsonData = { type: 'FeatureCollection', features: [] };
      layer.networkDrawSketchExportWgs84GeoJson = null;
      applyTaipeiSn4ADerivedFieldsFromGeojson(layer);
    }

    finishedPolylines.value = [];
    sketchWayColors.value = [];
    sketchStationVertices.value = [];
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
    },
    { deep: true, flush: 'sync' }
  );

  watch(
    [finishedPolylines, sketchLayerReady, sketchStationVertices],
    () => {
      syncNetworkDrawSketchSn4ToStore();
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
      <div class="network-draw-map-stack w-100 h-100 position-absolute top-0 start-0 overflow-hidden">
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
            interactionMode === 'draw'
              ? 'crosshair'
              : interactionMode === 'addBlackStation'
                ? 'pointer'
                : 'default',
          touchAction:
            interactionMode === 'draw' || interactionMode === 'addBlackStation' ? 'none' : 'auto',
        }"
        @pointerdown="onSvgPointerDown"
        @pointermove="onSvgPointerMove"
        @pointerleave="onSvgPointerLeave"
        @wheel.prevent="onMapOverlayWheel"
      >
        <g
          v-if="hoverHit && finishedPolylinesPx[hoverHit.routeIndex] && interactionMode === 'hover'"
          class="hover-highlight"
          pointer-events="none"
        >
          <polyline
            :points="
              finishedPolylinesPx[hoverHit.routeIndex]
                .map((pt) => `${pt.x},${pt.y}`)
                .join(' ')
            "
            fill="none"
            stroke="#ffffff"
            stroke-width="12"
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity="0.35"
          />
          <polyline
            :points="
              finishedPolylinesPx[hoverHit.routeIndex]
                .map((pt) => `${pt.x},${pt.y}`)
                .join(' ')
            "
            fill="none"
            :stroke="sketchStrokeColor(hoverHit.routeIndex)"
            stroke-width="8"
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity="0.95"
          />
        </g>
        <circle
          v-for="(sp, si) in sketchStationVerticesPx"
          :key="'sn4-st-' + si"
          :cx="sp.x"
          :cy="sp.y"
          r="1.5"
          fill="#000000"
          stroke="#000000"
          stroke-width="1"
          pointer-events="none"
        />
        <polyline
          v-if="draftPoints.length >= 2"
          :points="draftPointsAttr"
          fill="none"
          :stroke="pendingStrokeColor"
          stroke-width="3"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <circle
          v-if="draftPoints.length === 1 && draftPointsPx.length === 1"
          :cx="draftPointsPx[0].x"
          :cy="draftPointsPx[0].y"
          r="3"
          :fill="pendingStrokeColor"
          stroke="#fff"
          stroke-width="1"
          pointer-events="none"
        />
        </svg>
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
          :class="interactionMode === 'addBlackStation' ? 'my-btn-white' : 'my-btn-transparent'"
          :disabled="!sketchLayerReady"
          title="在最近路線上點擊以加入中段黑點站"
          @click="interactionMode = 'addBlackStation'"
        >
          加黑點站
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-btn-transparent my-font-size-xs text-nowrap my-cursor-pointer"
          :disabled="!sketchLayerReady"
          @click="undoLastStroke"
        >
          復原
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-btn-transparent my-font-size-xs text-nowrap my-cursor-pointer"
          :disabled="!sketchLayerReady"
          @click="clearAll"
        >
          清除
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
</style>
