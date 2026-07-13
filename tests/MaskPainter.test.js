// tests/MaskPainter.test.js
import { describe, it, expect } from 'vitest'
import { MaskPainter } from '../src/MaskPainter.js'

describe('MaskPainter', () => {
  it('初始无软度', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    expect(m.hasSoft()).toBe(false)
    expect(m.getSoftness().every(v => v === 0)).toBe(true)
  })

  it('涂抹后圆心软度高于边缘、圆外为0', () => {
    const m = new MaskPainter(5, 5, 100, 100) // 网点间距 25px
    m.paint(50, 50, 30, 1) // 中心 (col2,row2)=index12
    const s = m.getSoftness()
    expect(s[12]).toBeGreaterThan(0.9)      // 圆心
    expect(s[0]).toBe(0)                    // 左上角(0,0) 距中心>30
    expect(m.hasSoft()).toBe(true)
    // 相邻点(col2,row1)=index7 距圆心25<30，软度介于0和圆心之间
    expect(s[7]).toBeGreaterThan(0)
    expect(s[7]).toBeLessThan(s[12])
  })

  it('软度累加并 clamp 到 1', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    m.paint(50, 50, 30, 1)
    m.paint(50, 50, 30, 1)
    expect(m.getSoftness()[12]).toBe(1)
  })

  it('擦除降低软度', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    m.paint(50, 50, 30, 1)
    m.erase(50, 50, 30, 1)
    expect(m.getSoftness()[12]).toBeCloseTo(0)
  })

  it('clear 全部归零', () => {
    const m = new MaskPainter(5, 5, 100, 100)
    m.paint(50, 50, 40, 1)
    m.clear()
    expect(m.hasSoft()).toBe(false)
  })
})
