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
│   │   └── lab.ts          # api:lab:* 实验室
│   │   # SUPIR 已于 2026-05-29、HYPIR + ai-platform 底座已于 2026-06-18 整体砍除
│   └── services/           # comfyui / vectorize / video / db / 各工具箱引擎 等后端服务
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
│   │       └── nodes/          # 图片/文件夹输入/提示词/文字/LLM/提示词商城/智能分镜/图像反推/镜头(拍照·视频)/光源/配色工具/缩放/插帧/视频剪辑/尺寸/循环/生图/ComfyUI/视频上传/视频/视频反推/结果/文件夹输出/对比/分组 二十五类自定义节点 + NodeShell
│   ├── store/              # Zustand stores（themeStore / conversationStore / ...）
│   ├── hooks/              # 通用 hooks
│   ├── types/              # 跨进程共享 TS 类型（IPC 入参/响应、AppError、各 ParamSchema）
│   ├── styles/
│   │   └── theme.css       # 10 + 10 套主题 token，全局样式
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
| `/manager` | Ctrl+3 | 图库 + 提示词管家（管家 UI 2026-06-05 下线 → **2026-06-12 复活**，侧栏「图库 / 提示词」双视图切换） | `src/pages/Manager/index.tsx` |
| `/comfyui` | Ctrl+4 | ComfyUI 工作流编排器 | `src/pages/ComfyUI/index.tsx` |
| `/tools` | Ctrl+5 | 工具箱（保真放大 + AI 修复 + 图像转矢量,本地处理） | `src/pages/Tools/index.tsx` |
| `/smart-canvas` | Ctrl+6 | 智能画布（AI 工作流 / 节点图，React Flow） | `src/pages/SmartCanvas/index.tsx` |

> **当前 6 个顶级入口**（外加设置 `/settings`），与左侧侧栏自上而下一一对应。
> **2026-06-05 模块精简**：① **实验室（`/lab`）页面整体下线**——删除 `Laboratory/` 页 + labStore + 侧栏入口 + 路由；但 `lab.ts` 的 `reverse/translate` **IPC 后端保留**（智能画布 LLM 节点「图片反推」复用 `api:lab:reverse`）。② **提示词管家 UI 下线**——`/manager` 固定为「图库」视图（移除模式切换 + 提示词卡片/分类/编辑入口 + 各处「归档到提示词」），`prompts`/`prompt_categories` 表与 `api:prompt:*` 通道保留为休眠态（同软删除哲学，未来可复活或彻底清理）。智能画布 Ctrl+7→**Ctrl+6**。
> 「智能画布」`/smart-canvas`（React Flow 节点图：图片/提示词/LLM/工作/ComfyUI/结果/分组节点 + 连线 + 运行）是独立节点编排模块。智能画布**不含任何 Claude Code/命令执行**；工作节点 provider 两档：`mengbi`（图片生成/编辑/风格/扩图复用 `api:image:generate`，含 family 自适应 比例/分辨率/质量 + 真实 batch/loop 多轮；放大复用 `api:upscale:run-single`）/ `mock`（Local Mock；视频生成 v1.0 不接入，走模拟）。结果图可一键入图库（`api:gallery:import-from-buffer`）/ 另存（`api:storage:save-as`）。连线类型校验：结果节点只接 工作/ComfyUI 输出。**LLM 节点**=文本模型（优化提示词/翻译/扩写/细节分解/对话完善/图片反推），复用 `api:chat:optimize-prompt` + `api:lab:reverse`，输出文本喂下游。**ComfyUI 节点**=整个工作流当黑盒（参数全在「工作流」页调好），复用 `api:comfyui:run-single` + `template:get`；画布里**只做输入/输出拆分**——上游提示词→第一个文本控件、上游图片→图片控件（file_upload 绑定由运行引擎自动上传），其余控件用工作流默认值（applyBindings 留空不覆盖），结果经 `comfyui:run-done` 取回。**分组**=容器化（拖节点进框自动归入 React Flow parentId，整组作下游输入）。**创建**：工具栏点选类型→点画布落位（武装态）；从节点拖出连线落空白 / 双击画布→快捷创建菜单（拖出可建下游节点并自动连线）。**连线**有中点 × 圆钮可删（DeletableEdge）。**排布**：网格(列数+间距)/按类型分组/对齐选中(左中右上中下)/横纵均分（只动顶层非分组节点）。**多文档**：进入 `/smart-canvas` 先到「选择画布」启动页（`CanvasLauncher`，launcher-first）—— 新建/打开/重命名/删除多张智能画布，最近修改在前；打开后进工作区，工具栏左侧「画布菜单」按钮可随时切回启动页 + 内联改名。文档元数据存 localStorage `mengbi.smartCanvas.docs.v1`（`useSmartDocsStore`），每张画布内容单独存 `mengbi.smartCanvas.doc.<id>`（`lib/smartDocStorage.ts`，`CanvasWorkspace` 挂载时 load、改动 500ms 去抖写回；旧单文档 `mengbi.smartCanvas.v1` 首次进入自动迁移成「我的画布」卡片）。`useSmartCanvasStore` 本身不再持久化，只作当前文档的工作缓冲区。右下角小地图（MiniMap）按节点类型上色实时呈现全画布。**撤销/重做**（Ctrl+Z/Ctrl+Shift+Z，结构改动+拖动手势进栈、上限 50；文本编辑走输入框原生撤销不进栈）、**复制/粘贴/再制节点**（Ctrl+C/V/D，模块级剪贴板跨文档有效、重映射内部连线）。**工作节点**支持负向提示词 + seed（空=随机/loop 按轮 +1；文生图经 generate.ts 在 buildBody 后透传 seed，图生图走 FormData seed）。**在途任务跨文档不丢**：work/comfy 提交时记 docId，结果回来若已切走画布则回灌该文档存储（`patchDocNodes`），不污染当前文档。localStorage 写入配额超限有 toast 预警。**跨模块打通**：图库/生图结果/工具箱结果/ComfyUI 输出的右键菜单都有「发送到智能画布」→ 推入 `useSmartInboxStore` + 跳 `/smart-canvas`，进入后加成图片节点（无打开画布则新建「导入素材」）；图片节点支持「从图库选图」（`GalleryPickerDialog` 复用 `api:gallery:list`）；结果块/结果节点可「作参考图」发回生图页（`imageParamsStore.addRefs`）+「入图库/另存」（`nodeArea` 共享 `imageToGallery`/`imageSaveAs`）。**运行全部**（工具栏「运行全部」按拓扑顺序串行跑全图 work/comfy/llm 节点，进度 `useSmartRunStore` 显示 N/total + 停止=软停只断后续）。**分组可折叠**（`toggleGroupCollapse` 隐藏子节点+相关连线、收起组高度）。**复制画布**（启动页卡片悬浮「复制」→ `duplicateDoc` 克隆元数据+内容）。**节点搜索**（Ctrl+F `NodeSearch` 按类型/文字命中 → setCenter 居中并 `selectOnly` 高亮）。**非法连线提示**（落在节点上但被拒 → toast 具体原因）。**生成超时兜底**（`generateOnce` 180s 未返回则置错+清 pending，不卡 running）。画板图层右键也有「发送到智能画布」（5 个图片来源全部打通）。
> **2026-06-03 体验大改**：① 工作节点 UI 改名「**生成**」（type 仍 'work'）。② **进入不再回启动页**——`activeDocId` 改 session 态（不持久化、不再 mount setActive(null)）：切功能再回来停在当前画布，重启才回启动页。③ **拖入**：多图拖到画布 → 自动建分组容器网格铺入（`dropImages`）；文字拖入 → 自动建提示词节点。④ **排布按拓扑序**（`topoSorted`，生成在前结果在后，不打乱流向）。⑤ **结果节点=累积集合**：每次结果累加，`useSmartResultStore`（内存态、不进文档、重启清空；`sanitize` 剥离 result 持久化；**每节点上限 `MAX_RESULTS_PER_NODE=100`，超出 FIFO 淘汰最旧的，挡长会话 base64 爆内存**）。⑥ **ComfyUI 节点改回可调**：选模板后检查器渲染暴露控件可编辑（`renderComfyControl`），`controlValues` 随运行发出（上游仍覆盖输入槽）。⑦ **右侧检查器可收起**（`inspectorCollapsed`）。⑧ **底部备注两段**：左=选中节点能做什么（随类型变）、右=快捷键。⑨ **分组**改实线卡片+「N 项」徽章+拖入自动扩容（`setNodeParent` grow）。⑩ **连接口**=纵贯节点高度的箭头轨（`.mb-sc-handle` ::before 轨 + ::after ❯）。⑪ **连线彩色流动**（`@keyframes mb-sc-flow-move` dash 动画，色 `var(--mb-sc-flow)`，外观设置可调，默认跟随 accent；themeStore.flowColor）。⑫ 排布弹窗加图标加宽；快捷键弹窗 portal 到 body 居中（避 transform 错位）。css 前缀 `mb-sc-*`。所有节点零新 IPC（复用现有通道）。
> **2026-06-03 续**：① **多选群组**——选 ≥2 个顶层非分组节点，右键「群组所选」或 Ctrl+G（`groupSelection`）→ 建分组容器并把子节点网格自动排布进框（`onSelectionContextMenu`/`onNodeContextMenu`，单节点右键给删除/解散分组）。② **视角上下拖修正**——预览拖动垂直方向取负（上拖→俯视、下拖→仰视），左右不变。③ **生成失败可重试**——生成节点新增「取消」按钮（运行中显示，`cancelWork`：abort 上游任务释放并发槽 + 重置 idle，解决拥挤模型挂住槽位后第二三次点运行无反应）+ 节点上内联显示错误文案（原先只有「失败」徽章看不到原因）；`generateOnce` 新增 `onTask` 回调把 taskId 记到节点供取消。④ **结果节点扩容**——`WorkResult` 加 `texts?`/`videos?`；结果节点支持 图/文本/视频 三类展示，每项可**拖出成节点**（图→图片节点 / 文本→提示词节点，走 `application/mengbi-sc-node` 拖拽载荷 + 画布 `onDrop` 落位），并新增**输出口**可继续连下游（result 进 `PRODUCERS`/`IMAGE_SOURCES`；LLM 文本经 `pushTextDownstream` 汇入结果节点）；清空累积同时清 `data.result` 避免下游读旧值。零新 IPC（取消复用 `api:image:cancel`）。
> **2026-06-03 增强版（蓝图 9 项）**：① **多画布标签栏**（`SmartTabs`：`useSmartDocsStore.openIds` 会话态 + `lib/smartDocStorage.switchDoc/closeDocTab/backToLauncher/saveCurrentDoc`；切标签先存当前文档再载目标再 setActive，`CanvasWorkspace` 卸载 cleanup 加守卫「仅当本文档仍 active 才落盘」防切换互写）。**2026-06-05 标签栏 UI 下线**：用户为单画布工作流（一次只开一张），删 `SmartTabs` 组件 + index.tsx 渲染 + `.mb-sc-doctab*` 样式；底层多文档系统（`openIds`/`switchDoc`/`closeDocTab`/启动页）保留，切换/新建画布改走工具栏「画布菜单」→ 启动页（`CanvasLauncher`）。② **连线增强**（`useSmartViewStore` 持久化偏好：曲线/直线/折线 `getBezier/Straight/SmoothStepPath` + 箭头 `MarkerType.ArrowClosed` + 按上游运行状态着色 idle灰/running强调/success绿/error红；仅源节点有 status 的连线着色，其余保留流动色；`ViewPrefsPanel` 外观弹窗）。③ **网格吸附 + 对齐参考线**（RF `snapToGrid`/`snapGrid` + `onNodeDrag` 算与其它顶层节点左/中/右·上/中/下对齐 → `ViewportPortal` 画参考线）。④ **方向键微调**（`nudgeSelected`，Shift=10px，连续微调只进一次撤销栈）。⑤ **节点标签/注释 + 颜色**（`NodeMeta` 基类 label/labelColor 加到全部节点 data；`NodeShell` 渲染彩条；检查器标签块 + 6 色 swatch）。⑥ **运行 loading 动画**（`.mb-sc-spinner` 转圈 + 状态徽章 + 运行按钮）。⑦ **Mock 真实化**（work provider=mock 可配 `mockDelayMin/Max`/`mockErrorRate` 随机延迟 + 随机失败注入）。⑧ **节点模板**（`useSmartTemplateStore` 持久化 + `captureSelection`/`insertNodes`；`TemplatePanel` 存选区为模板 + 一键插画布中心；存模板 `sanitizeTemplateNode` 剥运行态）。⑨ **运行日志导出**（`nodeArea.exportTextFile` → `api:storage:save-as` 写 txt；work/comfy/llm 检查器「导出日志」）+ **属性修改进 Undo**（`beginEdit`/`commitEdit` 聚焦快照失焦压栈，wire 到提示词/输入文本/标签字段）+ **搜索筛选 dim**（`useSmartCanvasUiStore.dimFilter` 由 `NodeSearch` 驱动 → 画布不匹配节点 `.mb-sc-dim` 变暗）。零新 IPC（日志导出复用 `api:storage:save-as`）。**未做（架构/规模/v1.0 范围外，已在总结说明）**：实时多人协作（需服务端）、完整插件运行时、自定义节点类型运行逻辑、PSD/SVG 导出、可独立运行的嵌套子画布、跨画布数据引用、条件连线。
> **2026-06-03 增强版续（8 项）**：① **智能排布**（排布弹窗顶部按钮 → `arrangeSmart(gap)`：按连线识别工作流走向，最长路径分层、**上游在左→下游在右**列布局，层内按上游 barycenter 减交叉、整列纵向居中；只动顶层非分组节点）。② **Ctrl 框选接触即选**（`selectionMode={SelectionMode.Partial}`，框碰到即选）。③ **运行计时**（`WorkResult.durationMs`：runWorkNode `t0`+`place()` 包装注入耗时 / ComfyUI `pendingComfy.startedAt`→routeComfyDone / LLM logs `用时`；结果区显示「用时 X.Xs」）。④ **去掉结果「入图库」按钮**（生成结果经 `api:image:generate` 已自动 INSERT INTO images 入库，故 `ResultActionsBlock` 与结果节点右键去掉入库，仅留 另存/作参考图）。⑤ **实际分辨率**（`MeasuredThumb` 组件 img onLoad 量 naturalW×H 角标，用于结果/工作/Comfy 网格缩略；ImageNode 量+持久化 naturalW/H + 左下角标）。⑥ **比例「自动」**（检查器比例首项「未指定」改「自动」：文生图=不发让模型定；图片编辑类=runner `measureAspect()` 量输入图比例吸附到最近常用比例发出）。⑦ **入库缩略图全链路已确认**（generate.ts/tools.ts import-from-buffer/comfyui gallerySync 三处 INSERT 都 `ensureThumbnail`；`api:gallery:list` 还有 `enqueueBackfill` 懒补；Manager 封面 `thumbnail_path||file_path`——无需改）。零新 IPC。
> **2026-06-03 增强版三（节点扩到十类 + 14 项）**：① **新节点「缩放/预处理」**（`scale`：倍数/最长边/最短边/宽高/限制框/像素/精确 + 等比/仅缩小，`lib/imageScale.ts` canvas 实时缩放输出图喂下游，**非高清化**；outputImage 不持久化、重开重算）。② **新节点「比例分析」**（`ratio`：接图显示最近常用比例 + 1K/2K/4K 实际分辨率 + GPT 像素预算；纯展示不输出）。③ **智能排布**（`arrangeSmart`：最长路径分层、上游左→下游右、barycenter 减交叉、整列居中）。④ **Ctrl 框选接触即选**（`selectionMode=Partial`）。⑤ **运行计时**（`WorkResult.durationMs`，结果区「用时 X.Xs」）。⑥ **去结果「入图库」**（生成已自动入库；入库缩略图全链路已确认：三处 INSERT 都 `ensureThumbnail` + `gallery:list` 懒补 `enqueueBackfill`）。⑦ **实际分辨率角标**（`MeasuredThumb` + ImageNode 持久化 naturalW/H）。⑧ **比例「自动」**（文生图=模型定；图片编辑=`measureAspect` 跟随输入图比例）。⑨ **提示词节点默认高度×3** + **新建即自动选中**（addNode selected）。⑩ **缩放交互改**（NodeResizer 全节点常显、隐 4 角点、边线可抓、悬停/选中整圈高亮代替点框）。⑪ **外观/快捷键** 移到左下 Controls（排布下）。⑫ **聊天**：输入区加高可拖大 + 气泡右键选段复制/建提示词节点 + **上游图→attachedImages 多模态识图**；LLM/结果**长文本放大查看**（`SmartTextViewer`+`useSmartTextStore`）。⑬ **分组→ComfyUI** 多提示词分发到多文本控件；**分组→结果** 组合预览（result 现接 图片/提示词/分组/缩放/视角 做实时 computeUpstream 预览，图预览仅在无累积结果时显示避免重复）。⑭ **取消立即停止**（`abortRunAll` 终止当前在跑节点 work→cancelWork/comfy→`cancelComfy`+`comfyui.cancel`；ComfyNode 加取消按钮）。⑮ **图库删除跨功能同步**（`useDeletedMediaStore` 渲染端总线 → `pruneDeletedImages` 从智能画布结果剔除）。零新 IPC。
> **2026-06-03 增强版四（6 项）**：① **提示词跨模块入画布**——图库图右键加「发送提示词到智能画布」、提示词卡片右键加「发送到智能画布」；`SmartInboxItem` 扩 `kind:'image'|'prompt'`+`text?`（src 改可选），`SmartCanvas/index.tsx` 消费时 prompt→提示词节点 / image→图片节点。② **「比例」节点改名「尺寸分析」**（type 仍 `ratio`；改 CanvasToolbar/CreateMenu/NodeSearch/RatioNode title/NodeInspector note/keybind 全部用户可见串）。③ **缩放节点数字输入不再卡 min**——新 `ClampNumberInput`（NodeInspector，本地 string 态，编辑自由输入、失焦/回车才 clamp 提交）替换 edge/fitW/fitH 的「每次按键即 `Math.max(16,…)`」。④ **缩放流畅化**——ScaleNode 缓存源图（imgRef 按 src 复用，不重复 decode）+ 尺寸标注立即跟手 + canvas 编码去抖 220ms。⑤ **画板→智能画布多格式**——`contextMenu.ts` 图层「发送到智能画布」改 PNG/JPEG/WebP 子菜单（`canvasToDataUri(c,format)`）+ 画布空白菜单加「整张发送到智能画布」（`compositeToSmartCanvas` 合成可见图层）。⑥ **智能画布批量保存/导入**——`smartDocStorage.exportDocsBundle`（全部画布打包成一个 `.json` 浏览器下载，format `mengbi-smart-canvas-bundle`）/ `importDocsFromText`（吃批量包或单画布 `.json` 各新建文档）；启动页 `CanvasLauncher` 加「批量导出」「导入画布」（multiple file input）。**软件「所有配置」导出/导入已存在**（`electron/ipc/configIO.ts` + 设置「存储与系统」`ConfigIOSection`：方案+API Key+外观+设置+提示词，AES-256-GCM 加密），本轮未改。零新 IPC。
> **2026-06-03 增强版五**：**文本输出节点统一「→ 提示词节点」**——LLM / 视角 / ComfyUI / 结果 这些能输出文字的节点，输出文本都可一键导入下游提示词节点。`nodeArea.makePromptNodeFrom(sourceId, text)` 抽公共助手（源右侧建 prompt 节点+填文本+选中+toast，空文本提示）；LlmNode 既有「用输出建提示词节点」改走它；AnglePromptNode 生成提示词区加右键菜单 + 「→ 提示词节点」按钮；ComfyNode 新增**文本输出展示**（点放大 / 右键复制·建提示词节点·放大）+「→ 提示词节点」按钮。**ComfyUI 文本输出全链路打通**：`routeComfyDone` 从 `outputFiles` 收 `kind==='text'` 进 `WorkResult.texts`（原先只收 image 丢弃文本）；`computeUpstream` 的 comfy 分支补 `r.texts` → 当上游提示词喂下游。css `.mb-sc-toprompt`。零新 IPC。
> **2026-06-03 增强版六（7 项）**：① **连线插入节点**——「武装」某类型后点连线 → 把新节点插入该连线（删原线，连 上游→新→下游）；store `insertNodeOnEdge(kind,pos,edgeId)`，CanvasViewport `onEdgeClick`（类型不兼容则直接落在点击处 + toast）；连线校验抽 `canConnectKinds(sk,tk)` 纯类型版（isValidConnection 复用）。② **Alt 拖动复制节点**——`onNodeDragStart` 检测 `altKey` → store `duplicateNodeInPlace(id)`（分组连子节点 + 内部连线一并克隆、原位、不选中；原节点被拖走副本留下）。③ **分组识别结果节点内容**——runner `collectOwnOutput(n,...)` 收单节点自身产出（图片/提示词/LLM/视角/缩放/生成/ComfyUI/**结果** 全类型），`computeUpstream` 分组子节点循环改用它（原只认 image/prompt 子节点）；结果节点可拖入分组（`setNodeParent` 本就不限类型）。④ **跨功能发送落当前视图正中心**——新 `SmartInboxBridge`（渲染在 `ReactFlowProvider` 内，用 `useReactFlow().screenToFlowPosition` 取 `.react-flow` 容器中心）替代原 index.tsx 固定 (80,80) 收件箱 effect；无画布时新建后等两帧再取中心。⑤ **生图对话右键发送到智能画布**——ChatPanel `showCtx` 文本菜单加「发送(选中)到智能画布（提示词）」（push `{kind:'prompt',text}`）、`showBubbleImageMenu` 图片菜单加「发送到智能画布」（push `{src}`）+ 跳 `/smart-canvas`。⑥ **画板导出对话框 +「✦ 智能画布」去向**——`ExportDialog` Destination 加 `'smart-canvas'`：合成+选定格式→dataUri→`useSmartInboxStore.push`→跳转。⑦ **修复生图对话「空闲后首条无输出」竞态**——`api:chat:send` 不 await `handleSend` 即返回 messageId，渲染端原在 `await` 后才 `setPendingMessageId`，期间到达的 chunk/sources 被 `pendingMessageId=null` 丢弃（空闲后首条尤甚→空气泡卡死）。改：路由用 `pendingAidRef`/`pendingMidRef`（ref），监听**只注册一次**；chunk/reasoning/sources **认领**在途回复首个事件的 id（消除竞态），done 严格匹配（避免上一轮残留 done 误重置）；删冗余 `pendingAssistantId` state。零新 IPC。
> **2026-06-03 续二（3 修）**：① **系统剪贴板粘贴建节点**——智能画布里 Ctrl+V：内部节点剪贴板有内容走内部粘贴（保留原行为），否则系统剪贴板图片→图片节点 / 文本→提示词节点，都落当前视图正中心。坑：原 keydown 对 'paste' `preventDefault` 会吞掉原生 paste 事件 → 改成 `if(action==='paste')return` 放行 + `window 'paste'` 监听统一处理（excalidraw 式）。② **所有自动创建落视图正中心**——新增 store `registerViewCenterProvider`/`getSmartViewCenter`/`hasNodeClipboard`（`getSmartViewCenter` 取 `.mb-sc-root .react-flow` 容器中心 flow 坐标）；`addNode` 不传位置时居中、`pasteClipboard(at?)` 把剪贴板包围盒中心对齐视图中心整体平移、`SmartTextViewer` 建节点去掉固定 {120,120}。③ **「从图库选图」弹窗重排**——`.mb-sc-gpick` 改 `min(1180px,92vw)`×`85vh`、grid 加 `min-height:0`+`grid-auto-rows:min-content`+`align-content:start`+`minmax(132px,1fr)`（修叠图、列数随窗口自适应、独立滚动）。零新 IPC。
> **2026-06-03 Nano Banana 2「点 4K 出 1K」修复**：读用户 DB 实证该模型走 `image_kind='grsai'`（`runGrsaiImage`，**非** `buildNanoBananaBody`）。原 grsai 把档位塞进 `aspectRatio`（"4K"），新版后端要 `aspectRatio` 放真实比例 + 独立 `imageSize` 字段放档位 → 修：`isNanoBanana && tierLabel` 分支 `aspectRatio=比例` + 新增 `submitBody.imageSize=档位`。仅 grsai nano-banana 分支，gpt-image-2-vip / 其它 image_kind 不受影响。排查中转站字段问题先读 `%APPDATA%/mengbi/database.sqlite` 的 api_configs 确认真实 image_kind。
> **2026-06-06 智能画布连接口 + 拖拽连线 + 整窗缩放**：① **连接口改回「纵贯轨道 + 中央 ❯」**——`.mb-sc-handle` 由 12px 圆点改为贴节点左右边缘、跨节点高度（`calc(100% - 24px)`，上下各留 12px 给四角缩放手柄）的全高命中条（`::before` 圆角竖轨 + `::after ❯` 指示流向 →）；命中区大、好连线（连接点仍在节点中点，`left/right:-7px` 跨边缘）。② **拖一个节点落到另一个节点上 → 自动连线**——`CanvasViewport.onNodeDragStop`：被拖节点中心落入某顶层非分组节点框时，按落点在目标**左半=作上游(拖→目标)**、**右半=作下游(目标→拖)** 建连线并把被拖节点贴到目标旁（GAP 48），方向/合法性走 `canConnectKinds`，非法给 toast；落进分组容器仍走原归组逻辑。新增 store `linkAndMove(source,target,movedId,newPos)`（同向去重 + 一次进撤销栈）。③ **整窗界面缩放 Ctrl+=/+ 放大、Ctrl+- 缩小、Ctrl+0 复位**——根因：Chromium 原生「Ctrl++」在无菜单无边框窗口里不可靠（"+" 实为 Shift+"="，放大加速器未绑定，只有缩小 Ctrl+- 生效）。改：preload 暴露 `window.getZoom/setZoom`（webFrame 同步缩放，clamp [0.5,2.0]）；`App.tsx` 全局 keydown 统一接管（webFrame 对称缩放 + preventDefault 压原生）。**画板(`/canvas`) 自身用 Ctrl+± / Ctrl+0 缩放画布**，故该页放行不接管。零新 IPC（webFrame 走 preload）。
> **2026-06-06 续（界面缩放设置 + 节点标题归位 + 拖拽落点提示）**：① **界面缩放可在设置里调 + 持久化**——`themeStore` 新增 `appZoom`（持久化到 localStorage `mengbi-theme`，启动 `applyThemeToDocument` 套用），`setAppZoom` clamp [0.5,2] 经 `window.electronAPI.window.setZoom`（preload webFrame）套用；设置「外观」加「界面缩放」滑块（− / 滑块 / + / % / 复位）；`App.tsx` 的 Ctrl+= / Ctrl+- / Ctrl+0 改走 `themeStore.setAppZoom`（键盘改动也持久化、与滑块同步；`/canvas` 仍放行给画板）。② **智能画布节点标题归位卡内**——`NodeShell` 不再把标题浮在卡片上方，改为**卡内顶部标题栏**（左=图标+名 `mb-sc-node-headleft`、右=节点自有控件 `headRight` + 删除 ×，下方 border 分隔），标题色 `--mb-text-secondary`；删 `.mb-sc-node-toptitle`/`.mb-sc-node-x-float` 用法。③ **拖一个节点落到另一个节点上的落点提示**——`CanvasViewport.onNodeDrag` 实时算「拖动节点中心落入某顶层非分组节点」→ 经 `ViewportPortal` 在目标节点上画「上游 / 下游」两半区高亮（半透明黄 `.mb-sc-drophint`，活动半区更亮、非法方向转红），`onNodeDragStop` 清除。零新 IPC。
> **2026-06-06 节点属性面板：浮动跟随选中节点（默认）/ 可钉回右侧**：右侧常驻抽屉既远又"框住"画布 → 改默认**浮动模式**：`useSmartViewStore` 新增持久化 `inspectorFloat`（默认 true）+ `toggleInspectorFloat`；`CanvasWorkspace` 据此渲染——浮动时 `<NodeInspector float />` 落在 `.mb-sc-canvas` 内、固定时仍作右侧 `<aside>` 兄弟。`NodeInspector` 加 `float` 入参：浮动态用 `useStoreApi().subscribe` + ref **imperative** 把面板贴到选中节点屏幕位（默认贴右、越界翻左、夹在画布内，平移/缩放不触发整面板 re-render，rAF 去抖）；**无选中即不渲染**（回到无边框无限感）；标题栏 `⤢`(浮动)/`📌`(钉右) 切换 + 浮动态 `✕` 取消选中。**紧凑化 + 放节点下方**：定位默认贴节点**下方**（越界翻上方、与节点左缘对齐、按上下可用空间自适应 maxHeight 滚动）；`.is-float` 小字号（12px）+ `.mb-sc-form` 改两列 grid——用 `:has(+ .mb-select/.mb-input)` 让「后面紧跟下拉/输入的标签」收第一列、下拉/输入收第二列**横排**，textarea/备注/滑块/按钮占整行 + 紧凑控件高度（26px）。css `.mb-sc-inspector.is-float`。后续图片就地编辑（裁切/翻转/涂抹遮罩）、抠图（去背景 + SAM）、多图排序 + @图N 引用 按用户勾选顺序推进。零新 IPC。
> **2026-06-06 图片生成(work)节点「横向控制台」属性面板**：浮动模式下选中 work 节点 → 渲染宽屏 3:1 横向控制台（`src/pages/SmartCanvas/nodePanel/`，前缀 `mb-np-*`），取代该节点的紧凑浮动检查器；其它节点仍用紧凑浮动检查器，**固定面板(📌)→ 右侧纵向 `NodeInspector`（全字段）**。结构：顶部标题栏（图标 + 「{类型}节点 · 名称」+ 类型标签 + 固定/重置/帮助/关闭）→ 上半三栏（左 节点信息 / 中 生成设置(Tab：基础设置·高级参数·参考图·附加控制) / 右 运行控制）→ 下半三块（提示词工具(Tab：提示词设置·负向·关键词库·快捷模板) / 快捷模板卡片 / 常用变量胶囊）→ 底部状态栏。窗口 `ResizablePanelWrapper`（portal 到 body 避开 `.mb-sc-root` framer transform；拖标题栏移动、右下角缩放、几何记 localStorage、换屏夹回视口内、默认 `clamp(1200,94vw,2400)×clamp(420,58vh,800)` 偏 3:1）。新增可复用控件 `consoleControls.tsx`（SegmentedControl/StepperInput/ColorTagPicker/SearchableModelSelect）；高频参数（运行方式/比例/分辨率/质量）改**按钮组**、模型**可搜索**、张数**步进器**。状态全中文（`RUN_STATUS_LABELS`，不显示 idle）。**数据层仅加 additive 可选字段**：`NodeMeta.name/notes/createdAt`、`WorkNodeData.outputFormat/lastRunAt`（createdAt 在 addNode 打、lastRunAt 在 runWithUpstream 起跑打）；运行/取消/字段/绑定逻辑全部复用 `runWithUpstream`/`cancelWork`/`updateNodeData`/`detectFamily`/`listMappedModels`，未改动。魔法改写/扩写复用 `api:chat:optimize-prompt`、翻译复用 `api:lab:translate`。高级参数(Steps/CFG/LoRA/ControlNet)·参考图权重·关键词库·输出格式落库 = 占位/待接后端。零新 IPC。
> **2026-06-06 控制台精简 + 节点锚定定位（迭代）**：① **删快捷模板 / 常用变量 / 关键词库**——下半部分只剩「提示词工具」一块（提示词设置 / 负向提示词 两 Tab，独占整行、填满剩余高度）；移除 `PromptTemplatePanel`/`VariablePanel`/`appendPrompt`/相关常量。② **布局收紧成「每行多列」**：生成类型+运行方式+执行后端+绘画模型 一行（`.mb-np-r4`）；比例+分辨率+质量 一行（`.mb-np-r3`）；张数+输出格式 一行；节点名称+标签注释 一行；颜色分类+创建时间+最后运行+状态 一行（`.mb-np-inforow` flex-wrap）；高级信息单独一行。下拉（生成类型/执行后端/输出格式）与「运行方式」按钮组**同高(28px)同字号(12px)**。③ **三大模块等高**（`.mb-np-top3 align-items:stretch`）。④ **删冗余**：备注、张数旁「批量设置」按钮。⑤ **节点锚定定位**：`ResizablePanelWrapper` 改成贴所属节点**上方/下方**（按可用空间自动选、随平移/缩放 imperative 跟随，useStoreApi 订阅 RF transform，面板内容不因平移 re-render），**默认宽度 = 屏幕 3/4**，尺寸记 localStorage（位置始终跟随节点、不记）；不再自由拖动，⤢ = 重置尺寸。⑥ ComfyUI 占位文案改为「完整工作流用独立 ComfyUI 节点」。⑦ 固定（钉住）面板字号收紧约 2 档；非生成节点浮动检查器与控制台统一为实色卡片 + 圆角控件。零新 IPC。
> **2026-06-06 控制台去提示词 + 悬浮面板彻底修好（改 in-canvas absolute）**：① **生成(work)控制台彻底去掉提示词区**——删 `PromptToolsPanel`（正向/负向 textarea + 魔法改写/扩写/翻译）+ `textModels`/`promptTab`/`optimize`/`listMappedModels` 依赖，下半改一条说明条 `.mb-np-prompthint`「本节点不填提示词，提示词从上游连进来」。控制台只剩 节点信息 / 生成设置(模型·类型·比例·分辨率·质量) / 运行控制(seed·张数·输出格式·运行) 三栏。dock 检查器(`NodeInspector`)的 work 分支也同步删掉 提示词/负向提示词两框（保留 seed/张数）。work 节点 `prompt`/`negativePrompt` 字段保留（默认 ''，runner 仍与上游合并），仅 UI 下线。② **「悬浮面板完全看不见」根因 = portal 到 body + position:fixed**——落到了 app 另一个层叠上下文后面（而 `NodeInspector.is-float` 是 `.mb-sc-canvas` 内 `position:absolute z-index:7` 所以一直正常）。`ResizablePanelWrapper` **重写**：去掉 `createPortal`，直接渲染在 `.mb-sc-canvas` 内、`.mb-np-window.mb-card { position:absolute; z-index:8 }`，坐标天然相对画布 pane（与 ReactFlow transform 同系，无需补窗口偏移）；夹在画布范围（`st.width/height` 回退 `.mb-sc-canvas` rect）。③ **默认宽 = 画布 3/4**：pane 尺寸要挂载后才知道，加一次性 `didInitSize` layout effect 在无保存几何时套 `defaultSize(pane)`；geom key 升 `v3`。④ `smartViewStore` 加 `version:1` migrate 一次性把 `inspectorFloat` 复位 true（保险）。零新 IPC。
> **2026-06-07 控制台再调 + 节点面板风格统一**：① **工具栏缩放去重**：缩放百分比按钮改「点击恢复 100%」(`zoomTo(1)`)，与第 4 个「适应全部」(`fitView`) 区分（原先两者都 `resetView` 重复）。② **生成控制台 比例/分辨率/质量 重排**：比例占左列、右列上下叠放 分辨率(上)/质量(下)（`.mb-np-szrow`+`.mb-np-sz-right`）。③ **去重复操作**：删底部操作栏 `NodePanelFooter`（其「收起」=顶部 ✕、「面板设置」=顶部 📌，全重复）；标题栏去掉 ⤢ 与冗余类型标签，只留 📌 固定 / ✕ 关闭。④ **面板宽高随内容自适应**：`ResizablePanelWrapper` 加 `autoSize`（work 控制台启用）——`width:max-content` + JS 量 max-w/max-h 夹在画布内、`ResizeObserver` 跟随内容变化重定位、无拖拽缩放手柄；三栏给定宽度（232/468/248）使宽度稳定、控件在栏内换行。⑤ **风格统一**：`NodeInspector`（所有非 work 节点的浮动 + 固定面板）改用控制台同款标题栏（复用 `mb-np-header`：类型图标 + 「{类型}节点」+ 📌/⤢ + ✕/›，scoped 收紧尺寸），叠加既有控件圆角/紧凑样式 → 与生成控制台同一设计语言。⑥ **删冗余备注**：精简 work/mock/strength/comfy/group/angle/scale/result 各处过长 `mb-sc-note`。零新 IPC。
> **2026-06-07 去标签/注释/颜色 + 生成控制台长条化 + 连线删除钮放大 + 自动结果节点**：① **取消所有节点的「标签 / 注释 / 颜色分类」**——删 `NodeInspector` 标签编辑行 + `LABEL_COLORS`、`NodeShell` 不再渲染 `mb-sc-node-tag` 彩条（`label`/`labelColor` 字段保留为休眠，仅 UI 下线）、生成控制台删整张「节点信息」卡。② **生成控制台改长条形**：`NodeWorkConsole` 重写为横向「字段块」长条（`.mb-np-bar` flex-wrap + `.mb-np-bf`，max-width 760 → 宽>高、autoSize 高度随内容），去掉底部提示词说明条与 tabs；模型/类型/运行方式/后端 → 比例/分辨率/质量 → seed/张数/格式 → 运行，分隔线分组；「更多」展开高级参数（strength / mock）。③ **连线中点删除钮放大**：`.mb-sc-edge-x` 改 22px 主题色实心圆 + 白环 + 阴影 + `::before inset:-8px` 扩命中区（~38px），hover 放大转 danger 红。④ **自动结果节点**：`store.ensureResultNode(sourceId)` —— 运行 work/comfy 节点时若下游无「结果」节点，自动在右侧建一个并连上（`runWithUpstream` 调用）。零新 IPC。
> **2026-06-07 新节点「文字」（text）**：画布自由文字元素（标题 / 备注 / 标注），双击编辑、失焦退出；右侧属性面板调 字体(`TEXT_FONTS` 预设)/字号(滑块)/颜色(取色器 + 跟随主题)/粗体/斜体/对齐。**无连接口**（纯注释，不参与生成）。新增 `SmartNodeKind 'text'` + `TextNodeData` + `defaultNodeData`/`DEFAULT_SIZE.text` + `TextNode.tsx` + `nodeTypes.text` + 工具坞「文字」入口 + `TextNodeIcon`/`NODE_ICONS.text` + `NODE_TYPE_LABELS.text` + CreateMenu DOWNSTREAM/UPSTREAM 补 `text:[]`。css `.mb-sc-textnode*`。零新 IPC。（配合本日「取消所有节点标签/注释」——画布文字注释改用独立文字节点承载。）
> **2026-06-07 新节点「光源」（light）**：与视角节点同类（接图 → 输出提示词，不直接生图）。圆顶预览拖「光点」调**光照方位(azimuth -180~180)/高度(elevation 0~90)**（中心=顶光、边缘=接近地平线），滑块调**强度/色温**，下拉选**遮挡**（树叶光斑 / 窗格 / 百叶窗 / 树枝 / 薄纱）与**光效**（丁达尔体积光 / 穿过雾气 / 上帝之光 / 逆光轮廓 / 镜头光晕）→ `buildLightPrompt`（`lib/lightPrompt.ts` 纯函数）实时拼成中文光照提示词，文本输出喂下游。预览叠加随方位/色温/强度变化的暖/冷光晕。新增 `SmartNodeKind 'light'` + `LightNodeData` + `LIGHT_OCCLUSION_LABELS`/`LIGHT_EFFECT_LABELS` + `defaultNodeData`/`DEFAULT_SIZE.light` + `LightNode.tsx` + runner `collectOwnOutput`/`computeUpstream` 两处 `light` 分支（同 angle-prompt） + `nodeTypes.light` + 工具坞「光源」 + `LightNodeIcon`/`NODE_ICONS`/`ACCENT_ICON 'is-light'` + NodeInspector 表单/`NODE_TYPE_LABELS` + NodeSearch 标签 + CreateMenu DOWNSTREAM/UPSTREAM + CanvasViewport 连接集合(PRODUCERS/CONSUMERS/IMAGE_INPUT_ONLY/RESULT_SOURCES) 均比照 angle-prompt 加 `light`。css `.mb-sc-light-*`。零新 IPC。
> **2026-06-07 全部参数搬到节点上 + 取消自动弹属性面板 + 竖图完整显示**：① **竖图不裁切**：视角/光源预览图 `background-size: cover→contain`（+ no-repeat），上游竖图完整可见。② **属性面板默认不弹**：`smartViewStore` 加 `inspectorOpen`（默认 false）+ `toggleInspectorOpen`/`setInspectorOpen`；`CanvasWorkspace` 删除「选中即浮动/钉住弹面板」，改为仅当 `inspectorOpen` 时右侧常驻 `NodeInspector`（可选）；工具栏加「属性面板」开关（`EditIcon`，默认关）；`NodeInspector` 标题栏简化为单个 ✕ 关闭。`NodeWorkConsole` 不再渲染（横向控制台退役，保留文件未删）。③ **全部节点可在节点上调全部参数**（无需面板）：**生成(work)** 节点卡内置 模型/类型/运行方式/后端/比例/分辨率/质量/seed/张数 + 上游预览 + 运行 + 结果（去 autoGrow，`DEFAULT_SIZE.work` 给定 284×430）；**缩放(scale)** 卡内置 模式/各参数(ClampNum 失焦提交)/等比/仅缩小/格式；**LLM** 卡内置 操作/模型/反推类型 或 输入+指令（聊天页加模型下拉）；**ComfyUI** 卡内置 模板下拉(`pickTemplate`)+动态控件（`renderComfyControl` 抽到共享 `comfyControl.tsx`，检查器与节点共用）；**文字(text)** 选中时节点上方浮排版工具条（字体/字号/颜色/粗/斜/对齐/删除）。复用 `consoleControls` 的 `SegmentedControl`（`consoleControls.tsx` 自带 `import nodePanel.css`）。css `.mb-sc-wctl/.mb-sc-wlabel/.mb-sc-wgrid2/.mb-sc-text-tb*`。零新 IPC。
> **2026-06-07 回退到弹窗式属性面板（仅视角/光源留节点内）+ 下拉不截断 + 控制台加宽变矮**：① **除 视角(angle)/光源(light) 外，其余节点全部改回弹窗调参**——`CanvasWorkspace` 恢复：生成节点→`NodeWorkConsole` 横向控制台弹窗、其它非 视角/光源 节点→`NodeInspector float` 浮动检查器；视角/光源仍在节点卡上直接调（`ON_NODE_TYPES` 排除，不弹）。WorkNode/ScaleNode/LlmNode/ComfyNode/TextNode 节点卡**回退为精简版**（摘要 + 预览 + 运行 + 结果），参数回到弹窗里调；`DEFAULT_SIZE` 同步还原（work/scale/comfy/llm）。删工具栏「属性面板」开关 + `smartViewStore.inspectorOpen`（`inspectorFloat` 恢复默认 true）；`NodeInspector` 浮动标题栏复原（✕ 取消选中）。② **下拉文字截断修复**（issue 2）：浮动检查器表单由「标签|控件 两列挤压」改为**单列、控件满宽 + 下拉字号 12→11px**，长模型名/选项完整显示（`.mb-sc-inspector.is-float .mb-sc-form` 改 flex 列 + `.mb-select{width:100%}`）。③ **自适应**：控制台 autoSize（随内容）、浮动检查器贴节点且高度随内容（超出滚动）。④ **生成控制台加宽变矮**：`.mb-np-bar` max-width 760→1060（一行放更多字段块 → 行数更少 → 更矮的长条）。零新 IPC。
> **2026-06-07 节点属性面板风格全面统一到「生成控制台」**：用户反馈非生成节点的浮动检查器（如 ComfyUI 节点）与生成控制台风格相差太大（字体粗细 / 选择框大小 / 选择控件风格 / 排布）。**统一全部 `.mb-sc-inspector.is-float` 浮动检查器到控制台 `mb-np-*` 设计语言**：① **CSS（主要）**——标签加粗（11.5px / 600 / 次级色，对齐 `mb-np-flabel`）；下拉/输入统一 28px 高 · 12px · 圆角 9（对齐 `mb-np-window` 控件）满宽不截断；textarea 圆角 9 · 12.5px；表单 gap 9px；**运行按钮渐变实色**（`linear-gradient(135deg, accent→#8b5cf6)` + 阴影，对齐 `mb-np-run`）；**运行状态改胶囊**（新 `StatusPill` 复用 `mb-np-status`：圆点 + 中文 `RUN_STATUS_LABELS`，取代 `状态：idle` 英文裸文本）。② **JSX（按钮组「选风格」对齐）**——LLM 反推类型 / 缩放 输出格式 / 文字 对齐 三处 `<select>` → `SegmentedControl` 按钮组；ComfyUI 动态控件（`renderComfyControl`）走 `.mb-sc-flabel`/`.mb-input`/`.mb-select` 自动继承新样式（即用户截图那个面板直接受益）。`NodeInspector` 新增 `StatusPill` + 导入 `SegmentedControl`/`RUN_STATUS_LABELS`。生成控制台本身不变（本就是基准）；视角/光源仍在节点上调（不走检查器）。零新 IPC。
> **2026-06-07 节点弹窗横向重构 + 提示词/图片取消弹窗 + LLM 聊天自适应 + 生成运行行一行**：① **提示词 / 图片节点取消弹窗**——`CanvasWorkspace.ON_NODE_TYPES` 加 `prompt`/`image`（连同 视角/光源），选中不再弹检查器（二者均在节点卡上直接编辑文本 / 上传图，弹窗无更多可调项）。② **LLM 聊天模式节点自适应**——`LlmNode` 自适应增高 effect 不再在 chat 模式提前 return，改为按**全部对话消息**估高（`estimateTextHeight` 累加 + 头/模型/输入余量，封顶 1100 后内部滚动），切到聊天 / 每来一条消息都把节点撑高尽量完整展示。③ **生成控制台运行行改一行**——`NodeWorkConsole` 把 预览 / 清除 / 待运行(StatusPill) 收进 `.mb-np-run-side` 排到「运行」按钮**右侧一行**（`.mb-np-bar-run` 由 column 改 row + `margin-top:18px` 对齐控件行）。④ **其余所有节点弹窗（非生成）改横向布局**——`.mb-sc-inspector.is-float .mb-sc-form` 由单列 flex 改 **CSS Grid**（`repeat(auto-fill, minmax(150px,1fr))`），紧凑字段块多列横铺、放松内容（textarea / 运行行 / 结果 / 备注 / 错误 / 日志）`grid-column:1/-1` 占整行；面板宽度 `clamp(380px,44vw,600px)`（宽屏横向）。新增 `Field` 助手（`.mb-sc-fb` 字段块，`wide` 占整行）重写 llm / comfy / scale / group / text / result 各分支为字段块；ComfyUI 动态控件（`.mb-sc-cfield`）`:has(textarea/.mb-sc-range)` 自动占整行、其余横铺；取色器固定 44px。运行按钮渐变（`.mb-sc-run`）+ `.mb-sc-runrow` 运行/状态/导出日志一行。生成控制台本就横向，不在本轮改动范围。零新 IPC。
> **2026-06-07 生成运行按钮放大 + ComfyUI 弹窗分模块横向铺开**：① **生成控制台运行行**——运行按钮放大（`.mb-np-run` 40px / 14.5px / 加粗），`.mb-np-bar-run` 改 `flex:1 1 100%` 独占整行 + `.mb-np-run-side margin-left:auto` 把 预览/清除/待运行 推到整行最右（与运行按钮拉开）。② **ComfyUI 节点弹窗改宽屏分模块**（用户反馈：不要竖向拉长，要分模块横向 3:1~4:1 可调大小）——`NodeInspector` comfy 分支不再平铺控件，改按控件标签「{字段} · {节点标题}」的**节点标题分组成模块卡片**（`comfyGroupOf` 拆 ` · ` 取后段作 group、前段作精简字段名；`.mb-sc-modules` flex-wrap 容器 + `.mb-sc-module` 卡片：头=节点名、体=该节点控件竖排），模块卡片横向铺开；面板加 `is-comfy` 类→宽屏 `clamp(680px,82vw,1180px)` + `resize:horizontal` 可拖宽 + `overflow:auto`。模块按 `d.controls` 顺序（Map 插入序）。零新 IPC。
> **2026-06-07 ComfyUI 输入显示纠偏 + 结果网格 + 分组节点去弹窗 + 工具栏分组 + 悬浮窗居中 + 上游喂入输入标黄**：① **ComfyUI 节点「输入」改显示真实上游**——原 `输入：N词·M图` 是 `comfyInputSlots`（工作流**槽位容量**，与是否接线无关 → 误以为有缓存输入）；改为实时 `computeUpstream`：接了显示「上游输入：N 词 · M 图」，没接显示「未接上游 · 可接 X 词 / Y 图（现用工作流默认）」。运行引擎 `runComfyNode` 本就用实时上游、不缓存旧输入（已确认）。② **结果列表改网格**——`ResultActionsBlock` 由「一行一图」改 `.mb-sc-rgrid`（`repeat(auto-fill,minmax(116px,1fr))`）缩略图卡片（图+另存/作参考图，点击放大），按悬浮窗宽度一行排多个。③ **分组节点去弹窗**——`ON_NODE_TYPES` 加 `group`（分组名在节点卡上直接改，弹窗无更多可调项）。④ **底部工具坞「分组」按钮增强**——`CanvasDock` 的「分组」按钮：选中 ≥2 个顶层非分组节点时点它＝直接 `groupSelection()` 把它们成组；未选则照旧（武装放置一个空分组节点）。不在顶部工具栏另加按钮。⑤ **浮动检查器居中节点正下方**——`NodeInspector` reposition `left` 由「贴节点左缘」改「以节点中心对齐」（控制台 `ResizablePanelWrapper` 本就居中）。⑥ **上游喂入的输入框标黄 + 去输入框**——`NodeInspector` 算选中节点 `computeUpstream`：被上游覆盖的输入改成黄色「由上游输入」一行字（省空间 + 防误填）。LLM `输入文本`（上游有提示词时）、ComfyUI 文本控件（文本槽 i 被喂入 ⟺ 上游提示词数 > i，与运行引擎同逻辑）、ComfyUI 图片控件（接了=黄「由上游输入图片」/没接=灰「用工作流默认」）。css `.mb-sc-fromup(.is-fed)` / `.mb-sc-rgrid` / `.mb-sc-rcard`。零新 IPC。
> **2026-06-07 分组节点头部精简**：自动分组后子节点会遮住分组的说明文字/统计 → `GroupNode` 去掉那段 `mb-sc-empty` 说明文字（「拖更多节点进框自动归入…」），把**节点数「N 项」移到分组名输入框同一行右侧**（`.mb-sc-group-titlerow`，位于子节点之上不被遮），并移除头部右上角原「N 项」徽章（避免重复）。折叠态摘要仍含节点数。零新 IPC。
> **2026-06-07 ComfyUI 强制重置 + 子节点移出分组 + ComfyUI 弹窗去结果模块**：① **ComfyUI 节点「强制重置」**——「点取消没反应、后台又查不到任务」的卡死场景：新增 `forceResetComfy(id)`（runner）——不依赖后端，清掉所有指向该节点的 `pendingComfy` 在途记录 + 唤醒所有等待（释放并发槽）+ best-effort `comfyui.cancel`，直接把节点状态拉回 `idle`；ComfyNode 运行态下「取消」旁加「强制重置」按钮。② **子节点移出分组**——大分组会因 setNodeParent 自动扩容而"吞回"被拖动的子节点，难以拖出 → `CanvasViewport.onNodeContextMenu` 对有 `parentId` 的节点加「移出分组」（`setNodeParent(id,null)`）→ 移出后即顶层节点可正常删除（× / 右键删除节点本就可用）。③ **ComfyUI 弹窗去结果模块**——`NodeInspector` comfy 分支删掉 `ResultActionsBlock`（结果在节点卡上看 / 连「结果」节点查看，弹窗里作用不大）。零新 IPC。
> **2026-06-07 ComfyUI 主模块（/comfyui）也加强制重置**：用户澄清「工作流」指主模块 ComfyUI 编排器（非智能画布节点）。`useComfyuiRunStore` 加 `forceReset()`（running/progress/queue/currentRunId/currentBatchId/lastError 清回空闲，**保留 outputs**）；`RunControl` 运行态下「取消」旁加「强制重置」按钮（best-effort `comfyui.cancel(batchId)` + 立即 forceReset，不依赖后端，救「点取消没反应、后台又查不到任务」的卡死）。零新 IPC。
> **2026-06-07 补做两个欠的功能：节点右键菜单丰富 + 新增「对比」节点**：① **右键菜单丰富**——`CanvasViewport.onNodeContextMenu` 顶部按节点类型加专属操作（`nodeTypeActions`）：生成/ComfyUI/LLM →「运行此节点」；图片 →「从图库选图」；有图的（图片/生成/ComfyUI/结果）→「放大预览 / 另存 / 入图库」；有文本输出的（提示词/LLM/视角/光源/ComfyUI/结果）→「用文本建提示词节点」。复用 `runWithUpstream`/`makePromptNodeFrom`/`imageSaveAs`/`imageToGallery`/`useGalleryPickerStore`/`useSmartPreviewStore`/`useSmartResultStore`，零新 IPC。② **新增「对比（compare）」节点**（第十三类）——接两张图（A=上游第 1 张 / B=第 2 张，把「参考图」与「生成结果」连进来即可对比；也可往左/右半区拖图覆盖 srcA/srcB），节点卡上**可拖动 wipe 分隔线**（`clip-path: inset` 露左侧 A、滑块 0-100），双击放大、「恢复用上游图」。纯查看不生成不输出：`CONSUMERS`+`IMAGE_INPUT_ONLY` 加 `compare`（只接图片来源），不在 `PRODUCERS`。新增 `SmartNodeKind 'compare'` + `CompareNodeData{srcA?,srcB?,slider}` + 联动全部 `Record<SmartNodeKind>`（DEFAULT_SIZE / defaultNodeData / NODE_ICONS+CompareNodeIcon / DOWNSTREAM+UPSTREAM / NODE_TYPE_LABELS / NodeShell ACCENT_ICON / CanvasDock / NodeSearch）+ `CompareNode.tsx` + `nodeTypes.compare` + `ON_NODE_TYPES`（卡上调，不弹窗）。css `.mb-sc-cmp*`。零新 IPC。
> **2026-06-07 拖节点到节点自动连线改用「鼠标位置」判定**：`CanvasViewport.onNodeDragStop` 与 `onNodeDrag`（落点提示）的命中判定由「被拖节点中心」改为「鼠标松手/拖动位置」（`screenToFlowPosition(e.clientX/Y)`）——松在哪个节点上、落哪半区就连哪个，更符合直觉；无 clientX（触摸）回退到节点中心。仅改命中坐标，连线方向/合法性/归组逻辑不变。零新 IPC。
> **2026-06-07 视频生成功能启动（Stage 1：配置数据底座）**：用户决定接入 AI 视频生成（解除原 v1.0 「不做视频」铁律）。调研结论：各家（可灵/Runway/Luma/Pika/海螺/Vidu/万相/混元/Seedance/Sora/Veo）**几乎全异步**——提交任务→轮询状态→取有时效的 mp4 URL→下载落盘；中转站三种范式：**kling 代理型**（`POST /kling/v1/videos/{text2video|image2video}`，最主流）/ **sora 原生**（`POST /v1/videos`）/ **unified 聚合**（`POST /video/generations`）。**本 Stage 落地配置底座**：`ApiConfigType` 加 `'video'`；新增 `VideoKind='kling'|'sora'|'unified'|null`（domain.ts）；`ApiConfig`/`ApiConfigInput` 加可选 `video_kind`；zod `apiConfigInputSchema.type` 加 'video' + `video_kind` 校验 + `TestConnectionSchema`/`TestConnectionInput` 加 'video'；DB **schema v15**：`api_configs` 加 `video_kind TEXT` 列；`settings.ts` load/upsert/listConfigs 全链路读写 `video_kind`（仅 type='video' 落值，其余恒 NULL）。**待续 Stage 2/3**：设置页视频模型分类 UI（仿图片配置 + video_kind 下拉 + 时长/分辨率/画幅特有项）/ 异步视频引擎 `electron/services/video/` + `api:video:*` IPC（提交/轮询/取消 + 下载落盘 + 入图库，按 video_kind 走三套协议模板）+ 智能画布「视频」节点（真实生成，替代 mock）。零新 IPC（本 Stage 仅数据层）。
> **2026-06-07 视频生成功能落地（Stage 2/3/4，端到端可用）**：① **设置页「视频模型」分类**（仿绘画配置）——`ConfigList` 加「视频模型」按钮 + 「视频」分组；编辑器 `draft.type==='video'` 时渲染「视频 API 协议」下拉（`VIDEO_KINDS`：kling/sora/unified）+ 协议说明 + 复用「请求体覆盖」（image/video 共用）；`openNew('video')` 默认 `video_kind='kling'`；模态标题/草稿构造全链路支持 video。② **异步视频引擎 + IPC**（`electron/ipc/video.ts`）——`api:video:generate`（立即返回 taskId，异步跑）+ `api:video:cancel`；按 `video_kind` 走三套协议：**kling**（`{root}/kling/v1/videos/{text2video|image2video}` 提交 → 轮询 `.../{task_id}` → `data.task_result.videos[0].url`）、**sora**（`{base}/v1/videos` → 轮询 `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content` 直取 mp4 字节）、**unified**（`{root}/video/generations` → 轮询 → `video.url`/`data[0].url` 等多字段兜底）；提交/状态/取 URL 都有跨站字段容错（`extractTaskId`/`extractStatus`/`extractVideoUrl`），`applyOverrides` 顶层合并 `body_overrides_json`；下载 mp4 → 落盘 `image_storage_path/<date>/video-*.mp4` → INSERT INTO images（入图库，缩略图 NULL、notes `[video]`）；进度/完成走 `video:progress`/`video:done` 推送；`AbortController` 取消 + 10min 超时兜底。preload 加 `video` 域 + 两个 push 通道；zod `VideoGenerateSchema`/`VideoCancelSchema`；`ipc/index.ts` 注册。③ **智能画布「视频」节点**（第十四类，真实生成非 mock）——`SmartNodeKind 'video'` + `VideoNodeData`（modelId/prompt/mode/duration/aspect/resolution/seed/status/videoPath/progress/phase/taskId）+ `VIDEO_MODE_LABELS`；`VideoNode.tsx` 卡上选视频模型 + 模式(文生/图生)/时长/画幅(SegmentedControl)/分辨率档位 + 提示词 + 运行/取消 + 进度条 + `<video>` 播放器（右键另存）；runner `runVideoNode`/`cancelVideo`/`routeVideoProgress`/`routeVideoDone`（合并上游提示词+图首帧、提交、等 `video:done`、跨文档回灌 `patchDocNodes`）；`runOne` 分发 + `index.tsx` 注册 video:progress/done 监听。联动全部 `Record<SmartNodeKind>`（DEFAULT_SIZE/defaultNodeData/NODE_ICONS+VideoNodeIcon/DOWNSTREAM+UPSTREAM/NODE_TYPE_LABELS/NodeShell ACCENT_ICON/CanvasDock/NodeSearch）+ `CONSUMERS` 加 video（接提示词+图）+ `ON_NODE_TYPES`（卡上调，不弹窗）+ 右键「运行此节点」。css `.mb-sc-video-prog`/`.mb-sc-video-player`。**已知待优化**：图库里视频暂无封面缩略图（sharp 不解码视频）；视频暂不作下游 result 输入。
> **2026-06-07 修复：新增模型配置保存报错「Too few parameter values」**：上一轮给 `api_configs` 加 `video_kind` 时，`settings.ts:upsertConfig` 的 **INSERT 分支 `.run()` 参数漏了 `videoKind`**（之前 replace_all 按 8 空格缩进只命中两个 UPDATE 分支，6 空格缩进的 INSERT 没命中）→ 19 占位符对 18 参数。补上 `videoKind` 后 19/19 对齐。影响面：**任何新增模型（对话/绘画/视频）保存**都会触发（INSERT 分支共用），非视频专属。
> **2026-06-07 视频节点 → 结果节点联通**：视频节点新增**输出口**（`VideoNode` NodeShell 加 `outputs`；CanvasViewport `PRODUCERS` 加 `video`），可连「结果」节点；`RESULT_SOURCES` 加 `video`（video→result 合法）；CreateMenu `DOWNSTREAM.video=['result']` + `UPSTREAM.result` 加 `video`；`runWithUpstream` 的 `ensureResultNode` 触发加 video（运行视频自动建下游结果节点）。`routeVideoDone` 成功时 `buildVideoResult`（`WorkResult{videos:[mp4], workType:'video-generation'}`）推给下游结果节点（当前文档 `useSmartResultStore.push` + 后台文档按 `readDocDoc` 连线推），结果节点卡片本就渲染 `<video>`；`NodeInspector` 结果分支补「视频输出」展示（`allVideos` + `<video>`）。零新 IPC。
> **2026-06-07 图库视频封面缩略图（免 ffmpeg）**：之前视频入图库后 `thumbnail_path` 为 NULL → 图库封面位空。新方案**渲染端抓首帧**：`lib/videoPoster.ts` `captureVideoPoster(url)`——先 `fetch` 成 blob → `createObjectURL`（保证同源、canvas 不被污染）→ 隐藏 `<video>` `loadeddata` 抓首帧 → `<canvas>` `toDataURL('image/webp')`，8s 超时兜底、失败返 null。`routeVideoDone` 成功且有 `imageId` 时后台静默抓帧 → 新 IPC `api:video:save-thumbnail`（`VideoSaveThumbSchema{imageId,dataUri}`）→ 主进程 sharp 把 webp 写到 `thumbPathFor(file_path)`（`.thumbs/{base}.webp`）+ `UPDATE images.thumbnail_path`。`VideoAPI.saveThumbnail` + preload 暴露。失败一律 severity `silent`（封面是锦上添花）。**仅对新生成的视频生效**；本次之前已入库的视频无封面（重生成即有）。
> **2026-06-07 多智能体自检修复 8 个 bug**（视频功能 + 本会话改动审查，全部对抗式复核确认）：① **[高] kling mode 字段错**——`video.ts` kling 分支 `mode` 误发 VideoMode（text/image-to-video）且丢弃用户的 std/pro；改 `klingMode(p.resolution)` 归一成 std|pro（文/图生已由 URL 区分）。② **[中] 视频兜底超时不收尾**——`runVideoNode` 11min 超时回调只 resolve，不复位节点/清 pending → 丢失 video:done 时永久卡「生成中…」+ Map 泄漏；改为复位 error + 清两个 Map（跨文档用 patchDocNodes）。③ **[中] light 漏注册 CreateMenu**——`DOWNSTREAM/UPSTREAM` 凡有 angle-prompt 处补 light（快捷创建菜单与 canConnectKinds 对齐）。④ **[中] ensureResultNode 对 video 空操作**——`smartCanvasStore` 类型判断加 video（运行视频自动建结果节点，与 work/comfy 一致）。⑤ **[中] 配置导出/导入丢 video_kind**——`configIO.ts` 导出 SELECT + 导入 INSERT 列/占位/参数补 video_kind（按 kling/sora/unified 白名单归一）；否则 sora/unified 配置导出再导入被静默重置为 kling。⑥ **[低] canConnectKinds 对 video 源过度放行**——加 `sk==='video' → 仅 tk==='result'`（video 产出只有结果节点能消费）。⑦ **[低] 视频任务不进通知中心**——`helpers.WRITE_CHANNELS` 加 api:video:generate/cancel + `video.ts` done() 调 appendNotification（与图片任务一致）。零新 IPC（仅修复）。
> **2026-06-07 全项目自检第二轮修复 4 个 bug**（4 个并行智能体审查 主进程/SmartCanvas/其余渲染端/四层契约一致性，全部对抗式复核确认；SmartCanvas 与 IPC 契约本轮判定为干净）：① **[中] 保真放大进度条永不动**——`RealESRGANPanel` 的 `upscale:progress` 监听用 `currentTaskId !== p.taskId` 过滤，但 `currentTaskId` 被设成渲染端自造的 `local-…` reqId（后端 taskId 完成时才知道）→ 永不相等，所有进度事件被丢弃、进度条整轮停在 0%。改：删掉无用的 reqId/`currentTaskId` 机制（取消本就走 `cancel({})`），监听改 `if(!running)return`、effect 依赖 `[running]`。② **[低] 图库自动刷新读旧相册**——Manager 的 `image:done` 监听 effect 依赖只有 `[mode]`，切相册（不切 mode）后 `refreshImages` 闭包仍读旧 `activeAlbumId` → 生图完成后刷出错相册内容。改：依赖加 `activeAlbumId` 重订阅。③ **[低] 激活方案不持久化**——`settingsStore.load` 读 `prefs.active_plan_id` 想恢复上次方案，但 `setActivePlanId` 只改内存、全项目无人写该 key → 每次重启回退到 `plans[0]`。改：`setActivePlanId` 同时 `settings.save({prefs:{active_plan_id}})`（fire-and-forget；按既有 partial-prefs upsert 语义，不动其它 prefs）。④ **[低] `ChatSourcesPayload.backend` 类型窄于实现**——类型只列 native/ddg/tavily/searxng/off，但运行时还会发 bocha/zhipu/jina/serper（无运行期问题，仅类型漂移）。改：补齐 union。**未改（有意保留）**：`tools.ts` 工具箱导入把来源标签写进 `prompt_positive` 是「无 notes 时的展示兜底」，非缺陷。零新 IPC（仅修复）。
> **2026-06-07 视频生成富能力重构（APIMart Seedance 2.0 适配器 + 视频模型配置中心，增量不推翻）**：在现有 kling/sora/unified 简易引擎**之上**新增一套「统一请求 + 供应商适配器 + 富配置 + 校验/费用/历史」，legacy 路径 100% 不动。**配置存储**＝settings 表 `video_providers_json`（用户决策，零 DB 迁移）＋复用 api_configs(type='video') 存凭证；新增 `video_kind='seedance'|'custom'`（`normalizeVideoKind` 单一白名单，归一 4 处：schemas/settings×2/video.ts/configIO）。**共享层**（`@shared/video`＝统一 `VideoGenerationRequest`/`VideoTask`/7 模式 + 纯 `validateVideoRequest`/`estimateVideoCost`；`@shared/videoProviders`＝capabilities/limits/defaultParams 类型 + 内置 APIMart Seedance 模板（4 模型：fast/标准/fast-face/face，1080p 仅后两者）+ `mergeVideoProvidersConfig`/`findVideoModel`/`needsCostConfirm`）。**主进程**（`electron/services/video/`：`VideoProviderAdapter` 接口 + `ApiMartSeedanceAdapter`（7 模式映射 text/image/首尾帧 image_with_roles/参考图·视频·音频/连续 return_last_frame）+ `CustomVideoAdapter`（基础预留）+ registry + 通用提交/轮询/归一/取消）；`video.ts` generate 在 seedance/custom 时委派 adapter（强校验 + 并发闸门 maxConcurrentTasks + 友好错误 + API Key 脱敏 `scrubKey`），其余走 legacy。零新 IPC（复用 `api:video:generate`，仅给 `VideoGenerateInput` 加可选 `request`；payload 加 `lastFrameUrl`/`remoteUrl`/`state`）。**渲染端**：`videoProvidersStore`（配置中心，ensureLoaded/save/恢复默认）+ `videoHistoryStore`（localStorage 任务历史，data:URI 脱量、上限 100）；设置页 `VideoProvidersCenter`（端点/能力/限制/默认参数可视化编辑 + 导入模板 + 恢复默认 + 本地连接检查不烧钱 + 费用阈值 + 历史查看）；`VideoNode` 扩 7 模式（按能力自适应显隐）+ 费用预估 + 「校验」dry-run + 高费用**二次确认 + 一键降本** + 连续生成（末帧→下一段首帧）；runner `dryRunVideo`/`runVideoNode`（adapter 构 request + 上游图转 dataURL + 校验后提交）/历史收尾。新增纯函数补 `videoProviders.test.ts`（23 例：合并/查找/校验/费用/模式归一）。**基础预留（v1 未全做）**：素材上传层（参考视频/音频走公网 URL，无 uploadEndpoint 时不自动上传）、命名多端口（仍走上游聚合 + 节点字段）、Kling/Veo/Runway/fal 适配器（registry 留位）、自定义供应商可视化字段映射。验证：web/node tsc 绿 · 74 tests · electron-vite build 绿。
> **2026-06-07 视频生成收尾（补完素材上传 + 批量 + 角色化素材）**：① **素材上传层**（Phase 10 做完）——新增 `api:video:upload-asset`（主进程 multipart：本地视频/音频 → 供应商 `uploadEndpoint` → 公网 URL；无端点明确报错引导用公网 URL，不把 file:// 发远端；大小/格式校验 + 上传响应多字段 URL 提取 + Key 脱敏）；复用 `chromiumFetch` 的 FormData/Blob multipart 能力。preload `video.uploadAsset` + ipc 类型 `VideoUploadAssetInput` + `WRITE_CHANNELS`。② **批量任务**（Phase 11 #13/#14 做完）——`runVideoBatch(id,count)` 顺序跑 N 次（有 seed 逐次 +1 取变体，失败即止避免连环烧钱）；节点上批量控件**仅当配置中心 `batchEnabled` 开启**才显示，批量**始终二次确认并显示总预计费用**（单价×N）。③ **角色化素材输入**（Phase 8 意图，功能等价命名端口）——节点按模式渲染 首帧/尾帧（选本地图 dataURL 内联 / 用上游）、参考图（上游 N + ＋本地）、参考视频/音频（URL 文本 + ＋上传本地）、连续（上一段末帧/清除）。runner `sendableUrl` 导出供节点把本地图转 dataURL。**仍保留（按你原 spec 或架构权衡）**：Kling/Veo/Runway/fal 适配器（你标的「后续预留」，registry 留位）、字面多 Handle 命名端口（会牵动全 14 节点的按-handle 连线校验，回归风险大；用角色分配 UI 等价替代）、历史「重载参数到节点」（跨页，节点已有「继续下一段」）。验证：web/node tsc 绿 · 74 tests · build 绿。
> **2026-06-07 视频适配器扩到 Veo/Runway/fal + 多智能体调研&审查修 9 bug**：① 用调研工作流确认 Kling/Veo/Runway/fal 真实 API 形态后，新增 **3 个适配器**（`electron/services/video/moreAdapters.ts`：`VeoAdapter` 中转 OpenAI 兼容 /v1/videos/generations；`RunwayAdapter` /runwayml/v1/{text_to_video|image_to_video}＋X-Runway-Version 头＋ratio 分辨率串映射＋/tasks/{id} 轮询＋output[0]；`FalAdapter` queue.fal.run/{model_id}＋`Authorization: Key`＋status_url/response_url 轮询＋video.url）+ registry/enum(`VideoKind`/`VIDEO_KINDS_LIST`/`videoKindSchema`/`ADAPTER_VIDEO_KINDS`)/设置下拉/内置 provider+模型模板(`mkModel`)。**Kling 仍走 legacy 引擎**（调研确认 legacy 形态正确，不重路由免破坏）。**无能力模板的自定义模型 id → 宽松校验**（有输入即放行，不被拦）。② 审查工作流(4 维×find→对抗式 verify)确认 9 个真 bug 并全修：**[高] 批量中途取消不停**（runVideoBatch 只在 status==='error' 中断，但取消置 idle → 继续烧钱；改为同时判 `taskState==='cancelled'`）；**[中] Seedance 只发 size 不发 aspect_ratio**（画幅丢失；改为同时发 aspect_ratio+size）；**[中] continuous 模式误判能力**（gate 在 returnLastFrame 应为 continuousVideo；videoProviders 与 VideoNode MODE_CAP 同步改）；**[中] sendableUrl 失败回退原始本地路径**（会把 file:///mengbi-image:// 发远端/泄露；改为失败返 null + 调用方中止 toast）；**[中] 渲染端 660s 兜底 < 用户调高的 provider.timeout**（成功结果被提前判超时丢弃；改 `fallbackMs=max(660s, providerTimeout+90s)`）；**[低] Runway 进度 0..1 被夹成 12%**（归一×100）；**[低] i2v 用 imageUrls 作首帧被 maxReferenceImages=0 误拦**（imageUrls 仅在 reference_images 模式计入参考图）；**[低] 选中模型变更后 d.mode 不收敛**（加 reconciliation effect）；**[低] upload-asset 无 URL 错误路径漏 scrubKey**（补脱敏）。**未改**：settings.get 回传 api_key_plain 给渲染端（审查复核为「全应用既有、编辑预填依赖的有意设计」，非视频缺陷，video 路径本身不消费它）。新增 6 例回归测试（共 80 例）。验证：web/node tsc 绿 · 80 tests · build 绿。
> **2026-06-07 视频节点改弹窗控制台 + 全节点右下角拖拉角标**：① **视频节点设置改弹窗式控制台**（与生成节点同设计语言）——新增 `nodePanel/NodeVideoConsole.tsx`（复用 `ResizablePanelWrapper` autoSize + `mb-np-*` 样式 + `consoleControls`），选中 video 节点时由 `CanvasWorkspace` 弹出（`selType==='video'`），承载 模型/模式(按能力)/时长/画幅/分辨率/seed/有声/末帧 + 素材(首尾帧·参考图·参考视频/音频上传) + 提示词/负向 + 费用预估 + 校验(dry-run) + 生成(二次确认) + 批量。**自适应大小**（`is-autosize`：宽随内容、超高内部滚动）→ 解决「展开内容缺失」。`video` 从 `ON_NODE_TYPES` 移除、从 `NodeInspector float` 分支排除。视频**卡片**瘦身为：模式/参数摘要 + 上游 + 状态/进度 + `<video>` 播放 + 下载 + 继续下一段（设置/运行都在弹窗里）。② **每个节点右下角加可见「拖拉角标」**——CSS 把 `.react-flow__resize-control.handle.bottom.right` 由隐藏改为可见 accent 抓手（白描边圆角），`::before inset:-11px` 把命中区扩到 ~36px、hover/选中再放大，解决「边框判定范围过小」；14 个节点都用 NodeResizer 故全覆盖。零新 IPC。验证：web/node tsc 绿 · 80 tests · build 绿。
> **2026-06-07 视频节点弹窗细化 + 生成节点改名「生图」**：按反馈修：① **运行按钮回到节点**——抽出共享 `nodePanel/VideoRunControls.tsx`（生成/校验/批量/二次确认/费用/状态），**卡片**(compact：生成+取消+状态) 与 **控制台**(full：+校验+批量+费用) 共用，和生图节点一样「卡上能跑、面板里也能跑」。② **画幅比例变多**——无模型时回退到更全的 `COMMON_ASPECTS`（16:9/9:16/1:1/4:3/3:4/21:9/2:3/3:2/adaptive），有模型用其 `supportedAspectRatios`，并加 **「自定义」** 输入（任意比例）。③ **控制台不再顶边**——下半身（素材/提示词/负向/运行）包进带内边距的 `.mb-np-vbody`（8/14/14），与生图控制台一致的左右下留白。④ **提示词上游接入标黄**——上游有提示词时显示黄条「由上游输入 N 条（与下方合并）」+ textarea 标黄（`.mb-sc-textarea-fed`）。⑤ **视频卡片缩小**——`DEFAULT_SIZE.video` 340×520→**268×230**（=生图节点宽度），设置全在弹窗里、卡片只留摘要+运行+播放，解决「展开内容缺失/节点过大」。⑥ **「生成」节点全量改名「生图」**——`CanvasDock`/`CreateMenu`/`NodeInspector NODE_TYPE_LABELS`/`NodeSearch`/`WorkNode` 卡标题 + 控制台标题「生图节点 · {类型}」。零新 IPC。验证：web/node tsc 绿 · 80 tests · build 绿。
> **2026-06-07 智能画布反馈 8 修 + 视频配置排雷**：① **右下角拖拉角标改 hover-only**——`.react-flow__resize-control.handle.bottom.right` 默认 `opacity:0`，仅 `.react-flow__node:hover/.selected` 时显现（含 `.bottom-right` 变体），加 transition。② **视频卡片文字重叠修复（真因）**——根因不是高度不够，而是共享 `VideoRunControls` 的 `.mb-np-bar-run{flex:1 1 100%}`（为控制台 wrap 设计）在卡片 flex 列里 `flex-basis:100%` 索要整列高度 → flex 过约束把上方摘要行一起压缩到重叠。修：`.mb-np-video-run.is-compact{flex:0 0 auto}`（卡片运行行只占自身高度）+ `.mb-sc-work-line/.mb-sc-work-model{flex-shrink:0}`（摘要行永不被压缩，保护 work/comfy/video 卡片）；`VideoNode` 另加 `autoGrowNode`（基线低于默认高度，仅播放器/进度/错误超高时才增长）。③ **去视频卡片重复「待运行」**——`VideoRunControls` compact 模式不再渲染状态胶囊（节点标题栏已显状态；控制台保留）。④ **节点运行按钮统一渐变**——CSS 作用域 `.mb-sc-node/.mb-np-window/.mb-sc-inspector` 内 `.mb-btn.mb-btn-primary` + `.mb-sc-runbtn:not(.is-stop)` 全改 `linear-gradient(135deg, accent→#8b5cf6)`（与「生成视频」同款），不动全局 `.mb-btn-primary`、危险红保留。⑤ **多参考图序号化**——`NodeVideoConsole` reference_images 模式渲染带序号缩略图条（顺序=实际发送序：上游在前 `参考图 1..N` + 本地续号，本地可单删），对齐 runner `[...upstream, ...local]`。⑥ **更多内容节点自适应**——`ComfyNode`/`ResultNode` 加 `autoGrowNode`（提示词/LLM/生图/视频本就有）。⑦ **生图节点换图标**——`WorkNodeIcon` 改干净「双闪四角星」AI 生成标志。⑧ **节点搜索浮层归位**——根因同 CreateMenu：`.mb-card{position:relative}` 在 bundle 里晚于 `.mb-sc-search{position:absolute}` 且同特异性 → 被顶成 relative 落到正常流末尾（画布最下方）；改双类 `.mb-sc-search.mb-card` 提特异性 + 下移到 `top:52px` 居中浮层 + 强阴影。⑨ **视频配置排雷（未烧钱，纯只读 DB 排查）**——读 `database.sqlite` 实证用户 `api_configs(type='video')`：apimart / `https://api.apimart.ai/v1` / **video_kind='kling'** / model `doubao-seedance-2.0`。两个雷：(a) kling 走 legacy 引擎 `POST {root}/kling/v1/videos/text2video` 且发 `model_name: doubao-seedance-2.0` → Seedance 模型发到 Kling 端点，协议错；应改 `video_kind='seedance'` 用 `ApiMartSeedanceAdapter`。(b) 改 seedance 后 `joinUrl('…/v1','/v1/videos/generations')` 会得 **双 /v1**（base 已含 /v1、endpoint 模板也 /v1 开头）→ 404。**修 `adapter.ts:joinUrl` 防双 /v1**（base 以 /v1 结尾且 endpoint 以 /v1 开头则去重），seedance/veo/custom 在「base 带不带 /v1」两种习惯下都解析正确。零新 IPC。验证：web/node tsc 绿 · 80 tests · build 绿。
> **2026-06-07 多智能体审计「还有什么没做」+ 4 项收尾**：用审查工作流(4 维 find→对抗 verify，20 候选→10 确认、10 误报剔除)审计智能画布+视频。**两维全清**：本会话 8 项 UI 反馈 + 本会话编辑正确性 = 0 真问题（验证全部正确、无回归；唯一"测试失败"是沙箱里 vitest4 对 vite5 的 peer 版本不匹配，非代码缺陷）。**确认并已修的 4 项**：① 新建视频配置默认 `video_kind` 由 `'kling'` 改 **`'seedance'`**（`Settings/index.tsx:318`）——避免给 APIMart Seedance 模型默认错配到 legacy kling 端点。② **视角(angle)节点**加 `autoGrowNode`（按 generatedPrompt 长度撑高）。③ **光源(light)节点**同上。④ **文字(text)节点**加测量式自适应（按渲染 scrollHeight 撑高，字号可变故测量比估算准）+ `.mb-sc-angle-prompt` max-height 92→280（配合 angle/light 增高，长提示词完整可见）。**确认但「按设计推迟/需真机」未改**（如实告知用户、未擅自改）：⑤ 适配器 seedance/veo/runway/fal 均调研推断**未真机实测**；⑥ Seedance `taskQueryEndpoint` 留空、异步轮询兜底未验证（**medium**，需真实 apimart 凭证确认同步/异步 + 正确查询端点）；⑦ 视频产出只能连「结果」节点（不能做视频→视频链路，v1 范围外）；⑧ custom 供应商无可视化字段映射 UI（基础预留）；⑨ 视频节点无 advanced(Steps/CFG) 入口（数据壳已通，可用 body 覆盖替代）；⑩ 图库视频封面仅对新生成 + 抓帧成功者生效（已 silent 容错）。零新 IPC。验证：web tsc 绿 · build 绿。
> **2026-06-07 按 APIMart 官方文档对账修好 Seedance 异步链路（免烧钱、查文档而非真机猜）**：用 WebFetch 读 `docs.apimart.ai` 实证 Seedance 视频 API 真实形态——提交 `POST /v1/videos/generations`（Bearer）**异步**返回 `data[0].task_id`+status `submitted`；查询 `GET /v1/tasks/{task_id}`，状态 `data.status`∈`pending|processing|completed|failed|cancelled`、视频 `data.result.videos[]`、进度 `data.progress`(0-100)。对账发现并修 3 处必坏点：① `adapter.ts:extractTaskId` 原只认 `data.task_id`（对象），APIMart 是 `data:[{task_id}]`（数组）→ 加数组首元素兜底（否则「找不到任务 id」）；② `extractVideoUrl` 原无 `data.result.videos` 分支 → 补（否则「完成但未取到视频地址」）；③ `extractLastFrameUrl` 补 `data.result.last_frame*`。并把 seedance `taskQueryEndpoint` 默认从 `''` 设为 `'/v1/tasks/{task_id}'`（配合 joinUrl 防双 /v1，base 带不带 /v1 都对）。新增 `electron/services/video/adapter.test.ts` 14 例锁死（joinUrl 去重/extractTaskId 数组&对象/extractVideoUrl APIMart·kling·runway/状态归一/fillTaskUrl，共 94 测试）。**结论**：Seedance 文生视频端到端链路按官方文档已对齐（之前标 medium 的「轮询端点未验证」由此解决）；唯一剩真机确认的是图生/参考图模式的图片字段（文档生成端只列 `image_with_roles`，当前 image_to_video 发 `image_urls`，首个文生视频冒烟不受影响、可后续校准）。验证：web/node tsc 绿 · 94 tests · build 绿。
> **2026-06-07 Ctrl 框选时不弹属性面板**：框选过程中节点被逐个选中会让单节点属性面板（NodeWorkConsole/NodeVideoConsole/NodeInspector float）乱蹦遮挡画布、影响框选。`useSmartCanvasUiStore` 加 `boxSelecting` 标志，`CanvasViewport` 的 ReactFlow `onSelectionStart`→true / `onSelectionEnd`→false；`CanvasWorkspace` 仅在 `!boxSelecting && selectedCount===1`（恰好选中 1 个、且非框选中）时才渲染属性面板（多选/框选中一律不弹）。零新 IPC。验证：web tsc 绿 · build 绿。
> **2026-06-07 上游喂入字段统一「标黄 + 去输入框 + 禁手填」全节点对齐**：规则——某字段被上游（提示词文本 / 图片）喂入时，不再渲染本节点的输入框，改成黄色 `.mb-sc-fromup.is-fed`「由上游输入」提示，禁止本节点填入。已有：LLM 输入文本(NodeInspector:760)、ComfyUI 文本/图片控件(NodeInspector:845/852)。本轮补齐：① **视频控制台提示词**——`upFed` 时由「黄底 textarea（可追加）」改为「黄色提示条、无输入框」（与 LLM 一致）；② **视角(angle)节点卡**——上游图片严格优先覆盖本地上传，故上游接入时把「上传/换图」按钮换成黄色「图片由上游输入（实时），本节点上传已禁用」；③ **光源(light)节点卡**——同 angle。判定全部用 `computeUpstream`（up.prompts / up.images）。未改：视频「首帧/尾帧 选本地图」（本地 override 上游是有意的「选源」功能，非冗余填入）；work 提示词框早已下线（天然合规）。零新 IPC。验证：web tsc 绿 · build 绿。
> **2026-06-07 ComfyUI 节点工作流参数改瀑布流（masonry）布局**：每个 ComfyUI 工作流模板暴露的控件数量/高度都不同，原 `.mb-sc-modules` 用 flex-wrap 行布局 → 短模块挨着高模块时整行留参差空隙（很乱）。先尝试 CSS 多列（`column-*`）但**不可行**——它按高度平衡且列数不随项目数封顶：宽面板 + 少量模块时右侧会空一大块（用户实测反馈）。改为 **JS 瀑布流 `ComfyMasonry`**（NodeInspector）：列数 = `min(模块数, ⌊容器宽 / 268 理想列宽⌋)`——**列数永不超过模块数**，故每列恒被 `flex:1` 拉伸填满整宽（右侧绝不留白）；每个模块按「当前最矮的列」贪心放入（按控件类型估高：textarea 104 / slider 52 / 普通 54 / 被上游喂入或图片 36）。容器宽用 `ResizeObserver` 跟随面板拖宽实时重算列数。CSS：`.mb-sc-modules` flex 行 + `.mb-sc-mcol{flex:1 1 0}` 等宽列。效果：先横向铺满、再纵向堆叠（窄面板才堆叠成瀑布）。选 CSS 多列而非 grid `masonry`（后者尚未正式发布、Chromium 未稳定支持）。仅 CSS，JSX/模块结构不变。零新 IPC。验证：build 绿。
> **2026-06-08 智能画布新增 3 节点（图像反推 / 视频上传 / 视频反推）+ 缩放节点支持视频（ffmpeg）+ 视频上游媒体通道**：① **新「视频」上游媒体通道**——`computeUpstream` 由 `{prompts,images}` 扩为 `{prompts,images,videos}`；`collectOwnOutput` + walk 收集 video-source/video(生成)/result.videos/scale.outputVideo；连线校验加 `VIDEO_SOURCES`/`VIDEO_INPUT_ONLY`，`canConnectKinds` 放行 视频→(视频反推/缩放/结果)、scale 接图或视频。② **图像反推节点**（`image-reverse`，CONSUMER 图片→PRODUCER 文本）：接图/上传 → 选视觉对话模型 + 描述/标签/风格 → 复用 `api:lab:reverse` → 文本喂下游；上游有图则「图片由上游输入」标黄禁手填。③ **视频上传节点**（`video-source`，纯 PRODUCER 视频）：上传本地视频(存路径不存 data:URI)/填 URL → 卡上 `<video>` 播放 → 输出视频。④ **视频反推节点**（`video-reverse`，CONSUMER 视频→PRODUCER 文本）：接视频 → `videoPoster.captureVideoFrames` 渲染端均匀抽 N 帧(默认6) → 多图 `api:lab:reverse` → 文本。⑤ **缩放节点支持视频**：上游为视频时显示 宽/高 + 「缩放视频」→ 新 IPC **`api:video:scale`**（主进程 `ffmpeg-static` 重编码 mp4：`scale=W:H`/`-2` 保比偶数边 + libx264/aac + 5min 兜底 + asar→asar.unpacked 路径重映射）→ 输出 mp4 喂下游。新增依赖 `ffmpeg-static`（electron-builder.yml asarUnpack）。新节点联动全部 `Record<SmartNodeKind>`（SmartNodeKind/defaultNodeData/DEFAULT_SIZE/NODE_ICONS/ACCENT_ICON/NODE_TYPE_LABELS/NodeSearch/CreateMenu DOWNSTREAM+UPSTREAM/CanvasDock/nodeTypes/ON_NODE_TYPES/needsRun 级联）+ runner `runImageReverseNode/runVideoReverseNode/runScaleVideo` + `runOne` 分发。仅 1 个新 IPC（`api:video:scale`）。验证：web/node tsc 绿 · 94 tests · build 绿。
> **2026-06-08 创建工具坞永远单行（无限延长）+ 全项目文档同步到当前规范**：① **工具坞单行化**——`.mb-sc-dock` 原 `flex-wrap:wrap`，节点种类一多（现 17 类 + 选择 + 分隔）就向下挤第二行（如「分组」掉到第二排）。改 `flex-wrap:nowrap` + `overflow-x:auto`（超宽时整条横向滚动，带 6px 细滚动条）+ `.mb-sc-dock-group`/`.mb-sc-dock-btn` 加 `flex-shrink:0`（按钮保持原尺寸不压缩）+ `justify-content:safe center`（内容超宽时回退左对齐，避免居中把首项裁到滚不到）。**无论加多少工具都只占一行、可无限延长**。纯 CSS，零新 IPC。② **全项目文档同步**（workflow 并行 8 文档编辑 + 一致性复核）——README / WHITEPAPER / FEATURES / ARCHITECTURE / DEVELOPMENT / ENVIRONMENT / THEMING / 中转站请求体覆盖指南 全部对齐当前实现：6 顶级入口 + Ctrl+1~6、智能画布 17 类节点、视频生成（异步 + 8 种 video_kind + legacy/adapter 双轨）、ComfyUI 编排器、工具箱三引擎（Real-ESRGAN/HYPIR/VTracer·Potrace）、ai-platform 底座、`schema_version=15`、新增依赖（@xyflow/react、ws+expr-eval、ffmpeg-static、background-removal+onnxruntime、sharp、vectorizer+potrace、node-llama-cpp、vitest）；删除/标注已移除（SUPIR、OmniSVG、实验室页、提示词管家 UI、火锅彩蛋、"v1.0 不做视频"旧表述）。③ **主题数量纠偏 7→10（实测代码为准）**——复核发现 `src/types/theme.ts` 的 `ATMOSPHERES` 实为 **10 项**（补 `none`/`warm-jade`/`glass`），原文档 + 本文件 §7.1 的「7 种 atmosphere」「7×10」「70 组合 / 17 套 token」均过时；已全部订正为 **10 atmosphere × 10 palette = 100 组合 / 20 套 token**（CLAUDE §0/§2/§5.11/§6.2/§7.1、README、WHITEPAPER、FEATURES、DEVELOPMENT、THEMING）。仅文档 + 1 处 CSS，零代码逻辑改动。验证：electron-vite build 绿。
> **2026-06-08 工具坞按用途重排 + 修复卡内下拉文字裁切（沉淀为铁律 16）**：① **工具坞分组重排**（`CanvasDock` GROUPS）——按用途分 6 段：输入素材（图片 / 视频上传 / 提示词 / 文字）→ 分析改写（LLM / 图像反推 / 视频反推 / 视角 / 光源）→ 预处理（缩放 / 尺寸）→ 生成（生图 / ComfyUI / 视频）→ 汇总（结果 / 对比）→ 容器（分组）。满足"图片与视频上传同段、图像反推+视频反推+LLM 同段"。② **修复图像反推 / 视频反推节点下拉框文字竖向裁切**——根因：全局 `.mb-select`/`.mb-input` 自带 `padding:10px 14px` + 全局 `box-sizing:border-box`，而 `.mb-sc-wctl`/`.mb-sc-revctl` 给控件写死 `height:28px`，固定高被 padding 吃掉→文字被裁。这正是"每次新建节点都出现的 UI 问题"的统一根因。**修法**：把 `.mb-sc-wctl`/`.mb-sc-revctl` 的控件规则统一改成 `min-height:32px + padding:6px 12px + height:auto`（不再写死 height，永不裁切），字体 13px / 圆角 10px 向全局标准靠拢；视角/光源的 `.mb-sc-light-selrow` 本就用全局完整尺寸，作合规样板。③ **沉淀规范**：新增 §9 铁律 16「智能画布卡内控件不写死 height」——新建节点的卡内控件一律复用 `.mb-sc-wctl`/`.mb-sc-revctl`/`.mb-sc-light-selrow` + 全局控件类 + `SegmentedControl`，不再发明新容器后自写 height，从源头杜绝该类 UI 不一致。仅 CSS + 数据数组重排，零新 IPC。验证：web tsc 绿 · build 绿。
> **2026-06-08 多智能体审计后「便宜高价值」修复打包**：对全库做了 6 维并行审计（未完成功能/健壮性/测试缺口/UI 可用性/性能/安全），本轮先落地一批小改高收益项：① **Real-ESRGAN 放大子进程加看门狗**（`realesrganRunner.ts`）——外部 `realesrgan-ncnn-vulkan.exe` 若 GPU/驱动死锁会永久阻塞主进程串行放大队列；加 idle 看门狗（每条 `XX.XX%` stderr 重置，连续 300s 无输出→kill + 报「放大超时」），对照 ffmpeg 路径补齐。② **全局 `:focus-visible` 焦点样式**（`global.css`）——原来纯键盘用户 Tab 到按钮/链接/节点看不到焦点；加一条全局规则（accent 描边，鼠标点击不显示），输入类已有聚焦环故排除避免双环。③ **视频「＋上传本地视频/音频」按钮空端点时不再必失败**（`NodeVideoConsole`）——内置供应商 `uploadEndpoint` 均空，按钮点了 100% 报错；改为 `getVideoProvider(merged, videoKind).uploadEndpoint` 为空时不渲染按钮、改提示「直接填上方公网 URL」。④ **生图节点「输出格式」死控件标注**（`NodeWorkConsole`）——`outputFormat` 全项目无人消费（选 JPEG/WebP 不生效），标签改「输出格式（暂未生效）」+ tooltip 说明，避免误导（待后端接落盘转码再去标注）。⑤ **文档回正**：`generate.ts` `{{lora}}` 注释「暂未传入」已 stale（`imageParamsStore` 早已注入 `params.lora`）→ 改正；CLAUDE §4.9 ComfyUI 编排器「Ctrl+7 / 第一阶段已落地」→ 改「Ctrl+4 / 现已全部落地」（GraphCanvas/applyBindings/applyBypass/LoopPanel/RunRecords 均在）；§4.10 本地 LLM「开发中」→ 分清「已可用（.gguf 选择 + lazy 推理）vs 仍开发中（多模型切换/参数面板/缓存）」。**未做（已知、需你定方向）**：安全三件套（API Key 明文落库`safeStorage` 已 no-op / `mengbi-image://` 任意文件读 / `settings.get` 明文下发）——其中 Key 加密 vs 明文是产品权衡，待拍板；对话流式空闲超时、视频/DDG 下载超时；veo/runway/fal 空 baseUrl 预提交守卫（`enabled` 标志查明仅控制配置中心勾选显示、不 gate 功能，单纯翻 false 无意义）；ComfyUI/连线校验/视频提取器等纯函数补测。验证：web/node tsc 绿 · test 绿 · build 绿。
> **2026-06-08 「尺寸分析」节点扩展为「尺寸来源」节点（ratio，改造非新增 kind）**：把原 `ratio`（纯展示：接图显示比例/各档分辨率/GPT 预算）扩成**尺寸来源**——① 节点卡上选 **预设尺寸**（`SIZE_PRESETS` 8 档横竖方，宽高均 16 倍数）/ 填 **自定义宽高**（`ClampNumberInput` 失焦提交，clamp[256,4096] + snap16）→ 输出统一的 `SizeSpec{aspect,width,height}`；② **保留接图分析**（可选连图显示其比例/1K-2K-4K + 「采用此尺寸」一键填自定义）；③ **去掉悬浮属性面板**（`ratio` 加入 `ON_NODE_TYPES`，全在卡上调）；④ 新增**输出口**，连线**受限白名单**：`ratio` 只能连 生图(work)/ComfyUI(comfy)/视频(video)（`canConnectKinds` 加 `sk==='ratio'` 钳制 + `invalidReason` + `PRODUCERS` 加 ratio；接图侧仍走 `IMAGE_INPUT_ONLY`，两路正交）。**新尺寸上游通道**：`computeUpstream` 由 `{images,prompts,refs,videos}` 扩为加 `sizes:SizeSpec[]`（walk 命中 ratio 只取其 SizeSpec、**不递归其分析图**，图不泄漏给下游）。**三处消费**（取 `sizes[0]`）：生图 `runWorkNode` 设 `aspect+width+height+image_size=nearestTier`（gpt-image-2/default 经 `resolveSize` 用精确宽高、nano-banana 用档+比例）；视频 `assembleVideoRequest` 比例直接用、分辨率 `nearestResolution` 吸附供应商支持档（legacy 路径同）；ComfyUI `runComfyNode` 尽力而为把宽/高喂给名字像 width/height/宽/高 的数值控件（`comfySizeRole` 词边界正则、先判 height、识别不到不动）。**三处「由上游输入」标黄**：NodeWorkConsole / NodeVideoConsole 把 比例+分辨率 换成黄条；NodeInspector comfy 控件按 `comfySizeRole` 标黄。新增 `src/lib/sizeSpec.ts`（`SIZE_PRESETS`/`ratioOutputSize`/`nearestTier`/`nearestResolution`）+ `sizeSpec.test.ts`（17 例）；`imageModelFamilies.ts` 导出 `TIER_PIXEL_BUDGET`/`sizeFromAspectAndBudget`/`snap16`/`clamp256_4096` 复用；`consoleControls` 导出 `ClampNumberInput`。零新 IPC。验证：web/node tsc 绿 · 111 tests · build 绿。
> **2026-06-08 尺寸来源节点增强：比例×分辨率档 + 输出意图(只比例/只分辨率/两者) + 可连结果节点**：在上一条「尺寸来源」基础上：① **预设模式改为 比例 + 分辨率档两段选**——`RatioNodeData` 由 `{preset}` 改为 `{aspect, tier}`（`RATIO_ASPECTS` 8 比例 + `SIZE_TIERS` 1K/2K/4K），`ratioOutputSize` 用 `sizeFromAspectAndBudget(aspect, TIER_PIXEL_BUDGET[tier])` 反推精确宽高（选了比例还能再选分辨率）。② **输出意图 `emit`**（`RatioEmit='both'|'aspect'|'resolution'`，加到 `RatioNodeData` 与 `SizeSpec`）——节点上「比例+分辨率 / 只比例 / 只分辨率」三选；三处消费按 emit 应用：生图 `runWorkNode`（aspect 与 width/height/image_size 分别按 emit 决定是否覆盖）、视频 `sizeOverride` 改 `{aspect?,resolution?}` 按 emit 选择性赋值、ComfyUI `runComfyNode` emit='aspect' 时跳过喂宽高（需具体像素）。③ **三处「由上游输入」标黄改 per-field**——NodeWorkConsole / NodeVideoConsole 的 比例 与 分辨率 各自独立按 `aspectFed`/`tierFed` 标黄（emit 决定哪个被锁）；ComfyUI 检查器 sizeFed 在 emit='aspect' 时不标。④ **ratio 可连「结果」节点查看输出**——`RESULT_SOURCES` + `canConnectKinds`/`invalidReason` 的 ratio 白名单 + CreateMenu DOWNSTREAM/UPSTREAM 均加 result；`ResultNode` 上游组合预览新增「尺寸 {aspect}·{w}×{h}（输出意图）」一行（`computeUpstream` 的 `sizes` 通道既有）。`sizeSpec.ts` 改为导出 `RATIO_ASPECTS`/`SIZE_TIERS`（移除旧 `SIZE_PRESETS` 固定清单），`sizeSpec.test.ts` 重写（16 例：比例×档位反推 / emit 透传 / custom clamp / nearestTier / nearestResolution）。零新 IPC。验证：web/node tsc 绿 · 110 tests · build 绿。
> **2026-06-08 稳定性 + 防丢改动两修**：① **对话流式空闲超时**（`chat.ts`）——`streamOpenAICompat`/`streamAnthropic` 原来 `await reader.read()` 无上限，上游 SSE 静默挂死（代理半开 / 中转站卡住）时聊天永久转圈、只能按 Esc。新增 `readWithIdle(reader, 90s)`：`Promise.race([reader.read(), 超时])`，超时即 `reader.cancel()` 释放连接 + 抛友好超时错（每个 chunk 各自计时，正常流不受影响）；两处 read 循环统一改用它。② **智能画布图片落盘代替 base64 进 localStorage**（防配额爆掉丢改动）——`image` 节点的大 base64 src（拖入/上传/粘贴的参考图）原样写进 localStorage，几张高清图就 QuotaExceeded、当前画布改动被静默丢弃。新增 IPC **`api:storage:save-canvas-asset`**（`tools.ts`：dataURI → `userData/canvas-assets/<sha1>.<ext>`，按内容 hash 去重）+ `smartDocStorage.externalizeImageNodes()`（落盘前把 image 节点 base64 src 换成磁盘路径，写回 store）；`CanvasWorkspace` 去抖自动保存改为「先 externalize 再写盘」（卸载仍同步 writeNow，多数图已被去抖外置）。下游渲染/computeUpstream/sendableUrl 本就支持路径，无需改。**注意**：日后给 `mengbi-image://` 加目录白名单时，必须把 `userData/canvas-assets` 纳入。**已知边界**：本轮只外置 `image` 节点 src；compare/angle/light/image-reverse/视频首尾帧 等节点内嵌的上传图仍走 base64（体积小、较少见），后续可扩 externalize 覆盖。零新渲染端 IPC 以外改动。验证：web/node tsc 绿 · 110 tests · build 绿。
> **2026-06-08 关键纯函数补测（测试欠债，零源码改动）**：对审计点名「历史 bug 高发 / 付费链路 / 单一真相」的 4 个已导出纯函数模块补 vitest（多智能体并行起草、主流程统一集成验证）：① **ComfyUI `loopEngine.buildIterationPlan`**（`electron/services/comfyui/loopEngine.test.ts`）——七模式展开 + range 浮点端点/负步长、zip 取最短、**cartesian/zip/list 在 MAX_ITERATIONS=500 截断（非抛错，源码现状）**、formula 安全求值（i/n/rand/prev 作用域 + 非法表达式/非有限数 → `LoopError`）、防笛卡尔积爆炸护栏。② **`parser`**（detectFormat 三态 / parseApiWorkflow 连线 vs 字面 vs unknown / substitutePlaceholders 仅整串 `{{var}}` 替换 + 深拷贝不污染；锁定 `isLink` 把 `[512,512]` 当连线的现状）。③ **`bindings`**（applyBindings seed 随机/留空跳过/类型 coerce/file_upload；applyBypass 直通/递归/环保护→删悬空/深拷贝；空集返回同引用）。④ **`domain.normalizeVideoKind`**（`src/types/domain.test.ts`：8 合法 kind 原样 / 非法→null，钉死 video_kind 单一真相）。共 **+93 例（110→203 全绿）**。测试文件一律相对导入被测模块、`@shared` 仅 type-only（值导入会触发 vitest「reading 'config'」错）。**环境注意**：本机 vitest 4 偶发「Cannot read properties of undefined (reading 'config')」的 worker-init 抖动（与代码无关），重跑 `npm test` 即过。零 IPC / 零源码改动。验证：web/node tsc 绿 · 203 tests 绿。
> **2026-06-08 智能画布 LLM 新操作「转 JSON 提示词」（自然语言 → 结构化 JSON）**：LLM 节点新增第 7 个操作 `to-json`——把自然语言提示词转成结构化 JSON（subject/scene/composition/lighting/color/style/mood/camera(嵌套)/quality/negative），喂下游 生图/视频/ComfyUI（对 gpt-image-2/Nano Banana 等指令跟随型模型服从度更高）。**零新 IPC、零新节点、零 UI 代码**——`LlmOp`+`LLM_OP_LABELS`(`smartCanvas.ts`) 数据驱动，op 下拉(`NodeInspector` 遍历 `LLM_OP_LABELS`)/卡片标签/`instruction` 输入框自动生效（用户可在 instruction 写「用于视频，加 motion/duration」等定制 schema）。运行链路复用文本分支 `api:chat:optimize-prompt`（其 `systemPrompt` 可选覆盖）：`LLM_SYSTEM['to-json']` 给结构化系统提示词；`runLlmNode` 对 `to-json` 结果套新纯函数 **`extractJsonBlock`**（`src/lib/jsonPrompt.ts`：去 ``` 围栏 + 字符串/转义感知扫描截首个平衡 JSON 块 + JSON.parse 校验后美化；best-effort 永不抛/不丢内容）+ `jsonPrompt.test.ts`(10 例)。下游 `computeUpstream→prompts→effectivePrompt` 原样透传 JSON 字符串。**边界**：JSON 提示词只对指令跟随型模型有增益，SD 系 ComfyUI 仍建议自然语言/标签（由用户按模型选用）。验证：web/node tsc 绿 · 213 tests 绿 · build 绿。
> **2026-06-08 尺寸来源节点扩展（更多比例 + 8 档分辨率 + 原尺寸模式）**：扩 `ratio`（尺寸来源）节点：① **比例扩到 13 个**（`RATIO_ASPECTS`，横→方→竖，新增极宽 `21:9`/`3:1`、极高 `1:3`/`9:21` 及 `5:4`/`4:5` 等）。② **分辨率档扩到 8 个**（`SIZE_TIERS`=1K…8K，新增 3K/5K/6K/7K/8K）——并把档位换算从「像素面积预算」改为**最长边约定**（`RATIO_TIER_LONGEST`：NK ≈ N×1024 px 最长边，比面积预算更可预期；与节点自带 analyze 的 1K/2K/4K 最长边显示对齐），单边上限提到 **8192**（支持真 8K；下游 OpenAI 路径电端 `snapToGrid` 仍 clamp 到 3840、nano 走 `nearestTier`、ComfyUI 直取大尺寸=可上 8K 高清放大）。`sizeFromAspectLongest` 取代原 `sizeFromAspectAndBudget`（后者硬夹 4096，不动它给 gpt-image-2 family 用）。③ **新增「原尺寸」模式**（`RatioSizeMode` 加 `'original'`）——在 预设/自定义 旁加第三档：连一张图 → 直接输出该图的**原始宽高 + 精确比例**（忠实原图、仅夹 [256,8192]、不强制 16 对齐）。`RatioNode` 分析图后把 `naturalW/H` 回写持久化到 `RatioNodeData.origW/origH`（图变化才写、断开则清），`ratioOutputSize`（纯函数）original 分支读 origW/origH → `computeUpstream` 喂下游；首帧 origW 未回写时节点优先用实时 analyze 值显示避免闪「尺寸无效」。custom 上限同步 4096→8192。`sizeSpec.test.ts` 更新档位/custom 上限 + 补 original/8K/最长边用例。零新 IPC。验证：web/node tsc 绿 · 220 tests 绿 · build 绿。
> **2026-06-08 光源/视角节点预览按图比例自适应 + 节点自适应 + 光源改「图上直放光点」+ 提示词节点接提示词库 + 尺寸来源去备注**：① **尺寸来源节点**去掉卡片底部那段说明备注（`mb-sc-note`，用户嫌占地方）。② **光源(light)/视角(angle)节点预览区按图片真实比例自适应**——根因：预览框是固定高（150/148px）+ `background-size:contain`，不同比例的图被塞进固定框 → 留黑边、显得「忽大忽小」（用户报的「在图里放大/在图外缩小」其实是这个 letterbox 缩放错觉）。改：两节点预览 `aspect-ratio` 由 JS 量图片 `naturalW/H` 内联给出（随图变化，min/max-height 兜底极端比例），图片填满不留黑边；视角的 3D 平面也按图比例（长边占框 64%，不拉伸）。③ **整个节点高度自适应内容**——新增共享 hook `useFitNodeToContent(id, ref, chrome)`（nodeArea.tsx，`ResizeObserver` 量「自然高度包裹层 `.mb-sc-fit`」的 scrollHeight → `setNodeSize` **双向**贴合；预览随图比例/节点宽度变高变矮，节点跟随；设框高不改包裹层自然高度故无循环），取代光源/视角原先「按提示词长度估算只增不减」的 `autoGrowNode`。④ **光源节点改「直接在图上拖光点」**——`LightNodeData` 加可选 `posX/posY`（0~1，光标在图上的精确落点）；拖动时光点跟手落在图片上（精度大幅提高，解决「精细度不够」），同时由「以图心为原点的半球」推导 `azimuth/elevation` 喂提示词（中心=顶光/边缘=地平线）；显示优先用 posX/posY，旧数据回退按 az/elev 反推；去掉原圆顶虚线环（直放模式下是误导）。⑤ **提示词(prompt)节点接「提示词库」**——输入框左下角加「📚 提示词库」按钮 → 弹 `PromptPickerDialog`（复用 `api:prompt:list` + `api:prompt:category:list`，搜索 + 分类筛选，点条目即插入输入框：空则填入、非空则换行追加），`usePromptPickerStore` zustand 单例 + 在 `index.tsx` 顶层挂载（仿 `GalleryPickerDialog`）。提示词管家 UI 虽下线，但 `api:prompt:*` 通道为休眠保留态、可正常读取库存提示词。零新 IPC。验证：web/node tsc 绿 · 220 tests 绿 · build 绿。
> **2026-06-08 续：提示词库弹窗放大/修溢出 + 提示词入库 + 视角预览空白修复 + 对齐排布快捷键**：① **提示词选择弹窗（`PromptPickerDialog`）UI 修复**——`.mb-sc-ppick` 改按视口百分比（`width:86vw; max-width:1280px; height:84vh` + `padding` + `box-sizing:border-box`，被 `.mb-modal` 的 max-w/h 兜住不出界，标题/× 不再贴边被裁）；横向滚动条 + 标题撑破网格根因 = grid 子项默认 `min-width:auto`（取内容最小宽），长标题 nowrap 撑破轨道 → 给 `.mb-sc-ppick-item{min-width:0}` 修掉（卡片收进轨道、标题正常省略，一行铺更多）。② **提示词入库**——提示词节点 textarea 右键菜单加「从提示词库选择…」+「选中入库（N 字）」(有选区时)/「整段入库」→ 新纯助手 `savePromptToLibrary(text)`（nodeArea，标题取首行截 30 字，复用 `api:prompt:upsert`，kind='image'）。③ **视角节点预览空白修复（回归）**——上一轮把 3D 平面 `.mb-sc-angle-plane` 从固定 px 改成百分比宽高，但其父 `.mb-sc-angle-scene` 是 flex 居中「收缩到内容」盒、**宽度不定** → 百分比解析失败、平面塌成 0 → 预览全白。改回**像素尺寸**按图比例算（长边 150px、`planeW/planeH` 由 `imgAspect` 推），scene 恢复有定尺寸；光源节点不受影响（其图是 `inset:0` 绝对填充，非百分比子盒）。④ **对齐/排布快捷键**——`KEYBIND_ACTIONS`+`DEFAULT_KEYS` 加 9 项（`arrange-smart`/`align-left|right|top|bottom|hcenter|vcenter`/`distribute-h|v`），默认 **Alt 系**（`Alt+方向`=四边对齐、`Alt+H/V`=水平/垂直居中、`Alt+Shift+H/V`=横/纵均分、`Alt+L`=智能排布），避开纯方向键的「微调」与 Ctrl 系既有键；`CanvasViewport` 的方向键微调加 `!alt&&!ctrl&&!meta` 门控放行组合键、`doAction` 加对应 case（走 `getState()` 不动 effect 依赖）；`KeybindingsDialog` 自动列出可改键，`ArrangePanel` 各按钮 tooltip 显示当前组合（`prettyCombo` 把 `alt+arrowleft`→`Alt+←`，读 live bindings 反映改键）。零新 IPC。验证：web/node tsc 绿 · 220 tests 绿 · build 绿。
> **2026-06-10 智能画布九项（性能 + 智能分镜 + 多提示词逐条生图 + 拖出直用）**：① **高分辨率卡顿修复**——结果/生图/Comfy 节点的图片网格改图库同款缩略图（`MeasuredThumb` 新 `fullSrc` 入参 + `thumbPair()`：显示 `.thumbs` 512px WebP、off-DOM 量原图**真实分辨率**作角标、缩略图缺失 onError 回退原图、`loading=lazy decoding=async`），点击放大仍用原图；4K/8K 结果全量解码+GPU 上传是掉帧主因。② **尺寸来源节点更智能**——接图分析区新增「各模型相近尺寸」建议行：通用 1K/2K/4K 档（最长边等比）、GPT Image 2（8.3MP 预算 snap16）、Nano Banana（最近档+最近常用比例），点任一行即采用（custom/preset 自动切）；节点接图后 autoGrow。③ **新节点「智能分镜」（storyboard，第十八类）**——素材（卡上输入或上游文本，喂入时标黄禁手填）→ LLM 生成完整故事 → 按分镜数量(2-20)+可选统一风格拆成 N 条按时间顺序的图像提示词（两次 `api:chat:optimize-prompt`：`STORY_SYSTEM`+`shotsSystem` 要求 JSON 数组，`parseShots` JSON 解析+编号行兜底）；每条分镜「→词」拉出提示词节点（右侧按序排列不重叠）/拖出/「全部 → 提示词节点」；输出口把全部分镜按序作为**多条提示词**喂下游生图节点；入 `RUNNABLE`/`needsRun`（运行全部、下游运行自动先跑）；连线白名单 `STORYBOARD_TEXT_SOURCES/TARGETS`；`ON_NODE_TYPES` 卡上调不弹窗。零新 IPC。④ **生图节点多条提示词逐条生图**——`computeUpstream` 分组子节点提示词**组合为一条**（「组=一条」规则保留）；>1 条上游提示词按连入顺序逐条各跑一次完整生成（默认顺序、失败即止；生图控制台新增「多提示词 顺序/并发」开关 `WorkNodeData.promptConcurrency`，并发=同时提交、结果仍按条序归位；seed 每条 +1000 防撞同图）；`cancelWork` 经新 `activeWorkTasks` Map 把该节点全部在途任务一锅端。⑤ **点节点卡上控件不弹属性面板**——`useSmartCanvasUiStore.panelSuppressed` + `CanvasWorkspace` 捕获阶段 pointerdown 判定（命中 button/select/input/textarea/img/video 等 `CONTROL_SELECTOR`=压制；点卡空白=恢复弹出）：设定完点「运行」不再被弹窗拖慢/干扰。⑥ **结果节点去弹窗 + 原生拖出直用**——`ON_NODE_TYPES` 加 `result`；图/视频改 OS 原生拖拽（复用 `drag.ts` startDrag：拖到 PS/聊天软件=**原文件原尺寸**直接用，拖回画布空白=走文件拖入自动建图片节点；视频卡下加「⠿ 拖出视频」把手）；右键新增 打开文件所在目录/作参考图/复制/另存（`nodeArea` 新增公共助手 `dragOutNative`/`showInFolder`/`imageAsCreateRef`，Work/Comfy 结果图同享拖出+目录）。⑦ **工具栏新增显眼「图库」按钮 → 便携图库**（`SmartGalleryPanel`，accent 描边/渐变高亮 `.mb-sc-glbtn`）——非模态浮动面板（必须挂 `.mb-sc-root` framer transform **之外** fixed 才正确；无背板、画布保持可交互），完整复用图库通道 `api:gallery:list`+`api:album:list`：搜索(300ms 去抖)+相册筛选+缩略图网格（thumbnail_path 优先+真实分辨率角标）+右键（加到画布中心/放大/作参考图/复制/另存/打开目录）+原生拖出；`image:done` 自动刷新；右下角 `resize:both` 自由调控、列数 auto-fill 随面板宽自适应、Esc 关闭。⑧ **提示词库弹窗标题溢出修复**——`.mb-sc-ppick-item/-title/-text` 补 `overflow:hidden/max-width:100%/min-width:0 + word-break/overflow-wrap`（flex 子项 min-width:auto 陷阱：长无空格串把标题撑出卡片）。⑨ **Kimi/MiniMax 提示词优化一直报错修复**（`chat.ts optimizePromptOnce`）——根因 a：60s 超时太短，Kimi K2/MiniMax M2 等推理模型非流式响应常超 60s（DeepSeek/本地秒回所以正常）→ 放宽 240s；根因 b：勾了原生联网时这条「一发一收」路径也注入 native web_search 工具（Kimi `$web_search` builtin_function / MiniMax web_search 需客户端跑工具调用循环，本路径不处理 tool_calls）→ 模型回 tool_call 无正文 → **移除注入**（删 `SYSTEM_OPTIMIZER_WITH_WEB`）；另剥 `<think>…</think>` 段 + 失败真实原因经响应新 `reason` 字段透传（LLM/分镜节点 toast 显示具体上游错误而非笼统「优化未生效」）。零新 IPC。验证：web/node tsc 绿 · 220 tests 绿 · build 绿。
> **2026-06-10 系统性优化十四项（任务存活 / 分镜 2.0 / 统一预览 / 合集卡 / 性能）**：① **[P0] 跨页任务存活**——根因：`App.tsx` 的 `AnimatePresence+key={pathname}` 切页全 unmount，SmartCanvas 页挂的 6 个推送监听（image:done/comfyui:run-done/video:*/chat:*）随页注销，而 `pendingWork` 等 Map 是模块级 → 后台已成功、前端无人路由、节点读秒到 320s 超时。修：`smartCanvasRunner.registerSmartRunnerListeners()`（模块级防重，含 deletedMedia 订阅）在 **App.tsx 全局注册**，页面只展示状态（任务生命周期规范，铁律 17）。Create 页任务列表本就从 DB 拉、回页恢复（评估通过不改）。② **LLM 上游错误容错**——`apiUrl.ts:joinApiUrl` 容错（整条 endpoint 粘进 base_url 原样返回 / suffix 自带 v1 防双版本段）+ 新纯函数 `httpStatusHint(status)`（401 Key 无效/403 欠费未开通/404 查 /v1/429 限流/5xx 上游故障，中文「做什么+怎么办」），chat.ts optimizePromptOnce 与 lab.ts 接入（Kimi/MiniMax 404/403 不再裸状态码）+ `apiUrl.test.ts` 14 例。③ **智能分镜 2.0**——新 `StoryboardConstraints` 七项固定约束（角色/风格/镜头/色彩/世界观/场景/服装），**固定段由渲染端 `composeShotPrompt` 拼进每条成品提示词**（一致性不靠模型自觉）；`shotsSystem` 改要求 `[{scene,shot,detail}]` 对象数组（字符串数组为备选）；`parseShots` 健壮化三层兜底（对象按 prompt/text/scene+shot+detail/description/content/最长字符串值提取，**彻底消灭 `[object Object]`**）——纯函数移到 `src/lib/storyboardPrompt.ts`（17 例 vitest）。**图像传入**：分镜连线白名单并入图片来源（image/work/comfy/scale），运行时取前 3 张经 `api:lab:reverse` 反推（`analysisModelId` 可单选视觉模型，默认同 modelId），「【参考图分析】」并入故事素材，单张失败降级继续；日志三阶段。**两步可分**：故事成功即落 `story+lastStage`，拆分失败保留故事 + 新导出 `rerunStoryboardShots(id)`「重拆分镜」只重试第二步（省一次故事调用）。④ **分镜生图执行模式结论**——沿用「多条提示词逐条生图」（顺序/并发 + seed+pi*1000 + perPrompt 按条归位 + 顺序失败即止），不造新引擎；改进=批次跟踪：multi-prompt 起跑生成 `batchId`，收尾**每条提示词 push 一条 WorkResult**（additive 字段 `prompt/createdAt/batchId/shotIndex/sourceNodeId`），节点 data.result 仍写合并总览；模块级 `lastBatchByWork` 快照 + 新导出 `retryPromptIndex(workId,pi)` 单条重跑（同 batchId+shotIndex 归位、合集卡状态翻新）。⑤ **GPT Image 2 1K/2K 修复**——历史 bug：预算反推的任意 WxH（如 1248×832）被不少中转站拒 → 新纯函数 `mapGptTierSize(tier,aspect)`：1K 映射官方枚举（1024²/1536×1024/1024×1536）、2K 映射 2048 系（2048²/2048×1536/2048×1152 等）、4K 原预算反推不回归、精确宽高优先、`exact=false` 时前端提示实际生成尺寸（生图控制台 + Create 页）；buildBody 与 `runOpenAIImageEdit`（FormData 路径）同源接入；测试 +13 例。⑥ **统一预览（Lightbox 重构，铁律 18）**——新 `PreviewItem{src,type:'image'|'video',meta{prompt,filePath,modelId,createdAt},extraMenu}`；Props 扩 `items+index+onIndexChange`（旧单 src 兼容）；左右箭头（风格同关闭钮）+ 键盘 ←→（capture 独占、边界禁用不循环、切换重置缩放）+ `N/total` 计数 + video `<video controls>` + **统一右键菜单**（复制图/另存/打开位置/复制路径/复制提示词/作参考图/发送到智能画布 + 调用方 extraMenu 注入如图库「删除」）。通用媒体操作抽 `src/lib/mediaActions.ts`（nodeArea re-export 保持调用点）。**全调用方迁移为列表**：Manager（筛选全集+删除项）、Create（最新 3 任务全部图跨任务翻看）、ChatPanel（气泡附图组/参考图组）、ComfyUI ImageOutput（本次输出含视频）、SmartGalleryPanel、Work/Comfy/Result 节点（全部结果图）；`useSmartPreviewStore` 扩 items+index（单 src 兼容）。⑦ **结果合集卡（结果收集规范）**——新纯函数 `src/lib/resultGroups.ts:groupResults`（8 例）：单图平铺；一条多图（batch 模式）或同 batchId 多条 → 合集卡（封面叠片 + 「N 张 · 败 x」角标）；同 batchId+shotIndex 重试条**替换**旧条。点开 → **居中弹层** `BatchPopup`（批次内每张图点击进 Lightbox 整批导航 / 提示词全文点放大右键复制 / 成败状态 / 失败条「重试此条」按钮 / shotIndex 显示「分镜 N」）。⑧ **卡片固定尺寸规范（铁律 18）**——`.mb-sc-result-grid`/`.mb-sc-work-thumbs` 由 `repeat(2,1fr)` 改 `repeat(auto-fill,100px)`：卡宽恒 100px，**拖大节点只改列数不放大卡片**（看大图用放大预览）。⑨ **节点自适应**——18 类中 13 类已覆盖（Prompt/Text/LLM 文本类含测量式）；WorkNode 多图按「固定卡宽→列数→行数」精确撑高。规范：文本类=estimateTextHeight 增高+封顶+内滚；图集类=autoGrowNode 仅增封顶；双向跟随（useFitNodeToContent）仅限展示型节点。⑩ **画布性能**——ReactFlow 开 `onlyRenderVisibleElements`（只渲染视口内节点）；18 类节点组件在 nodeTypes 注册处 `memo()` 包装；`onNodeDrag` rAF 节流（对齐参考线/落点提示每帧最多算一次，松手取消排队帧）；连线流动动画三档 `useSmartViewStore.flowAnimation`（'on'/'auto'/'off'，默认 auto：节点>80 或连线>120 自动加 `.mb-sc-noflow` 停 dash 动画改实线；ViewPrefsPanel 可调）。⑪ **GPU 加速开关（重启生效）**——设置「存储与系统」开关（默认开）→ prefs `boot_disable_gpu` 经 `api:settings:save`（零新 IPC）+ settings.ts 同步写 **`userData/boot-flags.json` 旁路文件**（app ready 前 DB 未初始化，main.ts 启动最早同步读，`disableGpu==='1'` → `app.disableHardwareAcceleration()`）；切换 toast「重启梦笔后生效」。⑫ **性能模式（无需重启）**——`themeStore.perfMode 'normal'|'low'`（持久化），low → html `data-perf="low"`，CSS 停装饰动画（流星/星辰/光晕，进度条/spinner 豁免，复用 data-idle 策略但常驻）；设置「外观」二档按钮。⑬ **本地 LLM 卡顿缓解**——新 `src/lib/localLlmBusy.ts`：本地模型（official_kind='local'）推理中 html `data-busy="true"`（CSS 同 data-perf 停装饰动画把 GPU 让给推理，引用计数多路并发），ChatPanel 发送→chat:done 与画布 LLM 聊天节点（pendingChatBusyEnd Map）两处接线；**GPU 层数配置**：settings pref `local_llm_gpu_layers`（设置页本地模型区输入，空=自动/0=纯 CPU/正整数=限制 offload）→ chat.ts 读 pref → `localLlmServer.ensureRunning(path, gpuLayers)` → `loadModel({gpuLayers})`，换值需停止服务重新加载。**已确认后置项：本地推理迁独立 utility process**（彻底隔离，成本高，记录待处理）。⑭ 文档与铁律（17/18）同步本文件。零新 IPC。验证：web/node tsc 绿 · 269 tests 绿 · build 绿。
> **2026-06-10 节点体系扩展 + 批量/循环 + 设置重构（xg.md 13 块）**：① **新节点「角色设计」（character，第十九类）**——输入 角色照片（上游图或卡上上传，上游优先标黄禁手填）+ 角色文字描述 + **可视化捏人参数**（脸型/五官/发型/发色/身高/身材/年龄感/气质/服装/配饰/其它，11 项折叠表单，实时拼本地草稿**零成本预览**，纯函数 `src/lib/characterPrompt.ts` 配 vitest）→ `runCharacterNode`：参考图经 `api:lab:reverse` 分析（缓存 `analysis`）→ `api:chat:optimize-prompt`（`CHARACTER_SYSTEM`）合成**十段角色资产**（基础身份/面部特征/发型发色/身材比例/服装特征/颜色特征/气质关键词/风格关键词/禁止偏移项/可复用提示词）→ `charPrompt` 文本喂下游（生图/分镜/视频/ComfyUI/LLM）。**锁定**开关防重跑覆盖；**版本**保存/切换多套设定；「生成预览图」**手动触发**（三视图/多角度/动作/表情/服装/配饰/场景 七类，`buildSheetPrompt` 由代码拼一致性硬约束 + 上游参考图作图生图锁脸，复用 `generateOnce`，结果可连结果节点）。**分镜联动**：`upstreamCharacterAssets` 收上游角色节点 → 「可复用提示词」段并入 `constraints.character`（多角色编号「角色1/角色2」一一对应不混淆）+ 完整资产作「【角色设定】」进故事素材；STORYBOARD_SOURCES 加 character。② **ComfyUI 节点多输入运行方式**——`ComfyNodeData.multiMode`（'merge' 单次现状 / 'per-prompt' 逐条提示词 / 'per-image' 逐张图）；「上游→控件值」分发抽纯函数 `src/lib/comfyDispatch.ts`（`buildComfyControlValues` merge 语义与历史逐字节等价 + override 单条覆盖 + `availableComfyModes` 钳制 + 不可用原因，13 例 vitest）；runner `submitComfyAndWait`（封装 runSingle+pendingComfy+320s 兜底，`defer` 模式 routeComfyDone 把 outcome 交 resolver 不落节点）+ `runComfyBatch`（逐条串行，**失败跳过继续**，每条包成 `WorkResult{batchId,shotIndex,prompt,sourceNodeId}` 推合集卡）+ `retryComfyItem` 单条重试（`lastComfyBatch` 快照）；ResultNode「重试此条」按 `sourceNodeId` 节点类型分发 retryPromptIndex/retryComfyItem；检查器「多输入运行方式」下拉（不可用项 disabled+原因）。③ **新节点「循环」（loop，第二十类）**——工作流控制：固定次数/数值范围（起止步长，输出 文本 或 宽/高 SizeSpec）/提示词列表（每行一条）/尺寸列表（`1024x768`、`,`、`×` 均可）/文件夹图片 五种来源（纯函数 `src/lib/loopItems.ts`+vitest，钳 1000 项）；**当前项输出存 node data**（`outPrompt/outSize/outImage`，computeUpstream 直读 → 持久化后「从第 N 项继续」跨会话可用）；`runLoopNode` 逐项：写当前项 → 对每个直接下游 runnable（生图/ComfyUI/视频）`await runOne`（下游完成感知=现有 Promise 语义，零新事件总线）→ 记成败 → 下一项；**暂停**（项间生效）/继续/停止/跳过当前项（取消在途）/从指定项继续；节点卡显示 第 i/N · 当前值 · 成功/失败。**防死锁**：loop 不进 RUNNABLE（运行全部跳过）+ `isAnyLoopRunning` 与 `useSmartRunStore.running` 双向互斥；needsRun 不收 loop（下游单点运行不反向触发循环）；切画布硬停 + 记停点。④ **文件夹批量（folder-input / folder-output，第二十一/二十二类）+ 全项目仅有的 2 个新 IPC**——**`api:storage:list-images`**（`{dir}`→`{files[]}`，readdir+图片扩展名白名单，只回元数据不回字节；理由：渲染端无 fs，pick-images 是对话框+整图 dataURI 批量爆内存）与 **`api:storage:copy-into`**（`{targetDir,items[{src,destName}]}`→`{saved,failed}`，本地路径 `fs.copyFile` 零转码 / dataUri 解码写入 / 重名自动 -2/-3；否决复用 tools:save-output——只吃 dataUri 且语义绑死工具目录）。folder-input：选文件夹（复用 api:storage:select）→ `refreshFolderInput` 扫描 → files 持久化 + 刷新按钮 + 前 8 张缩略图（点击进 Lightbox 全集翻看）→ 多图来源输出。folder-output：选输出文件夹 + 命名规则（原名/前缀+四位序号，纯函数 `src/lib/folderNaming.ts`+vitest）+ enabled 开关 + 存/败计数；**感知新结果 = 结果归位统一汇集点插钩**（`placeWorkResult`/`placeComfyResult`/`pushComfyPerResult`/`routeVideoDone` 调 `notifyFolderOutputs`，当前文档走 store edges、后台文档走 doc.connections），每条到达即落盘、模块级去重 Set 防合并总览重复存、失败记日志**不中断生成主流程**（旁路 try/catch）。批量主链 = folder-input(N 图) → ComfyUI「逐张图执行」/生图 → folder-output。⑤ **设置界面重构**——**方案图标**：prefs 键 `plan_icons_json`（零迁移，`{[planId]: emoji/文字/图片 dataURI}`），无自定义自动「名称首字 + 名称 hash HSL 底色」（纯函数 `src/lib/planIcon.ts`）；方案 pill 加图标 + 右键「设置方案图标…」（emoji/文字/选图 ≤512KB/恢复自动）。**模型映射显示**：`listMappedModels` 扩 `providerName/label`（`label=「中转站 / 显示名」`，value 仍显示名不破坏存储），ChatPanel/NodeInspector/Create 页模型下拉全部显示带中转站前缀，区分同名模型不同接口源；设置页映射编辑器加列头说明。**性能模式做实**：低配模式新增 **页面切换过渡 duration=0**（App.tsx 读 perfMode）+ **智能画布连线流动强制停**（CanvasViewport noFlowAnim 并入 perfMode）；外观页改两张说明卡片（完整动效/低配模式，影响范围写明）。⑥ **UI 规范修复（铁律 19/20/21）**——**数字输入框**：`ClampNumberInput`/`StepperInput` 编辑期可删空、失焦/回车才 clamp 提交、**聚焦自动全选**；NodeInspector 重复实现删除统一 import；清扫「每键即 clamp/删空补 0」的原生 number 输入（NodeInspector 张数+Mock 延迟、ArrangePanel、comfyControl、ComfyUI ControlsForm（新 `FreeNumberField`）、LoopPanel、VideoRunControls、VideoReverseNode、Create 自定义宽高、ScaleNode/seed 等补聚焦全选）。**文字放大框**：`.mb-sc-textviewer` 改 `clamp(560px,62vw,1500px) × min(72vh,920px)`（约占可视区 1/2，vw/vh 随窗口自适应），body 字号 14/行高 1.7，按钮始终可见。**悬浮窗尺寸记忆**：`ResizablePanelWrapper` autoSize 面板（生图/视频控制台）常显缩放手柄，用户一拖即转固定尺寸并按 storageKey 持久化（`{w,h,user:true}`），手柄旁「⟲ 恢复默认」回自适应；NodeInspector 浮动面板 CSS `resize:both` + 按**节点类型**持久化（`mengbi.sc.inspector.<type>.v1`，ResizeObserver 去抖）。**图库改右侧停靠**：`SmartGalleryPanel` 由自由浮动改 右缘停靠（top 60/bottom 84 避开工具坞），左缘把手拖宽 + localStorage 记忆 + 双击恢复默认；点图走统一 Lightbox 中心放大。⑦ 22 类节点全部接入面联动（SmartNodeKind/SmartNodeData/defaultNodeData/DEFAULT_SIZE/nodeTypes memo/NODE_ICONS×4 新图标/ACCENT_ICON/NODE_TYPE_LABELS×2/NodeSearch/CreateMenu DOWNSTREAM+UPSTREAM/CanvasDock 分组重排/连线集合 PRODUCERS/CONSUMERS/IMAGE_SOURCES/RESULT_SOURCES/STORYBOARD_SOURCES + CHARACTER_SOURCES/LOOP_TARGETS/FOLDER_OUTPUT_SOURCES 钳制/RUNNABLE+needsRun+runOne/ON_NODE_TYPES/NODE_OPS）；`sanitizeTemplateNode` 剥新节点运行态。新增 4 组纯函数测试（comfyDispatch 13 + loopItems 13 + folderNaming 6 + characterPrompt 10）。**新 IPC：2 个（api:storage:list-images / api:storage:copy-into）**。验证：web/node tsc 绿 · 308 tests 绿 · build 绿。
> **2026-06-10 用户实测反馈 7 项修复（图库居中 + 角色节点重做 + 分镜电影化&转场 + Comfy 指定绑定）**：① **便携图库改画布中心悬浮窗**——`SmartGalleryPanel` 由右侧停靠改 中心悬浮（与 `SmartTextViewer` 同尺寸规格 `clamp(560px,62vw,1500px)×min(72vh,920px)`，vw/vh 自适应、**无遮罩**保画布可交互与拖图建节点；删左缘拖宽把手逻辑），**铁律 21 同步修订**。② **角色设计节点五项重做**——(a) **上游提示词覆盖角色描述**：接了提示词节点 → desc 标黄「由上游输入（N 条，实时覆盖）」禁手填（点击放大查看），`runCharacterNode` 用 `up.prompts.join('\n')` 覆盖；(b) **捏人参数预置点选**：新纯数据库 `src/lib/characterPresets.ts`（`CHARACTER_PRESETS` 12 字段 ×12-50 项 + `SCENE_PRESETS` 50 场景，vitest 校验充足性），输入框右侧 ▾ 小三角弹 chips 预置面板（点选 空=填入/非空=追加，可自由改），新增**「主体类型」字段**（`CharacterAttrs.subject`，人物/动物/拟人/机甲/产品/吉祥物…角色不限于人）；(c) **3D 结构预览（零成本替代烧钱预览图）**：复用视角节点 CSS-3D 体系（`.mb-sc-angle-stage/scene/plane`）——参考图贴 3D 平面可拖拽旋转（0.5°/px、上拖俯视）+ 远近滑块 + 复位，无图按 subject 显示剪影占位；姿态存 `previewH/V/Dist`，经 `previewAngleDesc` 换算「从右侧约 45 度，俯视约 20 度」拼进形式提示词；(d) **「上游图没识别」根因修复**：分析模型与合成模型分离（新 `analysisModelId` 视觉模型下拉，原来用文本模型调 `lab.reverse` 多半无视觉能力静默失败）+ `analysisSrc` 指纹（上游图变化自动重分析，原来缓存永不失效）+ 卡上分析状态行（已分析·查看/重析）+ 分析失败把原因留在卡上 error（提示换视觉模型）而非只 toast；(e) **三视图/多角度/动作/表情/服装/配饰/场景 改「生成形式提示词」**：不再节点内生图（删 `generateCharacterSheet`/`cancelCharacterSheet`/imageModelId UI——不烧中转站的钱），`buildSheetPrompt(charPrompt, sheetType, styleType?, scene?, angleDesc?)` 纯函数**即时**生成（场景形式拼 `SCENE_PRESETS` 点选场景——产品放景同入口），产物 `sheetPrompt` 卡上展示（放大/复制/→提示词节点/清除）并**优先于 charPrompt 作为节点输出**喂下游生图（collectOwnOutput）；资产重生成时作废旧 sheetPrompt。③ **智能分镜电影化 + 镜头转场 + 双输出口**——`shotsSystem` 升级电影分镜师指令（每条 `{scene,characters,action,shot,detail}` 五字段、≥60 字、**完整复述人物与场景特征不许指代省略**、相邻镜衔接），`composeShotPrompt`/`shotFromObject`/`StoryboardShotMeta` 加 characters/action（camera 作 shot 别名）；新 `transitionsSystem/transitionsUser/parseTransitions`（N 镜→N-1 条转场：运动轨迹/运镜衔接/场景时间过渡/主体动作延续，JSON→字符串→编号行三层兜底）+ runner `sbGenTransitions`（拆分镜成功后第二次 LLM 调用；**失败不连坐**分镜，toast 提示「重生转场」）+ `rerunStoryboardTransitions` 单独重试；`StoryboardNodeData.transitions`。**首个多输出口节点**：`NodeShell.outputs` 扩 `boolean | Array<{id,title}>`（数组=右轨上下分段 `.is-split-0/1`，下段 ❯ 换 ≫），分镜节点 上口 `out`=分镜 / 下口 `out-trans`=转场；`computeUpstream` walk 按 `edge.sourceHandle` 路由（同源不同口不去重 `sid#out/trans`）、`pushTextDownstream` 加 handleId 过滤、**`smartCanvasApi` 序列化补 `sourceHandle`**（原 connections 落盘丢 handle → 重开画布转场口连线会退化，`SmartCanvasConnectionDTO.sourceHandle?`）、快捷创建菜单透传拖出口（`CreateMenuState.anchorHandle`）；卡上新增「镜头转场」区块（虚线条目 `i→i+2` 编号、→词拉出/拖出/复制/放大、生成/重生转场按钮）。④ **ComfyUI 节点「输入绑定到指定模块」落地**——`ComfyNodeData.inputBindings?: Record<controlId, ComfyInputBinding>`（`{kind:'prompt',index}/{kind:'image',index}/{kind:'all-images'}/{kind:'off'}`，缺省=自动按序）；`buildComfyControlValues` 加第 5 参 bindings：显式绑定先落（越界回退末项）→ 被消费条目**从自动分发池剔除** → 剩余槽位按序自动分发（无绑定时与现状**逐字节等价**，回归测试锁定）；`override`（逐条/逐张迭代）优先级最高——迭代维度的绑定被忽略、另一维度仍生效；批量快照 `lastComfyBatch.bindings` 透传重试路径。检查器每个文本/图片槽的黄条下加**绑定下拉**（自动（按序）/ 提示词 1..N（截 14 字预览）/ 图 1..M / 全部图（multi_image）/ 不接收（恢复可编辑））；标黄判定按 bindings 重算（off 不标黄、显式绑定显示「绑定上游提示词 N」）。comfyDispatch +10 例（22）、storyboard +9 例（25）、character +5 例（17）。零新 IPC。验证：web/node tsc 绿 · 334 tests 绿 · build 绿。
> **2026-06-10 反馈第二轮：图库弹窗归位（真根因）+ 角色/分镜「卡片 + 工作台弹窗」**：① **图库错位真根因修复**——上一轮中心悬浮 CSS 实际被全局 `.mb-card{position:relative}`（bundle 更靠后、同特异性）把 `position:fixed` 顶掉 → 面板掉进文档流末尾（=「图库一直在底部」），与 NodeSearch 历史 bug 同款。修：**双类 `.mb-sc-glp.mb-card` 提特异性** + 组件 **`createPortal` 到 body**（仿 SmartTextViewer，双保险躲开路由级 framer transform 容器）。**沉淀经验：智能画布内任何 fixed/absolute 浮层若同时带 `.mb-card`，选择器必须写双类 `.xxx.mb-card`**。② **角色设计节点精简 + 「角色工作台」弹窗（游戏捏脸式）**——节点卡只留 模型/参考图状态/描述摘要/运行/资产摘要 + 渐变高亮「🎛 打开角色工作台」；新 `CharacterStudio.tsx`（`useCharacterStudioStore{nodeId}` 单例 + 顶层挂载 + portal + `.mb-modal-backdrop`，Esc/背板关闭，`clamp(980px,88vw,1720px)×min(86vh,1000px)`）**三栏**：左=捏人参数**分类 tab 纵列 + 预置 chips 网格面板**（替代节点内丑陋 ▾ 浮层——`PresetInput` 浮层组件与 `.mb-sc-preset-pop/arrow/wrap` CSS 删除，chips 样式保留复用；已填分类带圆点标记）、中=**大号 CSS-3D 结构预览**（拖旋转/远近/复位/视角角标）+ **实时草稿**（零成本即时）、右=合成模型/分析模型/描述（上游标黄）/风格/运行+锁定/资产/版本/形式提示词（场景 chips 面板）。弹窗实时读写节点数据（弹窗=节点另一张视图）。**「游戏级 3D 实时捏脸」可行性决策**：交互布局照做；真 3D 角色模型渲染不可行（无 3D 引擎/模型资产）——用 CSS-3D 台 + 实时草稿零成本替代，真实图像由下游生图节点手动出。`ATTR_FIELDS`/`silhouetteOf` 移入 `characterPresets.ts`（避免 Studio↔Node 循环依赖）。③ **智能分镜节点精简 + 「分镜工作台」弹窗**——节点卡只留 模型/数量/素材（上游标黄）/运行/摘要行（故事✓·N 分镜·M 转场）+「🎛 打开分镜工作台」，双输出口不变；新 `StoryboardStudio.tsx`（同款弹窗骨架，`.mb-sc-studio-body.is-two` 两栏）：左=设定（约束 7 项/分析模型/素材/生成+重拆+重生转场）、右=产出（图析/故事/分镜列表/转场列表，全交互 →词/拖出/复制/放大）。④ 两节点右键菜单加「打开工作台」；`DEFAULT_SIZE` 缩小（character 280×330 / storyboard 290×300）；NODE_OPS 文案同步。零新 IPC、运行链路零改动（纯 UI 重组）。验证：web/node tsc 绿 · 334 tests 绿 · build 绿。
> **2026-06-10 gpt-image quality 枚举修复（烧钱级 bug）+ 上游报错友好提示**：① **根因**——UI「质量=标准」发 `quality:'standard'`（DALL·E 3 词表），而 gpt-image 系列官方枚举是 **auto|low|medium|high**，严格校验的中转站直接 400（"Invalid option: expected one of auto|low|medium|high"）**且失败仍可能计费**；用户报「4 条提示词出 7 条后台记录、3 张失败还扣钱」实为：4 条 = 一次成功的逐条生图（4 任务），3 条 = 换了「标准」质量后连点 3 次运行、顺序模式每次都败在第 1 条即止（每次 1 任务、被计费）——计数逻辑无 bug，病根是 quality 词表。② **修**：`imageModelFamilies.ts` gpt-image-2 `buildBody` 把 `standard`→**映射 `medium`**（并放行 `auto`）；`generate.ts` 图生图 FormData 路径（/v1/images/edits）同源映射（仅 gpt-image-2 family）。家族测试 +2 例锁死（335 tests）。③ **上游报错加「做什么+怎么办」提示**（`generate.ts upstreamErrorHint`，5 处 upstream 抛错点统一追加）：`denied for this API key`/permission_error → 「该 Key 无权使用此模型：换模型或到中转站开通」（用户图 2 的 FHL 配置即此类，**配置侧问题非代码 bug**）；quality 枚举 400 → 提示换质量档；insufficient_quota → 充值/换方案。零新 IPC。验证：web/node tsc 绿 · 335 tests 绿 · build 绿。
> **2026-06-11 视频协议自动纠偏（设置减负）+ legacy 提取器容错修复**：用户反馈「视频设置太复杂（别家只填 API/模型/地址）」+ 实测报错「提交返回里找不到任务 id：{code:200,data:[{status:submitted,task_id:…}]}」。**根因两层**：① legacy 引擎（video.ts）的 `extractTaskId`/`extractStatus` 只认 `data` 为对象，APIMart 等聚合站 `data` 是**数组** → 提交明明成功（任务已计费）却被判失败；② 更深层：配置的 `video_kind`（kling/unified）与该站协议不匹配 → 即使提取到 id，轮询端点也是错的（钱照烧、视频取不回）。**修**：(a) legacy 两个提取器加数组首元素容错（与 adapter.ts 同款）；(b) **协议自动纠偏**——`domain.ts` 新纯函数 `suggestVideoKind(baseUrl, actualModelId)`（apimart→seedance / seedance·doubao 模型→seedance / runway→runway / fal→fal，识别不出 null）+ `autoCorrectVideoKind`（显式 adapter 协议永远尊重；legacy 配置才纠偏），**主进程 findVideoConfig 与渲染端 resolveVideoTarget 双端接入**（双端必须同步——渲染端不纠偏就不会构造 adapter 统一请求 input.request）；纠偏时渲染端 toast 提示一次/会话（建议把配置改一致）。(c) **设置减负**：视频协议下拉标注「拿不准就不用管——运行时自动匹配」+ 按 地址/模型 实时显示建议协议 +「一键采用」按钮；「视频模型配置中心」改名「**高级（可选）：视频供应商微调**」（常规使用只需 地址+Key+模型映射 三样，与别家软件持平——协议选择从必答题变成可选项）。(d) friendlyVideoError 的「找不到任务 id」分支给出可操作建议（改 seedance / 直接重试）。domain.test.ts +10 例（共 342）。零新 IPC。验证：web/node tsc 绿 · 342 tests 绿 · build 绿。
> **2026-06-11 视频参考图自动上传（APIMart 不收 base64）**：协议纠偏生效后暴露下一环：APIMart 生成接口的图片字段（image_with_roles/image_urls）**只收 http/https 或 asset:// URL**，我们把上游图转成 data: 内联 → 400「Invalid format for image_with_roles[0].url」。查官方文档（docs.apimart.ai）实证其有 **`POST /v1/uploads/images`**（multipart `file`≤20MB，jpeg/png/webp/gif，返回 72h 有效公网 `url`，可直接用于生成接口）。**修**：`VideoProviderConfig` 加可选 `imageUploadEndpoint`（seedance 内置模板默认 `/v1/uploads/images`；deepMerge 保旧存档），`GenericVideoAdapter.createTask` 提交前 `resolveDataImages`——req.imageUrls/images 里的 data: 图自动 multipart 上传换 https URL（同图去重、20MB 守卫、multipart 不带 json Content-Type 让 fetch 生成 boundary）；**无端点则原样放行**（部分站收 base64，保持旧行为，veo/custom 不受影响）；配置中心加「图片上传端点」编辑行；friendlyVideoError 识别该 400 给「直接重试 / 填上传端点」建议。零新 IPC。验证：web/node tsc 绿 · 342 tests 绿 · build 绿。
> **2026-06-12 用户反馈六项（排队超时误杀 + 快速建节点 + 落位防重叠 + 错误中文解释 + 拖动降级渲染 + 视频补帧/参数记忆）**：① **高峰期生图排队 300~500s 被误杀修复**——渲染端 `generateOnce` 兜底 320s→**15 分钟**（与主进程 grsai/apimart 轮询硬上限对齐）、`submitComfyAndWait` 同步放宽（90s 温和提示保留）；grsai 轮询间隔 5s→**3s**（status 是轻量 GET，缩短「后台已出图但还没轮询到」的空窗），连续失败容忍 6→10 次（仍 30s）。轮询机制本就是「N 秒一问 × 15 分钟硬上限」而非固定轮次——病根是渲染端兜底过短先判死。② **武装态点现有节点左/右半区 = 快速建节点**——`CanvasViewport.onNodeClick`：工具坞武装类型后点节点**左半区 = 在左侧建新节点作上游、右半区 = 右侧作下游**（store 新动作 `addLinkedNode`，方向合法性走 `canConnectKinds`，非法退化为点击处直接创建 + toast 原因；分组容器按点画布处理）。③ **自动落位防重叠**——store 新助手 `findFreePosition`（期望位置与现有顶层节点重叠时沿 y 向下顺延到空位，x 不动保持上下游列对齐），套用 `linkAndMove`（拖到节点上自动连线）/`addLinkedNode`/`ensureResultNode` 三处程序落位——连第二、三个节点不再叠在同一坐标。④ **错误信息中文解释扩容**——`generate.ts upstreamErrorHint` 由 3 条扩到 10 条（Key 无效 401 / 限流 429 / 模型不存在·无可用渠道 / 内容审核 / 尺寸不支持 / 5xx 上游故障 / 网络连不上等，全部「原因 + 怎么办」中文），并在任务失败**最终出口**统一追加（覆盖 openai/grsai/apimart 全部协议路径；includes 判重防重复追加同一句）。⑤ **拖动果冻感优化**——`onNodeDragStart/Stop` 给 `.mb-sc-root` 挂/摘 `is-node-dragging`，拖动期间 CSS 降级：停节点阴影与 transition、停连线 dash 动画、`.react-flow__node` 临时 `will-change: transform`（常驻 will-change 耗显存，只在拖动瞬间挂、松手即恢复）。⑥ **视频补帧 + 参数记忆**——调研实证 APIMart Seedance 2.0 **无 fps 参数**（固定 ~24fps，且 resolution 默认 480p——「流畅度低」多半是这两个叠加），帧率靠本地补帧解决：`api:video:scale` 加可选 `fps` 字段（ffmpeg `minterpolate` 运动补偿插帧 30/48/60，非重复帧；兜底 5→15 分钟；additive 字段零新 IPC），缩放节点视频分支加「帧率」下拉（可只补帧不缩放，按钮文案随选择变化）；**视频节点参数记忆**：提交成功即存 localStorage `mengbi.sc.videoDefaults.v1`（新 `lib/videoNodeDefaults.ts`，runner 写 / store 读、互不 import 防环），新建视频节点（addNode/addLinkedNode/insertNodeOnEdge 统一走 `dataForNewNode`）自动继承上次 模型/模式/时长/画幅/分辨率/有声。零新 IPC。验证：web/node tsc 绿 · 342 tests 绿 · build 绿。
> **2026-06-12 新节点「插帧」（frame-interp，第二十三类，本地 RIFE AI 插帧）+ 全局任务完成语音播报**：① **插帧节点**——上轮 ffmpeg minterpolate 补帧升级为 **AI 模型插帧**：选型 rife-ncnn-vulkan（nihui，独立 exe + Vulkan GPU 免 Python，与 Real-ESRGAN ncnn 同模式；release 20221029 zip ~40MB 自带 rife-v4.6 等模型，v4 系 `-n` 任意目标帧数=任意倍率）。**新 IPC 域 `api:interp:*`（5 通道 + 2 push，见 §4.6）**：status/install-engine/remove-engine/run/cancel；run 仿 upscale:run-single **同步等完成**（铁律 17：runner 模块级 pending + clientTag 定位节点，切页不丢）。主进程三层：`rifeEngine.ts`（安装/状态）+ `rifeRunner.ts`（ffmpeg 拆帧 → RIFE → ffmpeg 合帧带回音轨；串行队列、300s idle 看门狗、三阶段进度、取消贯通、临时目录必清 + 24h 残留清扫、时长≤120s/帧数≤7200 防爆盘）+ `rifeMath.ts` 纯函数（stderr 解析 fps/tbr/Duration/音轨、目标帧数换算、三阶段定额，**+11 例 vitest 共 353**）；公共件新提取 `services/zipInstall.ts`（Expand-Archive/unzip + ZipSlip + 拍平，realesrganEngine 自带份未动）+ `netDownloader.githubReleaseUrls`（直链+kkgithub+6 前缀镜像）。渲染端：`FrameInterpNode.tsx`（未装引擎=卡上一键安装带进度；已装=源/目标帧率 + 运行/取消 + 进度条 + 播放 + 原生拖出）+ 全套节点接入（SmartNodeKind/FrameInterpNodeData/defaultNodeData/DEFAULT_SIZE/sanitizeTemplateNode/icons/CanvasDock 预处理段/CreateMenu/NodeShell/NodeSearch/NodeInspector/ON_NODE_TYPES+NODE_OPS/nodeTypes/连线集合 VIDEO_SOURCES+VIDEO_INPUT_ONLY+RESULT_SOURCES+视频源钳制/runner collectOwnOutput+computeUpstream 视频通道+RUNNABLE+needsRun+runOne+runFrameInterpNode+interp:progress 路由）。② **全局任务完成语音播报**（系统 TTS）——新 `src/lib/voiceNotify.ts`：挂在 App.tsx 既有 `notification:append` 监听上（零新监听）；**白名单只认真完成事件**（规避 register() 对「提交成功」的 append）：生图/视频/ComfyUI/矢量化/放大/插帧，**对话不播报**（用户确认）；话术默认「{任务名}任务完成/失败」+ 设置页**可按任务类型自定义**（prefs `voice_phrases_json`）；开关 prefs `voice_notify` **缺省=开**；3s 同文案去重防批量刷屏、zh 语音自动选择（voiceschanged 缓存）、队列防积压。**主进程补齐完成通知**（顺带补齐通知中心，与 image/video:done 同语义）：comfyui 批次彻底结束（queue.ts）+ vec 批次转移到 completed（batchQueue.ts，转移检测防高频重复）各 appendNotification（channel `comfyui:run-done`/`vec:batch-done`）；operationLabels 补标签。设置「存储与系统」加 `VoiceNotifyField`（开/关 + 🔊试听 + 每类任务 成功/失败话术 双输入框失焦保存 + 行内试听）。验证：web/node tsc 绿 · 353 tests 绿 · build 绿。
> **2026-06-12 第二批：视频不限时等待 + 视频输入/预览全链路 + 图库多类型收录 + 便携图库三修（铁律 22/23 沉淀）**：① **视频生成等待不限时**（用户决策：「一个视频怎么可能 10 分钟」）——video.ts 三条轮询（adapter/kling·unified/sora）全部去掉硬超时：上游报错才判失败、进行中一直等、状态查询连续 45 次失败（~6 分钟）才放弃（轮询偶发 5xx/网络抖动容忍重试）；进度无真实值时 `timeRamp` 缓慢爬升封顶 90%；供应商 `timeout` 语义改 **0=不限时（默认）**（内置模板全改 0，merge 时旧默认 600000 一次性归一为 0，显式设过其它值的保留）；渲染端 runVideoNode 兜底计时器仅在显式上限时挂（timeout+90s），不限时下完全靠 video:done 推送驱动（节点「取消」随时可停）。**插曲**：PowerShell -replace 改 videoProviders.ts 时把文件编码毁了（UTF-8 被按 GBK 读写 + 信息丢失，且该文件未入 git）——从 10 分钟前的构建产物 `out/main/main.js`（编译产物保留全部中文字符串与注释）完整反向恢复并重写，353 测试全绿验证无损；**教训：不要用 PowerShell 文本替换改 UTF-8 源文件，一律用 Edit 工具**。② **视频输入全链路**——拖视频文件进画布 → 自动建「视频上传」节点（多文件多节点）；Ctrl+V 粘贴资源管理器复制的视频文件 → 同上；拖视频文件到「视频上传」节点上 = 直接换源；全部**存本地路径不内联**（新 `lib/mediaFile.ts`：isVideoFile/electronFilePath，Electron 28 File.path）；**folder-input 节点扫描含视频**（`api:storage:list-images` 加可选 `kinds` 字段零新通道，`FolderInputNodeData.videoFiles` 进上游 videos 通道，VIDEO_SOURCES 加 folder-input——文件夹批量喂 视频反推/缩放/插帧）。③ **视频预览统一**——`nodeArea.openVideoPreview`（统一 Lightbox type='video'）：视频生成/视频上传/缩放/插帧 节点播放器 双击放大 + 右键「放大播放/另存/打开目录」；插帧**完成自动弹出放大播放**（第一时间对比流畅度）；folder-input 视频行点击预览。④ **图库多类型收录（图片/视频/SVG/PSD/PDF/Office）**——新 IPC **`api:gallery:import-files`**（本地路径批量导入：复制进存储根 + INSERT，notes=`[import:<kind>]`、params_json 记 import_kind+source；图片即刻缩略图；视频封面渲染端导入后抓帧补 saveThumbnail；扩展名白名单与 `lib/mediaFile.ts fileKindOf` 同步）；Manager 工具栏「导入文件」按钮（pickFiles 多选）；卡片按类型渲染：视频有封面=封面+🎬 角标、无封面/PSD/PDF/Office=类型图标卡（`.mb-gallery-filecard`）；点击行为：视频=Lightbox 播放（已有 type 判定）、PSD/PDF/Office=系统默认程序打开（`storage.openPath`，且不进 Lightbox ←→ 导航列表）。⑤ **便携图库三修（真根因）**——「下拉内容缺失」= 深色主题下 Chromium 原生 option 白底+主题浅字（白底白字），显式给 option 配色；「按钮超界」= 工具条不换行 + 全局 select 大内边距，bar 加 flex-wrap + 下拉收紧 34px/ellipsis；「搜索框没反应」= gallery.list 只搜 prompt/notes 两字段（导入图/视频两者全空，搜什么都无结果）→ 搜索面拉宽到 model_used/file_path/tags（Manager 同享），另补响应竞态守卫（快速打字旧响应覆盖新结果）；「缩略图卡」真根因 = **MeasuredThumb 每张卡 off-DOM 拉取整个原图量分辨率角标**（500 张 = 500 次全图 I/O）→ 加 `noDims` 跳过 + `content-visibility:auto` 离屏跳渲 + 分批渲染（160 张/批「加载更多」）+ 无封面视频 🎬 占位卡（防 <img src=mp4> 裂图）+ 视频右键「加到画布」建视频上传节点。沉淀**铁律 22（长任务等待）/ 23（视频与多类型收录）**。新 IPC：1 个（api:gallery:import-files）。验证：web/node tsc 绿 · 353 tests 绿 · build 绿。
> **2026-06-12 第三批：本地视频可播放（stream 特权根因）+ 软件全产物自动入库 + 提示词管家复活**：① **本地视频在节点/Lightbox 都无法播放的根因修复**——`mengbi-image://` 自定义协议注册时漏了 **`stream: true`** 特权（main.ts registerSchemesAsPrivileged）：Chromium 规定 `<video>/<audio>` 媒体元素只能从带 stream 特权的自定义协议加载（`<img>` 不需要，所以图片一直正常）；与打包无关，dev/打包都坏，本地视频播放链路自接入起从未真正通过（之前都在播远程 http URL）。同补打包 CSP **`media-src 'self' data: blob: https: mengbi-image:`**（media-src 缺省回退 default-src 'self'，打包后会再拦一道）。**注意：scheme 注册在 app 启动前，改它必须重启 dev 进程，HMR 无效**。② **软件全产物自动入库**（用户要求：软件产生的一切资料全部进图库）——新公共函数 `electron/services/producedMedia.ts:insertProducedMedia`（INSERT 样板=video.ts saveVideo；file_path 存绝对路径**引用原位不复制**；kind=image 同步 ensureThumbnail，video/svg 缩略图 NULL；失败只记日志绝不连坐主流程）+ **新 push 通道 `gallery:changed`**（300ms 去抖广播，preload 白名单 + PushChannel；不复用 image:done——其 payload 是生成任务语义）。接入 5 处：插帧（interp.ts run 成功，响应加 imageId）、视频缩放/补帧（video.ts api:video:scale，响应加 imageId）——两者渲染端 `backfillVideoPoster`（smartCanvasRunner 抓首帧→api:video:save-thumbnail 补封面，样板=routeVideoDone）；矢量化 SVG（batchQueue.markSucceeded，notes `[vec:engine]`）；Real-ESRGAN 放大 run-single/run-batch 逐张（notes `[upscale] model xN`）；HYPIR（pollTask 终态 done 时插一次）。**防重复**：共享 `ResultActions` 删掉「加入图库」（右键菜单项 + 按钮，importToGallery 函数移除）改「已自动入图库」徽章（`.mb-result-autogallery`）——手动再入会经 import-from-buffer 复制+INSERT 出双份。Manager 与便携图库 `SmartGalleryPanel` 监听 `gallery:changed` 自动刷新（与 image:done 并行订阅）。视频生成 saveVideo 也补了 broadcastGalleryChanged。③ **提示词管家复活**——考古发现 2026-06-05 下线时**只删了模式切换入口**，Manager 里整套提示词视图（分类侧栏/卡片网格/编辑弹窗/右键菜单/savePrompt/deletePrompt）与 `.mb-manager-mode*` CSS 都以 `mode='gallery' as Mode` 死分支形式休眠保留 → 复活=恢复 `useState<Mode>` + 侧栏「图库 / 提示词」segmented 切换两处小改，后端 `api:prompt:*` 零改动。preload 休眠注释同步更新。新 push 通道 1 个（gallery:changed），新 IPC handler 0 个。验证：web/node tsc 绿 · 353 tests 绿 · build 绿。
> **2026-06-13 配色工具节点 + 内置提示词 + 图库→资产库改名 + 资产库分拣 + 黑帧封面兜底 + 视频悬停预览 + 白屏 bug 根治**：① **新节点「配色工具」（palette，第二十四类）**——接上游图（或卡上传）→ 本地中位切分提取 N 个主色（`lib/paletteExtract.ts quantizePixels`，渲染端 canvas 缩到 ≤96px 取样，零 IPC 零成本）；调色模式=基准色推导 互补/对比(三角)/邻近/分裂互补/四角/单色深浅（`lib/paletteColor.ts deriveScheme`）。每色给 **HEX/RGB/CMYK/HSL/HSB** 五种色值可复制（`colorValueStrings`）+ 中文色名近似（`colorName`）；整板**导出 .ase（Adobe Swatch Exchange）/ .aco（PS 色板）** 直接进 PS/Illustrator/InDesign/CorelDRAW（`lib/swatchExport.ts` 纯字节构造 + base64 走既有 `api:storage:save-as`，零新 IPC）；实时生成配色提示词文本喂下游（与 视角/光源 同类，走 collectOwnOutput/computeUpstream 的 prompt 通道）。全套接入面（SmartNodeKind/PaletteNodeData/defaultNodeData/DEFAULT_SIZE/icons PaletteNodeIcon/NodeShell ACCENT_ICON/NODE_TYPE_LABELS×2/NodeSearch/CanvasDock 分析改写段/CreateMenu DOWNSTREAM+UPSTREAM/nodeTypes memo/CanvasViewport 连线集合 PRODUCERS+CONSUMERS+IMAGE_INPUT_ONLY+RESULT_SOURCES/ON_NODE_TYPES+NODE_OPS/textOutputOf）；纯函数 +45 例 vitest（paletteColor/paletteExtract/swatchExport）。② **提示词库内置常用提示词**——`electron/services/promptSeeds.ts`（28 条：风格迁移/材质迁移/动作·姿势·表情迁移/比例修改/绘画编辑/人像/电商/修复/文生图，面向 gpt-image-2/Nano Banana 等指令跟随型编辑模型撰写，占位用【】），**DB 迁移 v16 种一次**（删了不复活；全新库时先 INSERT OR IGNORE 'image' 分类再取 id）。`schema_version` 15→16。③ **「图库」全量改名「资产库」**——src/ + electron/ 共 53 文件 176 处中文串改名（Node utf8 批量，不碰 `api:gallery:*` 通道 / `mb-gallery-*` CSS / 标识符——中文不会出现在这些里，安全）。④ **资产库类型分拣**——`uiStore.managerKindFilter`（持久化）+ Manager 顶部分拣条（全部/图片/视频/其它，带数量角标，按 `fileKindOf` 归桶）+ 便携资产库（SmartGalleryPanel）紧凑 全部/图片/视频 分拣。⑤ **视频封面黑帧兜底**——`videoPoster.grabFirstFrame` 重写：默认取真·首帧（loadeddata，不 seek），首帧平均亮度 <18 判黑 → 依次 seek 10%/30%/50%/70% 找第一张非黑帧，全黑退回最亮一张（`frameMeanLuma` 32×32 取样）。所有 captureVideoPoster 调用点（生成/缩放/插帧/Manager 导入）自动受益。⑥ **视频节点悬停自动预览**——`nodeArea.hoverPreviewProps()`（移入静音播放、移出暂停回首帧），接入 5 处 `<video>`（生成/上传/缩放/插帧/结果）。⑦ **白屏 bug 根治**——根因：根级 ErrorBoundary（main.tsx）包整个 App（含侧栏）且无 reset，一处渲染崩溃 → 整树替换 + 永不恢复 = 「所有功能无法使用」。修：ErrorBoundary 加 `resetKey`（路由变自动复位）+ `contained`（只占内容区）；App 内用页面级 `<ErrorBoundary contained resetKey={pathname}>` 包 Routes（崩溃只显示可恢复错误卡、侧栏导航仍可用、切页自动恢复）；防御性在离开智能画布时复位全部弹窗单例（promptPicker/galleryPicker/galleryPanel/character/storyboard/preview/textViewer，杜绝残留遮罩跨页阻断交互）。验证：web/node tsc 绿 · 398 tests 绿 · build 绿。
> **2026-06-13 续：视频编辑节点（视频处理 + 视频合并）+ 内置提示词加到 36 条**：① **新节点「视频处理」（video-edit，第二十五类）**——接上游视频 → 本地 ffmpeg 重编码，op 三选一：**裁切**（起止秒，`-ss/-to` 后置精确裁切）/ **基础调色**（亮度/对比度/饱和度/伽马 → `eq`，色相 → `hue`，滑块调）/ **声音处理**（保留/静音 `-an` / 音量 `volume` / 淡入淡出 `afade`，淡出经 `probeVideo` 解析时长定位 st）→ 输出 mp4 喂下游。② **新节点「视频合并」（video-merge，第二十六类）**——接 ≥2 个上游视频，按连入顺序 `concat` filter 拼接（统一到首段分辨率：`scale+pad+setsar`；全部含音轨才 `a=1` 拼声音，否则只拼画面）→ 输出 mp4。③ **后端单一新 IPC `api:video:edit`**（`electron/ipc/video.ts:editVideoWithFfmpeg`，op=trim/color/audio/merge 分发；复用 ffmpeg-static + asar.unpacked 重映射 + `insertProducedMedia` 自动入库 + 封面渲染端 `backfillVideoPoster` 抓帧补；`probeVideo` 解析 stderr 取时长/分辨率/音轨，无需 ffprobe）+ `VideoEditSchema` + `VideoEditInput` 类型 + preload `video.edit`。④ **全套节点接入**（2 个 kind × SmartNodeKind/VideoEditNodeData+VideoMergeNodeData/defaultNodeData/DEFAULT_SIZE/sanitizeTemplateNode/icons VideoEdit+VideoMergeNodeIcon/NodeShell ACCENT_ICON/NODE_TYPE_LABELS×2/NodeSearch/CanvasDock 预处理段/CreateMenu DOWNSTREAM+UPSTREAM 视频链/CanvasViewport nodeTypes memo + 连线集合重构（新增 `VIDEO_OUTPUT_KINDS`/`VIDEO_CONSUMER_TARGETS` 取代原 video-source/video/frame-interp 内联判断，VIDEO_SOURCES/VIDEO_INPUT_ONLY/RESULT_SOURCES/FOLDER_OUTPUT_SOURCES 全加新 kind）+ 右键「运行此节点」/ON_NODE_TYPES+NODE_OPS/runner collectOwnOutput+computeUpstream 视频通道+RUNNABLE+needsRun+runOne+runAllNodes 分发+runVideoEditNode/runVideoMergeNode（同步等完成，样板=runScaleVideo，不定式进度条 `.is-indeterminate`））。**设计取舍**：裁切/调色/声音合到一个「视频处理」节点用 op 切换（单视频进出，链式放多个即可），合并因多输入语义单列——2 节点覆盖用户列的 4 项能力，比 4 个独立节点省事且清晰。⑤ **内置提示词 28 → 36**——`promptSeeds.ts` 加 `SEED_PROMPTS_V17`（8 条：光影/色调/构图/时间/季节 迁移 + 局部放大/多图融合/加文字编辑）+ **DB 迁移 v17**（单独迁移：老库只补这 8 条不重种前 28 条；新库 v16 种 28 + v17 种 8 = 36）。`schema_version` 16→17。验证：web/node tsc 绿 · 398 tests 绿 · build 绿。
> **2026-06-13 续二：裁切可视化时间轴 + 合并顺序调整 + 多智能体审查修 12 bug**：① **视频处理(裁切)加可视化时间轴**（`VideoEditNode.TrimTimeline`）——输入视频预览 + 轨道双手柄拖入/出点（预览帧 seek 实时跟随）+ 选中区高亮 + 时间读数；出点拖到 ≥99% 存 `end=0`（到结尾）；保留精确秒数输入双向同步。② **视频合并加顺序调整**——`VideoMergeNodeData.order`（视频路径数组）+ 卡上片段列表 ↑/↓ 调序；纯函数 `lib/videoMergeOrder.ts`（`orderedVideos`/`videoBaseName`，order 中仍在的先按其序、其余原序追加）+ 11 例 vitest；`runVideoMergeNode` 按 order 重排。③ **多维对抗式审查工作流（5 finder × 对抗 verify，23 agent）确认并修 12 bug**：**[ffmpeg]** (a) audio 默认「保留原声」(keep) 后端无分支 → 必报「请设置音量或淡入淡出」：补 keep=视频重编码+`-c:a copy` 透传；(b) fade 淡出 probe 失败(durationSec=0)时 st 兜成 0 把淡出加到**开头**(与意图相反，静默)：probe 失败跳过淡出+提示，不再兜 0；(c) merge 音轨未归一 → 不同来源(44100/48000、单/立体声)concat **直接失败**：每段音轨先 `aresample=48000,aformat=...stereo`；(d) merge 用首段原始宽高 → 奇数分辨率(如 1281×721)libx264 失败：`& ~1` 对齐偶数；(e) probeVideo 20s 超时只 resolve 不 kill → 挂起 URL 泄漏 ffmpeg 进程：超时补 `child.kill`。**[连线矩阵]** (f) 视频产出节点→folder-output 被新 `VIDEO_OUTPUT_KINDS` 闸门误杀(与 FOLDER_OUTPUT_SOURCES 白名单及创建菜单矛盾，拖线拒/菜单建不一致)：canConnectKinds+invalidReason 放行 `tk==='folder-output'` 交白名单接管；(g) `UPSTREAM[group]` 含 video-source 但校验器拒(菜单能建拖线拒)：移除；(h) video-edit/video-merge 的合法上游 group/result/scale 在 DOWNSTREAM 缺失(创建菜单方向不对称)：补全。**[React/UI]** (i) 裁切精确输入框 `ClampNumberInput` 强制 `Math.round` 取整 → 破坏 0.1s 时间轴双向同步(聚焦失焦即把 1.5 篡改成 2)：加可选 `decimals` 参数(默认 0 兼容旧调用，裁切传 1)；(j) effEnd 反推出点可能 > 真实时长(换更短上游后)致读数越界：夹到 dur。**[迁移]** (k) `SEED_PROMPTS` 实为 27 条(误当 28)→ 三种迁移场景都少 1 条(35 而非 36)：把缺的 1 条补进 `SEED_PROMPTS_V17`(→9 条)使 27+9=36 在「全新/v15/已种 v16」三场景都成立，新增 `promptSeeds.test.ts` 锁死 27/9/36。验证：web/node tsc 绿 · 414 tests 绿 · build 绿。
> **2026-06-13 续三：视频剪辑节点（剪映/PR 式时间轴，长条形 + 剪辑工作台）重做 + 删 video-edit/video-merge**：按用户反馈（方形节点对视频不友好、合并不该独立、参照 PR/剪映）把上一轮的 video-edit(视频处理)+video-merge(视频合并) **两节点删除合并为一个「视频剪辑」节点 video-clip**（第二十五类）。① **长条形节点**（480×220）：内嵌轻量时间轴——上游每段视频自动成片段块（按时长比例排布），HTML5 拖动排序、点选、选中段快速调 入/出点 + 转场；双击/「🎬 剪辑台」进**全宽剪辑工作台弹窗**（`VideoClipStudio`，portal+Esc，宽时间轴标尺+视频轨+文字轨+右侧 片段/调色/文字 三 tab：每段 裁切/变速/音量/静音/淡入淡出/转场，整体 亮度·对比·饱和·伽马·色相+帧率，文字叠加增删改）。② **后端单一新 op `api:video:edit` op='clip'**（`electron/ipc/video.ts`：逐段 probeVideo 取时长/音轨/分辨率 → 纯函数构图 → 一次 ffmpeg 合成；`resolveOverlayFont` 跨平台找中文字体）。③ **核心正确性=纯函数 `electron/services/video/clipGraph.ts:buildClipFilterGraph`**（多段 trim+变速 setpts/atempo + scale/pad/setsar/fps 统一 + 每段音频 volume/afade/静音 anullsrc + 段间 concat 或 xfade/acrossfade **左折叠** + 整体 eq/hue + drawtext 文字叠加按时间 enable）**+ 23 例单测**；渲染端编排纯函数 `src/lib/videoClip.ts`（reconcileSegments/sameSegmentSrcs/segmentOutDuration/totalTimelineDuration/layoutSegments/formatTimecode）**+ 17 例单测**。④ **上游视频→片段 reconcile**：保留用户排序与每段编辑参数（按 src 键），新增追加、断开剔除；运行端 `runVideoClipNode` **运行时自我 reconcile**（不依赖组件渲染，修审查发现的「中间节点没渲染/滚出视口/新建即运行 → 误报无片段」高危）。⑤ 全套接入切到 video-clip（连线集合/CreateMenu 对称/工具坞/图标/store/runner RUNNABLE+needsRun+runOne+runAllNodes+collectOwnOutput+computeUpstream/ON_NODE_TYPES），删 `videoMergeOrder.ts`+旧两节点文件。**多智能体对抗式审查（4 维 finder→对抗 verify）确认并修 6 bug**：drawtext 单引号转义错误（`'`→`'\''` 关-转义-开 + 单引号内逗号/冒号不再重复转义、fontfile 改不加引号转义盘符冒号）、runVideoClipNode 不自我兜底（已修，见④）、CreateMenu UPSTREAM['result']/['folder-output'] 漏 video-clip（补对称）、剪辑台时长未测到时片段块堆叠 left:0（total≤0 降级流式等宽）。验证：web/node tsc 绿 · 442 tests 绿 · build 绿。
> **2026-06-13 续四：剪辑工作台打磨「源监视器」（看得见地剪，零后端改动）**：上一轮剪辑台只能靠数字框盲剪 + 跑完整 ffmpeg 才看得到结果。本轮给 `VideoClipStudio` 加**源监视器**（参照剪映/PR），全部客户端、零新 IPC：① 选中片段顶部出现**原始视频播放器**（`SegmentMonitor`，播放/拖动预览选中段的**未裁切源**，点画面=播放/暂停）。② **可视化裁切轨**：轨道上 入/出点两个手柄可拖（`pointermove` 实时改本段 `trimStart`/`trimEnd` 源秒、保留区高亮 + 播放头线），出点拖到末尾自动回「到结尾」(trimEnd=0)；点/拖轨道=定位预览。③ **设入/出点**：播放到某处点「⇤ 设入点 / 设出点 ⇥」用当前播放位置定点。④ **快捷键**（`SegmentMonitor` 内 window keydown，经 `actionsRef` 取最新闭包避免 [] 依赖抓旧值；INPUT/TEXTAREA/SELECT 聚焦时不触发）：空格=播放/暂停、I=设入点、O=设出点。⑤ **时间轴片段块加首帧封面**：新 hook `useSegmentPosters`（VideoClipNode 导出，复用 `videoPoster.captureVideoPoster`，按 src 全局缓存 + 占位防并发重抓、best-effort 失败回退渐变底），片段块底图变成该段画面（叠暗渐变保文字可读），时间轴「看得懂」。仅 studio 用封面（节点小条不抓全 blob，不拖累画布）。监视器与右侧「片段」面板入/出点数字框双向同步。CSS `.mb-vstudio-monitor*`/`.mb-vstudio-trim*`。零新 IPC。验证：web/node tsc 绿 · 442 tests 绿 · build 绿。
> **2026-06-13 续五：剪辑工作台再打磨三件（循环预览 + 画面拖字 + 时间轴拖边裁切）**，全部客户端、零新 IPC：① **入/出点循环预览**——源监视器加「循环」开关，开后播放到出点自动跳回入点（`onTime` 在 timeupdate 里判 `t>=outT-0.03||t<inT-0.05` 则 `seek(inT)`），反复看裁切区间不用手动倒带。② **文字在画面上直接拖定位**——文字 tab 下，监视器画面叠加可拖的文字层（`mb-vstudio-textlayer`/`textdrag`）：按 contain 模式算出视频真实内容区（去黑边，`ResizeObserver` 跟踪元素尺寸 + `loadedmetadata` 取自然宽高）盖一层，文字按 `x/y(0~1)` 用 `left/top + translate(-x%,-y%)` 定位——**与 ffmpeg `(w-tw)*x` 锚点语义逐字一致**（0 贴左 / 1 贴右 / 0.5 居中），拖动即改 x/y（与右侧 X/Y 滑块双向同步），字号按内容区/自然高缩放近似预览；层 `pointer-events:none`、仅文字块 `auto`，点空白仍可播放。③ **时间轴片段块拖右边缘裁出点**——每块右缘加裁切手柄（`mb-vstudio-edge.is-r`，悬停/拖动显竖条），按 pointerdown 时捕获的轨道矩形 + 固定比例尺（`secPerPx=total/trackW`）+ 基线 `leftPx0` 算 `trimEnd`，被拖块用 px 预览贴手、左缘钉住（与无缝串联布局一致 → 松手不跳），邻块按新 trim 实时回流(ripple)；拖块仍可整体拖拽排序（`edgeDraggingRef` 同步标志在 `onDragStart` 里 `preventDefault` 防误触发 HTML5 reorder）。**有意只做右缘**：无缝串联时间轴里片段左缘由前序片段钉死，拖左缘要么松手跳要么脱手，故**入点裁切交给监视器的入点手柄**（那里显示完整源、入点标记自由移动，体验最佳）。CSS `.mb-vstudio-screenwrap`/`-textlayer`/`-textdrag`/`-loop`/`-edge`。零新 IPC。验证：web/node tsc 绿 · 442 tests 绿 · build 绿。
> **2026-06-13 续六：设置页模型配置「按中转站分组」整合（中转站多合一，免重复输入）**——痛点：一个中转站同一 `base_url+Key` 能跑 对话/绘画/视频，旧 UI 按类型分三组、要建 3 条、重复输 3 次 名称/地址/Key。**纯界面层整合，零 schema/IPC 改动**（后端 `settings.save({configs:[...]})` 早支持一次存多条）：① **卡片改「按中转站分组」**（`Settings/index.tsx`：`groupConfigsByProvider` 按归一化 base_url 聚合，空地址=本地模型各自独立成站）——一张 `ProviderCard` = 一个站点，列出其 对话💬/绘画🎨/视频🎬 各配置行（点行编辑、右键 编辑/复制/删除单条、能力/视觉/联网/思考徽章），卡头有图标+名称+地址+「删整站」（确认列出 N 条一并删，`deleteProvider` 串行 `plan.configDelete`）。② **「+ 补能力」**：卡片底部对缺失的类型给 `+ 对话/绘画/视频` 按钮 → `openNewForProvider(type, shared)` 新建该类型时**自动带入本站 名称/地址/Key/图标**（`SharedProvider`），只需补协议+模型，不再重输。③ **「同步共享信息到全站」**：编辑某配置时若本站有同 base_url 的兄弟配置（`siblings`），表单底部出现勾选框（默认勾选）——保存时把 名称/地址/Key/图标 一并写到全站其他配置（一次 `settings.save` 多条；**Key 仅非空时同步**，避免解密失败的空串清掉别处 Key）。`configToInput`/`normalizeBaseUrl` 抽公共助手；删除旧 `ConfigGroup`（按类型分组）改 `ProviderCard`。顶栏仍保留 对话/绘画/视频 三个「新建站点」按钮 + 删除方案。CSS `.mb-provider-grid/-card/-head/-rows/-row/-add`、`.mb-sync-shared`。零新 IPC。验证：web/node tsc 绿 · 442 tests 绿 · build 绿。
> **2026-06-13 续七：超大图（几万×几万）封面卡死根治——全软件封面只走小图，原图只在放大时加载**。用户反馈：生成/放大出几万像素见方的巨图后，各处封面卡顿甚至卡死。三处根因全修：① **[根因·全软件] 缩略图生成被 sharp 像素上限挡掉**——`electron/services/thumbnail.ts:generateThumbnail` 的 `sharp()` 未设 `limitInputPixels`，默认 ~268MP（16383²）上限对「几万²」直接抛错 → `thumbnail_path` 为 NULL → 各处封面回退渲染原图。改 `sharp(p, { failOn:'none', limitInputPixels:false, sequentialRead:true })`（解除上限 + 按扫描线流式缩放，峰值内存只占几行不 OOM）。这是 keystone：修好后**全软件**（资产库 Manager / 便携资产库 / 智能画布结果·生图·ComfyUI 节点 / Create / ComfyUI 输出，凡用 `thumbnail_path`/`thumbUrlFromOriginalPath` 的封面）巨图都能拿到 512px WebP 小图。② **[渲染端] 封面为量角标偷偷解码原图**——`MeasuredThumb` 原来对每张封面 off-DOM `new Image(fullSrc)` 解码原图量「真实分辨率」角标，对几万²图等于在渲染端整张解码=卡死主因。**移除该 off-DOM 测量**：封面只加载缩略图，绝不为角标解码原图；真实分辨率改到放大预览(Lightbox)看。仅当缩略图缺失回退显示原图时才顺带量（那时本就在显示原图）。③ **[智能画布] 图片节点渲染原图**——`ImageNode` 封面由 `<img src=原图>` 改 `thumbPair(src).thumb`（本地图走 .thumbs，dataURI 用自身，缺失 onError 回退原图），点击放大才 `openPreview(原图)`；onLoad 仅在显示原图时量 naturalW/H（显缩略图时跳过，避免误记 512 尺寸）。数据流确认：智能画布生成结果存的是**文件路径不是 base64**（`generateOnce` 取 image:done 的 `paths`），`generate.ts` 落盘后**先 await `ensureThumbnail` 再发 image:done**，故缩略图就绪后封面即用小图。**铁律 23 ③ 同步修订**：封面一律走缩略图，MeasuredThumb 不再 off-DOM 解码原图量角标（`noDims` 退化为兼容项）。零新 IPC。验证：web/node tsc 绿 · 442 tests 绿 · build 绿。
> **2026-06-13 续八：节点视频「有些能播有些不能播」根治（协议 Range 支持 + ffmpeg faststart）**。用户反馈智能画布部分节点视频播放有问题。多智能体审计（7 表面 × find→对抗 verify，22 条确认）定位**双根因**：① **[keystone·全软件] `mengbi-image://` 协议不支持 HTTP Range** —— `electron/main.ts` 处理器原 `return net.fetch(pathToFileURL(file))`，这是**新建一个不带 Range 头的请求**，于是 `<video>` 的 `Range: bytes=...` 永远被整文件 `200` 回应（无 `Accept-Ranges`/`Content-Range`）→ 浏览器判定「不可 seek」，且 **moov-at-end 的 mp4 起播即失败/黑屏**。重写为**自解析 Range** 的流式处理器（`mimeForFile` 按扩展名给正确媒体 MIME + `fileStreamResponse` 用 `fs.createReadStream{start,end}` 经 `Readable.toWeb` 返回 `206` 分片 + `Content-Range`/`Accept-Ranges`/`Content-Length`；解析 `bytes=start-end`/suffix `bytes=-N`、越界返 `416`、流 error 兜底不崩主进程；无 Range 走 `200` 全量但带 `Accept-Ranges`）。一次修好**全软件**所有本地视频的起播 + seek（含剪辑工作台 SegmentMonitor 拖进度/loop 预览、Lightbox 放大、所有节点 `<video>`），不影响 `<img>`。移除不再用的 `net`/`pathToFileURL` 导入。② **[纵深] ffmpeg 产物全是 moov-at-end** —— 缩放/补帧/剪辑/编辑/合并/调色/音频 产物**都没 `-movflags +faststart`** → moov 在文件尾、起播必须先 seek 到尾读 moov（正好是「有些（ffmpeg 产物）不能播、faststart 的供应商/上传视频能播」的差异源）。给全部 mp4 输出加 `+faststart`：在 `runFfmpegToVideo` **集中注入**（覆盖 clip/trim/color/audio/merge，含 `-c:v copy` 的静音/音量分支——faststart 是 muxer 选项，copy 也会把 moov 重排到头，**无需重编码**，比逐分支重编码更省）+ `video.ts` 缩放内联路径 + `rifeRunner.ts` 合帧路径 各显式加。③ **[健壮性] `openVideoPreview` 幂等化** —— 入参里已是 `mengbi-image://`/`blob:`/`data:`/`http(s)` 的 URL 不再二次 `localPathToImageUrl`（`isFetchable` 正则；`meta.filePath` 仅对真实磁盘路径给值）。各节点调用点本就传原始路径（`?? url` 兜底实际不可达——`<video>` 仅在原始路径真值时渲染），但此改让「误传已编码 URL」也安全。④ **[一致性] 全部 `<video>` 加 `preload="metadata"`**（VideoNode/VideoSourceNode/ScaleNode/FrameInterpNode/VideoClipNode/NodeInspector/Lightbox；ResultNode 本就有）—— 加 faststart 后元数据在文件头，preload 让节点立刻显示首帧而非黑框。**未改**：Lightbox 视频不加 `muted`（放大播放=用户手势触发，允许有声自动播放，静音反而违背「放大播放」意图）；`-c:v copy` 分支不改重编码（faststart+copy 已够）。沉淀**铁律 23 ⑥ 扩充**：自定义媒体协议除 `stream:true`+CSP 外，**必须自解析 Range 返回 206**，否则 moov-at-end 视频不可播/不可 seek；本地 ffmpeg 视频产物一律带 `-movflags +faststart`。零新 IPC。验证：web/node tsc 绿 · 442 tests 绿 · build 绿。
> **2026-06-13 续九：列表/批量三件套（提示词列表 + 图片列表&批次 + 循环节点重做 + 生图「逐张处理输入图」）+ 设置卡片响应式**。① **设置页中转站卡片不再超宽**——`.mb-provider-grid` 由 `repeat(3, minmax(0,1fr))`（强制 3 列、宽屏每张被拉到 ~660px）改 `repeat(auto-fill, minmax(320px, 1fr))`：同行等宽、窗口越宽一行越多越窄越少、永不超宽；卡片 `min-height:132px` + 补能力行 `margin-top:auto` 沉底 → 高度观感一致（删旧 @media 断点，auto-fill 自适应）。② **提示词节点列表模式**——`PromptNodeData` 加 `{listMode, items[]}`；节点头「单条/列表」切换，列表里增删条目、从提示词库追加（PromptPicker 加 `targetListIndex` 支持插入第 N 条）；每条作为独立上游提示词喂下游（配合「多条提示词逐条生图」）。③ **图片节点列表模式 + 批次 + 自驱**——`ImageNodeData` 加 `{listMode, srcs[], batchSize, runStatus/batchIndex/totalBatches/doneCount/failCount/runLogs/runError, outBatch}`；多选/拖入/粘贴/资产库多选添加（GalleryPicker 列表模式追加且不关弹窗、可连选）、逐张删除、缩略图网格、「每批传下游 N 张」+「逐批运行下游」自驱（暂停/继续/停止，复用循环控制器）。④ **生图(work)节点「逐张处理输入图」**（`WorkNodeData.imageEach`，控制台「多张输入图：合并参考/逐张各跑」开关，仅非纯文生图显示）——逐张模式下 N 张上游图各跑一次生成（N 张=N 次结果，批量改图常用）；词数==图数时按序 zip 配对，否则每张同一条提示词。`runWorkNode` 的 `promptList` 泛化为 `taskList`（`GenTask{prompt,refs,label}`）三分支：逐张/多提示词/单条，复用既有 并发·seed偏移·合集卡(batchId/shotIndex)·单条重试 机制（`WorkBatchSnapshot.prompts[]+refs`→`tasks[{prompt,refs}]`）。⑤ **循环(loop)节点重做**——`LoopSourceType` 加 `'images'`（默认）；新增「图片批次（直接拖入多张）」来源（拖入/选入多张 + 缩略图预览 + 「每批 N 张」），folder 来源也支持批次；`loopItems` 的 `LoopItem.image`→`images[]`、新 `chunkImages`/`imageBatchItems` 按 batchSize 切批；来源顺序按常用度重排。⑥ **共享批次迭代核心**——抽出 `runBatchIteration(sourceId, items, targets, startIndex, startDone, startFail, stopOnError, docId, adapter)`，循环节点（`loopAdapter`）与图片列表自驱（`imageListAdapter`）共用同一套 暂停/继续/停止/跳过/从指定项继续/切画布硬停（Q2「两者都支持」：列表节点能自驱、也能接循环节点）。⑦ **持久化防爆配额**——`externalizeImageNodes` 扩展为也把 `srcs[]` 的 base64 落盘换路径（列表添加优先存本地路径 `electronFilePath`，仅网页拖图/粘贴退 dataURI）。**多智能体对抗式复核（4 维 find→对抗 verify，10 确认 / 排除 4 误报）修 6 个真问题**：[高] `sanitize()` 原本对 loop/image 自驱运行态零清理 → 重载残留「运行中」幽灵 + 旧批/旧项泄漏给下游，补 loop（status→idle 清 out*、留 currentIndex 供续跑）+ image（runStatus→idle 清 outBatch）清理；[高] loop `collectOwnOutput` 无状态门控 → 完成后手动跑下游读到上一项瞬态残留，加 `status===running|paused` 门控（对齐 `imageNodeOutputs`）；[高] retry 缺 `rounds` → loop 运行方式下重试只出 1 张（原应 rounds×perN）→ `WorkBatchSnapshot` 加 `rounds` + retry 重放全部轮次；[低] `imageListAdapter` 终态清 `outBatch` + `imageNodeOutputs` 显式 `length>0` 门控。误报（已核实无需改）：image 节点从不读 outPrompt/outSize；旧 loop 文档始终持久化了 sourceType（默认改 images 只影响新节点）；externalize 顺序实际已保序、竞态守卫正确避免覆盖用户改动；adapter 由 `node.type` 确定性选取。**无新节点 kind、无新 IPC**（纯扩展 prompt/image/loop 节点 + work 生成逻辑）。验证：web/node tsc 绿 · 447 tests 绿 · build 绿。
> **2026-06-14 设置页「三合一」统一配置编辑器（一个中转站只录一次 名称/地址/Key）**。痛点：对话/绘画/视频按类型分开建配置，同一中转站（同 base_url + 同 Key）要建 3 条、重复输 3 次。**纯界面层，零 schema/IPC 改动**（`settings.save({configs:[...]})` 早支持一次 upsert 多条，混合 update(有 id)+insert(无 id) 也按 id 分支各自处理）。① **新 `ProviderEditor` + `ModelBlock` 组件**（`Settings/index.tsx`）：顶部 名称/地址/Key/图标 **录一次**；「🔍 测试连接 + 拉取模型」（复用 `api:settings:test-connection` 返回的 `models`）→ 三块各自「+ 模型」一键指派上游模型（同一模型可同时指派到不同块）；下面 对话 / 绘画 / 视频 三块各自：启用开关 + 协议下拉（`official_kind`/`image_kind`/`video_kind`，复用 `OFFICIAL_KINDS`/`IMAGE_KINDS`/`VIDEO_KINDS` + 视频 `suggestVideoKind` 一键采用）+ 模型映射（复用 `MappingRow`）+ 对话块能力（`detectModelCapabilities` 自动识别 多模态/思考/联网 + Toggle + 思考强度）+ 绘画/视频块「高级：请求体覆盖」（折叠）。② **保存语义**：启用的块 → 组装 `ApiConfigInput`（共享 名称/地址/Key/图标 + 该块字段，有 `existingId` 走 UPDATE 否则 INSERT）一次 `settings.save({configs})`；**原本存在但被关掉的块 → `plan.configDelete`**；启用块必须有 ≥1 映射否则拦下；新启用块需 Key，编辑且共享 Key 留空（解密失败）时回退该块原 Key 避免误清。**同类型重复配置不在此合并**（只认每类首个，多余项保留、用行内单项编辑器管理，杜绝误合并丢数据）。③ **入口**：中转站卡片头新增「⚙ 配置」按钮（`SettingsIcon`，常显，主操作）→ 打开三合一编辑器；「+ 补能力」改为打开三合一编辑器并 `focus` 启用该块（名称/地址/Key 已带入）；保留 行内单项 `ConfigForm`（行点击/右键「编辑」，承载 预设/SDK 粘贴/逐字段高级）作高级路径；顶部「+ 对话/绘画/视频模型」仍走单项 ConfigForm 新建首条。④ **响应式收尾**：备注 `<p>` 补 `margin:0 0 16px`（原 0 底边距贴住卡片）；`.mb-provider-grid` 列宽下限 `320→256px`（卡片更窄、一行更多）。CSS `.mb-provider-edit`/`.mb-provider-editor`/`.mb-pe-*`（shared-row/testbar/blocks/block(.is-on)/block-head/block-body/detected/chip/advanced）。零新 IPC。验证：web/node tsc 绿 · 447 tests 绿 · build 绿。
> **2026-06-14 续：设置体验四改 + 窗口尺寸记忆**。① **创建模型只剩一个入口**——顶部 3 个「+ 对话/绘画/视频模型」收敛为单个「+ 新建中转站」→ 开三合一 `ProviderEditor`（existing=[]，在编辑器里勾选要哪几类）；删 `openNew`/`blankDraft`/`SharedProvider`（创建一律走统一编辑器，单项 `ConfigForm` 仅保留给行点击的「单项高级编辑」）。**澄清**：一个中转站确实只有一套 base_url+Key，但**每种能力的接口协议不同**（对话 `/v1/chat/completions`、绘画 `/v1/images/...`/grsai/apimart、视频 kling/sora/seedance…），所以三块各有协议下拉是必需的，不是「多套 API」。② **窗口尺寸记忆**（`electron/main.ts`）——关窗存 `userData/window-state.json`（`getNormalBounds()` 取还原尺寸 + `isMaximized`），启动恢复；位置仅当落在某个可见显示器工作区内才恢复（拔显示器后不跑到屏幕外）；`resize`/`move`/`maximize`/`unmaximize` 去抖 400ms 落盘、`close` 立即落盘；最大化状态在 `ready-to-show` 时 `maximize()`。`screen` 加入 electron 导入。③ **外观页半屏空白修复**——`.mb-appearance-atmospheres`(repeat(4,1fr))/`.mb-appearance-palettes`(repeat(5,1fr))/`.mb-appearance-halos` 都有 `max-width:720px` → 宽窗只占左半；改 `repeat(auto-fill, minmax(150/120/180px,1fr))` 去掉 max-width，按钮尺寸恒定、铺满内容区、窗口越宽一行越多。④ **三合一编辑器块：滑块开关 + 可折叠**——「启用」由整条标题点击改为右侧**滑块开关**（`.mb-pe-switch` 左关右开）；启用后可**折叠成一条仍保持启用**（`.mb-pe-collapse` ▾/▸，`collapsed` 独立于 `enabled`；已配置过的块载入时默认折叠、新启用默认展开）。**未做（下一专项 pass）**：存储/工具箱/许可证三个 tab 的卡片化 + 区域划分 + GPU加速/语音播报改灵动滑块（这次只做了外观自适应）；深色主题文字刺眼的柔化（待用户拍板）。零新 IPC。验证：web/node tsc 绿 · 447 tests 绿 · build 绿。
> **2026-06-14 续二：官方/中转站分区 + 官方预设 + 设置卡片化（存储/外观/工具/许可证）+ GPU·语音滑块**。澄清「官方 vs 中转站」：**同一套配置模型**（base_url + Key + 协议 + 模型映射），不拆两套数据；仅**展示分区**不同。① **中转站卡片按三区展示**（`ConfigList`）——`providerKind(baseUrl, is_official)` 按 `is_official` 标志或已知官方域名（OFFICIAL_HOSTS：openai/anthropic/deepseek/minimaxi/moonshot/bigmodel/dashscope/gemini/x.ai/mistral…）归类为 **官方直连 / 第三方中转站 / 本地模型**，每区一个带标题的 section。② **官方直连一键预设**（`OFFICIAL_PRESETS`，仅新建中转站时显示）——DeepSeek/MiniMax/Kimi/智谱/通义/OpenAI/Anthropic/Gemini 一点即填 地址+协议+能力（vision/web）、启用对话块、标记 `is_official`，只需补 Key。③ **通用滑块开关 `SwitchControl`（`.mb-switch`）**——三合一编辑器块「启用」、GPU 加速、任务语音播报 全部换成左关右开滑块（取代 开启/关闭 双按钮 + 旧 `.mb-pe-switch`）。④ **设置区域卡片化 `SettingsSection`（`.mb-settings-card`）**——存储与系统（存储位置/联网搜索/系统与体验/配置备份）、外观（主题外观/显示与缩放/性能模式/智能画布与光标）、工具箱（输出与保存/Real-ESRGAN/ONNX/HYPIR）全部分块成带标题+说明的卡片，区域划分清晰。⑤ **许可证条目卡片网格**（`AboutSection` `.mb-about-license-grid` auto-fill）——原 `<ul>` 竖列改自适应卡片网格；顺手删掉已砍除的 **SUPIR** 登记条目（与代码一致）。⑥ **本地模型经统一编辑器创建**：`save()` 放宽——仅对话块 + `official_kind='local'` 时不强制 base_url/在线 Key（Key 缺省 'local'）。零新 IPC。验证：web/node tsc 绿 · 447 tests 绿 · build 绿。**仍待**：深色主题文字柔化（已诊断 halation + 假性加粗描边 + 高对比，待用户拍板再改全局主题 token）。
> **2026-06-14 续三：深色主题文字柔化（消除黑底晃眼）**。根因（上轮已诊断）：近纯白 `#f5f5f7` 文字 + 全局假性加粗描边 `0.014em` 在近黑底（deep-quiet `#0a0b10` / none `#0c0d12`）上产生 halation（边缘光晕）→ 刺眼。`-webkit-font-smoothing: antialiased` 本就开着，故从两处下手（`src/styles/theme.css`）：① **假性加粗描边 `0.014em → 0.009em`**（全局，保留中文可见加粗，显著减轻所有深色主题的边缘 glare；微软雅黑只有 400/700 故仍需一点描边）；② **`:root` 与 `deep-quiet` 的 `--mb-text-primary` 由纯白 `#f5f5f7` 降到柔白 `#e8e9ee`**（secondary/muted 同步微调），覆盖用户报的「黑色背景」默认主题 + `none`（inherits :root）；对比度仍 ~15:1，清晰不washed。其余 atmosphere 文字本就是带色调的偏白（在偏亮的 tinted 底上不刺眼），仅受益于全局描边收窄，未逐一改色。仅 CSS。验证：build 绿。
> **2026-06-14 续四：自定义请求头 / 鉴权覆盖（卡密会员 / 特殊中转站接入，schema v18）**。痛点：有些官方卡密会员 / 中转站给的是标准 `sk-` key 却用不了——因为要**非标准鉴权头**（如 `Authorization: Token xxx` / `x-api-key: xxx` / 额外 `X-*` 头），而 §13 的「请求体覆盖」只能改 body、改不了 header。本轮加 **per-config 自定义请求头**：① **DB schema v18**：`api_configs` 加 `header_overrides_json TEXT`（migration + `CURRENT_SCHEMA_VERSION 17→18`）；domain `ApiConfig`/`ApiConfigInput` + zod `apiConfigInputSchema`（JSON 对象校验，复用 body_overrides 套路）+ settings load/upsert（**INSERT 20→21 列 + 两个 UPDATE 分支 + 参数对齐**，避开历史「Too few parameter values」坑）+ configIO 导出/导入（SELECT/INSERT 各补一列，免导出再导入丢失）全链路。② **纯函数 `electron/ipc/headerOverrides.ts:applyHeaderOverrides`**（+12 例 vitest）：把 JSON（header 名→值）合并进默认头——值支持 `${key}`/`${model}` 内嵌替换（写 `"Authorization":"Token ${key}"`、`"x-api-key":"${key}"`）、值为 `null` 删除该 header（换掉默认 Authorization）、**header 名大小写不敏感覆盖**（不产生两个鉴权头）、解析失败/非对象容错原样返回不抛。③ **运行层接入**：对话 chat.ts 全 3 处（optimize 一发一收 + streamOpenAICompat + streamAnthropic，**解决卡丁会员=对话模型的核心场景**）；绘画 generate.ts 主 OpenAI JSON 路径 3 处（generations + responses-SSE + edits-SSE）；lab.ts 反推/视觉；video.ts legacy 引擎中央 `authHeaders` + 上传素材（kling/sora/unified 生效）。各点都传 `{key, model}` 供变量替换。④ **设置 UI**：三合一 `ProviderEditor` 加「高级：自定义请求头 / 鉴权」折叠区（textarea + JSON 实时校验 + `${key}` 用法提示，**整站共用**写到该站每条配置）。**未接（按需再扩，已在总结说明）**：绘画 grsai/apimart/gemini/comfyui/FormData-edits 等专有协议分支、video adapter（seedance/veo/runway/fal，各自建头）、单项 `ConfigForm`（行点击编辑）暂不暴露该字段但**值会 round-trip 不丢**（编辑头走 ⚙ 配置的 ProviderEditor）。零新 IPC。验证：web/node tsc 绿 · 459 tests 绿 · build 绿。
> **2026-06-14 续五：中转站分类显式化（两个新建按钮 + 编辑里可调分类 + 点卡片即编辑）**。① **新建拆两个按钮**：「+ 官方直连」/「+ 第三方中转站」分别打开三合一 `ProviderEditor` 并带 `officialDefault` true/false（`openProviderEditor` 加第三参，`providerEditing` 加 `officialDefault`，弹窗标题随之分「新增官方直连/第三方中转站」）。② **分类以 `is_official` 为唯一真相**：`providerKind` 删掉按域名猜的 `OFFICIAL_HOSTS`，只看 `is_official`（空地址=local）→「官方 ↔ 第三方」两个方向都能手动调、且不被自动判定覆盖（解决「Kimi 被归到第三方、想往上调」）。③ **编辑器加分类切换**：`ProviderEditor` 顶部「分类」两段按钮（🏢 官方直连 / 🔁 第三方中转站，`.mb-pe-cat`），绑 `official` 状态，保存写入该站每条配置的 `is_official`；新建用按钮传入的默认、编辑读现状。④ **点卡片即进编辑**：`ProviderCard` 整张 `is-clickable` → `onEditProvider(configs)`；删除按钮 / 「+ 补能力」/ 行右键各自 `stopPropagation`；移除原 ⚙ 按钮（降级为装饰图标）；行左键不再开单项编辑（冒泡到卡片开三合一），单项高级编辑（旧 `ConfigForm`）改到行**右键菜单**「单项高级编辑…」。零新 IPC。验证：web/node tsc 绿 · 459 tests 绿 · build 绿。
> **2026-06-14 续六：设置卡片紧凑化 + 自动首字图标 + 智能画布「镜头」节点 + 光源增强 + 示意图标 + 下拉美化（六合一反馈）**。① **中转站卡片：分类按钮上移 + 名称缩短**——`ProviderEditor` 把「🏢 官方直连 / 🔁 第三方」分类按钮从单独一行移到**名称输入框右侧同一行**（`.mb-icon-and-name-row` flex-wrap + `.mb-pe-name-input` flex:1 1 200 + `.mb-pe-cat` 不拉伸/紧凑/`第三方中转站`→`第三方`），删掉独立的「分类」Field，省下方空间。② **厂商图标自动首字**（`src/lib/providerIcons.tsx`）——`ProviderIcon` 加 `name?` 入参 + 新纯函数 `providerInitial`（英文取首单词首字母大写 / 数字取首位 / 中文等取首字）+ `providerInitialColor`（名称 hash 稳定 HSL 底色）；无 preset/自定义图时不再显示「?」，而是「首字 + 底色」自动图标（卡片 / 图标选择器预览 / 「自动」格 三处传 `name`）。③ **智能画布「视角」节点升级为「镜头」节点**（不新增 kind，仍 `angle-prompt`）——加 `camMode`(拍照/视频) + 拍照(`cameraType`/`aperture`) + 视频(`movement`/`focal`) + 通用(`composition`)；新纯函数 `src/lib/cameraPrompt.ts:buildCameraPrompt`（+ `cameraPrompt.test.ts` 8 例）按模式拼镜头提示词。**卡片保持干净**（预览 + 模式徽章 + 带图标的设置摘要 chips + 提示词 + →提示词节点）；**详细调参移到弹窗控制台** `nodePanel/NodeCameraConsole.tsx`（像生图节点一样丰富：模式分段 + 实时可拖 3D 示意图 + 构图取景框 SVG 覆盖 + 相机/光圈/运镜/焦距/构图 全部 `IconChoiceGrid` 按钮带图标 + 视角三滑杆），由 `CanvasWorkspace` 在 `selType==='angle-prompt'` 时弹出（已从 `ON_NODE_TYPES` 移除）。各处用户串「视角」→「镜头」（NodeSearch/CanvasDock/CreateMenu/NodeInspector NODE_TYPE_LABELS/CreateMenu 标签/store CreateMenu label）；`DEFAULT_SIZE` 缩小为干净卡。④ **光源节点增强**——新 `sourceType`（光源类型：阳光/朝阳/夕阳/黄金时刻/阴天/月光/烛光/灯笼/火光/霓虹/影棚/窗光/路灯/屏幕，带 emoji 图标 + 中文短语进提示词）；遮挡扩到 11 项（+水面波光/蕾丝镂空/密林剪影/几何格栅/烟雾缝隙）、光效扩到 11 项（+散景/柔光辉光/硬阴影/斑驳光影/强逆光剪影），全部带 `LIGHT_*_ICON` 图标；遮挡/光效/光源类型 三个原生 `<select>` 改 `IconChoiceGrid` 图标按钮；新增「光位」快捷预设（正面/左右侧/伦勃朗/顶光/蝴蝶光/逆光/轮廓/底光，一键设方位+高度）；卡头显示「正面光/侧面光/背面光」。⑤ **示意图标**——新 `src/pages/SmartCanvas/nodeControls.tsx`：`IconChoiceGrid`(图标+文字按钮网格，替代节点内原生下拉) + `AspectGlyph`(按 w:h 画等比小方框，自带内联样式任意页面可用)；`SegmentedControl` 加 `icon` 槽；比例选择处（生图控制台 / 视频控制台 / 尺寸来源节点 / Create 页绘图参数 比例 chips）全部加比例示意小方框，一眼看出形状。⑥ **下拉美化**——`SearchableModelSelect` 升级支持 `{value,label}` 富选项（显示「中转站 / 模型」）+ 字段 hover/open 高亮 + 活动项底色；模型下拉统一为可搜索按钮列表：Create 页绘图参数模型选择（原生 `<select>`→`SearchableModelSelect`）、LLM 节点对话模型（NodeInspector）、视频控制台视频模型 全部替换（ChatPanel 早已用 CustomSelect）；生图控制台 生成类型/执行后端/输出格式 原生 `<select>`→ `CustomSelect`（深色 portal 下拉）。其余短枚举原生 `<select>` 沿用全局 `.mb-select option` 深色兜底（global.css 既有）。⑦ **删生图节点分辨率备注**（NodeWorkConsole 的 `gptTierHint`「将以 X×Y 生成」+「由 size 决定」+ NodeInspector「该系列由 size 决定」全删；尺寸映射逻辑仍在 buildBody 服务端生效，仅去 UI 灰字）。零新 IPC。验证：web/node tsc 绿 · 467 tests 绿 · build 绿。
> **2026-06-14 续七：比例示意描边化 + 比例补全 + 统一线条图标集 + 光源弹窗化 + 镜头卡实时预览 + 图标按钮 + 去固定钮 + 角色工作台类型切换（八项反馈）**。① **比例示意图标改描边**——`nodeControls.AspectGlyph` 由实心填充改 `background:transparent` 纯描边小方框（生图/视频控制台 · 尺寸来源节点 · Create 页比例 chip 共用）。② **比例补全（查官方文档）**——GPT Image 2（项目按「连续比例，长:短 ≤ 3」建模）补 `2:1`/`1:2`/`9:21`（`imageModelFamilies.ts` gpt-image-2 `supportedAspects` + Create `ASPECTS`，tag GI2）；Nano Banana 官方固定档不含这三个，故不加（避免误报支持）。③ **统一线条图标集**（替代风格杂乱的 emoji）——用 Workflow 并行 9 类目生成一致风格 SVG（`viewBox 0 0 24 24` · `fill:none` · `stroke:currentColor` · `stroke-width:1.7` · 圆角端点），落地 `src/pages/SmartCanvas/optionIcons.tsx`（`OptionIcon`/`optionIcon`，dangerouslySetInnerHTML 注入内部 markup，`value='none'`/未知回退空心圆）；镜头(相机/光圈/运镜/焦距/构图)、光源(光源类型/遮挡/光效/光位) 全部改用；镜头卡片摘要 chips 也换 SVG 图标。④ **光源节点弹窗化（基础在卡 / 高级在弹窗）**——新 `nodePanel/NodeLightConsole.tsx`（光位预设 + 光源类型 + 遮挡 + 光效 + 一致性，IconChoiceGrid 线条图标）；`LightNode` 卡片瘦身为「图上拖光点 + 强度 + 色温 + 提示词 + → 提示词节点」基础调整 + 高级入口提示；CanvasWorkspace 把 `light` 从 `ON_NODE_TYPES` 移除、`selType==='light'` 弹 `NodeLightConsole`、NodeInspector float 条件排除 light（与 angle-prompt/work/video 一致）。⑤ **镜头卡实时预览**——`AnglePromptNode` 卡片预览图按机位角度做轻微 3D 倾斜 + 远近缩放（只读，`.mb-sc-cam-preview-img` perspective/transform）+ 复用 `CompositionOverlay`（构图取景框，移到 `nodeControls` 供卡片与控制台共用），调参实时反映。⑥ **复制 / → 提示词节点 按钮美化**——新 `icons.ToPromptIcon` + `nodeArea.ToPromptButton`（图标 + 文字），替换 6 处纯文字 `mb-sc-toprompt`（镜头/光源/图像反推/视频反推/ComfyUI/配色）；`.mb-sc-toprompt` CSS 改图标按钮样式（hover 描边 accent）。⑦ **去掉无用「固定到右侧 📌」钮**——固定面板模式早已不渲染（CanvasWorkspace 只渲染 `<NodeInspector float />`），生图控制台 `NodeHeaderBar` 的 📌 钮移除（连带 `toggleInspectorFloat`/`useSmartViewStore` 引用清理），只留 ✕ 关闭。⑧ **角色工作台中间预览：人物/动物/静物 类型切换 + 参数化剪影「模型」**——预览左侧加 `人物/动物/静物` 切换轨（`.mb-sc-studio-kindrail`），无参考图时渲染 `CharacterSilhouette`（纯 SVG 描边「模型」，人物造型随 `build`(体型)/`faceShape`(脸型) 轻微变化，配合既有 CSS-3D 旋转给「可旋转模型」体验，替代原 emoji 剪影）；类型存 `CharacterNodeData.previewKind`（可选，缺省按 subject 推断，持久化跨画布）。**真 3D 可雕刻模型需 3D 引擎（项目无 Three.js）——以参数化 SVG 剪影 + CSS-3D 旋转作零成本近似（已如实说明）**。**弹窗 resize + 尺寸记忆（铁律 20）本就由 `ResizablePanelWrapper`（生图/视频/镜头/光源控制台）+ `.mb-sc-inspector.is-float` 的 `resize:both` 提供，跨画布持久**。⑨ **非必要备注收成「ⓘ」悬停提示**——新 `nodeArea.NodeHint`（小 ⓘ，文字进 `title` 鼠标悬停才显示），把占版面的纯说明备注收掉（图片列表「每批传下游」连接说明、循环节点「输出口连到…」说明已接入）；可操作的指引备注（如「当前方案没有对话模型，去设置页配置」）保留可见。⑩ **极端比例 4K 失真修复（多智能体复核发现）**——给 gpt-image-2 暴露 9:21/1:3/3:1 后，`sizeFromAspectAndBudget` 在「长边按预算反推超 4096」时原先各自独立 clamp（长边砍到 4096、短边不变）→ 实际比例失真（3:1 出成 ~2.46:1）；改为**钉长边到 4096 后按目标比例回算短边**（保持比例忠实，宁可面积少于预算）；1:1/16:9 等非极端比例不触发、行为不变；连带修好既有 21:9 的同类失真（`imageModelFamilies.test.ts` +6 例锁定）。零新 IPC。验证：web/node tsc 绿 · 473 tests 绿 · build 绿。
> **2026-06-14 续八：节点弹窗主体「随窗口宽度自适应重排」修复（用户反馈：拖宽悬浮窗，相机机型仍 2 行不变）**。根因：`ResizablePanelWrapper` 早就支持「拖右下角手柄 → autoSize 转固定尺寸、窗口实际变宽」（铁律 20），但各控制台**主体写死了宽度上限** → 窗口虽变宽、内容容器不变宽，下方 `IconChoiceGrid`（本就是 `auto-fill minmax(58/74px,1fr)`）拿不到更多横向空间，列数永不增加、永远 2 行。修法（纯 CSS）：把主体改成**固定尺寸态铺满窗口、仅 autoSize 初始态给稳定默认宽**——① `.mb-np-cam`（镜头 `NodeCameraConsole` + 光源 `NodeLightConsole` 共用主体）原 `width: clamp(420px,46vw,680px)` → `width:100% + box-sizing:border-box`，autoSize 初始 `.mb-np-window.is-autosize .mb-np-cam { width: clamp(460px,52vw,880px) }`；② `.mb-np-bar`（生图 `NodeWorkConsole` + 视频 `NodeVideoConsole` 顶部字段条）原 `max-width:1060px` → `width:100%`，autoSize 初始 `clamp(680px,64vw,1100px)`。机理：用户拖动手柄 → `ResizablePanelWrapper` 去掉 `is-autosize` 类并给窗口写死 px 宽 → `width:100%` 接管 → 主体铺满新宽度 → `IconChoiceGrid`/flex-wrap 字段条自动加列、行数变少（**按钮尺寸不变，只变布局/列数**，正合 `auto-fill 1fr` 在 auto-fill 下不会把按钮拉大的特性）。`NodeInspector` 浮动检查器（缩放/LLM/分组/结果等其余节点）本就 `resize:both` + `.mb-sc-form auto-fill minmax(150px,1fr)`，已自适应、未改。零 IPC、零 TS 改动（仅 nodePanel.css 两处）。验证：web/node tsc 绿 · 473 tests 绿 · build 绿。
> **2026-06-15 智能画布新增「AI 智能体（orchestrator）」**：输入一句话 → 自动建节点图 / 配参 / 优化提示词 / 接入图片 / 生成。**复用现有引擎、零新 IPC、零新节点类型**——与 storyboard/character「调 LLM → 拿结构化 JSON → 确定性建内容」同套路，抬到「整张节点图」层级。架构三段：① **规划（免费）** `agentPlanner.planGraph` 走 `api:chat:optimize-prompt`（systemPrompt 覆盖，一发一收）→ `agentBlueprint.parseBlueprint`（复用 `jsonPrompt.extractJsonBlock`，解析失败一次严格重试）。② **建图（免费可见）** `agentBuilder.buildGraphFromSpec` 用现有 store 动作（addNode/updateNodeData/onConnect/ensureResultNode/arrangeSmart/selectOnly）确定性搭图：参数白名单收口（`sanitizeNodeParams`）+ family 校正（`clampWorkForModel` 按 `detectFamily` 钳比例/档位/质量/张数）+ modelId/seed/provider 系统注入（`pickModelName`，LLM 不挑模型）+ **连线前自校验**（`canConnectKinds`，因 `store.onConnect` 本身不校验）+ 去重 + 防环 + 三路接图（对话框上传/画布选中/资产库选取，LLM 漏写 imageBindings 时兜底自动补 image 节点）。③ **生成（付费）** 默认停在确认闸门展示方案 + warnings，确认才 `runAllNodes()`；设置「存储与系统 → 智能体自动生成」(`prefs.agent_auto_run`) 可切全自动。**keystone 重构**：连线规则（14 集合 + `canConnectKinds`/`invalidReason`）从 `CanvasViewport.tsx` 抽到 `src/lib/canvasConnectRules.ts` 导出，**三方共用单一真相**（CanvasViewport 手画校验 / agentCatalog 推导消费产出 / agentBuilder 建图校验）。节点能力目录 `agentCatalog.ts` 类型为 `Record<SmartNodeKind, …>`（编译期完整覆盖 25 类）+ 消费/产出由规则推导不手抄 + 枚举从既有常量导入。UI：工具栏「🤖 智能体」按钮（`.mb-sc-glbtn`）→ `AgentPanel`（portal 到 body，仿 SmartGalleryPanel）。新增纯函数测试 `agentCatalog.test.ts` + `agentBlueprint.test.ts`。范围=用户决策「全部 25 类节点可被智能体调用」（prompt 引导核心集、builder 全支持，进阶节点 comfy/video/folder 需用户后续补模板/目录）。零新 IPC。验证：web/node tsc 绿 · 504 tests 绿 · build 绿。
> **2026-06-16 智能体 v2（ComfyUI 控制 + 悬浮 FAB + 建图行为修正 + 全参数）+ 生图 UI 规整 + 图片节点就地编辑器**：① **智能体能控制 ComfyUI 节点**——`AgentPanel` 规划前 `comfyui.templateList`+`templateGet` 拉全部模板，精简（名称 + 可设控件）喂 planner、完整（含 `inputControls`）给 builder；`agentBlueprint` 新增纯函数 `matchComfyTemplate`（按名称/关键词/标签匹配）+ `resolveComfyControls`（LLM 控件键按 id/label 映射到真实控件 + 按类型 coerce + 图片类控件跳过 + 数字钳值/下拉项校验）；builder 对 comfy 节点写 `{workflowId,templateName,controls,controlValues}`（跳过通用参数填充）。catalog `comfy` 改为 `{template, controls}` 可设 + 系统提示词渲染「可用 ComfyUI 模板」段。② **智能体 UI 改右下角悬浮 FAB**——删工具栏「智能体」按钮，改 `.mb-sc-agentfab`（右下圆钮，portal 到 body，`pointer-events` 仅按钮/面板）点击展开 350px 小面板（不遮挡画布），只在工作区（`activeDocId!=null`）显示。③ **复用已选中图片节点不复制**——`AgentBuildSources` 加 `selectedNodeIds`（与 `selected` 并行保序），`source==='selected'` 时 builder `connectExistingNodes` 把现成节点连到目标（不再建 image 副本）；兜底接图同理优先复用选中节点。④ **以画布中心建图、不 fitView**——`layoutBlueprint`（纯函数：拓扑分层、上游左下游右、整簇以 `getSmartViewCenter()` 为锚）算位置传 `addNode(kind,pos)`，移除 `arrangeSmart` + `AgentPanel` 的 `fitView`，不打乱用户现有布局/视图。⑤ **智能体控制更多参数**——`sanitizeNodeParams`+catalog 扩展 work(quality/strength)、light(occlusion/effect)、镜头(cameraType/aperture/movement/focal)、palette(scheme)、scale(format/keepAspect/noUpscale/fitW/fitH)。⑥ **生图参数 UI 规整**——`.mb-gen-aspect` 加 `min-height`+`justify-content` 统一比例按钮大小、`.mb-gen-row` `align-items:flex-start` 顶部对齐不等高参数；`.mb-np-seg-btn` 加 `min-height:34px` 让带副标/不带副标的分段按钮等高。⑦ **绘画模型选择器改按钮组 + 中转站前缀**——新 `ModelButtonGroup`（consoleControls，按文件名宽度自适应换行 + 中转站/官方名淡色前缀）替代生图节点下拉；`NodeVideoConsole`/`CharacterStudio` 模型选择器改 `{value,label}`（带 `中转站 / 模型` 前缀）。⑧ **图片节点就地编辑器**——`ImageEditorModal`（自带 HTML5 canvas，单图层，复用 `/canvas` 的 `paintSegment`/`applyAdjustToImageData`/`maskEngine`）：画笔/橡皮/蒙版抠图(destination-out/in)/裁切/扩图/调色 + 撤销重做快照栈(上限 12) + 重置初始 + 保存回节点；图片只解码一次进 workCanvas 就地编辑、调色预览只在小视图算（流畅）。图片节点 hover「✎ 编辑」钮 + 右键菜单入口。**多智能体对抗式复核修 2 真 bug**：(a) [高] `imageScale.loadImage` 不设 `crossOrigin` → 本地 `mengbi-image://` 图绘到 canvas 污染、`toDataURL` 保存抛 SecurityError → 编辑器改用本地 `loadImageCors`（`crossOrigin='anonymous'`，与 `exportPNG` 同款已验证）；(b) [中] 裁切预览忽略实时调色 → 改「快照基图(含调色)→盖暗罩→putImageData 盖回保留区」。坐标映射经核为 CSS 缩放无关（误报，仅加防越界 clamp）。零新 IPC。验证：web/node tsc 绿 · 514 tests 绿 · build 绿。
> **2026-06-16 用户实测反馈 13 项（设置/智能体/缩放/图片编辑/翻译/ComfyUI/角色）**：① **agnes 等中转站绘画模型报错诊断 + 修复**——`agnes-t2i-general-model` 走 LiteLLM 代理，不支持 `response_format`，提交返回 `400 UnsupportedParamsError`（且失败可能仍计费）。修复 = §13 请求体覆盖 `{"response_format": null}`。② **新 IPC `api:settings:test-protocol`**（schemas/preload/ipc 类型 + `settings.ts:testProtocol`）——「测试连接」只 GET /models 抓不到此类协议错；新「🧪 测试协议」真实发一次最小调用（text→/chat/completions max_tokens:1 近免费；image(openai 兼容)→/images/generations 出 1 张图、应用 body+header 覆盖；video/专有图像协议跳过）→ `protocolErrorHint` 把 response_format 被拒等翻成「原因+怎么办」。③ **设置三合一编辑器三修**：(a) **上游指派模型跨块去重**——`blockDetected` 由「仅去本块已映射」改 `assignedAll`（所有块已指派的 actual id 并集），已添加的不再出现在下一个块；(b) **重复同类型配置合并**（截图「视频」两行的根因 = 编辑器只编第一条、留孤儿）——`dupExtraIds` 保存时连同关掉块一并删除，合并为每类一条 + 顶部黄条提示；(c) **块内「一键填 response_format:null」**按钮（直接救 agnes 类）。④ **缩放节点大倍数变形修复**（`imageScale.computeScaleTarget`）——根因：`tw`/`th` 各自独立 clamp 到 MAX_EDGE，大倍数时长边触顶、短边没动 → 宽高比失真、倍数越大越歪；改**等比 clamp**（任一边超上限则整体按同比缩进）+ `imageScale.test.ts`(5 例)。⑤ **Agent 悬浮窗重构**——FAB 上移避让底部 `.mb-sc-help` 备注条（bottom 18→60、right 18→24）；面板从「贴 FAB 的固定小窗」改**可拖动标题栏 + 拖右下角缩放**的悬浮窗，默认右上角，几何记 localStorage（`mengbi.sc.agentwin.v1`，铁律 20）。⑥ **生图节点绘画模型改「下拉 + 节点式按钮项」**——新 `ModelDropdownButton`（consoleControls）：折叠成紧凑下拉省地方，展开弹出节点式按钮网格（每钮宽随名自适应 + 中转站前缀 + 模型多时搜索），替代上一版常驻 `ModelButtonGroup`。⑦ **结果/生图/Comfy/文件夹节点分辨率角标恢复**——`MeasuredThumb` 加 `measureFull` 入参（off-DOM 解码原图量真实分辨率，仅给节点内少量预览用，资产库大网格仍不量，铁律 23③）；5 处节点预览开启。⑧ **图片编辑器三大增强**：(a) **画笔/橡皮/蒙版显示笔刷大小圈圈**（`.mb-sc-imgedit-brushring` fixed 跟随鼠标 + `cursor:none`），替代十字光标；(b) **裁切可锁比例**（`cropRatio` 选 1:1/4:3/16:9… 后拖动高度按比例跟随）；(c) **扩图自由四边**（四边各自像素输入 + 预览图上拖橙色手柄实时调 + 透明/颜色填充 + 羽化 `featherEdges` destination-out 渐变 + 实时预览 `drawOutpaintPreview`）。⑨ **提示词节点 + 文本放大窗翻译功能**——新 `lib/translateText.ts`（复用 `api:chat:optimize-prompt` + translate systemPrompt；**注意 `api:lab:translate` 非 mock 是占位 stub，真正能翻译的是这条**）+ `TranslateBox`（原文/译文左右对比 + 复制 + 替换原文/用译文建节点 = 临时/永久）。⑩ **ComfyUI 节点提示词外接更便捷**——卡上：接了上游提示词显示「外接提示词」预览（点放大）、没接显示「＋ 接提示词节点（外接编辑）」一键在左侧建 prompt 节点并连上。⑪ **角色设计节点重做（一致性 keystone）**——根因：`buildSheetPrompt` 只取资产十段里的「可复用提示词」一段，丢掉面部/发型/身材/服装/颜色/禁止偏移 9 段 → 视图提示词内容少、下游生图丢一致性。修：新 `appearanceLockOf(asset)` 提取外观锁定段整段并入视图提示词（`【外观锁定】…`）+ characterPrompt.test +1 例；**视图类型选择 + 生成视图提示词 + 全文预览搬到节点卡上**（不必进工作台）。⑫ **图片编辑接入智能体**——编辑器加「🤖 AI 指令」条：自然语言 → `optimizePrompt`+`extractJsonBlock` 解析成参数类编辑（扩图四边/填充/羽化、调色亮度对比、裁切比例、画笔色/粗）应用到编辑器（设好参数、用户点对应「应用」确认生效）；**空间区域类（涂某块/擦某块/裁某块）需手动指点，已如实标注**。⑬ 文档同步本条。新 IPC：1 个（api:settings:test-protocol）。验证：web/node tsc 绿 · 520 tests 绿 · build 绿。
> **2026-06-17 智能画布补齐「服务端局部重绘 + AI 扩图」（走 /v1/images/edits + mask，主进程零改动）**：此前服务端遮罩重绘**只有画板那条路真打通**（`InpaintDialog` → `params.inpaint_mask` → `/v1/images/edits` 带 `mask`）；智能画布的「画遮罩」是假的——`ImageEditorModal` 蒙版工具只用 canvas `destination-out/in` **本地擦像素（抠图）**、遮罩用完即弃，`runWorkNode` 构造的 params **从不含 `inpaint_mask`**，遮罩从不上传后端。用户选**轻量方案：复用现有生图节点**（遮罩存在图片节点上，连「图片+提示词」到生图节点，运行即按遮罩重画）。**后端 `runOpenAIImageEdit` 已支持 refs+`params.inpaint_mask`→mask 字段，完全不动**；只补渲染端这条链：① 数据模型 `ImageNodeData.inpaintMaskSrc?`（OpenAI「透明=编辑区」PNG，dataURI/externalize 后磁盘路径，additive 可选）。② `ImageEditorModal`：蒙版工具加「**设为局部重绘遮罩(AI)**」（`maskToEditAlphaPng(maskRef)`→`blobToDataUri`→存 `inpaintMaskSrc`，不动像素）；扩图加「**扩图并交 AI 填充**」（透明新区 + `makeOutpaintMask`→`maskToEditAlphaPng` 边缘遮罩，src+mask 同尺寸一并写回）；裁切/本地扩图/抠图等改尺寸的破坏性编辑 `clearStoredMask()` 作废陈旧遮罩（防错位）。复用画板 `maskEngine`/`exportPNG.blobToDataUri`，不重写。③ `ImageNode` 加「◐ 重绘遮罩」徽标（点击清除，`.mb-sc-img-maskbadge`）。④ `computeUpstream`/`CollectedInputs` 加 `inpaintMask?`/`inpaintBase?`：首个「单图模式+带遮罩」上游图片节点 → 记底图+遮罩（单底图单遮罩）。⑤ `runWorkNode`：检测到 `inputs.inpaintMask` → **强制单任务**「局部重绘」（跳过 imageEach/多提示词/多张），`baseParams.inpaint_mask = await sendableUrl(...)`（落盘路径转回 dataURI；generate.ts mask 解析只认 `data:`），prompt 空则拦下；refs=[base]>0 ⇒ generate.ts 自动走 `runOpenAIImageEdit` 发 mask。⑥ `externalizeImageNodes` 把 `inpaintMaskSrc` 同 `src` 落盘换路径（防 localStorage 配额爆）。**边界**：中转站须透传 `mask` FormData 字段（少数会丢→退化成整图图生图，同画板限制）；局部重绘=单底图单遮罩（不支持多图/imageEach+遮罩）；遮罩在图片编辑器里画、不新增节点；连线规则不变（图片→生图本就合法）。零新 IPC。验证：web/node tsc 绿 · 524 tests 绿 · build 绿。
> **2026-06-17 用户实测反馈批量修复（翻译/智能体/控制台/任务集分离）+ 两个上游诊断**：① **[诊断·非代码] gpt-image-2 选 4K 出 ~1K（图生图/edits）**——日志实证我方 `openai.images.edits.request` 发的是 `size:'3840x2160'`（与用户中转站后台一致），但返回 `1654×951`＝**输入图比例**降分辨率，说明 Now Coding 的 `/v1/images/edits` **忽略 size 参数、按输入图比例返回缩小图**＝上游行为，非我方 bug（gpt-image-2 编辑的 4K 比文生图更不被 honor；要锐用原生尺寸编辑 + Real-ESRGAN）。② **[诊断·非代码] FHL 等中转站节点报错**——日志全是上游侧：FHL `/v1/images/edits` → **HTTP 524**（Cloudflare 源站超时，编辑太慢）、agnes → 503「No available compatible accounts」、漫小白 → 403 配额不足、grsai → high load。节点与生图页是**同一条 `api:image:generate` 代码**，差异多是「生图页文生图(快) vs 节点图生图(慢→524)」。③ **翻译框三修**（`TranslateBox`/`translateText`/CSS）——布局由左右 `grid 1fr 1fr` 改**上下 flex column**（上原文/下译文）；400 根因＝原来强制用首个可用文本模型（若它在会 400 的中转站则每次必败）→ 加**模型下拉 + localStorage 记忆**（`mengbi.sc.translateModel.v1`，`translateText` 加 `modelId?` 参数，让用户避开坏模型），错误经 `reason` 如实透出。④ **智能体模型选不对（同名不同中转站）**——`agentBlueprint.pickModelName` 由**精确名匹配**改**模糊匹配**（精确名→精确标签→名/标签互相包含→词级全包含），「gpt-image-2」命中「gpt-image-2（FHL）」、「Now Coding gpt-image-2」命中对应那条（用户的模型名已带中转站后缀、`listMappedModels` 按名去重故都保留）；+4 例 vitest。⑤ **生图控制台布局前挪**（`nodePanel.css`）——`.mb-np-bf-model` 由 `flex:1 1 188`（撑满留白把 生成类型/运行方式/执行后端 推远）改 `flex:0 0 auto; min-width:188; max-width:300`（按内容宽，后续字段紧贴前挪）。⑥ **视频模型选择器改按钮式**（`NodeVideoConsole`）——`SearchableModelSelect` → `ModelDropdownButton`（与生图节点同款「下拉+节点式按钮+中转站前缀」），`videoModels` 改 `{name,provider}[]`。⑦ **智能体提示词框放大 ~200%**（`.mb-sc-agent-input` min-height 110→220）+ **文本模型记忆**（`mengbi.sc.agent.textModel.v1`，打开时校验当前选择有效否则用记忆值/首个可用，`chooseModel` 持久化）；窗口大小不变、下方模型/按钮在 `.mb-sc-agent-scroll`(overflow auto) 内可滚到、不被遮。⑧ **出错结果不进结果节点**（`placeWorkResult`/`placeResultInBackgroundDoc`）——push 到结果节点前 `.filter(x=>x.ok)`、`data.result` 仅 ok 才更新（失败只在生图节点自身显示错误，不再出现「全部失败 0张·败1」卡）；视频 `routeVideoDone` 本就 `if(p.ok)` 才推（已合规）。⑨ **生图主面板 ↔ 智能画布任务集分离**——智能画布生成在 params 打 `source:'smart-canvas'`（只进 `generation_tasks.params`，buildBody/resolveSize/applyBodyOverrides 都不读、对出图无影响），生图页 `refreshLatest` 过滤掉 `params.source==='smart-canvas'`（与既有 comfyui 过滤并列）→ 画布任务不再污染生图页「最近任务」。**两条线共用资产库(images 表)是有意设计、不算污染**（软件产物全入库）。零新 IPC、零 schema 变更。验证：web/node tsc 绿 · 528 tests 绿 · build 绿。
> **2026-06-22 扩图提示词 + 节点模板文件化 + 打开配置文件夹 + 选择性导出/导入（含图片）**：① **提示词资产库新增 10 条通用扩图提示词**——`promptSeeds.ts` 新增 `SEED_PROMPTS_V19`（智能扩展/指定方向/无缝延伸/改目标比例/保持主体扩画幅/补全裁切/半身转全身/全景/电商留白/海报留白，面向 gpt-image-2·Nano Banana 等编辑型模型），**DB 迁移 v19**（`schema_version` 18→19，单独迁移：老库只补这 10 条）。② **节点模板改「配置文件夹文件存储」**——原 localStorage `mengbi.smartCanvas.templates.v1` 受配额限制、不可见、难分享 → 改存 `userData/node-templates/<id>.json`（每模板一个文件，可单独查看/备份/分享）。新增 `electron/services/nodeTemplateStore.ts`（list/save/remove/rename/importNodeTemplates 纯 fs）+ IPC `api:template:*`（list/save/remove/rename）+ preload `template` 域 + `NodeTemplateAPI/NodeTemplateDTO` 类型；`smartTemplateStore` 重写为 IPC 文件后端（in-memory + `loadFromDisk` 异步加载 + 一次性 localStorage 迁移，`mengbi.smartCanvas.templates.migrated.v1` 标记）；`TemplatePanel` 挂载时 `loadFromDisk`、存/删改异步。**节点模板工具栏按钮本就在右上角工具条**（`CanvasToolbar` 的 ⊞ TemplateIcon，title「节点模板」），存「选中节点 + 内部连线」=整套工具流/工作流快照，本轮仅把落盘从 localStorage 迁到配置文件夹。③ **设置「一键打开配置文件夹」**——新 IPC `api:storage:open-config-folder`（`shell.openPath(userData)` + 返回路径）+ preload/ipc 类型 + 设置「存储与系统 → 配置备份」按钮（含数据库/节点模板/临时文件说明）。④ **配置导出/导入扩展为选择性 + 细分类型**——`configIO.ts` `SectionsFlag/InnerBundle/ImportStats` 加 `nodeTemplates`，`buildExportBundle` 改 async 读模板文件，导入在 DB 事务外 `importNodeTemplates`（merge 跳过同 id / overwrite 清空目录再写）；导出/导入 zod sections + 预览 counts + 设置 UI 复选框 全部加「智能画布节点模板」（与 模型方案/外观+设置/资产库 并列，可自定义勾选）。⑤ **资产库图片导出/导入（文件夹 + 清单，与配置分开）**——大体积二进制不塞进加密单文件：新 IPC `api:image-io:export`（复制非删图片+缩略图到所选文件夹 + 写 `mengbi-images.json` 清单）/ `api:image-io:scan`（读清单报数量）/ `api:image-io:import`（读清单 → 复制进 `image_storage_path/imported-<date>/` + INSERT，**恒追加**、按 created_at+提示词+文件名去重、缩略图缺失重建、广播 `gallery:changed`）；preload `config.exportImages/scanImageDir/importImages` + 设置「导出图片到文件夹 / 从文件夹导入图片」按钮（导入前 `confirmDialog` 报数量）。新 IPC：6 个（template×4 / storage:open-config-folder / image-io×3，实为 8）。验证：web/node tsc 绿 · 672 tests 绿 · build 绿。
> **2026-06-22 续：节点模板面板像便携资产库（缩略图+标题+备注）+ 提示词库可拖动滚动 + 任务完成任务栏闪烁**：① **节点模板面板重做**——原小下拉列表（只标题+节点数）改成**中心悬浮窗**（仿 `SmartGalleryPanel`，`.mb-sc-tplp.mb-card` 双类提特异性 + portal 到 body + `clamp(560px,62vw,1500px)×min(72vh,920px)` + Esc 关闭）：网格卡片每张含 **缩略图**（`TemplateThumb`：把模板的节点按类型上色画成彩色方块 + 连线的结构示意 SVG，由节点 position/measured 归一 viewBox，无需截图、对老模板也生效）+ **可编辑标题** + **可编辑备注**（失焦提交，复用 `smartTemplateStore.update` → save IPC 按 id 覆盖文件）+ 类型摘要（`summarizeTypes`，复用从 `NodeInspector` 导出的 `NODE_TYPE_LABELS`）+ 节点数 + 日期 + 插入/删除。`SmartTemplate`/`NodeTemplateDTO`/`TemplateSchema` 加 `notes?`。② **便携提示词库（`PromptPickerDialog`）滚动改善**——卡片随提示词增多被挤、标题看不全：列表加**明显可见的滑杆**（新 `.mb-dragscroll` ::-webkit-scrollbar 12px accent 拇指）+ **鼠标长按拖动滚动**（新 `src/lib/useDragScroll.ts`：window 级 pointermove、超阈值才算拖、拖后抑制误触发 click、命中 input/`[data-no-dragscroll]` 不拦截）+ 卡片 min-height/line-clamp 收敛防挤 + 底部用法提示。节点模板网格同享 `mb-dragscroll`（卡片标 `data-no-dragscroll` 让拖动只在间隙、不打断改标题/备注）。③ **任务完成任务栏图标闪烁提醒**——新 IPC `api:window:flash`（`BrowserWindow.flashFrame(true)`，仅窗口未聚焦时；`main.ts` 加 `'focus'→flashFrame(false)` 聚焦即清；Windows 表现=闪几下后任务栏按钮保持高亮直到聚焦，正合需求）；`App.tsx` 的 `notification:append` 监听里对**真正完成事件**（复用 `voiceNotify` 新导出的 `isTaskCompletion` = CHANNEL_TASK 白名单 + success/failure，与语音开关无关）调 `window.flash()`。新 IPC：2 个（api:window:flash / 复用既有 template·image-io）。验证：web/node tsc 绿 · 672 tests 绿 · build 绿。
> **2026-06-22 续二：Alt 拖动复制修复 + 长按拖动滚动全覆盖 + 图片节点「标记」标注功能**：① **Alt 拖动复制连线出错修复**——根因有二：(a) 原实现在 `onNodeDragStart` **当场**克隆（中途改 nodes 数组 → React Flow 拖动态错乱、连线乱跳）；(b) 松手时还会触发「拖到节点上自动连线」(`linkAndMove`) → 给副本接上不想要的连线。改：`onNodeDragStart` 只记意图 + 起点（`altDupRef`），真正复制延到 `onNodeDragStop` 调新 store action **`altDragDuplicate(id, originPos, copyPos)`**——**原节点回到起点（所有连线原样不动）、新副本「拉出来」放到松手处（新 id、只克隆内部连线、不连任何现有节点）**；Alt 复制时跳过自动连线 + 归组。配合既有「模板插入 `insertNodes` 重映射 id」=多套相同模板/复制互不影响连线。② **长按拖动滚动（grab-scroll）全覆盖 + 真根因修复**——上一版 `useDragScroll` 把监听挂在 `useEffect` 里、容器异步加载后才渲染（如提示词库先 loading）→ ref 为 null 永不绑定（「拖不动」真根因）。**重写为 window 级监听 + 每次 pointerdown 用 `ref.current.contains(target)` 判定**（容器晚挂载也生效）；跳过 `input/textarea/select/[draggable=true]/img:not([draggable=false])/video/[data-no-dragscroll]`——**既保留资产库「拖出图片到外部/画布」原生拖拽，又让选图弹窗（draggable=false 的 img）能拖动滚动**；超阈值才算拖 + 抑制拖后误触发 click + pointercancel 复位。`.mb-dragscroll`（grab 光标 + 12px 明显滑杆）挪到 **global.css** 全局可用。已接入：便携提示词库（`PromptPickerDialog`）/ 便携资产库（`SmartGalleryPanel`）/ 节点模板（`TemplatePanel`，去 `data-no-dragscroll` 让卡片可拖、输入框仍可编辑）/ 选图弹窗（`GalleryPickerDialog`）/ **主功能资产库 + 提示词库**（Manager `.mb-manager-content` 滚动容器）。③ **图片节点「标记」标注功能**——`ImageEditorModal` 新增 `mark` 工具（🔖 标记），三子模式：**① 序号**（点击放递增数字圆，标注处理对象顺序，可重置序号）/ **T 文字**（点击就地弹输入框、回车把带白描边文字烧上图，写编辑要求/命名）/ **✎ 手写**（按住拖动实色硬边线圈画），均可调大小 + 颜色（默认红）。标注直接画进 workCanvas → 保存即成为图片节点 src，连下游生图节点 + 提示词（如「按图上标记的序号/文字处理」）让模型**按标记位置/序号/文字精确编辑**。复用既有 `paintSegment`/`pushHistory`/撤销重做；笔刷光标圈扩展到标记序号/手写。新增 store action 1 个（altDragDuplicate）、零新 IPC。验证：web/node tsc 绿 · 672 tests 绿 · build 绿。**待办（用户要求先讨论）：全局组件动效——保性能前提下让交互更灵动，范围/风格待与用户确认后实施。**
> **2026-06-22 续三：全局微交互动效（风格「克制·快」，低配完全关闭）**——用户确认方向后落地：新增集中式 `src/styles/motion.css`（`main.tsx` 在 global.css 后导入），覆盖四区：① **按钮微交互**（`.mb-btn` hover 轻抬升 translateY(-1px) + 按下 scale(0.97) 回弹 + 属性过渡）；② **可点击卡片**（`.mb-gallery-card`/`.mb-prompt-card`/`.mb-sc-tplp-card`/`.mb-sc-ppick-item`/`.mb-sc-gpick-item`/`.mb-sc-rcard`/`.mb-provider-card` hover 抬升 + 阴影、按下回弹）；③ **弹窗/面板开合入场**（`.mb-modal`/`.mb-sc-imgedit` 用 `mb-pop-in` translateY+scale+opacity；`.mb-modal-backdrop` 用 `mb-fade-in`；**transform 居中的中心悬浮窗** `.mb-sc-glp`/`.mb-sc-tplp`/`.mb-sc-textviewer` 用 `mb-pop-center`——**关键帧保留 `translate(-50%,-50%)` 否则冲掉居中导致弹窗错位**）；④ **页面切换**（`App.tsx` route motion 加 `y:8→0` 轻上滑，低配 y=0+duration=0）+ Toast（本就有 spring，未改）。时长 130–200ms、scale ≤1.02、无明显回弹。**性能闸门（用户决策：低配完全关闭新动效）**：所有规则前缀 `html:not([data-perf='low'])` —— 性能模式=低配时整段不生效（**注意是「不应用规则」而非 `animation-play-state:paused`，后者会把入场动画停在第 0 帧 opacity:0 → 元素隐身**）；另加 `@media (prefers-reduced-motion: reduce)` 整段关闭。沉淀**铁律 25**。零 TS 逻辑改动（除 App.tsx 页面过渡 y）、零新 IPC。验证：web/node tsc 绿 · 672 tests 绿 · build 绿。
> **2026-06-23 用「提示词商城（prompt-mall）」替换「角色设计（character）」节点 + 新增「外置提示词库」工具栏工具**：用户决策——角色设计虽好但不够通用，改成「逛店选购」式通用提示词构建器。**彻底删除 character 节点**（删 `CharacterNode`/`CharacterStudio`/`characterPrompt(.test)`/`characterPresets` 5 文件 + ~24 处 `Record<SmartNodeKind>` 注册全部 swap 成 `prompt-mall`），并**多智能体并行授权**：12 个 general-purpose agent 并行各写一个大类数据文件（`src/lib/promptMall/data/*.ts`）。**① 节点（第 X 类，kind `prompt-mall`）**——三栏「提示词商城」工作台弹窗（`PromptMallStudio`，复用 `.mb-sc-studio` 骨架 + portal + useBackdropClose）：**左**=二级分类栏（12 大类 × ~70 子类：人物/服饰/画风/镜头构图/光线/色彩/质感材质/环境/室内/动植物建筑/氛围/质量，全库 **666 张卡**）+ 顶部全局搜索；**中**=缩略图卡片墙（拖一张进购物车则墙上消失，也可点击加入；`.mb-sc-mall-grid` content-visibility 懒渲）+ 「+ 自定义片段」+ 「📚 我的提示词库」伪分类（`api:prompt:list` 拉用户库当卡用）；**右**=购物车（HTML5 拖拽 drop + 拖动重排 VideoClipNode 式 + 按大类自动排布）+ 中/英输出切换 + 优化开关 + 对话模型 + 运行 + 合成结果。节点卡精简（中/英 + 优化 + 购物车摘要 chips + 运行 + 合成预览 + 🛒 打开商城）。**② 数据/纯函数**——`src/lib/promptMall/`：`cardTypes.ts`（`PromptMallCard{id,cat,sub,zh,en,genPrompt}` + 12 大类×子类 taxonomy + 程序化缩略图配色/图标）、`cards.ts`（合并 12 数据文件 + 按 id 去重/查询）、`assemble.ts`（`assembleCart` 按大类顺序去重逗号拼接、负面词单独成「负面：」行 + `PROMPT_MALL_SYSTEM{zh,en}` + `stripFences`，**+12 vitest**）。**③ 运行（零新 IPC）**——`runPromptMallNode`：购物车（含上游文本片段，cat `_upstream` 排末尾）→ `assembleCart` 原始拼接 →（勾「优化」）`api:chat:optimize-prompt`（`PROMPT_MALL_SYSTEM[lang]`）合并去重 → `pushTextDownstream`。中/英控制显示与输出。**连线**：`prompt-mall` 纯文本进出——`PROMPT_MALL_SOURCES`（仅文本来源 prompt/llm/反推/分组/结果，**不接图片/视频**，区别于 character）+ 输出连 分镜/生图/ComfyUI/视频/LLM/分组/结果；**移除 character→storyboard 的「角色一一对应」专属注入**（storyboard 仍把商城输出当普通素材）。**④ 缩略图（用户自行生成，先 SVG 后升级）**——默认程序化 SVG 卡片（大类渐变 + 线条图标 + 卡片文字 + 按 id 微调色相，零版权）；每卡含 `genPrompt`（英文生成提示词），用户可「选择缩略图文件夹」放入自行用 ComfyUI/绘画模型按 `<cardId>.png` 命名生成的图（`useMallThumbsStore` 扫 `api:storage:listImages` 优先显示）+ 「导出生成清单」+ 「用绘画模型批量生成」(`generateMallThumb` 复用 `generateOnce`+`copyInto`，逐卡可停)。**⑤ 商城 ↔ 提示词库互通**——购物车/合成结果右键「收藏进提示词库」(`api:prompt:upsert`)；商城/外置库可浏览用户库加入购物车。**⑥ 外置提示词库工具**（右上角工具栏新按钮 → `ExternalLibraryPanel` 中心悬浮窗 `.mb-sc-extlib.mb-card` 双类 + portal + 路由离开复位）：① 链接出去（PromptHero/Lexica/Civitai/OpenArt 等 `storage.openUrl` 浏览器打开，**不嵌网页、不抓取**）② 就地浏览内置片段 + 用户提示词库并一键应用（选中商城节点→并入购物车 / 选中提示词节点→追加文本 / 都没选→视图中心新建提示词节点）。**⑦ 旧存档迁移**——`smartDocStorage.sanitize` 把旧 `character` 节点转成 `prompt` 节点并带上最后的角色资产/描述文本（不丢成果）。零新 IPC（缩略图复用 listImages/copyInto/selectFolder/saveAs，互通复用 api:prompt:*，生成复用 api:image:generate）。验证：web/node tsc 绿 · 666 tests 绿 · build 绿。
> **2026-06-23 续：提示词商城卡片库扩 2 倍 + 细分子类 + 开发模式(ComfyUI 批量生成缩略图) + 新增卡片 + 库卡片版式修复**：用户反馈①分类卡太少（如发型该分男/女）②自行生成太麻烦想用 ComfyUI 自动出图③提示词库卡片错乱溢出④商城要能新增卡片保存。**关于"完全抓取 promlib.com 缩略图/分类/卡片"**——已明确拒绝抓取并打包第三方站点的图片与卡片内容进分发产品（版权风险落在用户身上），改为**自撰原创卡片 + 用户自有 ComfyUI 出图**两条干净路径满足同等需求。落地：① **细分子类**——`cardTypes.ts` taxonomy 由 ~70 子类扩到 **~140 子类**（人物发型拆 女生发型/男生发型、五官拆 眼睛/鼻嘴、身材拆 男/女、姿势拆 静态/动作 + 手势 等；服饰拆 风格×3/头饰/首饰/包袋/图案；画风拆到 15 子类…），负面词判定改 `isNegativeCard`（quality 大类 sub 以 `negative` 开头）。② **卡片库扩到 ~1429 张**（12 个 general-purpose agent 并行重写各大类数据文件，~80-186/类，全原创片段、非抄站）。③ **开发模式（节点上点 🛠）**——`PromptMallNodeData.devMode`；开后节点变缩略图生成器：把本节点输出口连一个 ComfyUI 节点（工作流用 z-image 等）→ 选缩略图文件夹 + 目标分类 → 「生成缺失缩略图」逐张经 ComfyUI 出图、按 `<cardId>.png` 落盘（`generateMallThumbViaComfy` 复用 `submitComfyAndWait` defer 模式取回结果图 + `copyInto`）→ `useMallThumbsStore` 扫文件夹自动与卡片一一对应。可随时停止。④ **新增卡片 + 保存**——`useMallUserCardsStore`（localStorage `mengbi.promptMall.userCards.v1`，与内置库运行时合并）；商城工作台「➕ 新增卡片」表单（大类/子类/中/英/genPrompt），自定义卡可拖入购物车、右键删除。⑤ **提示词库卡片版式修复**——`.mb-sc-mall-libcard` 放大（minmax 230 + min-height 96）+ 标题 1 行 / 描述 3 行 `-webkit-line-clamp` 裁在卡内不溢出边界。零新 IPC（ComfyUI 生成复用 `comfyui.runSingle`，落盘/扫描复用 `storage.copyInto/listImages/selectFolder`）。验证：web/node tsc 绿 · 666 tests 绿 · build 绿 · 1429 卡。
> **2026-06-24 提示词商城缩略图一致性修复（统一风格包装 + 全量重写 genPrompt + 去动物串味 + Z-Image 适配）+ 卡片扩到 1981 张**：用户实测自行用 ComfyUI 生成的缩略图「整套很乱」——背景/取景/画风各卡不一，且**人物分类里混进猫狗/爱心雕塑**（`上扬眼`/`下垂眼` 的 genPrompt 写成 "feline cat eyes"/"puppy eyes" 被字面画成动物，`心形脸` 写成 "heart-shaped face" 被画成 3D 雕塑）。**关于"完全用 promlib.com 的图/分类/卡片"**——再次明确拒绝抓取并打包第三方站点内容进分发产品，改走干净路径：自撰原创卡片 + 用户自有 ComfyUI 出图。落地：① **分类自适应统一风格包装**（新 `src/lib/promptMall/thumbGen.ts`：`buildThumbGenPrompt(card)` 给 genPrompt 追加按大类区分的固定风格后缀——`isolated`(人物/服饰/材质)=无缝浅灰影棚底+柔光写实、`scene`(环境/建筑/室内)=保留场景只统一写实画质、`demo`(画风/镜头/光/色/氛围/质量)=最小后缀不盖变量；含 `scrub()` 兜底替换 cat eyes/puppy eyes/heart-shaped face + `THUMB_SEED` 固定种子）。两个生成函数（`generateMallThumb` 绘画模型路 + `generateMallThumbViaComfy` ComfyUI 路）签名改接整张 card、统一过包装，空 genPrompt 回退 en/zh。② **「覆盖已有」开关**——`copyInto` 加可选 `overwrite`（additive IPC，默认不改 folder-output），dev 面板/工作台加「覆盖」勾选，改了提示词后可整套重生成。③ **全量重写 12 个分类的 genPrompt**（多智能体并行，**但大类 character/clothing/art-style 反复触发 socket 断连/会话限额**——最终用「批次 3 并发 + 重试」跑通 9 类、剩 character/clothing 单跑通过、art-style 由主 agent 直接手写补齐；全程零抓取、全原创）：规则=只写「主体+取景+区别特征」，背景/布光/画质交给包装；人物五官卡锁定真人主体绝不动物；`demo` 类用同一参考主体（如「年轻女性半身像」）呈现各画风便于横向对比。卡片量 1429→**1981**（各类 ~150-190）。④ **新增 `thumbGen.test.ts`**（9 例：三档 profile 选择 / 后缀幂等不双包 / 空 genPrompt 回退 / scrub 替换动物比喻 / seed 导出）。零新渲染端 IPC（仅 copyInto 加 overwrite 字段）。验证：web/node tsc 绿 · 675 tests 绿 · build 绿 · 1981 卡 · 人物分类 0 动物串味。
> **2026-06-24 续：提示词商城购物车分组/排斥 + 缩略图卡片化购物车 + 卡片不消失（角标计数）+ 缩略图按分类分子文件夹**（卡片大幅扩充到 ~4000 已给用户分配方案、待确认后并行授权多智能体执行，本轮先落地这 4 个 UI/逻辑功能）：① **缩略图按分类自动分子文件夹**——选「总文件夹」后，`generateMallThumb`/`generateMallThumbViaComfy` 落盘到 `<总文件夹>/<cat>/<id>.png`（新纯函数 `mallThumbSubdir`，copyInto 自带 mkdir -p 建子文件夹）；`useMallThumbsStore.load()` 改为并行扫「总文件夹」（兼容旧平铺）+ 12 个大类子文件夹（listImages 非递归 → 每个目录各自 catch 容错，子文件夹命中优先）。② **购物车改缩略图卡片网格**（`.mb-sc-mall-cartgrid` auto-fill 76px 小卡，复用 `PromptMallThumb` 缩略图 + hover × 移出 + 拖动重排/跨组），取代原文字行。③ **分组 + 同组排斥**（核心）——`PromptMallCartItem` 加 `uid`(实例唯一 key，允许同卡入多组)+`group`；`PromptMallNodeData` 加 `groups`/`activeGroup`/`exclusive`(默认开)。购物车按分组分区渲染（每组=一张图的一个组成部分，●○ 切活动组 / 双击重命名 / × 删组卡片并入第一组 / ＋新增分组）；**排斥**=开启时同一组内同 (cat,sub) 只能选一个（加新卡先移除该组同类旧卡，自定义/上游片段不参与）——「选了圆脸就不能选其他脸型」；组间互不影响。**纯函数 `assembleCartGrouped`**（assemble.ts，+6 vitest）：每组内部按大类排序去重成一个正向片段、用户改过名的组以「组名：」作前缀（默认「组 N」名不加前缀，单默认组退化为与 `assembleCart` 逐字一致向后兼容）、多组用句号连接、负面词跨组汇总到结尾「负面：」一行；`runPromptMallNode` 改用它。④ **卡片墙拖入购物车后不消失**——移除 `inCart` 过滤，改右下角「×N」角标（`usageCount` 按 cardId 计数）+ `is-used` accent 描边；`addCardById` 落到活动组（受排斥约束）。`ExternalLibraryPanel` 注入购物车同步带 uid/活动组。`sanitizeTemplateNode` 不动 groups/cart（配置非运行态）。零新 IPC。验证：web/node tsc 绿 · 681 tests 绿 · build 绿。
> **2026-06-24 续二：提示词商城卡片扩到 ~4000 + 新增 props/effects 两大类 + 子类细分（按用户分配，全部追加不覆盖）**：用户实测后定方案——人物/服饰大补、镜头构图&光线保持、色彩/画风/质感/氛围/质量按表扩、环境/室内/动植物建筑不动（非场景类优先），新增「知识」=人物子类 `field`（学识·专业领域）+ 两个全新大类。**结构**（`cardTypes.ts`/`thumbGen.ts`/`mallThumbs.tsx`）：① 人物加 `field` 子类；② 服饰加 `socks`/`suit`/`gloves` 三子类；③ 新增大类 **`props`（道具元素**：weapon/instrument/food/tech/daily/fantasy-item/vehicle/sports）+ **`effects`（特效后期**：particle/smoke/magic/fire/film/glitch/light-fx/weather-fx），各带 grad/glyph(`box`/`spark`)/装配顺序（props 接 clothing 后、effects 接 mood 后）；④ `thumbGen.CAT_STYLE` 加 props=isolated、effects=demo。**数据**（全部新增文件，原 12 个数据文件 0 改动；`cards.ts` 按 id 去重保留首个=原数据优先）：18 个多智能体并行授权写的 `data/*Ext.ts`/`props.ts`/`effects.ts`（人物拆 hair/face/identity/pose/more 5 + 服饰拆 A/B/C/D 4 + artStyle/color/material/mood/quality Ext 5 + props/propsExt/effects/effectsExt 4）。**genPrompt 撰写铁律**沿用统一风格包装（灰底影棚/场景/demo 三档 + Z-Image 自然语言 + 人物五官锁真人无动物比喻）。**约 2370 张原始产出 → 去重后净增到 4041 张**（~330 张 `masterpiece`/`8k` 等通用词与原卡同 id 被去重合并，正确行为）；人物 190→726、服饰 160→575、props/effects 各 296。验证：web/node tsc 绿 · 681 tests 绿 · build 绿 · 4041 卡 · 人物分类 0 动物串味。
> **2026-06-24 续三：节点自适应大改（手动>自适应优先级 + 双向贴合 + 防截断/防空白）+ 文本区滚轮 + LLM/聊天 + 外置提示词库卡片化**：用户反馈节点窗口要全面自适应。① **滚轮滚动文本而非缩放画布**——给提示词/LLM 输出/聊天/反推 的可滚动文本区加 ReactFlow `nowheel` 类（鼠标在其上滚轮滚动内容，不再缩放画布）：PromptNode 两个 textarea、LLM `.mb-sc-chat-msgs`/`.mb-sc-chat-ta`/`.mb-sc-llm-out`、ImageReverse/VideoReverse 输出 pre。② **手动 > 自适应（全局，铁律 26）**——`NodeMeta` 加 `manualSize?`；**store `onNodesChange` 集中检测**：拖 NodeResizer 产生的 `dimensions` 变化带 `resizing=true` → 标记该节点 `manualSize=true`（一处搞定全部 27 个节点，不逐个改）；`autoGrowNode`/`useFitNodeToContent`/TextNode 自适应一律 `manualSize` 跳过；节点右键加「恢复自适应大小」清除。③ **`autoGrowNode` 改双向贴合**（原只增不减 → 内容变少也收回，消除「截图 2」式大片空白）+ **默认封顶 760→1600**（消除「截图 3」式运行按钮/结果图被截断）。④ **LLM 节点**：节点模式估高改按输出框可见高度（`.mb-sc-llm-out` 最高 110px 滚动）算、双向贴合（解决长 JSON 输出留大片空白）；**聊天模式关闭自适应**（固定大小，避免每条消息撑大窗口）+ 进入聊天给一次较大固定尺寸（对话/输入区都尽量大）。ImageReverse/VideoReverse 输出同样按可见高度估、双向。⑤ **ComfyUI 节点截断根因修复**——其估高漏算「外接提示词预览框」，接上游提示词时内容比估高 → 运行按钮/结果图被 `overflow:hidden` 截掉（截图 3）；补齐估高（外接提示词框 +84 / 结果图按列数算行 + 文本 + 错误）。⑥ **TextNode**：文字按 `.mb-sc-textnode-view` width:100% 随节点宽度换行（适应宽度），ResizeObserver 双向贴合高度 + `manualSize` 跳过。⑦ **外置提示词库重做成卡片库**（`ExternalLibraryPanel` + 新 `useExternalCardsStore` localStorage）——去掉「内置片段库/我的提示词库」两个 tab（用户只要外置库），改为**用户自建「封面+标题+提示词」卡片**：响应式网格（`repeat(auto-fill,minmax(170px,1fr))` 一行几个随窗口宽、文字/封面裁在卡内不溢出）、点击应用到画布（选中商城/提示词节点或新建）、右键编辑/删除/打开来源。**封面两种来源**：选本地图片（canvas 压到 512 webp dataURI 防配额爆）/ **从来源网址自动获取**（新 IPC `api:web:page-preview`：主进程 `chromiumFetch` 抓 HTML → 解析 og:image/og:title → sharp 压 512 webp dataURI，避开 CORS、12s 超时）。保留「前往提示词网站」浏览器外链按钮。**新 IPC：1 个**（api:web:page-preview）。验证：web/node tsc 绿 · 681 tests 绿 · build 绿。
> **2026-06-24 续四：资产库无限滚动 + 源文件删除同步 + 分组后端 + 侧栏成组/超链接 + 提示词节点5×/统一提示词 + 商城4新类 + 缩略图不入库 + 删除外置库**（多项并行；复杂功能 agent 频繁 socket 断连，故 gallery/sidebar 由 agent 起手、主进程接管补全，数据卡由 agent 写）：① **[关键] 资产库一次只加载 494 修复**——`api:gallery:list` 原 `LIMIT 500` 硬上限移除，改 `limit`/`offset`/`before_id`（键集分页，抗删行错位）；Manager 改**无限滚动**（首屏 100，IntersectionObserver 哨兵提前 600px 触发拉下一批 100，键集游标=当前最小 id，去重累积直到不满页=全部加载完；切相册重置）。② **源文件删除同步**——list 处理器扫当前页，原图 `existsSync` 不在 → 软删该行 + 从响应剔除（磁盘删原图，资产库卡片随之消失）。③ **资产库分组（文件夹）后端**——db v20 加 `images.group_name` 列 + 索引；`api:gallery:list-groups`（distinct 分组+计数+封面）/`api:gallery:set-group`（归组/移出，物理把源文件移到 `<存储根>/groups/<名>/` 或 `ungrouped/`，更新 file_path、缩略图置 NULL 交懒补；逐文件 try/catch 不丢数据）；list 支持 `group` 筛选（`__home__`=未分组散图）。**Manager 分组 UI（地址栏面包屑 + 文件夹卡 + 拖拽成组 + 虚线出组卡 + 画布命名组 E）暂未接线——后端已就绪。** ④ **侧栏成组 + 超链接（G）**——`shortcutsStore` 重写（`Shortcut.kind` 加 `'url'` + `groups`/`order`/`groupOnto`/`addToGroup`/`removeFromGroup`/`ungroup`/`renameGroup`/`reorderEntry`，localStorage v2 迁移）；`Sidebar` 改按 `order` 渲染（条目/分组混排）：长按拖动到另一项「身上」中段→成组（`is-sc-grouptarget` 高亮）、靠边→重排；分组按钮点开浮窗列成员逐个启动 + 重命名/解散；网址链接（菜单「🔗 添加网址链接」/ 拖 URL 进侧栏）点击 `storage.openUrl` 浏览器打开。⑤ **提示词节点（A+H）**——单条输入框默认 ≈5×高（DEFAULT_SIZE 240→560 + 自适应 floor 680）、列表每条 ≈3×（`listItemHeight` 默认 132）；**改一个框高度→所有框一起变**（拖底边 onMouseUp 写共享 `listItemHeight`）；右键/按钮「**适配高度**」量所有框 scrollHeight 统一调高；**统一提示词/前置提示词**（`unifiedPrompt`+`unifiedPos` 前/后/两侧，`promptNodeOutputs` 拼进每条，多段逐条生图免重复输入）。⑥ **提示词商城缩略图不入资产库**——ComfyUI 单次运行 `skipGallery` 标志贯通（schema/queue/runEngine/`addImagesToGallery` 跳过），`generateMallThumbViaComfy` 传 `skipGallery:true`。⑦ **商城新增 4 大类 + 连衣裙补充**——`中国风-女`(60，先秦汉→现代国风 8 子类) / `中国风-男`(60) / `泳衣`(30) / `婚服`(30，中式秀禾·龙凤褂·汉式·西式婚纱·男士礼服·现代轻婚纱) + `clothing.dress` +39（现代/薄纱连衣裙）；卡片总数 4041→**4260**。⑧ **删除「外置提示词库」**——`ExternalLibraryPanel` 文件删除、index/CanvasToolbar 入口移除（用户判定作用不大）。**本轮明确推迟（已如实告知）**：资产库分组 Manager UI（面包屑/文件夹卡/拖拽，后端已就绪）+ 智能画布按画布名建组（E）；提示词商城**分类/卡片 增删改 CRUD + 卡片拖动调分类/多选/快速选择 + 购物车右键移除/拖出 + 一段描述推荐分类（K/L/M/N）**；商城缩略图打包进安装包（I，用户「等我全部做完了」再做）。新 IPC：2 个（gallery:list-groups / set-group）。验证：web/node tsc 绿 · 681 tests 绿 · build 绿 · 4260 卡。
> **2026-06-24 续五：补完上轮推迟项——资产库分组 Manager UI + 画布名建组 + 提示词商城管理（CRUD/移分类/多选/拖出/描述推荐）**（打包内置缩略图仍按用户意愿留待后续）：① **资产库分组（文件夹）Manager UI**（后端 `gallery:list-groups`/`set-group`/db `group_name` 上轮已就绪，本轮接前端，`Manager/index.tsx`+`Manager.css`）——`groupFilter()`：相册激活时不按分组、否则首页只看未分组散图（`__home__`）、进文件夹看该组；分组与相册互斥（进相册清 activeGroup、进分组清相册）。**面包屑地址栏**「🏠 首页 › 📁 组名」（组名双击/✎ 内联改名→`renameGroup` 整组 setGroup 到新名、后端顺带移源文件；🗑 解散→整组移回首页）。**首页文件夹卡**（`FolderCard`：封面+组名+「N 项」，点开进组、右键改名/解散、**拖图片到卡上=归入该组**）。**文件夹内**第一张=虚线**出组卡**（`ExitGroupCard`：点返回首页 / 拖卡到此=移出本组）。**拖卡成组**：`ImageCard` dragStart 加内部载荷 `application/mengbi-gallery-id`，拖一张落到另一张上→`dropCardOnCard`（目标已在组则并入、否则新建「文件夹 N」把两张一起放进，`is-dragover` 高亮）。**右键「移到文件夹…」**子菜单（新建并移入 / 现有组 / 移出）+ 批量选择新增「归入文件夹（N）」按钮。`collectGroupImageIds` 键集翻页取整组 id 供改名/解散；分页（`refreshImages`/`loadMoreImages`）与 `gallery:changed` 监听并入 `group` 维度 + `refreshGroups`。② **画布名建组（E）**——`generate.ts` INSERT images 读 `params.gallery_group` 落 `group_name`；`smartCanvasRunner.runWorkNode` 的 baseParams 注入 `gallery_group = currentDocName()`（当前画布标题）→ 智能画布生图自动归入「以画布名命名」的文件夹（仅 work 节点生图路径，ComfyUI/视频暂不归组）。③ **提示词商城管理（K/L/M/N）**——新增**自定义叠加层** `lib/promptMall/mallCustomize.ts`（localStorage `mengbi.promptMall.customize.v1`：userCats/extraSubs/renameCats/hiddenCats/overrides，内置只读数据零改动；`buildMallCategories` 合并出有效大类、`applyCardOverride` 对任意卡移分类/改文案/隐藏）。`PromptMallStudio` 改用合并后的 `categories`/`allCards`/动态 `catCounts`：**分类 CRUD**（左栏「➕ 新建分类」+ 右键 重命名/新增子类/删除（用户类删、内置类隐藏））；**卡片 改/删/移分类**（卡片右键「编辑卡片…」浮层改 中/英/genPrompt、「移到分类…」子菜单、「删除（用户删/内置隐藏）」；**拖卡到左侧分类=改其分类**）；**多选+批量**（「☑ 多选」开关 = 快速选择，点卡勾选、批量条「移到分类…/删除选中/清除」）；**购物车卡片右键移除**（已有）+**左键拖出到卡片墙=移除**（中栏 onDrop 检 `dragUid` 无 CARD_MIME 即 `removeByUid`）；**左下「描述→推荐分类」**（`lib/promptMall/recommend.ts` 复用 `api:chat:optimize-prompt`+`extractJsonBlock` 让对话模型识别主体返回分类 slug 数组 → 命中分类 `is-recommended` 高亮脉冲 + 自动跳首个）。零新 IPC（推荐复用 optimize-prompt、分组复用上轮 gallery 通道）。验证：web/node tsc 绿 · 681 tests 绿 · build 绿。
> **2026-06-24 续六：实测反馈修六处（侧栏浮窗被盖 + 资产库分组体验 + 切页节点状态重置 + 成组闪烁）**：① **[侧栏分组浮窗被正式内容盖住]**（图1）——`Sidebar` 分组成员浮窗原直接渲染在侧栏 DOM 里，`position:fixed` 落进 framer transform 祖先的层叠上下文被主内容盖住；改 `createPortal` 到 `document.body` 脱离。沉淀**铁律 27**（浮层必须脱离 transform 祖先：portal to body 或双类 `.xxx.mb-card` 提特异性）。② **[资产库文件夹卡变小 + 单行横向抓手滚动]**（图2）——`.mb-gallery-folders` 由换行 grid 改 `flex nowrap + overflow-x:auto`（118px 小卡、1:1 封面）+ `useDragScroll`（`foldersRef`）长按抓手左右滑、超出页面横向滚动不挤占多行。③ **[卡片垃圾桶不另起一行]**——`.mb-gallery-actions` 改 `flex-wrap:nowrap` + 卡内按钮收紧（目录/预览 `flex:1` 文字省略、删除图标按钮固定），目录 / 预览 / 删除 同排。④ **[批量选择可批量拖动成组]**——`ImageCard` dragStart 在「批量选择且本卡被选中」时附带 `application/mengbi-gallery-ids`（全部选中 id），文件夹卡 / 出组卡 / 卡间成组的 drop 统一 `readGalleryDragIds`（单张或整批）→ 拖一张带走整批归组。⑤ **[卡片右键：加入成新组 / 加入现有组]**——`showImageMenu` 把原「移到文件夹…」拆成两条顶级项「加入成新组（批量时带张数）」「加入现有组… ▸ 各文件夹」（+ 已在组时「移出文件夹」），批量选中时对整批生效。⑥ **[资产库主区域冻结]**——面包屑 + 文件夹横排包进 `.mb-gallery-header { position:sticky; top:0 }`（不透明底），卡片网格在其下独立滚动、表头不随之滚走。⑦ **[切页回来节点状态被重置成「待运行」但后台仍在跑]**（图3，多智能体只读定位）——根因：切页 unmount 时 `sanitize()` 把 `status:'running'` 落盘成 `idle`、重挂再 sanitize；而 `pendingWork/pendingComfy/pendingVideo/pendingInterp` 是模块级、任务其实还活着，无人把节点状态对账回 running。修：新增 `resyncRunningNodesFromPending()`（按 `node.id` 与四个 pending Map 对账，**只补回 running、纯增量幂等、绝不清状态/丢结果**），`CanvasWorkspace` 挂载下一帧调用（其 `key={activeDocId}` → 任何切页/切档都重挂 = 统一对账点）。⑧ **[拖动成组闪一下旧状态又冒出来]**——`setImagesGroup` 成功后先 `useGalleryStore.clear()` 再刷新：否则刷新时把「分组前的旧列表缓存」当瞬开内容闪出来（被分掉的图一闪即逝又出现），清缓存后两条刷新路径都拉新数据、无闪烁。零新 IPC。验证：web/node tsc 绿 · 681 tests 绿 · build 绿。
> **2026-06-24 续七：资产库分组头错色/透漏修复 + 便携资产库同步分组&限 100 + ComfyUI 节点出图也成组**：① **[分组头 UI bug]（图1 透漏 + 图2 黑夜外主题黑色错色带 + 实色暗带太丑）**——`.mb-gallery-header` 原背景 `var(--mb-bg-card-solid, var(--mb-bg-card))` 两个坑：`--mb-bg-card-solid` 只在 3 个主题定义、其余继承 `:root` 深色 `#181820` → 非黑夜主题出现「黑色错色带」（图2）；且滚动容器 `.mb-manager-content` 有 `padding-top:22px`，sticky 吸顶后这 22px 缝隙漏出下方上滚的卡片（图1）。先改 `--mb-bg-base` 实色不透明，但**大片空白实色暗带仍太丑**（与玻璃面板不融）→ **最终方案：头部用与面板同款磨砂玻璃**（`background: var(--mb-bg-card)` + `backdrop-filter: blur(28px) saturate(140%)`，滚动卡片在头下被虚化而非硬挡、自然融入；横向 `margin: 0 -26px` 抵消 26px 内边距 → 全覆盖到面板两缘）+ `::before`（高 26px 同款磨砂）盖顶部内边距缝隙 + **低配模式 `html[data-perf='low']` 关 backdrop-filter 时退回 `--mb-bg-base` 不透明兜底**（防玻璃漏卡片）+ z-index 4→6。② **[便携资产库（`SmartGalleryPanel`）同步分组]**——加「文件夹」下拉（复用 `api:gallery:list-groups`：全部 / 📂 首页未分组 / 各 📁 分组（计数）；选了相册时禁用＝互斥，与 Manager 一致），选中即按 `group` 过滤（`refresh` 加 group 参数 + `image:done`/`gallery:changed` 同步刷新分组列表）。③ **[便携资产库只加载近期 100 张]**——`refresh` 传 `limit:100`（`PORTABLE_LIMIT`）只作临时查看（主资产库 Manager 才无限滚动全量）；底部提示改「临时查看 · 仅显示最近 100 张（完整资产库在「图库」页）」。④ **[ComfyUI 节点出图按画布名成组]**——上轮画布名成组只覆盖生图(work)节点（`generate.ts` 读 `params.gallery_group`）；本轮打通 ComfyUI 链路：`submitComfyAndWait` 内按 `docNameById(docId)` 解析画布名（**后台文档**也取对，skipGallery 商城缩略图不分组）→ `comfyui.runSingle({galleryGroup})` → schema/ipc 类型/comfyuiRun handler/queue `QueuedRun`/runEngine `RunIterationParams` 逐层透传 → `gallerySync.addImagesToGallery` 的 INSERT 写 `group_name`（**只写列不物理移文件**，与生图节点一致；物理移动仍只发生在拖拽 set-group）。批量 comfy（runComfyBatch defer）自动同享。零新 IPC。验证：web/node tsc 绿 · 681 tests 绿 · build 绿。
> **2026-06-25 节点状态丢失修复 + 提示词商城重构（分类合并/子分类可用/组装两模式/推荐子类/缩略图方框 + 姿态发型扩库）**：① **[BUG·节点运行中切页回来显示「待运行」但后台还在跑]**——上一轮 `resyncRunningNodesFromPending` 基于错误模型（以为切页会从 sanitize 后的 localStorage 重载），实际**纯路由切换内存 store 存活、不重载**；真正产 idle 的路径有二：(a) 经**启动页/切档**回来 → `openDoc`/`loadInto` → `readDocContent` → `deserialize(sanitize(...))` 把 running 归 idle；(b) **完成态从未持久化**——任务在页面 unmount 后才完成时，autosave 订阅已注销，`setWork` 的 success 只在内存、没落盘，回来一重载就丢。修：**① 终态落盘**——新 `persistActiveDocTerminal(docId,nodeId,patch)`（`patchDocNodes` 写当前文档），在 `placeWorkResult`/`placeComfyResult`/`routeVideoDone` 的「当前文档」分支补调，使 success/error 重载后仍在（sanitize 只清 running 不动 success）；**② 会话级在跑登记**——新 `liveRunningNodes: Set` + `endWorkRun()`，`runWorkNode`/重试在「验证已过即将提交」时 `add`、所有终态/取消 `endWorkRun`，`resync` 的 work 分支改 `liveRunningNodes.has || activeWorkTasks.size>0`（闭合「提交前构建窗口」漏标）。② **提示词商城分类重构**——「中国风女/男·泳衣·婚服」四个旧大类**并入「服饰」作子分类**、「年龄段」**并入「性别·年龄段」**：`cardTypes.ts` 删四大类 + 加四 clothing 子类 + 合并 age-stage→gender-age + `PROMPT_MALL_ASSEMBLY_ORDER` 同步；**数据文件零改**，在 `cards.ts` 用 `remapCard` 重映射 cat/sub/id（旧 sub 进 id 前缀防撞）。③ **[bug] 新建子分类没反应 + 卡片可拖到子分类**——根因：`moveCardToCategory` 总把 sub 清空、无路径把卡归入新子类。修：`moveCardToCategory(id,cat,sub='')` 加子类参数；**子类 chip 变 drop 靶**（拖卡上去归该子类，支持批量）；卡片右键加「移到子类 ▸ 本大类各子类」；新增卡片表单 sub 下拉本就列出新子类。④ **组装优化两种方式**——`PromptMallNodeData.assembleMode 'fragments'|'paragraph'`：片段列表（逗号拼接，可选「优化合并」）/ 整段自然语言（对话模型从头写成连贯一段，新 `PROMPT_MALL_PARAGRAPH_SYSTEM`）；商城结账区 + 节点卡加切换（paragraph 必走对话模型）。⑤ **推荐分类也推子分类**——`recommendMallCategories` 改吃「大类+子类」、返回 `{slugs, subKeys}`（`大类/子类`），命中子类 chip 高亮脉冲 + 自动切到首个推荐子类；总分类的重命名/隐藏/删除仍在右键。⑥ **缩略图提供方框**——新增卡片表单左侧加 `.mb-sc-mall-thumbbox`：**拖入图片 / 聚焦后粘贴 Ctrl+V / 点击选文件** → `shrinkToThumb` 压到 ≤256px webp dataURI 存进**用户卡片自带 `thumb`**（`PromptMallCard.thumb`，`PromptMallThumb` 优先显示，无需缩略图文件夹）。⑦ **数据扩库（Workflow 6 并行 agent）**——静态姿态（男+女各 42）/ 动作姿态（男+女各 42）各 +84（连既有 ≈109，达成「各至 100」）+ 中国古代发型（女/男各 22）+44；新文件 `data/characterExtPose2.ts`/`characterExtHairAncient.ts`；`cards.ts` 去重加第二道「同(大类,子类)同中文名只留首张」合并相同意思的提示词。零新 IPC。验证：web/node tsc 绿 · 681 tests 绿 · build 绿。
> **2026-06-25 续：提示词节点高度减半 + 镜头节点加「景别（景构）」+ 打包 0.0.11**：① **提示词(prompt)节点高度减半**——上轮把单条输入框做成 ≈5× 高（`DEFAULT_SIZE.prompt.height 560` + 自适应 floor `Math.max(680,…)`）后用户嫌过高 → 减半：DEFAULT_SIZE 560→**280**、PromptNode 单条模式自适应 floor 680→**340**（≈2.5×）；列表模式（listItemHeight）与翻译框不变。② **镜头(angle-prompt)节点加「景别 / 景构」**——新增 `ShotSize` 类型（10 档：未指定/超远景/远景/全景/全身/中景/中近景/近景/特写/大特写，覆盖用户列的 全景·近景·中景·全身·超远景）+ `SHOT_SIZE_LABELS`/`SHOT_SIZE_SUB`（取景范围副标）+ `AnglePromptNodeData.shotSize?`。两种模式（拍照/视频）通用，`cameraPrompt.ts` 新增 `SHOT_SIZE_PHRASE` 并在 `buildCameraPrompt` 把景别短语**排在镜头描述最前**（景别是最根本的取景）；`optionIcons.tsx` 加 `shotSize` 线条图标集（取景框 + 由远到近递增的人形/面部，一眼看出景别）；`NodeCameraConsole` 在「构图」上方加「景别（景构）」`IconChoiceGrid` + resetAll 复位 shotSize；`AnglePromptNode` 卡片摘要 chips 首位显示景别。`cameraPrompt.test.ts` +2 例（景别两模式通用且排最前 / none·缺省不输出）。③ **打包 0.0.11**——package.json + `AboutSection.appVersion` 0.0.10→0.0.11，`package:win`（clean + electron-vite build + electron-builder --win）。零新 IPC。验证：web/node tsc 绿 · 683 tests 绿 · build 绿。
> **2026-07-07 便携版启动卡顿根治（包体 1.6GB→719MB + 首屏代码分割 + native 模块懒加载）**：用户反馈「便携版打开很卡」。根因＝electron-builder portable 单 exe **每次启动都把 ~1.6GB 解压到 %TEMP%**（+杀软逐文件扫描），而包被死重量撑大。四组修复：① **便携版改「绿色版 zip」**——win target `portable`→`zip`（win-unpacked 直接压包，解压一次原地运行，启动与安装版持平；`win.artifactName` 命名 `mengbi-x.y.z-portable.zip`，nsis 有自己的覆盖不受影响）。② **打包瘦身**（electron-builder.yml files 排除）——`@node-llama-cpp` 只保 win-x64 + vulkan（砍 win-arm64 错架构 / cuda 139M / cuda-ext 441M，共 ~590M；Vulkan 对 N/A/I 卡通吃，NVIDIA 上略慢于 CUDA 是已接受的取舍）；`onnxruntime-node` 只保 win32/x64（砍 darwin/linux/arm64 ~130M；**mac 打包时需去掉 darwin 排除项**，yml 有注释）。③ **依赖归属纠偏**——渲染端专用依赖（react 系/framer-motion/konva/react-konva/@xyflow/react/zustand/@imgly/background-removal/onnxruntime-web）移到 devDependencies：Vite 构建时已打进 out/renderer，asar 里那份是重复死重量（asar 250M→140M）；**删除 `gpt-tokenizer`**（全项目零引用）。主进程运行时依赖（sharp/better-sqlite3/ffmpeg-static/onnxruntime-node/node-llama-cpp/ws/zod/expr-eval/duck-duck-scrape/potrace/@neplex 等）必须留在 dependencies（externalizeDepsPlugin 靠它判断外置）。④ **启动链路提速（安装版同样受益）**——(a) 渲染端 7 个页面全部 `React.lazy` 按路由拆分（首屏 4.8MB 单 bundle → 665KB 入口 + 按需 chunk；提示词商城 1.2MB 卡片数据随 SmartCanvas chunk 走）+ `Routes` 包 `Suspense`（fallback 空占位，放 ErrorBoundary 内）；App 级 `registerSmartRunnerListeners` 改动态 `import('@/lib/smartCanvasRunner')`（与 SmartCanvas 页共享同一 chunk 实例，模块级 pending Map 语义不变，注册仍在启动后毫秒级完成不漏事件）；资产库首次预载延到首屏后 1.2s（不与首帧抢时间窗）。(b) 主进程 `onnxruntime-node`（realesrganOnnxRunner，`import type` + `getOrt()` 懒加载）与 `sharp`（新 `services/sharpLazy.ts:getSharp()`，thumbnail/misc/video/inpaintComposite/vectorize preprocess×2 六处顶层 import 全部改懒取）不再在注册 IPC 时同步加载 native 模块（与 localLlmServer 对 node-llama-cpp 的既有 lazy 模式一致）。**沉淀规则**：新增主进程重型 native 依赖一律 lazy dynamic import；新增页面一律 React.lazy 注册路由；渲染端新依赖放 devDependencies。零新 IPC。验证：web/node tsc 绿 · 701 tests 绿 · build 绿 · `--dir` 打包实测 719MB（asar 140M + unpacked 288M）。
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
| `api:gallery:import-files` | renderer→main | **多类型文件收录**（2026-06-12）：图片/视频/SVG/PSD/PDF/Office 按本地路径批量导入（复制进 `image_storage_path/{date}/` + INSERT INTO images，`notes=[import:<kind>]`；图片即刻生成缩略图、视频封面由渲染端抓帧补、PSD/PDF/Office 前端渲染类型图标卡、点击用系统默认程序打开） |
| `api:prompt:list` | renderer→main | 提示词卡片列表（按 category 过滤）。**管家 UI 2026-06-12 复活**（/manager「提示词」视图 + 画布提示词库弹窗共用） |
| `api:prompt:upsert` | renderer→main | 新增 / 更新提示词卡片 |
| `api:prompt:delete` | renderer→main | 删除提示词卡片（软删除，铁律 13） |
| `api:prompt:category:list` | renderer→main | 提示词分类列表 |
| `api:album:list` | renderer→main | 相册列表（出口已把 `smart_rules` 解析成对象） |
| `api:album:upsert` | renderer→main | 新增 / 更新相册（含智能相册规则） |
| `api:album:delete` | renderer→main | 删除相册（只删相册本身，不动图片） |

> **相册（2026-06-05 落地 UI）**：手动相册靠 `images.album_ids` 成员（图库右键「加入相册」逐张归入，json_each 精确匹配避免 "1" 误配 "10"）；智能相册存 `smart_rules`（`minRating` / `tags` 全含 / `models` 任一 / `dateFrom`~`dateTo`），`api:gallery:list?album_id=` 时按规则**实时匹配**、不存固定成员。前端在 Manager 图库视图侧栏（`AlbumEditModal` + 侧栏相册导航）。

### 4.4 实验室后端（lab.ts）——页面已下线，后端保留为共享服务

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:lab:reverse` | renderer→main | 单图 / 多图反推（**智能画布 LLM 节点复用**） |
| `api:lab:translate` | renderer→main | 中英互译（休眠，暂无 UI 入口） |
| `api:lab:history` | renderer→main | 历史记录查询（休眠） |

> **2026-06-05：实验室作为独立页面已整体下线**（删 `Laboratory/` 页 + labStore + 侧栏 + 路由）。`lab.ts` 的 handler **保留**，因为智能画布 LLM 节点的「图片反推」复用 `api:lab:reverse`——这是有意保留的共享后端，不是死代码。translate/history 暂无 UI 入口（休眠）。原计划的 拆解 / 多模型对比 / 融合 早于 2026-06-05 移除，不要复活旧桩。

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
| `api:storage:list-images` | renderer→main | 列出文件夹中的图片/视频文件（只回元数据不回字节；可选 `kinds:['image','video']`；智能画布 folder-input 节点扫描用，2026-06-10，2026-06-12 扩展视频） |
| `api:storage:copy-into` | renderer→main | 批量把图片复制/写入到目标文件夹（本地路径零转码 / dataUri 解码，重名 -2/-3；folder-output 节点落盘用，2026-06-10） |
| `api:storage:open-url` | renderer→main | `shell.openExternal` 打开 URL |
| `api:storage:scan-loras` | renderer→main | 扫描 `lora_folder_path` 目录返回 .safetensors / .pt / .ckpt 列表 |
| `api:export:card` | renderer→main | 导出作品卡片 PNG |
| `api:theme:save` | renderer→main | 保存自定义主题（写入 `themes` 表） |
| `api:theme:list` | renderer→main | 自定义主题列表 |

### 4.6 工具箱（tools.ts + upscale.ts + vec.ts + interp.ts）

工具箱拆成几段 IPC：通用工具（落盘 / 入库）、保真放大（Real-ESRGAN ncnn Vulkan）、图像转矢量(VTracer / Potrace)、视频插帧(RIFE)。各引擎完全分离 —— 不同目录、不同 IPC 前缀、不同前端面板。

> **SUPIR 已于 2026-05-29、HYPIR + ai-platform 通用底座已于 2026-06-18 整体砍除** —— SUPIR 显存 25-30 GB 过大；HYPIR 需 Python+CUDA 便携包且权重不随安装包、价值与维护成本不匹配，连同只服务它的 ai-platform sidecar 底座（aiFeature/aiModel IPC + sidecarManager/featureRegistry/modelRegistry/installManager）一并移除。工具箱现为 保真放大 + 图像转矢量 + 视频插帧 三引擎。

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

**视频插帧（interp.ts，本地 RIFE ncnn Vulkan，2026-06-12 加入）**

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:interp:status` | renderer→main | 引擎装没装、模型清单（rife* 子目录）、默认模型（rife-v4.6）、平台 |
| `api:interp:install-engine` | renderer→main | 下载官方 zip（~40MB，自带全部模型）解压到 `userData/engines/rife/`；source ∈ {auto/github/mirror}；进度推 `interp:install-progress` |
| `api:interp:remove-engine` | renderer→main | 删整个引擎目录 |
| `api:interp:run` | renderer→main | **同步等完成**：ffmpeg 拆帧 → rife-ncnn-vulkan `-n 目标帧数`（v4 系任意倍率）→ ffmpeg 合帧带回音轨；进度推 `interp:progress`（三阶段定额 拆帧 0-15 / 插帧 15-85（轮询输出目录帧数）/ 合帧 85-100，`clientTag` 回带定位节点） |
| `api:interp:cancel` | renderer→main | 按 taskId 取消（空 = 全取消）；三阶段子进程都可中断 |

> 实现要点：`electron/services/rifeEngine.ts`（安装/状态，仿 realesrganEngine）+ `rifeRunner.ts`（三阶段管线 + 串行队列 + 300s idle 看门狗 + 临时目录 `temp/mengbi-interp/<taskId>` try/finally 必清 + 24h 残留清扫）+ `rifeMath.ts`（纯函数：ffmpeg stderr 解析 fps/时长/音轨、目标帧数换算，vitest 覆盖）。防爆盘双闸门：时长 ≤120s、目标帧数 ≤7200。下载走 `netDownloader.githubReleaseUrls`（GitHub 直链 + kkgithub + 6 家前缀镜像）；解压走新提取的通用 `zipInstall.ts`（Expand-Archive/unzip + ZipSlip 校验 + 壳目录拍平；realesrganEngine 自带份未动，后续可统一）。智能画布「插帧」节点（frame-interp，第二十三类）：接视频来源 → 卡上装引擎/选 30/48/60fps/运行/进度条/播放结果 → 输出视频喂下游（视频反推/缩放/插帧/结果）。

### 4.7 通用 AI 平台底座（已于 2026-06-18 整体移除）

> 这套「本地 Python sidecar 通用底座」（`electron/services/ai-platform/` + `ai-features/` + `api:ai-feature:*` / `api:ai-model:*` IPC + sidecarManager/featureRegistry/modelRegistry/installManager）此前**只服务 HYPIR 一个功能**。HYPIR 砍除后底座成了无消费者的死代码，已连同 HYPIR 一并删除。日后若再做需要本地 Python sidecar 的 AI 功能（如 ControlNet / 抠图），按当时需要重新设计，**不要复活旧桩**。

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

> 主进程主动推送的频道（renderer 通过 `on` 监听）：`chat:chunk` / `chat:done` / `chat:sources` / `image:done` / `image:progress` / `notification:append` / `upscale:progress` / `upscale:done` / `upscale:install-progress` / `ps:file-changed` / `gallery:changed`（2026-06-12：产物自动入库后的轻量广播，无 payload，300ms 去抖；Manager 图库与便携图库监听刷新）。
>
> `chat:sources`：仅当全局 `search_backend` 为外部搜索后端（`ddg` / `tavily` / `searxng` / `bocha` / `zhipu` / `jina` / `serper` 之一，即非 `native`/`off`）且方案勾了 `supports_web_search` 时，主进程在 stream 启动前推一条 `{ id, backend, hits[] }`，前端 ChatPanel 把 hits 挂到该轮 assistant 消息的"📎 参考来源"卡片。

### 4.9 ComfyUI 通用工作流编排器（comfyui*.ts）

> 独立顶级模块，路由 `/comfyui`（Ctrl+4，侧栏「ComfyUI 工作流」）。**与** Create 页方案配置里的 `image_kind='comfyui'` **并存、各取所需**——后者是生图页内联「一键直跑」（把整段 workflow 当占位符替换后直接出图，详见 §6.1 与 §13）；本模块是连接本地 ComfyUI、导入 API workflow、可视化绑定、批量循环的完整外部控制器。两条路是**有意保留的双轨**（一键 vs 深度编排），不要合并。原计划分 6 阶段交付（计划见 `plans/atomic-snuggling-wirth.md`），**现已全部落地**：连接 + 选文件夹自动识别启动 + 导入 + 节点图可视化（`GraphCanvas`）+ 字段级参数绑定（`applyBindings`）+ 文件上传 + 节点绕过 bypass（`applyBypass`）+ 单次/批量循环执行（`LoopPanel`/`loopEngine`）+ 取回图片/文本 + 运行记录（`RunRecords`）。

| 通道 | 区 | 功能 |
|------|----|------|
| `api:comfyui:get-config` / `set-config` | 连接 | 读写 host / 启动命令 / 目录 / token（token 经 safeStorage 加密，存 settings k/v） |
| `api:comfyui:scan-launch` | 连接 | **选 ComfyUI 文件夹自动识别启动方式**（纯读目录 + .bat 文本，不执行）：识别便携包 `run_*.bat` / `python_embeded`+`ComfyUI\main.py` / `venv`+`main.py` / 裸 `main.py`，返回候选 `{label,kind,command,cwd,host}[]`，前端 ConnectionBar 一键回填命令/目录/地址。实现见 `services/comfyui/launchScanner.ts` |
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

> 基于 `node-llama-cpp` 的内嵌本地推理服务（`electron/services/localLlmServer.ts`）。**不暴露 start**——启动是 chat handler 内部按需 lazy 完成的（`chat.ts` 见 `official_kind='local'` 即 `import localLlmServer` + `ensureRunning(cfg.local_model_path)`），本组 IPC 只让前端"看一眼 + 能停"。**已可用**：设置页加 `official_kind='local'` 的对话模型、选一个 `.gguf` 文件（`local_model_path`），即可在对话里走内嵌 llama.cpp 做流式/非流式推理。**仍开发中**：多模型快速切换（`list-models`/`set-current-model`）、推理参数面板（temperature/top_p/max_tokens）、缓存策略。

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
  atmosphere  TEXT NOT NULL,                   -- 'deep-quiet' | 'misty-fog' | ... 共 10 种
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
| `boot_disable_gpu` | （按需写入） | `'1'` = 禁用硬件加速（GPU 加速开关，重启生效）。保存时**同步镜像**到 `userData/boot-flags.json`（app ready 前 DB 未初始化，main.ts 启动最早读旁路文件） |
| `local_llm_gpu_layers` | （按需写入） | 本地大模型 offload 到 GPU 的层数：空=自动 / `0`=纯 CPU / 正整数=限制层数（缓解推理与界面抢显卡）；换值需停止本地服务重新加载 |
| `plan_icons_json` | （按需写入） | 方案自定义图标表 `{[planId]: emoji/文字/图片 dataURI}`；无自定义时自动用「方案名首字 + 名称 hash 底色」（`src/lib/planIcon.ts`，零迁移） |
| `voice_notify` | （按需写入，缺省=开） | 任务完成语音播报开关：`'0'`=关，其余/缺省=开。挂在 App.tsx 的 `notification:append` 监听上（`src/lib/voiceNotify.ts`），白名单只认真完成事件通道（image:done / video:done / comfyui:run-done / vec:batch-done / api:upscale:run-* / api:vec:run-* / api:interp:run），对话不播报 |
| `voice_phrases_json` | （按需写入） | 按任务类型自定义播报话术 `{[taskKey]: {ok?, fail?}}`（taskKey ∈ image/video/comfyui/vec/upscale/interp），留空用默认「{任务名}任务完成/失败」 |

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

- 材质氛围切换（10 种）
- 主题配色切换（10 种）
- 自定义主题保存（写入 `themes` 表）

### 6.3 存储 / 系统

- 自定义图片存储路径
- 数据库导出 / 备份
- 自定义快捷键（v1.1）
- 自动更新开关
- 任务完成语音播报（开关默认开 + 试听 + 按任务类型自定义成功/失败话术，详见 §5.13 `voice_notify` / `voice_phrases_json`）

详见 [`FEATURES.md`](./FEATURES.md) 第四节。

---

## 7. 设计规范

### 7.1 主题（材质氛围 × 主题配色）

详见 [`THEMING.md`](./THEMING.md)。要点回顾：

- HTML 根：`<html data-atmosphere="deep-quiet" data-palette="warm-orange">`
- 10 种 atmosphere（none / deep-quiet / misty-fog / warm-stone / deep-city / flowing-light / dream-galaxy / wave-layer / warm-jade / glass）
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
- [ ] 改动到"参数流"纯函数（family buildBody / `imageBody.ts` 的 resolveSize / applyBodyOverrides）时，`npm test` 通过

> **单元测试（vitest）**：`npm test`（= `vitest run`）。当前覆盖**参数流纯函数** —— `src/types/imageModelFamilies.ts`（family 识别 + buildBody）与 `electron/ipc/imageBody.ts`（resolveSize / applyBodyOverrides / 像素换算），锁住"选 4K 实际出 1024""请求体覆盖变量替换/null 删字段"这类历史 bug。新增纯函数（尤其涉及尺寸/请求体/参数映射）请同步补 `*.test.ts`。测试只跑纯函数，不依赖 electron / better-sqlite3。

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
16. **智能画布卡内控件不写死 `height`（防文字裁切，新节点必读）**——全局 `.mb-select`/`.mb-input`/`.mb-textarea` 自带 `padding: 10px 14px`，而 `box-sizing` 是全局 `border-box`。若在节点上给控件单独写死 `height`（如历史上的 `height:28px`），固定高会被 padding 吃掉，**下拉/输入框文字被竖向裁切、看起来"有遮挡"**——这是每次新建带卡内参数的节点反复踩的坑。规则：① 卡内 select/input/textarea **一律复用现成容器作用域** `.mb-sc-wctl` 或 `.mb-sc-revctl`（二者已统一为 `min-height + 真实 padding`，不写 `height`），**不要再发明新的控件容器类后自己写 height**；② 控件类只用全局 `.mb-select`/`.mb-input`/`.mb-textarea` 与 `consoleControls` 的 `SegmentedControl`（`.mb-np-seg`），保证字体/圆角/聚焦态与全应用一致；③ 视角/光源用 `.mb-sc-light-selrow`（沿用全局完整尺寸）也是合规样板。新建节点照抄上述任一样板即可，别再"造轮子"。
17. **任务生命周期与页面解耦（2026-06-10）**——主进程推送监听（image:done / comfyui:run-done / video:* / chat:* 等）一律**模块级或 App 级全局注册**（先例：`registerSmartRunnerListeners` 在 App.tsx 注册、`notification:append` 同），**禁止挂在会被路由切换 unmount 的页面组件 useEffect 里**——`App.tsx` 的 `AnimatePresence + key={pathname}` 切页全 unmount，监听随页注销而模块级 pending Map 还在等 → 后台已成功、前端永远读秒（历史 P0 事故）。页面只负责**展示**任务状态，不决定任务是否继续运行；任务提交时记录 docId，结果回来跨文档走 `patchDocNodes` 回灌。新增任何「提交任务 → 异步推送回结果」的功能都必须遵守。
18. **统一预览与卡片固定尺寸（2026-06-10）**——① 软件内一切「放大预览」（图片/视频/封面卡片）一律组装 `PreviewItem[]` 走统一 `Lightbox`（自动获得 上一张/下一张箭头 + 键盘 ←→/Esc + N/total 计数 + 按 meta 出项的统一右键菜单），**禁止再造单图预览组件**；meta 有什么给什么（prompt/filePath/modelId/createdAt），页面专属操作走 `extraMenu` 注入。② 卡片式内容节点（结果/图集/封面等）**卡片尺寸固定**（CSS `repeat(auto-fill, <固定宽>)`），拖大节点只改变一行排几个，绝不放大卡片本身（看大图用放大预览）。③ 多图任务的结果按批次聚合为「合集卡」（`groupResults`，batchId 同批合并、同 shotIndex 重试翻新），点开居中弹层看 每张图+提示词+成败+单条重试。④ 节点自适应：文本类节点 = `estimateTextHeight` 增高 + max-height 封顶 + 内滚；图集类 = `autoGrowNode` 仅增封顶（按 固定卡宽→列数→行数 算）；双向跟随（`useFitNodeToContent`）仅限展示型节点，表单型禁用防抖动。新增节点/结果卡/预览功能必须沿用这套交互。
19. **数字输入框规范（2026-06-10）**——所有**数值类**输入框（宽/高/数量/帧率/步数/seed/序号…）一律：① 编辑期可自由输入**含删空**（绝不在输入过程中自动补 0 / 即时 clamp）；② **失焦或回车才 clamp 并提交**；③ **聚焦自动全选**（点进去直接覆盖输入）。统一复用 `consoleControls.tsx` 的 `ClampNumberInput`（带 min/max）或 `StepperInput`；不带 min/max 的场景参照 `ControlsForm.FreeNumberField` 模式（本地 text 态 + 失焦提交）。**不适用于**提示词/普通文本/多行文本/聊天输入框。新写任何数字输入禁止 `onChange={e => set(Number(e.target.value) || min)}` 这类「每键即转数」写法。
20. **悬浮窗尺寸记忆（2026-06-10）**——所有可调整尺寸的节点悬浮窗/面板，用户调整后必须**按「面板/节点类型」记忆尺寸**（localStorage），切换画布、刷新、重启后保持，并提供「恢复默认大小」入口。已接入：`ResizablePanelWrapper`（autoSize 面板被拖过即转固定尺寸 `{w,h,user:true}` + ⟲ 恢复钮；非 autoSize 本就持久化）、NodeInspector 浮动面板（CSS resize + `mengbi.sc.inspector.<type>.v1`）。（SmartGalleryPanel 已改为中心悬浮 vw/vh 自适应、不可手调，不再适用本条。）新增可调尺寸浮窗必须沿用此模式。
21. **图库位置与文字放大框规范（2026-06-10，同日按用户反馈修订）**——① 智能画布中的图库**不固定占画布底部**：以**画布中心悬浮窗**呈现——与文字放大框同尺寸规格（`clamp(560px,62vw,1500px) × min(72vh,920px)`，vw/vh 随窗口自适应），**无遮罩**（画布保持可交互、从图库拖图到画布建节点不被拦截）；点击图片走统一 Lightbox **中心放大预览**。画布底部不作图库主入口/主展示区。② 文字类放大查看（故事/提示词/LLM 输出等）一律走统一 `SmartTextViewer`，尺寸**按窗口比例自适应**（vw/vh，约占可视区 1/2，不写死 px），内容超长内部滚动、操作按钮始终可见；其它文字放大场景不得另造小弹窗。
22. **长任务等待规范（2026-06-12）**——视频生成等「分钟级起步、上限不可知」的异步任务，**等待不设硬超时**：只要后台报告「任务进行中」就继续轮询；判失败只有两种情况——① 上游明确报告任务失败；② 状态查询本身连续失败 N 次（网络长断/任务已丢，video 取 45 次 ≈ 6 分钟）。供应商配置的 `timeout` 字段语义 = **0（默认）不限时 / >0 显式上限**（旧默认 600000 在 merge 时一次性归一为 0）；渲染端兜底计时器只在显式上限时挂（且必须严格大于主进程上限，防成功结果被提前判死）。无真实进度时用 `timeRamp`（随时间缓慢爬升封顶 90%）做观感反馈。新增任何长任务轮询都按此模式，不要再写「10 分钟超时」这类拍脑袋硬上限。
23. **视频与多类型文件收录规范（2026-06-12）**——① 视频在渲染端一律**存本地路径不内联 dataURI**（拖入/粘贴/节点换源：`lib/mediaFile.ts` 的 `isVideoFile`/`electronFilePath`，拿不到 path 给降级提示）；画布所有可播视频（视频生成/上传/缩放/插帧/结果/文件夹输入）统一 **双击或右键「放大播放」→ `nodeArea.openVideoPreview`**（Lightbox type='video'）。② 图库收录类型 = 图片/视频/SVG/PSD/PDF/Office（`api:gallery:import-files` 白名单与 `lib/mediaFile.ts fileKindOf` 保持同步）；预览行为：图/SVG=Lightbox 图片、视频=Lightbox 播放（有封面卡加 🎬 角标、无封面用类型图标卡）、PSD/PDF/Office=类型图标卡 + 点击系统默认程序打开（不进 Lightbox ←→ 导航列表）。③ **大列表缩略图禁用「实际分辨率」角标测量**（`MeasuredThumb` 的 `noDims`——量角标要 off-DOM 拉取整个原图文件，500 张全量拉取是便携图库卡顿主因）+ 列表容器 `content-visibility:auto` + 分批渲染（「加载更多」）。④ 深色主题下原生 `<select>` 的 `option` 必须显式给配色（Chromium 下拉列表默认白底，主题浅字会变「白底白字＝下拉内容看着缺失」）。⑤ **软件产物一律自动入库（2026-06-12 补）**——凡软件自身产出的资料文件（生图/视频生成/插帧/视频缩放/放大/HYPIR/矢量化…）在**主进程产出点**统一调 `electron/services/producedMedia.ts:insertProducedMedia`（file_path 引用原位绝对路径不复制；kind=image 同步缩略图，video 封面由渲染端 `backfillVideoPoster` 抓帧补，svg 直接显示；失败只记日志不连坐主流程），入库后自动广播 `gallery:changed`。**自动入库的产物不要再提供手动「加入图库」入口**（import-from-buffer 复制+INSERT 会出重复条目，改「已自动入图库」提示）。新增任何产出文件的功能必须接入。⑥ **本地媒体显示协议**：`mengbi-image://` 注册必须带 `stream: true` 特权（`<video>/<audio>` 硬性要求，漏了视频静默拒载）+ 打包 CSP 同时放行 `img-src` 与 `media-src`；改 scheme 注册要重启进程（HMR 无效）。**协议处理器必须自解析 HTTP Range 返回 206**（`electron/main.ts`：读 `Range` 头 → `fs.createReadStream{start,end}` 经 `Readable.toWeb` 返回 206 + `Content-Range`/`Accept-Ranges` + 按扩展名给正确媒体 `Content-Type`；`bytes=-N` suffix、越界 416、流 error 兜底）——**绝不能 `net.fetch(file://)` 直接转发**（那是不带 Range 的新请求，永远整文件 200，导致 `<video>` 不可 seek、moov-at-end 的 mp4 起播即黑屏）。⑦ **本地 ffmpeg 视频产物一律带 `-movflags +faststart`**（moov 移到文件头，起播无需 seek 到尾；`runFfmpegToVideo` 集中注入 + 缩放/RIFE 合帧内联路径各加，`-c:v copy` 分支也生效无需重编码）。⑧ 渲染端把视频喂 `openVideoPreview`/`<video src>` 只传**原始路径或 http(s)**，且 `openVideoPreview` 自身**幂等**（已是 `mengbi-image://`/`blob:`/`data:` 的不再二次 `localPathToImageUrl`）；节点 `<video>` 统一带 `preload="metadata"`（首帧即显、非黑框）。Lightbox 放大视频**不加 `muted`**（用户手势触发、允许有声）。
24. **可滚动卡片列表加「长按拖动滚动」（2026-06-22）**——提示词库 / 资产库 / 节点模板 / 选图弹窗 / Manager 主资产库·提示词库 等卡片列表，一律给**滚动容器**（带 `overflow:auto` 的那个元素，不一定是 grid 本身——如 Manager 是 `.mb-manager-content`）挂 `useDragScroll`（`src/lib/useDragScroll.ts`）+ `mb-dragscroll` 类（global.css，grab 光标 + 12px 明显滑杆）。**铁律**：① 监听必须 window 级 + `contains(target)` 判定（容器异步加载晚挂载也生效，别再挂 `useEffect` 里绑 ref——会因渲染时机 ref 为 null 而失效）；② skip 选择器保留 `[draggable="true"]` 与默认可拖的 `img/video`，**绝不破坏资产库「拖出图片到外部/画布」的原生拖拽**（选图弹窗等不需拖出的 img 设 `draggable={false}` 即可恢复可拖动滚动）；③ 拖动超阈值才算拖 + 抑制拖后误 click。新增任何卡片滚动列表照此接入。
25. **全局动效规范（2026-06-22，风格「克制·快」）**——新交互动效集中放 `src/styles/motion.css`，**统一闸门 + 安全约束**：① **时长 130–200ms、scale ≤1.02、淡入 + 轻微位移、无明显回弹**（专业工具感，别加大幅 spring/overshoot）；② **低配模式完全关闭**——所有新动效规则前缀 `html:not([data-perf='low'])`（性能模式=低配时规则**不应用**），框架动效（framer）走 `perfMode==='low'?0:…`；**绝不**用 `animation-play-state:paused` 关入场动画（会停在第 0 帧 opacity:0 → 元素隐身）；③ 一并加 `@media (prefers-reduced-motion: reduce)` 整段关闭（无障碍/省电）；④ **入场关键帧不得冲掉定位 transform**——`transform: translate(-50%,-50%)` 居中的中心悬浮窗必须用保留该位移的关键帧（`mb-pop-center`），不能用普通 `translateY` 关键帧（否则弹窗错位）；flex 居中的 `.mb-modal` 才可用 `mb-pop-in`。新增动效一律进 motion.css 并遵守以上四条，不在各组件里散落写过渡。
26. **节点尺寸「手动 > 自适应」（2026-06-10）**——`NodeMeta.manualSize`：用户拖 `NodeResizer` 改过尺寸的节点，`store.onNodesChange` 集中检测 `dimensions` 变化带 `resizing=true` 即标记 `manualSize=true`；所有自适应路径（`autoGrowNode` 双向贴合 / `useFitNodeToContent` / TextNode 测量）一律对 `manualSize` 节点跳过，节点右键「恢复自适应大小」清除标记。新增自适应节点必须复用这套，绝不无视用户手动尺寸强行回弹。
27. **浮层/悬浮窗必须脱离 transform 祖先（防被正式内容盖住，2026-06-24）**——任何 `position:fixed`/`absolute` 的浮层（侧栏分组浮窗、画布内中心悬浮窗、菜单、提示气泡…）只要其 DOM 祖先链上有 `transform`（framer 路由/页面过渡、`.mb-sc-root` 缩放、卡片 hover transform 都是），`fixed` 会**退化成相对该 transform 祖先定位**，且 z-index 被困在其层叠上下文里 → 被「正式窗口/主内容」盖住或错位（反复踩：`SmartGalleryPanel`/`NodeSearch`/提示词库/侧栏分组浮窗）。**两条解法二选一（按需叠加）**：① **`createPortal` 到 `document.body`**——彻底脱离祖先的定位/层叠上下文（坐标用 `getBoundingClientRect` 的视口绝对值，配 `position:fixed`）；② 若浮层同时带 `.mb-card`，选择器必须写**双类** `.xxx.mb-card`（提特异性，避免被 bundle 里更靠后的 `.mb-card{position:relative}` 顶成 relative 落进文档流）。新增任何浮层先想清楚它会不会落在 transform 祖先里——是就 portal。
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
- ~~视频生成 API 调用代码（v1.0 不做）~~ **2026-06-07 解除**：用户决定接入 AI 视频生成（见下方 §视频生成 与变更日志）。视频生成走「异步提交→轮询→下载 mp4 落盘」，配置仿图片（`type='video'` + `video_kind`）。视频提示词的「纯文本管理」仍保留（图库/管家里不变），但智能画布视频节点改为真实生成。
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

实现位于 [imageBody.ts:applyBodyOverrides](./electron/ipc/imageBody.ts)（纯函数，已抽出 generate.ts 便于单测；未知变量名会回调 `onWarn` 跳过该项而非静默删字段）。

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
