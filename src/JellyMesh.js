// JellyMesh：把 buildGridGeometry 产出的网格几何包成可纹理渲染、可逐帧同步顶点的 PixiJS Mesh。
//
// Pixi v8 API 说明（见 node_modules/pixi.js/lib/scene/mesh/shared/MeshGeometry.mjs）：
// - `Mesh` 默认使用 `MeshGeometry` + 内置 `TextureShader`，MeshGeometry 内部把
//   positions/uvs 分别绑定为名为 `aPosition`/`aUV` 的 attribute（float32x2），
//   这正是默认纹理着色器认的 attribute 名，因此不需要手写 Shader。
// - 直接用裸 `Geometry({ attributes: { aPosition: Float32Array, ... } })`（brief 里的写法）
//   不会自动带上 attribute 的 format/stride/offset 元信息；`MeshGeometry` 会把这些设好，
//   所以这里改用官方推荐的 `MeshGeometry`，更贴合 v8 真实构造签名。
// - 顶点更新方式取自 MeshSimple.d.ts 官方示例注释：
//   `mesh.geometry.getBuffer('aPosition').update()`，Buffer.update() 会 emit('update')
//   通知渲染器把该 buffer 重新上传到 GPU。
import { Mesh, MeshGeometry } from 'pixi.js'
import { buildGridGeometry } from './gridGeometry.js'

export class JellyMesh {
  constructor(texture, grid, displayW, displayH) {
    this.grid = grid
    const { cols, rows } = grid
    const geo = buildGridGeometry(cols, rows, displayW, displayH)
    this._positions = geo.positions // Float32Array 交错 xy，sync() 时直接原地改写

    this.geometry = new MeshGeometry({
      positions: this._positions,
      uvs: geo.uvs,
      indices: geo.indices,
    })

    this.mesh = new Mesh({ geometry: this.geometry, texture })
  }

  // 用几何 rest 位置初始化 grid（restX/restY/x/y），速度清零。
  initGridFromGeometry() {
    const g = this.grid
    const pos = this._positions
    for (let i = 0; i < g.restX.length; i++) {
      g.restX[i] = pos[i * 2]; g.restY[i] = pos[i * 2 + 1]
      g.x[i] = g.restX[i]; g.y[i] = g.restY[i]
      g.vx[i] = 0; g.vy[i] = 0
    }
  }

  // 每帧调用：把 grid.x/grid.y 写回 positions 缓冲并标记 GPU 需要重新上传。
  sync() {
    const g = this.grid
    const pos = this._positions
    for (let i = 0; i < g.x.length; i++) {
      pos[i * 2] = g.x[i]
      pos[i * 2 + 1] = g.y[i]
    }
    this.geometry.getBuffer('aPosition').update()
  }
}
