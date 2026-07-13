import { describe, it, expect } from 'vitest'
import { SpringSolver } from '../src/SpringSolver.js'

// 造一个 cols×rows 网格，全部软度=soft，rest 均匀分布在 [0,w]x[0,h]
function makeGrid(cols, rows, w, h, soft) {
  const n = cols * rows
  const g = {
    cols, rows,
    restX: new Float32Array(n), restY: new Float32Array(n),
    x: new Float32Array(n), y: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n),
    softness: new Float32Array(n).fill(soft),
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    const px = cols === 1 ? 0 : (c / (cols - 1)) * w
    const py = rows === 1 ? 0 : (r / (rows - 1)) * h
    g.restX[i] = px; g.restY[i] = py; g.x[i] = px; g.y[i] = py
  }
  return g
}
const PARAMS = { neighborStiffness: 120, returnStiffness: 40, damping: 0.92 }

describe('SpringSolver', () => {
  it('软度0的网点永远不动（锚点）', () => {
    const g = makeGrid(2, 1, 100, 0, 0)
    const s = new SpringSolver(g)
    g.x[0] = 999 // 即使被人为挪动
    s.step(1 / 60, PARAMS)
    expect(g.x[0]).toBeCloseTo(g.restX[0]) // 被拉回原位
  })

  it('被扰动的软网点会衰减回到原位', () => {
    const g = makeGrid(3, 1, 100, 0, 1) // 中间点可动，两端也软
    const s = new SpringSolver(g)
    g.x[1] += 30 // 把中间点推开
    g.y[1] += 20
    for (let k = 0; k < 600; k++) s.step(1 / 60, PARAMS) // 跑 10 秒
    expect(Math.abs(g.x[1] - g.restX[1])).toBeLessThan(0.5)
    expect(Math.abs(g.y[1] - g.restY[1])).toBeLessThan(0.5)
  })

  it('applyImpulse 给软网点加速度、软度0不受力', () => {
    const g = makeGrid(2, 1, 100, 0, 0)
    g.softness[1] = 1 // 只有第二个点软
    const s = new SpringSolver(g)
    s.applyImpulse(10, 0, 1)
    expect(g.vx[0]).toBe(0)     // 软度0
    expect(g.vx[1]).toBeCloseTo(10) // 软度1
  })

  it('钉住的网点保持在钉住坐标', () => {
    const g = makeGrid(2, 1, 100, 0, 1)
    const s = new SpringSolver(g)
    s.setPin(1, 80, 25)
    for (let k = 0; k < 60; k++) s.step(1 / 60, PARAMS)
    expect(g.x[1]).toBeCloseTo(80)
    expect(g.y[1]).toBeCloseTo(25)
  })

  it('拖动钉住点会把邻居软网点拉着跟随（拉丝）', () => {
    const g = makeGrid(3, 1, 100, 0, 1)
    const s = new SpringSolver(g)
    s.setPin(2, 130, 0) // 把右端点向右拖 30
    for (let k = 0; k < 120; k++) s.step(1 / 60, PARAMS)
    // 中间点应被邻居弹簧拉向右，超过原位
    expect(g.x[1]).toBeGreaterThan(g.restX[1])
  })

  it('能量随时间衰减（阻尼有效）', () => {
    const g = makeGrid(3, 1, 100, 0, 1)
    const s = new SpringSolver(g)
    g.x[1] += 40
    const disp = () => Math.abs(g.x[1] - g.restX[1])
    for (let k = 0; k < 30; k++) s.step(1 / 60, PARAMS)
    const early = disp()
    for (let k = 0; k < 120; k++) s.step(1 / 60, PARAMS)
    const late = disp()
    expect(late).toBeLessThan(early)
  })

  it('邻居弹簧最大拉伸钳制：极端拖拽下位移保持有界（不被拉烂）', () => {
    const g = makeGrid(3, 1, 100, 0, 1) // 邻居间距 50，钳制上限 |50|*3+1=151
    const s = new SpringSolver(g)
    s.setPin(2, 5000, 0) // 把右端拖到极远，远超钳制上限
    for (let k = 0; k < 60; k++) s.step(1 / 60, PARAMS)
    // 有钳制：邻居力被封顶，中间点在回位弹簧作用下收敛到有限有界位置
    // 无钳制：力随距离无界增长，中间点会飞到数十万量级
    expect(Number.isFinite(g.x[1])).toBe(true)
    expect(Math.abs(g.x[1] - g.restX[1])).toBeLessThan(1500)
  })
})
