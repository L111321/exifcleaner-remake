# ExifCleaner 重制版 — 项目文档

> **项目类型**：跨平台桌面应用（图片元数据清理工具）
> **技术栈**：Electron 33 + React 18 + TypeScript｜Vite 6 + esbuild 0.24
> **灵感来源**：[szTheory/exifcleaner](https://github.com/szTheory/exifcleaner)
> **文档日期**：2026 年 11 月

---

## 1. 项目概述

ExifCleaner 是一个本地运行的图片隐私工具：批量删除 JPG / PNG 中的元数据（GPS 定位、拍摄时间、设备型号、编辑记录等），并保证图片本身的画质与颜色不变。

原项目基于 Electron，内部依赖 `exiftool` 等外部程序。本重制版的核心区别是：**元数据解析全部自写，零第三方依赖**。这不只是"炫技"——它让核心逻辑变成纯函数，可以在 Node 里直接单测，未来也能轻松改造成 CLI 或 WebAssembly 版本。

选择这个项目的出发点是：它把「二进制文件格式」这个容易被忽视的底层知识落到了实处。前端工程师平时很少直接处理字节流，而这个项目必须精确理解 JPEG 的段（segment）与 PNG 的块（chunk）结构。

---

## 2. 功能清单

| 功能 | 说明 |
| --- | --- |
| 批量选择 | 文件对话框多选，或把文件拖进窗口 |
| 格式支持 | JPG / JPEG / PNG（按文件头识别，不看扩展名） |
| 清理内容 | JPEG：APP1（EXIF/XMP）、APP13（IPTC/Photoshop）、APP12、COM 注释；PNG：`eXIf`、`tEXt`、`iTXt`、`zTXt`、`tIME` |
| 保留内容 | JPEG 的 APP0（JFIF）与 APP2（ICC 色彩配置），PNG 的 `IHDR` / `IDAT` / `IEND` 等关键块 |
| 输出 | 默认与源文件同目录，文件名加 `-clean` 后缀；可自定义输出目录 |
| 结果展示 | 每个文件的大小变化、移除段数、成功/失败状态；汇总成功数、失败数、总移除段数、节省空间 |
| 隐私 | 全部处理在本机完成，不联网、不上传 |
| 安全 | 渲染进程无 Node 权限，文件读写全部在主进程，通过 preload 暴露最小 IPC 接口 |

---

## 3. 技术栈与选型理由

| 层次 | 技术 | 说明 |
| --- | --- | --- |
| 桌面容器 | Electron 33 | 跨平台、成熟的文件系统与对话框 API |
| 界面 | React 18 + TypeScript | 组件化、类型安全 |
| 渲染进程构建 | Vite 6 | 快速开发与打包 |
| 主进程 / preload 构建 | esbuild 0.24 | 把 TS 打成 CJS，`external: ['electron']` |
| 核心解析 | 纯 TypeScript + Node Buffer | 零依赖，可直接在 Node 测试 |
| 测试 | `node:test` | 内置，无需 Jest |

**为什么主进程用 esbuild 而不是 Vite**：Electron 主进程运行在 Node 环境，需要 CJS 产物，esbuild 一行配置即可完成；渲染进程是浏览器环境，用 Vite 更合适。两条构建管线各司其职。

---

## 4. 架构

### 4.1 进程模型

```
┌──────────────────────────── 主进程 (main) ────────────────────────────┐
│  窗口管理 / 文件对话框 / 读写文件 / 调用 cleanImage（纯函数）              │
│  IPC: dialog:pickFiles、dialog:pickOutputDir、files:clean             │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ contextBridge（preload.cjs）
┌───────────────────────────────┴──────────────────────────────────────┐
│  渲染进程 (renderer)：React 界面                                        │
│  window.api = { pickFiles, pickOutputDir, cleanFiles, getFilePath }   │
│  contextIsolation: true，nodeIntegration: false                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 目录结构

```
src/
  core/metadata.ts      纯函数核心：格式识别 + JPEG 段解析 + PNG 块解析
  main/
    main.ts             窗口、对话框、批量清理循环、IPC 注册
    preload.ts          contextBridge 安全桥（4 个方法）
  renderer/             React 界面：拖拽区、文件列表、输出目录、结果表格
test/metadata.test.mjs  9 个单元测试
scripts/build-main.mjs  esbuild 打包 main / preload / core
```

### 4.3 IPC 设计

| 方法 | 方向 | 作用 |
| --- | --- | --- |
| `dialog:pickFiles` | 渲染 → 主 | 打开文件多选框，返回路径数组 |
| `dialog:pickOutputDir` | 渲染 → 主 | 选择输出目录 |
| `files:clean` | 渲染 → 主 | 批量清理，返回每个文件的结果 |
| `webUtils.getPathForFile` | 渲染侧同步 | 拖拽文件时获取真实磁盘路径（Electron 32+） |

**为什么拖拽要特殊处理**：浏览器安全模型下，`File` 对象不暴露真实路径。Electron 32 起推荐用 `webUtils.getPathForFile(file)`，既拿到路径，又不需要打开 `nodeIntegration`。

---

## 5. 核心实现：二进制解析

### 5.1 格式识别

不看扩展名，只看文件头（magic bytes）：

```ts
JPEG: FF D8 FF
PNG : 89 50 4E 47 0D 0A 1A 0A
```

这样即使文件被错误改名，也能正确处理。

### 5.2 JPEG：按段遍历

JPEG 由 `FFxx` 标记的段组成：

```
FFD8 (SOI)
  FFE0 APP0  JFIF（保留）
  FFE1 APP1  EXIF / XMP（删除）
  FFED APP13 IPTC / Photoshop（删除）
  FFEC APP12（删除）
  FFFE COM   注释（删除）
  FFDB DQT   量化表（保留）
  FFDA SOS   熵编码图像数据（从此处到 EOI 整体保留）
FFD9 (EOI)
```

解析器逐段读取：

1. 每段以 `0xFF` + 标记字节开头；
2. 除独立标记（`FF01`、`FFD0`~`FFD7`）外，段内有 2 字节大端长度字段；
3. 命中删除集合的段跳过，其余原样写入输出；
4. 遇到 `SOS`（`FFDA`）后，剩余数据（压缩图像本体 + EOI）整体保留，不再解析。

关键取舍：**保留 APP0 与 APP2**。APP0 包含 JFIF 版本与像素宽高比，APP2 包含 ICC 色彩配置——删掉它们可能导致图片显示异常或颜色偏移。

### 5.3 PNG：按块遍历

PNG 由「长度（4 字节）、类型（4 字节 ASCII）、数据、CRC（4 字节）」的块组成：

```
89 50 4E 47 0D 0A 1A 0A  (签名)
IHDR（保留）
...
eXIf / tEXt / iTXt / zTXt / tIME（删除）
IDAT（保留）
IEND（结束）
```

删除整块时不需要重算 CRC（CRC 只覆盖块自身数据，未改动的块 CRC 仍然有效）。解析到 `IEND` 即停止，尾部残留数据原样保留。

### 5.4 幂等性

同一文件清理两次，第二次应移除 0 段且输出与输入完全一致。测试中专门覆盖了这一点——它证明了「删除集合」与「保留集合」是完备的，解析器不会在二次处理时误删结构段。

### 5.5 纯函数内核

```ts
export function cleanImage(buf: Buffer): CleanResult {
  const format = detectImageFormat(buf);
  if (format === 'jpeg') return stripJpegMetadata(buf);
  if (format === 'png') return stripPngMetadata(buf);
  return { data: buf, removed: 0, format };   // 未知格式原样返回
}
```

输入 Buffer、输出 Buffer + 统计信息，不涉及 IO。由此带来：

- 可直接在 Node 中单测（`npm test` 构建 core 后 import）；
- 未来可包一层 CLI：`node cli.js input.jpg output.jpg`；
- 也可以编译到 WebAssembly 做成纯浏览器工具。

---

## 6. 主进程批量处理

`ipcMain.handle('files:clean', ...)` 的流程：

```
for each file:
  readFile → cleanImage → 计算输出路径（目录 / 原目录 + -clean + 扩展名）→ writeFile
  记录 beforeBytes / afterBytes / removed
  异常则记录 error，不影响其他文件
```

设计要点：

- **单文件失败不中断批量**：每个文件独立 try/catch，结果数组一一对应；
- **输出目录自动创建**：`mkdir(outputDir, { recursive: true })`；
- **文件名冲突策略**：固定 `-clean` 后缀，重复处理会覆盖上一次结果，符合"清理工具"的直觉。

---

## 7. 构建与运行

```bash
npm install        # Electron 二进制较大；网络慢可先 ELECTRON_SKIP_BINARY_DOWNLOAD=1
npm run build      # esbuild 打主进程/preload/core + Vite 打渲染进程
npm start          # build + electron .
```

| 脚本 | 作用 |
| --- | --- |
| `build` | `build-main.mjs` + `vite build` |
| `build:main` | 只构建主进程、preload、core |
| `test` | 先构建 core（供测试 import），再跑 `node --test` |
| `typecheck` | 主进程与渲染进程两套 tsconfig 分别检查 |
| `start` | 构建后启动 Electron |

构建产物：

```
dist/main/main.cjs     主进程（CJS）
dist/main/preload.cjs  安全桥（CJS）
dist/core/metadata.mjs 核心解析（ESM，供测试与未来 CLI）
dist/renderer/         React 界面
```

---

## 8. 测试

`test/metadata.test.mjs` 共 9 个用例：

| 用例 | 覆盖点 |
| --- | --- |
| 识别 JPEG / PNG / 未知格式 | magic bytes 识别 |
| JPEG：移除 APP1 与 COM，保留 APP0 | 段级删除与保留 |
| JPEG：无元数据时输出与输入完全一致 | 不改动合法结构 |
| JPEG：非 JPEG 输入抛错 | 错误处理 |
| PNG：移除 tEXt 与 eXIf，保留 IHDR/IDAT/IEND | 块级删除与保留 |
| PNG：无元数据时输出与输入完全一致 | 结构性保留 |
| cleanImage：按内容自动选择解析器 | 分发逻辑 |
| cleanImage：未知格式原样返回 | 兜底行为 |
| JPEG：输出仍可被再次识别（幂等性） | 二次处理安全性 |

测试数据是**手工构造的最小二进制**：几个字节的 SOI + 段 + EOI，或 PNG 签名 + 关键块。这比加载真实图片更精确，也能断言逐字节结果。

---

## 9. 亮点与工程细节

1. **零依赖二进制解析**：不依赖 exiftool / sharp / image-size，核心仅 178 行 TS，部署与审计都简单；
2. **安全边界清晰**：`contextIsolation: true`、`nodeIntegration: false`，渲染进程只能调用 4 个白名单方法；
3. **纯函数架构**：解析与 IO 分离，测试不需要启动 Electron，也不需要文件系统；
4. **双构建管线**：主进程 esbuild（CJS）+ 渲染进程 Vite（ESM），产物各取所需；
5. **拖拽体验**：`webUtils.getPathForFile` 兼顾安全与易用，支持拖入多个文件、自动去重、过滤非图片；
6. **结果可解释**：不只说"成功"，还展示每个文件移除了多少段、省了多少 KB，让用户能判断清理效果；
7. **错误兜底**：单个文件失败会显示具体原因（如"不是 JPEG 文件"），不影响整批任务。

---

## 10. 局限与改进方向

| 局限 | 改进方向 |
| --- | --- |
| 仅支持 JPG / PNG | 增加 WebP、HEIC、TIFF（解析器按格式插件化） |
| 逐个文件串行处理 | 大文件批量时做并发池 + 进度条 |
| 无预览 | 清理前后缩略图对比、元数据明细展示 |
| 无 CLI | 复用 `cleanImage` 做一个 `exif-clean` 命令行工具 |
| 无撤销 | 输出到独立目录并保留原文件（当前已默认不覆盖源文件） |
| `sandbox: false` | 评估是否可开启 sandbox（需确认 webUtils 兼容性） |
| 未打包安装程序 | 接入 electron-builder，产出 dmg / nsis / AppImage |

---

## 11. 简历可写要点

- 基于 Electron + React 独立实现图片元数据清理工具，自写 JPEG/PNG 二进制解析器（零第三方依赖），按段/块剔除 EXIF、XMP、IPTC、PNG 文本与时间块，保留 JFIF 与 ICC 以维持显示与颜色。
- 设计主进程 / 渲染进程安全通信架构：`contextIsolation` + preload 白名单 IPC，文件读写全部留在主进程；拖拽路径使用 `webUtils.getPathForFile`。
- 纯函数化核心便于测试与复用：9 个单元测试覆盖删除、保留、幂等与异常输入；esbuild + Vite 双构建管线分别产出主进程与渲染包。

---

## 12. 参考资料

1. 原项目：https://github.com/szTheory/exifcleaner
2. JPEG 段结构：https://en.wikipedia.org/wiki/JPEG
3. PNG 规范：https://www.w3.org/TR/png/
4. Electron 安全指南：https://www.electronjs.org/docs/latest/tutorial/security
5. Electron `webUtils`：https://www.electronjs.org/docs/latest/api/web-utils
6. esbuild 文档：https://esbuild.github.io/
