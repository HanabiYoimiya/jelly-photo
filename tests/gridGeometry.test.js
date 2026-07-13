import { describe, it, expect } from 'vitest'
import { buildGridGeometry } from '../src/gridGeometry.js'

describe('buildGridGeometry', () => {
  it('生成正确数量的顶点与三角形索引', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    expect(g.positions.length).toBe(3 * 2 * 2) // 6 顶点 * xy
    expect(g.uvs.length).toBe(3 * 2 * 2)
    expect(g.indices.length).toBe((3 - 1) * (2 - 1) * 6) // 2 quad * 6
  })

  it('四角顶点落在 [0,width]x[0,height]', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    // 左上 (col0,row0) index0
    expect(g.positions[0]).toBeCloseTo(0)
    expect(g.positions[1]).toBeCloseTo(0)
    // 右下 (col2,row1) index5 -> offset 10
    expect(g.positions[10]).toBeCloseTo(100)
    expect(g.positions[11]).toBeCloseTo(50)
  })

  it('uv 与位置成比例', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    expect(g.uvs[10]).toBeCloseTo(1) // 右下 u
    expect(g.uvs[11]).toBeCloseTo(1) // 右下 v
  })

  it('索引均为合法顶点下标', () => {
    const g = buildGridGeometry(3, 2, 100, 50)
    for (const idx of g.indices) expect(idx).toBeLessThan(6)
  })
})
