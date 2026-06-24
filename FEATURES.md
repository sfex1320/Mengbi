# 功能清单（按优先级分级）

> **优先级定义**
> - **P0**：v1.0 必做，缺一项就不能发版
> - **P1**：v1.0 应做，确实做不完则推迟到 v1.1
> - **P2**：v1.5+ 排期，本次仅在文档中保留位置

> **导航口径（与 `CLAUDE.md` 一致）**：左侧主图标（自上而下，共 6 个顶级入口）= 生图(`/`, Ctrl+1) / 画板(`/canvas`, Ctrl+2) / 图库(`/manager`, Ctrl+3) / ComfyUI 工作流(`/comfyui`, Ctrl+4) / 工具箱(`/tools`, Ctrl+5) / 智能画布(`/smart-canvas`, Ctrl+6)，外加底部设置(`/settings`)。
>
> **已下线的入口**：① 提示词实验室页 `/lab` 已于 2026-06-05 整页下线（页面 + labStore + 侧栏 + 路由全删；`api:lab:reverse`/`translate` 后端保留供智能画布复用）。② 「本地大模型」页已移除。③ `/manager` 的「提示词管家 UI」2026-06-05 下线 → **2026-06-12 复活**（侧栏「图库 / 提示词」双视图切换，见 2.3）。

---

## 零、首次启动与空状态

> 用户第一次打开应用、或没有任何方案 / 对话 / 图片时的引导路径。

### 0.1 首次启动流程

| 优先级 | 功能 |
|--------|------|
| P0 | 启动屏（splash）：1 秒展示 logo + slogan「梦中之笔，绘未来之画」 |
| P0 | 检测到 `api_plans` 表为空 → 跳转引导页（不直接进入 `/`） |
| P0 | 引导页 3 步：① 选择默认主题（材质氛围 + 主题配色） → ② 创建第一个"方案"并填入至少一组对话或绘画模型 → ③ 测试连通性后落库 |
| P0 | 引导完成后默认落到 `/`（生图） |
| P1 | 引导页支持"跳过"，跳过后所有依赖 API 的入口都灰显并提示"请先在设置页配置模型" |

### 0.2 各模块空状态

| 模块 | 空状态描述 | 优先级 |
|------|-----------|------|
| `/` 对话区 | 无任何对话 → 中心居中提示「点击左上角 `+` 开始第一段对话」 | P0 |
| `/` 绘图区 | 当前方案没有绘画模型 → 灰显表单，顶部黄条提示"未配置绘画模型"，点击跳到设置 | P0 |
| `/manager`（图库） | 没有任何图片 → 显示"还没有作品，去[生图](/)创作第一张吧" | P0 |
| `/smart-canvas` | 无任何画布 → 先到「选择画布」启动页（launcher-first），引导新建/打开 | P0 |
| 设置页 | 没有方案 → 默认创建一个"默认方案"，避免空表 | P0 |

### 0.3 数据迁移与版本升级

| 优先级 | 功能 |
|--------|------|
| P1 | 启动时检查 `settings.schema_version`，与代码内 `CURRENT_SCHEMA_VERSION`（当前 = 15）不一致则跑迁移。里程碑：v14 加 ComfyUI 表（`comfyui_workflow_templates` / `comfyui_runs`）；v15 加 `api_configs.video_kind` 列 |
| P1 | 迁移失败时自动备份原 `database.sqlite` 为 `database.sqlite.bak.<timestamp>` 后再重试 |
| P2 | 迁移日志可在设置页查看 |

---

## 一、生图模块（路由 `/`）

### 1.1 对话区
| 优先级 | 功能 |
|--------|------|
| P0 | 多对话管理（新建 / 重命名 / 删除 / 切换） |
| P0 | 上下文记忆（按 conversation 持久化到 SQLite） |
| P0 | 流式输出（SSE → `webContents.send` 逐块到渲染进程） |
| P0 | 模型切换（在当前方案内的对话模型间切换） |
| P1 | 联网搜索后端可切换（额度用完即换）：原生 / DuckDuckGo / 博查 Bocha / 智谱 / Jina / Tavily / Serper / SearXNG / 关闭 |
| P1 | 对话模型属性自动识别（按真实模型 ID 判别多模态 / 思考 / 原生联网，可手动微调） |
| P1 | 快捷优化按钮（"更详细" / "更简洁" / "翻译为英文" / "去除冗余"） |
| P1 | 对话气泡右键 → 「发送到智能画布」（选中文本成提示词节点 / 图片成图片节点） |
| 休眠 | 引用 / 摘录到提示词管家（对话侧入口未恢复；管家页本体已于 2026-06-12 复活，可经智能画布提示词节点入库） |

### 1.2 绘图执行区
| 优先级 | 功能 |
|--------|------|
| P0 | 模型选择（当前方案的绘画模型下拉） |
| P0 | 正向 / 负向提示词输入框（含字符计数） |
| P0 | 尺寸 / 比例选择（1:1、9:16、16:9、3:4、4:3、2:3、3:2、21:9） |
| P0 | 分辨率档位（如 512 / 768 / 1024 / 1536 / 2048） |
| P0 | 1~10 张参考图上传（可分别设置强度、模式） |
| P0 | 实时任务队列（提交 / 等待 / 进行中 / 完成 / 失败） |
| P1 | **参数表单按 `ImageAdapter` 动态派生**：每个适配器声明自己的 `ParamSchema`，UI 只渲染当前模型支持的字段（OpenAI 类只显示尺寸/比例；SD 兼容类额外显示 steps / CFG / sampler / scheduler / seed）。详见 `ARCHITECTURE.md` §X-A5 |
| P1 | AI 自动描述参考图（依赖 `supports_vision`） |
| P1 | 批量生成（同提示词多张 + 多条提示词批量入队） |
| P1 | 任务可暂停 / 取消 / 重排 |
| P2 | 预设保存与加载（`presets` 表） |
| P2 | 内置常用尺寸 / 风格模板 |

---

## 二、图库（路由 `/manager`）

> **2026-06-05 模块调整 → 2026-06-12 复活**：「提示词管家 + 图库」双模式 UI 曾于 2026-06-05 下线（当时只删了模式切换入口，提示词分支与后端通道休眠保留），2026-06-12 按用户要求**复活**：侧栏「图库 / 提示词」segmented 切换，提示词卡片 / 分类 / 编辑 / 删除 / 搜索全部可用。各处「归档到提示词」入口（对话气泡等）未一并恢复——入库走智能画布提示词节点右键「选中入库 / 整段入库」。

### 2.1 提示词分类（左侧栏，**已休眠**——表/通道保留，无 UI 入口）
| 优先级 | 功能 |
|--------|------|
| 休眠 | 五大内置分类：图片提示词 / 视频提示词 / 提问方法 / 文档资料 / 我的收藏 |
| 休眠 | 全部记录视图（跨分类） |
| 休眠 | 用户自建分类 |

> **视频提示词：仅文本管理，不接入视频生成 API**（视频「纯文本管理」保留；真实视频生成另见第八节）。

### 2.2 图片管理（图库主视图）
| 优先级 | 功能 |
|--------|------|
| P0 | 网格视图 + 关键字搜索 |
| P0 | 图片详情面板（提示词 / 参数 / 参考图） |
| P0 | 1~5 星评分、备注、手动标签 |
| P0 | 自动入库（生图完成后写入 `images` 表） |
| P0 | 手动相册（`albums`，type='manual'；靠 `images.album_ids` 成员，图库右键「加入相册」逐张归入；侧栏相册导航 + `AlbumEditModal`，2026-06-05 落地 UI） |
| P0 | 智能相册（`albums`，type='smart'，按 `smart_rules` 实时动态匹配 minRating / tags 全含 / models 任一 / dateFrom~dateTo） |
| P0 | 跨模块「发送到智能画布」（图库图右键 → 推入收件箱跳 `/smart-canvas` 成图片节点；提示词右键 → 成提示词节点）；图库删除经渲染端总线同步剔除智能画布结果 |
| P0 | **视频可播放预览**（2026-06-12）：图库视频卡（生成/导入）点击进统一 Lightbox `<video controls>` 播放；有封面卡加 🎬 角标、无封面用类型图标卡 |
| P0 | **多类型文件收录**（2026-06-12）：「导入文件」按钮批量收录 图片/视频/SVG/PSD/PDF/Office（`api:gallery:import-files`）；图片即刻缩略图、视频导入后抓帧补封面、SVG 原生显示、PSD/PDF/Office 类型图标卡 + 点击系统默认程序打开 |
| P0 | **软件全产物自动入库**（2026-06-12）：插帧 / 视频缩放·补帧 / Real-ESRGAN 放大 / 矢量化 SVG 的产出在主进程产出点统一 `insertProducedMedia` 自动写入图库（引用原位路径不复制、视频抓帧补封面），入库后广播 `gallery:changed`，Manager 与便携图库自动刷新；工具箱结果区相应移除手动「加入图库」（防重复条目） |
| P1 | AI 自动标签（依赖 `supports_vision`） |
| P2 | 图片对比模式（2~4 张并排 + 参数差异高亮） |
| P2 | 瀑布流虚拟滚动（v1.0 用纯网格） |
| P2 | **图片版本历史**：同一 prompt 重复生成时旧图不删、串成版本链；详情面板可切换历史版本（`image_versions` 表，详见 `ARCHITECTURE.md`） |
| P2 | **回收站**：删除图片走软删除（`images.deleted_at` 设为时间戳）；回收站保留 30 天后自动物理删除；可手动还原 |

### 2.3 提示词卡片（提示词管家主体，**2026-06-12 复活**——/manager 侧栏「图库 / 提示词」切换）
| 优先级 | 功能 |
|--------|------|
| P0 | 卡片网格展示（标题 + 摘要 + 标签）+ 分类侧栏（内置 image/video/qa/doc/favorite + 自定义） |
| P0 | 新增 / 编辑 / 删除（软删除）/ 一键复制 / 一键填入生图 / 发送到智能画布 |
| P0 | 标签筛选 + 关键字搜索 |
| P0 | 与智能画布提示词库弹窗（`PromptPickerDialog`）、提示词节点「选中入库 / 整段入库」共用同一套 `api:prompt:*` 通道 |
| 休眠 | 关联图片（多对多）、提示词版本历史 |
| P2 | **回收站**：删除提示词卡片走软删除（`prompts.deleted_at`），30 天保留 |

---

## 三、提示词实验室（路由 `/lab`，**整页已下线**）

> **2026-06-05 整页下线**：删除页面 + labStore + 侧栏入口 + 路由。原计划的 拆解 / 多模型对比 / 融合 已于此前移除，不再复活。
>
> **后端保留为共享服务**：`electron/ipc/lab.ts` 的 `api:lab:reverse`（单图 / 多图反推）与 `api:lab:translate`（中英互译）handler 仍在——智能画布的 **LLM 节点 / 图像反推 / 视频反推**复用 `api:lab:reverse`。`translate` / `history` 暂无 UI 入口（休眠）。

---

## 三 .B 画板（路由 `/canvas`，Ctrl+2）

把多张素材在一张画布上预编辑（拼版 / 透视 / 抠背景 / 混合 / 局部重绘 / 扩图），导出 PNG/JPG/WebP 作"参考图 / 垫图"送进生图页。模块能力**绝大多数在渲染端**，不走 IPC；唯一例外是 **Photoshop 联动**（`api:ps:*`，须落盘临时文件 + `fs.watchFile` 监听 PS 保存，见 4.4）。

| 优先级 | 功能 |
|--------|------|
| P0 | 图层类型：图像 / 文本 / 矩形 / 椭圆 / 笔刷 / 组容器 |
| P0 | 多图层管理（增 / 删 / 复制 / 显隐 / 锁定 / 重命名 / 拖拽重排 / 多选 Shift+click / 组合 Ctrl+G） |
| P0 | 仿射变换：拖动 / 缩放 / 旋转 / 倾斜（Konva.Transformer 8 把手）+ 水平 / 垂直翻转 |
| P0 | 不透明度 + 16 种混合模式（正常 / 正片叠底 / 滤色 / 叠加 / 柔光 ...） |
| P0 | 四角透视扭曲（拖角 → 实时变形 → 应用后烘焙） |
| P0 | 裁切（可调矩形 + 8 把手 + 重置） |
| P0 | 抠除背景（`@imgly/background-removal`，本地 onnx 推理，离线；可拆分输出主体 + 背景 + 主体蒙版） |
| P0 | 调整：亮度 / 对比度 / 饱和度 / 色相 / 色温 / 曝光 / 锐化 / 模糊 / 降噪 / 黑白 / 反色 + 7 个预设（产品增强 / 效果图真实化 / 室内提亮 / 海报增强 / 去灰 / 背景虚化 / 局部锐化），算法在 `canvasEngine/adjust.ts`，预览与导出共用同一份像素算法 |
| P0 | 显示蒙版（非破坏性）：画笔涂抹白 = 显示，黑 / 橡皮 = 隐藏 |
| P0 | 局部重绘蒙版（inpaint）：统一规则白 = AI 处理区 / 黑 = 保持；画笔 / 擦除 / 反选 / 填充 / 羽化 / 扩展 / 收缩 / 黑白 PNG 导入导出（`canvasEngine/maskEngine.ts`）；选区（矩形 / 椭圆 / 套索）折叠进蒙版系统 |
| P0 | 扩图（outpaint）：`OutpaintDialog`（方向 px / 9 档比例 / 九宫格锚点）+ 拖动画布边界两条入口；扩图后自动生成扩图蒙版（新区 = 白） |
| P0 | 局部重绘工作流：当前画布合成底图 + 蒙版 → `api:image:generate` → 结果默认作新图层叠加，原图不破坏 |
| P0 | AI 功能入口 `AIActionPanel`（✦ AI）：图生图 / 局部重绘 / 扩图 / 高清放大 / 去背景 / 换背景 / 风格迁移 / 图片转矢量 / 线稿提取 / 颜色增强 / 细节增强 / 真实化 / 文字修复 / Logo 修复 共 14 项，AI 结果默认作新图层 |
| P0 | 参考图面板 `ReferencePanel`（🖻）：8 类型（风格 / 结构 / 人物 / 产品 / Logo / 材质 / 构图 / 颜色）+ 权重 + 启用 + 图生图 / 重绘 / 仅视觉标志 |
| P0 | 命名快照 `snapshotStore`（手动 + 局部重绘 / 发送 PS / 导入 PS 前自动），可回到任意一步 |
| P1 | Photoshop 联动（`api:ps:*`）：把画布 PNG 送 PS 编辑 → `fs.watchFile` 监听保存 → 按偏好自动 / 确认导回（新图层 / 替换当前图层 / 新建画布）。第一阶段仅 PNG 往返 |
| P0 | 笔刷涂抹 + 颜色选择器（HSV + RGB + Hex + 最近用色历史） |
| P0 | 工具栏：选择 (V) / 抓手 (H, Space 临时) / 画笔 (B) / 橡皮 (E)；中键拖动 = 抓手 |
| P0 | 视图：Z 适合屏幕 / Ctrl+0 100% / Ctrl+± / 滚轮缩放（光标为锚）/ 拖拽平移 |
| P0 | 状态栏（工具 / 缩放 / 鼠标坐标 / 选中图层信息）+ 顶部 + 左侧标尺 |
| P0 | 对齐辅助线 + 自动吸附（画布中心 / 边缘 / 其它图层边缘） |
| P0 | 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z，内存栈 30 步） |
| P0 | 替换图层来源（保留 transform，只换原图） |
| P0 | 导出对话框：PNG / JPG / WebP + 质量滑块 → 磁盘 / 生图页参考图 |
| P0 | 工程文件 `.mengbi-canvas`（v2：JSON + 内嵌图片 dataUri + inpaint 蒙版 + 参考图，跨设备可迁移） |
| P0 | 生图页参考图 ⊞ 一键导入画板编辑 |
| P0 | 默认快捷键：A1 Delete 删除 / A2 方向键 ±1px（Shift ±10px）/ A3 Ctrl+J 复制 / A5 拖动吸附 / Ctrl+A 全选 / Shift+[ ] 笔刷大小 |
| P1 | 多工程管理 UI（最近项目列表） |

> **依赖**：`konva` ~ 9.x、`react-konva` ~ 18.x、`@imgly/background-removal` ~ 1.7。前两者打包 ~600KB（gz），抠图模型走 onnxruntime-web 动态加载，首次抠图才会拉。
> **画板尺寸上限**：4096 × 4096（覆盖 4K + 主流绘图模型上限；8192 在多层混合模式下 toBlob 易卡死）。
> **持久化**：当前唯一画板自动写入 localStorage（key: `mengbi-canvas`）。`cookedDataUri`（抠图 / 透视烘焙后的中间图）**不持久化**，重启后丢失，回退到原图。要永久保存请用 `.mengbi-canvas` 工程文件。

---

## 四、ComfyUI 工作流编排器（路由 `/comfyui`，Ctrl+4）

> 连接本地 ComfyUI、导入 API workflow、可视化绑定、批量循环的完整外部控制器。**与**生图页方案配置里的 `image_kind='comfyui'`（内联「一键直跑」）并存，是有意保留的双轨（一键 vs 深度编排），不要合并。分 6 阶段交付，**第一阶段已落地**（连接 + 导入 + 单次执行 + 取回图片）。

| 优先级 | 功能 |
|--------|------|
| P0 | 连接：读写 host / 启动命令 / 目录 / token（token 经 safeStorage 加密）；探活（GET /system_stats 以可达为准） |
| P0 | **选 ComfyUI 文件夹自动识别启动方式**（`api:comfyui:scan-launch`，纯读目录 + .bat 文本不执行）：识别便携包 `run_*.bat` / `python_embeded` / `venv` / 裸 `main.py`，一键回填命令 / 目录 / 地址 |
| P0 | 按用户命令在用户目录 spawn 启动 ComfyUI 并轮询就绪 / 停止 |
| P0 | 导入并校验 API 格式 workflow（UI 格式 → 提示导出 API Format） |
| P0 | 单次运行入串行队列（concurrency=1）+ 取消 + 队列状态 + 取回图片 |
| P0 | 进度优先走 `ws://host/ws`（实时 per-node + 队列），失败回退 `/history` 轮询 |
| P1 | 工作流模板 CRUD（`comfyui_workflow_templates` 表，保留原始 JSON + 控件 + 绑定 + loop + ui_layout） |
| P1 | 运行记录 `comfyui_runs` 表；输出右键「发送到智能画布」 |
| P1 | 节点图（`@xyflow/react`）+ 参数绑定 + 文件上传 + 输出绑定（P2~P3 阶段） |
| P1 | 批量公式循环（安全无 eval，走 `expr-eval`，P5 阶段） |

> **架构铁律**：不写死 node_id；不限工作流类型 / 自定义节点；参考图不写死单张；输出不写死 SaveImage；每次运行 `structuredClone` 原始 workflow，绝不污染模板。

---

## 五、工具箱（路由 `/tools`，Ctrl+5）

> 本地处理（不调外部生图 API），两段完全分离的引擎：保真放大 / 图像转矢量。**SUPIR 放大已于 2026-05-29 整体砍除**（显存 25-30GB 带不动）；**HYPIR AI 修复放大已整体砍除**；**OmniSVG AI 矢量化已于 2026-05-27 整体砍除**（VLM 生成式 SVG 不可用）。

### 5.1 Real-ESRGAN 保真放大（默认，`api:upscale:*`）
| 优先级 | 功能 |
|--------|------|
| P0 | 引擎在线安装 / 卸载（zip 解压到 `userData/engines/realesrgan/`，GitHub + 国内镜像源，进度推 `upscale:install-progress`） |
| P0 | 模型单独下载 / 删除（`realesrgan-x4plus` / `-x4plus-anime` / `realesrnet-x4plus` / `realesr-animevideov3`） |
| P0 | 单图放大（dataUri/path → 落盘 + 回读 dataUri，进度推 `upscale:progress`）+ 批量（串行避免 Vulkan 显存抖动）+ 按 taskId 取消 |

> 调外部 `realesrgan-ncnn-vulkan`，stderr 解析 `XX.XX%` 进度；不进 Python / PyTorch；支持 2x/3x/4x、PNG/JPG/WebP。

### 5.2 图像转矢量（CPU 本地，`api:vec:*`）
| 优先级 | 功能 |
|--------|------|
| P0 | Fast 模式：VTracer（`@neplex/vectorizer`，Rust CPU 彩色矢量化，适合 logo / 美陈） |
| P0 | Crisp 模式：Potrace（`potrace` npm，纯 JS CPU 单色矢量化，适合线稿）——UI 让用户明确选，不自动判断 |
| P0 | 批量（`outputDir` / `naming` / `onConflict`）+ 暂停 / 恢复 / 取消 + 历史表 `vectorize_history`（SVG 不进图库） |

### 5.3 通用工具（`api:tools:*`）
| 优先级 | 功能 |
|--------|------|
| P0 | 产出落盘到 `tools_storage_path`（`api:tools:save-output`） + 入库（`api:gallery:import-from-buffer`） |
| P0 | 结果右键「发送到智能画布」 |

---

## 六、智能画布（路由 `/smart-canvas`，Ctrl+6）

> 基于 `@xyflow/react`（React Flow v12）的 AI 创作节点图，是独立节点编排模块。**不含任何 Claude Code / 命令执行**。所有节点复用现有 IPC 通道，极少数例外（视频缩放 `api:video:scale`；文件夹批量 `api:storage:list-images` / `api:storage:copy-into`）。

### 6.1 节点种类（共 23 类，`SmartNodeKind`）
| 类别 | 节点 |
|------|------|
| 输入 / 素材 | `image` 图片 / `folder-input` 文件夹输入 / `prompt` 提示词 / `text` 文字 / `video-source` 视频上传 |
| 文本 / 分析 | `llm` LLM / `character` 角色设计 / `storyboard` 智能分镜 / `image-reverse` 图像反推 / `angle-prompt` 视角 / `light` 光源 / `ratio` 尺寸来源 / `video-reverse` 视频反推 |
| 处理 / 控制 / 生成 | `scale` 缩放 / `frame-interp` 插帧（本地 RIFE AI 插帧 24→60fps，引擎按需下载 ~40MB）/ `loop` 循环 / `work` 生图 / `comfy` ComfyUI / `video` 视频 |
| 输出 / 容器 | `result` 结果 / `folder-output` 文件夹输出 / `compare` 对比 / `group` 分组 |

### 6.2 节点能力
| 优先级 | 功能 |
|--------|------|
| P0 | 生图（work）节点 provider 两档：`mengbi`（复用 `api:image:generate` / `api:upscale:run-single`，family 自适应比例 / 分辨率 / 质量 + 真实 batch/loop + seed + 负向提示词）/ `mock`（可配延迟 / 错误率） |
| P0 | LLM 节点（优化提示词 / 翻译 / 扩写 / 细节分解 / 对话完善 / 图片反推）复用 `api:chat:optimize-prompt` + `api:lab:reverse`，输出文本喂下游 |
| P0 | ComfyUI 节点（整个工作流当黑盒）复用 `api:comfyui:run-single` + `template:get`；画布里只做输入 / 输出拆分 |
| P0 | 图像反推 / 视频反推复用 `api:lab:reverse`（须选支持识图的多模态 text 模型）；视频反推在渲染端均匀抽帧（`lib/videoPoster.ts captureVideoFrames`）后多图反推 |
| P0 | 缩放节点：接图走 canvas 实时缩放；接视频走 ffmpeg 重编码（`api:video:scale`，可选 minterpolate 补帧） |
| P0 | 插帧节点：接视频 → 本地 rife-ncnn-vulkan AI 运动插帧到 30/48/60fps（`api:interp:*`，ffmpeg 拆帧→RIFE→合帧带回音轨；卡上一键装引擎 + 三阶段进度 + 可取消） |
| P0 | 视角 / 光源节点：接图 → 输出中文提示词喂下游（不直接生图） |
| P0 | 结果节点 = 累积集合（内存态、不进文档、重启清空；每节点上限 100 FIFO）；支持图 / 文本 / 视频展示 + 拖出成节点 + 「作参考图」发回生图页 / 另存 |
| P0 | 对比节点：接两张图，可拖动 wipe 分隔线对比，纯查看不输出 |
| P0 | 分组节点：容器化（拖节点进框自动归入 parentId，整组作下游输入），可折叠 |
| P0 | 角色设计节点：精简卡片 + **「角色工作台」弹窗（游戏捏脸式三栏）**——左=捏人分类 tab + 预置 chips 点选（含「主体类型」，人物/动物/拟人/机甲/产品均可）、中=大号 3D 结构预览（纯 CSS 拖拽旋转，零成本）+ 实时草稿、右=设定与产出；LLM 合成十段「角色资产」（可锁定 / 多版本；上游提示词覆盖描述、分析模型与合成模型分离）→ 喂分镜（角色一一对应）/ 生图 / 视频；「形式提示词」即时生成（三视图 / 角度 / 动作 / 表情 / 服装 / 配饰 / 场景——场景有预置，出图交给下游生图节点，不在节点内烧 API） |
| P0 | 智能分镜节点：精简卡片 + **「分镜工作台」弹窗**（约束/故事/分镜与转场列表全在弹窗）——素材（文本 + 参考图分析 + 角色资产）→ 完整故事 → N 条**电影级**分镜（场景/人物动作/事件/运镜/细节五字段，每条复述固定元素）+ **N-1 条镜头转场提示词**（运动轨迹/运镜衔接/场景过渡/主体延续，可单独重生）；双输出口：右上=分镜、右下=转场；固定约束段由代码拼入每条（一致性不靠模型自觉） |
| P0 | ComfyUI 节点多输入运行方式：单次（合并分发）/ 逐条提示词执行 / 逐张图执行；逐条失败跳过继续，结果按批次聚合合集卡、可单条重试；**输入绑定**：每个文本/图片输入槽可指定收「上游第 N 条提示词 / 第 M 张图 / 全部图 / 不接收」（缺省自动按序分发） |
| P0 | 循环节点：固定次数 / 数值范围 / 提示词列表 / 尺寸列表 / 文件夹图片 → 逐项驱动下游 生图/ComfyUI/视频；暂停 / 继续 / 停止 / 跳过 / 从指定项继续 |
| P0 | 文件夹批量：文件夹输入节点（扫描整夹图片作多图来源）+ 文件夹输出节点（上游每出一张结果自动落盘，命名规则可选，失败不中断） |
| P0 | 上游媒体通道 `computeUpstream` 返回 `{images, prompts, refs, videos, sizes}`；连线类型校验 `canConnectKinds` |

### 6.3 画布操作
| 优先级 | 功能 |
|--------|------|
| P0 | 多文档（launcher-first 启动页 `CanvasLauncher` + 工具栏画布菜单切换；localStorage 持久化每张画布；500ms 去抖写回；旧单文档自动迁移） |
| P0 | 创建：工具栏点选类型 → 点画布落位；拖出连线落空白 / 双击 → 快捷创建菜单（自动连线）；连线中点 × 钮删除 |
| P0 | 排布：网格 / 按类型分组 / 对齐选中 / 横纵均分 / 智能排布（按连线走向分层、上游左 → 下游右、减交叉） |
| P0 | 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z，上限 50）+ 复制 / 粘贴 / 再制（Ctrl+C/V/D，跨文档剪贴板）+ 系统剪贴板粘贴建节点 |
| P0 | 运行全部（拓扑序串行）+ 进度 N/total + 停止；在途任务跨文档不丢（按 docId 回灌 `patchDocNodes`） |
| P0 | 节点搜索（Ctrl+F 居中高亮 + dim 筛选）+ 网格吸附 + 对齐参考线 + 方向键微调 |
| P0 | 跨模块「发送到智能画布」（图库 / 生图结果 / 工具箱结果 / ComfyUI 输出 / 画板图层）落当前视图正中心 |
| P0 | 右下角小地图（MiniMap）按节点类型上色；右侧浮动 / 钉住属性面板；生图节点横向控制台；连线流动着色（`themeStore.flowColor`） |
| P1 | 节点模板（存选区 / 一键插入）+ 运行日志导出（复用 `api:storage:save-as`）+ 批量导出 / 导入画布（`.json` bundle） |

---

## 七、视频生成（2026-06-07 接入，端到端可用）

> 「v1.0 不做视频生成」的旧铁律已解除。视频生成走**异步**「提交任务 → 轮询状态 → 下载 mp4 落盘 → 入图库」。视频提示词的「纯文本管理」仍保留（图库不变）。

### 7.1 配置与引擎
| 优先级 | 功能 |
|--------|------|
| P0 | 配置：`api_configs.type='video'` + `video_kind` ∈ kling / sora / unified / seedance / custom / veo / runway / fal |
| P0 | 引擎双轨：kling / sora / unified 走 `electron/ipc/video.ts` 内置 legacy 引擎；seedance / custom / veo / runway / fal 走 `electron/services/video/` 适配器（`VideoProviderAdapter` 接口 + registry） |
| P0 | IPC：`api:video:generate` / `cancel` / `upload-asset` / `save-thumbnail` / `scale`；push 通道 `video:progress` / `video:done` |
| P0 | 配置中心：settings 表 `video_providers_json`（端点 / 能力 capabilities / 限制 limits / 默认参数 / 费用阈值），设置页 `VideoProvidersCenter` 可视化编辑 + 导入模板 + 本地连接检查（不烧钱）+ 历史查看 |
| P0 | 共享层 `@shared/video`（`VideoGenerationRequest` / `VideoTask` / 7 种模式 + `validateVideoRequest` / `estimateVideoCost`）+ `@shared/videoProviders` |

### 7.2 智能画布「视频」节点（真实生成，非 mock）
| 优先级 | 功能 |
|--------|------|
| P0 | 7 种模式按能力自适应显隐（文生 / 图生 / 首尾帧 / 参考图·视频·音频 / 连续）+ 费用预估 + dry-run 校验 + 高费用二次确认 + 一键降本 |
| P0 | 批量生成（仅配置中心开启时，始终二次确认显示总费用）+ 连续生成（末帧 → 下一段首帧） |
| P0 | 素材上传（参考视频 / 音频走 `api:video:upload-asset`，无端点引导用公网 URL） |
| P0 | 图库视频封面：渲染端抓首帧 webp（免 ffmpeg），仅对新生成且抓帧成功者生效 |

---

## 七 .B 本地 LLM（`api:llm:*`，开发中）

> 基于 `node-llama-cpp` 的内嵌本地推理服务（`electron/services/localLlmServer.ts`）。**不暴露 start**——启动由 chat handler 内部按需 lazy 完成。

| 优先级 | 功能 |
|--------|------|
| P1 | `api:llm:status`（查询是否在跑 / 跑哪个模型）+ `api:llm:stop`（停止服务释放显存 / 内存） |
| P2 | 模型选择 / 推理参数面板（temperature / top_p / max_tokens）/ 缓存策略（**开发中**，未实现） |

---

## 八、设置（顶部入口或快捷键）

### 8.1 模型方案
| 优先级 | 功能 |
|--------|------|
| P0 | 创建 / 重命名 / 删除"方案"（`api_plans` 表） |
| P0 | 方案下添加多个绘画模型配置（`type='image'`，含绘图 API 协议 `image_kind`：openai / grsai / gemini / openai-compat / comfyui） |
| P0 | 方案下添加多个对话模型配置（`type='text'`，含 `supports_vision`、`supports_web_search` 开关 + 官方类型 Kimi / MiniMax / GLM / DeepSeek） |
| P0 | 方案下添加多个**视频模型**配置（`type='video'`，含视频 API 协议 `video_kind`：kling / sora / unified / seedance / custom / veo / runway / fal） |
| P0 | 每条配置：中转站名、Base URL、API Key（加密）、模型映射（显示名 → 实际模型 ID） |
| P0 | ComfyUI workflow JSON（仅 `image_kind='comfyui'`，粘贴 API Format 导出，运行时占位符替换 `{{prompt}}` 等） |
| P0 | 一键测试连通性（`api:settings:test-connection`） |
| P0 | 绘画模型 per-方案"请求体覆盖（高级）"JSON 模板（`body_overrides_json`），与默认 body 顶层合并发出，`null` 值删字段，支持 `${model}` `${prompt}` `${size}` 等占位（绕过中转站字段差异，详见 CLAUDE.md §13） |
| P1 | 方案快速切换（顶部下拉 / 快捷键）；激活方案持久化（`settings.active_plan_id`） |
| P1 | 所有配置导出 / 导入（`electron/ipc/configIO.ts`：方案 + API Key + 外观 + 设置 + 提示词，AES-256-GCM 加密） |

> **图像模型「系列(family)」一等公民**（`src/types/imageModelFamilies.ts`，5 个 family：gpt-image-2 / nano-banana-pro / nano-banana-flash / nano-banana-2 / default）：`buildBody` 只发该 family 真正识别的字段，解决"选 4K 实际出 1K"。生图面板可手动「系列覆盖」。

### 8.2 外观
| 优先级 | 功能 |
|--------|------|
| P0 | 材质氛围切换（10 种，详见 `THEMING.md`） |
| P0 | 主题配色切换（10 种） |
| P0 | 界面缩放（`themeStore.appZoom`，滑块 + Ctrl+= / - / 0，持久化 localStorage `mengbi-theme`，preload webFrame 套用） |
| P0 | 智能画布连线流动色（`themeStore.flowColor`，默认跟随 accent） |
| P1 | 用户自定义主题保存（`themes` 表） |
| P2 | 浅色氛围（v1.5+） |

### 8.3 视频供应商配置中心
| 优先级 | 功能 |
|--------|------|
| P0 | `VideoProvidersCenter`：端点 / 能力 / 限制 / 默认参数可视化编辑 + 导入内置模板 + 恢复默认 + 本地连接检查（不烧钱）+ 费用阈值 + 任务历史查看 |

### 8.4 存储与系统
| 优先级 | 功能 |
|--------|------|
| P0 | 自定义图片存储路径（`api:storage:select`） + 工具箱输出路径 `tools_storage_path` |
| P0 | 数据库导出 / 备份 |
| P1 | 自定义快捷键 |
| P1 | 自动更新开关（`electron-updater`） |
| P1 | Photoshop 联动配置（`api:ps:set-config`：`photoshop_path` / `ps_temp_dir` / `ps_keep_temp`） |
| P2 | 数据库导入 / 还原 |

---

## 九、系统级体验

| 优先级 | 功能 |
|--------|------|
| P0 | 通知中心：图片 / 视频 / 工具任务完成推 `notification:append` |
| P1 | 托盘常驻 + 任务进度角标 |
| P1 | 全局快捷键（默认绑定 + 用户可改，详见第六节） |
| P2 | 迷你悬浮窗（快速生图） |
| P2 | 作品卡片导出 PNG（图片 + 提示词 + 水印） |
| P2 | 项目包导出 / 导入（`.mengbi` 包，含图 + 提示词 + 设置；格式见 `ARCHITECTURE.md`） |
| P2 | **用量与成本追踪**：每次 API 调用记录 prompt tokens / completion tokens / 图片张数与成本估算（按用户在配置里填入的"单价"换算）；设置页提供"本月用量"看板与导出 CSV |

---

## 十、默认快捷键

> 全部支持自定义。下表为出厂绑定，与系统常用快捷键不冲突。Windows / Linux 用 `Ctrl`，macOS 用 `Cmd`（下表统一记作 `⌃/⌘`）。

| 快捷键 | 作用 | 范围 |
|--------|------|------|
| `⌃/⌘ + N` | 新建对话（在 `/` 下） | 仅生图页 |
| `⌃/⌘ + Enter` | 提交对话 / 提交生图 | 焦点在输入框 |
| `Esc` | **取消当前流式响应**（详见 `ARCHITECTURE.md` §B5） | 全局 |
| `⌃/⌘ + K` | 打开命令面板（v1.1 起） | 全局 |
| `⌃/⌘ + ,` | 打开设置 | 全局 |
| `⌃/⌘ + 1` | 跳到 `/`（生图） | 全局 |
| `⌃/⌘ + 2` | 跳到 `/canvas`（画板） | 全局 |
| `⌃/⌘ + 3` | 跳到 `/manager`（图库） | 全局 |
| `⌃/⌘ + 4` | 跳到 `/comfyui`（ComfyUI 工作流） | 全局 |
| `⌃/⌘ + 5` | 跳到 `/tools`（工具箱） | 全局 |
| `⌃/⌘ + 6` | 跳到 `/smart-canvas`（智能画布） | 全局 |
| `⌃/⌘ + = / - / 0` | 界面缩放 放大 / 缩小 / 复位（`/canvas` 页放行给画布自身缩放） | 全局 |
| `⌃/⌘ + Z` / `⌃/⌘ + Shift + Z` | 撤销 / 重做（画板 30 步 / 智能画布上限 50） | 画板 / 智能画布页 |
| `⌃/⌘ + C / V / D` | 复制 / 粘贴 / 再制节点 | 仅智能画布页 |
| `⌃/⌘ + F` | 节点搜索（居中高亮） | 仅智能画布页 |
| `V` / `H` / `B` / `E` | 选择 / 抓手 / 画笔 / 橡皮 | 仅画板页 |
| `Z` / `⌃/⌘ + 0` / `⌃/⌘ ±` | 适合屏幕 / 100% / 缩放 | 仅画板页 |
| `Space` 长按 | 临时切换为抓手（鼠标中键拖动同效） | 仅画板页 |
| 方向键（Shift = 10px） | 移动选中图层 | 仅画板页 |
| `Delete` / `Backspace` | 删除选中图层（支持多选） | 仅画板页 |
| `⌃/⌘ + J` | 复制选中图层 | 仅画板页 |
| `⌃/⌘ + A` | 全选所有图层 | 仅画板页 |
| `⌃/⌘ + G` | 组合所选 | 仅画板页 |
| `[` / `]` / `Shift + [ ]` | 笔刷大小 ±2 / ±10 | 仅画板页 |
| `⌃/⌘ + Shift + T` | 切换主题面板 | 全局 |
| `⌃/⌘ + Shift + L` | 切换日志级别（dev 模式） | dev 全局 |
| `Delete` / `Backspace` | 在选中图片 / 卡片时移入回收站 | 列表页 |
| `Space` | 在图库选中图片时打开预览 | 图库 |

> 用户改动后的绑定写入 `settings` 表的 `keybindings_json` 键。冲突检测在保存时执行（不允许两条相同绑定）。

---

## 十一、版本规划

| 版本 | 主要内容 |
|------|---------|
| **v1.0** | 所有 P0 + 主要 P1（含智能画布、ComfyUI 编排器、工具箱、相册、视频生成端到端） |
| **v1.1** | 剩余 P1 + 用户反馈最强烈的 P2 |
| **v1.5** | 大部分 P2、浅色氛围、迷你悬浮窗、瀑布流虚拟滚动、本地 LLM 模型选择 / 参数面板 |
| **v2.0** | i18n、协作 / 插件运行时等架构级扩展 |

> 视频生成已于 2026-06-07 接入（端到端可用），不再作为 v2.0 待办。

> 详细 Phase 排期见 `DEVELOPMENT.md`。
