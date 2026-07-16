const PICK_FRAC = 0.10 // 手指必须落在离某个软网点 <= 10% 照片宽度内，才算摸到了涂抹区域
const FALLOFF_FRAC = 0.24 // 余弦衰减半径相对照片宽度的比例

export class DragInput {
  constructor(canvas, solver, grid, meshObj) {
    this.canvas = canvas
    this.solver = solver
    this.grid = grid
    this.meshObj = meshObj // PIXI 显示对象（mesh.mesh）：用其 toLocal 把指针坐标换成网格空间，
    // 自动穿透父级 world 的双指缩放/平移 + mesh 自身 position/width-scale（见 App._pagePoint 同一坐标空间）
    this.active = false
    this.suspended = false // 双指 pinch 期间由 App 置 true，挂起单指拖拽（见 App._startPinch/_onPointerUp）
    // R5 红晕特效用：dragCenter 是当前手指的网格空间落点（grid-local，随 move 更新），
    // grabOrigin 是本次抓取开始时的落点（抓取期间不变）。App 据此算拉扯距离/朝向定位红晕。
    // 松手后二者保留最后的值（App 只在 this.active 为真时读取）。
    this.dragCenter = { x: 0, y: 0 }
    this.grabOrigin = { x: 0, y: 0 }
    this._pointerId = null // 当前抓取所属的 pointerId：_up 靠它判断"抬起的是不是正在拖拽的那根手指"，
    // 否则 2→1 过渡时 App._onPointerUp 里 resumeAt() 刚重新抓起剩下那根手指，
    // 紧接着触发本类自己监听的同一个 pointerup（抬起的是另一根、刚失效的手指）会把它清掉
    this._grabbed = [] // 本次抓取的一片软网点：[{i, rx, ry, w}, ...]，rx/ry 为该点静止坐标，
    // w 为余弦衰减权重（抓取中心 w=1，半径边缘 w→0），决定该点跟随手指位移的比例
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
    this.solver.clearPins()
    this._grabbed = []
    this.active = false
    this._pointerId = null
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect()
    return this.meshObj.toLocal({ x: e.clientX - r.left, y: e.clientY - r.top })
  }

  // 在 localPoint 处尝试抓取手指所在的那"一块"连通涂抹区域（而非固定半径内的所有软网点）：
  // 1) 先在软网点里找离落点最近的一个，若最近距离超过 pickR（相对照片宽度）则视为没摸到，落空；
  // 2) 以它为起点，在网格上做 4 邻居 BFS，只穿过 softness>0 的网点——遇到未涂抹的网点（softness<=0）
  //    就不再穿过去，天然把落点所在的这一块和隔着空隙的其它涂抹块分开，互不牵连；
  // 3) 连通块内的点再按离落点的距离做余弦衰减（半径 R，同样相对照片宽度），落在 R 外的点权重趋近于 0，
  //    使拉扯效果保持"局部"，即使连通块本身很大也不会整块跟着平移。
  // 成功返回 true 并把 pins 推给 solver；落空返回 false（不改动任何状态）。
  _grabAt(localPoint) {
    const g = this.grid
    const imgW = g.restX[g.cols - 1] // 照片显示宽度（rest 坐标下最后一列的 x，等于 fit.width）
    const pickR = PICK_FRAC * imgW
    const R = FALLOFF_FRAC * imgW

    // 1) 找离落点最近的软网点作为起点
    let start = -1
    let bestD = Infinity
    for (let i = 0; i < g.softness.length; i++) {
      if (g.softness[i] <= 0) continue
      const d = Math.hypot(g.restX[i] - localPoint.x, g.restY[i] - localPoint.y)
      if (d < bestD) { bestD = d; start = i }
    }
    if (start < 0 || bestD > pickR) return false

    // 2) 从起点 BFS，只穿过软网点，收集落点所在的连通块
    const { cols, rows } = g
    const visited = new Set([start])
    const queue = [start]
    const region = []
    while (queue.length) {
      const i = queue.pop()
      region.push(i)
      const col = i % cols
      const row = (i - col) / cols
      const neighbors = [
        col + 1 < cols ? i + 1 : -1,
        col - 1 >= 0 ? i - 1 : -1,
        row + 1 < rows ? i + cols : -1,
        row - 1 >= 0 ? i - cols : -1,
      ]
      for (const j of neighbors) {
        if (j < 0 || visited.has(j) || g.softness[j] <= 0) continue
        visited.add(j)
        queue.push(j)
      }
    }

    // 3) 连通块内按距离余弦衰减，超出 R 的点权重趋近 0
    const grabbed = []
    for (const i of region) {
      const d = Math.hypot(g.restX[i] - localPoint.x, g.restY[i] - localPoint.y)
      if (d <= R) {
        const w = 0.5 * (1 + Math.cos(Math.PI * d / R))
        grabbed.push({ i, rx: g.restX[i], ry: g.restY[i], w })
      }
    }
    if (grabbed.length === 0) return false

    this._grabbed = grabbed
    const pins = new Map()
    for (const { i, rx, ry } of grabbed) pins.set(i, { x: rx, y: ry })
    this.solver.setPins(pins)
    this.dragCenter = { x: localPoint.x, y: localPoint.y }
    this.grabOrigin = { x: localPoint.x, y: localPoint.y }
    return true
  }

  _down(e) {
    if (this.suspended) return
    const p = this._local(e)
    if (!this._grabAt(p)) return
    this.active = true
    this._pointerId = e.pointerId
  }
  _move(e) {
    if (!this.active || this.suspended) return
    const p = this._local(e)
    this.dragCenter = { x: p.x, y: p.y }
    const ddx = p.x - this.grabOrigin.x
    const ddy = p.y - this.grabOrigin.y
    const pins = new Map()
    for (const { i, rx, ry, w } of this._grabbed) pins.set(i, { x: rx + ddx * w, y: ry + ddy * w })
    this.solver.setPins(pins)
  }
  _up(e) {
    if (!this.active) return
    // pointerId 不匹配：说明抬起的是另一根手指（比如 2→1 过渡里刚失效的那根），
    // 不是当前正在拖拽的这根，不能把刚抓好的拖拽状态清掉
    if (e && this._pointerId != null && e.pointerId !== this._pointerId) return
    this.active = false
    this._pointerId = null
    this._grabbed = []
    this.solver.clearPins()
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
    if (!this._grabAt(p)) return
    this.active = true
    this._pointerId = pointerId
  }

  // pinch 开始时被 App 调用：立刻结束进行中的单指拖拽（松开钉住点）；未在拖拽时是 no-op
  cancelActive() {
    if (!this.active) return
    this.active = false
    this._pointerId = null
    this._grabbed = []
    this.solver.clearPins()
  }
}
