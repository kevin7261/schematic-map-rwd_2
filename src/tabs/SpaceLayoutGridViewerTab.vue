<script setup>
  /**
   * D3 示意：圖層 dataJson（路段匯出陣列）之折線＋端點類型
   */
  import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
  import * as d3 from 'd3';
  import { useDataStore } from '@/stores/dataStore.js';
  import {
    LAYER_ID as OSM_PIPELINE_LAYER_ID,
    SPACE_LAYOUT_GRID_VIEWER_LAYER_ID,
  } from '@/utils/layers/osm_2_geojson_2_json/sessionOsmXml.js';
  import {
    normalizeRouteSegmentEndpointType,
    segmentNodeLon,
    segmentNodeLat,
  } from '@/utils/geojsonRouteHelpers.js';

  const emit = defineEmits(['active-layer-change']);

  const props = defineProps({
    containerHeight: { type: Number, default: 500 },
  });

  const dataStore = useDataStore();
  const rootEl = ref(null);

  /** 與 json-viewer 同源：優先管線圖層之 dataJson */
  const segmentRows = computed(() => {
    const pipe = dataStore.findLayerById(OSM_PIPELINE_LAYER_ID);
    const raw = pipe?.dataJson ?? pipe?.jsonData;
    return Array.isArray(raw) ? raw : [];
  });

  function chainLonLatFromRow(row) {
    const rc = row?.routeCoordinates;
    if (!Array.isArray(rc) || rc.length < 2) return [];
    const [a, mids, b] = rc;
    const out = [];
    if (Array.isArray(a) && a.length >= 2) {
      const x = Number(a[0]);
      const y = Number(a[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
    }
    if (Array.isArray(mids)) {
      for (const m of mids) {
        if (Array.isArray(m) && m.length >= 2) {
          const x = Number(m[0]);
          const y = Number(m[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
        }
      }
    }
    if (Array.isArray(b) && b.length >= 2) {
      const x = Number(b[0]);
      const y = Number(b[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
    }
    return out;
  }

  function stationPointsFromRow(row) {
    const seg = row?.segment;
    if (!seg || typeof seg !== 'object') return [];
    const pts = [];
    for (const key of ['start', 'end']) {
      const n = seg[key];
      if (n && typeof n === 'object') {
        const lo = segmentNodeLon(n);
        const la = segmentNodeLat(n);
        if (Number.isFinite(lo) && Number.isFinite(la)) {
          pts.push({
            lon: lo,
            lat: la,
            type: normalizeRouteSegmentEndpointType(n.type),
            label: String(n.station_name ?? n.station_id ?? ''),
          });
        }
      }
    }
    const mid = seg.stations;
    if (Array.isArray(mid)) {
      for (const n of mid) {
        if (n && typeof n === 'object') {
          const lo = segmentNodeLon(n);
          const la = segmentNodeLat(n);
          if (Number.isFinite(lo) && Number.isFinite(la)) {
            pts.push({
              lon: lo,
              lat: la,
              type: 'normal',
              label: String(n.station_name ?? n.station_id ?? ''),
            });
          }
        }
      }
    }
    return pts;
  }

  function collectExtent(rows) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let any = false;
    const bump = (lo, la) => {
      if (!Number.isFinite(lo) || !Number.isFinite(la)) return;
      any = true;
      minLon = Math.min(minLon, lo);
      maxLon = Math.max(maxLon, lo);
      minLat = Math.min(minLat, la);
      maxLat = Math.max(maxLat, la);
    };
    for (const row of rows) {
      for (const [lo, la] of chainLonLatFromRow(row)) {
        bump(lo, la);
      }
      for (const p of stationPointsFromRow(row)) {
        bump(p.lon, p.lat);
      }
    }
    if (!any) return null;
    const padLon = (maxLon - minLon) * 0.08 || 0.001;
    const padLat = (maxLat - minLat) * 0.08 || 0.001;
    return {
      minLon: minLon - padLon,
      maxLon: maxLon + padLon,
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
    };
  }

  function draw() {
    const el = rootEl.value;
    if (!el) return;
    const rows = segmentRows.value;
    const rect = el.getBoundingClientRect();
    const w = Math.max(2, Math.floor(rect.width));
    const h = Math.max(
      2,
      Math.floor(rect.height > 10 ? rect.height : props.containerHeight || 400)
    );
    const margin = { t: 28, r: 16, b: 36, l: 48 };

    d3.select(el).selectAll('svg').remove();

    const svg = d3
      .select(el)
      .append('svg')
      .attr('width', w)
      .attr('height', h)
      .attr('class', 'space-layout-grid-viewer-svg');

    if (rows.length === 0) {
      svg
        .append('text')
        .attr('x', w / 2)
        .attr('y', h / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6c757d')
        .attr('font-size', 13)
        .text('尚無 dataJson 路段（請先於「OSM → GeoJSON → JSON」產生路段）');
      return;
    }

    const ext = collectExtent(rows);
    if (!ext) {
      svg
        .append('text')
        .attr('x', w / 2)
        .attr('y', h / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6c757d')
        .text('無法從 dataJson 解析座標');
      return;
    }

    const xDomain = [ext.minLon, ext.maxLon];
    const yDomain = [ext.minLat, ext.maxLat];
    if (xDomain[0] === xDomain[1]) {
      xDomain[0] -= 0.0005;
      xDomain[1] += 0.0005;
    }
    if (yDomain[0] === yDomain[1]) {
      yDomain[0] -= 0.0005;
      yDomain[1] += 0.0005;
    }

    const xScale = d3
      .scaleLinear()
      .domain(xDomain)
      .range([margin.l, w - margin.r]);
    const yScale = d3
      .scaleLinear()
      .domain(yDomain)
      .range([h - margin.b, margin.t]);

    const lineGen = d3
      .line()
      .x((d) => xScale(d[0]))
      .y((d) => yScale(d[1]))
      .defined((d) => Number.isFinite(d[0]) && Number.isFinite(d[1]));

    const gRoutes = svg.append('g').attr('class', 'routes');

    rows.forEach((row, i) => {
      const chain = chainLonLatFromRow(row);
      if (chain.length < 2) return;
      const stroke = row.color && String(row.color).trim() ? String(row.color) : '#0d6efd';
      gRoutes
        .append('path')
        .attr('d', lineGen(chain))
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', 0.9);

      const label = String(row.routeName ?? row.route_id ?? i + 1);
      const midIdx = Math.floor(chain.length / 2);
      const mx = chain[midIdx][0];
      const my = chain[midIdx][1];
      gRoutes
        .append('text')
        .attr('x', xScale(mx))
        .attr('y', yScale(my))
        .attr('text-anchor', 'middle')
        .attr('dy', -6)
        .attr('fill', '#212529')
        .attr('font-size', 10)
        .attr('pointer-events', 'none')
        .text(label.length > 18 ? `${label.slice(0, 16)}…` : label);
    });

    const gNodes = svg.append('g').attr('class', 'stations');
    const seen = new Set();
    const keyOf = (lo, la) => `${lo.toFixed(6)},${la.toFixed(6)}`;

    rows.forEach((row) => {
      for (const p of stationPointsFromRow(row)) {
        const k = keyOf(p.lon, p.lat);
        if (seen.has(k)) continue;
        seen.add(k);
        const fill =
          p.type === 'terminal' ? '#0d6efd' : p.type === 'intersection' ? '#dc3545' : '#212529';
        gNodes
          .append('circle')
          .attr('cx', xScale(p.lon))
          .attr('cy', yScale(p.lat))
          .attr('r', p.type === 'normal' ? 3 : 4.5)
          .attr('fill', fill)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1)
          .append('title')
          .text(
            [p.type, p.label].filter(Boolean).join(' · ') || `${p.lon.toFixed(5)}, ${p.lat.toFixed(5)}`
          );
      }
    });

    const xa = d3.axisBottom(xScale).ticks(Math.min(8, Math.floor(w / 90)));
    const ya = d3.axisLeft(yScale).ticks(Math.min(8, Math.floor(h / 50)));
    svg
      .append('g')
      .attr('transform', `translate(0,${h - margin.b})`)
      .call(xa)
      .call((g) => g.selectAll('text').attr('font-size', 9));
    svg
      .append('g')
      .attr('transform', `translate(${margin.l},0)`)
      .call(ya)
      .call((g) => g.selectAll('text').attr('font-size', 9));

    svg
      .append('text')
      .attr('x', margin.l)
      .attr('y', 18)
      .attr('fill', '#495057')
      .attr('font-size', 12)
      .text(`路段 dataJson 示意 · ${rows.length} 段（經緯度平面投影）`);
  }

  const resize = () => {
    nextTick(() => draw());
  };

  watch(
    () => segmentRows.value,
    () => resize(),
    { deep: true }
  );
  watch(
    () => props.containerHeight,
    () => resize()
  );

  let ro;
  onMounted(() => {
    emit('active-layer-change', SPACE_LAYOUT_GRID_VIEWER_LAYER_ID);
    nextTick(() => {
      draw();
      if (typeof ResizeObserver !== 'undefined' && rootEl.value) {
        ro = new ResizeObserver(() => resize());
        ro.observe(rootEl.value);
      }
      window.addEventListener('resize', resize);
    });
  });

  onUnmounted(() => {
    if (ro && rootEl.value) {
      try {
        ro.unobserve(rootEl.value);
      } catch (e) {
        void e;
      }
    }
    ro = null;
    window.removeEventListener('resize', resize);
  });

  defineExpose({ resize });
</script>

<template>
  <div class="d-flex flex-column h-100 overflow-hidden bg-white rounded">
    <div
      ref="rootEl"
      class="flex-grow-1 w-100 position-relative h-100"
      :style="{ minHeight: Math.max(120, containerHeight - 4) + 'px' }"
    />
  </div>
</template>

<script>
  export default {
    name: 'SpaceLayoutGridViewerTab',
  };
</script>
