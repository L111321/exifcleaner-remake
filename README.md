# ExifCleaner 重制版

> 灵感来自 [szTheory/exifcleaner](https://github.com/szTheory/exifcleaner)：批量删除图片元数据的桌面工具。
> 本仓库为独立重制实现（Electron + React），元数据解析核心零第三方依赖、全部自写。

## 功能

- 拖拽或批量选择 JPG / PNG，一键清理元数据
- 删除的内容：**EXIF（GPS 定位、拍摄时间、设备型号）、XMP、IPTC、注释、PNG 文本块/时间块**
- 保留的内容：JPEG 的 APP0(JFIF) 与 APP2(ICC 色彩配置)，保证图片显示与颜色不变
- 输出到指定目录（默认源文件同目录，文件名加 `-clean` 后缀）
- 展示每个文件的"大小变化 / 移除段数 / 状态"
- 所有处理在本机完成，不上传任何文件

## 快速开始

```bash
npm install        # Electron 二进制较大，网络慢时可设 ELECTRON_SKIP_BINARY_DOWNLOAD=1 先装依赖
npm run build      # 构建主进程 / preload / 渲染进程
npm start          # 启动应用（build + electron .）
```

单独验证：

```bash
npm test           # 元数据解析核心的 9 个单元测试
npm run typecheck  # 主进程 + 渲染进程两套 tsconfig 类型检查
```

## 目录结构

```
src/
  core/metadata.ts     元数据解析核心：JPEG 段解析 / PNG 块解析（纯函数，零依赖）
  main/
    main.ts            Electron 主进程：窗口、文件对话框、批量清理流程、IPC
    preload.ts         contextBridge 安全桥（contextIsolation 开启）
  renderer/            React 界面（Vite 构建）：拖拽区、文件列表、结果表格
test/
  metadata.test.mjs    核心解析的单元测试（node:test）
scripts/build-main.mjs esbuild 打包主进程/preload/core
```

## 技术要点

- **自写二进制解析器**：JPEG 按 `FFxx` 段标记遍历（APP1/APP13/COM 剔除，SOS 后图像数据原样保留），PNG 按块结构遍历（eXIf/tEXt/iTXt/zTXt/tIME 剔除），不依赖 exiftool 等外部程序。
- **安全模型**：渲染进程 `contextIsolation: true`、无 Node 集成，仅通过 preload 暴露 4 个 IPC 方法；文件读写全部在主进程完成。
- **纯函数内核**：解析与 IO 分离，核心逻辑可以直接在 Node 里单测，也方便未来做成 CLI。
- **拖拽取路径**：使用 Electron 32+ 的 `webUtils.getPathForFile`，避免渲染进程直接触碰文件系统。

## 简历可写要点（参考）

- 基于 Electron + React 实现图片元数据清理工具，自写 JPEG/PNG 二进制解析器（零第三方依赖），按段/块级别剔除 EXIF、XMP、IPTC 等元数据。
- 设计主进程/渲染进程安全通信架构（contextIsolation + preload IPC），文件批量处理含进度与错误兜底。
- esbuild + Vite 双构建管线分别产出主进程与渲染包；核心逻辑纯函数化，9 个单元测试覆盖解析、幂等性与异常输入。

## 文档

更详细的设计与实现见 [Docs/exifcleaner-项目文档.md](Docs/exifcleaner-项目文档.md)。

## 许可

原项目为 MIT 协议；本重制版为独立实现。
