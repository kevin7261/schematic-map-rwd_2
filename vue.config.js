/**
 * 🔧 vue.config.js - Vue CLI 專案配置文件
 *
 * 功能說明：
 * 1. 🌐 配置專案的公開路徑，用於 GitHub Pages 部署
 * 2. 📦 設定 Babel 轉譯依賴項目，確保舊瀏覽器兼容性
 * 3. 🖥️ 配置開發伺服器的端口和主機設定
 * 4. 🚀 優化建置和開發環境的各項設定
 *
 * 設計理念：
 * - 支援 GitHub Pages 部署的路徑配置
 * - 提供穩定的開發環境設定
 * - 確保跨平台和跨瀏覽器的兼容性
 *
 * @config vue.config.js
 * @version 1.0.0
 */

const { defineConfig } = require('@vue/cli-service');
const webpack = require('webpack');
const path = require('path');
const fs = require('fs');

module.exports = defineConfig({
  /**
   * 🌐 公開路徑設定 (Public Path Configuration)
   * 設定應用程式的基礎 URL 路徑，用於正確載入靜態資源
   * - 開發環境：通常為 '/'
   * - GitHub Pages：需要設定為專案名稱路徑
   */
  publicPath: '/schematic-map-rwd_2/',

  /**
   * 📄 頁面標題設定 (Page Title Configuration)
   * 設定應用程式的頁面標題
   */
  chainWebpack: (config) => {
    config.plugin('html').tap((args) => {
      args[0].title = 'Schematic Map 2';
      return args;
    });
  },

  /**
   * 📦 依賴項目轉譯設定 (Transpile Dependencies)
   * 勿設為 true：會讓 Babel 掃描整個 node_modules（含 bootstrap 已壓縮 bundle），
   * 在 Dropbox 同步或安裝中途易造成 ENOENT／無謂負載。專案 browserslist 已排除 IE11，
   * 預設僅轉譯應用程式碼即可。
   */
  transpileDependencies: false,

  /**
   * Vue 3 esm-bundler：於編譯期明確定義 feature flags，消除主控台警示並利於 production tree-shaking。
   * @see https://vuejs.org/api/compile-time-flags.html
   */
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        __VUE_OPTIONS_API__: JSON.stringify(true),
        __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
      }),
    ],
  },

  /**
   * 🖥️ 開發伺服器配置 (Development Server Configuration)
   * 設定本地開發環境的伺服器參數
   */
  devServer: {
    /**
     * 🔌 服務端口
     * 設定開發伺服器監聽的端口號
     */
    port: 8080,

    /**
     * 🌐 主機設定
     * '0.0.0.0' 允許外部設備訪問（如手機、其他電腦）
     * 'localhost' 僅允許本機訪問
     */
    host: '0.0.0.0',

    /**
     * 📁 儲存 API：開發環境下 POST /api/save-result 可將 JSON 寫入 public/data/result/
     */
    setupMiddlewares: (middlewares, devServer) => {
      if (!devServer?.app) return middlewares;
      const express = require('express');
      devServer.app.use(express.json({ limit: '50mb' }));
      devServer.app.post('/api/save-result', (req, res) => {
        try {
          const resultDir = path.join(__dirname, 'public', 'data', 'result');
          if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });
          const filePath = path.join(resultDir, '08_compact_layout_taipei.json');
          fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf8');
          res.json({ ok: true, path: 'data/result/08_compact_layout_taipei.json' });
        } catch (err) {
          console.error('[save-result]', err);
          res.status(500).json({ ok: false, error: err.message });
        }
      });

      /** osm_2_geojson_2_json：`public/data/layers/{groupName}/{layerId}/` → Upper 三分頁 fetch */
      devServer.app.post('/api/save-osm2-geojson-2-json-artifacts', (req, res) => {
        try {
          const body = req.body || {};
          const groupName = body.groupName;
          const layerId = body.layerId;
          if (typeof groupName !== 'string' || typeof layerId !== 'string') {
            res.status(400).json({ ok: false, error: 'groupName and layerId required' });
            return;
          }
          if (
            !groupName.trim() ||
            !layerId.trim() ||
            groupName.includes('..') ||
            layerId.includes('..') ||
            groupName.includes('/') ||
            groupName.includes('\\') ||
            layerId.includes('/') ||
            layerId.includes('\\')
          ) {
            res.status(400).json({ ok: false, error: 'invalid groupName or layerId' });
            return;
          }
          const layerDir = path.join(__dirname, 'public', 'data', 'layers', groupName, layerId);
          if (!fs.existsSync(layerDir)) fs.mkdirSync(layerDir, { recursive: true });
          if (typeof body.osmXml === 'string' && body.osmXml.length > 0) {
            fs.writeFileSync(path.join(layerDir, 'source.osm'), body.osmXml, 'utf8');
          }
          if (body.geojson != null && typeof body.geojson === 'object') {
            fs.writeFileSync(
              path.join(layerDir, 'routes.geojson'),
              JSON.stringify(body.geojson, null, 2),
              'utf8'
            );
          }
          if (body.segments != null) {
            fs.writeFileSync(
              path.join(layerDir, 'segments.json'),
              JSON.stringify(body.segments, null, 2),
              'utf8'
            );
          }
          res.json({ ok: true, dir: path.join('data', 'layers', groupName, layerId) });
        } catch (err) {
          console.error('[save-osm2-geojson-2-json-artifacts]', err);
          res.status(500).json({ ok: false, error: err.message });
        }
      });
      return middlewares;
    },
  },
});
