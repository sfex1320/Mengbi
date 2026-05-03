# Google Gemini 图像生成模型配置手册（Nano Banana 系列）

> 来源：Google AI / Gemini Developer API 官方文档
> 文档版本：v1.1（2026-05-03）
> 适用模型：Nano Banana、Nano Banana Pro、Nano Banana 2

---

## 一、模型列表

| 模型显示名 | 模型 ID | 最高分辨率 | 比例可控 | 速度 | 定位 |
|-----------|---------|-----------|----------|------|------|
| **Nano Banana** | `gemini-2.5-flash-image` | 1024 px（固定） | ❌ 不可调 | 极快 | 快速个性化出图 |
| **Nano Banana Pro** | `gemini-3-pro-image-preview` | 4K（4096 px） | ✅ `aspect_ratio` | 中等 | 高质量、专业素材 |
| **Nano Banana 2** | `nano-banana-2` | 4K（4096 px） | ✅ `aspect_ratio` + `image_size` | 快 | Pro 画质 + Flash 速度 |

> **分辨率档位（仅 `nano-banana-2` 支持显式 `image_size`）**
> - `1K` ≈ 1024 px
> - `2K` ≈ 2048 px
> - `4K` ≈ 4096 px

---

## 二、尺寸、分辨率与比例

### 2.1 各模型支持矩阵

| 模型 | `aspect_ratio` | `image_size` | 最大像素 | 备注 |
|------|----------------|--------------|----------|------|
| `gemini-2.5-flash-image` | ❌ 忽略 | ❌ 忽略 | ~1 MP | 固定 1024×1024 输出 |
| `gemini-3-pro-image-preview` | ✅ | ❌（自动选择） | ~16 MP | 由 prompt + ratio 推断尺寸 |
| `nano-banana-2` | ✅ | ✅ | ~16 MP | **二者择一**，详见 2.3 |

### 2.2 支持的比例（`aspect_ratio`）

适用于 `gemini-3-pro-image-preview` 与 `nano-banana-2`：

| 比例 | 方向 | 典型用途 |
|------|------|----------|
| `1:1` | 正方形 | 头像、Logo |
| `4:5` | 竖版 | Instagram 贴文 |
| `5:4` | 横版 | 横版社媒 |
| `3:4` | 竖版 | 海报、印刷 |
| `4:3` | 横版 | 传统屏幕、相机 |
| `2:3` | 竖版 | 杂志、海报 |
| `3:2` | 横版 | 单反照片 |
| `9:16` | 竖版 | 短视频、手机壁纸 |
| `16:9` | 横版 | YouTube 封面、电脑壁纸 |
| `21:9` | 超宽横版 | 影视、超宽 banner |

### 2.3 ⚠️ `aspect_ratio` 与 `image_size` 互斥规则

仅 `nano-banana-2` 同时支持这两个参数，但**两者不能同时传**：

- 只传 `aspect_ratio` → 模型按比例自动选择合适尺寸
- 只传 `image_size`（`1K` / `2K` / `4K`）→ 使用对应分辨率档位
- 同时传入 → 行为未定义，部分中转站会报错或忽略其一

### 2.4 分辨率与用途推荐

| 用途 | 比例 | 建议档位 (`image_size`) |
|------|------|------------------------|
| 社媒头像 | `1:1` | `1K` 或 `2K` |
| Instagram 竖版贴文 | `4:5` | `2K` |
| 短视频封面 | `9:16` | `2K` 或 `4K` |
| YouTube 横版封面 | `16:9` | `2K` 或 `4K` |
| 海报 / 印刷品 | `3:4` 或 `2:3` | `4K` |
| 影视级超宽屏 | `21:9` | `4K` |

---

## 三、质量配置

Gemini 图像系列**没有显式 `quality` 参数**，画质由"模型选择 + 分辨率档位"两层共同决定：

| 目标 | 推荐组合 |
|------|----------|
| 极速预览 / 草稿 | `gemini-2.5-flash-image`（固定 1024 px） |
| 速度 + 质量平衡 | `nano-banana-2` + `image_size=2K` |
| 终稿 / 大图印刷 | `nano-banana-2` + `image_size=4K` |
| 专业素材 | `gemini-3-pro-image-preview` + `aspect_ratio` |

---

## 四、API 接入

### 4.1 基本信息

| 项目 | 说明 |
|------|------|
| 协议 | OpenAI 兼容 REST API |
| 认证 | `Authorization: Bearer <API_KEY>` |
| 请求 Content-Type | `application/json`（编辑接口为 `multipart/form-data`） |
| 图片生成 | `POST /v1/images/generations` |
| 图片编辑（img2img） | `POST /v1/images/edits` |

### 4.2 请求头

```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
Accept: application/json
```

### 4.3 请求参数

| 参数 | 类型 | 必需 | 适用模型 | 说明 |
|------|------|------|----------|------|
| `model` | string | ✅ | 全部 | 模型 ID，见第一节 |
| `prompt` | string | ✅ | 全部 | 图像描述，越具体越好 |
| `aspect_ratio` | string | ⬜ | Pro / Banana 2 | 见 2.2 支持比例；与 `image_size` 互斥 |
| `image_size` | string | ⬜ | **仅 Banana 2** | `1K` / `2K` / `4K`；与 `aspect_ratio` 互斥 |
| `response_format` | string | ⬜ | 全部 | `url`（推荐）/ `b64_json` |
| `n` | — | ❌ | 全部 | **不支持**，每次固定生成 1 张 |

### 4.4 调用示例

#### Nano Banana 2（推荐，国内中转站常用）

```bash
curl -X POST 'https://your-gemini-proxy/v1/images/generations' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "nano-banana-2",
    "prompt": "A beautiful bride in white wedding dress, crystal chandeliers, grand hall",
    "aspect_ratio": "9:16",
    "response_format": "url"
  }'
```

> 如需固定 4K 输出，将 `aspect_ratio` 替换为 `"image_size": "4K"`（二选一）。

#### Nano Banana Pro（`gemini-3-pro-image-preview`）

```bash
curl -X POST 'https://your-gemini-proxy/v1/images/generations' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemini-3-pro-image-preview",
    "prompt": "Modern minimalist logo design for tech startup",
    "aspect_ratio": "1:1",
    "response_format": "url"
  }'
```

#### Nano Banana（`gemini-2.5-flash-image`，固定 1024 px）

```bash
curl -X POST 'https://your-gemini-proxy/v1/images/generations' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemini-2.5-flash-image",
    "prompt": "A cute cat in space suit",
    "response_format": "url"
  }'
```

> ⚠️ 此模型忽略 `aspect_ratio` / `image_size`，始终输出 1024×1024。

#### 图片编辑（img2img）

```bash
curl -X POST 'https://your-gemini-proxy/v1/images/edits' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -F 'image=@/path/to/image.png' \
  -F 'prompt=Add a sunset background, keep the foreground unchanged' \
  -F 'model=nano-banana-2' \
  -F 'aspect_ratio=16:9'
```

### 4.5 响应格式

```json
{
  "created": 1777744575,
  "data": [
    { "url": "https://cdn.example.com/image.png" }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `created` | Unix 时间戳 |
| `data[0].url` | 临时 URL，需要尽快下载落盘 |
| `data[0].b64_json` | Base64 数据（当 `response_format=b64_json`） |

> 国内中转环境下，`b64_json` 大响应可能不稳定，**统一推荐 `url`**。

---

## 五、中转站参数对照表

| 中转站常见字段 | Gemini 实际参数 | 说明 |
|----------------|-----------------|------|
| `model` | `model` | `nano-banana-2` / `gemini-3-pro-image-preview` 等 |
| `prompt` | `prompt` | 文本描述 |
| `ratio` / `aspect_ratio` | `aspect_ratio` | `1:1` / `9:16` / `16:9` 等 |
| `size` / `resolution` | `image_size` | `1K` / `2K` / `4K`（仅 Nano Banana 2） |
| `response_format` | `response_format` | `url` / `b64_json` |
| `n` | — | **不支持**，固定单张 |

### 5.1 中转站显示名 → 实际配置

| 中转站显示名 | 模型 ID | 附加参数 |
|--------------|---------|----------|
| `nano-banana` | `gemini-2.5-flash-image` | — |
| `nano-banana-2` | `nano-banana-2` | 默认（自动选档） |
| `nano-banana-2-1k` | `nano-banana-2` | `image_size=1K` |
| `nano-banana-2-2k` | `nano-banana-2` | `image_size=2K` |
| `nano-banana-2-4k` | `nano-banana-2` | `image_size=4K` |
| `gemini-3-pro-image` | `gemini-3-pro-image-preview` | — |

---

## 六、错误与重试

| 错误情形 | 表现 | 处理建议 |
|----------|------|----------|
| `aspect_ratio` 与 `image_size` 同时传 | 400 / 部分中转返 500 | 客户端在发请求前互斥校验 |
| 在 `gemini-2.5-flash-image` 上传比例 | 被忽略，输出仍 1024×1024 | UI 提示用户切换到 Banana 2 / Pro |
| `n > 1` | 大多数中转直接报错 | 客户端固定 `n=1`，并发多任务实现批量 |
| URL 失效 | 下载 404 | 立即落盘归档，不依赖 URL 长期可用 |

---

## 七、关键注意事项

1. **`aspect_ratio` 与 `image_size` 互斥**——两者只传其一。
2. **Nano Banana（2.5 Flash）固定 1024×1024**，不识别比例 / 尺寸参数。
3. **`response_format` 推荐 `url`**，国内中转下 `b64_json` 不稳定。
4. **每次只能生成 1 张**，批量需在客户端做并发任务调度。
5. **多轮编辑**：Gemini 支持基于上一轮 URL 作为输入继续修改，可串成 prompt 链路。
6. **提示词建议**：
   - 具体化：材质、光影、构图、镜头语言
   - 上下文化："为高端品牌设计"、"杂志封面用途"
   - 摄影术语引导："广角"、"大光圈虚化"、"产品摄影布光"
   - 优先 "生成一张..." 而非 "画一张..."

---

## 八、版本信息

| 项目 | 信息 |
|------|------|
| 文档版本 | v1.1 |
| 适用模型 | Nano Banana / Nano Banana Pro / Nano Banana 2 |
| 更新日期 | 2026-05-03 |
| 适用平台 | OpenClaw + 飞牛 NAS |

*本文档用于协助中转站 / 客户端按官方约束接入 Gemini Nano Banana 系列。*
