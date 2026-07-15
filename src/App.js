// src/App.js
import { Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { DEFAULT_PARAMS, GRID } from './config.js'
import { loadTexture, computeFit, computeGridSize } from './ImageLoader.js'
import { MaskPainter } from './MaskPainter.js'
import { SpringSolver } from './SpringSolver.js'
import { JellyMesh } from './JellyMesh.js'
import { ShakeInput } from './ShakeInput.js'
import { DragInput } from './DragInput.js'
import { ControlPanel } from './ControlPanel.js'

const BRUSH_MIN_FRAC = 0.006
const BRUSH_MAX_FRAC = 0.14

export class App {
  constructor(pixiApp) {
    this.app = pixiApp
    this.params = { ...DEFAULT_PARAMS }
    this.state = 'UPLOAD'
    this.tool = 'brush'
    this.brushFrac = 0.22
    this._painting = false
    // 双指缩放/平移：活动指针表 + pinch 状态（PAINT/PLAY 均可用，见 _onPointerDown/Move/Up）
    this._pointers = new Map() // pointerId -> {x,y}（相对 canvas 左上角，即 stage 坐标空间）
    this._pinching = false
    // R5 拖拽处肤色红晕：纹理只造一次（离屏 canvas 径向渐变），精灵随每次上传重建（见 _onFile）
    this._blushTex = this._buildBlushTexture()
    this._blush = null
    this._blushAlpha = 0
    this._blushScale = 0
    this._blushBloom = 0 // 按住时长缓慢外扩的额外扩散量，松手回落
    // 涂抹高亮：沿实际笔迹画的临时 Graphics（每次画一段就 clear 复用），配合 _paintStroke 渲染进 RT
    this._stamp = new Graphics()
    // 当前笔画的上一个点（网格空间坐标）；null 表示新笔画刚开始，见 _paintAtLocal/_onPointerDown/_onPointerUp
    this._lastPaintPt = null
    this._bindUI()
    window.addEventListener('resize', () => this._onResize())
  }

  // 造一次红晕纹理：离屏 2D canvas 画径向渐变（暖玫红，中心不透明→边缘全透），
  // 之后每次上传照片都复用同一张纹理，只重建 Sprite（见 _onFile）。
  _buildBlushTexture() {
    const size = 256, r = size / 2
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r)
    grad.addColorStop(0, 'rgba(255,72,72,0.9)')
    grad.addColorStop(0.55, 'rgba(255,96,96,0.5)')
    grad.addColorStop(1, 'rgba(255,120,120,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    return Texture.from(canvas)
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
    this.$('clearBtn').onclick = () => this._clearMask()
    this.$('brushSize').oninput = (e) => { this.brushFrac = parseFloat(e.target.value) }
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

  // 根据当前笔刷分数和照片显示宽度，计算网格空间中的笔刷半径（像素）
  _brushR() {
    return (BRUSH_MIN_FRAC + this.brushFrac * (BRUSH_MAX_FRAC - BRUSH_MIN_FRAC)) * this.fit.width
  }

  _onPointerDown(e) {
    this._pointers.set(e.pointerId, this._pagePoint(e))
    if (this._pointers.size === 2) {
      this._startPinch()
    } else if (this._pointers.size === 1 && this.state === 'PAINT' && !this._pinching) {
      this._painting = true
      this._lastPaintPt = null // 新笔画开始，别跟上一笔连起来
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
        this._lastPaintPt = null // 这根手指是"重新落下"的，也算新笔画开始
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
    // 涂抹相关：物理软度网格（驱动果冻抖动）+ 视觉高亮（沿笔迹画进 RenderTexture）两条线分开
    this.maskPainter = new MaskPainter(cols, rows, this.fit.width, this.fit.height)
    // 高亮 RT：网格本地空间 [0,fit.width]×[0,fit.height]，与 toLocal 出来的涂抹坐标同一空间。
    // 笔画（圆头连续线段）画进这张纹理里，union 出来的边缘天然是丝滑弧线，不再是每个网格点一个圆
    // 拼出来的毛毛虫锯齿（旧 _redrawMask 的问题）。
    this._maskRT?.destroy(true)
    this._maskRT = RenderTexture.create({
      width: Math.round(this.fit.width),
      height: Math.round(this.fit.height),
      antialias: true,
    })
    this._maskSprite = new Sprite(this._maskRT)
    this._maskSprite.tint = 0x3a6df0
    this._maskSprite.alpha = 0.4
    this._maskSprite.position.set(0, 0)
    this.maskLayer = new Container()
    this.maskLayer.position.set(this.fit.x, this.fit.y)
    this.maskLayer.addChild(this._maskSprite)
    this._lastPaintPt = null
    // world 容器包住 mesh+maskLayer，双指缩放/平移只作用在 world 上（见 _startPinch/_updatePinch），
    // mesh/maskLayer 内部仍按 fit 布局，互不干扰
    this.world = new Container()
    this.world.addChild(this.mesh.mesh)
    this.world.addChild(this.maskLayer)
    // R5 红晕精灵：加在 mesh 之上（PLAY 期间 maskLayer 隐藏，不会互相遮挡），
    // 默认不可见，PLAY 拖拽时由 ticker 每帧驱动位置/透明度/大小（见 _enterPlay 的 _ticker）
    this._blush = new Sprite(this._blushTex)
    this._blush.anchor.set(0.5)
    this._blush.alpha = 0
    this._blush.visible = false
    this.world.addChild(this._blush)
    this._blushAlpha = 0
    this._blushScale = 0
    this._blushBloom = 0
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
    const erase = this.tool === 'erase'
    const r = this._brushR()
    // 物理软度网格照旧更新（果冻抖动只看这个，跟视觉高亮完全解耦）
    if (erase) this.maskPainter.erase(p.x, p.y, r, 0.5)
    else this.maskPainter.paint(p.x, p.y, r, 0.5)
    // 视觉高亮：从上一个点连一段圆头粗线到当前点；_lastPaintPt 为空（笔画刚开始）时
    // from===to，退化成一个圆点（配合下面显式画的头部圆，效果就是一个笔刷起点）
    const from = this._lastPaintPt || p
    this._paintStroke(from, p, erase, r)
    this._lastPaintPt = p
  }

  // 把一段笔迹（圆头圆角粗线 + 头部圆）画进 _maskRT。笔刷/橡皮共用这段逻辑，
  // 橡皮用 'erase' 混合模式（destination-out）从 RT 里抠掉覆盖的白色区域。
  // clear:false 让笔画之间不断累积覆盖（同一像素被多次覆盖也只是保持不透明，不会越叠越深——
  // 深浅统一交给 _maskSprite 的 alpha=0.4 去决定，见 _onFile）。
  _paintStroke(fromPt, toPt, erase, r) {
    const g = this._stamp
    g.clear()
    g.moveTo(fromPt.x, fromPt.y).lineTo(toPt.x, toPt.y)
    g.stroke({ width: 2 * r, color: 0xffffff, alpha: 1, cap: 'round', join: 'round' })
    g.circle(toPt.x, toPt.y, r).fill({ color: 0xffffff, alpha: 1 })
    g.blendMode = erase ? 'erase' : 'normal'
    this.app.renderer.render({ container: g, target: this._maskRT, clear: false })
  }

  // 清空高亮 RT + 物理软度网格（Clear 按钮用）
  _clearMask() {
    this.maskPainter.clear()
    this._lastPaintPt = null
    if (this._maskRT) {
      const g = this._stamp
      g.clear()
      this.app.renderer.render({ container: g, target: this._maskRT, clear: true })
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
    // 从 PLAY 返回时红晕可能还留在半透明渐隐途中（ticker 一停就冻结在当时的 alpha），
    // 这里显式清掉，避免涂抹模式下背景多出一块红斑
    if (this._blush) { this._blush.visible = false; this._blushAlpha = 0; this._blushScale = 0; this._blushBloom = 0 }
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
        this._updateBlush()
      }
      this.app.ticker.add(this._ticker)
    }
  }

  // R5 每帧驱动拖拽处红晕：拖拽中——位置贴在指尖落点、强度随拉扯距离增强、随按住时长缓慢晕开；
  // 松手——透明度缓动回 0 后隐藏。放在 PLAY ticker 里，随物理帧一起跑（见 _enterPlay）。
  _updateBlush() {
    if (!this._blush) return
    const BLUSH_TEX_R = 128 // 纹理半径（256×256 画布，见 _buildBlushTexture）
    const BASE_RADIUS = 130 // 未拉扯时的红晕落地半径（网格空间 px），随 t 再放大
    const baseScale = BASE_RADIUS / BLUSH_TEX_R
    if (this.drag && this.drag.active) {
      // 位置：drag.dragCenter 是网格空间（mesh 局部）坐标，先转成全局坐标再转回 world 局部坐标，
      // 这样红晕跟 mesh/maskLayer 一样挂在 world 下、自然随双指缩放/平移一起走，且不受 mesh 自身
      // position/width-scale 影响（toGlobal/toLocal 两段变换把这些都穿透掉了）
      const gp = this.mesh.mesh.toGlobal(this.drag.dragCenter)
      const wp = this.world.toLocal(gp)
      this._blush.position.copyFrom(wp)
      // 拉扯强度 t∈[0,1]：手指相对抓取起点的位移，160px（网格空间）约等于拉满
      const dx = this.drag.dragCenter.x - this.drag.grabOrigin.x
      const dy = this.drag.dragCenter.y - this.drag.grabOrigin.y
      const t = Math.min(1, Math.hypot(dx, dy) / 160)
      // 缓慢晕开：按住时持续增长的额外扩散量，封顶 +0.4（对应缩放倍数，不是 alpha）
      this._blushBloom = Math.min(0.4, this._blushBloom + 0.006)
      // 轻微碰一下（t 很小）目标透明度按 0 算，不会一拉就红；
      // 只有持续用力拉扯（t>0.05）才会慢慢浮现出红晕
      const targetAlpha = t > 0.05 ? 0.4 + 0.5 * t : 0
      const targetScale = baseScale * (1 + 1.5 * t + this._blushBloom)
      // 浮现要慢：缓动系数 0.04（远小于原来的 0.2），持续拉满大约需要 1~1.5s 才贴近目标值，
      // 读起来是"渐渐浮现"而不是一拉就跳出来
      this._blushAlpha += (targetAlpha - this._blushAlpha) * 0.04
      this._blushScale += (targetScale - this._blushScale) * 0.04
      this._blush.alpha = this._blushAlpha
      this._blush.scale.set(this._blushScale)
      this._blush.visible = this._blushAlpha > 0.01
    } else {
      // 松手：透明度缓动回 0，系数 0.06，约 0.5~1s 内淡出
      this._blushAlpha += (0 - this._blushAlpha) * 0.06
      this._blush.alpha = this._blushAlpha
      if (this._blushAlpha < 0.01) {
        this._blush.visible = false
        this._blushBloom = 0
      }
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
