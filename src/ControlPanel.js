// src/ControlPanel.js
import { SLIDER_RANGES } from './config.js'

const SLIDERS = [
  { key: 'impulse',           label: '抖动幅度' },
  { key: 'neighborStiffness', label: '软硬' },
  { key: 'returnStiffness',   label: '回弹快慢' },
  { key: 'damping',           label: '余韵' },
]

export class ControlPanel {
  constructor(params, { onRepaint, onChangePhoto }) {
    this.params = params
    this.onRepaint = onRepaint
    this.onChangePhoto = onChangePhoto
    this.el = null
  }

  mount(parentEl) {
    this.el = parentEl
    parentEl.innerHTML = ''
    for (const s of SLIDERS) {
      const [min, max] = SLIDER_RANGES[s.key]
      const row = document.createElement('div')
      row.className = 'row'
      const norm = (this.params[s.key] - min) / (max - min)
      row.innerHTML = `<label>${s.label}</label>`
      const input = document.createElement('input')
      input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'
      input.value = String(norm)
      input.addEventListener('input', () => {
        this.params[s.key] = min + parseFloat(input.value) * (max - min)
      })
      row.appendChild(input)
      parentEl.appendChild(row)
    }
    const btns = document.createElement('div')
    btns.className = 'btns'
    const repaint = document.createElement('button')
    repaint.className = 'ghost'; repaint.textContent = '重新涂抹'
    repaint.addEventListener('click', () => this.onRepaint())
    const change = document.createElement('button')
    change.textContent = '换照片'
    change.addEventListener('click', () => this.onChangePhoto())
    btns.appendChild(repaint); btns.appendChild(change)
    parentEl.appendChild(btns)
  }

  show() { this.el.classList.remove('hidden') }
  hide() { this.el.classList.add('hidden') }
}
