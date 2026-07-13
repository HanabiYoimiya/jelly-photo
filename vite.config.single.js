import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 单文件构建：把所有 JS/CSS 内联进一个 index.html，可离线本地打开
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'esnext',
    outDir: 'dist-single',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
})
