# 果冻照片 · 手感打磨轮（第二轮）实现计划

> 针对真机试玩反馈的 4 项改进。基于已完成并部署的主实现。

**用户反馈与决定：**
1. 拖拽形变太尖锐 → 要"圆润软、一块一起动"。
2. 图片不能缩放 → 要"随时（涂抹+玩）双指缩放/平移看细节"。
3. 涂抹高亮锯齿多（按 40 格方块画）→ 要平滑。
4. 笔刷大小不能调 → 加大小调节。

**顺序（有依赖）：** R1 平滑高亮 → R2 笔刷大小 → R3 双指缩放/平移+坐标改用 toLocal（地基）→ R4 圆润一块式拖拽（建在 R3 坐标之上）。

## 共享约定
- 现有共享对象：`grid`（Float32Array restX/restY/x/y/vx/vy/softness + cols/rows）、`this.fit`{width,height,x,y,scale}。
- 现有坐标：`_paintAt`/`DragInput._local` 用 `(client - rect - fit.x)/fit.scale` 换算到网格空间 [0,fit.width]。R3 起改为 PixiJS `mesh.mesh.toLocal(全局点)`，自动穿透 world 缩放/平移 + mesh 位置/缩放，网格空间不变仍为 [0,fit.width]。

---

### R1: 平滑涂抹高亮（改 App._redrawMask）

**File:** src/App.js（仅 `_redrawMask`）

现状：对每个 softness>0 的网点画一个 `gfx.rect(cell)` → 方块拼接、锯齿。
改为：对每个 softness>0 的网点画一个**柔和圆形**（半径≈1.3×网格间距、alpha 随 softness），重叠混合成平滑区域。

```js
  _redrawMask() {
    const g = this.grid, s = this.maskPainter.getSoftness()
    const gfx = this.maskGfx; gfx.clear()
    const cw = this.fit.width / (g.cols - 1), ch = this.fit.height / (g.rows - 1)
    const r = Math.max(cw, ch) * 1.3
    for (let i = 0; i < s.length; i++) {
      if (s[i] <= 0) continue
      const col = i % g.cols, row = (i - i % g.cols) / g.cols
      gfx.circle(col * cw, row * ch, r).fill({ color: 0x3a6df0, alpha: 0.28 * s[i] })
    }
  }
```
验收：构建通过、21/21；无头加载涂抹后高亮为平滑蓝团（无 GPU 只验无报错+代码正确）。

---

### R2: 笔刷大小可调（涂抹工具条加滑块）

**Files:** index.html（涂抹工具条 `#paintUI` 加一个笔刷大小 range）、src/App.js（`this.brushRadius` 替换常量 `BRUSH_RADIUS`）

- index.html：在 `#paintUI` 里加 `<input id="brushSize" type="range" min="15" max="120" value="40">`（配简短样式）。
- App：构造里 `this.brushRadius = 40`；`_bindUI` 里监听 `brushSize` 的 input 写入 `this.brushRadius`；`_paintAt` 用 `this.brushRadius` 代替 `BRUSH_RADIUS`。

验收：拖动滑块 `this.brushRadius` 实时变化；涂抹半径随之变化；构建+21/21。

---

### R3: 双指缩放/平移 + 坐标改用 toLocal（地基，最大一项）

**Files:** src/App.js（world 容器、手势路由、坐标换算）、src/DragInput.js（坐标源改用 mesh.toLocal）

**目标：** 涂抹态与游玩态都支持双指缩放/平移照片；单指仍是涂抹/拖拽。

1. **world 容器**：新建 `this.world = new Container()`，把 `mesh.mesh` 与 `maskLayer` 都加进 `world`（各自仍按 fit 布局），`world` 加到 stage。缩放/平移作用在 `world`：`world.scale.set(z)`、`world.position.set(px,py)`。初始 z=1、位移 0。
2. **手势路由（指针管理）**：维护活动指针表 `this._pointers = new Map()`（pointerId→{x,y}）。
   - 1 个指针：走原有单指逻辑（涂抹 or 拖拽，取决于状态）。
   - 2 个指针：进入 pinch 模式——记录双指初始中点与间距，move 时按间距比缩放 `world.scale`、按中点位移平移 `world.position`，并以双指中点为锚点缩放（缩放前后让中点在内容上的对应点不变）。pinch 期间**挂起单指涂抹/拖拽**（第二指落下时取消进行中的涂抹笔画 / DragInput 松开）。
   - 抬指回到 ≤1 指时恢复。
   - 缩放范围 clamp 到 [1, 5]，平移范围留边界钳制（可选，先不强限）。
3. **坐标换算改用 toLocal**：把 `_paintAt` 与 `DragInput._local` 的手写 `(client-rect-fit.x)/fit.scale` 改为
   `const p = this.mesh.mesh.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top })`，得到的 p 即网格空间坐标，穿透 world 缩放/平移 + resize 缩放，无需再用 fit.scale。DragInput 改为持有 mesh 引用（或一个 `toLocal(pageX,pageY)` 回调）而非 offset/fit。
   - `_onResize` 中 `fit.scale` 可保留但不再被指针逻辑依赖（toLocal 已覆盖）；world 缩放/平移在 resize 时保持不变（内容整体随 mesh 尺寸变化）。
4. **单指与双指切换**：pinch 开始要确保不误触发涂抹/拖拽（第二指 down 时若正在涂抹/拖拽，立即结束该动作）。

验收：构建+21/21；无头下模拟双指（两个 pointerdown+move）能改变 world.scale/position 且无报错；单指涂抹/拖拽在缩放后命中仍正确（用 toLocal 后由 Pixi 保证）——无头驱动一个缩放后的 pointerdown 确认 pinIndex≥0 / 涂抹落点正确。

> 注意：这是坐标关键改动（此前有过 resize 命中错位的 Critical）。务必用 toLocal 让 Pixi 统一处理变换，避免手写多层缩放。

---

### R4: 圆润"一块一起动"拖拽（SpringSolver 多点钉住 + DragInput 软抓取）

**Files:** src/SpringSolver.js（单点 pin → 多点 pin）、src/DragInput.js（软抓取一片）

现状：`setPin(i,x,y)` 只钉最近 1 个点 → 拉出尖角。
改为：抓取时把落点附近**一片**软网点一起钉住、整体随手指平移，周围靠弹簧自然过渡成圆润软块。

1. **SpringSolver 多点 pin**：把单个 `pinIndex/pinX/pinY` 换成 `this.pins = new Map()`（index→{x,y}）。
   - `setPins(map)`：整体替换当前钉住集合。
   - `clearPins()`：清空。
   - `step` 中：先前"若 i===pinIndex"改为"若 pins.has(i)"→ 强制到该点目标坐标、速度清零。
   - 保留 `pinIndex`/`setPin` 作为兼容薄封装或直接改所有调用点（本轮 DragInput 会改，故直接换新 API；App 无其他调用）。同步更新 SpringSolver 单测里对 pin 的用例为新 API（`setPins`）。
2. **DragInput 软抓取**：`GRAB_RADIUS` 仍用于判定是否抓到；抓到后收集**落点 GRAB_RADIUS 内所有软网点**，记录每个点相对抓取点的原始偏移 `off_i = (restX_i-gx, restY_i-gy)`；move 时 `setPins({ i: fingerLocal + off_i })`，即整片按原相对形状随手指平移（刚性一小块），周围未钉软点靠邻居弹簧圆润过渡；松手 `clearPins()`。
   - 抓取半径可比笔刷略大（如 `DRAG_GRAB=70`），保证抓到"一块"。

验收：构建+21/21（含更新后的 SpringSolver pin 用例）；无头驱动拖拽后，落点附近多个网点被钉住、整体位移；形变不再是单点尖角（由多点整体位移保证）。

---

## 收尾
全部通过后：`npm run build` + `npm run build:single` 重新生成 `果冻照片.html`，提交推送（Vercel 自动部署）。真机可视手感仍由用户确认。
