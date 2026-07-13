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
