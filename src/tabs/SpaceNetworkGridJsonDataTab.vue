<script setup>
  /**
   * 📄 SpaceNetworkGridJsonDataTab.vue - 空間網絡網格 JSON 數據分頁組件 (Space Network Grid JSON Data Tab Component)
   *
   * 這是一個專門用於顯示圖層空間網絡網格 JSON 數據的組件，提供多圖層的 JSON 數據查看功能。
   * 該組件能夠動態顯示當前開啟圖層的空間網絡網格 JSON 數據，幫助用戶查看和檢查數據結構。
   *
   * 🎯 主要功能 (Core Features):
   * 1. 📄 空間網絡網格 JSON 數據顯示：顯示圖層的空間網絡網格 JSON 數據 (spaceNetworkGridJsonData)
   *    - 格式化 JSON 字符串顯示
   *    - 支持多圖層切換查看
   *    - 自動檢測數據可用性
   * 2. 🔄 動態圖層切換：支援多圖層的數據展示
   *    - 自動檢測新開啟的圖層
   *    - 智能切換到最新的圖層
   *    - 保持用戶的選擇狀態
   * 3. 📊 數據結構查看：提供完整的 JSON 數據結構
   *    - 格式化顯示 JSON 數據
   *    - 支持大型數據集的顯示
   *    - 提供數據可用性狀態
   * 4. 🎨 視覺化展示：直觀的數據展示方式
   *    - 清晰的代碼格式
   *    - 適當的縮進和換行
   *    - 易於閱讀的數據結構
   * 5. 📱 響應式設計：適配各種設備尺寸
   *    - 桌面版：完整的 JSON 數據顯示
   *    - 平板版：優化的觸控介面
   *    - 手機版：簡化的數據顯示
   *
   * 🏗️ 技術特點 (Technical Features):
   * - Vue 3 Composition API：現代化的組件設計
   * - Pinia 狀態管理：集中式的數據管理
   * - 響應式數據綁定：即時的狀態同步
   * - 計算屬性：高效的數據處理
   * - 監聽器：自動響應狀態變化
   *
   * 🎨 視覺設計 (Visual Design):
   * - 清晰的數據層次，突出 JSON 結構
   * - 一致的色彩方案，保持視覺統一性
   * - 直觀的代碼顯示，降低理解成本
   * - 適當的間距和排版，提升可讀性
   *
   * 🚀 使用場景 (Use Cases):
   * - 地理資訊系統的空間網絡網格數據查看
   * - 數據分析平台的數據結構檢查
   * - 互動式地圖的空間網絡網格數據查看
   * - 多維度數據的結構分析
   * - 研究工具的數據檢查
   *
   * @component SpaceNetworkGridJsonDataTab
   * @version 1.0.0
   * @author Kevin Cheng
   * @since 1.0.0
   */

  // ==================== 📦 第三方庫引入 (Third-Party Library Imports) ====================

  /**
   * Vue 3 Composition API 核心功能引入
   * 提供響應式數據、計算屬性、監聽器、生命週期鉤子等功能
   *
   * @see https://vuejs.org/
   */
  import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

  /**
   * Pinia 狀態管理庫引入
   * 提供集中式狀態管理和跨組件數據共享
   *
   * @see https://pinia.vuejs.org/
   */
  import { useDataStore } from '@/stores/dataStore.js';
  import { copyToClipboard } from '@/utils/utils.js';
  import { LAYER_ID as OSM_2_LAYER_ID, getOsm2GeojsonSessionOsmXml } from '@/utils/layers/osm_2_geojson_2_json/sessionOsmXml.js';
  import { encodeOsm2ArtifactsDirForDataUrl } from '@/utils/layers/osm_2_geojson_2_json/artifactPersist.js';
  import { minimalLineStringFeatureCollectionFromRouteExportRows } from '@/utils/mapDrawnRoutesImport.js';

  // ==================== 🏪 狀態管理初始化 (State Management Initialization) ====================

  /**
   * 獲取 Pinia 數據存儲實例
   * 用於訪問全域狀態和圖層數據
   */
  const dataStore = useDataStore();

  const activeLayerTab = ref(null); /** 📑 當前作用中的圖層分頁 */
  const copyFeedback = ref('');
  let copyFeedbackClearTimer = null;

  const emit = defineEmits(['active-layer-change']);

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
    /**
     * osm_2_geojson_2_json 專用上分頁：`osm-xml` | `osm-geojson` | `osm-derived-json`；空字串＝原本的 space-network-grid-json-data 邏輯
     */
    osmViewerMode: {
      type: String,
      default: '',
      validator: (v) =>
        typeof v === 'string' &&
        (!v || ['osm-xml', 'osm-geojson', 'osm-derived-json'].includes(v)),
    },
  });

  /** 目前選中分頁對應的圖層（osm／一般皆用） */
  const activeResolvedLayer = computed(() => {
    if (!activeLayerTab.value) return null;
    return visibleLayers.value.find((l) => l.layerId === activeLayerTab.value) ?? null;
  });

  const osmFetched = ref('');
  const osmError = ref('');
  const artifactRoutesGeoJsonText = ref(null);
  const artifactSegmentsJsonText = ref(null);

  // 獲取所有開啟且有可顯示 JSON 之相關圖層
  const visibleLayers = computed(() => {
    const allLayers = dataStore.getAllLayers();
    if (props.osmViewerMode) {
      return allLayers.filter((layer) => layer.visible && layer.layerId === OSM_2_LAYER_ID);
    }
    return allLayers.filter(
      (layer) =>
        layer.visible &&
        (layer.spaceNetworkGridJsonData ||
          layer.processedJsonData != null ||
          (layer.layerId === OSM_2_LAYER_ID && Array.isArray(layer.jsonData)))
    );
  });

  const artifactDirEncoded = computed(() => {
    if (!props.osmViewerMode) return '';
    const layer = visibleLayers.value.find((l) => l.layerId === OSM_2_LAYER_ID);
    if (!layer?.visible) return '';
    const gName = dataStore.findGroupNameByLayerId(OSM_2_LAYER_ID);
    return encodeOsm2ArtifactsDirForDataUrl(gName, OSM_2_LAYER_ID) || '';
  });

  async function fetchArtifactFileText(fileName) {
    const dir = artifactDirEncoded.value;
    if (!dir) return null;
    const baseUrl = process.env.BASE_URL || '/';
    const q = `?t=${Date.now()}`;
    try {
      let res = await fetch(`${baseUrl}data/${dir}/${fileName}${q}`);
      if (!res.ok) res = await fetch(`/data/${dir}/${fileName}${q}`);
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  watch(
    () => [
      props.osmViewerMode,
      artifactDirEncoded.value,
      activeResolvedLayer.value?.osmFileName,
      activeResolvedLayer.value?.visible,
      activeResolvedLayer.value?.isLoaded,
      activeResolvedLayer.value?.geojsonData,
      activeResolvedLayer.value?.jsonData,
    ],
    async () => {
      artifactRoutesGeoJsonText.value = null;
      artifactSegmentsJsonText.value = null;
      if (!props.osmViewerMode) return;

      const dir = artifactDirEncoded.value;

      if (props.osmViewerMode === 'osm-xml') {
        osmError.value = '';
        if (dir) {
          const fromArtifact = await fetchArtifactFileText('source.osm');
          if (fromArtifact?.trim()) {
            osmFetched.value = fromArtifact;
            return;
          }
        }
        const session = getOsm2GeojsonSessionOsmXml();
        if (session?.length > 0) {
          osmFetched.value = session;
          return;
        }
        const fn = activeResolvedLayer.value?.osmFileName;
        if (!fn || !String(fn).trim()) {
          osmFetched.value = '';
          osmError.value = '';
          return;
        }
        try {
          const baseUrl = process.env.BASE_URL || '/';
          let res = await fetch(`${baseUrl}data/${fn}`);
          if (!res.ok) res = await fetch(`/data/${fn}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          osmFetched.value = await res.text();
        } catch {
          osmFetched.value = '';
          osmError.value =
            `無法從 /data/ 讀取「${fn}」。若以本機檔載入，session 於本次運行期間保留原文。`;
        }
        return;
      }

      if (props.osmViewerMode === 'osm-geojson' && dir) {
        const txt = await fetchArtifactFileText('routes.geojson');
        if (txt?.trim()) {
          try {
            artifactRoutesGeoJsonText.value = JSON.stringify(JSON.parse(txt), null, 2);
          } catch {
            artifactRoutesGeoJsonText.value = txt;
          }
        }
        return;
      }

      if (props.osmViewerMode === 'osm-derived-json' && dir) {
        const txt = await fetchArtifactFileText('segments.json');
        if (txt?.trim()) {
          try {
            artifactSegmentsJsonText.value = JSON.stringify(JSON.parse(txt), null, 2);
          } catch {
            artifactSegmentsJsonText.value = txt;
          }
        }
      }
    },
    { immediate: true }
  );

  /**
   * 📑 設定作用中圖層分頁 (Set Active Layer Tab)
   * @param {string} layerId - 圖層 ID
   */
  const setActiveLayerTab = (layerId) => {
    activeLayerTab.value = layerId;
    emit('active-layer-change', activeLayerTab.value);
  };

  /**
   * 📊 當前圖層的「預設分頁」JSON 資料（processedJsonData 優先）（非 osm 專用分頁時使用）
   */
  const currentLayerJsonData = computed(() => {
    if (!activeLayerTab.value || props.osmViewerMode) return null;
    const layer = visibleLayers.value.find((l) => l.layerId === activeLayerTab.value);
    if (!layer) return null;
    if (layer.processedJsonData != null) return layer.processedJsonData;
    if (layer.layerId === OSM_2_LAYER_ID && Array.isArray(layer.jsonData)) return layer.jsonData;
    return layer.spaceNetworkGridJsonData || null;
  });

  const dataSubtitle = computed(() => {
    if (!props.osmViewerMode) {
      return '空間網絡網格 JSON 數據 (spaceNetworkGridJsonData)';
    }
    if (props.osmViewerMode === 'osm-xml')
      return 'OSM XML：優先 public/data/layers／{groupName}／osm_2_geojson_2_json／source.osm（否則 session／flat path）';
    if (props.osmViewerMode === 'osm-geojson')
      return '手繪會由 jsonData 還原折線 GeoJSON；否則資料夾 routes.geojson → 圖層 geojsonData';
    return 'segments.json：優先資料夾內同名檔，否則圖層 jsonData 路段陣列';
  });

  /** 空白狀態主文案（內容區） */
  const emptyContentMessage = computed(() => {
    if (!props.osmViewerMode)
      return '此圖層沒有可用的空間網絡網格 JSON 數據';
    if (props.osmViewerMode === 'osm-xml') return '此圖層沒有可顯示的 OSM XML 文字';
    if (props.osmViewerMode === 'osm-geojson')
      return '此圖層尚無可由 jsonData 還原之折線，且 geojsonData 為空';
    return '此圖層尚無 jsonData 路段匯出（請先載入 OSM）';
  });

  /** 無可見圖層時外層空狀態 */
  const emptyLayersMessage = computed(() => {
    if (!props.osmViewerMode) {
      return '沒有開啟的圖層或沒有空間網絡網格 JSON 數據';
    }
    return '請先開啟「OSM → GeoJSON → JSON」圖層';
  });

  /**
   * 📊 當前要顯示的字串（JSON 或非 JSON 皆以 pre 呈現）
   */
  const formattedDisplayString = computed(() => {
    const layer = activeResolvedLayer.value;
    if (!props.osmViewerMode) {
      if (!currentLayerJsonData.value) return null;
      try {
        return JSON.stringify(currentLayerJsonData.value, null, 2);
      } catch (error) {
        console.error('格式化 JSON 數據時發生錯誤:', error);
        return String(currentLayerJsonData.value);
      }
    }
    if (!layer) return null;

    if (props.osmViewerMode === 'osm-xml') {
      if (osmError.value) return osmError.value;
      const t = osmFetched.value;
      if (t && String(t).trim().length > 0) return t;
      const hasHandDraw =
        layer.layerId === OSM_2_LAYER_ID &&
        Array.isArray(layer.jsonData) &&
        layer.jsonData.some((r) => r && r._drawn);
      if (hasHandDraw) {
        return '（MapTab 手繪／僅有路段資料：無 OSM XML；幾何必看 geojson-viewer／原始列看 json-viewer）';
      }
      return null;
    }
    if (props.osmViewerMode === 'osm-geojson') {
      const hasHandDraw =
        layer.layerId === OSM_2_LAYER_ID &&
        Array.isArray(layer.jsonData) &&
        layer.jsonData.some((r) => r && r._drawn);
      if (hasHandDraw) {
        const fc = minimalLineStringFeatureCollectionFromRouteExportRows(layer.jsonData);
        if (fc.features.length > 0) {
          try {
            return JSON.stringify(fc, null, 2);
          } catch (e) {
            return String(e);
          }
        }
      }
      if (artifactRoutesGeoJsonText.value?.trim()) return artifactRoutesGeoJsonText.value;
      const g = layer.geojsonData;
      if (g?.features?.length) {
        try {
          return JSON.stringify(g, null, 2);
        } catch (e) {
          return String(e);
        }
      }
      const synth = minimalLineStringFeatureCollectionFromRouteExportRows(layer.jsonData || []);
      if (synth.features.length > 0) {
        try {
          return JSON.stringify(synth, null, 2);
        } catch (e) {
          return String(e);
        }
      }
      return null;
    }
    /** json-viewer：此圖層路段匯出為頂層陣列（與 taipei_city_2026.json），不包一層 processedJsonData */
    const jsonHandDraw =
      layer.layerId === OSM_2_LAYER_ID &&
      Array.isArray(layer.jsonData) &&
      layer.jsonData.some((r) => r && r._drawn);
    if (jsonHandDraw) {
      try {
        return JSON.stringify(layer.jsonData, null, 2);
      } catch (e) {
        return String(e);
      }
    }
    if (artifactSegmentsJsonText.value?.trim()) return artifactSegmentsJsonText.value;
    if (layer.layerId === OSM_2_LAYER_ID && Array.isArray(layer.jsonData)) {
      try {
        return JSON.stringify(layer.jsonData, null, 2);
      } catch (e) {
        return String(e);
      }
    }
    const bundle = {
      jsonData: layer.jsonData ?? undefined,
      dataTableData: layer.dataTableData ?? undefined,
      dashboardData: layer.dashboardData ?? undefined,
      layerInfoData: layer.layerInfoData ?? undefined,
    };
    if (layer.processedJsonData != null) {
      bundle.processedJsonData = layer.processedJsonData;
    }
    Object.keys(bundle).forEach((k) => {
      if (bundle[k] === undefined) delete bundle[k];
    });
    if (Object.keys(bundle).length === 0) return null;
    try {
      return JSON.stringify(bundle, null, 2);
    } catch (e) {
      return String(e);
    }
  });

  /** 保留舊名供複製鍵沿用 */
  const formattedJsonString = formattedDisplayString;

  /** 與 UpperView 分頁 id 一致（osm 三視窗用此取代圖層 layerName，避免三處都顯示「OSM → GeoJSON」） */
  const viewerUpperTabId = computed(() => {
    if (!props.osmViewerMode) return '';
    if (props.osmViewerMode === 'osm-xml') return 'osm-viewer';
    if (props.osmViewerMode === 'osm-geojson') return 'geojson-viewer';
    return 'json-viewer';
  });

  /**
   * 📊 取得當前選中圖層名稱 (Get Current Selected Layer Name)
   */
  const currentLayerName = computed(() => {
    if (viewerUpperTabId.value) return viewerUpperTabId.value;
    if (!activeLayerTab.value) return '無開啟圖層';
    const layer = visibleLayers.value.find((l) => l.layerId === activeLayerTab.value);
    return layer ? layer.layerName || '未知圖層' : '無開啟圖層';
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
   * 📋 一鍵複製當前圖層顯示中的 JSON 字串到剪貼簿
   */
  const copyJsonOneClick = async () => {
    const text = formattedJsonString.value;
    if (!text?.trim()) return;
    const result = await copyToClipboard(text);
    if (copyFeedbackClearTimer) clearTimeout(copyFeedbackClearTimer);
    copyFeedback.value = result.message;
    copyFeedbackClearTimer = setTimeout(() => {
      copyFeedback.value = '';
      copyFeedbackClearTimer = null;
    }, 2500);
  };

  // 記錄上一次的圖層列表用於比較
  const previousLayers = ref([]);

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
        emit('active-layer-change', activeLayerTab.value);
      }
      // 如果當前沒有選中分頁，或選中的分頁不在可見列表中，選中第一個
      else if (
        !activeLayerTab.value ||
        !newLayers.find((layer) => layer.layerId === activeLayerTab.value)
      ) {
        activeLayerTab.value = newLayers[0].layerId;
        emit('active-layer-change', activeLayerTab.value);
      }

      // 更新記錄的圖層列表
      previousLayers.value = [...newLayers];
    },
    { deep: true, immediate: true }
  );

  /**
   * 📏 調整尺寸 (Resize)
   * 響應容器尺寸變化，重新計算顯示區域
   */
  const resize = () => {
    // 對於 JSON 數據顯示組件，主要確保容器尺寸變化時能正確響應
    // 由於使用 CSS overflow-auto，主要通過觸發重新計算來確保顯示正確
    nextTick(() => {
      // 觸發 Vue 重新計算，確保滾動區域正確更新
      // 這對大型 JSON 數據的顯示很重要
    });
  };

  /**
   * 👀 監聽容器高度變化，觸發尺寸調整
   */
  watch(
    () => props.containerHeight,
    () => {
      nextTick(() => {
        resize();
      });
    }
  );

  /**
   * 🚀 組件掛載事件 (Component Mounted Event)
   */
  onMounted(() => {
    // 初始化第一個可見圖層為作用中分頁
    if (visibleLayers.value.length > 0 && !activeLayerTab.value) {
      activeLayerTab.value = visibleLayers.value[0].layerId;
      emit('active-layer-change', activeLayerTab.value);
    }

    // 監聽窗口大小變化
    window.addEventListener('resize', resize);
  });

  /**
   * 🚀 組件卸載事件 (Component Unmounted Event)
   */
  onUnmounted(() => {
    if (copyFeedbackClearTimer) clearTimeout(copyFeedbackClearTimer);
    // 移除窗口大小變化監聽器
    window.removeEventListener('resize', resize);
  });

  // 暴露 resize 方法供父組件調用
  defineExpose({
    resize,
  });
</script>

<template>
  <!-- 📄 多圖層空間網絡網格 JSON 數據視圖組件 -->
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
              <span
                v-if="!viewerUpperTabId && getLayerFullTitle(layer).groupName"
                class="my-title-xs-gray"
                >{{ getLayerFullTitle(layer).groupName }} -
              </span>
              <span class="my-title-sm-black">{{
                viewerUpperTabId || getLayerFullTitle(layer).layerName
              }}</span>
            </span>
          </div>
          <div class="w-100" :class="`my-bgcolor-${layer.colorName}`" style="min-height: 4px"></div>
        </li>
      </ul>
    </div>

    <!-- 有開啟圖層時的內容 -->
    <div v-if="visibleLayers.length > 0" class="flex-grow-1 overflow-auto my-bgcolor-white">
      <!-- 📊 當前圖層資訊 -->
      <div class="p-3 border-bottom d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div>
          <h5 class="my-title-md-black mb-0">{{ currentLayerName }}</h5>
          <div class="my-title-xs-gray">{{ dataSubtitle }}</div>
        </div>
        <div class="d-flex align-items-center gap-2 flex-shrink-0">
          <span v-if="copyFeedback" class="my-title-xs-gray text-nowrap">{{ copyFeedback }}</span>
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            :disabled="!formattedJsonString || !String(formattedJsonString).trim()"
            @click="copyJsonOneClick"
          >
            一鍵複製
          </button>
        </div>
      </div>

      <!-- 📄 JSON 數據顯示區域 -->
      <div
        v-if="formattedJsonString && String(formattedJsonString).trim()"
        class="p-3 json-data-container"
      >
        <pre class="json-data-pre">{{ formattedJsonString }}</pre>
      </div>
      <div v-else class="p-3 text-center">
        <div class="my-title-md-gray py-5">{{ emptyContentMessage }}</div>
      </div>
    </div>

    <!-- 沒有開啟圖層時的空狀態 -->
    <div v-else class="flex-grow-1 d-flex align-items-center justify-content-center">
      <div class="text-center">
        <div class="my-title-md-gray p-3">{{ emptyLayersMessage }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  /* JSON 數據容器 - 確保字體大小不被繼承 */
  .json-data-container {
    font-size: 10pt !important;
  }

  /* JSON 數據預格式化文本 - 強制 10pt Courier 字體 */
  .json-data-container pre.json-data-pre,
  pre.json-data-pre {
    background-color: #f8f9fa !important;
    border: 1px solid #dee2e6 !important;
    border-radius: 4px !important;
    padding: 1rem !important;
    margin: 0 !important;
    font-family: 'Courier New', Courier, monospace !important;
    font-size: 10pt !important;
    line-height: 1.5 !important;
    overflow-x: auto !important;
    white-space: pre-wrap !important;
    word-wrap: break-word !important;
  }

  /* 使用深度选择器确保样式不被覆盖 */
  :deep(.json-data-container pre),
  :deep(pre.json-data-pre) {
    font-size: 10pt !important;
    font-family: 'Courier New', Courier, monospace !important;
  }
</style>
