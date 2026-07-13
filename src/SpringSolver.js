// 半隐式欧拉 + 回位弹簧 + 4邻居弹簧 + 阻尼。
// 坐标为局部像素空间；每帧就地修改 grid 的 x/y/vx/vy。
const MAX_STRETCH = 3 // 邻居相对位移不超过原始间距的 3 倍，防拉烂

export class SpringSolver {
  constructor(grid) {
    this.g = grid
    this.pinIndex = -1
    this.pinX = 0
    this.pinY = 0
  }

  applyImpulse(ax, ay, scale) {
    const g = this.g
    for (let i = 0; i < g.softness.length; i++) {
      const s = g.softness[i]
      if (s <= 0) continue
      g.vx[i] += ax * scale * s
      g.vy[i] += ay * scale * s
    }
  }

  setPin(index, x, y) { this.pinIndex = index; this.pinX = x; this.pinY = y }
  clearPin() { this.pinIndex = -1 }

  step(dt, params) {
    const g = this.g
    const { cols, rows } = g
    const { neighborStiffness, returnStiffness, damping } = params
    const n = cols * rows

    for (let i = 0; i < n; i++) {
      // 软度0：固定锚点
      if (g.softness[i] <= 0) { g.x[i] = g.restX[i]; g.y[i] = g.restY[i]; g.vx[i] = 0; g.vy[i] = 0; continue }
      // 钉住点：强制贴合手指
      if (i === this.pinIndex) { g.x[i] = this.pinX; g.y[i] = this.pinY; g.vx[i] = 0; g.vy[i] = 0; continue }

      const col = i % cols
      const row = (i - col) / cols
      // 回位弹簧
      let fx = returnStiffness * (g.restX[i] - g.x[i])
      let fy = returnStiffness * (g.restY[i] - g.y[i])
      // 4 邻居弹簧：维持原始相对偏移
      fx += neighborForce(g, i, col + 1, row, neighborStiffness, 0)
      fy += neighborForce(g, i, col + 1, row, neighborStiffness, 1)
      fx += neighborForce(g, i, col - 1, row, neighborStiffness, 0)
      fy += neighborForce(g, i, col - 1, row, neighborStiffness, 1)
      fx += neighborForce(g, i, col, row + 1, neighborStiffness, 0)
      fy += neighborForce(g, i, col, row + 1, neighborStiffness, 1)
      fx += neighborForce(g, i, col, row - 1, neighborStiffness, 0)
      fy += neighborForce(g, i, col, row - 1, neighborStiffness, 1)

      g.vx[i] = (g.vx[i] + fx * dt) * damping
      g.vy[i] = (g.vy[i] + fy * dt) * damping
      g.x[i] += g.vx[i] * dt
      g.y[i] += g.vy[i] * dt
    }
  }
}

// 返回索引 i 受邻居(col,row)弹簧在 axis(0=x,1=y) 上的力分量；越界返回0
function neighborForce(g, i, ncol, nrow, k, axis) {
  if (ncol < 0 || ncol >= g.cols || nrow < 0 || nrow >= g.rows) return 0
  const j = nrow * g.cols + ncol
  const cur = axis === 0 ? g.x[j] - g.x[i] : g.y[j] - g.y[i]
  const rest = axis === 0 ? g.restX[j] - g.restX[i] : g.restY[j] - g.restY[i]
  let stretch = cur - rest
  // 拉伸钳制
  const limit = Math.abs(rest) * MAX_STRETCH + 1
  if (stretch > limit) stretch = limit
  else if (stretch < -limit) stretch = -limit
  return k * stretch
}
