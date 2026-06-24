# 梦笔（mengbi）绘画工具箱

> 梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱。

---

## 项目简介

**梦笔** 是一个基于 **Electron** 的跨平台桌面应用，聚合多种 AI 绘画模型、视频生成模型与大语言模型，提供从提示词优化、画板预编辑、参考图、批量生成、本地放大/修复、图像转矢量、ComfyUI 工作流编排、节点化智能画布到图库管理与提示词反推的一站式创作流。

- ✨ 六大模块：**生图 / 画板 / 图库 / ComfyUI 工作流编排器 / 工具箱 / 智能画布**（外加设置）
- 🧩 智能画布：基于 React Flow 的 AI 创作节点图，17 类节点（图片 / 提示词 / 文字 / LLM / 图像反推 / 视角 / 光源 / 缩放 / 尺寸分析 / 生图 / ComfyUI / 视频上传 / 视频 / 视频反推 / 结果 / 对比 / 分组）
- 🎬 视频生成：异步「提交任务 → 轮询 → 下载 mp4 落盘 → 入图库」，支持 kling / sora / unified / seedance / custom / veo / runway / fal 多协议
- 🎨 二维主题：10 种"材质氛围" × 10 种"主题配色"
- 🌐 多联网搜索后端可切换：模型自带（native）/ DuckDuckGo / 博查 Bocha / 智谱 / Jina / Tavily / Serper / SearXNG
- 🔐 本地优先：API Key 走系统 `safeStorage` 加密，所有外网请求由主进程发出
- 📦 三平台：Windows / macOS / Linux 一致体验
- 🤖 AI 辅助开发：本仓库由 Claude Code 依据 [`CLAUDE.md`](./CLAUDE.md) 协助实现

---

## 模块与路由

左侧侧栏自上而下与下列 6 个顶级入口一一对应（外加设置）：

| 路径 | 快捷键 | 模块 | 说明 |
|------|--------|------|------|
| `/` | Ctrl+1 | 生图 | 对话 + 绘图，参考图、批量生成、任务队列；图像模型「系列(family)」一等公民 |
| `/canvas` | Ctrl+2 | 画板 | 有界 4096²，多图层 / 笔刷 / 蒙版 / 透视 / 抠图 / 局部重绘 / 扩图 / Photoshop 联动 |
| `/manager` | Ctrl+3 | 图库 | 图片库 + 手动/智能相册（提示词管家 UI 已下线，固定图库视图） |
| `/comfyui` | Ctrl+4 | ComfyUI 工作流编排器 | 连接本地 ComfyUI、导入 API workflow、可视化绑定、批量循环 |
| `/tools` | Ctrl+5 | 工具箱 | Real-ESRGAN 保真放大 + 图像转矢量（VTracer / Potrace），本地处理 |
| `/smart-canvas` | Ctrl+6 | 智能画布 | React Flow 节点图，17 类 AI 创作节点 + 连线运行 |
| `/settings` | — | 设置 | 模型方案 / 外观 / 存储与系统 |

> 界面缩放：Ctrl+= / Ctrl+- / Ctrl+0（持久化，设置页「外观」可调）。

---

## 核心能力

### 生图

对话 + 绘图一体。图像模型「系列(family)」一等公民（`src/types/imageModelFamilies.ts`）：内置 `gpt-image-2` / `nano-banana-pro` / `nano-banana-flash` / `nano-banana-2` / `default` 五个 family，`buildBody` 只发该 family 真正识别的字段（解决"选 4K 实际出 1K"）；之后按方案的 `body_overrides_json` 顶层合并（占位符整串替换 + `null` 删字段）。支持参考图、批量生成、负向提示词、seed、任务队列。

### 智能画布（17 类节点）

基于 React Flow（`@xyflow/react`）的 AI 创作节点图：

- **节点种类**：图片 / 提示词 / 文字 / LLM / 图像反推 / 视角 / 光源 / 缩放 / 尺寸分析 / 生图 / ComfyUI / 视频上传 / 视频 / 视频反推 / 结果 / 对比 / 分组。
- **多文档**：launcher-first 启动页 + 工具栏画布菜单切换，内容存 localStorage；在途任务跨文档回灌。
- **编辑**：撤销/重做（Ctrl+Z / Ctrl+Shift+Z）、复制/粘贴/再制（Ctrl+C/V/D）、节点搜索（Ctrl+F）、网格吸附 + 对齐参考线、智能排布、分组容器、连线流动着色。
- **运行**：运行全部（按拓扑顺序串行）、结果累积集合、跨模块"发送到智能画布"。
- **复用现有 IPC（零新增）**：生图节点复用 `api:image:generate` / `api:upscale:run-single`；LLM 节点复用 `api:chat:optimize-prompt` + `api:lab:reverse`；ComfyUI 节点复用 `api:comfyui:run-single`；图像/视频反推复用 `api:lab:reverse`；缩放视频走 `api:video:scale`。

### ComfyUI 工作流编排器

独立顶级模块（区别于生图页方案里的 `image_kind='comfyui'` 内联直跑）。连接本地 ComfyUI（探活 / 启动 / 选文件夹自动识别启动命令）、导入 API Format workflow、可视化绑定输入输出、模板 CRUD、单次/批量循环运行。进度优先走 `ws://host/ws`，回退 `/history` 轮询。

### 工具箱（两引擎，本地处理）

- **Real-ESRGAN ncnn Vulkan**（保真放大，默认）：外部可执行文件，2x/3x/4x，不进 Python / PyTorch。
- **图像转矢量**：VTracer（彩色，Rust CPU）/ Potrace（单色，纯 JS CPU），用户明确选模式。

### 视频生成（异步）

范式：「提交任务 → 轮询状态 → 下载 mp4 落盘 → 入图库」。配置 `api_configs.type='video'` + `video_kind ∈ kling | sora | unified | seedance | custom | veo | runway | fal`；kling/sora/unified 走 `electron/ipc/video.ts` 内置 legacy 引擎，其余走 `electron/services/video/` 适配器（`VideoProviderAdapter` 接口 + registry）。配置中心存 settings 表 `video_providers_json`（端点 / 能力 / 限制 / 默认参数 / 费用阈值），设置页 `VideoProvidersCenter` 可视化编辑。智能画布"视频"节点为真实生成（非 mock），7 种模式按能力自适应 + 费用预估 + dry-run 校验 + 高费用二次确认 + 批量 + 连续生成。图库视频封面在渲染端抓首帧 webp（免 ffmpeg），仅对新生成且抓帧成功者生效。

> 说明：原"v1.0 不做视频生成"的限制已于 2026-06-07 解除。

### 数据与存储

本地 SQLite（better-sqlite3，同步 API），当前 `schema_version = 15`（v14 加入 ComfyUI 模板/运行记录，v15 给 `api_configs` 加 `video_kind` 列）。`prompts` / `images` 采用软删除（置 `deleted_at`，列表查询带 `WHERE deleted_at IS NULL`，30 天后物理清理）。图片落盘命名统一为 `{date}/{taskId}-{seq}.png`、缩略图 `{date}/.thumbs/{taskId}-{seq}.webp`。所有配置可在设置页一键加密导出/导入（方案 + API Key + 外观 + 设置 + 提示词，AES-256-GCM）。

---

## 设计预览

> 设计稿位于 `前端页面设计参考/`：

| 模块 | 预览 |
|------|------|
| 生图 | ![生图](./前端页面设计参考/绘图前端页面.png) |
| 图库 | ![图库](./前端页面设计参考/图库前端页面.png) |
| 主题切换 | ![主题](./前端页面设计参考/可调风格页面.png) |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面容器 | Electron 28+ |
| 前端 | React 18 + TypeScript + Vite 5 |
| 状态管理 | Zustand 4 |
| 动效 | Framer Motion 11 |
| 主进程 | Node.js（Electron Main） + Express 风格 IPC 路由 |
| 数据库 | better-sqlite3 11（同步 API） |
| 安全 | Electron `safeStorage`（加密 API Key） |
| 入参校验 | zod |
| 打包 | electron-builder 24 |
| 更新 | electron-updater 6 |

### 关键依赖

| 依赖 | 用途 |
|------|------|
| `@xyflow/react` | 智能画布节点图（React Flow v12） |
| `ws` + `expr-eval` | ComfyUI 实时进度（WebSocket）+ 安全公式循环 |
| `ffmpeg-static` | 视频缩放（`api:video:scale`，electron-builder asarUnpack 解包） |
| `@imgly/background-removal` + `onnxruntime-web/-node` | 画板 / 工具箱抠图 |
| `sharp` | 缩略图生成（native，asarUnpack） |
| `@neplex/vectorizer`（VTracer, Rust）+ `potrace` | 图像转矢量 |
| `node-llama-cpp` | 内嵌本地 LLM（开发中） |
| `konva` + `react-konva` | 画板渲染 |
| `vitest` | 单元测试（参数流纯函数，约 94 例） |

---

## 快速开始

> 前置要求详见 [`ENVIRONMENT.md`](./ENVIRONMENT.md)。

```bash
# 1. 克隆仓库
git clone <repo-url>
cd mengbi

# 2. 安装依赖（postinstall 会自动 electron-rebuild）
npm install

# 3. 启动开发模式
npm run dev
```

### 常用脚本

```bash
npm run dev           # electron-vite dev（开发模式）
npm run build         # electron-vite build（主进程 + 渲染产物）
npm run typecheck     # typecheck:node + typecheck:web（tsc --noEmit）
npm test              # vitest run（参数流纯函数单测）
npm run lint          # ESLint
npm run package:win   # electron-vite build + electron-builder --win
npm run package:mac   # electron-vite build + electron-builder --mac
npm run package:linux # electron-vite build + electron-builder --linux
```

> 开发阶段如果在 Linux 没有 keyring backend，可设置 `MENGBI_DEV_KEY=<32 位十六进制>` 走 safeStorage 兜底。
> AI 辅助开发期默认走 `MENGBI_MOCK=1` Mock 模式，不做无谓真实 API 调用。

---

## 项目结构

```
mengbi/
├── electron/
│   ├── main.ts            # Electron 主进程入口
│   ├── preload.ts         # contextBridge 白名单
│   ├── ipc/               # IPC 路由（zod 校验入参，返回 Result<T,AppError>）
│   │   ├── index.ts       # 注册所有 handler + DB 迁移
│   │   ├── chat.ts        # 对话与流式
│   │   ├── generate.ts    # 绘图与任务队列
│   │   ├── imageBody.ts   # 请求体覆盖 / 尺寸解析（纯函数，单测）
│   │   ├── gallery.ts     # 图库 / 相册 / 提示词（管家 UI 休眠，后端保留）
│   │   ├── settings.ts    # 方案 / 模型配置 / 测试连通
│   │   ├── lab.ts         # 反推 / 翻译后端（页面下线，智能画布复用）
│   │   ├── tools.ts / upscale.ts / vec.ts  # 工具箱
│   │   ├── comfyui*.ts    # ComfyUI 编排器
│   │   ├── video.ts       # 视频生成（异步引擎 + 适配器）
│   │   ├── ps.ts          # 画板 Photoshop 联动
│   │   ├── localLlm.ts    # 内嵌本地 LLM（开发中）
│   │   └── interp.ts      # 视频插帧（RIFE）
│   └── services/          # comfyui / video / 工具箱引擎 等
├── shared/                # @shared/video + @shared/videoProviders（共享层）
├── src/
│   ├── assets/
│   ├── components/        # 通用组件
│   ├── pages/
│   │   ├── Create/        # 生图 (`/`，Ctrl+1)
│   │   ├── Canvas/        # 画板 (`/canvas`，Ctrl+2)
│   │   ├── Manager/       # 图库 + 相册 (`/manager`，Ctrl+3)
│   │   ├── ComfyUI/       # ComfyUI 工作流编排器 (`/comfyui`，Ctrl+4)
│   │   ├── Tools/         # 工具箱：保真放大 / 图像转矢量 (`/tools`，Ctrl+5)
│   │   └── SmartCanvas/   # 智能画布：17 类 AI 节点 (`/smart-canvas`，Ctrl+6)
│   │       └── nodes/     # 各类自定义节点 + NodeShell
│   ├── store/             # Zustand stores
│   ├── hooks/
│   ├── types/             # 跨进程共享 TS 类型 + ParamSchema
│   ├── styles/
│   │   └── theme.css      # 10 + 10 套主题 token
│   └── App.tsx
├── resources/             # 应用图标、托盘图等
├── 前端页面设计参考/       # 设计稿
├── package.json
├── electron-builder.yml
├── tsconfig.json
└── vite.config.ts
```

---

## 文档地图

| 文档 | 用途 |
|------|------|
| [`WHITEPAPER.md`](./WHITEPAPER.md) | 产品视角的项目说明书：用户故事、竞品差异、Roadmap |
| [`FEATURES.md`](./FEATURES.md) | P0 / P1 / P2 优先级功能清单 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 技术架构、模块依赖、流式时序图 |
| [`DEVELOPMENT.md`](./DEVELOPMENT.md) | 7 个 Phase 的开发节奏与验收标准 |
| [`ENVIRONMENT.md`](./ENVIRONMENT.md) | 开发 / 用户 / API 服务环境要求 |
| [`THEMING.md`](./THEMING.md) | 10 × 10 主题矩阵与 CSS 变量规则 |
| [`CLAUDE.md`](./CLAUDE.md) | AI 开发指令（Claude Code 据此生成代码，最权威） |

> **没有** `SETUP.md` —— 安装信息已合并到本文件的「快速开始」与 `ENVIRONMENT.md`。

---

## 开发方式

本项目使用 **Claude Code** 进行 AI 辅助开发：

1. 所有代码生成都遵循 [`CLAUDE.md`](./CLAUDE.md) 中的目录结构、IPC 通道命名、数据模型与设计规范；
2. 阶段排期与验收标准见 [`DEVELOPMENT.md`](./DEVELOPMENT.md)；
3. 关键决策（主题、导航、IPC 命名、Slogan）已在文档中固化，避免漂移；
4. 关键铁律：前端绝不直接调外部 API（全主进程）、API Key 永不明文出现、IPC 返回 `Result<T, AppError>` 不 throw、软删除是默认、v1.0 不引入 i18n（中文硬编码）。

---

## License

本项目采用 **MIT License**。

```
Copyright (c) 2026 mengbi contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

> 完整许可证全文将在 Phase 1 落地后写入仓库根目录的 `LICENSE` 文件（本轮文档阶段不创建）。

---

## 致谢

- Electron / React / Vite 社区
- 各家提供 OpenAI 兼容协议的中转站
- 测试与试用本工具的早期用户
