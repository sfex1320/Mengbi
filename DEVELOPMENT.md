# 开发节奏与阶段划分

> 本文件给"实施者"看，回答两个问题：
> 1. 我现在在第几阶段？该做什么、不该做什么？
> 2. 当前阶段做完之后怎么验证才能进入下一阶段？

> **进度说明（2026-06-08）**：原计划的 Phase 0~7 **已全部交付**，并在 v1.0 基线之上又落地了一批扩展模块（ComfyUI 工作流编排器、工具箱、智能画布、视频生成、AI 平台底座、画板 Photoshop 联动、相册等，见第十一节）。本文件保留原 7 Phase 体系作为开发节奏的历史脉络，但每个 Phase 的"当前状态"已据实际实现校准；与现役实现冲突的旧表述以本文件最新内容为准。

---

## 一、阶段总表

> 状态列：✅ 已交付 / ⏸ 已下线或休眠 / 🚧 开发中。

| Phase | 目标 | 关键交付 | 依赖 | 验收标准 | 状态 |
|-------|------|---------|------|---------|------|
| **0** 文档完善 | 8 份 md 全部达成"合格线" | 8 份定稿 md | — | 7 条文档质量标准全部满足（见下） | ✅ |
| **1** 骨架与配置 | Electron + Vite + React + 路由 + 主题系统 + 设置页 + DB 初始化 | 可启动应用，能新建/切换"方案"，能保存加密 Key | Phase 0 | `npm run dev` 启动；主题切换可见；设置页保存后 reload 仍在；全部数据表建好（schema_version=15） | ✅ |
| **2** 对话系统 | 多对话 / 流式 / 模型适配器 / 联网 | 能在"方案"内切换模型聊天，搜索后备能用 | Phase 1 | OpenAI 兼容 + Kimi/GLM/DeepSeek/MiniMax 跑通流式；多个搜索后端可用 | ✅ |
| **3** 绘图模块 | 参数表单 / 参考图 / 任务队列 / 批量 / 预设 / family 系列 | 提交一条 prompt 能拿回图，多 prompt 批量入队 | Phase 1, 2 | 任务可取消；并发控制有效；预设可保存加载；family 解决"选 4K 出 1K" | ✅ |
| **4** 图库（提示词管家 UI 已下线） | 网格 / 详情 / 标签 / 评分 / 相册 / 软删除 | 生成的图自动入库；按相册管理 | Phase 3 | 1k 张图滚动不卡；相册切换正常 | ✅（提示词管家 UI ⏸ 休眠） |
| **5** 反推 / 翻译后端 | 反推 / 中英互译 / 历史 | 一张图能反推 | Phase 2, 4 | 反推/翻译可用 | ✅（`/lab` 页面 ⏸ 下线，后端保留） |
| **6** 全局体验 | 快捷键 / 暗色 / 托盘 / 界面缩放 / 卡片导出 / 自定义主题 | 全局体验闭环 | Phase 1-5 | 卡片 PNG 导出含提示词水印；快捷键不与系统冲突 | ✅ |
| **7** 打包与发版 | electron-builder / electron-updater / E2E 自测 | 三平台安装包 + 自动更新通道 | Phase 6 | Windows nsis、macOS dmg、Linux AppImage 各自能装能更新 | ✅ |

> 第十一节列出 v1.0 之后陆续落地的扩展模块（ComfyUI 编排器 / 工具箱 / 智能画布 / 视频生成 / AI 平台底座 / 画板 Photoshop 联动），它们不在原 7 Phase 体系内，但同属现役实现。

---

## 二、Phase 0 验收（文档质量 7 条标准）

> 这 7 条是 `MD-CLEANUP` 计划中定下的硬指标，每份文档都要满足。

1. **结构完整**：无中途截断的代码块、无未闭合围栏、无残留模板序号；
2. **格式规范**：所有代码块带语言标识，ASCII 图在围栏内，表格列对齐；
3. **职责单一**：每份文档主题明确，不与其他文档大段重复；
4. **内部一致**：跨文档术语 / 命名（路由、IPC、表名、主题）完全一致；
5. **与设计图一致**：与 `前端页面设计参考/*.png` 不冲突；
6. **可执行**：技术类文档让未读过项目的开发者可以直接据此动手；
7. **无幻想功能**：列出的功能均经过可行性评估，不可行的标记为 v1.5+。

---

## 三、Phase 1 详细任务（骨架与配置）✅

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 1.1 初始化 Electron 28 + Vite 5 + React 18 工程 | `npm run dev` 启动窗口 | ✅ |
| 1.2 加 TypeScript + ESLint + Prettier | `npm run typecheck` 通过 | ✅ |
| 1.3 路由与左侧导航：现役 6 个顶级入口（`/` Ctrl+1 / `/canvas` Ctrl+2 / `/manager` Ctrl+3 / `/comfyui` Ctrl+4 / `/tools` Ctrl+5 / `/smart-canvas` Ctrl+6）+ `/settings` | 切换无报错，侧栏自上而下一一对应 | ✅ |
| 1.4 左侧导航 + 顶部头像 + 图标 | UI 与设计图相似度 ≥ 70% | ✅ |
| 1.5 `theme.css` 实现 10 atmosphere + 10 palette token；`themeStore` 可切换（含 `appZoom` 界面缩放、`flowColor` 连线流动色） | 切换可见，刷新仍在 | ✅ |
| 1.6 数据库初始化：建全部数据表（见 `CLAUDE.md` §5），`schema_version=15` | sqlite 文件存在，schema 正确 | ✅ |
| 1.7 `safeStorage` 加 / 解密 helper（dev 模式 fallback） | 单元测试通过 | ✅ |
| 1.8 设置页面 UI：方案管理 + 模型配置表单（对话 / 绘画 / 视频三类）+ 测试连通 | 保存后 reload 设置不丢失 | ✅ |
| 1.9 IPC 框架：`api:settings:get/save/test-connection`，handler 返回 `Result<T, AppError>` | 调通往返一次 | ✅ |
| 1.10 **Mock 模式**：`MENGBI_MOCK=1` 时所有 Adapter 走 `electron/ipc/mocks/` 夹具 | 设置页"测连通"在 Mock 模式下永远成功，且不消耗任何 API Key | ✅ |

> 原文 1.3 写的 `/` / `/manager` / `/lab` 三页是 Phase 1 起步形态；现役为 6 个顶级入口，`/lab` 实验室页面已于 2026-06-05 整页下线（详见第五节）。

---

## 四、Phase 2 详细任务（对话系统）✅

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 2.1 `conversations` / `messages` 的 CRUD IPC（`api:chat:*`） | 可新建 / 列出 / 删除 | ✅ |
| 2.2 ChatPanel UI（输入框 + 流式渲染 + Markdown） | 一段流式正常显示 | ✅ |
| 2.3 `StreamAdapter[openai-compat]` | OpenAI / Kimi / DeepSeek 任一跑通 | ✅ |
| 2.4 `StreamAdapter[minimax]` `[glm]` 至少各跑通一家 | 切换无报错 | ✅ |
| 2.5 模型切换 UI（顶部下拉） | 切换后下一轮使用新模型 | ✅ |
| 2.6 联网搜索：多后端（native / ddg / tavily / searxng / bocha / zhipu / jina / serper / off，settings.search_backend 选择） | 至少一种返回结果，`chat:sources` 推参考来源 | ✅ |
| 2.7 上下文持久化（每条消息入库） | 重启后历史还在 | ✅ |
| 2.8 流式取消（`api:chat:cancel`，Esc 触发） | 中途可停 | ✅ |

> 流式通过 `webContents.send` 推送 `chat:chunk` / `chat:done` / `chat:sources`；不攒齐再返回。内嵌本地 LLM（`api:llm:status` / `stop`，基于 node-llama-cpp）属 🚧 开发中，不在本 Phase 验收内。

---

## 五、Phase 3 详细任务（绘图）✅

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 3.1 GeneratorForm UI（提示词 / 比例 / 分辨率 / 参考图） | 与 `绘图前端页面.png` 相似度 ≥ 70% | ✅ |
| 3.2 参考图上传 + 预览 + 删除 | base64 编码不超限 | ✅ |
| 3.3 `ImageAdapter`（`image_kind`：openai / grsai / gemini / openai-compat / comfyui） | 拿到图 + 落盘 + 自动入库 | ✅ |
| 3.4 `TaskQueue` Service（并发控制） | 队列可视化 | ✅ |
| 3.5 任务取消 | 状态机正确 | ✅ |
| 3.6 批量生成（同 prompt N 张 / N prompts × M 张） | 入队顺序正确 | ✅ |
| 3.7 `presets` 表 CRUD + 一键应用 | 保存恢复全部参数 | ✅ |
| 3.8 多模态：AI 描述参考图（依赖 `supports_vision`） | 不支持时 UI 灰显 | ✅ |
| 3.9 图像模型 **family 系列一等公民**（`src/types/imageModelFamilies.ts`，5 个 family）+ 请求体覆盖 `body_overrides_json`（`electron/ipc/imageBody.ts`） | family.buildBody 只发该系列识别字段；解决"选 4K 出 1K"；占位符整串替换 + null 删字段 | ✅ |

> 落盘命名严格 `{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png`，缩略图 `{date}/.thumbs/{taskId}-{seq:02d}.webp`。family / imageBody 是 `npm test`（vitest）的核心覆盖对象。

---

## 六、Phase 4 详细任务（图库；提示词管家 UI 已下线）✅

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 4.1 五大内置分类（图片 / 视频 / 提问 / 文档 / 收藏）的 schema 与种子数据 | 数据层保留 | ⏸ 休眠（管家 UI 下线，`prompt_categories` 表与 `api:prompt:*` 保留） |
| 4.2 `images` 自动入库 | 生图后立即出现 | ✅ |
| 4.3 GalleryGrid（v1.0 用 CSS Grid，纯网格） | 1k 图滚动 FPS ≥ 50 | ✅ |
| 4.4 详情面板（提示词 / 参数 / 参考图） | 可复制可填回 | ✅ |
| 4.5 评分 / 备注 / 手动标签 | 持久化 | ✅ |
| 4.6 PromptCard 组件 + 关联图片 | — | ⏸ 休眠（提示词管家 UI 已下线） |
| 4.7 跨模块联动按钮（"发送到生图 / 智能画布"等） | 跳转携带数据 | ✅ |
| 4.8 手动相册 + 智能相册（`albums` 表 manual/smart，`api:album:*`；智能相册按 smart_rules 实时匹配） | 智能相册热更新 | ✅ |
| 4.9 软删除（`images` / `prompts` 删除只置 `deleted_at`，列表带 `WHERE deleted_at IS NULL`，30 天后物理清理） | 回收站可恢复 | ✅ |

> **2026-06-05 模块精简**：提示词管家 UI 整体下线，`/manager` 固定为图库视图 + 相册侧栏；`prompts` / `prompt_categories` 表与 `api:prompt:*` 通道保留为休眠态（未来可复活，遵循同一软删除哲学）。

---

## 七、Phase 5 详细任务（反推 / 翻译后端；`/lab` 页面已下线）⏸

> **2026-06-05**：实验室作为**独立页面已整体下线**（删 `Laboratory/` 页 + labStore + 侧栏入口 + 路由）。但 `electron/ipc/lab.ts` 的 `api:lab:reverse` / `api:lab:translate` 后端**保留为共享服务**——智能画布的 LLM 节点、图像反推节点、视频反推节点都复用 `api:lab:reverse`，这是有意保留的共享后端，不是死代码。原计划的"拆解 / 多模型对比 / 融合"早于 2026-06-05 移除，不要复活旧桩。

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 5.1 单图反推（`api:lab:reverse`） | 至少一种格式有结果 | ✅ 后端保留（页面已下线） |
| 5.2 中英互译（`api:lab:translate`） | 双向往返语义不失真 | ✅ 后端保留（暂无 UI 入口，休眠） |
| 5.3 多图融合反推（多图 `api:lab:reverse`） | 2~5 张图能合成一段 | ✅ 后端保留（智能画布视频反推抽帧后多图反推复用） |
| 5.4 提示词拆解六要素 | — | ⏸ 已移除 |
| 5.5 `prompt_lab_history` 表 | 每个工具独立 history | ✅ 表保留（`api:lab:history` 休眠） |
| 5.6（P2）多模型对比 / 双提示词融合 | — | ⏸ 已移除 |

---

## 八、Phase 6 详细任务（全局体验）✅

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 6.1 全局快捷键（路由 Ctrl+1~6 + 自定义 `keybindings_json`） | 不与系统快捷键冲突 | ✅ |
| 6.2 系统托盘 + 进度角标 | 任务进行中数字会变 | ✅ |
| 6.3 迷你悬浮窗（P2） | — | ⏸ 推迟（v1.0 范围外） |
| 6.4 作品卡片导出 PNG（`api:export:card`） | 含提示词水印 | ✅ |
| 6.5 自定义主题（`themes` 表，`api:theme:save` / `list`） | 保存后下拉可选 | ✅ |
| 6.6 界面缩放（Ctrl+= / Ctrl+- / Ctrl+0，`themeStore.appZoom` 持久化，preload `webFrame` 套用；`/canvas` 放行给画板自身缩放） | 缩放生效且重启保留 | ✅ |

> 右下角彩蛋"带你吃火锅儿"已**取消**，任何 UI 不得再现。Slogan 仅"梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱"。

---

## 九、Phase 7 详细任务（发版）✅

| 子任务 | 验收 | 状态 |
|-------|------|------|
| 7.1 `electron-builder.yml` 三平台配置（含 `asarUnpack`：sharp / ffmpeg-static 等 native 解包） | 三平台均可打包 | ✅ |
| 7.2 NSIS 安装器（Win） / DMG（macOS）/ AppImage（Linux） | 三平台均可安装 | ✅ |
| 7.3 `electron-updater` + GitHub Releases 通道 | 升级流程可见 | ✅ |
| 7.4 E2E 自测清单（手动 30 项） | 全过 | ✅ |
| 7.5 README + WHITEPAPER 同步更新版本号 | 一致 | ✅ |
| 7.6 v1.0 Tag + Release Notes | GitHub 上发布 | ✅ |

### 9.1 发版命令链（Phase 7 落地后）

```bash
npm run typecheck
npm run lint
npm run build           # vite 产物
npm run package:win     # electron-builder --win
npm run package:mac     # electron-builder --mac
npm run package:linux   # electron-builder --linux
# CI 上传 release/* 到 GitHub Release
```

### 9.2 更新通道分级（C5）

`electron-updater` 支持多通道。本项目采用三档：

| 通道 | 触发 | 受众 | 默认开启 |
|------|------|------|---------|
| `stable` | 打 `v1.0.0` 这类无 pre-release 的 tag | 全部用户 | ✅ |
| `beta` | 打 `v1.0.0-beta.1` tag | 设置页勾选"加入 Beta 通道"的用户 | ❌ |
| `canary` | CI 在 main 分支每次 push 后自动构建 | 仅开发者机器（环境变量 `MENGBI_CANARY=1`） | ❌ |

实现要点：

- `electron-builder.yml` 的 `publish` 段配 GitHub Release，`releaseType` 由 tag 名称决定；
- `app-update.yml` 在打包时由不同通道写入不同的 `channel` 字段；
- 用户切换通道时不立刻下载，仅影响下次检查；
- 降级（从 beta 回到 stable）需用户主动卸载重装，应用本身不做版本"回滚"。

---

## 十、阶段间通用规则

1. **每阶段开始前**先看 `CLAUDE.md` 是否有更新（`CLAUDE.md` 为唯一最权威指令）；
2. **每阶段结束后**用本文件第二节的 7 条标准重审本阶段产出的文档/代码；
3. **任何与文档冲突的实现都视为 bug**，先改实现；如果文档错了，**先改文档再改代码**；
4. P2 功能默认**不开工**，除非该阶段所有 P0 / P1 已完成且时间还有富余；
5. 改动到"参数流"纯函数（family `buildBody` / `imageBody.ts` 的 `resolveSize` / `applyBodyOverrides` / `videoProviders` / video adapter）时，`npm test`（vitest，当前约 94 例）必须通过。

---

## 十一、v1.0 之后落地的扩展模块（不在原 7 Phase 体系内）

> 以下均为 v1.0 基线之上陆续交付的现役模块。详细规范以 `CLAUDE.md` 为准，本节只给开发节奏脉络与状态。

### 11.1 ComfyUI 工作流编排器（`/comfyui`，Ctrl+4）✅

连接本地 ComfyUI、导入 API 格式 workflow、可视化绑定、批量循环的完整外部控制器。与生图页 `image_kind='comfyui'` 的"一键直跑"是**有意保留的双轨**（深度编排 vs 一键），不要合并。

- IPC：`api:comfyui:get-config/set-config/scan-launch/detect/status/start/stop/import/template:* /run-single/cancel/run-status/results:get`；选 ComfyUI 文件夹自动识别启动命令（`launchScanner`，纯读目录不执行）。
- push 通道：`comfyui:status` / `comfyui:run-progress` / `comfyui:run-done` / `comfyui:queue`；进度优先 `ws://`，回退 `/history` 轮询。
- DB：schema v14 加 `comfyui_workflow_templates` / `comfyui_runs`。
- 新增依赖：`@xyflow/react`（节点图）、`ws`、`expr-eval`（安全公式循环，无 eval）。
- 架构铁律：不写死 node_id / 不限工作流类型；每次运行 `structuredClone` 原始 workflow，绝不污染模板。

### 11.2 工具箱（`/tools`，Ctrl+5，本地处理）✅

- **Real-ESRGAN ncnn Vulkan**（保真放大，默认）：`api:upscale:*`，调外部可执行文件，stderr 解析进度。
- **图像转矢量**：`api:vec:*`，两种 CPU 模式——VTracer（`@neplex/vectorizer`，Rust 彩色）/ Potrace（`potrace`，JS 单色），用户明确选；历史落 `vectorize_history` 表。
- **视频插帧**：`api:interp:*`，本地 rife-ncnn-vulkan AI 运动插帧（ffmpeg 拆帧 → RIFE → 合帧带回音轨），引擎按需下载 ~40MB。
- **已移除**：SUPIR 放大（2026-05-29，显存 25-30GB 带不动）、HYPIR AI 修复放大、OmniSVG AI 矢量化（2026-05-27）。

### 11.3 智能画布（`/smart-canvas`，Ctrl+6）✅

基于 `@xyflow/react`（React Flow v12）的 AI 创作节点图，**17 类节点**（`SmartNodeKind`）：image 图片 / prompt 提示词 / text 文字 / llm LLM / image-reverse 图像反推 / angle-prompt 视角 / light 光源 / scale 缩放 / ratio 尺寸分析 / work 生图 / comfy ComfyUI / video-source 视频上传 / video 视频 / video-reverse 视频反推 / result 结果 / compare 对比 / group 分组。

- 能力：多文档（launcher-first 启动页 + 工具栏画布菜单切换，localStorage 持久化）、撤销/重做、复制/粘贴/再制、运行全部（拓扑串行）、节点搜索、连线流动着色、网格吸附 + 对齐参考线、智能排布、分组容器、跨模块"发送到智能画布"、结果累积集合、在途任务跨文档回灌。
- 复用现有 IPC（零新增 IPC 为主，仅视频缩放新增 `api:video:scale`）：生图节点复用 `api:image:generate` / `api:upscale:run-single`；LLM 节点复用 `api:chat:optimize-prompt` + `api:lab:reverse`；ComfyUI 节点复用 `api:comfyui:run-single` + `template:get`；图像/视频反推复用 `api:lab:reverse`；缩放接视频走 `api:video:scale`（ffmpeg 重编码）。
- 智能画布**不含任何 Claude Code / 命令执行**。

### 11.4 视频生成（2026-06-07 接入，端到端可用）✅

原"v1.0 不做视频生成"的铁律已解除。范式：**异步「提交任务 → 轮询状态 → 下载 mp4 落盘 → 入图库」**。

- 配置：`api_configs.type='video'` + `video_kind ∈ kling | sora | unified | seedance | custom | veo | runway | fal`（schema v15 加 `video_kind` 列）。
- 引擎：kling/sora/unified 走 `electron/ipc/video.ts` 内置 legacy 引擎；seedance/custom/veo/runway/fal 走 `electron/services/video/` 适配器（`VideoProviderAdapter` 接口 + registry）。
- IPC：`api:video:generate` / `cancel` / `upload-asset` / `save-thumbnail` / `scale`；push 通道 `video:progress` / `video:done`。
- 配置中心：settings 表 `video_providers_json`（端点 / capabilities / limits / 默认参数 / 费用阈值），渲染端 `videoProvidersStore` + `videoHistoryStore` + 设置页 `VideoProvidersCenter`。
- 共享层：`@shared/video`（`VideoGenerationRequest` / `VideoTask` / 7 模式 + `validateVideoRequest` / `estimateVideoCost`）+ `@shared/videoProviders`。
- 智能画布"视频"节点 = 真实生成（非 mock），7 模式按能力自适应 + 费用预估 + dry-run 校验 + 高费用二次确认 + 批量 + 连续生成。
- 新增依赖：`ffmpeg-static`（视频缩放，electron-builder `asarUnpack` 解包）。视频提示词的"纯文本管理"仍保留（图库/管家不变）。

### 11.5 画板 Photoshop 联动（`api:ps:*`）✅

画板其余能力全在渲染进程内（图层 / 蒙版 / 透视 / 裁切 / 调色 / 扩图 / 抠图 / 局部重绘 / 工程文件），**唯独 Photoshop 联动**需落盘临时文件 + `fs.watchFile` 监听用户保存，因此是画板的第一个主进程 IPC 子系统。push 通道 `ps:file-changed`。

### 11.6 本地 LLM（`api:llm:status` / `stop`）🚧

基于 `node-llama-cpp` 的内嵌本地推理服务，开发中。不暴露 start（由 chat handler 内部按需 lazy 启动）；模型选择 / 推理参数面板 / 缓存策略尚未实现。

---

## 十二、当前阶段

> 原计划 **Phase 0~7 已全部交付**（v1.0 基线达成）。当前处于 **v1.0 之后的持续演进期**：在基线之上已落地 ComfyUI 编排器、工具箱、智能画布（17 类节点）、视频生成、AI 平台底座、画板 Photoshop 联动等扩展模块（见第十一节），并持续按需打磨 / 修 bug / 校准文档。
>
> 收到"开始"或"继续"时，从用户指定的当前任务推进；不要再新增 Phase 体系，扩展模块按其各自的演进脉络迭代即可。
