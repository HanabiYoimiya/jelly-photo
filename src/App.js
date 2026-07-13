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

export class App {
  constructor(pixiApp) {
    this.app = pixiApp
    this.params = { ...DEFAULT_PARAMS }
    this.state = 'UPLOAD'
    this.tool = 'brush'
    this.brushRadius = 40
    this._painting = false
    // 双指缩放/平移：活动指针表 + pinch 状态（PAINT/PLAY 均可用，见 _onPointerDown/Move/Up）
    this._pointers = new Map() // pointerId -> {x,y}（相对 canvas 左上角，即 stage 坐标空间）
    this._pinching = false
    this._bindUI()
    window.addEventListener('resize', () => this._onResize())
  }

  // 横竖屏/窗口尺寸变化：按原始宽高比重新居中铺放（不重建 grid，仅整体缩放+定位）。
  // 关键：DragInput 持有的是 this.fit 的引用（同一对象），这里必须就地改 x/y
  //（this.fit.x = x; this.fit.y = y），不能整体替换 this.fit = {...}，
  // 否则 DragInput 会拿着旧对象、拖拽命中位置在旋转后失准。
  // 同理，this.fit.width/height 保持不变（不重新赋值），这样 ratio 在多次连续
  // resize 之间不会漂移——它们始终代表图片原始的等比 contain-fit 尺寸。
  _onResize() {
    if (!this.fit || !this.mesh) return
    const view = { w: this.app.screen.width, h: this.app.screen.height }
    const ratio = this.fit.width / this.fit.height
    let w = view.w, h = w / ratio
    if (h > view.h) { h = view.h; w = h * ratio }
    const x = (view.w - w) / 2, y = (view.h - h) / 2
    this.mesh.mesh.width = w
    this.mesh.mesh.height = h
    this.mesh.mesh.position.set(x, y)
    this.maskLayer && this.maskLayer.position.set(x, y)
    this.maskLayer && this.maskLayer.scale.set(w / this.fit.width, h / this.fit.height)
    this.fit.x = x
    this.fit.y = y
    this.fit.scale = w / this.fit.width
  }

  _bindUI() {
    this.$ = (id) => document.getElementById(id)
    this.$('uploadBtn').onclick = () => this.$('file').click()
    this.$('file').onchange = (e) => e.target.files[0] && this._onFile(e.target.files[0])
    this.$('toolBrush').onclick = () => this._setTool('brush')
    this.$('toolErase').onclick = () => this._setTool('erase')
    this.$('clearBtn').onclick = () => { this.maskPainter.clear(); this._redrawMask() }
    this.$('brushSize').oninput = (e) => { this.brushRadius = parseFloat(e.target.value) }
    this.$('startBtn').onclick = () => this._start()
    // 指针管理：单指涂抹（仅 PAINT）+ 双指缩放/平移（PAINT/PLAY 都可用）
    const c = this.app.canvas
    c.addEventListener('pointerdown', (e) => this._onPointerDown(e))
    window.addEventListener('pointermove', (e) => this._onPointerMove(e))
    window.addEventListener('pointerup', (e) => this._onPointerUp(e))
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e))
  }

  // 把 pointer 事件坐标换成相对 canvas 左上角（stage 坐标空间，与 world.position 同一空间）
  _pagePoint(e) {
    const r = this.app.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  _onPointerDown(e) {
    this._pointers.set(e.pointerId, this._pagePoint(e))
    if (this._pointers.size === 2) {
      this._startPinch()
    } else if (this._pointers.size === 1 && this.state === 'PAINT' && !this._pinching) {
      this._painting = true
      this._paintAt(e)
    }
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return
    this._pointers.set(e.pointerId, this._pagePoint(e))
    if (this._pinching && this._pointers.size >= 2) { this._updatePinch(); return }
    if (this.state === 'PAINT' && this._painting && !this._pinching) this._paintAt(e)
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId)
    const wasPinching = this._pinching
    if (this._pointers.size < 2 && this._pinching) {
      this._pinching = false
      if (this.drag) this.drag.suspended = false
    }
    if (this._pointers.size === 0) this._painting = false
    // 双指→单指转换：pinch 期间单指涂抹/拖拽的标志位被清空了（见 _startPinch），
    // 这里如果只是抬起了其中一根手指、还剩一根按着，必须当场把剩下这根手指重新挂上，
    // 否则它会一直"死"到完全抬起再重新按下为止（R3 pinch 引入的 2→1 手指过渡缺口）
    if (wasPinching && this._pointers.size === 1) {
      const [[rid, rp]] = this._pointers.entries()
      if (this.state === 'PAINT') {
        this._painting = true
        this._paintAtLocal(this.mesh.mesh.toLocal(rp))
      } else if (this.state === 'PLAY' && this.drag) {
        this.drag.suspended = false
        this.drag.resumeAt(rp.x, rp.y, rid)
      }
    }
  }

  // 第二根手指落下：进入 pinch 模式，挂起单指涂抹/拖拽，记录缩放锚点
  _startPinch() {
    if (!this.world) return
    this._pinching = true
    this._painting = false
    if (this.drag) { this.drag.cancelActive(); this.drag.suspended = true }
    const [p1, p2] = [...this._pointers.values()]
    this._pinchStartDist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    this._pinchStartMid = mid
    this._pinchStartScale = this.world.scale.x
    this._pinchAnchor = {
      x: (mid.x - this.world.position.x) / this._pinchStartScale,
      y: (mid.y - this.world.position.y) / this._pinchStartScale,
    }
  }

  // pinch 移动：按双指间距比缩放，以双指中点为锚点（锚点在内容上的对应位置缩放前后不变）
  _updatePinch() {
    const [p1, p2] = [...this._pointers.values()]
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const scale = Math.min(5, Math.max(1, this._pinchStartScale * dist / this._pinchStartDist))
    this.world.scale.set(scale)
    this.world.position.set(mid.x - this._pinchAnchor.x * scale, mid.y - this._pinchAnchor.y * scale)
  }

  _toast(msg, ms = 2600) {
    const t = this.$('toast'); t.textContent = msg; t.classList.remove('hidden')
    clearTimeout(this._toastT); if (ms) this._toastT = setTimeout(() => t.classList.add('hidden'), ms)
  }

  async _onFile(file) {
    const view = { w: this.app.screen.width, h: this.app.screen.height }
    let loaded
    try {
      loaded = await loadTexture(file)
    } catch (e) {
      this._toast('图片加载失败，请换一张')
      return
    }
    const { texture, imgW, imgH } = loaded
    this.fit = computeFit(imgW, imgH, view.w, view.h)
    this.fit.scale = 1
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
    // 涂抹相关
    this.maskPainter = new MaskPainter(cols, rows, this.fit.width, this.fit.height)
    this.maskGfx = new Graphics(); this.maskLayer = new Container()
    this.maskLayer.position.set(this.fit.x, this.fit.y)
    this.maskLayer.addChild(this.maskGfx)
    // world 容器包住 mesh+maskLayer，双指缩放/平移只作用在 world 上（见 _startPinch/_updatePinch），
    // mesh/maskLayer 内部仍按 fit 布局，互不干扰
    this.world = new Container()
    this.world.addChild(this.mesh.mesh)
    this.world.addChild(this.maskLayer)
    this.world.scale.set(1)
    this.world.position.set(0, 0)
    this.app.stage.addChild(this.world)
    this._pointers.clear()
    this._pinching = false
    this._enterPaint()
  }

  _setTool(t) {
    this.tool = t
    this.$('toolBrush').classList.toggle('active', t === 'brush')
    this.$('toolErase').classList.toggle('active', t === 'erase')
  }

  _paintAt(e) {
    // toLocal 穿透 mesh 自身 position/width-scale + 父级 world 的双指缩放/平移，
    // 直接得到网格空间坐标 [0,fit.width]×[0,fit.height]，不再需要手写 fit.scale 换算
    this._paintAtLocal(this.mesh.mesh.toLocal(this._pagePoint(e)))
  }

  // 已经算好网格空间坐标时直接画（2→1 手指过渡时用，见 _onPointerUp）
  _paintAtLocal(p) {
    if (this.tool === 'brush') this.maskPainter.paint(p.x, p.y, this.brushRadius, 0.5)
    else this.maskPainter.erase(p.x, p.y, this.brushRadius, 0.5)
    this._redrawMask()
  }

  // 用软度网格画半透明高亮蒙层
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

  _enterPaint() {
    this.state = 'PAINT'
    this.$('uploadUI').classList.add('hidden')
    this.$('paintUI').classList.remove('hidden')
    this.panel && this.panel.hide()
    // 从 PLAY 返回涂抹时必须停掉拖拽/甩动监听，否则 pointer 事件会和涂抹重叠、
    // devicemotion 还会继续把冲量写进暂停中的 solver（brief 原稿遗漏，这里补上）
    this.drag && this.drag.disable()
    this.shake && this.shake.stop()
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
    // 拖拽（坐标源改用 mesh 的 toLocal，见 DragInput._local，穿透 world 缩放/平移）
    this.drag = new DragInput(this.app.canvas, this.solver, this.grid, this.mesh.mesh)
    this.drag.enable()
    // 甩动
    this.shake = new ShakeInput(this.solver, this.params)
    this.shake.requestPermission().then((ok) => {
      if (ok && ShakeInput.isSupported()) this.shake.start()
      else this._toast('当前设备不支持甩动，可以用手指拖拽玩～', 4000)
    })
    // 物理帧循环（固定步长累加器：物理速度与刷新率解耦）
    this._acc = 0
    if (!this._ticker) {
      const FIXED_MS = 1000 / 60
      this._ticker = () => {
        if (this.state !== 'PLAY') return
        this._acc += this.app.ticker.deltaMS // 距上一帧的真实耗时（毫秒）
        let steps = 0
        while (this._acc >= FIXED_MS && steps < 5) { // 每帧最多补 5 步，避免死亡螺旋
          this.solver.step(1 / 60, this.params)
          this._acc -= FIXED_MS
          steps++
        }
        if (steps === 5) this._acc = 0 // 长时间挂起（切后台）后不追赶积压的模拟时间
        this.mesh.sync()
      }
      this.app.ticker.add(this._ticker)
    }
  }

  _reset() {
    this.state = 'UPLOAD'
    this.panel && this.panel.hide()
    this.drag && this.drag.disable()
    this.shake && this.shake.stop()
    this.app.stage.removeChildren()
    this._pointers.clear()
    this._pinching = false
    this.$('paintUI').classList.add('hidden')
    this.$('uploadUI').classList.remove('hidden')
  }
}
