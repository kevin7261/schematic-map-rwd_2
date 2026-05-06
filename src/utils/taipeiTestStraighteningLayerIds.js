/**
 * 直線化測試圖層 ID（空間網絡網格測試_2 之「a 直線化」）
 */
export const TAIPEI_TEST_STRAIGHTENING_LAYER_IDS = ['taipei_a2'];

export function isTaipeiTestStraighteningLayerId(layerId) {
  return layerId != null && TAIPEI_TEST_STRAIGHTENING_LAYER_IDS.includes(layerId);
}
