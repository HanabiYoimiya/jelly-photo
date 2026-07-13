import { Application } from 'pixi.js'

const app = new Application()
await app.init({ resizeTo: window, background: '#111', antialias: true })
document.getElementById('stage').appendChild(app.canvas)
