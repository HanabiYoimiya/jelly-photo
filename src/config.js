export const DEFAULT_PARAMS = {
  impulse: 1200,
  neighborStiffness: 120,
  returnStiffness: 40,
  damping: 0.92,
}

export const GRID = { target: 40, max: 48 } // 目标/上限网点数（每边）

// 滑块 0..1 归一值 → 实际参数值 的线性区间 [min, max]
export const SLIDER_RANGES = {
  impulse: [200, 3000],
  neighborStiffness: [30, 300],
  returnStiffness: [10, 120],
  damping: [0.80, 0.98],
}
