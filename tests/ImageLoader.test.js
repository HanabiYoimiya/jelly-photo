import { describe, it, expect } from 'vitest'
import { computeFit, computeGridSize } from '../src/ImageLoader.js'

describe('computeFit', () => {
  it('横图受视口宽限制、垂直居中', () => {
    const f = computeFit(200, 100, 100, 100) // 图2:1，视口1:1 → 宽100 高50
    expect(f.width).toBeCloseTo(100)
    expect(f.height).toBeCloseTo(50)
    expect(f.x).toBeCloseTo(0)
    expect(f.y).toBeCloseTo(25) // (100-50)/2
  })
  it('竖图受视口高限制、水平居中', () => {
    const f = computeFit(100, 200, 100, 100) // 高100 宽50
    expect(f.height).toBeCloseTo(100)
    expect(f.width).toBeCloseTo(50)
    expect(f.x).toBeCloseTo(25)
    expect(f.y).toBeCloseTo(0)
  })
})

describe('computeGridSize', () => {
  it('长边取 target，短边等比', () => {
    const g = computeGridSize(200, 100, 40, 48) // 宽长 → cols=40, rows=20
    expect(g.cols).toBe(40)
    expect(g.rows).toBe(20)
  })
  it('不超过 max', () => {
    const g = computeGridSize(500, 100, 40, 48)
    expect(g.cols).toBeLessThanOrEqual(48)
  })
  it('短边至少 2', () => {
    const g = computeGridSize(1000, 100, 40, 48)
    expect(g.rows).toBeGreaterThanOrEqual(2)
  })
})
