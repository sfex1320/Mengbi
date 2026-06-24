# Image2 支持的比例、分辨率及限制

更新时间：2026-06-17  
对象：OpenAI `gpt-image-2` / Image2

## 1. 总结

`gpt-image-2` 不是只支持少数几个固定比例或固定尺寸。它支持大量自定义分辨率，只要 `size` 参数满足一组规则。

最核心的判断：

> 宽高都是 16 的倍数，比例在 1:3 到 3:1 之间，任一边不超过 3840px，总像素在 655,360 到 8,294,400 之间。

## 2. 尺寸参数规则

| 项目 | 规则 |
|---|---|
| 参数名 | `size` |
| 自动模式 | `auto` |
| 自定义写法 | `WIDTHxHEIGHT`，例如 `1536x864` |
| 宽高单位 | 像素 |
| 宽度要求 | 必须是 16 的倍数 |
| 高度要求 | 必须是 16 的倍数 |
| 比例范围 | 最窄 `1:3`，最宽 `3:1` |
| 比例判断 | `max(width, height) / min(width, height) <= 3` |
| 单边最大值 | 任一边不能超过 `3840px` |
| 总像素下限 | `width * height >= 655,360` |
| 总像素上限 | `width * height <= 8,294,400` |
| 2K+ 状态 | 总像素超过 `2560x1440 = 3,686,400` 时，官方标为 experimental |
| 最大常用横图 | `3840x2160` |
| 最大常用竖图 | `2160x3840` |

## 3. 尺寸校验公式

一个尺寸 `W x H` 是否可用，可以按下面顺序判断：

| 步骤 | 条件 | 说明 |
|---|---|---|
| 1 | `W % 16 == 0` | 宽度必须能被 16 整除 |
| 2 | `H % 16 == 0` | 高度必须能被 16 整除 |
| 3 | `max(W, H) <= 3840` | 长边不能超过 3840 |
| 4 | `max(W, H) / min(W, H) <= 3` | 长宽比不能超过 3:1 |
| 5 | `W * H >= 655360` | 总像素不能太小 |
| 6 | `W * H <= 8294400` | 总像素不能超过 4K 级上限 |

伪代码：

```js
function isValidImage2Size(width, height) {
  const pixels = width * height;
  const ratio = Math.max(width, height) / Math.min(width, height);

  return (
    width % 16 === 0 &&
    height % 16 === 0 &&
    Math.max(width, height) <= 3840 &&
    ratio <= 3 &&
    pixels >= 655360 &&
    pixels <= 8294400
  );
}
```

## 4. 常用有效尺寸示例

这些不是全部，只是常用和便于理解的示例。

| 用途 / 比例 | 尺寸 | 总像素 | 是否 experimental | 说明 |
|---|---:|---:|---|---|
| 方图 1:1 | `1024x1024` | 1,048,576 | 否 | 官方常用尺寸 |
| 方图 1:1 | `2048x2048` | 4,194,304 | 是 | 超过 2K 阈值 |
| 横图 3:2 | `1536x1024` | 1,572,864 | 否 | 官方常用横图 |
| 竖图 2:3 | `1024x1536` | 1,572,864 | 否 | 官方常用竖图 |
| 横图 16:9 | `1536x864` | 1,327,104 | 否 | 自定义 16:9 |
| 横图 16:9 | `2048x1152` | 2,359,296 | 否 | 常用 2K 横图 |
| 横图 16:9 | `2560x1440` | 3,686,400 | 否 | 刚好到 experimental 阈值 |
| 横图 16:9 | `3840x2160` | 8,294,400 | 是 | 4K 横图，上限 |
| 竖图 9:16 | `1152x2048` | 2,359,296 | 否 | 常用竖屏 |
| 竖图 9:16 | `2160x3840` | 8,294,400 | 是 | 4K 竖图，上限 |
| 超宽 3:1 | `2496x832` | 2,076,672 | 否 | 到达比例边界 |
| 超高 1:3 | `832x2496` | 2,076,672 | 否 | 到达比例边界 |
| 接近最小边界 | `1376x480` | 660,480 | 否 | 接近总像素下限 |

## 5. 无效尺寸示例

| 尺寸 | 是否无效 | 原因 |
|---|---|---|
| `512x512` | 是 | 总像素只有 262,144，低于 655,360 |
| `1920x1080` | 是 | `1080` 不是 16 的倍数 |
| `3840x1080` | 是 | 比例约为 3.56:1，超过 3:1 |
| `4096x2160` | 是 | 长边 4096 超过 3840 |
| `3840x3840` | 是 | 总像素 14,745,600，超过上限 |
| `3000x1000` | 是 | 比例合格，但宽高都不是 16 的倍数 |
| `320x2048` | 是 | 比例为 1:6.4，超过 1:3 |
| `800x800` | 是 | 总像素 640,000，低于 655,360 |

## 6. API 输出相关限制

| 参数 | 支持值 / 限制 | 说明 |
|---|---|---|
| `quality` | `auto`、`low`、`medium`、`high` | `auto` 是默认值 |
| `output_format` | `png`、`jpeg`、`webp` | GPT image models 支持 |
| 默认输出格式 | `png` | Image API 默认返回 base64 图像数据 |
| `output_compression` | `0-100` | 仅 `jpeg` / `webp` 支持 |
| `background` | `auto`、`opaque` | `gpt-image-2` 当前不支持透明背景 |
| 透明背景 | 不支持 `background: "transparent"` | 请求透明背景会失败 |
| `n` | `1-10` | 一次请求生成的图片数量 |
| `prompt` 最大长度 | 32,000 字符 | GPT image models 的限制 |
| `stream` | `true` / `false` | GPT image models 支持流式生成 |
| `partial_images` | `0-3` | 流式时返回局部预览图的数量 |
| `response_format` | 不适用于 GPT image models | GPT image models 总是返回 base64 编码图像 |

## 7. 编辑、参考图和 Mask 限制

| 项目 | 规则 |
|---|---|
| 编辑接口 | 支持基于一张或多张输入图进行编辑 |
| 输入图数量 | GPT image models 最多可提供 16 张输入图 |
| 输入图来源 | 可使用上传文件 ID，或 URL / base64 data URL |
| `input_fidelity` | `gpt-image-2` 会自动高保真处理输入图，不需要也不能调该参数 |
| mask 作用对象 | 如果有多张输入图，mask 作用于第一张输入图 |
| mask 精度 | mask 是提示引导，不保证完全按像素级边界执行 |
| mask 格式 | mask 需要包含 alpha channel |
| mask 尺寸 | mask 与被编辑图需要同尺寸 |
| mask 文件限制 | 图片和 mask 小于 50MB |

## 8. 速率限制

不同账号和项目的实际限制以控制台为准。官方模型页列出的 `gpt-image-2` 默认层级限制如下：

| Tier | TPM | IPM |
|---|---:|---:|
| Free | 不支持 | 不支持 |
| Tier 1 | 100,000 | 5 |
| Tier 2 | 250,000 | 20 |
| Tier 3 | 800,000 | 50 |
| Tier 4 | 3,000,000 | 150 |
| Tier 5 | 8,000,000 | 250 |

说明：

| 缩写 | 含义 |
|---|---|
| TPM | tokens per minute，每分钟 token 数 |
| IPM | images per minute，每分钟图片数 |

## 9. 成本和延迟相关规则

| 项目 | 说明 |
|---|---|
| 尺寸影响成本 | 更大的尺寸通常会消耗更多输出 token |
| 质量影响成本 | `high` 通常比 `medium` 和 `low` 更贵、更慢 |
| 输入图影响成本 | 编辑请求中的参考图会产生图像输入 token |
| 高保真输入 | `gpt-image-2` 对图像输入自动使用高保真处理，编辑成本可能更高 |
| 复杂提示耗时 | 复杂提示可能需要接近 2 分钟 |
| `low` 质量 | 适合快速草稿、缩略图和迭代 |
| `jpeg` 输出 | 通常比 `png` 更快，适合对延迟敏感的场景 |

## 10. 能力和行为局限

| 局限 | 说明 |
|---|---|
| 文字渲染 | 虽然能力提升明显，但复杂文字、精确排版仍可能出错 |
| 一致性 | 多次生成同一角色、同一品牌元素时，可能出现差异 |
| 构图控制 | 对严格布局、精确位置的控制仍可能不稳定 |
| mask 精度 | mask 会作为编辑引导，但不保证完全遵循精确形状 |
| 内容审核 | 所有提示词和生成图都会经过内容审核 |
| 审核参数 | `moderation` 支持 `auto` 和 `low` |

## 11. 推荐尺寸选择

| 场景 | 推荐尺寸 |
|---|---|
| 普通方图 | `1024x1024` |
| 高质量方图 | `2048x2048` |
| 横版封面 | `1536x1024`、`2048x1152` |
| 竖版海报 | `1024x1536`、`1152x2048` |
| 16:9 视频封面 | `2048x1152`、`2560x1440` |
| 4K 横图 | `3840x2160` |
| 4K 竖图 | `2160x3840` |
| 快速草稿 | 较小尺寸 + `quality: "low"` |
| 最终资产 | 目标尺寸 + `quality: "medium"` 或 `quality: "high"` |

## 12. 官方来源

- OpenAI Image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Create image API reference: https://developers.openai.com/api/reference/resources/images/methods/generate
- OpenAI Create image edit API reference: https://developers.openai.com/api/reference/resources/images/methods/edit
- OpenAI GPT Image 2 model page: https://developers.openai.com/api/docs/models/gpt-image-2
