import { Texture } from 'pixi.js'

export function computeFit(imgW, imgH, viewW, viewH) {
  const scale = Math.min(viewW / imgW, viewH / imgH)
  const width = imgW * scale
  const height = imgH * scale
  return { width, height, x: (viewW - width) / 2, y: (viewH - height) / 2 }
}

export function computeGridSize(imgW, imgH, target, max) {
  let cols, rows
  if (imgW >= imgH) {
    cols = Math.min(target, max)
    rows = Math.round(cols * (imgH / imgW))
  } else {
    rows = Math.min(target, max)
    cols = Math.round(rows * (imgW / imgH))
  }
  cols = Math.min(Math.max(cols, 2), max)
  rows = Math.min(Math.max(rows, 2), max)
  return { cols, rows }
}

// 集成部分：从 File 读为 PixiJS 纹理（手动验证，不进单测）
export async function loadTexture(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const texture = Texture.from(img)
    return { texture, imgW: img.naturalWidth, imgH: img.naturalHeight }
  } finally {
    // 纹理已持有像素，可释放 objectURL
    URL.revokeObjectURL(url)
  }
}
