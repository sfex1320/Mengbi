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
│   │       └── nodes/          # 图片/文件夹输入/提示词/文字/LLM/提示词商城/智能分镜/角色卡/反推/切分工具/对稿/镜头(拍照·视频)/光源/配色工具/缩放/保真放大/图像转矢量/插帧/视频剪辑/尺寸/循环/生图/ComfyUI/视频上传/视频/结果/文件夹输出/对比/分组 二十九类自定义节点 + NodeShell
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
> **变更日志已拆分（2026-07-11）**：逐日开发日志（2026-06-03 起）整体迁至 [`CHANGELOG.md`](./CHANGELOG.md)。**今后所有「YYYY-MM-DD 做了什么」条目一律追加到 CHANGELOG.md 末尾，本文件只保留当前有效的规范与契约**（规范变化时直接改对应章节正文，不再在此堆日志）。
> **智能画布（`/smart-canvas`）当前形态摘要**（演进细节考古见 CHANGELOG.md）：
> - **结构**：React Flow 节点编排，29 类节点（清单见 §2 目录树注释）；launcher-first 多文档（`CanvasLauncher` 启动页 + `useSmartDocsStore`）。文档元数据存 localStorage `mengbi.smartCanvas.docs.v1`、每张画布内容存 `mengbi.smartCanvas.doc.<id>`（`lib/smartDocStorage.ts`，500ms 去抖落盘；image 节点 base64 经 `externalizeImageNodes` 外置到 `userData/canvas-assets/` 防配额爆）。`activeDocId` 为 session 态：切功能回来停在当前画布，重启回启动页。
> - **运行**：`src/lib/smartCanvasRunner.ts`——主进程推送监听 App 级注册（铁律 17）；任务提交时登记 docId，结果跨文档经 `patchDocNodes` 回灌、终态经 `persistActiveDocTerminal` 落盘；失败结果不进结果节点；长任务等待不设硬超时（铁律 22）；挂载时 `resyncRunningNodesFromPending` 对账在跑节点。
> - **连线规则单一真相**：`src/lib/canvasConnectRules.ts`（CanvasViewport 手画校验 / agentCatalog / agentBuilder 三方共用，不得另抄一份）。
> - **参数 UI**：生图(work)/视频(video)/镜头(angle-prompt)/光源(light) → 弹窗控制台（`nodePanel/`，`mb-np-*`）；简单节点卡上直调（`ON_NODE_TYPES`）；其余走 `NodeInspector` 浮动检查器。被上游喂入的字段一律「标黄 + 去输入框 + 禁手填」。
> - **关键子系统**：AI 智能体（`agentPlanner`/`agentBuilder` + 右下角 FAB，规划免费、生成有确认闸门）、提示词商城（prompt-mall，~4260 内置卡 + `mallCustomize` 自定义叠加层 + 开发模式 ComfyUI 批量出缩略图）、智能分镜（storyboard，2026-07-12 重做：角色描述+简短故事 → 开头【定调】段（稳定全片风格/场景/内容物）+ 按时间轴「第X-Y秒」**逐段分段**的分镜脚本，单输出口喂视频节点；版式由 `formatTimelineText` 代码保证）、角色卡（character-card，2026-07-12：人物/动物照片+简述 → 视觉模型外观分析（人物/动物两套口径）→ 按输出类型出生图提示词——完整设定卡（4 种版面风格）/三视图/面部特写/表情九宫格/身材比例/动作姿势；**双输出口**：上口=生图提示词、下口=角色描述提示词（外观分析）；纯函数在 `lib/characterCardPrompt.ts`）、角色反推（反推节点 outputMode='character'：照片或纯文字素材 → 极详细角色外观描述）、LLM 剧本创作（op='script'：多段人物/场景/故事素材各自【素材N · 来源】标注防混淆 → 完整剧本）、视频剪辑工作台（`VideoClipStudio`）、循环/图片列表批量（共享 `runBatchIteration`：暂停/继续/停止/断点续跑）、统一 Lightbox 预览（铁律 18）、便携资产库/提示词库/节点模板/Obsidian 库（§4.11，检索笔记插入画布 + 节点右键存入）中心悬浮窗（铁律 21/24/27）、提示词 @ 引用参考图（2026-07-12：提示词节点读下游生图节点的参考图，输 @ 弹选图、@ 标记上方悬浮小图；`@图N` 经 `lib/promptImageRefs.ts` 剥 @ 成「图N」再发模型）、运行全部（拓扑序）、撤销重做/复制粘贴/多选群组（Alt 拖动复制=整组带内部连线 + 虚线预览框）/空格临时抓手（纯平移不碰节点）/智能排布/节点搜索。
> - **新增节点接入面清单**（改动必须全覆盖，否则连线/菜单/运行会不一致）：`SmartNodeKind`/`defaultNodeData`/`DEFAULT_SIZE`/`nodeTypes`(memo 注册)/`NODE_ICONS`+`ACCENT_ICON`/`NODE_TYPE_LABELS`/`NodeSearch`/`CanvasDock`/CreateMenu `DOWNSTREAM`+`UPSTREAM`/连线集合（canvasConnectRules）/`ON_NODE_TYPES`+`NODE_OPS`/runner（`collectOwnOutput`/`computeUpstream`/`RUNNABLE`/`needsRun`/`runOne`）/`sanitizeTemplateNode`。UI 遵守铁律 16/18/19/26。
> - **原则**：零新 IPC 优先——复用 `api:image:generate`/`api:chat:optimize-prompt`/`api:lab:reverse`/`api:comfyui:run-single`/`api:video:*`/`api:upscale:run-single`/`api:interp:run`/`api:gallery:*`/`api:storage:*` 等既有通道；生图产物按画布名自动归组（`params.gallery_group`）。
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

> 主进程主动推送的频道（renderer 通过 `on` 监听）：`chat:chunk` / `chat:done` / `chat:sources` / `image:done` / `image:progress` / `notification:append` / `upscale:progress` / `upscale:done` / `upscale:install-progress` / `ps:file-changed` / `gallery:changed`（2026-06-12：产物自动入库后的轻量广播，无 payload，300ms 去抖；Manager 图库与便携图库监听刷新）/ `mcp:tool-request`（2026-07-12：MCP 画布桥——主进程把智能体的画布类工具调用推给渲染端执行，渲染端经 `api:mcp:respond` 回话，详见 §4.12）。
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

### 4.11 Obsidian 资产库（vault.ts，2026-07-12 加入）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:vault:status` | renderer→main | 库路径与可达性（settings 键 `obsidian_vault_path`） |
| `api:vault:set-config` | renderer→main | 设置库路径（空串 = 清除；目录不存在直接报错，不静默收下） |
| `api:vault:folders` | renderer→main | 库内文件夹列表（相对路径，深度 ≤3；导出时选分类用） |
| `api:vault:search` | renderer→main | 检索 .md（文件名 + 全文，大小写不敏感；query 空 = 最近修改；8000 文件 / 单文件 1MB 扫描护栏） |
| `api:vault:read` | renderer→main | 读单篇笔记（raw 全文 + 剥 frontmatter 的 body） |
| `api:vault:export` | renderer→main | 导出笔记：**全库同名查重**——已有同名 .md 追加「## 补充 · 日期」小节（保留原文），否则在指定文件夹新建（frontmatter：tags / description / 创建日期） |
| `api:vault:open-note` | renderer→main | 在 Obsidian 中打开（`obsidian://open?path=` URI，失败回退系统默认程序） |

> 库 = 用户 Obsidian vault 的**本地文件夹**，主进程直接读写 .md，零 Obsidian 插件/进程依赖。核心 fs 逻辑在 `electron/services/vaultStore.ts`（与 MCP 的 vault_* 工具共用），纯函数（frontmatter 构建 / 追加小节 / 摘要 / 标题清洗）在 `services/vaultNote.ts`（vitest 覆盖）。安全：所有路径 resolve 后必须落在库内（防 `../` 穿越）、只读写 .md、跳过 `.obsidian` 等点开头目录。前端入口：设置 → 存储与系统 →「Obsidian 资产库」（选库文件夹）；智能画布节点右键「存入 Obsidian 库」（`VaultExportDialog`）；画布工具栏「Obsidian」→ `VaultPanel` 中心悬浮窗（检索 / 预览 / 作为提示词节点插入 / 在 Obsidian 打开）。

### 4.12 MCP 服务器（mcp.ts + services/mcp/，2026-07-12 加入）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:mcp:status` | renderer→main | 开关 / 运行态 / 端口 / 是否设 token / 工具数 / 两条接入 URL |
| `api:mcp:set-config` | renderer→main | 保存 `mcp_enabled` / `mcp_port` / `mcp_token` 并对齐运行态（开→启动、关→停止；启动失败自动回滚为关闭并报因） |
| `api:mcp:respond` | renderer→main | **画布桥回话**：渲染端执行完画布类工具后把结果送回主进程（配推送频道 `mcp:tool-request`） |

> 让 Hermes Studio 等支持 MCP 的智能体客户端操作梦笔。`electron/services/mcp/`：`mcpRpc.ts`（纯函数 JSON-RPC 分发：initialize / ping / tools list+call，vitest 覆盖）+ `mcpServer.ts`（node:http 双传输：**Streamable HTTP** `POST /mcp` + **旧版 SSE** `GET /sse` + `POST /messages?sessionId=`；**只绑 127.0.0.1**；可选 Bearer token）+ `mcpTools.ts`（16 个工具）+ `canvasBridge.ts`（pending Map + 20s 超时）。工具两类：**画布类 12 个**（list_node_kinds（复用 agentCatalog）/ list_canvases / create_canvas / open_canvas / read_canvas / add_node / set_node_params / connect_nodes（走 canvasConnectRules 校验）/ delete_node / run_node（runWithUpstream）/ run_all / get_node_status）——画布状态活在渲染进程，主进程推 `mcp:tool-request` → 渲染端 `src/lib/mcpCanvasBridge.ts`（**App 级注册**，铁律 17，与 runner 同款动态 import）执行 → `api:mcp:respond` 回话；**直连类 4 个**（vault_search / vault_read / vault_export / gallery_search 直查 SQLite）。应用启动按 `mcp_enabled` 自动拉起。设置 → 智能化方案 →「MCP 服务器（智能体接入）」。默认**关闭**。

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
| `obsidian_vault_path` | （按需写入） | Obsidian 资产库（vault）根目录；空 = 未连接。画布「存入 Obsidian / Obsidian 库」与 MCP vault_* 工具共用（§4.11） |
| `mcp_enabled` | （按需写入，缺省=关） | `'1'` = 启动 MCP 服务器（Hermes 等智能体接入，§4.12）；应用启动按此自动拉起 |
| `mcp_port` | （按需写入） | MCP 服务器端口，缺省 7642（1024–65535，只绑 127.0.0.1） |
| `mcp_token` | （按需写入） | MCP 访问令牌（可选 Bearer）；空 = 本机免鉴权 |

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
8. **记日志**：本轮改动的「YYYY-MM-DD 做了什么」条目**追加到 `CHANGELOG.md` 末尾**；本文件只在**规范/契约本身变化**时修改对应章节正文，绝不再往本文件里堆日志（2026-07-11 拆分决议）。

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
| `CLAUDE.md` | 本文件，最权威（只放当前有效的规范与契约） |
| `CHANGELOG.md` | 逐日开发变更日志（2026-07-11 从本文件拆出；新日志一律追加到它的末尾） |
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
