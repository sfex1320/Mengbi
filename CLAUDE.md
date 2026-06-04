# CLAUDE.md — 梦笔（mengbi）项目 AI 开发规范

> 这是 Claude Code 在本仓库进行代码生成时的**最权威**指令。任何与本文件冲突的描述，都以本文件为准。
> 当本文件与实现冲突时，**先改实现**；当本文件本身需要修订时，先讨论后修订，不要在代码里偷偷漂移。

---

## 0. 项目身份

| 项 | 值 |
|----|----|
| 名称 | 梦笔（mengbi）绘画工具箱 |
| 类型 | Electron 跨平台桌面应用 |
| Slogan | **梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱** |
| 默认主题 | `atmosphere=deep-quiet`（沉稳质感）× `palette=warm-orange`（暖橘） |
| 仓库根目录 | `c:\Users\96311\Desktop\梦笔（mengbi）绘画工具箱\` |

> **注意**：右下角彩蛋"带你吃火锅儿"已**取消**，不要在任何 UI 中再现。Slogan 仅用上方那一句。

---

## 1. 技术栈（严格遵循）

| 层级 | 技术 |
|------|------|
| 桌面容器 | Electron 28+ |
| 前端框架 | React 18 + TypeScript + Vite 5 |
| 状态管理 | Zustand 4 |
| 动效 | Framer Motion 11 |
| 主进程 | Node.js（Electron Main） + Express 风格 IPC 路由 |
| 数据库 | better-sqlite3 11（同步 API） |
| 安全 | Electron `safeStorage` 加密 API Key |
| 打包 | electron-builder 24 |
| 更新 | electron-updater 6 |
| 校验 | zod（IPC 入参校验） |

详细版本锁定与原因见 [`ENVIRONMENT.md`](./ENVIRONMENT.md) 第六节。

---

## 2. 项目目录结构（必须遵守）

```
mengbi/
├── electron/
│   ├── main.ts             # 主进程入口：创建窗口、注册 IPC、托盘
│   ├── preload.ts          # contextBridge 仅暴露白名单 IPC API
│   ├── ipc/
│   │   ├── index.ts        # 注册所有 IPC handler
│   │   ├── chat.ts         # api:chat:* 对话与流式
│   │   ├── generate.ts     # api:image:* 绘图与任务队列
│   │   ├── gallery.ts      # api:gallery:* / api:prompt:* 提示词管家
│   │   ├── settings.ts     # api:settings:* 方案与模型配置
│   │   ├── lab.ts          # api:lab:* 实验室
│   │   ├── aiFeature.ts    # api:ai-feature:* 通用 AI 功能管理（list/install/start/stop）
│   │   ├── aiModel.ts      # api:ai-model:* 通用模型注册表查询
│   │   └── hypir.ts        # api:hypir:* HYPIR-specific 提交任务（delegate 到 ai-platform）
│   │   # SUPIR 已于 2026-05-29 整体砍除(显存需求 25-30 GB,常见配置带不动)
│   └── services/
│       ├── ai-platform/    # 通用 AI 底座（sidecarManager / modelRegistry / featureRegistry / installManager）
│       └── ai-features/    # 每个 AI 功能的 FeatureSpec + 请求体构造器 + 错误码映射
├── src/
│   ├── assets/             # 静态资源、图标
│   ├── components/         # 通用组件（Button、Card、ChatBubble 等）
│   ├── pages/
│   │   ├── Create/         # 生图模块（路由 `/`）
│   │   ├── Manager/        # 提示词管家 + 图库（路由 `/manager`）
│   │   ├── Laboratory/     # 实验室（路由 `/lab`）
│   │   ├── Canvas/         # 画板（路由 `/canvas`，有界，多图层 + 变换 + 抠图 + 透视）
│   │   │   ├── canvasEngine/   # perspective / exportPNG / thumbnail 等纯函数
│   │   ├── ComfyUI/        # ComfyUI 工作流编排器（路由 `/comfyui`）
│   │   ├── Tools/          # 工具箱（路由 `/tools`，保真放大 + AI 修复 + 图像转矢量）
│   │   └── SmartCanvas/    # 智能画布（路由 `/smart-canvas`，AI 创作节点图，React Flow）
│   │       └── nodes/          # 图片/提示词/LLM/视角/缩放/比例/生成/ComfyUI/结果/分组 十类自定义节点 + NodeShell
│   ├── store/              # Zustand stores（themeStore / conversationStore / ...）
│   ├── hooks/              # 通用 hooks
│   ├── types/              # 跨进程共享 TS 类型（IPC 入参/响应、AppError、各 ParamSchema）
│   ├── styles/
│   │   └── theme.css       # 7 + 10 套主题 token，全局样式
│   └── App.tsx
├── resources/              # 应用图标、托盘图、安装器图
├── 前端页面设计参考/        # 设计稿（不要修改）
├── package.json
├── electron-builder.yml
├── tsconfig.json
└── vite.config.ts
```

**禁止**新增顶级目录除非本文件先更新。

---

## 3. 前端路由

| 路径 | 快捷键 | 模块 | 入口文件 |
|------|--------|------|---------|
| `/` | Ctrl+1 | 生图（对话 + 绘图） | `src/pages/Create/index.tsx` |
| `/canvas` | Ctrl+2 | 画板（有界，多图层 + 笔刷 + 蒙版） | `src/pages/Canvas/index.tsx` |
| `/manager` | Ctrl+3 | 提示词管家（含图库） | `src/pages/Manager/index.tsx` |
| `/comfyui` | Ctrl+4 | ComfyUI 工作流编排器 | `src/pages/ComfyUI/index.tsx` |
| `/tools` | Ctrl+5 | 工具箱（保真放大 + AI 修复 + 图像转矢量,本地处理） | `src/pages/Tools/index.tsx` |
| `/lab` | Ctrl+6 | 提示词实验室 | `src/pages/Laboratory/index.tsx` |
| `/smart-canvas` | Ctrl+7 | 智能画布（AI 工作流 / 节点图，React Flow） | `src/pages/SmartCanvas/index.tsx` |

> **当前 7 个顶级入口**（外加设置 `/settings`），与左侧侧栏自上而下一一对应。
> 「智能画布」`/smart-canvas`（React Flow 节点图：图片/提示词/LLM/工作/ComfyUI/结果/分组节点 + 连线 + 运行）是独立节点编排模块。智能画布**不含任何 Claude Code/命令执行**；工作节点 provider 两档：`mengbi`（图片生成/编辑/风格/扩图复用 `api:image:generate`，含 family 自适应 比例/分辨率/质量 + 真实 batch/loop 多轮；放大复用 `api:upscale:run-single`）/ `mock`（Local Mock；视频生成 v1.0 不接入，走模拟）。结果图可一键入图库（`api:gallery:import-from-buffer`）/ 另存（`api:storage:save-as`）。连线类型校验：结果节点只接 工作/ComfyUI 输出。**LLM 节点**=文本模型（优化提示词/翻译/扩写/细节分解/对话完善/图片反推），复用 `api:chat:optimize-prompt` + `api:lab:reverse`，输出文本喂下游。**ComfyUI 节点**=整个工作流当黑盒（参数全在「工作流」页调好），复用 `api:comfyui:run-single` + `template:get`；画布里**只做输入/输出拆分**——上游提示词→第一个文本控件、上游图片→图片控件（file_upload 绑定由运行引擎自动上传），其余控件用工作流默认值（applyBindings 留空不覆盖），结果经 `comfyui:run-done` 取回。**分组**=容器化（拖节点进框自动归入 React Flow parentId，整组作下游输入）。**创建**：工具栏点选类型→点画布落位（武装态）；从节点拖出连线落空白 / 双击画布→快捷创建菜单（拖出可建下游节点并自动连线）。**连线**有中点 × 圆钮可删（DeletableEdge）。**排布**：网格(列数+间距)/按类型分组/对齐选中(左中右上中下)/横纵均分（只动顶层非分组节点）。**多文档**：进入 `/smart-canvas` 先到「选择画布」启动页（`CanvasLauncher`，launcher-first）—— 新建/打开/重命名/删除多张智能画布，最近修改在前；打开后进工作区，工具栏左侧「画布菜单」按钮可随时切回启动页 + 内联改名。文档元数据存 localStorage `mengbi.smartCanvas.docs.v1`（`useSmartDocsStore`），每张画布内容单独存 `mengbi.smartCanvas.doc.<id>`（`lib/smartDocStorage.ts`，`CanvasWorkspace` 挂载时 load、改动 500ms 去抖写回；旧单文档 `mengbi.smartCanvas.v1` 首次进入自动迁移成「我的画布」卡片）。`useSmartCanvasStore` 本身不再持久化，只作当前文档的工作缓冲区。右下角小地图（MiniMap）按节点类型上色实时呈现全画布。**撤销/重做**（Ctrl+Z/Ctrl+Shift+Z，结构改动+拖动手势进栈、上限 50；文本编辑走输入框原生撤销不进栈）、**复制/粘贴/再制节点**（Ctrl+C/V/D，模块级剪贴板跨文档有效、重映射内部连线）。**工作节点**支持负向提示词 + seed（空=随机/loop 按轮 +1；文生图经 generate.ts 在 buildBody 后透传 seed，图生图走 FormData seed）。**在途任务跨文档不丢**：work/comfy 提交时记 docId，结果回来若已切走画布则回灌该文档存储（`patchDocNodes`），不污染当前文档。localStorage 写入配额超限有 toast 预警。**跨模块打通**：图库/生图结果/工具箱结果/ComfyUI 输出的右键菜单都有「发送到智能画布」→ 推入 `useSmartInboxStore` + 跳 `/smart-canvas`，进入后加成图片节点（无打开画布则新建「导入素材」）；图片节点支持「从图库选图」（`GalleryPickerDialog` 复用 `api:gallery:list`）；结果块/结果节点可「作参考图」发回生图页（`imageParamsStore.addRefs`）+「入图库/另存」（`nodeArea` 共享 `imageToGallery`/`imageSaveAs`）。**运行全部**（工具栏「运行全部」按拓扑顺序串行跑全图 work/comfy/llm 节点，进度 `useSmartRunStore` 显示 N/total + 停止=软停只断后续）。**分组可折叠**（`toggleGroupCollapse` 隐藏子节点+相关连线、收起组高度）。**复制画布**（启动页卡片悬浮「复制」→ `duplicateDoc` 克隆元数据+内容）。**节点搜索**（Ctrl+F `NodeSearch` 按类型/文字命中 → setCenter 居中并 `selectOnly` 高亮）。**非法连线提示**（落在节点上但被拒 → toast 具体原因）。**生成超时兜底**（`generateOnce` 180s 未返回则置错+清 pending，不卡 running）。画板图层右键也有「发送到智能画布」（5 个图片来源全部打通）。
> **2026-06-03 体验大改**：① 工作节点 UI 改名「**生成**」（type 仍 'work'）。② **进入不再回启动页**——`activeDocId` 改 session 态（不持久化、不再 mount setActive(null)）：切功能再回来停在当前画布，重启才回启动页。③ **拖入**：多图拖到画布 → 自动建分组容器网格铺入（`dropImages`）；文字拖入 → 自动建提示词节点。④ **排布按拓扑序**（`topoSorted`，生成在前结果在后，不打乱流向）。⑤ **结果节点=累积集合**：每次结果累加，`useSmartResultStore`（内存态、不进文档、重启清空；`sanitize` 剥离 result 持久化；**每节点上限 `MAX_RESULTS_PER_NODE=100`，超出 FIFO 淘汰最旧的，挡长会话 base64 爆内存**）。⑥ **ComfyUI 节点改回可调**：选模板后检查器渲染暴露控件可编辑（`renderComfyControl`），`controlValues` 随运行发出（上游仍覆盖输入槽）。⑦ **右侧检查器可收起**（`inspectorCollapsed`）。⑧ **底部备注两段**：左=选中节点能做什么（随类型变）、右=快捷键。⑨ **分组**改实线卡片+「N 项」徽章+拖入自动扩容（`setNodeParent` grow）。⑩ **连接口**=纵贯节点高度的箭头轨（`.mb-sc-handle` ::before 轨 + ::after ❯）。⑪ **连线彩色流动**（`@keyframes mb-sc-flow-move` dash 动画，色 `var(--mb-sc-flow)`，外观设置可调，默认跟随 accent；themeStore.flowColor）。⑫ 排布弹窗加图标加宽；快捷键弹窗 portal 到 body 居中（避 transform 错位）。css 前缀 `mb-sc-*`。所有节点零新 IPC（复用现有通道）。
> **2026-06-03 续**：① **多选群组**——选 ≥2 个顶层非分组节点，右键「群组所选」或 Ctrl+G（`groupSelection`）→ 建分组容器并把子节点网格自动排布进框（`onSelectionContextMenu`/`onNodeContextMenu`，单节点右键给删除/解散分组）。② **视角上下拖修正**——预览拖动垂直方向取负（上拖→俯视、下拖→仰视），左右不变。③ **生成失败可重试**——生成节点新增「取消」按钮（运行中显示，`cancelWork`：abort 上游任务释放并发槽 + 重置 idle，解决拥挤模型挂住槽位后第二三次点运行无反应）+ 节点上内联显示错误文案（原先只有「失败」徽章看不到原因）；`generateOnce` 新增 `onTask` 回调把 taskId 记到节点供取消。④ **结果节点扩容**——`WorkResult` 加 `texts?`/`videos?`；结果节点支持 图/文本/视频 三类展示，每项可**拖出成节点**（图→图片节点 / 文本→提示词节点，走 `application/mengbi-sc-node` 拖拽载荷 + 画布 `onDrop` 落位），并新增**输出口**可继续连下游（result 进 `PRODUCERS`/`IMAGE_SOURCES`；LLM 文本经 `pushTextDownstream` 汇入结果节点）；清空累积同时清 `data.result` 避免下游读旧值。零新 IPC（取消复用 `api:image:cancel`）。
> **2026-06-03 增强版（蓝图 9 项）**：① **多画布标签栏**（`SmartTabs`：`useSmartDocsStore.openIds` 会话态 + `lib/smartDocStorage.switchDoc/closeDocTab/backToLauncher/saveCurrentDoc`；切标签先存当前文档再载目标再 setActive，`CanvasWorkspace` 卸载 cleanup 加守卫「仅当本文档仍 active 才落盘」防切换互写）。② **连线增强**（`useSmartViewStore` 持久化偏好：曲线/直线/折线 `getBezier/Straight/SmoothStepPath` + 箭头 `MarkerType.ArrowClosed` + 按上游运行状态着色 idle灰/running强调/success绿/error红；仅源节点有 status 的连线着色，其余保留流动色；`ViewPrefsPanel` 外观弹窗）。③ **网格吸附 + 对齐参考线**（RF `snapToGrid`/`snapGrid` + `onNodeDrag` 算与其它顶层节点左/中/右·上/中/下对齐 → `ViewportPortal` 画参考线）。④ **方向键微调**（`nudgeSelected`，Shift=10px，连续微调只进一次撤销栈）。⑤ **节点标签/注释 + 颜色**（`NodeMeta` 基类 label/labelColor 加到全部节点 data；`NodeShell` 渲染彩条；检查器标签块 + 6 色 swatch）。⑥ **运行 loading 动画**（`.mb-sc-spinner` 转圈 + 状态徽章 + 运行按钮）。⑦ **Mock 真实化**（work provider=mock 可配 `mockDelayMin/Max`/`mockErrorRate` 随机延迟 + 随机失败注入）。⑧ **节点模板**（`useSmartTemplateStore` 持久化 + `captureSelection`/`insertNodes`；`TemplatePanel` 存选区为模板 + 一键插画布中心；存模板 `sanitizeTemplateNode` 剥运行态）。⑨ **运行日志导出**（`nodeArea.exportTextFile` → `api:storage:save-as` 写 txt；work/comfy/llm 检查器「导出日志」）+ **属性修改进 Undo**（`beginEdit`/`commitEdit` 聚焦快照失焦压栈，wire 到提示词/输入文本/标签字段）+ **搜索筛选 dim**（`useSmartCanvasUiStore.dimFilter` 由 `NodeSearch` 驱动 → 画布不匹配节点 `.mb-sc-dim` 变暗）。零新 IPC（日志导出复用 `api:storage:save-as`）。**未做（架构/规模/v1.0 范围外，已在总结说明）**：实时多人协作（需服务端）、完整插件运行时、自定义节点类型运行逻辑、PSD/SVG 导出、可独立运行的嵌套子画布、跨画布数据引用、条件连线。
> **2026-06-03 增强版续（8 项）**：① **智能排布**（排布弹窗顶部按钮 → `arrangeSmart(gap)`：按连线识别工作流走向，最长路径分层、**上游在左→下游在右**列布局，层内按上游 barycenter 减交叉、整列纵向居中；只动顶层非分组节点）。② **Ctrl 框选接触即选**（`selectionMode={SelectionMode.Partial}`，框碰到即选）。③ **运行计时**（`WorkResult.durationMs`：runWorkNode `t0`+`place()` 包装注入耗时 / ComfyUI `pendingComfy.startedAt`→routeComfyDone / LLM logs `用时`；结果区显示「用时 X.Xs」）。④ **去掉结果「入图库」按钮**（生成结果经 `api:image:generate` 已自动 INSERT INTO images 入库，故 `ResultActionsBlock` 与结果节点右键去掉入库，仅留 另存/作参考图）。⑤ **实际分辨率**（`MeasuredThumb` 组件 img onLoad 量 naturalW×H 角标，用于结果/工作/Comfy 网格缩略；ImageNode 量+持久化 naturalW/H + 左下角标）。⑥ **比例「自动」**（检查器比例首项「未指定」改「自动」：文生图=不发让模型定；图片编辑类=runner `measureAspect()` 量输入图比例吸附到最近常用比例发出）。⑦ **入库缩略图全链路已确认**（generate.ts/tools.ts import-from-buffer/comfyui gallerySync 三处 INSERT 都 `ensureThumbnail`；`api:gallery:list` 还有 `enqueueBackfill` 懒补；Manager 封面 `thumbnail_path||file_path`——无需改）。零新 IPC。
> **2026-06-03 增强版三（节点扩到十类 + 14 项）**：① **新节点「缩放/预处理」**（`scale`：倍数/最长边/最短边/宽高/限制框/像素/精确 + 等比/仅缩小，`lib/imageScale.ts` canvas 实时缩放输出图喂下游，**非高清化**；outputImage 不持久化、重开重算）。② **新节点「比例分析」**（`ratio`：接图显示最近常用比例 + 1K/2K/4K 实际分辨率 + GPT 像素预算；纯展示不输出）。③ **智能排布**（`arrangeSmart`：最长路径分层、上游左→下游右、barycenter 减交叉、整列居中）。④ **Ctrl 框选接触即选**（`selectionMode=Partial`）。⑤ **运行计时**（`WorkResult.durationMs`，结果区「用时 X.Xs」）。⑥ **去结果「入图库」**（生成已自动入库；入库缩略图全链路已确认：三处 INSERT 都 `ensureThumbnail` + `gallery:list` 懒补 `enqueueBackfill`）。⑦ **实际分辨率角标**（`MeasuredThumb` + ImageNode 持久化 naturalW/H）。⑧ **比例「自动」**（文生图=模型定；图片编辑=`measureAspect` 跟随输入图比例）。⑨ **提示词节点默认高度×3** + **新建即自动选中**（addNode selected）。⑩ **缩放交互改**（NodeResizer 全节点常显、隐 4 角点、边线可抓、悬停/选中整圈高亮代替点框）。⑪ **外观/快捷键** 移到左下 Controls（排布下）。⑫ **聊天**：输入区加高可拖大 + 气泡右键选段复制/建提示词节点 + **上游图→attachedImages 多模态识图**；LLM/结果**长文本放大查看**（`SmartTextViewer`+`useSmartTextStore`）。⑬ **分组→ComfyUI** 多提示词分发到多文本控件；**分组→结果** 组合预览（result 现接 图片/提示词/分组/缩放/视角 做实时 computeUpstream 预览，图预览仅在无累积结果时显示避免重复）。⑭ **取消立即停止**（`abortRunAll` 终止当前在跑节点 work→cancelWork/comfy→`cancelComfy`+`comfyui.cancel`；ComfyNode 加取消按钮）。⑮ **图库删除跨功能同步**（`useDeletedMediaStore` 渲染端总线 → `pruneDeletedImages` 从智能画布结果剔除）。零新 IPC。
> **2026-06-03 增强版四（6 项）**：① **提示词跨模块入画布**——图库图右键加「发送提示词到智能画布」、提示词卡片右键加「发送到智能画布」；`SmartInboxItem` 扩 `kind:'image'|'prompt'`+`text?`（src 改可选），`SmartCanvas/index.tsx` 消费时 prompt→提示词节点 / image→图片节点。② **「比例」节点改名「尺寸分析」**（type 仍 `ratio`；改 CanvasToolbar/CreateMenu/NodeSearch/RatioNode title/NodeInspector note/keybind 全部用户可见串）。③ **缩放节点数字输入不再卡 min**——新 `ClampNumberInput`（NodeInspector，本地 string 态，编辑自由输入、失焦/回车才 clamp 提交）替换 edge/fitW/fitH 的「每次按键即 `Math.max(16,…)`」。④ **缩放流畅化**——ScaleNode 缓存源图（imgRef 按 src 复用，不重复 decode）+ 尺寸标注立即跟手 + canvas 编码去抖 220ms。⑤ **画板→智能画布多格式**——`contextMenu.ts` 图层「发送到智能画布」改 PNG/JPEG/WebP 子菜单（`canvasToDataUri(c,format)`）+ 画布空白菜单加「整张发送到智能画布」（`compositeToSmartCanvas` 合成可见图层）。⑥ **智能画布批量保存/导入**——`smartDocStorage.exportDocsBundle`（全部画布打包成一个 `.json` 浏览器下载，format `mengbi-smart-canvas-bundle`）/ `importDocsFromText`（吃批量包或单画布 `.json` 各新建文档）；启动页 `CanvasLauncher` 加「批量导出」「导入画布」（multiple file input）。**软件「所有配置」导出/导入已存在**（`electron/ipc/configIO.ts` + 设置「存储与系统」`ConfigIOSection`：方案+API Key+外观+设置+提示词，AES-256-GCM 加密），本轮未改。零新 IPC。
> **2026-06-03 增强版五**：**文本输出节点统一「→ 提示词节点」**——LLM / 视角 / ComfyUI / 结果 这些能输出文字的节点，输出文本都可一键导入下游提示词节点。`nodeArea.makePromptNodeFrom(sourceId, text)` 抽公共助手（源右侧建 prompt 节点+填文本+选中+toast，空文本提示）；LlmNode 既有「用输出建提示词节点」改走它；AnglePromptNode 生成提示词区加右键菜单 + 「→ 提示词节点」按钮；ComfyNode 新增**文本输出展示**（点放大 / 右键复制·建提示词节点·放大）+「→ 提示词节点」按钮。**ComfyUI 文本输出全链路打通**：`routeComfyDone` 从 `outputFiles` 收 `kind==='text'` 进 `WorkResult.texts`（原先只收 image 丢弃文本）；`computeUpstream` 的 comfy 分支补 `r.texts` → 当上游提示词喂下游。css `.mb-sc-toprompt`。零新 IPC。
> **2026-06-03 增强版六（7 项）**：① **连线插入节点**——「武装」某类型后点连线 → 把新节点插入该连线（删原线，连 上游→新→下游）；store `insertNodeOnEdge(kind,pos,edgeId)`，CanvasViewport `onEdgeClick`（类型不兼容则直接落在点击处 + toast）；连线校验抽 `canConnectKinds(sk,tk)` 纯类型版（isValidConnection 复用）。② **Alt 拖动复制节点**——`onNodeDragStart` 检测 `altKey` → store `duplicateNodeInPlace(id)`（分组连子节点 + 内部连线一并克隆、原位、不选中；原节点被拖走副本留下）。③ **分组识别结果节点内容**——runner `collectOwnOutput(n,...)` 收单节点自身产出（图片/提示词/LLM/视角/缩放/生成/ComfyUI/**结果** 全类型），`computeUpstream` 分组子节点循环改用它（原只认 image/prompt 子节点）；结果节点可拖入分组（`setNodeParent` 本就不限类型）。④ **跨功能发送落当前视图正中心**——新 `SmartInboxBridge`（渲染在 `ReactFlowProvider` 内，用 `useReactFlow().screenToFlowPosition` 取 `.react-flow` 容器中心）替代原 index.tsx 固定 (80,80) 收件箱 effect；无画布时新建后等两帧再取中心。⑤ **生图对话右键发送到智能画布**——ChatPanel `showCtx` 文本菜单加「发送(选中)到智能画布（提示词）」（push `{kind:'prompt',text}`）、`showBubbleImageMenu` 图片菜单加「发送到智能画布」（push `{src}`）+ 跳 `/smart-canvas`。⑥ **画板导出对话框 +「✦ 智能画布」去向**——`ExportDialog` Destination 加 `'smart-canvas'`：合成+选定格式→dataUri→`useSmartInboxStore.push`→跳转。⑦ **修复生图对话「空闲后首条无输出」竞态**——`api:chat:send` 不 await `handleSend` 即返回 messageId，渲染端原在 `await` 后才 `setPendingMessageId`，期间到达的 chunk/sources 被 `pendingMessageId=null` 丢弃（空闲后首条尤甚→空气泡卡死）。改：路由用 `pendingAidRef`/`pendingMidRef`（ref），监听**只注册一次**；chunk/reasoning/sources **认领**在途回复首个事件的 id（消除竞态），done 严格匹配（避免上一轮残留 done 误重置）；删冗余 `pendingAssistantId` state。零新 IPC。
> **2026-06-03 续二（3 修）**：① **系统剪贴板粘贴建节点**——智能画布里 Ctrl+V：内部节点剪贴板有内容走内部粘贴（保留原行为），否则系统剪贴板图片→图片节点 / 文本→提示词节点，都落当前视图正中心。坑：原 keydown 对 'paste' `preventDefault` 会吞掉原生 paste 事件 → 改成 `if(action==='paste')return` 放行 + `window 'paste'` 监听统一处理（excalidraw 式）。② **所有自动创建落视图正中心**——新增 store `registerViewCenterProvider`/`getSmartViewCenter`/`hasNodeClipboard`（`getSmartViewCenter` 取 `.mb-sc-root .react-flow` 容器中心 flow 坐标）；`addNode` 不传位置时居中、`pasteClipboard(at?)` 把剪贴板包围盒中心对齐视图中心整体平移、`SmartTextViewer` 建节点去掉固定 {120,120}。③ **「从图库选图」弹窗重排**——`.mb-sc-gpick` 改 `min(1180px,92vw)`×`85vh`、grid 加 `min-height:0`+`grid-auto-rows:min-content`+`align-content:start`+`minmax(132px,1fr)`（修叠图、列数随窗口自适应、独立滚动）。零新 IPC。
> **2026-06-03 Nano Banana 2「点 4K 出 1K」修复**：读用户 DB 实证该模型走 `image_kind='grsai'`（`runGrsaiImage`，**非** `buildNanoBananaBody`）。原 grsai 把档位塞进 `aspectRatio`（"4K"），新版后端要 `aspectRatio` 放真实比例 + 独立 `imageSize` 字段放档位 → 修：`isNanoBanana && tierLabel` 分支 `aspectRatio=比例` + 新增 `submitBody.imageSize=档位`。仅 grsai nano-banana 分支，gpt-image-2-vip / 其它 image_kind 不受影响。排查中转站字段问题先读 `%APPDATA%/mengbi/database.sqlite` 的 api_configs 确认真实 image_kind。
> 画板（`/canvas`，**有界** 4096²）= 生成前素材"预编辑"（拼版/透视/抠背景/混合→导出单张参考图）。

---

## 4. IPC 通道命名规范

> 命名前缀：`api:<domain>:<action>`。所有 handler 在 `electron/ipc/` 中注册，前端通过 `window.electronAPI.<domain>.<action>(...)` 调用。

### 4.1 对话（chat.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:chat:send` | renderer→main | 发送消息（流式回包通过 `webContents.send` 推 `chat:chunk` / `chat:done`） |
| `api:chat:cancel` | renderer→main | **取消当前流式响应**（用户按 Esc 触发，详见 `ARCHITECTURE.md` §5.3） |
| `api:chat:create` | renderer→main | 创建新对话 |
| `api:chat:list` | renderer→main | 获取对话列表 |
| `api:chat:history` | renderer→main | 获取某对话的历史消息 |
| `api:chat:rename` | renderer→main | 重命名对话 |
| `api:chat:delete` | renderer→main | 删除对话 |

### 4.2 绘图（generate.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:image:generate` | renderer→main | 提交绘图任务（返回 taskId） |
| `api:image:status` | renderer→main | 查询任务状态 |
| `api:image:cancel` | renderer→main | 取消任务 |
| `api:image:queue` | renderer→main | 获取当前任务队列 |

### 4.3 提示词管家与图库（gallery.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:gallery:list` | renderer→main | 图片列表（支持分类、标签、搜索过滤 + `album_id` 按相册筛选） |
| `api:gallery:detail` | renderer→main | 图片详情 |
| `api:gallery:update` | renderer→main | 更新图片元数据（标签、评分、备注、相册 `album_ids`） |
| `api:prompt:list` | renderer→main | 提示词卡片列表（按 category 过滤） |
| `api:prompt:upsert` | renderer→main | 新增 / 更新提示词卡片 |
| `api:prompt:delete` | renderer→main | 删除提示词卡片 |
| `api:prompt:category:list` | renderer→main | 提示词分类列表 |
| `api:album:list` | renderer→main | 相册列表（出口已把 `smart_rules` 解析成对象） |
| `api:album:upsert` | renderer→main | 新增 / 更新相册（含智能相册规则） |
| `api:album:delete` | renderer→main | 删除相册（只删相册本身，不动图片） |

> **相册（2026-06-05 落地 UI）**：手动相册靠 `images.album_ids` 成员（图库右键「加入相册」逐张归入，json_each 精确匹配避免 "1" 误配 "10"）；智能相册存 `smart_rules`（`minRating` / `tags` 全含 / `models` 任一 / `dateFrom`~`dateTo`），`api:gallery:list?album_id=` 时按规则**实时匹配**、不存固定成员。前端在 Manager 图库视图侧栏（`AlbumEditModal` + 侧栏相册导航）。

### 4.4 实验室（lab.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:lab:reverse` | renderer→main | 单图 / 多图反推 |
| `api:lab:translate` | renderer→main | 中英互译 |
| `api:lab:history` | renderer→main | 实验室历史记录查询 |

> 实验室 v1.0 只做 **反推 / 中英互译**（+ history）。原计划的 拆解 / 多模型对比 / 融合 已于 2026-06-05 移除（曾是 `NOT_IMPLEMENTED` 桩），如未来重做按新方案设计，不要复活旧桩。

### 4.5 设置与系统（settings.ts + main.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:settings:get` | renderer→main | 读取所有设置（含方案列表） |
| `api:settings:save` | renderer→main | 保存设置（API Key 自动加密） |
| `api:settings:test-connection` | renderer→main | 测试模型配置连通性 |
| `api:plan:list` | renderer→main | 方案列表 |
| `api:plan:upsert` | renderer→main | 新增 / 更新方案 |
| `api:plan:delete` | renderer→main | 删除方案 |
| `api:storage:select` | renderer→main | 打开文件夹选择对话框 |
| `api:storage:save-as` | renderer→main | 弹「另存为」对话框 + 写盘（工具箱用） |
| `api:storage:open-url` | renderer→main | `shell.openExternal` 打开 URL |
| `api:storage:scan-loras` | renderer→main | 扫描 `lora_folder_path` 目录返回 .safetensors / .pt / .ckpt 列表 |
| `api:export:card` | renderer→main | 导出作品卡片 PNG |
| `api:theme:save` | renderer→main | 保存自定义主题（写入 `themes` 表） |
| `api:theme:list` | renderer→main | 自定义主题列表 |

### 4.6 工具箱（tools.ts + upscale.ts + hypir.ts + vec.ts）

工具箱拆成几段 IPC：通用工具（落盘 / 入库）、放大引擎 A（Real-ESRGAN ncnn Vulkan，保真）、放大引擎 B（HYPIR，AI 修复）、图像转矢量(VTracer / Potrace)。各引擎完全分离 —— 不同目录、不同 IPC 前缀、不同前端面板。

> **SUPIR 已于 2026-05-29 整体砍除** —— 显存需求 25-30 GB(CLIP-G + SDXL_base + SUPIR-v0F)对常见配置过大,跑起来风险高、价值小。

**通用（tools.ts）**

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:tools:save-output` | renderer→main | 把工具产出落盘到 `tools_storage_path` |
| `api:gallery:import-from-buffer` | renderer→main | 把工具产出（dataUri）写盘 + INSERT INTO images |

**Real-ESRGAN ncnn Vulkan（upscale.ts）—— 保真放大模式（默认）**

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:upscale:status` | renderer→main | 引擎是否已装、平台、已扫到的模型列表 |
| `api:upscale:install-engine` | renderer→main | 下载 zip 解压到 `userData/engines/realesrgan/`；source ∈ {github/mirror/auto}；推 `upscale:install-progress` |
| `api:upscale:remove-engine` | renderer→main | 删整个引擎目录 |
| `api:upscale:install-model` | renderer→main | 单独下载某模型的 `.bin/.param`（GitHub release 直链 + 国内镜像） |
| `api:upscale:remove-model` | renderer→main | 删某模型 |
| `api:upscale:run-single` | renderer→main | 单图：dataUri/path → 落盘 + 回读 dataUri；推 `upscale:progress` |
| `api:upscale:run-batch` | renderer→main | 批量：path[] → outputDir；串行执行避免 Vulkan 显存抖动 |
| `api:upscale:cancel` | renderer→main | 按 taskId 取消（空则取消所有） |

> 实现要点：调外部 `realesrgan-ncnn-vulkan(.exe)`，stderr 解析 `XX.XX%` 行得进度；不进 Python / PyTorch / 潜空间；支持 2x/3x/4x，PNG/JPG/WebP；tile=0 让 ncnn 自动按显存推断；TTA 关闭为默认。模型走 zip 自带的 `realesrgan-x4plus / realesrgan-x4plus-anime / realesrnet-x4plus / realesr-animevideov3` 四种。

**HYPIR（hypir.ts）—— AI 高质量修复放大模式（架构就绪，缺 Python 后端 / 权重随包）**

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:hypir:check` | renderer→main | 探测 Python ≥3.10 / nvidia-smi / PyTorch+CUDA / HYPIR import / HYPIR 权重 / SD2.1 base 是否齐全 |
| `api:hypir:probe` / `bootstrap` / `set-portable-path` | renderer→main | 完整体检 / 展开便携脚手架 / 改便携包根路径 |
| `api:hypir:start-server` / `stop-server` / `server-status` | renderer→main | 经 ai-platform sidecar 起停 + ping `/api/status` |
| `api:hypir:submit-task` / `task-status` / `cancel-task` | renderer→main | 提交任务（**通道名是 `submit-task` 不是 `run`**）/ 轮询 / 取消 |
| `api:hypir:unload-model` | renderer→main | `/api/unload` 释放显存 |

> **状态（2026-06-05 校准）**：IPC 已经通过 ai-platform sidecar **全部接通**（上表 + §4.7），handler 走 `getSidecarManager()` + `buildHypirSubmitBody()`。**唯一缺的是 Python 后端本体与模型权重不随安装包**——用户须把便携包配置到 `userData/engines/hypir/` 并下载权重后才能真正推理。务必不要把两套引擎（Real-ESRGAN / HYPIR）的代码混在一起 —— 文件目录、IPC 前缀、前端面板都分开。

**图像转矢量(vec.ts,两种 CPU 模式)**

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:vec:run-vtracer` | renderer→main | 单图,VTracer(@neplex/vectorizer)Rust CPU 彩色矢量化 |
| `api:vec:run-potrace` | renderer→main | 单图,Potrace(potrace npm)纯 JS CPU 单色矢量化 |
| `api:vec:run-batch` | renderer→main | 批量(指定模式),进度走 `vec:progress` / `vec:batch-progress` |
| `api:vec:pause-batch` / `resume-batch` / `cancel-batch` / `cancel-task` | renderer→main | 批次 / 单任务取消控制 |
| `api:vec:list-batches` | renderer→main | 当前批次列表 |
| `api:vec:history-list` / `history-clear` | renderer→main | SQLite `vectorize_history` 表 CRUD |

> 实现要点:
> - **两种模式**:Fast (VTracer 彩色,CPU 毫秒级,适合 logo / 文化墙美陈) / Crisp (Potrace 单色,CPU 毫秒级,适合线稿)。UI 让用户**明确选**,不做自动判断
> - **并发规则**:VTracer / Potrace 都在主进程 Node 层跑,并发 = `os.cpus()-1`;两个队列互不阻塞
> - **历史表**:SQLite `vectorize_history`(schema v12,db.ts ensureSchema)。所有完成任务都落一行,与 `images` 表分开(SVG 不进图库)
> - **批量选项**:`outputDir` / `naming`(`original`|`suffix`) / `onConflict`(`overwrite`|`skip`|`rename`);单任务失败不中断批次
>
> **AI 模式(OmniSVG sidecar)已于 2026-05-27 整体砍除** —— 4B 对真实 logo 输出无用,8B 在 64 GB RAM 机器上加载就 OOM 换页,架构上 200×200 viewBox 限制让它本质上做不了高保真矢量化。AI 矢量化的未来方向是 LIVE 类的优化迭代算法(给定 path 数自动拟合像素),不是 VLM 生成式 SVG。

### 4.7 通用 AI 平台底座（ai-platform + ai-features + ai-feature/ai-model IPC）

所有"需要本地 Python sidecar 跑推理"的 AI 功能（HYPIR / 未来的 ControlNet / 抠图等）共用一套基础设施，**绝不再各写一份 spawn / HTTP / probe / poll**。

**目录**

| 文件 | 职责 |
|------|------|
| `electron/services/ai-platform/types.ts` | FeatureSpec / ModelSpec / FeatureProbe / FeatureStatus 等共享类型 |
| `electron/services/ai-platform/pythonRuntime.ts` | 便携 Python embed 路径解析 + `bootstrapPortable()` 脚手架展开 |
| `electron/services/ai-platform/sidecarManager.ts` | 通用 sidecar lifecycle + HTTP（spawn bat / stop / status / submitTask / getTaskStatus / cancelTask / unloadModel） |
| `electron/services/ai-platform/modelRegistry.ts` | 中心化模型注册表：每个 ModelSpec 声明 relPath + sources + usedBy；统一体检 |
| `electron/services/ai-platform/featureRegistry.ts` | `getAllStatus()` 汇总，供"AI 功能列表"UI 渲染 |
| `electron/services/ai-platform/installScriptRunner.ts` | 通用 `runInstallBat()` —— 跑安装脚本 + 逐行进度 + 日志末尾保存 |
| `electron/services/ai-platform/installManager.ts` | 串起一个 feature 的 `installBats` 链；并发锁 |
| `electron/services/ai-features/<id>.ts` | 每个具体功能的 FeatureSpec + ModelSpec[] + 请求体构造器 + error_code 映射 |

**通用 IPC**

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:ai-feature:list` | renderer→main | 所有已注册功能 + 状态（installed / serverRunning / missing 列表） |
| `api:ai-feature:status` | renderer→main | 单 feature 完整状态 |
| `api:ai-feature:probe` | renderer→main | 单 feature 完整体检（Python / bat / 模型逐个 probe） |
| `api:ai-feature:start` | renderer→main | spawn start_<feature>.bat |
| `api:ai-feature:stop` | renderer→main | graceful + 强杀 |
| `api:ai-feature:server-status` | renderer→main | ping /api/status |
| `api:ai-feature:unload-model` | renderer→main | /api/unload 释放显存 |
| `api:ai-feature:bootstrap` | renderer→main | 展开内置脚手架到便携包根 |
| `api:ai-feature:set-portable-path` | renderer→main | 改便携包根路径 |
| `api:ai-feature:install` | renderer→main | 跑安装脚本链；进度推 `ai-feature:install-progress` |
| `api:ai-feature:cancel-install` | renderer→main | 取消安装 |
| `api:ai-model:list` | renderer→main | 所有模型 + 体检 |
| `api:ai-model:get` | renderer→main | 单模型 spec + probe |
| `api:ai-model:list-for-feature` | renderer→main | 指定 feature 用到的模型 |

**Feature-specific IPC**（保留旧通道名供前端 panel 复用，内部 delegate 到 SidecarManager）

`api:hypir:probe / start-server / stop-server / submit-task / task-status / cancel-task / unload-model` 等通道仍然存在，但 handler 全部走 `getSidecarManager()` + `buildHypirSubmitBody()`；`probe` 返回旧 `HypirPortableProbe` shape 是 compat shim。

**加新 AI 功能的标准流程**：

1. 在 `electron/services/ai-features/<id>.ts` 写 FeatureSpec + ModelSpec[] + `build<X>SubmitBody()` + `map<X>ErrorCode()`
2. 在 `electron/services/ai-features/index.ts` 的 `registerBuiltinAiFeatures()` 加一行 `register<X>Feature()`
3. 写 `electron/ipc/<id>.ts`（~100 行）—— 用 `getSidecarManager().submitTask(id, body)` 提交任务 + polling
4. 把 IPC handler 注册函数挂进 `electron/ipc/index.ts`
5. 写 `start_<id>.bat` / `stop_<id>.bat` / `install_<id>.bat`（可选）+ `app/<id>_server/` Python sidecar 入便携包

不需要重写 spawn / HTTP / probe / lifecycle / 任何东西 —— 全部通用层包好。

### 4.8 画板（渲染进程为主 + Photoshop 联动走 `api:ps:*`）

> **架构变更（2026-05-29）**：画板原本「完全在渲染进程内运行，没有自己的 IPC」。自 AI 工作流重做起，**Photoshop 联动**这一项必须落盘临时文件 + `fs.watchFile` 监听用户在 PS 里的保存，无法在渲染进程完成，因此画板获得了**第一个主进程 IPC 子系统 `api:ps:*`**（详见 §4.8a）。其余画板能力（图层 / 蒙版 / 透视 / 裁切 / 调色 / 扩图 / 工程文件）仍**全部在渲染进程内**，不走 IPC。

画板模块的渲染进程内能力：

| 类别 | 内容 |
|------|------|
| 图层类型 | 图像 / 文本 / 矩形 / 椭圆 / 笔刷 / 组（容器） |
| 工具 | 选择 (V) / 抓手 (H) / 画笔 (B) / 橡皮 (E) / 局部重绘蒙版 (M) |
| 右键菜单 | 复用全局 `openContextMenu`：图层菜单（复制/重命名/显隐/锁定/层级▸/合并·栅格化/抠图/转重绘蒙版/作参考图/导出 PNG/删除）+ 画布空白菜单（添加图片/扩图/全选/适合屏幕）。`contextMenu.ts` 构建，画布 viewport 与 LayerPanel 行均右键唤起 |
| 图层操作 | 新建/删除/复制/显隐/锁定/重命名/排序/透明度/混合模式/**合并图层**（`layerOps.mergeLayers` 合成为单图，盖印可见）|
| 变换 | 仿射（拖、缩放、旋转、倾斜）+ 四角透视 + 裁切 + 翻转 + 90° 旋转 + 多选批量 |
| 视图 | Z = 适合屏幕，Ctrl+0 = 100%，Ctrl+± / 滚轮 = 缩放（光标锚点）；Space 临时抓手；标尺 |
| 调整 | 亮度/对比度/饱和度/色相/色温/曝光/锐化/模糊/降噪/黑白/反色，外加 7 个预设（产品增强/效果图真实化/室内提亮/海报增强/去灰/背景虚化/局部锐化）。算法在 `canvasEngine/adjust.ts`，预览（Konva 自定义滤镜）与导出共用同一份像素算法 |
| 文字 | 内容/字体/字号/颜色/粗体/斜体/下划线/对齐/描边/阴影/透明度（Konva.Text + 导出端 `drawTextLayer` 同步） |
| 显示蒙版 | 非破坏性图层蒙版，画笔涂抹（白显黑隐，橡皮还原） |
| 局部重绘蒙版 | 画板级 inpaint 蒙版栅格（`inpaintMaskStore`，**不持久化**，存进工程文件）；**统一规则：白 = AI 处理区，黑 = 保持**。画笔/擦除/大小/硬度/浓度/颜色/透明度 + 反选/填充/清空/羽化/扩展/收缩/模糊边缘 + 导出黑白 PNG / 导入黑白 PNG（`canvasEngine/maskEngine.ts`）。提交给 OpenAI `/images/edits` 前自动转成「透明=编辑区」形式（`maskToEditAlphaPng`） |
| 选区 | 折叠进蒙版系统：`shapeMode` ∈ 自由画笔/矩形/椭圆/套索，几何填充进 inpaint 蒙版；反选/羽化/扩展/收缩/清空 复用蒙版操作（即「转换为蒙版」是隐式的） |
| 扩图（outpaint） | `canvasStore.expandCanvas` 平移所有图层 + 扩画布，新区透明；`OutpaintDialog`（方向 px / 9 档比例 / 自定义 + 九宫格锚点）与**拖动画布边界**（`OutpaintHandles` 四边拖手柄）两条入口，核心在 `canvasEngine/outpaintOps.ts`；扩图后自动生成扩图蒙版（新区=白） |
| 局部重绘工作流 | `InpaintDialog`：当前画布合成为底图 + 蒙版 → `api:image:generate`（refs=[底图] + `params.inpaint_mask`）→ 监听 `image:done` → 结果**默认作为新图层**叠加，原图不破坏 |
| AI 功能入口 | `AIActionPanel`（工具栏 ✦ AI）：图生图/局部重绘/扩图/高清放大/去背景/换背景/风格迁移/图片转矢量/线稿提取/颜色增强/细节增强/真实化/文字修复/Logo 修复 14 项；本地可做的直接作用选中图层，需模型的走画板内重绘/扩图或携画布作参考图跳生图页。**所有 AI 结果默认作新图层** |
| 抠图 | `@imgly/background-removal`（onnxruntime-web）；可选**拆分输出**主体图层 + 背景图层（原图−主体）+ 主体蒙版（写 inpaint 蒙版） |
| 参考图 | `ReferencePanel`（工具栏 🖻）：8 类型（风格/结构/人物/产品/Logo/材质/构图/颜色）+ 权重 + 启用 + 图生图/重绘/仅视觉标志；`imageParamsStore.refs` 扩展元数据，`refPaths()` 过滤 enabled，`buildParams` 透传 `ref_meta` |
| 历史/快照 | 细粒度撤销重做仍走 index.tsx 防抖栈（Ctrl+Z）；命名快照走 `snapshotStore`（`HistoryPanel`，手动 + 局部重绘/发送 PS/导入 PS 前自动），可回到任意一步 |
| 持久化 | Zustand `persist` → localStorage（`mengbi-canvas`），`cookedDataUri` 与 inpaint 蒙版栅格剔除/不持久化 |
| 文件 | `.mengbi-canvas`（v2：JSON + 内嵌图片 dataUri + inpaint 蒙版 + 参考图，跨设备可迁移），save/open 走浏览器下载 + `<input type="file">`，**不走 IPC** |
| 模块组织 | `canvasEngine/managers.ts` 按需求十七节把引擎/ store 聚合到 10 个管理器命名空间（MaskManager/LayerManager/ExportManager/AIActionBridge/AdjustManager… + 指针注释），不大改稳定实现 |
| 跨模块 | 生图页 → 画板：参考图缩略图 ⊞ 按钮加 layer + 跳路由；画板 → 生图页：导出 PNG/JPG/WebP 走 `imageParamsStore.addRefs()` |

#### 4.8a 画板 Photoshop 联动（ps.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:ps:status` | renderer→main | 返回 PS 路径 / 临时目录 / 是否保留临时文件 / 正在监听的文件 |
| `api:ps:set-config` | renderer→main | 设置 `photoshop_path` / `ps_temp_dir` / `ps_keep_temp`（写 settings 表） |
| `api:ps:send` | renderer→main | 把画布 PNG dataUri 写临时文件 → 用 PS（或系统默认程序）打开 → `fs.watchFile` 开始监听 |
| `api:ps:read-back` | renderer→main | 把 PS 保存后的临时文件读回 dataUri（**仅限本桥跟踪过的路径**，防任意文件读） |
| `api:ps:stop-watch` | renderer→main | 停止监听（省略 tempPath = 全部）；按 `ps_keep_temp` 决定是否删临时文件 |
| `api:ps:open-temp-dir` | renderer→main | 打开临时目录 |

> 推送通道 `ps:file-changed`：`fs.watchFile` 检测到临时文件 mtime 前进（用户在 PS 里 Ctrl+S）时推 `{ tempPath, mtimeMs }`，前端 `PhotoshopBar` 据 `autoReimport` 偏好决定直接导回还是弹确认；导回方式（新图层 / 替换当前图层 / 新建画布）存 `psBridgeStore`。第一阶段仅支持 PNG 往返（TIFF / PSD 发送与 PSD 合成预览导回后续做）。
> 新增 settings 键：`photoshop_path` / `ps_temp_dir` / `ps_keep_temp`（首次使用时按需写入，非启动种子）。

> 主进程主动推送的频道（renderer 通过 `on` 监听）：`chat:chunk` / `chat:done` / `chat:sources` / `image:done` / `image:progress` / `notification:append` / `upscale:progress` / `upscale:done` / `upscale:install-progress` / `ps:file-changed`。
>
> `chat:sources`：仅当全局 `search_backend` 为外部搜索后端（`ddg` / `tavily` / `searxng` / `bocha` / `zhipu` / `jina` / `serper` 之一，即非 `native`/`off`）且方案勾了 `supports_web_search` 时，主进程在 stream 启动前推一条 `{ id, backend, hits[] }`，前端 ChatPanel 把 hits 挂到该轮 assistant 消息的"📎 参考来源"卡片。

### 4.9 ComfyUI 通用工作流编排器（comfyui*.ts）

> 独立顶级模块，路由 `/comfyui`（Ctrl+7，侧栏「ComfyUI 工作流」）。**与** Create 页方案配置里的 `image_kind='comfyui'` **并存、各取所需**——后者是生图页内联「一键直跑」（把整段 workflow 当占位符替换后直接出图，详见 §6.1 与 §13）；本模块是连接本地 ComfyUI、导入 API workflow、可视化绑定、批量循环的完整外部控制器。两条路是**有意保留的双轨**（一键 vs 深度编排），不要合并。分 6 阶段交付（计划见 `plans/atomic-snuggling-wirth.md`），**第一阶段已落地**：连接 + 导入 + 单次执行 + 取回图片。

| 通道 | 区 | 功能 |
|------|----|------|
| `api:comfyui:get-config` / `set-config` | 连接 | 读写 host / 启动命令 / 目录 / token（token 经 safeStorage 加密，存 settings k/v） |
| `api:comfyui:detect` / `status` / `start` / `stop` | 连接 | 探活（GET /system_stats，以可达为准，非进程名）/ 状态 / 按用户命令在用户目录 spawn 启动并轮询就绪 / 停止 |
| `api:comfyui:import` | 工作流 | 校验并解析 API 格式 workflow（UI 格式 → 固定文案提示导出 API Format） |
| `api:comfyui:template:list` / `get` / `upsert` / `delete` | 模板 | 工作流模板 CRUD（`comfyui_workflow_templates` 表，保留原始 JSON + 控件 + 绑定 + loop + ui_layout） |
| `api:comfyui:run-single` / `cancel` / `run-status` / `results:get` | 运行 | 单次运行（入**串行队列** concurrency=1）/ 取消 / 队列状态 / 读运行记录（`comfyui_runs` 表） |

> 主进程目录：`electron/services/comfyui/`（client / launcher / parser / wsTracker / outputReader / runEngine / queue / store）。复用从 generate.ts 抽出的 `electron/services/httpClient.ts`（chromiumFetch）与 `imageStore.ts`（saveImage，带 ext 参数）。
> 新增 push 频道：`comfyui:status` / `comfyui:run-progress` / `comfyui:run-done` / `comfyui:queue`。进度优先走 `ws://host/ws?clientId=`（实时 per-node + 队列），2s 开不起或出错回退 `/history` 轮询。
> 架构铁律：不写死 node_id；不限工作流类型 / 自定义节点；参考图不写死单张；输出不写死 SaveImage；每次运行 `structuredClone` 原始 workflow，绝不污染模板；公式循环（P5）必须安全无 eval。
> DB schema 版本随此模块升到 **v14**。后续阶段（P2 节点图+参数绑定 / P3 文件上传+输出绑定 / P4 模板系统 / P5 批量循环 / P6 结果管理）依此架构扩展，新增依赖 `@xyflow/react`（节点图）/ `ws` / `expr-eval`（安全公式）。

### 4.10 本地 LLM（localLlm.ts，内嵌 llama.cpp，开发中）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:llm:status` | renderer→main | 查询本地模型是否在跑、跑的是哪个（`localLlmServer.getStatus()`） |
| `api:llm:stop` | renderer→main | 停止本地模型服务，释放显存/内存 |

> 基于 `node-llama-cpp` 的内嵌本地推理服务（`electron/services/localLlmServer.ts`）。**不暴露 start**——启动是 chat handler 内部按需 lazy 完成的，本组 IPC 只让前端"看一眼 + 能停"。**开发中**：模型选择（`list-models`/`set-current-model`）、推理参数面板（temperature/top_p/max_tokens）、缓存策略尚未实现，规划在后续 Round 补齐。

---

## 5. 核心数据模型（SQLite 表）

> 表名小写下划线；JSON 字段用 `TEXT` 存储字符串化 JSON；时间字段统一 `TEXT` ISO 8601。

### 5.1 `api_plans`（方案）

```sql
CREATE TABLE api_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 5.2 `api_configs`（模型配置，绘画 / 对话各一类）

```sql
CREATE TABLE api_configs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id              INTEGER NOT NULL REFERENCES api_plans(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,          -- 'image' | 'text'
  provider_name        TEXT NOT NULL,          -- 中转站或官方名（用户填写）
  base_url             TEXT NOT NULL,
  api_key_encrypted    TEXT NOT NULL,          -- safeStorage 加密
  model_mapping        TEXT NOT NULL,          -- JSON: {"GPT-4o": "gpt-4o-custom"}
  is_official          INTEGER NOT NULL DEFAULT 0,
  supports_web_search  INTEGER NOT NULL DEFAULT 0,
  supports_vision      INTEGER NOT NULL DEFAULT 0,
  official_kind        TEXT,                   -- NULLABLE: 'openai' | 'anthropic' | 'gemini' | 'openai-compat' | NULL
  image_kind           TEXT,                   -- NULLABLE: 'openai' | 'grsai' | 'gemini' | 'openai-compat' | 'comfyui' | NULL（v2 加入；'comfyui' 在 v6 加入）
  comfyui_workflow_json TEXT,                  -- NULLABLE: image_kind='comfyui' 时存的 API Format workflow JSON 字符串（v6 加入）
  body_overrides_json  TEXT,                   -- NULLABLE: 用户保存的 JSON 模板，与默认请求体顶层合并发出（v5 加入；详见 §13.4）
  created_at           TEXT NOT NULL
);
```

### 5.3 `conversations` / `messages`

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,                -- UUID
  title       TEXT NOT NULL,
  model_id    TEXT NOT NULL,                   -- 显示名（与 model_mapping key 对应）
  plan_id     INTEGER NOT NULL REFERENCES api_plans(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,               -- 'user' | 'assistant' | 'system'
  content         TEXT NOT NULL,
  timestamp       TEXT NOT NULL
);
```

### 5.4 `generation_tasks`

```sql
CREATE TABLE generation_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   TEXT REFERENCES conversations(id),  -- NULLABLE
  model_id          TEXT NOT NULL,
  positive_prompt   TEXT NOT NULL,
  negative_prompt   TEXT,
  params            TEXT NOT NULL,             -- JSON
  reference_images  TEXT,                      -- JSON: 引用图本地路径数组
  status            TEXT NOT NULL,             -- 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  result_paths      TEXT,                      -- JSON
  error_message     TEXT,
  created_at        TEXT NOT NULL
);
```

### 5.5 `images`（图库）

```sql
CREATE TABLE images (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER REFERENCES generation_tasks(id),  -- NULLABLE，导入图无 task
  file_path         TEXT NOT NULL,
  thumbnail_path    TEXT,
  prompt_positive   TEXT,
  prompt_negative   TEXT,
  model_used        TEXT,
  params_json       TEXT,
  tags              TEXT,                      -- JSON 数组
  rating            INTEGER NOT NULL DEFAULT 0,-- 0~5
  notes             TEXT,
  album_ids         TEXT,                      -- JSON 数组
  deleted_at        TEXT,                      -- 软删除时间戳，NULL = 未删除（C3）
  created_at        TEXT NOT NULL
);
```

> `file_path` 必须遵循 `{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png` 模板（详见 `ARCHITECTURE.md` §9.1）。
> `thumbnail_path` 必须为 `{date:YYYY-MM-DD}/.thumbs/{taskId}-{seq:02d}.webp`。
> 所有列表查询默认带 `WHERE deleted_at IS NULL`，回收站视图反转此条件。

### 5.6 `albums`

```sql
CREATE TABLE albums (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,               -- 'manual' | 'smart'
  smart_rules     TEXT,                        -- JSON，仅 smart 类型有效
  cover_image_id  INTEGER REFERENCES images(id),
  created_at      TEXT NOT NULL
);
```

### 5.7 `presets`（绘图参数预设）

```sql
CREATE TABLE presets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT,
  params_full   TEXT NOT NULL,                 -- JSON：完整绘图参数
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
```

### 5.8 `prompts`（提示词卡片）

```sql
CREATE TABLE prompts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  text              TEXT NOT NULL,
  negative_text     TEXT,
  kind              TEXT NOT NULL DEFAULT 'image',
                                              -- 'image' | 'video' | 'qa' | 'doc' | 'favorite'
  category_id       INTEGER REFERENCES prompt_categories(id),
  tags              TEXT,                      -- JSON
  notes             TEXT,
  related_image_ids TEXT,                      -- JSON
  deleted_at        TEXT,                      -- 软删除时间戳，NULL = 未删除（C3）
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

### 5.9 `prompt_categories`（提示词管家侧栏分类）

```sql
CREATE TABLE prompt_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                   -- '图片提示词' / '视频提示词' / ...
  slug        TEXT NOT NULL UNIQUE,            -- 'image' / 'video' / 'qa' / 'doc' / 'favorite' / 自定义
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

> 内置 5 条种子记录：`image / video / qa / doc / favorite`，启动时若不存在则插入。
> 视频提示词**仅文本管理**，不接入任何视频生成 API。

### 5.10 `reverse_tasks` / `prompt_lab_history`

```sql
CREATE TABLE reverse_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  image_paths  TEXT NOT NULL,                  -- JSON
  model_id     TEXT NOT NULL,
  result_type  TEXT NOT NULL,                  -- 'description' | 'tags' | 'style'
  result_text  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE prompt_lab_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type  TEXT NOT NULL,               -- 'reverse' | 'translate'（旧库可能含 'split'/'compare'/'fuse'，已停写）
  input_data      TEXT NOT NULL,               -- JSON
  output_data     TEXT,                        -- JSON
  created_at      TEXT NOT NULL
);
```

### 5.11 `themes`（用户自定义主题）

```sql
CREATE TABLE themes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  atmosphere  TEXT NOT NULL,                   -- 'deep-quiet' | 'misty-fog' | ... 共 7 种
  palette     TEXT NOT NULL,                   -- 'warm-orange' | 'purple' | ... 共 10 种
  overrides   TEXT,                            -- JSON：可选 token 覆盖
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

### 5.12 `image_versions`（图片版本历史，C2）

```sql
CREATE TABLE image_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      TEXT NOT NULL,                 -- sha1(prompt + model + params 指纹)
  image_id      INTEGER NOT NULL REFERENCES images(id),
  version_no    INTEGER NOT NULL,              -- 1, 2, 3, ...
  is_current    INTEGER NOT NULL DEFAULT 1,    -- 同 group 仅一条为 1
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_image_versions_group ON image_versions(group_id, version_no);
```

> v1.5+ 启用。详见 `ARCHITECTURE.md` §9.2。

### 5.13 `settings`（键值存储）

```sql
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
```

内置 key（启动时若不存在则按默认值插入）：

| key | 默认值 | 说明 |
|-----|-------|------|
| `last_used_atmosphere` | `deep-quiet` | 上次使用的材质氛围 |
| `last_used_palette` | `warm-orange` | 上次使用的主题配色 |
| `image_storage_path` | `应用根目录/images/` | 图片存放目录 |
| `usage_tracking_enabled` | `false` | 是否记录 token / 成本（C1，v1.5+ 启用） |
| `keybindings_json` | （内置默认表的 JSON） | 自定义快捷键覆盖 |
| `default_context_strategy` | `truncate-head` | 上下文压缩策略（B4） |
| `auto_update_channel` | `stable` | 更新通道（C5） |
| `schema_version` | `1` | 数据库结构版本，迁移用 |
| `tools_storage_path` | NULL | 工具箱（放大）输出目录；NULL 时沿用 `image_storage_path` |
| `tools_auto_save` | `false` | 工具箱处理完成是否自动落盘 |
| `upscale_engine_install_source` | `auto` | Real-ESRGAN ncnn 安装源偏好：`auto` / `github` / `mirror`（仅作为面板默认值） |
| `search_backend` | `native` | 联网搜索后端：`native`（用模型自带 web_search tool）/ `ddg`（duck-duck-scrape）/ `tavily` / `searxng` / `bocha`（博查）/ `zhipu`（智谱）/ `jina` / `serper`（Google）/ `off` |
| `search_tavily_key` | `''` | Tavily API Key（仅 `search_backend='tavily'` 时使用） |
| `search_searxng_url` | `''` | SearXNG 实例 URL（仅 `search_backend='searxng'` 时使用） |
| `search_bocha_key` | `''` | 博查 Bocha API Key（仅 `search_backend='bocha'` 时使用） |
| `search_zhipu_key` | `''` | 智谱 Zhipu API Key（仅 `search_backend='zhipu'` 时使用） |
| `search_jina_key` | `''` | Jina s.jina.ai Key（仅 `search_backend='jina'` 时使用） |
| `search_serper_key` | `''` | Serper（Google）API Key（仅 `search_backend='serper'` 时使用） |
| `lora_folder_path` | `''` | LoRA 库目录；非空时生图面板显示 LoRA 选择器（递归扫 .safetensors / .pt / .ckpt） |

---

## 6. 设置页面要求

### 6.1 模型方案

每个"方案"下可分别配置多个**绘画模型**与**对话/多模态模型**，每条配置含：

- 中转站 / 官方名称
- API 调用地址（base_url）
- API Key（密码框输入，保存时自动加密）
- 模型映射（键值对列表，显示名 → 实际模型 ID）
- 是否支持原生联网（仅对话模型）
- 是否支持 vision（仅对话模型）
- 官方模型类型（可选下拉：Kimi / MiniMax / GLM / DeepSeek）
- 绘图 API 协议（仅绘画模型，可选下拉：openai / grsai / gemini / openai-compat / comfyui）
- ComfyUI workflow JSON（仅 `image_kind='comfyui'`，textarea；粘贴你从 ComfyUI 网页"保存（API Format）"导出的整段 JSON。运行时占位符替换：`{{prompt}}` `{{negative_prompt}}` `{{seed}}` `{{batch_size}}` `{{width}}` `{{height}}` `{{lora}}` —— 仅在节点 inputs 字段值为完整等于占位符的字符串时才替换，子串拼接不支持）
- **请求体覆盖（仅绘画模型，高级）**：JSON 模板，与默认请求体顶层合并发出，`null` 值表示删除字段。用于绕过中转站的字段习惯差异，详见 §13。
- 一键测试连通（`api:settings:test-connection`）

### 6.2 外观

- 材质氛围切换（7 种）
- 主题配色切换（10 种）
- 自定义主题保存（写入 `themes` 表）

### 6.3 存储 / 系统

- 自定义图片存储路径
- 数据库导出 / 备份
- 自定义快捷键（v1.1）
- 自动更新开关

详见 [`FEATURES.md`](./FEATURES.md) 第四节。

---

## 7. 设计规范

### 7.1 主题（材质氛围 × 主题配色）

详见 [`THEMING.md`](./THEMING.md)。要点回顾：

- HTML 根：`<html data-atmosphere="deep-quiet" data-palette="warm-orange">`
- 7 种 atmosphere（deep-quiet / misty-fog / warm-stone / deep-city / flowing-light / dream-galaxy / wave-layer）
- 10 种 palette（emerald / purple / rose / ocean / warm-orange / slate / sunset / wheat / coffee / cyan）
- CSS 变量统一前缀 `--mb-`
- 默认值：`deep-quiet × warm-orange`

### 7.2 形状

| 元素 | 圆角 |
|------|------|
| 卡片 | `var(--mb-radius-card)` = 20px |
| 按钮 | `var(--mb-radius-button)` = 16px |
| 输入框 | `var(--mb-radius-input)` = 12px |

### 7.3 字号

| 用途 | 大小 |
|------|------|
| 标题 H1 | 24px |
| 正文 | 16px |
| 辅助 | 13px |

### 7.4 字体

```
'Inter', 'SF Pro Display', system-ui, -apple-system, BlinkMacSystemFont, sans-serif
```

### 7.5 动效

| 场景 | 时长 / 缓动 |
|------|------------|
| 页面切换 | 250ms / 淡入 + 上移 10px |
| 悬停 | 150ms / scale(1.02) + 阴影 |
| 列表交错入场 | 每项延迟 30ms |
| 通用过渡 | `var(--mb-ease-default)` |

---

## 8. AI 开发工作流

收到一个开发指令后，按以下顺序产出代码：

1. **确认阶段**：属于 `DEVELOPMENT.md` 的哪个 Phase？涉及哪些模块？是否有依赖未完成？
2. **数据变更**：需要新表 / 新字段？给出 DDL，并写入 `electron/ipc/index.ts` 的迁移段。
3. **IPC 层**：在 `electron/ipc/<domain>.ts` 中添加 / 修改 handler，IPC 入参用 zod 校验。
4. **前端页面**：在 `src/pages/<Page>/` 或 `src/components/` 中实现组件。
5. **状态层**：在 `src/store/` 中新增 / 扩展 Zustand store；流式数据走主进程 push。
6. **样式层**：使用 CSS 变量；只在 `theme.css` 写颜色字面量；组件层只引用 `var(--mb-*)`。
7. **自检**：写完一段后用本文件第 10 节"绝不生成的内容"逐条检查一遍。

### 8.1 验收清单（每段代码提交前）

- [ ] TypeScript 严格模式可编译（`tsc --noEmit` 通过）
- [ ] 无 `any` 类型（除非有明确的类型边界注释解释）
- [ ] 所有 Promise 都有 `.catch` 或 `try/catch`
- [ ] 涉及外部 API 的代码全部在主进程
- [ ] 涉及 API Key 的字段经过 `safeStorage`
- [ ] IPC handler 入参经过 zod 校验
- [ ] 组件不写颜色字面量，仅用 `var(--mb-*)`

---

## 9. 关键铁律

1. **前端绝不直接调用外部 API**——所有外网请求由主进程发出，渲染进程通过 IPC 代理。
2. **API Key 永不暴露在前端**——任何 IPC 响应都不能携带明文 Key。
3. **使用同步的 `better-sqlite3` 方法**——不要 `async`/`await` 包同步方法。
4. **流式对话用 `webContents.send` 推送**——不要把整段消息攒齐再返回。
5. **优先使用函数式组件 + Hooks**——不要写 class 组件。
6. **跨文档术语一致**——路由（`/` `/manager` `/lab` `/canvas`）、IPC 命名、表名、主题术语在所有文档与代码中保持一致。
7. **优先级优先 P0**——`FEATURES.md` 标 P2 的功能默认不实现，除非该阶段所有 P0/P1 已完成。
8. **设计稿是参考不是真理**——`前端页面设计参考/*.png` 用于对齐风格意图，具体细节以本文件为准。
9. **错误展示规则（A2）**——所有 IPC handler 返回 `Result<T, AppError>`（**不**用 throw）；`AppError` 携带 `severity: 'fatal' | 'modal' | 'toast' | 'inline' | 'silent'`，前端按此分发到对应 UI（详见 `ARCHITECTURE.md` §7）。文案永远写"做什么 + 怎么办"，不要只说"出错了"。
10. **开发期不要无谓真调用（A7）**——AI 辅助开发期间默认走 `MENGBI_MOCK=1` 的 Mock 模式，所有 Adapter 走 `electron/ipc/mocks/` 夹具。只有最终联调与 release 候选自测才用真实 API。
11. **v1.0 不引入 i18n 框架（B2）**——UI 文案直接中文硬编码。i18n 是 v1.5+ Roadmap，本阶段写代码**不要**预先封装 `t()` 函数。术语见 `WHITEPAPER.md` 第十节术语表，编码时一致使用即可。
12. **图片落盘命名严格统一（A4）**——`{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png`；缩略图 `{date:YYYY-MM-DD}/.thumbs/{taskId}-{seq:02d}.webp`。任何写入 `images.file_path` 字段的代码都必须遵守，详见 `ARCHITECTURE.md` §9.1。
13. **软删除是默认（C3）**——`prompts` / `images` 的"删除"操作只设 `deleted_at = NOW()`，不立即清理。后台任务 30 天后才物理删除。所有列表查询都要 `WHERE deleted_at IS NULL`。
14. **画板的 cookedDataUri 不持久化**——抠图 / 透视烘焙后的中间图可能 MB 级，写到 localStorage 会爆 quota。`canvasStore.partialize` 永远把它剔除；重新打开时 cooked 丢失，回退到 `sourcePath`。撤销栈同理只保 sourcePath + 变换参数，不存 cooked，限 30 步。
15. **画板尺寸上限 4096×4096**——`MAX_CANVAS_SIZE` 常量；超出在 PropertiesPanel 输入框 clamp，并 toast 提示。理由：4K 屏 + 主流绘图模型上限；8192 在多层 + 混合模式下导出 toBlob 易卡死。

---

## 10. 绝不生成的内容

- 占位 TODO（`// TODO: implement later`）——除非配套了 GitHub issue 编号
- `any` 类型（包括 `as any`、`Function`、隐式 any）
- 未处理的 Promise（无 `.catch` / 不在 `try/catch` 中）
- 渲染进程直接 `fetch` 外部 API
- 把 API Key 写入前端代码、注入到 webContents、或通过 IPC 明文返回
- class 组件、装饰器、`var` 声明
- 中文 key（数据库列、JSON key、CSS 变量、TS 接口字段一律英文）
- 写死的颜色字面量（除 `theme.css` 内部）
- Slogan / 彩蛋 "带你吃火锅儿"
- 视频生成 API 调用代码（v1.0 不做）
- 任何让前端获得 Node.js / fs / path 直接访问能力的 preload 暴露

---

## 11. 开发阶段全览

详见 [`DEVELOPMENT.md`](./DEVELOPMENT.md)。当前阶段：

> **Phase 0（文档完善）已完成。** 下一阶段 **Phase 1（骨架与配置）** 等用户复核 8 份文档后启动。

| Phase | 内容 |
|-------|------|
| 0 | 文档完善（本轮） |
| 1 | 项目骨架、主题、路由、设置页、数据库初始化 |
| 2 | 对话系统、流式聊天、模型适配器、联网搜索 |
| 3 | 绘图模块、参考图、批量生成、任务队列 |
| 4 | 提示词管家（含图库）、标签评分、相册、分类 |
| 5 | 提示词实验室：反推、中英互译（拆解/对比/融合 已于 2026-06-05 移除） |
| 6 | 全局体验：快捷键、托盘、迷你窗、卡片导出 |
| 7 | 打包、更新、测试 |

当用户说"开始"或"继续"时，从当前阶段的下一个未完成子任务开始生成。

---

## 12. 文档地图（不要自己造文档）

| 文档 | 用途 |
|------|------|
| `README.md` | 项目门面、快速开始 |
| `WHITEPAPER.md` | 产品视角说明书 |
| `FEATURES.md` | P0 / P1 / P2 功能清单 |
| `ARCHITECTURE.md` | 技术架构、模块依赖、流式时序图 |
| `DEVELOPMENT.md` | 7 Phase 开发节奏 |
| `ENVIRONMENT.md` | 环境要求 |
| `THEMING.md` | 主题矩阵 / CSS 变量 |
| `CLAUDE.md` | 本文件，最权威 |
| `中转站请求体覆盖指南.md` | 接入新中转站时的请求体对账方法与速查表 |

> 不要新增 `IPC_CONTRACT.md` / `SECURITY.md` / `TESTING.md` 等，除非本文件先列入。

---

## 13a. 图像模型「系列（family）」一等公民化

### 13a.1 动机

不同图像模型对参数的解释方式根本不同，但前端拿一份"通用参数面板"喂出去会出问题。

最具代表性的例子："4K 实际只出 1K"：

- 用户选 1:1 + 4K 档位，旧版前端把 `size="WxH"` + `aspect_ratio="1:1"` + `image_size="4K"` 三件一起发
- GPT Image 2 看 `size`，按像素预算 8.3MP 算出 ~2880×2880
- Nano Banana 看 `image_size`，本来能出真 4K
- 中转站随机挑一项，结果常常拿到 1K

### 13a.2 解决：family manifest

每个 family 自己声明：
- 该 family 识别的 aspect ratio 列表
- 该 family 识别的"分辨率档位"（1K/2K/4K，空数组 = 不用档位）
- 是否支持 quality / negative_prompt
- maxN
- 单边像素预算（仅 GPT Image 2 那种走 size=WxH 的 family 用）
- 一个 `buildBody(input)` 函数，**只发该 family 真正识别的字段**

实现位于 [src/types/imageModelFamilies.ts](./src/types/imageModelFamilies.ts)。

### 13a.3 当前内置 5 个 family

| family.id | 匹配 | 字段策略 |
|-----------|------|----------|
| `gpt-image-2` | 模型 ID 含 `gpt-image-2` | 只发 `size="WxH"`（snap 16，clamp 256–4096，预算 8.3MP）+ `quality` |
| `nano-banana-pro` | 模型 ID 含 `nano-banana-pro` | 只发 `image_size="4K"` 字面量 + `aspect_ratio` + 可选 `quality` |
| `nano-banana-flash` | 模型 ID 含 `nano-banana[-_]?(\d[.\d]*[-_]?)?flash` | 只发 `image_size="1K\|2K"` + `aspect_ratio`，不发 quality |
| `nano-banana-2` | 模型 ID 含 `nano-banana`，且不含 `pro\|flash` | 1K/2K/4K + aspect_ratio，不发 quality |
| `default` | 兜底 | 同时发 size + aspect_ratio + image_size，让上游中转挑（保 v1 兼容） |

### 13a.4 自动嗅探 + 用户覆盖

- 默认按真实 model ID（`cfg.model_mapping[displayName]` 解出来）走 `detectFamily(...)`
- 如果用户的命名和官方 ID 不一致（自定义别名），可在生图面板顶部"系列覆盖"下拉里手动选
- 覆盖值通过 `imageParamsStore.familyOverride` → `params.family_override` 传给主进程，主进程在 `runOpenAIImage` 用 `getFamilyById(...)` 取代检测结果

### 13a.5 UI 自适应

[src/pages/Create/index.tsx](./src/pages/Create/index.tsx) 的生图面板会根据 `family`：
- 把 `family.supportedAspects` 之外的比例 chip 渲染为 `is-fade`（半透明，仍可点但 tooltip 提示该 family 不识别）
- 档位下拉只列 `family.supportedTiers`；空数组时整个下拉禁用，提示"由 size 决定"
- `!family.supportsQuality` 时整个 quality 下拉不渲染

### 13a.6 与请求体覆盖的关系

`family.buildBody(...)` 跑完之后，`applyBodyOverrides` 仍会按用户在方案配置里写的 JSON 模板做顶层合并。
所以 family 决定**默认字段集**，用户的 JSON 覆盖在它之上做最后调整（包括 `null` 删字段）。

---

## 13. 绘图请求体覆盖模板（v1.0+）

### 13.1 动机

OpenAI 兼容只是口号，每个中转站都有字段习惯差异：

- 部分 new-api 衍生中转站把 chat 与 image 共用一个 `GeneralOpenAIRequest` Go struct，把 `response_format` 字段定义成 object，我们传字符串 `"b64_json"` 时反序列化失败 HTTP 500
- 部分中转站 `quality` 必填、部分禁止
- `aspect_ratio` vs `size` vs `image_size` 的优先级各家不同
- 有些中转站有自己的扩展字段（水印、风格预设等）

为避免每接一个新中转站就改一次代码，`api_configs.body_overrides_json` 提供了一个 per-方案的 JSON 模板，让用户在设置页直接覆盖默认请求体。

### 13.2 合并语义

代码先按既定逻辑（[generate.ts:runOpenAIImage](./electron/ipc/generate.ts)）算出默认 body，然后：

1. 读 `cfg.body_overrides_json`；为空 / null → 跳过，行为与历史版本逐字节一致
2. 非空 → `JSON.parse` → 顶层 `Object.assign(body, overrides)`（用户值赢，**仅顶层**，不递归）
3. **变量替换**：覆盖对象的字符串值若严格匹配 `^\${(\w+)}$` 整串占位，按变量表替换为真实类型（字符串 / 数字 / null）
4. **null 剥离**：合并完成后，所有值为 `null` 或 `undefined` 的字段从最终 body 删除——这是"删除字段"的语义
5. 把最终 body 发出去

实现位于 [generate.ts:applyBodyOverrides](./electron/ipc/generate.ts)。

### 13.3 变量表

| 占位符 | 类型 | 等价于 |
|---|---|---|
| `${model}` | string | `cfg.actualModelId` |
| `${prompt}` | string | `positivePrompt` |
| `${size}` | string | `resolveSize(params)` |
| `${n}` | number | `params.n ?? 1` |
| `${quality}` | string \| null | `params.quality ?? null` |
| `${aspect}` | string \| null | `params.aspect ?? null` |
| `${image_size}` | string \| null | `params.image_size ?? null` |
| `${negative_prompt}` | string \| null | 预留占位（runOpenAIImage 当前未接 negativePrompt） |

**只对值为完整 `${var}` 字符串的字段做替换**——`"prefix-${var}"` 这种字符串拼接不支持，因为模板是 JSON 后置解析的，无法表达。

### 13.4 适用范围与边界

| 函数 | 是否生效 | 原因 |
|---|---|---|
| `runOpenAIImage`（[generate.ts](./electron/ipc/generate.ts)） | ✅ | 这是默认 OpenAI 协议的 JSON body 入口 |
| `runOpenAIImageEdit` | ❌ | FormData 多部分上传，没 JSON body 可覆盖 |
| `runGrsaiImage` | ❌ | 自有异步轮询协议，结构不同 |
| 鉴权头 / 端点路径 / 响应解析 | ❌ | 模板**只**覆盖请求 body；这些差异需要新 adapter 或加新配置列 |

### 13.5 校验

- IPC 入参（[schemas.ts:apiConfigInputSchema](./electron/ipc/schemas.ts)）用 zod refine 校验：必须是合法 JSON 对象顶层（不能是数组或基本值），或留空
- DB 落库时（[settings.ts:upsertConfig](./electron/ipc/settings.ts)），空字符串归一为 NULL
- 设置页 textarea 失焦时本地 `JSON.parse` 试一下，错误用红字 hint 实时提示

### 13.6 用户最常见模板

```json
// 屏蔽 response_format（解决部分 new-api 衍生中转站的 HTTP 500）
{ "response_format": null }

// 强制 quality=high 并加扩展字段
{ "quality": "high", "enable_watermark": false }

// 把 size 改成 width/height 双字段（先删默认，再加新）
{ "size": null, "width": 1024, "height": 1024 }
```
