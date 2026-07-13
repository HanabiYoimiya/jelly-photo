# 果冻照片玩具 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个手机网页：上传照片→涂抹标记区域→甩手机让该区域果冻抖动、手指拖拽让它拉丝形变并回弹。

**Architecture:** 照片作为纹理贴在一张网格 Mesh 上。涂抹区域对应网点被标记"软度"。一套弹簧物理（回位弹簧+邻居弹簧+阻尼，半隐式欧拉积分）驱动所有软网点；甩动/拖拽对软网点施力，物理解算产生Q弹与拉丝，PixiJS 每帧渲染变形后的网格。

**Tech Stack:** Vite、PixiJS v8、Vitest、原生 DeviceMotion / Pointer 事件。纯前端单页，可部署到任意 HTTPS 静态托管。

## Global Constraints

- 纯前端，无后端；产出可部署到 HTTPS 静态托管（如 GitHub Pages）。
- 一支涂抹笔、一块区域，同时支持"甩动抖动"和"手指拖拽拉丝"两种玩法。
- 4 个手感参数实时可调：抖动幅度、软硬、回弹快慢、余韵/衰减。
- 网格默认 40×40，按图片尺寸自适应，避免手机卡顿。
- 未涂区域软度=0，作为固定锚点完全不动；涂得越浓软度越高、越易形变。
- 松手/停止后所有网点必弹回原位，不允许永久变形。
- 不支持/拒绝运动授权时，甩动玩法降级，拖拽玩法照常可用。

## 共享数据模型（贯穿所有模块，务必一致）

**网格状态对象 `grid`**（在局部像素坐标系，0..width / 0..height）：

```js
// n = cols * rows；索引 index(col, row) = row * cols + col
grid = {
  cols, rows,                     // number
  restX, restY,                   // Float32Array(n) 原位
  x, y,                           // Float32Array(n) 当前位置
  vx, vy,                         // Float32Array(n) 速度
  softness,                       // Float32Array(n) 软度 0..1
}
```

**参数对象 `params`**（ControlPanel 写、其它模块读）：

```js
params = {
  impulse: 1200,            // 抖动幅度：甩动注入的速度倍率（ShakeInput 用）
  neighborStiffness: 120,   // 软硬：邻居弹簧刚度（内部凝聚，越大越"整块硬果冻"）
  returnStiffness: 40,      // 回弹快慢：回位弹簧刚度（越大回原位越快）
  damping: 0.92,            // 余韵/衰减：每帧速度保留比例 <1（越接近1晃越久）
}
```

上面 4 个数值即为默认值。

## 文件结构

```
index.html                     页面骨架 + 4步流程的 DOM 容器
vite.config.js                 Vite 配置
package.json
src/
  config.js                    常量：默认 params、网格上限、滑块范围
  gridGeometry.js              buildGridGeometry() 纯函数：几何 positions/uvs/indices
  SpringSolver.js              弹簧物理，纯逻辑
  MaskPainter.js               软度网格涂抹，纯逻辑
  ImageLoader.js               文件→纹理 + 布局数学 computeFit()
  JellyMesh.js                 PixiJS 网格渲染，每帧从 grid 同步顶点
  ShakeInput.js                DeviceMotion 监听 + iOS 授权 + 注入冲量
  DragInput.js                 Pointer 监听 + 钉住/拖拽最近软网点
  ControlPanel.js              4 滑块 + 两按钮 UI，写 params
  App.js                       状态机：串联模块、管 4 步流程与边界情况
  main.js                      入口：创建 Pixi App、实例化 App
tests/
  gridGeometry.test.js
  SpringSolver.test.js
  MaskPainter.test.js
  ImageLoader.test.js
```

---

### Task 1: 项目脚手架（Vite + Pixi + Vitest）

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/config.js`
- Test: （本任务用冒烟验证，无单测）

**Interfaces:**
- Produces: `src/config.js` 导出 `DEFAULT_PARAMS`（形如上文 params）、`GRID` 常量 `{ target: 40, max: 48 }`、`SLIDER_RANGES`。

- [ ] **Step 1: 初始化 package.json**

```json
{
  "name": "jelly-photo",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "pixi.js": "^8.0.0" },
  "devDependencies": { "vite": "^5.0.0", "vitest": "^1.0.0" }
}
```

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: 生成 `node_modules` 与 `package-lock.json`，无报错。

- [ ] **Step 3: 写 vite.config.js**

```js
import { defineConfig } from 'vite'
export default defineConfig({
  base: './',            // 相对路径，便于部署到 GitHub Pages 子路径
  server: { host: true } // 便于手机连同一 WiFi 真机调试
})
```

- [ ] **Step 4: 写 src/config.js**

```js
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
```

- [ ] **Step 5: 写 index.html**

```html
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <title>果冻照片</title>
  <style>
    html,body{margin:0;height:100%;background:#111;overflow:hidden;font-family:system-ui,sans-serif;color:#fff;touch-action:none}
    #stage{position:fixed;inset:0}
    canvas{display:block}
  </style>
</head>
<body>
  <div id="stage"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 6: 写 src/main.js（空 Pixi 画布冒烟）**

```js
import { Application } from 'pixi.js'

const app = new Application()
await app.init({ resizeTo: window, background: '#111', antialias: true })
document.getElementById('stage').appendChild(app.canvas)
```

- [ ] **Step 7: 冒烟验证**

Run: `npm run dev`
Expected: 浏览器打开显示深灰空画布，控制台无报错。
Run: `npm test`
Expected: Vitest 报告 "No test files found"（正常，尚无测试）。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.js index.html src/main.js src/config.js
git commit -m "chore: 脚手架 Vite+Pixi+Vitest，空画布冒烟"
```

---

### Task 2: 网格几何构建器 buildGridGeometry（纯函数 TDD）

**Files:**
- Create: `src/gridGeometry.js`
- Test: `tests/gridGeometry.test.js`

**Interfaces:**
- Produces: `buildGridGeometry(cols, rows, width, height) → { positions: Float32Array(cols*rows*2), uvs: Float32Array(cols*rows*2), indices: Uint16Array((cols-1)*(rows-1)*6) }`。positions 为交错 `[x0,y0,x1,y1,...]`，行主序（index = row*cols+col），x∈[0,width]、y∈[0,height]，uv∈[0,1]。

- [ ] **Step 1: 写失败测试**

```js
// tests/gridGeometry.test.js
import { describe, it, expect } from 'vitest'
import { buildGridGeometry } from '../src/gridGeometry.js'

describe('buildGridGeometry', () => {
  it('生成正确数量的顶点与三角形索引', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    expect(g.positions.length).toBe(3 * 2 * 2) // 6 顶点 * xy
    expect(g.uvs.length).toBe(3 * 2 * 2)
    expect(g.indices.length).toBe((3 - 1) * (2 - 1) * 6) // 2 quad * 6
  })

  it('四角顶点落在 [0,width]x[0,height]', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    // 左上 (col0,row0) index0
    expect(g.positions[0]).toBeCloseTo(0)
    expect(g.positions[1]).toBeCloseTo(0)
    // 右下 (col2,row1) index5 -> offset 10
    expect(g.positions[10]).toBeCloseTo(100)
    expect(g.positions[11]).toBeCloseTo(50)
  })

  it('uv 与位置成比例', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    expect(g.uvs[10]).toBeCloseTo(1) // 右下 u
    expect(g.uvs[11]).toBeCloseTo(1) // 右下 v
  })

  it('索引均为合法顶点下标', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    for (const idx of g.indices) expect(idx).toBeLessThan(6)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/gridGeometry.test.js`
Expected: FAIL，`buildGridGeometry` 未定义。

- [ ] **Step 3: 实现**

```js
// src/gridGeometry.js
// 行主序网格：index(col,row) = row*cols + col
export function buildGridGeometry(cols, rows, width, height) {
  const n = cols * rows
  const positions = new Float32Array(n * 2)
  const uvs = new Float32Array(n * 2)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const u = cols === 1 ? 0 : col / (cols - 1)
      const v = rows === 1 ? 0 : row / (rows - 1)
      positions[i * 2] = u * width
      positions[i * 2 + 1] = v * height
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
    }
  }
  const quads = (cols - 1) * (rows - 1)
  const indices = new Uint16Array(quads * 6)
  let p = 0
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices[p++] = a; indices[p++] = b; indices[p++] = c // 三角1
      indices[p++] = b; indices[p++] = d; indices[p++] = c // 三角2
    }
  }
  return { positions, uvs, indices }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/gridGeometry.test.js`
Expected: PASS，4 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/gridGeometry.js tests/gridGeometry.test.js
git commit -m "feat: 网格几何构建器 buildGridGeometry + 单测"
```

---

### Task 3: 弹簧物理 SpringSolver（纯逻辑 TDD，核心手感）

**Files:**
- Create: `src/SpringSolver.js`
- Test: `tests/SpringSolver.test.js`

**Interfaces:**
- Consumes: 共享 `grid` 对象（含 restX/restY/x/y/vx/vy/softness、cols、rows）与 `params`（neighborStiffness / returnStiffness / damping）。
- Produces: class `SpringSolver`：
  - `new SpringSolver(grid)`
  - `applyImpulse(ax, ay, scale)` — 给每个软网点加速度 `vx += ax*scale*softness`（软度0不受力）。
  - `setPin(index, x, y)` / `clearPin()` — 钉住/释放单个网点（拖拽用）。
  - `step(dt, params)` — 推进一帧，就地修改 grid 的 x/y/vx/vy。软度0网点恒等于原位；钉住网点恒等于钉住坐标且速度清零；其余按弹簧+阻尼积分。含最大拉伸钳制（邻居相对位移不超过原始间距的 `MAX_STRETCH=3` 倍）保证不被拉烂、松手必回原位。

- [ ] **Step 1: 写失败测试**

```js
// tests/SpringSolver.test.js
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
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/SpringSolver.test.js`
Expected: FAIL，`SpringSolver` 未定义。

- [ ] **Step 3: 实现**

```js
// src/SpringSolver.js
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/SpringSolver.test.js`
Expected: PASS，6 个用例全绿。若"衰减回原位"用例超时未收敛，说明积分发散——把测试里的 dt 改小或确认 damping<1 生效；默认参数下应收敛。

- [ ] **Step 5: Commit**

```bash
git add src/SpringSolver.js tests/SpringSolver.test.js
git commit -m "feat: 弹簧物理 SpringSolver（回位+邻居+阻尼+钳制）+ 单测"
```

---

### Task 4: 涂抹软度网格 MaskPainter（纯逻辑 TDD）

**Files:**
- Create: `src/MaskPainter.js`
- Test: `tests/MaskPainter.test.js`

**Interfaces:**
- Consumes: 网格尺寸 `cols, rows` 与显示尺寸 `width, height`。
- Produces: class `MaskPainter`：
  - `new MaskPainter(cols, rows, width, height)`，内部持 `softness: Float32Array(cols*rows)` 全0。
  - `paint(px, py, radius, strength)` — 以局部像素坐标 (px,py) 为圆心、radius 像素为半径，圆内网点软度按到圆心距离线性递增（圆心+strength、边缘+0），clamp 到 [0,1]。
  - `erase(px, py, radius, strength)` — 同上但递减。
  - `clear()` — 全置0。
  - `hasSoft()` — 是否存在软度>0 的网点（用于"没涂就点开始"校验）。
  - `getSoftness()` — 返回 softness 数组引用（写入 grid.softness）。

- [ ] **Step 1: 写失败测试**

```js
// tests/MaskPainter.test.js
import { describe, it, expect } from 'vitest'
import { MaskPainter } from '../src/MaskPainter.js'

describe('MaskPainter', () => {
  it('初始无软度', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    expect(m.hasSoft()).toBe(false)
    expect(m.getSoftness().every(v => v === 0)).toBe(true)
  })

  it('涂抹后圆心软度高于边缘、圆外为0', () => {
    const m = new MaskPainter(5, 5, 100, 100) // 网点间距 25px
    m.paint(50, 50, 30, 1) // 中心 (col2,row2)=index12
    const s = m.getSoftness()
    expect(s[12]).toBeGreaterThan(0.9)      // 圆心
    expect(s[0]).toBe(0)                    // 左上角(0,0) 距中心>30
    expect(m.hasSoft()).toBe(true)
    // 相邻点(col2,row1)=index7 距圆心25<30，软度介于0和圆心之间
    expect(s[7]).toBeGreaterThan(0)
    expect(s[7]).toBeLessThan(s[12])
  })

  it('软度累加并 clamp 到 1', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    m.paint(50, 50, 30, 1)
    m.paint(50, 50, 30, 1)
    expect(m.getSoftness()[12]).toBe(1)
  })

  it('擦除降低软度', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    m.paint(50, 50, 30, 1)
    m.erase(50, 50, 30, 1)
    expect(m.getSoftness()[12]).toBeCloseTo(0)
  })

  it('clear 全部归零', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    m.paint(50, 50, 40, 1)
    m.clear()
    expect(m.hasSoft()).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/MaskPainter.test.js`
Expected: FAIL，`MaskPainter` 未定义。

- [ ] **Step 3: 实现**

```js
// src/MaskPainter.js
export class MaskPainter {
  constructor(cols, rows, width, height) {
    this.cols = cols; this.rows = rows
    this.width = width; this.height = height
    this.softness = new Float32Array(cols * rows)
  }

  _stamp(px, py, radius, delta) {
    const { cols, rows, width, height, softness } = this
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gx = cols === 1 ? 0 : (col / (cols - 1)) * width
        const gy = rows === 1 ? 0 : (row / (rows - 1)) * height
        const dist = Math.hypot(gx - px, gy - py)
        if (dist > radius) continue
        const falloff = 1 - dist / radius // 圆心1→边缘0
        const i = row * cols + col
        let v = softness[i] + delta * falloff
        softness[i] = v < 0 ? 0 : v > 1 ? 1 : v
      }
    }
  }

  paint(px, py, radius, strength) { this._stamp(px, py, radius, strength) }
  erase(px, py, radius, strength) { this._stamp(px, py, radius, -strength) }
  clear() { this.softness.fill(0) }
  hasSoft() { return this.softness.some(v => v > 0) }
  getSoftness() { return this.softness }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/MaskPainter.test.js`
Expected: PASS，5 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/MaskPainter.js tests/MaskPainter.test.js
git commit -m "feat: 涂抹软度网格 MaskPainter + 单测"
```

---

### Task 5: 图片加载与布局 ImageLoader（布局数学 TDD + 纹理加载）

**Files:**
- Create: `src/ImageLoader.js`
- Test: `tests/ImageLoader.test.js`

**Interfaces:**
- Produces:
  - `computeFit(imgW, imgH, viewW, viewH) → { width, height, x, y }` — 纯函数：按"contain"方式把图片等比缩放铺进视口并居中，返回显示尺寸与左上角偏移。
  - `computeGridSize(imgW, imgH, target, max) → { cols, rows }` — 纯函数：长边取 target 网点，短边等比且至少 2，均不超过 max。
  - `async loadTexture(file) → { texture, imgW, imgH }` — 用 `pixi.js` 的 `Assets`/`Texture` 从 File 读为纹理（集成部分，手动验证）。

- [ ] **Step 1: 写失败测试（纯数学部分）**

```js
// tests/ImageLoader.test.js
import { describe, it, expect } from 'vitest'
import { computeFit, computeGridSize } from '../src/ImageLoader.js'

describe('computeFit', () => {
  it('横图受视口宽限制、垂直居中', () => {
    const f = computeFit(200, 100, 100, 100) // 图2:1，视口1:1 → 宽100 高50
    expect(f.width).toBeCloseTo(100)
    expect(f.height).toBeCloseTo(50)
    expect(f.x).toBeCloseTo(0)
    expect(f.y).toBeCloseTo(25) // (100-50)/2
  })
  it('竖图受视口高限制、水平居中', () => {
    const f = computeFit(100, 200, 100, 100) // 高100 宽50
    expect(f.height).toBeCloseTo(100)
    expect(f.width).toBeCloseTo(50)
    expect(f.x).toBeCloseTo(25)
    expect(f.y).toBeCloseTo(0)
  })
})

describe('computeGridSize', () => {
  it('长边取 target，短边等比', () => {
    const g = computeGridSize(200, 100, 40, 48) // 宽长 → cols=40, rows=20
    expect(g.cols).toBe(40)
    expect(g.rows).toBe(20)
  })
  it('不超过 max', () => {
    const g = computeGridSize(500, 100, 40, 48)
    expect(g.cols).toBeLessThanOrEqual(48)
  })
  it('短边至少 2', () => {
    const g = computeGridSize(1000, 100, 40, 48)
    expect(g.rows).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ImageLoader.test.js`
Expected: FAIL，函数未定义。

- [ ] **Step 3: 实现**

```js
// src/ImageLoader.js
import { Texture } from 'pixi.js'

export function computeFit(imgW, imgH, viewW, viewH) {
  const scale = Math.min(viewW / imgW, viewH / imgH)
  const width = imgW * scale
  const height = imgH * scale
  return { width, height, x: (viewW - width) / 2, y: (viewH - height) / 2 }
}

export function computeGridSize(imgW, imgH, target, max) {
  let cols, rows
  if (imgW >= imgH) {
    cols = Math.min(target, max)
    rows = Math.round(cols * (imgH / imgW))
  } else {
    rows = Math.min(target, max)
    cols = Math.round(rows * (imgW / imgH))
  }
  cols = Math.min(Math.max(cols, 2), max)
  rows = Math.min(Math.max(rows, 2), max)
  return { cols, rows }
}

// 集成部分：从 File 读为 PixiJS 纹理（手动验证，不进单测）
export async function loadTexture(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const texture = Texture.from(img)
    return { texture, imgW: img.naturalWidth, imgH: img.naturalHeight }
  } finally {
    // 纹理已持有像素，可释放 objectURL
    URL.revokeObjectURL(url)
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/ImageLoader.test.js`
Expected: PASS，5 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/ImageLoader.js tests/ImageLoader.test.js
git commit -m "feat: ImageLoader 布局数学(TDD)+纹理加载"
```

---

### Task 6: 网格渲染 JellyMesh（PixiJS 集成，手动 QA）

**Files:**
- Create: `src/JellyMesh.js`

**Interfaces:**
- Consumes: `buildGridGeometry`（Task 2）、共享 `grid`、PixiJS `Texture`。
- Produces: class `JellyMesh`：
  - `new JellyMesh(texture, grid, displayW, displayH)` — 构建 `PIXI.Mesh`（几何来自 buildGridGeometry，尺寸=显示尺寸），暴露 `.mesh`（PIXI.Container 可加入舞台）。
  - `sync()` — 把 grid.x/grid.y 写入几何 positions 缓冲并标记更新（每帧调用）。
  - `initGridFromGeometry()` — 用几何的 rest positions 初始化 grid 的 restX/restY/x/y（vx/vy=0），供 App 在建网格后调用。

- [ ] **Step 1: 实现**

```js
// src/JellyMesh.js
import { Mesh, Geometry, Shader } from 'pixi.js'
import { buildGridGeometry } from './gridGeometry.js'

export class JellyMesh {
  constructor(texture, grid, displayW, displayH) {
    this.grid = grid
    const { cols, rows } = grid
    const geo = buildGridGeometry(cols, rows, displayW, displayH)
    this._positions = geo.positions // Float32Array 交错 xy，直接作为 attribute 缓冲

    this.geometry = new Geometry({
      attributes: {
        aPosition: this._positions,
        aUV: geo.uvs,
      },
      indexBuffer: geo.indices,
    })

    // 用 Pixi 内置纹理 Mesh：v8 提供 MeshGeometry/纹理着色器；
    // 简化起见用 Mesh + texture（Pixi 会套默认纹理着色器）。
    this.mesh = new Mesh({ geometry: this.geometry, texture })
  }

  // 用几何 rest 位置初始化 grid（restX/restY/x/y）
  initGridFromGeometry() {
    const g = this.grid
    const pos = this._positions
    for (let i = 0; i < g.restX.length; i++) {
      g.restX[i] = pos[i * 2];     g.restY[i] = pos[i * 2 + 1]
      g.x[i] = g.restX[i];         g.y[i] = g.restY[i]
      g.vx[i] = 0;                 g.vy[i] = 0
    }
  }

  sync() {
    const g = this.grid
    const pos = this._positions
    for (let i = 0; i < g.x.length; i++) {
      pos[i * 2] = g.x[i]
      pos[i * 2 + 1] = g.y[i]
    }
    // 通知 Pixi 位置缓冲已变
    this.geometry.getBuffer('aPosition').update()
  }
}
```

> **实现者注意（Pixi v8 API 校验）**：`Mesh`/`Geometry` 的构造签名、纹理默认着色器、以及 attribute 名（`aPosition`/`aUV`）在 Pixi v8 可能与上面略有出入。若默认着色器不认这些名字，改用 Pixi v8 的 `MeshSimple`/`MeshPlane`（如可用）或提供最简纹理着色器。判定标准见下方 QA：图片能正确贴在网格上显示即算通过。

- [ ] **Step 2: 临时接线做手动 QA**

在 `src/main.js` 临时加：加载一张打包内的测试图 → `computeFit`/`computeGridSize` → 建 grid（空 softness）→ `new JellyMesh(...)` → `initGridFromGeometry()` → `app.stage.addChild(mesh.mesh)`，并把 mesh 放到 `{x:fit.x, y:fit.y}`。加一个 ticker 里手动令某个网点 `grid.x[i]+=Math.sin(t)` 后 `sync()`。

- [ ] **Step 3: 手动 QA 验证**

Run: `npm run dev`
Expected：
- 图片按 contain 居中正确显示、无拉伸变形。
- 被手动扰动的那个网点周围图像发生局部变形（说明 sync 生效）。
- 控制台无 WebGL/着色器报错。

- [ ] **Step 4: 移除临时接线、Commit**

移除 main.js 里的临时测试代码（保留最简空画布）。

```bash
git add src/JellyMesh.js src/main.js
git commit -m "feat: JellyMesh PixiJS 网格渲染 + 顶点同步"
```

---

### Task 7: 甩动输入 ShakeInput（DeviceMotion + iOS 授权，手动 QA）

**Files:**
- Create: `src/ShakeInput.js`

**Interfaces:**
- Consumes: `SpringSolver` 实例、`params`（读 impulse）。
- Produces: class `ShakeInput`：
  - `new ShakeInput(solver, params)`
  - `async requestPermission() → boolean` — iOS 13+ 调 `DeviceMotionEvent.requestPermission()`；其它环境直接返回 true。捕获异常/拒绝返回 false。
  - `start()` — 监听 `devicemotion`，每次事件取 `acceleration`（去重力），若加速度模长超过阈值 `SHAKE_THRESHOLD` 则 `solver.applyImpulse(ax, ay, params.impulse/1000)`（换算成局部像素方向：x→水平、y→竖直，注意手机坐标与屏幕y方向相反，取 `-accel.y`）。
  - `stop()` — 移除监听。
  - 静态 `isSupported()` — `typeof DeviceMotionEvent !== 'undefined'`。

- [ ] **Step 1: 实现**

```js
// src/ShakeInput.js
const SHAKE_THRESHOLD = 6 // m/s^2，低于此忽略手抖

export class ShakeInput {
  constructor(solver, params) {
    this.solver = solver
    this.params = params
    this._onMotion = this._onMotion.bind(this)
  }

  static isSupported() {
    return typeof DeviceMotionEvent !== 'undefined'
  }

  async requestPermission() {
    try {
      if (typeof DeviceMotionEvent !== 'undefined' &&
          typeof DeviceMotionEvent.requestPermission === 'function') {
        const res = await DeviceMotionEvent.requestPermission()
        return res === 'granted'
      }
      return true // 非 iOS 或旧环境无需授权
    } catch {
      return false
    }
  }

  start() { window.addEventListener('devicemotion', this._onMotion) }
  stop() { window.removeEventListener('devicemotion', this._onMotion) }

  _onMotion(e) {
    const a = e.acceleration // 去除重力的加速度
    if (!a || a.x == null) return
    const mag = Math.hypot(a.x, a.y, a.z || 0)
    if (mag < SHAKE_THRESHOLD) return
    // 屏幕 y 向下为正，设备 y 向上为正 → 取负
    this.solver.applyImpulse(a.x, -a.y, this.params.impulse / 1000)
  }
}
```

- [ ] **Step 2: 手动 QA（需真机 + HTTPS 或 `vite --host` 局域网）**

临时在 App/main 接线：涂一块软区域 → 调 `requestPermission()` → `start()` → 甩手机。
Expected：
- iOS 弹出运动授权，允许后甩动使软区域朝甩动方向Q弹抖动、再收回原位。
- 轻微手抖不触发（阈值有效）。
- 桌面 `isSupported()` 为 false 或无 motion 事件，不报错。

- [ ] **Step 3: Commit**

```bash
git add src/ShakeInput.js
git commit -m "feat: ShakeInput 甩动注入冲量 + iOS 授权/降级"
```

---

### Task 8: 拖拽输入 DragInput（Pointer 钉住拖拽，手动 QA）

**Files:**
- Create: `src/DragInput.js`

**Interfaces:**
- Consumes: `SpringSolver` 实例、共享 `grid`、mesh 在舞台的偏移 `offset {x,y}`（把页面坐标转局部坐标）、canvas 元素。
- Produces: class `DragInput`：
  - `new DragInput(canvas, solver, grid, offset)`
  - `enable()` / `disable()` — 绑定/解绑 pointerdown/move/up。
  - 内部 `findNearestSoft(localX, localY) → index`：在软度>0 的网点中找离指针最近者；若最近距离超过 `GRAB_RADIUS=60px` 返回 -1（点空不抓）。
  - down：算最近软网点，`solver.setPin(i, localX, localY)`；move：更新 pin 坐标；up：`solver.clearPin()`。

- [ ] **Step 1: 实现**

```js
// src/DragInput.js
const GRAB_RADIUS = 60 // 局部像素，超出不抓取

export class DragInput {
  constructor(canvas, solver, grid, offset) {
    this.canvas = canvas
    this.solver = solver
    this.grid = grid
    this.offset = offset // {x,y} mesh 左上角在页面中的位置
    this.active = false
    this._down = this._down.bind(this)
    this._move = this._move.bind(this)
    this._up = this._up.bind(this)
  }

  enable() {
    this.canvas.addEventListener('pointerdown', this._down)
    window.addEventListener('pointermove', this._move)
    window.addEventListener('pointerup', this._up)
    window.addEventListener('pointercancel', this._up)
  }
  disable() {
    this.canvas.removeEventListener('pointerdown', this._down)
    window.removeEventListener('pointermove', this._move)
    window.removeEventListener('pointerup', this._up)
    window.removeEventListener('pointercancel', this._up)
    this.solver.clearPin()
    this.active = false
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left - this.offset.x, y: e.clientY - r.top - this.offset.y }
  }

  findNearestSoft(lx, ly) {
    const g = this.grid
    let best = -1, bestD = Infinity
    for (let i = 0; i < g.softness.length; i++) {
      if (g.softness[i] <= 0) continue
      const d = Math.hypot(g.restX[i] - lx, g.restY[i] - ly)
      if (d < bestD) { bestD = d; best = i }
    }
    return bestD <= GRAB_RADIUS ? best : -1
  }

  _down(e) {
    const p = this._local(e)
    const i = this.findNearestSoft(p.x, p.y)
    if (i < 0) return
    this.active = true
    this.solver.setPin(i, p.x, p.y)
  }
  _move(e) {
    if (!this.active) return
    const p = this._local(e)
    this.solver.setPin(this.solver.pinIndex, p.x, p.y)
  }
  _up() {
    if (!this.active) return
    this.active = false
    this.solver.clearPin()
  }
}
```

- [ ] **Step 2: 手动 QA**

Run: `npm run dev`（桌面即可，用鼠标）
Expected：
- 按住软区域向右拖，区域像拉丝一样跟随变形，边缘被邻居弹簧拉扯。
- 松开鼠标，区域Q弹回原位。
- 点在未涂区域（软度0）不产生抓取。

- [ ] **Step 3: Commit**

```bash
git add src/DragInput.js
git commit -m "feat: DragInput 指针钉住拖拽拉丝"
```

---

### Task 9: 参数面板 ControlPanel（滑块 UI，手动 QA）

**Files:**
- Create: `src/ControlPanel.js`
- Modify: `index.html`（加面板容器与样式）

**Interfaces:**
- Consumes: 共享 `params`、`SLIDER_RANGES`（config）。
- Produces: class `ControlPanel`：
  - `new ControlPanel(params, { onRepaint, onChangePhoto })`
  - `mount(parentEl)` — 生成 4 个滑块（抖动幅度/软硬/回弹快慢/余韵）+ 两个按钮（重新涂抹/换照片），滑动实时把归一值经 `SLIDER_RANGES` 映射写回 `params`。
  - `show()` / `hide()`。

- [ ] **Step 1: index.html 加容器**

在 `<div id="stage"></div>` 后加：

```html
<div id="panel" class="panel hidden"></div>
<style>
  .panel{position:fixed;left:0;right:0;bottom:0;padding:12px 16px;background:rgba(20,20,24,.82);backdrop-filter:blur(8px);display:flex;flex-direction:column;gap:8px}
  .panel.hidden{display:none}
  .panel .row{display:flex;align-items:center;gap:10px;font-size:13px}
  .panel .row label{width:72px;flex:none;opacity:.85}
  .panel input[type=range]{flex:1}
  .panel .btns{display:flex;gap:10px;margin-top:4px}
  .panel button{flex:1;padding:10px;border:0;border-radius:10px;background:#3a6df0;color:#fff;font-size:14px}
  .panel button.ghost{background:#333}
</style>
```

- [ ] **Step 2: 实现 ControlPanel**

```js
// src/ControlPanel.js
import { SLIDER_RANGES } from './config.js'

const SLIDERS = [
  { key: 'impulse',           label: '抖动幅度' },
  { key: 'neighborStiffness', label: '软硬' },
  { key: 'returnStiffness',   label: '回弹快慢' },
  { key: 'damping',           label: '余韵' },
]

export class ControlPanel {
  constructor(params, { onRepaint, onChangePhoto }) {
    this.params = params
    this.onRepaint = onRepaint
    this.onChangePhoto = onChangePhoto
    this.el = null
  }

  mount(parentEl) {
    this.el = parentEl
    parentEl.innerHTML = ''
    for (const s of SLIDERS) {
      const [min, max] = SLIDER_RANGES[s.key]
      const row = document.createElement('div')
      row.className = 'row'
      const norm = (this.params[s.key] - min) / (max - min)
      row.innerHTML = `<label>${s.label}</label>`
      const input = document.createElement('input')
      input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'
      input.value = String(norm)
      input.addEventListener('input', () => {
        this.params[s.key] = min + parseFloat(input.value) * (max - min)
      })
      row.appendChild(input)
      parentEl.appendChild(row)
    }
    const btns = document.createElement('div')
    btns.className = 'btns'
    const repaint = document.createElement('button')
    repaint.className = 'ghost'; repaint.textContent = '重新涂抹'
    repaint.addEventListener('click', () => this.onRepaint())
    const change = document.createElement('button')
    change.textContent = '换照片'
    change.addEventListener('click', () => this.onChangePhoto())
    btns.appendChild(repaint); btns.appendChild(change)
    parentEl.appendChild(btns)
  }

  show() { this.el.classList.remove('hidden') }
  hide() { this.el.classList.add('hidden') }
}
```

- [ ] **Step 3: 手动 QA**

临时接线显示面板（下一任务会正式接）。
Expected：拖动 4 个滑块时对应 `params` 数值实时变化（可 `console.log(params)` 验证）；两按钮触发回调。

- [ ] **Step 4: Commit**

```bash
git add src/ControlPanel.js index.html
git commit -m "feat: ControlPanel 参数滑块面板"
```

---

### Task 10: 主流程状态机 App（串联 4 步 + 边界情况，手动 QA）

**Files:**
- Create: `src/App.js`
- Modify: `src/main.js`, `index.html`（加上传按钮、涂抹工具条、开始按钮、提示条 DOM）

**Interfaces:**
- Consumes: 以上全部模块 + `DEFAULT_PARAMS`/`GRID`（config）。
- Produces: class `App`，管理状态 `UPLOAD → PAINT → PLAY`：
  - `UPLOAD`：显示上传按钮；选图后 `loadTexture` + `computeFit` + `computeGridSize` 建 grid 与 JellyMesh，进入 PAINT。
  - `PAINT`：canvas 上 pointer 涂抹调 `MaskPainter.paint/erase`，实时高亮蒙层；"清空""橡皮/画笔"切换；"开始"校验 `maskPainter.hasSoft()`，为空则提示，否则把 softness 写入 grid、蒙层淡出、进入 PLAY。
  - `PLAY`：启动 ticker（每帧 `solver.step` + `mesh.sync`）；`ShakeInput.requestPermission()`+`start()`（失败则顶部提示"当前设备不支持甩动，可用手指拖拽"并降级）；`DragInput.enable()`；`ControlPanel.show()`。"重新涂抹"回 PAINT、"换照片"回 UPLOAD（各自 stop/清理）。

- [ ] **Step 1: index.html 加流程 DOM**

在 `#stage` 后、`#panel` 前加：

```html
<input id="file" type="file" accept="image/*" hidden />
<div id="uploadUI" class="center"><button id="uploadBtn">上传照片</button></div>
<div id="paintUI" class="paintbar hidden">
  <button id="toolBrush" class="active">画笔</button>
  <button id="toolErase">橡皮</button>
  <button id="clearBtn" class="ghost">清空</button>
  <button id="startBtn">开始</button>
</div>
<div id="toast" class="toast hidden"></div>
<style>
  .center{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
  .center button{padding:14px 28px;border:0;border-radius:12px;background:#3a6df0;color:#fff;font-size:16px}
  .paintbar{position:fixed;top:0;left:0;right:0;display:flex;gap:8px;padding:10px;background:rgba(20,20,24,.82);backdrop-filter:blur(8px)}
  .paintbar.hidden,.center.hidden{display:none}
  .paintbar button{flex:1;padding:10px;border:0;border-radius:10px;background:#333;color:#fff;font-size:14px}
  .paintbar button.active{background:#3a6df0}
  .paintbar button#startBtn{background:#28a745}
  .toast{position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:10px;background:rgba(0,0,0,.75);font-size:13px;max-width:90%;text-align:center}
  .toast.hidden{display:none}
</style>
```

- [ ] **Step 2: 实现 App.js**

```js
// src/App.js
import { Container, Graphics } from 'pixi.js'
import { DEFAULT_PARAMS, GRID } from './config.js'
import { loadTexture, computeFit, computeGridSize } from './ImageLoader.js'
import { MaskPainter } from './MaskPainter.js'
import { SpringSolver } from './SpringSolver.js'
import { JellyMesh } from './JellyMesh.js'
import { ShakeInput } from './ShakeInput.js'
import { DragInput } from './DragInput.js'
import { ControlPanel } from './ControlPanel.js'

const BRUSH_RADIUS = 40

export class App {
  constructor(pixiApp) {
    this.app = pixiApp
    this.params = { ...DEFAULT_PARAMS }
    this.state = 'UPLOAD'
    this.tool = 'brush'
    this._painting = false
    this._bindUI()
  }

  _bindUI() {
    this.$ = (id) => document.getElementById(id)
    this.$('uploadBtn').onclick = () => this.$('file').click()
    this.$('file').onchange = (e) => e.target.files[0] && this._onFile(e.target.files[0])
    this.$('toolBrush').onclick = () => this._setTool('brush')
    this.$('toolErase').onclick = () => this._setTool('erase')
    this.$('clearBtn').onclick = () => { this.maskPainter.clear(); this._redrawMask() }
    this.$('startBtn').onclick = () => this._start()
    // 涂抹 pointer（仅 PAINT 生效）
    const c = this.app.canvas
    c.addEventListener('pointerdown', (e) => this.state === 'PAINT' && (this._painting = true, this._paintAt(e)))
    window.addEventListener('pointermove', (e) => this.state === 'PAINT' && this._painting && this._paintAt(e))
    window.addEventListener('pointerup', () => this._painting = false)
  }

  _toast(msg, ms = 2600) {
    const t = this.$('toast'); t.textContent = msg; t.classList.remove('hidden')
    clearTimeout(this._toastT); if (ms) this._toastT = setTimeout(() => t.classList.add('hidden'), ms)
  }

  async _onFile(file) {
    const view = { w: this.app.screen.width, h: this.app.screen.height }
    const { texture, imgW, imgH } = await loadTexture(file)
    this.fit = computeFit(imgW, imgH, view.w, view.h)
    const { cols, rows } = computeGridSize(imgW, imgH, GRID.target, GRID.max)
    // 建共享 grid
    const n = cols * rows
    this.grid = {
      cols, rows,
      restX: new Float32Array(n), restY: new Float32Array(n),
      x: new Float32Array(n), y: new Float32Array(n),
      vx: new Float32Array(n), vy: new Float32Array(n),
      softness: new Float32Array(n),
    }
    // 清旧舞台
    this.app.stage.removeChildren()
    this.mesh = new JellyMesh(texture, this.grid, this.fit.width, this.fit.height)
    this.mesh.mesh.position.set(this.fit.x, this.fit.y)
    this.mesh.initGridFromGeometry()
    this.app.stage.addChild(this.mesh.mesh)
    // 涂抹相关
    this.maskPainter = new MaskPainter(cols, rows, this.fit.width, this.fit.height)
    this.maskGfx = new Graphics(); this.maskLayer = new Container()
    this.maskLayer.position.set(this.fit.x, this.fit.y)
    this.maskLayer.addChild(this.maskGfx)
    this.app.stage.addChild(this.maskLayer)
    this._enterPaint()
  }

  _setTool(t) {
    this.tool = t
    this.$('toolBrush').classList.toggle('active', t === 'brush')
    this.$('toolErase').classList.toggle('active', t === 'erase')
  }

  _paintAt(e) {
    const r = this.app.canvas.getBoundingClientRect()
    const lx = e.clientX - r.left - this.fit.x
    const ly = e.clientY - r.top - this.fit.y
    if (this.tool === 'brush') this.maskPainter.paint(lx, ly, BRUSH_RADIUS, 0.5)
    else this.maskPainter.erase(lx, ly, BRUSH_RADIUS, 0.5)
    this._redrawMask()
  }

  // 用软度网格画半透明高亮蒙层
  _redrawMask() {
    const g = this.grid, s = this.maskPainter.getSoftness()
    const gfx = this.maskGfx; gfx.clear()
    const cw = this.fit.width / (g.cols - 1), ch = this.fit.height / (g.rows - 1)
    for (let i = 0; i < s.length; i++) {
      if (s[i] <= 0) continue
      const col = i % g.cols, row = (i - i % g.cols) / g.cols
      gfx.rect(col * cw - cw / 2, row * ch - ch / 2, cw, ch).fill({ color: 0x3a6df0, alpha: 0.35 * s[i] })
    }
  }

  _enterPaint() {
    this.state = 'PAINT'
    this.$('uploadUI').classList.add('hidden')
    this.$('paintUI').classList.remove('hidden')
    this.panel && this.panel.hide()
    this.maskLayer.visible = true
    this._toast('涂抹你想要变Q弹的地方，然后点开始')
  }

  _start() {
    if (!this.maskPainter.hasSoft()) { this._toast('先涂抹要抖动的地方～'); return }
    // 写入软度到 grid
    this.grid.softness.set(this.maskPainter.getSoftness())
    this.maskLayer.visible = false
    this.$('paintUI').classList.add('hidden')
    this._enterPlay()
  }

  _enterPlay() {
    this.state = 'PLAY'
    this.solver = new SpringSolver(this.grid)
    // 面板
    if (!this.panel) {
      this.panel = new ControlPanel(this.params, {
        onRepaint: () => this._enterPaint(),
        onChangePhoto: () => this._reset(),
      })
      this.panel.mount(this.$('panel'))
    }
    this.panel.show()
    // 拖拽
    this.drag = new DragInput(this.app.canvas, this.solver, this.grid, this.fit)
    this.drag.enable()
    // 甩动
    this.shake = new ShakeInput(this.solver, this.params)
    this.shake.requestPermission().then((ok) => {
      if (ok && ShakeInput.isSupported()) this.shake.start()
      else this._toast('当前设备不支持甩动，可以用手指拖拽玩～', 4000)
    })
    // 物理帧循环
    if (!this._ticker) {
      this._ticker = () => { if (this.state === 'PLAY') { this.solver.step(1 / 60, this.params); this.mesh.sync() } }
      this.app.ticker.add(this._ticker)
    }
  }

  _reset() {
    this.state = 'UPLOAD'
    this.panel && this.panel.hide()
    this.drag && this.drag.disable()
    this.shake && this.shake.stop()
    this.app.stage.removeChildren()
    this.$('paintUI').classList.add('hidden')
    this.$('uploadUI').classList.remove('hidden')
  }
}
```

- [ ] **Step 3: 改 main.js 接入 App**

```js
import { Application } from 'pixi.js'
import { App } from './App.js'

const app = new Application()
await app.init({ resizeTo: window, background: '#111', antialias: true })
document.getElementById('stage').appendChild(app.canvas)
new App(app)
```

- [ ] **Step 4: 全流程手动 QA**

Run: `npm run dev`（桌面走一遍，甩动部分用真机）
Expected（逐条核对边界情况）：
- 上传图片 → contain 居中显示。
- 涂抹出现蓝色半透明高亮；橡皮可擦；清空可清。
- 没涂就点开始 → 弹提示、不进入。
- 涂后开始 → 高亮消失；桌面出现"不支持甩动"提示；面板出现。
- 鼠标拖软区域 → 拉丝形变、松手回弹。
- 拖 4 个滑块 → 手感实时变化（幅度/软硬/回弹/余韵）。
- 重新涂抹 → 回到涂抹步骤；换照片 → 回到上传。
- 真机：允许运动授权后甩手机 → 软区域Q弹抖动。

- [ ] **Step 5: Commit**

```bash
git add src/App.js src/main.js index.html
git commit -m "feat: App 状态机串联 4 步流程 + 边界处理"
```

---

### Task 11: 横竖屏自适应 + 收尾

**Files:**
- Modify: `src/App.js`

**Interfaces:**
- Produces: `App` 监听 `resize`，在 UPLOAD 无操作；在已加载图片时重算 `computeFit` 并更新 mesh 位置与 maskLayer 位置、更新 `drag.offset`。为简单与稳健，重算仅调整整体位置/缩放不重建 grid（网格逻辑坐标不变，Container 缩放适配）。

- [ ] **Step 1: 实现 resize 处理**

在 App 构造末尾加 `window.addEventListener('resize', () => this._onResize())`，并实现：

```js
  _onResize() {
    if (!this.fit || !this.mesh) return
    const view = { w: this.app.screen.width, h: this.app.screen.height }
    // 依据显示尺寸算缩放，保持 mesh 内部局部坐标不变，仅缩放+居中整体
    const scale = Math.min(view.w / this.mesh.mesh.width * this.mesh.mesh.scale.x,
                           view.h / this.mesh.mesh.height * this.mesh.mesh.scale.y)
    // 简化：重新按原始 fit 宽高比居中
    const ratio = this.fit.width / this.fit.height
    let w = view.w, h = w / ratio
    if (h > view.h) { h = view.h; w = h * ratio }
    const x = (view.w - w) / 2, y = (view.h - h) / 2
    this.mesh.mesh.width = w; this.mesh.mesh.height = h
    this.mesh.mesh.position.set(x, y)
    this.maskLayer && this.maskLayer.position.set(x, y)
    this.maskLayer && (this.maskLayer.scale.set(w / this.fit.width, h / this.fit.height))
    this.fit = { ...this.fit, x, y } // drag.offset 引用同一 fit 对象，自动跟随 x/y
  }
```

> 注：`drag` 构造时传入的是 `this.fit` 引用，这里更新 `this.fit.x/y` 需保持同一对象。上面用 `this.fit = {...}` 会换对象导致 drag 拿到旧引用——改为就地赋值：`this.fit.x = x; this.fit.y = y`（不要整体替换对象）。拖拽偏移即随之更新。

- [ ] **Step 2: 修正为就地更新 fit**

把上面末行替换为：

```js
    this.fit.x = x; this.fit.y = y
```

- [ ] **Step 3: 手动 QA**

Run: `npm run dev`，旋转手机/改变窗口尺寸。
Expected：图片保持比例居中铺放；旋转后拖拽命中位置正确（偏移已更新）。

- [ ] **Step 4: 构建验证 + Commit**

Run: `npm run build`
Expected：`dist/` 生成成功、无报错，可部署。

```bash
git add src/App.js
git commit -m "feat: 横竖屏自适应 + 构建收尾"
```

---

## 自查（Self-Review 结果）

**Spec 覆盖**：
- 上传照片 → Task 5(loadTexture)+Task 10。
- 涂抹标记/软度/擦除/清空 → Task 4 + Task 10。
- 网格 Mesh 渲染 → Task 2 + Task 6。
- 弹簧物理/Q弹/拉丝/回弹/软度锚点/最大拉伸 → Task 3。
- 甩手机注入冲量/iOS 授权/降级 → Task 7 + Task 10。
- 手指拖拽拉丝/最近软网点 → Task 8。
- 4 滑块参数实时可调（幅度/软硬/回弹/余韵）→ Task 9 + config。
- 重新涂抹/换照片 → Task 9 回调 + Task 10。
- 边界：没涂就开始、不支持授权降级、图片过大(computeGridSize 上限)、拉烂钳制、横竖屏 → Task 3/5/10/11。

**占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码。JellyMesh 对 Pixi v8 API 的不确定处已给出明确校验判据与备选（非占位）。

**类型一致性**：`grid` 字段（restX/restY/x/y/vx/vy/softness/cols/rows）、`params` 字段（impulse/neighborStiffness/returnStiffness/damping）、`SpringSolver`（applyImpulse/setPin/clearPin/step/pinIndex）、`MaskPainter`（paint/erase/clear/hasSoft/getSoftness）、`JellyMesh`（mesh/sync/initGridFromGeometry）、`ImageLoader`（computeFit/computeGridSize/loadTexture）在各任务间命名一致。
