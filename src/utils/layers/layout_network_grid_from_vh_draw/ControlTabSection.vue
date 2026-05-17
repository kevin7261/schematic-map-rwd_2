/** Control：版面網絡網格家族（layout_network_grid_from_vh_draw／_copy／_2） */
<script setup>
  import LayoutVhDrawBlackDotRatioTables from '@/tabs/LayoutVhDrawBlackDotRatioTables.vue';
  import LayoutVhDrawDashSubgridPtHint from '@/tabs/LayoutVhDrawDashSubgridPtHint.vue';

  defineProps({
    layer: { type: Object, required: true },
    isExecuting: { type: Boolean, required: true },
    /** {@link useLayoutNetworkGridFromVhDrawControlTab} */
    api: { type: Object, required: true },
  });
</script>

<template>
  <template v-if="api.isLayoutNetworkGridFromVhDrawControlLayer(layer)">
    <div class="pb-3 mb-3 border-bottom">
      <div class="my-title-xs-gray pb-2">粗格版面：欄／列黑點 max 比例（分開歸一）</div>
      <div class="text-muted my-font-size-xs mb-2" style="line-height: 1.45">
        各<strong>欄開區間</strong>與<strong>列開區間</strong>分別算出刻度間 black-dot max
        後，在<strong>同一方向</strong>內加總歸一（欄、列互不混算；與版面網格區間標註同源）。
        若該方向全系皆為 0，該方向各段比例均等。下方比例表依<strong>目前 geojson 路網</strong
        >自動計算（粗格／格座標區間，無須按鈕）。<strong>顯示比例條繪製</strong>僅於
        Upper「<strong>layout-grid</strong>」分頁生效：依該檢視之 pt 區間即時算出之 black-dot
        max（與軸間藍色數字同源）繪製青色（欄）／玫瑰色（列）條，Σ 歸一比例見條 tooltip。
      </div>
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div class="my-content-sm-black">顯示比例條繪製</div>
        <div class="layer-toggle flex-shrink-0" @click.stop>
          <input
            type="checkbox"
            :id="'switch-layout-vh-draw-bd-rowcol-' + layer.layerId"
            :checked="layer.layoutVhDrawShowBlackDotRowColRatioOverlay === true"
            @change="
              api.onLayoutVhDrawShowBlackDotRowColRatioOverlayChange(layer, $event.target.checked)
            "
          />
          <label :for="'switch-layout-vh-draw-bd-rowcol-' + layer.layerId"></label>
        </div>
      </div>
      <div
        v-if="layer.layerId === api.LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY"
        class="d-flex flex-wrap align-items-center gap-2 mb-2"
      >
        <label
          class="my-content-sm-black mb-0 text-nowrap"
          :for="'layout-vh-draw-nei-min-pt-' + layer.layerId"
          >子網格鄰線最小寬／高（pt）</label
        >
        <input
          :id="'layout-vh-draw-nei-min-pt-' + layer.layerId"
          type="number"
          class="form-control form-control-sm"
          style="width: 5.5rem"
          min="0.25"
          max="99"
          step="0.25"
          :value="
            Number(layer.layoutVhDrawWeightedNeighborHideMinPt) > 0
              ? layer.layoutVhDrawWeightedNeighborHideMinPt
              : api.LAYOUT_VH_DRAW_COPY_GRID_NEIGHBOR_HIDE_MIN_PT
          "
          @change="api.onLayoutVhDrawCopyWeightedNeighborHideMinPtChange(layer, $event)"
        />
        <span class="text-muted my-font-size-xs" style="line-height: 1.45"
          >細於此則依 weight_差值由小到大暫隱黑點，直至寬與高皆 ≥ 此值。</span
        >
      </div>
      <div
        v-if="layer.layerId === api.LAYOUT_NETWORK_GRID_FROM_VH_DRAW_LAYER_ID_COPY"
        class="mt-3"
      >
        <div class="my-content-sm-black mb-1">weight_差值 由小到大（黑點清單）</div>
        <div
          v-if="api.layoutVhDrawCopyRowsSortedByWeightDiffAsc(layer).length === 0"
          class="text-muted my-font-size-xs"
          style="line-height: 1.45"
        >
          尚無資料。請開啟本圖層並確認 VH 繪製層路網與中段站已同步（或載入／隨機 weight
          後會更新）。
        </div>
        <div
          v-else
          class="border rounded overflow-auto bg-body"
          style="max-height: 220px; font-size: 11px"
        >
          <table class="table table-sm table-bordered mb-0 align-middle">
            <thead class="sticky-top bg-secondary bg-opacity-10">
              <tr class="text-nowrap">
                <th>序</th>
                <th>weight_差值</th>
                <th>點位類型</th>
                <th>黑點站名</th>
                <th>路線</th>
                <th>與前</th>
                <th>與後</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(wdRow, wdIdx) in api.layoutVhDrawCopyRowsSortedByWeightDiffAsc(layer)"
                :key="'layout-wdiff-' + layer.layerId + '-' + wdIdx + '-' + (wdRow['#'] ?? '')"
              >
                <td>{{ wdIdx + 1 }}</td>
                <td>{{ wdRow.weight_差值 }}</td>
                <td class="text-nowrap">{{ wdRow.點位類型 }}</td>
                <td class="text-break">{{ wdRow.黑點站名 }}</td>
                <td class="text-break" style="max-width: 120px">{{ wdRow.路線 }}</td>
                <td class="text-nowrap">{{ wdRow.weight_與前站 }}</td>
                <td class="text-nowrap">{{ wdRow.weight_與後站 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <LayoutVhDrawDashSubgridPtHint :layer="layer" />
      <LayoutVhDrawBlackDotRatioTables :layer="layer" />
    </div>

    <div class="pb-3 mb-3 border-bottom">
      <div class="my-title-xs-gray pb-2">還原 VH 繪製（本機 JSON）</div>
      <div class="text-muted my-font-size-xs mb-2" style="line-height: 1.45">
        與「站點與路線（先直後橫）·dataJson 繪製」之<strong>選擇 JSON 檔讀入</strong>相同：寫入
        <code class="small">orthogonal_toward_center_vh_draw</code>
        的 dataJson／路網並同步路網網格。可先於該層<strong>下載 JSON</strong
        >後在此讀入，省去重跑先前步驟。
      </div>
      <button
        type="button"
        class="btn rounded-pill border-0 my-font-size-xs text-nowrap w-100 my-cursor-pointer my-btn-blue mb-3"
        :disabled="isExecuting"
        @click="api.pickOrthogonalVhDrawLocalJsonClick"
      >
        選擇 JSON 檔讀入…
      </button>
      <div class="my-title-xs-gray pb-2">路段交通流量（CSV）</div>
      <div class="text-muted my-font-size-xs mb-2" style="line-height: 1.45">
        來源：<code class="small">{{ layer.csvFileName_traffic }}</code
        >（站點A、站點B、總人次）。載入後在每條路段折線中點顯示對應
        <strong>總人次</strong>；無對應資料者顯示 <strong>0</strong>。「全部隨機 weight」無須
        CSV：會依 VH 繪製層路段自動建立站對並抽 1–9（機率∝<code class="small"
          >1/2<sup>k</sup></code
        >）；若已載入 CSV 則僅重抽各筆 weight。CSV 若找不到相鄰紅／藍／黑點，會列在下方。
      </div>
      <div class="d-flex align-items-center justify-content-between mb-2">
        <div class="my-content-sm-black">顯示 weight 標籤</div>
        <div class="layer-toggle flex-shrink-0" @click.stop>
          <input
            type="checkbox"
            :id="'switch-layout-vh-draw-traffic-weights-' + layer.layerId"
            :checked="layer.layoutVhDrawShowTrafficWeights !== false"
            @change="api.onLayoutVhDrawShowTrafficWeightsChange(layer, $event.target.checked)"
          />
          <label :for="'switch-layout-vh-draw-traffic-weights-' + layer.layerId"></label>
        </div>
      </div>
      <div class="d-grid gap-2">
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap w-100 my-cursor-pointer my-btn-blue"
          @click="api.onLayoutNetworkLoadTrafficCsvClick(layer)"
        >
          載入 mrt_link_volume_undirected.csv
        </button>
        <button
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap w-100 my-cursor-pointer my-btn-green"
          @click="api.onLayoutNetworkRandomizeTrafficWeightsClick(layer)"
        >
          全部隨機 weight（1–9，反等比機率）
        </button>
        <button
          v-if="layer.layoutVhDrawTrafficData"
          type="button"
          class="btn rounded-pill border-0 my-font-size-xs text-nowrap w-100 my-cursor-pointer btn-outline-secondary"
          @click="api.onLayoutNetworkClearTrafficCsvClick(layer)"
        >
          清除交通流量資料（{{ layer.layoutVhDrawTrafficData.length }} 筆）
        </button>
      </div>
      <div
        v-if="layer.layoutVhDrawTrafficData && layer.layoutVhDrawTrafficMissing?.length"
        class="alert alert-warning my-font-size-xs mt-2 mb-0 py-2"
        style="line-height: 1.45"
      >
        <div class="fw-bold mb-1">
          CSV 找不到相鄰紅／藍／黑點：{{ layer.layoutVhDrawTrafficMissing.length }} 筆
        </div>
        <div class="overflow-auto" style="max-height: 120px">
          <div
            v-for="(it, idx) in layer.layoutVhDrawTrafficMissing"
            :key="'traffic-missing-' + idx"
            class="text-break"
          >
            #{{ idx + 1 }} {{ it.a }} - {{ it.b }}：{{ it.weight }}
            <span class="text-muted">({{ it.reason }})</span>
          </div>
        </div>
      </div>
      <div v-else-if="layer.layoutVhDrawTrafficData" class="text-success my-font-size-xs mt-2">
        CSV 所有 weight 皆已找到相鄰點。
      </div>
    </div>
  </template>
</template>

<style scoped>
  /* 與 ControlTab.vue 相同：pill 開關（子元件無法沿用父層 scoped） */
  .layer-toggle input[type='checkbox'] {
    height: 0;
    width: 0;
    visibility: hidden;
  }

  .layer-toggle label {
    cursor: pointer;
    width: 28px;
    height: 16px;
    background: var(--my-color-gray-300);
    display: block;
    border-radius: 16px;
    position: relative;
    transition: background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .layer-toggle label:after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    background: var(--my-color-white);
    border-radius: 12px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .layer-toggle input:checked + label {
    background: var(--my-color-green);
  }

  .layer-toggle input:checked + label:after {
    transform: translateX(12px);
  }

  .layer-toggle input:disabled + label {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
