import { Application } from 'pixi.js'
import { App } from './App.js'

// 满屏显示一条致命错误，避免初始化失败时页面变成"点了没反应"的死按钮
function showFatal(msg) {
  const d = document.createElement('div')
  d.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;color:#fff;background:#111;text-align:center;font-size:15px;white-space:pre-wrap;z-index:9999'
  d.textContent = msg
  document.body.appendChild(d)
}

async function boot() {
  const app = new Application()
  try {
    // 强制 WebGL：比 WebGPU 在手机上兼容性好得多，避免适配器协商失败卡死初始化
    await app.init({ resizeTo: window, background: '#111', antialias: true, preference: 'webgl' })
  } catch (e) {
    showFatal('图形初始化失败，请改用 Chrome 浏览器打开。\n\n' + (e?.message || e))
    return
  }
  document.getElementById('stage').appendChild(app.canvas)
  new App(app)
}

boot()
