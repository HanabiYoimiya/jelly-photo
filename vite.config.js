import { defineConfig } from 'vite'
export default defineConfig({
  base: './',             // 相对路径，便于部署到 GitHub Pages 子路径
  server: { host: true }, // 便于手机连同一 WiFi 真机调试
  build: { target: 'esnext' }, // main.js 顶层 await app.init(...) 需要目标支持 top-level await
})
