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
