const GRAB_RADIUS = 60 // 局部像素，超出不抓取

export class DragInput {
  constructor(canvas, solver, grid, meshObj) {
    this.canvas = canvas
    this.solver = solver
    this.grid = grid
    this.meshObj = meshObj // PIXI 显示对象（mesh.mesh）：用其 toLocal 把指针坐标换成网格空间，
    // 自动穿透父级 world 的双指缩放/平移 + mesh 自身 position/width-scale（见 App._pagePoint 同一坐标空间）
    this.active = false
    this.suspended = false // 双指 pinch 期间由 App 置 true，挂起单指拖拽（见 App._startPinch/_onPointerUp）
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
    return this.meshObj.toLocal({ x: e.clientX - r.left, y: e.clientY - r.top })
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
    if (this.suspended) return
    const p = this._local(e)
    const i = this.findNearestSoft(p.x, p.y)
    if (i < 0) return
    this.active = true
    this.solver.setPin(i, p.x, p.y)
  }
  _move(e) {
    if (!this.active || this.suspended) return
    const p = this._local(e)
    this.solver.setPin(this.solver.pinIndex, p.x, p.y)
  }
  _up() {
    if (!this.active) return
    this.active = false
    this.solver.clearPin()
  }

  // pinch 开始时被 App 调用：立刻结束进行中的单指拖拽（松开钉住点）；未在拖拽时是 no-op
  cancelActive() {
    if (!this.active) return
    this.active = false
    this.solver.clearPin()
  }
}
