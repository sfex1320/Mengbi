# 梦笔（mengbi）绘画工具箱 · 项目白皮书

> 梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱。

---

## 一、产品定义

**梦笔** 是一个本地 Electron 跨平台桌面应用，聚合多种 AI 绘画模型、大语言模型与视频生成模型，提供"对话优化提示词 → 参考图编辑 → 绘图 / 视频生成 → 节点式工作流编排 → 图库管理 → 提示词反推"的完整创作流水线。

### 1.1 核心价值（"聚 / 磨 / 创 / 管 / 进"）

| 字 | 含义 |
|----|------|
| **聚** | 一处汇聚多个绘画 / 对话 / 多模态 / 视频模型，无需在各家网页间反复切换 |
| **磨** | 用对话模型反复打磨提示词，配合反推工具，把灵感打磨成可复用的"提示词"资产 |
| **创** | 单张 / 批量 / 多参考图 / 多预设的灵活创作流，外加智能画布节点式 AI 工作流与 ComfyUI 深度编排 |
| **管** | 图库一体化，用相册、标签、评分把作品资产化 |
| **进** | 工具箱本身随时升级，主题、模型、功能持续演进 |

### 1.2 产品边界

**梦笔做：** 调度 / 编排 / 管理。它本身**不**训练任何模型、**不**自带 API Key、**不**做服务器端业务。

**梦笔不做：** 社交分享、模型微调、自建账号体系。

> 视频生成已于 2026-06-07 接入（异步「提交 → 轮询 → 下载 mp4 落盘 → 入图库」），早期"v1.0 不做视频"的限制已解除。视频提示词的"纯文本管理"在图库中仍保留。

---

## 二、用户角色与典型剧本

**主角色：创作者**——可能是平面 / 概念 / 头像 / 摄影后期等任何一种"用 AI 出图"的从业或爱好者。

### 2.1 第一次启动（零配置入门）

```
首启 → 启动屏 logo + slogan
     → 检测到无方案，进入引导页
       Step 1：选默认主题（材质氛围 × 主题配色）
       Step 2：创建第一个方案（命名 + 至少一组对话或绘画模型）
       Step 3：填 base_url + API Key + 模型映射 → 测连通 → 落库
     → 引导完成 → 跳转到 `/`（生图页）
     → 顶部欢迎 toast："欢迎来到梦笔，按 Ctrl+1~6 在各模块间切换"
```

如果跳过引导：所有依赖 API 的入口都灰显并提示"请先在设置页配置模型"，但用户仍可浏览空界面与切换主题。

### 2.2 一天的工作流

```
09:30  打开梦笔，选择"幻梦星空 × 紫"主题
       在「图库」里翻到上次的夜景街拍，右键"发送到智能画布"
09:32  在生图页与对话模型"再润色一下，加点雨夜元素"
09:35  上传两张参考图（街景 + 模特）
       AI 自动描述参考图 → 注入提示词
09:40  批量生成 8 张（同 prompt × 8 张），并发 3
09:55  全部完成 → 自动入库 → 自动生成缩略图
10:05  四张并排挑出 2 张打五星，归入"雨夜"相册
10:30  把客户给的产品图 + 一张商业摄影参考图丢进「画板」
       缩放对齐两张图，给主体抠背景，加柔光混合模式
       拖一下四角做透视，让画面更稳；导出 PNG → 一键送回生图页作参考
14:00  在「智能画布」里搭节点图：图片节点 → LLM 反推提示词 → 生图节点 → 结果节点
       接一个"视频"节点把终稿图作首帧生成一段短视频
14:20  生图模型基于拼好的参考图重出，结果比直接喂两张原图明显更稳定
```

### 2.3 价值闭环

灵感 ─► 对话润色 ─► 出图 / 出视频 ─► 入库 ─► 反推 / 节点工作流再创作 ─► 沉淀回图库与相册 ─► 下一个灵感复用

---

## 三、功能全景

详见 [`FEATURES.md`](./FEATURES.md)（P0 / P1 / P2 分级清单）。当前共 **6 个顶级入口 + 设置**，与左侧侧栏自上而下一一对应：

| 路由 | 快捷键 | 模块 |
|------|--------|------|
| `/` | Ctrl+1 | 生图（对话 + 绘图） |
| `/canvas` | Ctrl+2 | 画板（有界 4096²，素材预编辑） |
| `/manager` | Ctrl+3 | 图库（含相册） |
| `/comfyui` | Ctrl+4 | ComfyUI 工作流编排器 |
| `/tools` | Ctrl+5 | 工具箱（本地处理） |
| `/smart-canvas` | Ctrl+6 | 智能画布（节点式 AI 工作流） |
| `/settings` | — | 设置 |

> 全局界面缩放：Ctrl+= / Ctrl+- / Ctrl+0（持久化，画板页内 Ctrl+± 缩放画布除外）。

### 3.1 生图（`/`）
对话区 + 绘图执行区两栏。对话用于润色提示词、参考图描述、联网搜索；执行区负责具体提交、参数、参考图、批量、队列。绘图参数按所选模型的"系列（family）"自适应——只发该系列真正识别的字段，杜绝"选 4K 实际出 1K"。

### 3.2 图库（`/manager`）
固定的图库网格视图 + 左侧相册导航。支持标签、评分、备注、按相册筛选；相册分**手动**（逐张归入）与**智能**（按评分 / 标签 / 模型 / 日期规则实时匹配）两类。删除走软删除（30 天回收期）。右键菜单可"发送到智能画布""作参考图"等跨模块联动。

> **提示词管家 UI 已于 2026-06-05 下线**：`/manager` 固定为图库视图，原"图片提示词 / 视频提示词 / 提问方法 / 文档资料 / 我的收藏"分类卡片与编辑入口已移除（底层 `prompts` 表与 `api:prompt:*` 通道保留为休眠态）。视频提示词的纯文本管理在图库中仍可承载。

### 3.3 画板（`/canvas`）
一个**轻量版 PS**：多图层、自由变换、四角透视、混合模式、本地抠图、裁切、调色、扩图（outpaint）、局部重绘蒙版、Photoshop 联动、撤销栈与命名快照。画布有界，上限 4096×4096。
定位：**生图前的"素材预编辑"环节** —— 拼版 / 调透视 / 抠背景 / 混合 → 输出 PNG → 一键送进生图页作"参考图 / 垫图"，或"发送到智能画布"。
**Photoshop 联动**（`api:ps:*`）：把当前画布写成临时 PNG → 用 PS 打开 → 监听用户在 PS 里保存（`fs.watchFile`）→ 自动导回为新图层 / 替换图层 / 新建画布。

### 3.4 ComfyUI 工作流编排器（`/comfyui`）
连接本地 ComfyUI、导入 **API 格式** workflow，把任意节点字段绑成可调控件、可视化节点图（含删节点）、限定输出节点、批量循环、串行队列与运行记录管理；并能一键卸载模型 / 清理显存。进度优先走 WebSocket 实时回传，失败回退 `/history` 轮询。选 ComfyUI 文件夹可自动识别启动命令（免手填）。

### 3.5 工具箱（`/tools`）
本地处理工具集，全部本地跑、结果可一键入库（自动生成缩略图）：
- **保真放大**：Real-ESRGAN ncnn Vulkan（外部可执行，2x/3x/4x，支持安装引擎与单独下载模型）。
- **图像转矢量**：VTracer（彩色，Rust CPU）/ Potrace（单色，纯 JS CPU），用户明确二选一。

> SUPIR 放大（2026-05-29）、HYPIR AI 修复放大、OmniSVG AI 矢量化（2026-05-27）均已整体砍除，不再现役。

### 3.6 智能画布（`/smart-canvas`）
基于 React Flow（`@xyflow/react`）的节点式 AI 创作工作流：拖节点、连线、运行，把"图片 / 提示词 / 反推 / 生图 / ComfyUI / 视频 / 结果"等串成可视化流水线。**共 17 类节点**：

| 类别 | 节点 |
|------|------|
| 素材 | 图片 / 提示词 / 文字 / 视频上传 |
| 分析与改写 | LLM / 图像反推 / 视频反推 / 视角 / 光源 / 缩放 / 尺寸分析 |
| 生成 | 生图（provider：mengbi 真生成 / mock）/ ComfyUI / 视频 |
| 汇总 | 结果 / 对比 / 分组 |

能力：多文档（launcher-first 启动页 + 工具栏画布菜单切换）、撤销/重做（Ctrl+Z / Shift+Z）、复制/粘贴/再制（Ctrl+C/V/D）、运行全部（拓扑串行）、节点搜索（Ctrl+F）、连线流动着色、网格吸附 + 对齐参考线、智能排布、分组容器、结果累积集合、在途任务跨文档回灌。生图节点复用 `api:image:generate` / `api:upscale:run-single`；LLM / 反推节点复用 `api:chat:optimize-prompt` + `api:lab:reverse`；ComfyUI 节点把整个工作流当黑盒复用 `api:comfyui:run-single`；视频节点为真实生成（7 种模式按能力自适应 + 费用预估 + dry-run 校验 + 高费用二次确认 + 批量 + 连续生成）。零新增 IPC 通道（除视频缩放 `api:video:scale`），全部复用既有通道。

### 3.7 视频生成（跨模块能力）
异步范式：**提交任务 → 轮询状态 → 下载 mp4 落盘 → 入图库**。配置走 `api_configs.type='video'` + `video_kind`（kling / sora / unified / seedance / custom / veo / runway / fal）；kling/sora/unified 走内置 legacy 引擎，其余走 `electron/services/video/` 适配器（`VideoProviderAdapter` 接口 + registry）。设置页「视频模型配置中心」（`VideoProvidersCenter`）可视化编辑端点 / 能力 / 限制 / 默认参数 / 费用阈值，并查看任务历史。图库视频封面由渲染端抓首帧生成 webp（免 ffmpeg）。视频生成入口在设置页配置 + 智能画布"视频"节点。

---

## 四、设计语言

设计语言由 [`THEMING.md`](./THEMING.md) 定义。要点：

- **二维主题模型**：10 种"材质氛围（atmosphere）" × 10 种"主题配色（palette）"= 100 种组合，CSS 写 20 套 token（10 + 10）；
- 默认 `deep-quiet × warm-orange`（暖橘 × 沉稳）；
- 大圆角（卡片 20px、按钮 16px），玻璃态卡片（半透明 + backdrop-blur）；
- 字体：`Inter` + `SF Pro Display` + 系统字；
- 动效：所有过渡走 250ms、`cubic-bezier(0.4, 0, 0.2, 1)`；
- CSS 变量统一前缀 `--mb-`，颜色字面量只写在 `theme.css`；
- 主题相关偏好（`themeStore`）还含界面缩放 `appZoom`（持久化）与智能画布连线流动色 `flowColor`（默认跟随 accent）。

---

## 五、技术架构（概要）

详见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。要点：

- **Electron 28 + React 18 + TypeScript + Vite 5**；
- 状态：Zustand 4；动效：Framer Motion 11；
- 主进程 Express 风格 IPC 路由 + `better-sqlite3` 11 同步数据库（当前 `schema_version = 15`）；
- IPC 命名 `api:<domain>:<action>`，入参经 zod 校验，统一返回 `Result<T, AppError>`（不 throw；`AppError.severity ∈ fatal | modal | toast | inline | silent`）；
- 安全：`safeStorage` 加密 API Key（永不明文出现在前端 / 日志 / IPC 响应）；所有外网请求由主进程发出，渲染进程无 fetch 权限；
- 打包 `electron-builder` 24，更新 `electron-updater` 6；
- 关键依赖：`@xyflow/react`（智能画布节点图）、`ws` + `expr-eval`（ComfyUI 实时进度 + 安全公式循环）、`ffmpeg-static`（视频缩放）、`@imgly/background-removal` + `onnxruntime`（抠图）、`sharp`（缩略图）、`@neplex/vectorizer` + `potrace`（图像转矢量）、`node-llama-cpp`（内嵌本地 LLM，开发中）、`vitest`（单测，覆盖参数流纯函数约 94 例）。

### 5.1 IPC 域速览

`chat` / `image` / `gallery·prompt·album` / `lab`（后端保留，页面已下线）/ `settings·plan·storage·export·theme` / `tools·upscale·vec·interp`（工具箱：保真放大 / 图像转矢量 / RIFE 插帧）/ `ps`（画板 Photoshop 联动）/ `comfyui`（编排器）/ `llm`（内嵌本地 LLM，开发中）/ `video`。

主进程主动推送频道：`chat:chunk` / `chat:done` / `chat:sources` / `image:done` / `image:progress` / `notification:append` / `upscale:progress` / `upscale:done` / `upscale:install-progress` / `ps:file-changed` / `comfyui:status` / `comfyui:run-progress` / `comfyui:run-done` / `comfyui:queue` / `video:progress` / `video:done`。

---

## 六、竞品差异

| 对比项 | 梦笔 | Midjourney | NovelAI | A1111 / WebUI |
|--------|------|-----------|---------|--------------|
| 部署 | 本地桌面应用 | 网页（Discord） | 网页 | 本地浏览器 |
| 多模型聚合 | ✅ 任意 OpenAI 兼容 + 国产模型 + 中转站 | ❌ 单一 | ❌ 单一 | 仅本地模型 |
| 多模态对话 | ✅ 配合 vision 模型 | ❌ | ❌ | ❌ |
| 图库 / 资产管理 | ✅ 图库 + 相册 + 标签评分 | 较弱 | 较弱 | ❌ |
| 反推 / 节点工作流 | ✅ LLM 反推 + 智能画布节点图 | ❌ | ❌ | 部分插件支持 |
| 节点式工作流 | ✅ 智能画布 + ComfyUI 编排器 | ❌ | ❌ | ComfyUI 生态 |
| 主题系统 | ✅ 100 种组合 | ❌ | ❌ | 不重视 |
| Key / 隐私 | 本地加密，无服务器 | 全在云 | 全在云 | 本地 |
| 视频生成 | ✅ 多供应商异步生成 | ❌ | ❌ | 部分插件 |

定位：**面向有"自己 Key"的创作者，把"出图 + 管理 + 复用"放在一个本地客户端里。**

---

## 七、Roadmap

### 已落地（截至 2026-06）
- 六大模块：生图 / 画板 / 图库（含相册） / ComfyUI 编排器 / 工具箱 / 智能画布
- 智能画布节点式 AI 工作流（17 类节点）
- 视频生成（多供应商异步对接，配置中心 + 智能画布视频节点）
- 画板 Photoshop 联动、扩图、局部重绘蒙版
- 工具箱保真放大 + 图像转矢量
- 软删除回收站（30 天保留）、智能相册
- 三平台安装包 + 自动更新通道

### 近期（v1.x）
- 剩余 P1（如 AI 自动标签、自定义快捷键完善）
- 本地 LLM（`node-llama-cpp` 内嵌推理）的模型选择与参数面板补齐
- 视频更多供应商适配器真机校准

### v1.5（半年内）
- 大部分 P2：迷你悬浮窗、瀑布流虚拟滚动、作品卡片导出、浅色氛围、多模型对比
- **i18n 国际化**：引入 i18n 框架（react-i18next 或类似），优先补英文 / 繁体中文 locale；UI 文案改为 key/value
- 用量与成本看板（按月统计 token / 图片张数 / 估算成本，可导出 CSV）
- 图片版本历史（同 prompt 重生成保留旧版，详情面板可切换）

### v2.0（一年左右）
- 项目包导入 / 导出（`.mengbi` 格式）
- 更多语言 locale
- 智能画布更高级特性（实时协作、嵌套子画布、条件连线等架构级能力）

---

## 八、可行性附录（哪些功能写起来不太好落地）

| 功能 | 风险 | 解决方案 |
|------|------|---------|
| 联网搜索（DDG 后备） | DDG 无官方 API，HTML 抓取易触发 CAPTCHA | 多搜索源（Tavily / Serper / Bing），DDG 仅"无 Key 兜底" |
| AI 自动标签 / 描述参考图 | 中转站不一定支持 vision | 配置增加 `supports_vision` 开关，不支持时优雅降级 |
| `better-sqlite3` ABI 不一致 | Electron 28 + Win 经常踩 | 锁版本 + `postinstall` 自动 `electron-rebuild` |
| `safeStorage` 在 dev 模式 | macOS 弹钥匙串、Linux 无 backend 时退化为明文 | dev 用环境变量 `MENGBI_DEV_KEY` 兜底，正式包才走 safeStorage |
| 流式聊天多家协议差异 | Kimi/MiniMax/GLM/DeepSeek 各自 SSE 不同 | `StreamAdapter` 抽象层，每家一个 normalize |
| 图库虚拟滚动 + 瀑布流 | 不等高 + 虚拟是 React 经典难题 | v1.0 用纯网格，v1.5 引入 `@tanstack/react-virtual` |
| 迷你悬浮窗 | 多窗口共享 Zustand 需主进程广播 | Phase 6 才做，初版只有主窗 |
| 视频生成 API | 各家协议差异极大（kling / sora / unified / seedance / veo / runway / fal 各不相同） | 统一「提交 → 轮询 → 下载落盘」抽象 + 供应商适配器（`VideoProviderAdapter` + registry），已落地端到端可用 |
| 智能画布大型节点图 | React Flow 大量节点 + base64 结果易爆内存 | 结果累积集合按节点 FIFO 上限淘汰；结果不进文档持久化；多文档分离存储 |

---

## 九、开发方式声明

本项目按 [`CLAUDE.md`](./CLAUDE.md) 由 **Claude Code** 进行 AI 辅助开发：所有功能拆解、目录结构、IPC 通道命名、数据模型、UI 设计 token 都由该文档约束，开发者复核 + 必要修订。

阶段划分见 [`DEVELOPMENT.md`](./DEVELOPMENT.md)。

---

## 十、术语表

> 给第一次接触本项目的读者准备的统一定义。代码 / UI / 文档**不要**用其他同义词替换。

| 术语 | 定义 |
|------|------|
| **方案（plan）** | 一组配置好的对话 / 绘画 / 视频模型集合，可命名 / 切换。一个用户可有多个方案（例如"工作"/"个人"），见 `api_plans` 表。 |
| **图库** | 集中管理生成 / 导入图片的模块，路由 `/manager`，含相册（手动 / 智能）、标签、评分、备注。提示词管家 UI 已下线，此处固定为图库视图。 |
| **反推** | 给定图片 → 让多模态模型输出近似生成它的提示词。三种格式：完整描述 / 逗号标签 / 风格分析。智能画布的「图像反推」「视频反推」节点复用此能力（视频先抽帧再多图反推）。 |
| **智能画布** | 路由 `/smart-canvas` 的节点式 AI 工作流模块，基于 React Flow，把图片 / 提示词 / 反推 / 生图 / ComfyUI / 视频 / 结果等 17 类节点连成可视化流水线。 |
| **系列（family）** | 图像模型的参数解释方式分类（gpt-image-2 / nano-banana-pro / nano-banana-flash / nano-banana-2 / default），`buildBody` 只发该系列识别的字段。 |
| **视频协议（video_kind）** | 视频供应商的 API 范式：kling / sora / unified / seedance / custom / veo / runway / fal。 |
| **材质氛围（atmosphere）** | 主题系统的第一维度，决定背景质感（沉稳质感 / 朦胧雾感 / 暖石金属 / ...），共 10 种。 |
| **主题配色（palette）** | 主题系统的第二维度，决定主色调（翠 / 紫 / 蔷 / ...），共 10 种。 |
| **方案适配器（StreamAdapter / VisionAdapter / ImageAdapter / SearchAdapter / VideoProviderAdapter）** | 主进程对各家 API 协议差异的封装层，每家一个 normalize 函数。 |
| **Mock 模式** | `MENGBI_MOCK=1` 时所有外部请求走本地夹具，不消耗真 Key，专为开发调试。 |
| **`.mengbi` 包** | 项目数据导出 / 导入用的 zip 格式，含 `manifest.json` + 数据库副本 + 图片。 |
| **软删除** | `prompts` / `images` 的"删除"只置 `deleted_at`，列表查询带 `WHERE deleted_at IS NULL`，30 天后才物理清理。 |

---

## 十一、文档地图

| 文档 | 说明 |
|------|------|
| [README.md](./README.md) | 项目门面 / 快速开始 |
| [WHITEPAPER.md](./WHITEPAPER.md) | 本文，产品视角 |
| [FEATURES.md](./FEATURES.md) | P0 / P1 / P2 功能清单 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 技术架构 / 模块依赖 / 时序图 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 7 个 Phase 的开发节奏 |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | 开发 / 用户 / API 服务环境要求 |
| [THEMING.md](./THEMING.md) | 10×10 主题矩阵 + CSS 变量 |
| [CLAUDE.md](./CLAUDE.md) | AI 开发指令（最权威） |
