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
    this._pointerId = null // 当前抓取所属的 pointerId：_up 靠它判断"抬起的是不是正在拖拽的那根手指"，
    // 否则 2→1 过渡时 App._onPointerUp 里 resumeAt() 刚重新抓起剩下那根手指，
    // 紧接着触发本类自己监听的同一个 pointerup（抬起的是另一根、刚失效的手指）会把它清掉
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
    this._pointerId = null
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
    this._pointerId = e.pointerId
    this.solver.setPin(i, p.x, p.y)
  }
  _move(e) {
    if (!this.active || this.suspended) return
    const p = this._local(e)
    this.solver.setPin(this.solver.pinIndex, p.x, p.y)
  }
  _up(e) {
    if (!this.active) return
    // pointerId 不匹配：说明抬起的是另一根手指（比如 2→1 过渡里刚失效的那根），
    // 不是当前正在拖拽的这根，不能把刚抓好的拖拽状态清掉
    if (e && this._pointerId != null && e.pointerId !== this._pointerId) return
    this.active = false
    this._pointerId = null
    this.solver.clearPin()
  }

  // 双指→单指过渡时被 App 调用：不等新的 pointerdown，直接用剩下那根手指当前位置
  // 补开一次抓取。x/y 是 canvas 局部坐标（App._pointers 存的那种，即 clientX/clientY
  // 减去 canvas rect 之后的值），与 _local 里 e.clientX - r.left 是同一坐标空间，
  // 所以这里直接喂给 toLocal，逻辑与 _down 完全一致，只是坐标来源换成了现成的值。
  // pointerId 是剩下这根手指的 id：记下来，这样它自己之后的 pointerup 才能被 _up 正确匹配上，
  // 而不会被"刚失效那根手指"的 pointerup（同一批事件里紧跟着触发）误清掉。
  resumeAt(x, y, pointerId) {
    if (this.suspended) return
    const p = this.meshObj.toLocal({ x, y })
    const i = this.findNearestSoft(p.x, p.y)
    if (i < 0) return
    this.active = true
    this._pointerId = pointerId
    this.solver.setPin(i, p.x, p.y)
  }

  // pinch 开始时被 App 调用：立刻结束进行中的单指拖拽（松开钉住点）；未在拖拽时是 no-op
  cancelActive() {
    if (!this.active) return
    this.active = false
    this._pointerId = null
    this.solver.clearPin()
  }
}
