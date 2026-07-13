// 行主序网格：index(col,row) = row*cols + col
export function buildGridGeometry(cols, rows, width, height) {
  const n = cols * rows
  const positions = new Float32Array(n * 2)
  const uvs = new Float32Array(n * 2)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col
      const u = cols === 1 ? 0 : col / (cols - 1)
      const v = rows === 1 ? 0 : row / (rows - 1)
      positions[i * 2] = u * width
      positions[i * 2 + 1] = v * height
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
    }
  }
  const quads = (cols - 1) * (rows - 1)
  const indices = new Uint16Array(quads * 6)
  let p = 0
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col
      const b = a + 1
      const c = a + cols
      const d = c + 1
      indices[p++] = a; indices[p++] = b; indices[p++] = c // 三角1
      indices[p++] = b; indices[p++] = d; indices[p++] = c // 三角2
    }
  }
  return { positions, uvs, indices }
}
