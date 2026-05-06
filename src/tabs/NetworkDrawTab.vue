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

  const DEDUP_DEG = 1e-7;
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

  /**
   * @param {Array<{ x: number; y: number }>} pts
   * @param {number} tol
   */
  const dedupeConsecutive = (pts, tol) => {
    if (pts.length === 0) return [];
    const out = [pts[0]];
    const tol2 = tol * tol;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const q = out[out.length - 1];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      if (dx * dx + dy * dy >= tol2) out.push(p);
    }
    return out;
  };

  /**
   * 在交叉點插入頂點後，**僅在交叉點**切斷（不把筆畫中間的密集中間點當結點切斷）。
   * @param {Array<Array<{ x: number; y: number }>>} strokes
   * @returns {Array<Array<{ x: number; y: number }>>}
   */
  const splitStrokesAtIntersections = (strokes) => {
    const valid = strokes.filter((pl) => pl && pl.length >= 2);
    if (valid.length === 0) return [];

    const list = valid.map((pl) => pl.map((p) => ({ x: p.x, y: p.y })));

    const segs = [];
    for (let pi = 0; pi < list.length; pi++) {
      const pts = list[pi];
      for (let si = 0; si < pts.length - 1; si++) {
        segs.push({ pi, si, a: pts[si], b: pts[si + 1] });
      }
    }

    /** @type Map<string, Array<{ t: number; pt: { x: number; y: number } }>> */
    const inserts = new Map();
    const hitPoints = [];

    const addInsert = (pi, si, t, pt) => {
      const k = `${pi},${si}`;
      if (!inserts.has(k)) inserts.set(k, []);
      inserts.get(k).push({ t, pt: { x: pt.x, y: pt.y } });
    };

    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const A = segs[i];
        const B = segs[j];
        if (A.pi === B.pi && Math.abs(A.si - B.si) <= 1) continue;
        const hit = segIntersect(A.a, A.b, B.a, B.b);
        if (!hit) continue;
        hitPoints.push({ x: hit.pt.x, y: hit.pt.y });
        addInsert(A.pi, A.si, hit.t, hit.pt);
        addInsert(B.pi, B.si, hit.u, hit.pt);
      }
    }

    for (const arr of inserts.values()) {
      arr.sort((p, q) => p.t - q.t);
      const deduped = [];
      for (const item of arr) {
        const last = deduped[deduped.length - 1];
        if (last && Math.abs(last.t - item.t) < 1e-5) continue;
        deduped.push(item);
      }
      arr.length = 0;
      arr.push(...deduped);
    }

    const refined = [];
    for (let pi = 0; pi < list.length; pi++) {
      const pts = list[pi];
      const next = [];
      for (let i = 0; i < pts.length - 1; i++) {
        next.push({ ...pts[i] });
        const extra = inserts.get(`${pi},${i}`);
        if (extra) {
          for (const { pt } of extra) {
            next.push({ x: pt.x, y: pt.y });
          }
        }
      }
      next.push({ ...pts[pts.length - 1] });
      refined.push(dedupeConsecutive(next, DEDUP_DEG));
    }

    /** 只把「線段相交」當分割點；筆畫端點／中間取樣點不加入，避免無交點時被切成一節一節 */
    const junctionKeys = new Set();
    for (const p of hitPoints) {
      junctionKeys.add(ptKey(p));
    }

    const chunks = [];
    for (const R of refined) {
      if (R.length < 2) continue;
      let a = 0;
      for (let b = 1; b < R.length; b++) {
        const atEnd = b === R.length - 1;
        if (junctionKeys.has(ptKey(R[b])) || atEnd) {
          const slice = R.slice(a, b + 1).map((p) => ({ x: p.x, y: p.y }));
          if (slice.length >= 2) chunks.push(slice);
          a = b;
        }
      }
    }

    return chunks.length > 0 ? chunks : valid.map((pl) => pl.map((p) => ({ x: p.x, y: p.y })));
  };

  /**
   * 將端點以距離聚類：只有叢內「恰好 2 個端點」且來自「2 條不同折線」時才合併。
   * 十字路口切分後會有 4 條臂、4 個端點落在同一叢 → 叢大小≠2 → 不會合併。
   * @param {Array<Array<{ x: number; y: number }>>} polylines
   * @returns {Array<Array<{ x: number; y: number }>>}
   */
  const mergePolylinesWhereOnlyTwoRoutesMeet = (polylines) => {
    let list = polylines
      .filter((pl) => pl && pl.length >= 2)
      .map((pl) => pl.map((p) => ({ x: p.x, y: p.y })));

    const mergeOneRound = () => {
      /** @type {Array<{ x: number; y: number; polyIdx: number; isStart: boolean }>} */
      const ends = [];
      list.forEach((pl, idx) => {
        ends.push({ x: pl[0].x, y: pl[0].y, polyIdx: idx, isStart: true });
        ends.push({
          x: pl[pl.length - 1].x,
          y: pl[pl.length - 1].y,
          polyIdx: idx,
          isStart: false,
        });
      });

      const n = ends.length;
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const unite = (a, b) => {
        const pa = find(a);
        const pb = find(b);
        if (pa !== pb) parent[pb] = pa;
      };

      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = ends[i].x - ends[j].x;
          const dy = ends[i].y - ends[j].y;
          if (dx * dx + dy * dy <= ENDPOINT_DEG2) unite(i, j);
        }
      }

      const byRoot = new Map();
      for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!byRoot.has(r)) byRoot.set(r, []);
        byRoot.get(r).push(i);
      }

      for (const idxList of byRoot.values()) {
        if (idxList.length !== 2) continue;
        const e0 = ends[idxList[0]];
        const e1 = ends[idxList[1]];
        if (e0.polyIdx === e1.polyIdx) continue;

        let A = list[e0.polyIdx].map((p) => ({ x: p.x, y: p.y }));
        let B = list[e1.polyIdx].map((p) => ({ x: p.x, y: p.y }));

        if (e0.isStart) A.reverse();
        if (!e1.isStart) B.reverse();

        const jax = A[A.length - 1].x;
        const jay = A[A.length - 1].y;
        const jbx = B[0].x;
        const jby = B[0].y;
        const jdx = jax - jbx;
        const jdy = jay - jby;
        if (jdx * jdx + jdy * jdy > ENDPOINT_DEG2 * 4) continue;

        const merged = dedupeConsecutive([...A, ...B.slice(1)], DEDUP_DEG);
        if (merged.length < 2) continue;

        const hi = Math.max(e0.polyIdx, e1.polyIdx);
        const lo = Math.min(e0.polyIdx, e1.polyIdx);
        list = list.filter((_, i) => i !== hi && i !== lo);
        list.push(merged);
        return true;
      }
      return false;
    };

    while (mergeOneRound()) {
      /* 合併後可能產生新的二路節點 */
    }
    return list;
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
   * 'hover'：檢視；'draw'：開路折線；'draw-close'：手繪結束自動接回起點成封閉線；
   * 'add-station'：點線上插入頂點（站），折線仍為一條；'cut'：點線上切開成兩條；'delete'：刪整條
   */
  const interactionMode = ref('draw');

  const isDrawLikeMode = (m) => m === 'draw' || m === 'draw-close';
  const isDrawing = ref(false);
  /** @type {import('vue').Ref<{ routeIndex: number } | null>} 整條路線 hover，非單一細線段 */
  const hoverHit = ref(null);
  /** @type {import('vue').Ref<Array<{ x: number; y: number }>>} */
  const draftPoints = ref([]);
  /** @type {import('vue').Ref<Array<Array<{ x: number; y: number }>>>} */
  const finishedPolylines = ref([]);
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

  const MIN_SAMPLE_DIST = 2;
  const HOVER_SEG_PX = 12;
  /** 加站點：線段命中較寬，避免細線難點中 */
  const ADD_STATION_HIT_PX = 22;
  /** 切開時切點須離線段兩端頂點至少此距離（px），避免無效或重複切分 */
  const SPLIT_VERT_MIN_DIST_PX = 5;
  /** 加站點時允許較靠近端點仍可插入（px） */
  const ADD_STATION_VERT_MIN_DIST_PX = 2;

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

  const loadLocalSketchFromStore = (layerId) => {
    if (!isRegisteredNetworkDrawSketchLayerId(layerId)) return;
    const lines = dataStore.getNetworkDrawSketchPolylinesForLayer(layerId);
    finishedPolylines.value = Array.isArray(lines)
      ? lines.map((pl) =>
          Array.isArray(pl) ? pl.map((p) => ({ x: Number(p.x), y: Number(p.y) })) : []
        )
      : [];
    const m = dataStore.getNetworkDrawSketchMarkersForLayer(layerId);
    sketchStationVertices.value = Array.isArray(m.station)
      ? m.station.map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      : [];
  };

  const persistLocalSketchToStore = (layerId) => {
    if (!isRegisteredNetworkDrawSketchLayerId(layerId)) return;
    dataStore.setNetworkDrawSketchUseGeo(true, layerId);
    dataStore.setNetworkDrawSketchPolylines(finishedPolylines.value, layerId);
    dataStore.setNetworkDrawSketchMarkers(
      {
        red: drawIntersectionPoints.value.map((p) => ({ x: p.x, y: p.y })),
        blue: drawEndpointMarkers.value.blue.map((p) => ({ x: p.x, y: p.y })),
        green: drawEndpointMarkers.value.green.map((p) => ({ x: p.x, y: p.y })),
        station: sketchStationVertices.value.map((p) => ({ x: p.x, y: p.y })),
      },
      layerId
    );
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
    if (!sketchLayerReady.value) {
      dataStore.setNetworkDrawSketchPolylines([], lid);
      return;
    }
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

  /**
   * 封閉：若最後一點與起點未重合，則複製起點到末尾（形成閉合折線，供幾合／叉點使用）。
   * @param {Array<{ x: number; y: number }>} pts
   */
  const closePolylineToRing = (pts) => {
    if (pts.length < 2) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy < DEDUP_DEG * DEDUP_DEG) {
      return pts;
    }
    return [...pts, { x: a.x, y: a.y }];
  };

  const endStrokeIfAny = () => {
    if (draftPoints.value.length >= 2) {
      let line = draftPoints.value.map((p) => ({ x: p.x, y: p.y }));
      if (interactionMode.value === 'draw-close') {
        line = closePolylineToRing(line);
      }
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
   * 在路線 ri 上找投影點；p 為螢幕 px；回傳切點為經緯度。
   * @param {{ x: number; y: number }} p
   * @param {number} ri
   * @param {{ maxSegPx?: number; minVertDistPx?: number } | undefined} [opts]
   * @returns {{ segIndex: number; pt: { x: number; y: number } } | null}
   */
  const findNearestSplitOnRoute = (p, ri, opts) => {
    const ptsGeo = finishedPolylines.value[ri];
    const pts = finishedPolylinesPx.value[ri];
    if (!ptsGeo || !pts || pts.length < 2) return null;
    const segPx = opts?.maxSegPx ?? HOVER_SEG_PX;
    const max2 = segPx * segPx;
    const minVert2 = (opts?.minVertDistPx ?? SPLIT_VERT_MIN_DIST_PX) ** 2;
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x;
      const ay = pts[i].y;
      const bx = pts[i + 1].x;
      const by = pts[i + 1].y;
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * abx + (p.y - ay) * aby) / len2));
      const qx = ax + t * abx;
      const qy = ay + t * aby;
      const dx = p.x - qx;
      const dy = p.y - qy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        const ag = ptsGeo[i];
        const bg = ptsGeo[i + 1];
        const gx = ag.x + t * (bg.x - ag.x);
        const gy = ag.y + t * (bg.y - ag.y);
        best = { segIndex: i, t, pt: { x: gx, y: gy } };
      }
    }
    if (!best || bestD2 > max2) return null;
    const i = best.segIndex;
    const t = best.t;
    const aPx = pts[i];
    const bPx = pts[i + 1];
    const qx = aPx.x + t * (bPx.x - aPx.x);
    const qy = aPx.y + t * (bPx.y - aPx.y);
    const dAs = (qx - aPx.x) ** 2 + (qy - aPx.y) ** 2;
    const dBs = (qx - bPx.x) ** 2 + (qy - bPx.y) ** 2;
    if (dAs < minVert2 || dBs < minVert2) return null;
    return { segIndex: i, pt: best.pt };
  };

  /**
   * 將第 ri 條折線在 segIndex～segIndex+1 之間插入 splitPt，拆成兩條。
   */
  const splitPolylineAt = (ri, segIndex, splitPt) => {
    const pl = finishedPolylines.value[ri];
    if (!pl || pl.length < 2) return;
    const left = [
      ...pl.slice(0, segIndex + 1).map((p) => ({ x: p.x, y: p.y })),
      { x: splitPt.x, y: splitPt.y },
    ];
    const right = [
      { x: splitPt.x, y: splitPt.y },
      ...pl.slice(segIndex + 1).map((p) => ({ x: p.x, y: p.y })),
    ];
    const L = dedupeConsecutive(left, DEDUP_DEG);
    const R = dedupeConsecutive(right, DEDUP_DEG);
    if (L.length < 2 || R.length < 2) return;
    const copy = finishedPolylines.value.map((line) => line.map((p) => ({ x: p.x, y: p.y })));
    copy.splice(ri, 1, L, R);
    finishedPolylines.value = copy;
  };

  /**
   * 將第 ri 條折線在 segIndex～segIndex+1 之間插入一站點頂點，仍為單一折線（與切開不同）。
   * @returns {boolean} 是否成功插入（與鄰點過近去重時為 false）
   */
  const insertStationVertexOnPolylineAt = (ri, segIndex, splitPt) => {
    const pl = finishedPolylines.value[ri];
    if (!pl || pl.length < 2) return false;
    const merged = dedupeConsecutive(
      [
        ...pl.slice(0, segIndex + 1).map((p) => ({ x: p.x, y: p.y })),
        { x: splitPt.x, y: splitPt.y },
        ...pl.slice(segIndex + 1).map((p) => ({ x: p.x, y: p.y })),
      ],
      DEDUP_DEG
    );
    if (merged.length <= pl.length) return false;
    const copy = finishedPolylines.value.map((line) => line.map((p) => ({ x: p.x, y: p.y })));
    copy[ri] = merged;
    finishedPolylines.value = copy;
    return true;
  };

  const onSvgPointerMove = (evt) => {
    if (!sketchLayerReady.value) return;
    const mode = interactionMode.value;
    if (
      (mode !== 'hover' && mode !== 'delete' && mode !== 'cut' && mode !== 'add-station') ||
      isDrawing.value
    )
      return;
    const ev = eventToLatLngClamped(evt);
    if (!ev) return;
    const segPx = mode === 'add-station' ? ADD_STATION_HIT_PX : HOVER_SEG_PX;
    const ri = findRouteIndexNearPoint({ x: ev.px, y: ev.py }, segPx);
    hoverHit.value = ri !== null ? { routeIndex: ri } : null;
  };

  const onSvgPointerLeave = () => {
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
      hoverHit.value = null;
      return;
    }

    if (interactionMode.value === 'cut') {
      if (props.isPanelDragging) return;
      if (evt.button !== 0) return;
      evt.preventDefault();
      const ev = eventToLatLngClamped(evt);
      if (!ev) return;
      const ri = findRouteIndexNearPoint({ x: ev.px, y: ev.py }, HOVER_SEG_PX);
      if (ri === null) return;
      const hit = findNearestSplitOnRoute({ x: ev.px, y: ev.py }, ri);
      if (!hit) return;
      splitPolylineAt(ri, hit.segIndex, hit.pt);
      hoverHit.value = null;
      return;
    }

    if (interactionMode.value === 'add-station') {
      if (props.isPanelDragging) return;
      if (evt.button !== 0) return;
      evt.preventDefault();
      const ev = eventToLatLngClamped(evt);
      if (!ev) return;
      const ri = findRouteIndexNearPoint({ x: ev.px, y: ev.py }, ADD_STATION_HIT_PX);
      if (ri === null) return;
      const hit = findNearestSplitOnRoute({ x: ev.px, y: ev.py }, ri, {
        maxSegPx: ADD_STATION_HIT_PX,
        minVertDistPx: ADD_STATION_VERT_MIN_DIST_PX,
      });
      if (!hit) return;
      const ok = insertStationVertexOnPolylineAt(ri, hit.segIndex, hit.pt);
      if (ok) {
        sketchStationVertices.value = [...sketchStationVertices.value, { x: hit.pt.x, y: hit.pt.y }];
      }
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

  const undoLastStroke = () => {
    if (!sketchLayerReady.value || finishedPolylines.value.length === 0) return;
    finishedPolylines.value = finishedPolylines.value.slice(0, -1);
  };

  /** 先依交叉點切分，再二路節點連線；完成後切到 Hover 方便檢視 */
  const applySplitAndMergeJunctions = () => {
    if (!sketchLayerReady.value) return;
    const src = finishedPolylines.value;
    if (!src.length) return;
    const split = splitStrokesAtIntersections(src);
    finishedPolylines.value =
      split.length >= 2 ? mergePolylinesWhereOnlyTwoRoutesMeet(split) : split;
    hoverHit.value = null;
    interactionMode.value = 'hover';
  };

  const clearAll = () => {
    if (!sketchLayerReady.value) return;
    removeWindowListeners();
    draftPoints.value = [];
    finishedPolylines.value = [];
    sketchStationVertices.value = [];
    isDrawing.value = false;
    hoverHit.value = null;
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
            interactionMode === 'draw' || interactionMode === 'draw-close'
              ? 'crosshair'
              : interactionMode === 'delete' ||
                  interactionMode === 'cut' ||
                  interactionMode === 'add-station'
                ? 'pointer'
                : 'default',
          touchAction:
            interactionMode === 'draw' || interactionMode === 'draw-close' ? 'none' : 'auto',
        }"
        @pointerdown="onSvgPointerDown"
        @pointermove="onSvgPointerMove"
        @pointerleave="onSvgPointerLeave"
        @wheel.prevent="onMapOverlayWheel"
      >
        <g
          v-if="
            hoverHit &&
            finishedPolylinesPx[hoverHit.routeIndex] &&
            (interactionMode === 'hover' ||
              interactionMode === 'delete' ||
              interactionMode === 'cut' ||
              interactionMode === 'add-station')
          "
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
            :stroke="
              interactionMode === 'delete'
                ? '#ffcdd2'
                : interactionMode === 'cut'
                  ? '#ffe0b2'
                  : interactionMode === 'add-station'
                    ? '#c8e6c9'
                    : '#ffffff'
            "
            stroke-width="7"
            stroke-linejoin="round"
            stroke-linecap="round"
            :opacity="
              interactionMode === 'delete' ||
              interactionMode === 'cut' ||
              interactionMode === 'add-station'
                ? 0.5
                : 0.35
            "
          />
          <polyline
            :points="
              finishedPolylinesPx[hoverHit.routeIndex]
                .map((pt) => `${pt.x},${pt.y}`)
                .join(' ')
            "
            fill="none"
            :stroke="
              interactionMode === 'delete'
                ? '#ef5350'
                : interactionMode === 'cut'
                  ? '#fb8c00'
                  : interactionMode === 'add-station'
                    ? '#43a047'
                    : routeColor(hoverHit.routeIndex)
            "
            stroke-width="4"
            stroke-linejoin="round"
            stroke-linecap="round"
            opacity="0.95"
          />
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
        <line
          v-if="
            interactionMode === 'draw-close' &&
            draftPoints.length >= 2 &&
            draftPointsPx.length >= 2
          "
          :x1="draftPointsPx[draftPoints.length - 1].x"
          :y1="draftPointsPx[draftPoints.length - 1].y"
          :x2="draftPointsPx[0].x"
          :y2="draftPointsPx[0].y"
          stroke="#FFB74D"
          stroke-width="2"
          stroke-opacity="0.5"
          stroke-dasharray="5 4"
          stroke-linecap="round"
          pointer-events="none"
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
          :class="interactionMode === 'draw-close' ? 'my-btn-white' : 'my-btn-transparent'"
          :disabled="!sketchLayerReady"
          title="畫完一筆時自動從最後一點連回起點，成為封閉線"
          @click="interactionMode = 'draw-close'"
        >
          閉合
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap my-cursor-pointer"
          :class="
            interactionMode === 'add-station' ? 'my-btn-white text-success' : 'my-btn-transparent'
          "
          :disabled="!sketchLayerReady"
          title="在折線上點擊，於該處插入一站點（頂點），路線仍為一條"
          @click="interactionMode = 'add-station'"
        >
          加站點
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap my-cursor-pointer"
          :class="
            interactionMode === 'cut' ? 'my-btn-white text-warning' : 'my-btn-transparent'
          "
          :disabled="!sketchLayerReady"
          @click="interactionMode = 'cut'"
        >
          切開
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
          @click="applySplitAndMergeJunctions"
        >
          切分並連線
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
