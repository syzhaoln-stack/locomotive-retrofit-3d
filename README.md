# 机车油改电 · 交互三维拆换演示

将 Blender 方案模型转换为可在手机和电脑浏览的三维工作台，使用 Three.js、glTF / Meshopt 与 GitHub Pages。

## 功能

- 八个拆换步骤，手动切换或自动播放。
- 42个语义总成，可点选、消隐、隔离、恢复和撤销隐藏。
- 独立轮对、牵引电机、电池、高低压柜、逆变器和四色管线。
- 手机单指旋转、双指缩放与平移；竖屏和横屏分别安排画面。
- 六个预设视角、全屏、当前步骤与消隐状态的分享链接。
- 三维加载失败时可重试或观看视频。

## 本地开发

```sh
npm ci
npm run dev
npm test
npm run build
```

静态输出为 `dist/`，资源全部通过相对路径访问，无需服务器端服务。GitHub Actions 在 `main` 更新时构建并发布 Pages。

## 模型

`public/assets/model.glb` 保留原 Blender 几何总成，合并同组同材质的网格并使用 Meshopt 压缩。约2.28 MiB、42语义组、252绘制批次、428,918三角面。分组、坐标、优化与验证记录见 `model-manifest.json`。

坐标为glTF右手Y向上、单位米。各语义组的原点为零，步骤的展示位移由 `src/state.js` 定义。牵引电机是原车保留件，不能随新增电气设备一同隐藏。阶段默认可见性、用户消隐和隔离分开计算；恢复不会把已拆除的柴油机显示在电改完成状态中。

## 说明

这是方案模型。外观参考用户视频，尺寸、轴式、内部布置和电路需依据原车图纸校准。公开来源见网站“模型依据与说明”。本仓库不包含用户原视频、原厂PDF或系统字体。

Third-party runtime: Three.js (MIT), Meshoptimizer (MIT), Vite (MIT). Dependency license notices are available in their upstream repositories and package distributions. No additional reuse license is granted here for the locomotive model.
