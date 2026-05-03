# GPT Image 2 API 配置规则

> 适用模型：`gpt-image-2`
> 文档版本：v1.1（2026-05-03）
> 用途：协助中转站 / 客户端按官方约束接入 GPT Image 2

---

## 一、基础信息

| 项目 | 配置值 |
|------|--------|
| 模型名称 | `gpt-image-2` |
| Base URL | `https://api.bltcy.ai` |
| 图像生成接口 | `POST /v1/images/generations` |
| 认证方式 | `Authorization: Bearer <API_KEY>` |
| 请求 Content-Type | `application/json` |
| 最长边上限 | 3840 px |
| 像素预算 | ≤ 8,294,400（约 8.3 MP） |
| 边长粒度 | 宽、高均必须被 **16** 整除 |
| 输出格式 | PNG / RGB / 8-bit / 不透明 |

---

## 二、尺寸、分辨率与比例

### 2.1 自定义尺寸约束（必须全部满足）

```
width  >= 256   且  width  <= 3840   且  width  % 16 == 0
height >= 256   且  height <= 3840   且  height % 16 == 0
width * height <= 8,294,400
```

### 2.2 推荐尺寸预设

下表中的所有尺寸均满足上述约束（均为 16 的整数倍，且 ≤ 8.3 MP），可直接作为 `size` 参数透传。

| 尺寸 (W×H) | 像素数 | 比例 | 适用场景 |
|------------|--------|------|----------|
| 1024×1024 | 1,048,576 | 1:1 | 方形头像、图标、社媒贴文 |
| 1024×1280 | 1,310,720 | 4:5 | Instagram 竖版 |
| 1280×1024 | 1,310,720 | 5:4 | 横版社交媒体 |
| 1024×1536 | 1,572,864 | 2:3 | 竖版海报 |
| 1536×1024 | 1,572,864 | 3:2 | 横版照片 |
| 1152×2048 | 2,359,296 | 9:16 | 手机壁纸、短视频封面 |
| 2048×1152 | 2,359,296 | 16:9 | 宽屏内容、PC 壁纸 |
| 1680×720  | 1,209,600 | 21:9 | 超宽横屏 Banner |
| 720×1680  | 1,209,600 | 9:21 | 超长竖屏 |
| 2160×3840 | 8,294,400 | 9:16 | 4K 级竖版（像素预算上限） |
| 3840×2160 | 8,294,400 | 16:9 | 4K 级横版（像素预算上限） |

### 2.3 支持的比例族

| 比例 | 类别 | 推荐预设 |
|------|------|----------|
| 1:1 | 正方形 | 1024×1024 |
| 4:5 / 5:4 | 社交媒体 | 1024×1280 / 1280×1024 |
| 2:3 / 3:2 | 海报、照片 | 1024×1536 / 1536×1024 |
| 9:16 / 16:9 | 移动 / 宽屏 | 1152×2048、2160×3840 / 2048×1152、3840×2160 |
| 21:9 / 9:21 | 影视超宽 / 超长 | 1680×720 / 720×1680 |

> ⚠️ 不在 2.2 表中的自定义比例同样合法，只要满足 2.1 的所有数学约束即可。

---

## 三、质量配置

| 取值 | 说明 | 推荐场景 |
|------|------|----------|
| `standard` | 标准质量，速度较快，默认值 | 快速预览、草稿、批量试错 |
| `high` | 高质量，细节更丰富，耗时更长 | 终稿、印刷、4K 输出 |

> 经验法则：尺寸 ≥ 2 MP 或对外发稿，统一使用 `high`。

---

## 四、API 接入

### 4.1 请求头

```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
Accept: application/json
```

### 4.2 请求参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `model` | string | ✅ | — | 固定 `gpt-image-2` |
| `prompt` | string | ✅ | — | 图像描述文本 |
| `size` | string | ⬜ | `1024x1024` | 格式 `WIDTHxHEIGHT`，必须满足 2.1 的全部约束 |
| `quality` | string | ⬜ | `standard` | `standard` / `high` |
| `n` | integer | ⬜ | `1` | 单次生成数量，1–10 |
| `response_format` | string | ⬜ | `url` | `url` / `b64_json` |

### 4.3 请求示例

```bash
curl -X POST 'https://api.bltcy.ai/v1/images/generations' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-image-2",
    "prompt": "Crystal chandelier ballroom with marble floor, ultra detailed",
    "size": "2160x3840",
    "quality": "high",
    "n": 1,
    "response_format": "url"
  }'
```

### 4.4 响应格式

#### URL（默认）
```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://.../image.png",
      "revised_prompt": "OpenAI 优化后的实际提示词"
    }
  ]
}
```

#### Base64
```json
{
  "created": 1234567890,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUg...",
      "revised_prompt": "OpenAI 优化后的实际提示词"
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `created` | Unix 时间戳 |
| `revised_prompt` | OpenAI 内部改写后的提示词 |
| `url` | 临时 URL，约 **1 小时** 失效，需及时落盘 |
| `b64_json` | Base64 PNG，单图响应可能较大 |

### 4.5 错误代码

| 错误代码 | HTTP | 说明 | 处理建议 |
|----------|------|------|----------|
| `invalid_size` | 400 | 尺寸违反 16 整除 / 像素预算 | 自动夹取到合法尺寸或提示用户 |
| `size_not_supported` | 400 | 该尺寸未被支持 | 回退到 2.2 的推荐预设 |
| `invalid_prompt` | 400 | 提示词违规或为空 | 校验文本、去除敏感词 |
| `rate_limit_exceeded` | 429 | 请求频率过高 | 退避重试（指数 backoff） |
| `insufficient_quota` | 429 | 余额 / 配额不足 | 提示充值 |
| `server_error` | 500 | 服务端错误 | 短暂等待后重试 |

---

## 五、客户端 / 中转站校验逻辑

```python
def validate_size(width: int, height: int) -> bool:
    """GPT Image 2 尺寸合法性校验（与官方一致）"""
    if width < 256 or height < 256:
        return False
    if width > 3840 or height > 3840:
        return False
    if width * height > 8_294_400:
        return False
    if width % 16 != 0 or height % 16 != 0:
        return False
    return True


def snap_to_grid(value: int) -> int:
    """将任意像素值向下吸附到 16 的整数倍，并夹到 [256, 3840]"""
    snapped = (value // 16) * 16
    return max(256, min(3840, snapped))
```

### 5.1 接入检查清单

- [ ] Base URL 指向 `https://api.bltcy.ai`
- [ ] `model` 固定为 `gpt-image-2`
- [ ] 客户端在发请求前调用 `validate_size`
- [ ] `quality` 透传（`standard` / `high`）
- [ ] 同时支持 `url` 与 `b64_json`
- [ ] URL 在 1 小时内落盘存档
- [ ] 所有错误码均做用户可读映射
- [ ] 失败重试使用指数 backoff（首延 1s，最多 3 次）

---

## 六、性能优化建议

| 场景 | 建议 |
|------|------|
| 高并发 / 实时预览 | 使用 `standard` 质量，尺寸控制在 ≤ 2 MP |
| 大图（≥ 4 MP） | 优先 `url` 响应，避免 b64 体积膨胀 |
| 批量生成 | 单次 `n=1` + 并发任务，比单次 `n=10` 更可控 |
| 缓存 | `(model, prompt, size, quality)` 作为缓存 key |
| 4K 出片 | 必须 `high`；首选 3840×2160 / 2160×3840 |

---

## 七、文件保存规范

### 7.1 命名格式

```
[描述]-[YYYYMMDD]-[宽x高].png
```

示例：`mountain-sunset-20260503-2160x3840.png`

### 7.2 默认存储路径

```
/vol1/@team/AIGC创作/GPT-IMAGE/
```

---

## 八、版本信息

| 项目 | 信息 |
|------|------|
| 文档版本 | v1.1 |
| 适用模型 | `gpt-image-2` |
| 更新日期 | 2026-05-03 |
| 适用平台 | OpenClaw + 飞牛 NAS |

*本文档用于协助中转站 / 客户端按官方约束接入 GPT Image 2。*
