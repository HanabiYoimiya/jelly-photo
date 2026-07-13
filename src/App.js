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
    let loaded
    try {
      loaded = await loadTexture(file)
    } catch (e) {
      this._toast('图片加载失败，请换一张')
      return
    }
    const { texture, imgW, imgH } = loaded
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
