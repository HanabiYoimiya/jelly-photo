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
