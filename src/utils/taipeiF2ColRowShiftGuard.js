/**
 * 空間網絡網格測試_2（taipei_f2）專用：欄／列逐步檢視位移後，禁止非水平垂直折線與路線自我重疊。
 * 僅由 ControlTab 在 f2 時呼叫；不影響 taipei_f。
 */

import { getFlatSegmentsFromLayer } from './taipeiFColRouteHighlightPlan.js';

export const TAIPEI_TEST2_F_LAYER_ID = 'taipei_f2';

function roundCoord(p) {
  if (Array.isArray(p)) {
    return [Math.round(Number(p[0])), Math.round(Number(p[1]))];
  }
  return [Math.round(Number(p.x)), Math.round(Number(p.y))];
}

function edgeKeyUndirected(x0, y0, x1, y1) {
  const a = `${x0},${y0}`;
  const b = `${x1},${y1}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 檢查每條 flat segment 之 points：僅軸對齊步進；同一折線內不得重複使用同一單位格邊。
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateTaipeiF2ColRowShiftResult(layer) {
  const flat = getFlatSegmentsFromLayer(layer);
  for (let si = 0; si < flat.length; si++) {
    const pts = flat[si]?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const edgeCounts = new Map();
    for (let i = 1; i < pts.length; i++) {
      const x0 = roundCoord(pts[i - 1])[0];
      const y0 = roundCoord(pts[i - 1])[1];
      const x1 = roundCoord(pts[i])[0];
      const y1 = roundCoord(pts[i])[1];
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (dx !== 0 && dy !== 0) {
        return {
          ok: false,
          reason: '位移後出現非水平、非垂直的折線段（僅允許與座標軸平行）。',
        };
      }
      if (dx === 0 && dy === 0) continue;
      const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
      const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
      let cx = x0;
      let cy = y0;
      while (cx !== x1 || cy !== y1) {
        const nx = cx + stepX;
        const ny = cy + stepY;
        const ek = edgeKeyUndirected(cx, cy, nx, ny);
        edgeCounts.set(ek, (edgeCounts.get(ek) || 0) + 1);
        if (edgeCounts.get(ek) > 1) {
          return {
            ok: false,
            reason: '位移後同一路線重複使用同一格邊（路線自我重疊）。',
          };
        }
        cx = nx;
        cy = ny;
      }
    }
  }
  return { ok: true, reason: '' };
}

export function snapshotTaipeiFNetworkLayer(layer) {
  return {
    spaceNetworkGridJsonData: JSON.parse(JSON.stringify(layer.spaceNetworkGridJsonData ?? [])),
    spaceNetworkGridJsonData_StationData: layer.spaceNetworkGridJsonData_StationData
      ? JSON.parse(JSON.stringify(layer.spaceNetworkGridJsonData_StationData))
      : null,
    spaceNetworkGridJsonData_ConnectData: layer.spaceNetworkGridJsonData_ConnectData
      ? JSON.parse(JSON.stringify(layer.spaceNetworkGridJsonData_ConnectData))
      : null,
    spaceNetworkGridJsonData_SectionData: layer.spaceNetworkGridJsonData_SectionData
      ? JSON.parse(JSON.stringify(layer.spaceNetworkGridJsonData_SectionData))
      : null,
    _taipeiFListedGraySnapshotDone: layer._taipeiFListedGraySnapshotDone,
    _taipeiFListedGrayStationKeySet: layer._taipeiFListedGrayStationKeySet,
    _taipeiFListedGrayRouteCellKeySet: layer._taipeiFListedGrayRouteCellKeySet,
  };
}

export function restoreTaipeiFNetworkLayer(layer, snapshot) {
  if (!layer || !snapshot) return;
  layer.spaceNetworkGridJsonData = snapshot.spaceNetworkGridJsonData;
  layer.spaceNetworkGridJsonData_StationData = snapshot.spaceNetworkGridJsonData_StationData;
  layer.spaceNetworkGridJsonData_ConnectData = snapshot.spaceNetworkGridJsonData_ConnectData;
  layer.spaceNetworkGridJsonData_SectionData = snapshot.spaceNetworkGridJsonData_SectionData;
  layer._taipeiFListedGraySnapshotDone = snapshot._taipeiFListedGraySnapshotDone;
  layer._taipeiFListedGrayStationKeySet = snapshot._taipeiFListedGrayStationKeySet;
  layer._taipeiFListedGrayRouteCellKeySet = snapshot._taipeiFListedGrayRouteCellKeySet;
}
