import { z } from 'zod';

/**
 * IPC 入参 zod schemas。所有 handler 必须经过这里 .parse() 校验。
 * 详见 CLAUDE.md §8 与 ARCHITECTURE.md §6（输入校验）。
 */

// 对旧值容错：把已废弃的 kimi/minimax/glm/deepseek 当 openai-compat 处理
const officialKindSchema = z
  .enum(['openai', 'anthropic', 'gemini', 'openai-compat', 'kimi', 'minimax', 'glm', 'deepseek'])
  .nullable()
  .transform((v) => {
    if (v === 'kimi' || v === 'minimax' || v === 'glm' || v === 'deepseek') {
      return 'openai-compat' as const;
    }
    return v;
  });

const imageKindSchema = z
  .enum(['openai', 'grsai', 'gemini', 'openai-compat'])
  .nullable();

const apiConfigInputSchema = z.object({
  id: z.number().int().optional(),
  plan_id: z.number().int().nonnegative(),
  type: z.enum(['image', 'text']),
  provider_name: z.string().min(1).max(100),
  base_url: z.string().url(),
  // 编辑已存在配置时可以为空字符串（表示保留原密文 Key）；新增时由前端校验非空
  api_key_plain: z.string().max(2048),
  model_mapping: z.record(z.string(), z.string()),
  is_official: z.boolean(),
  supports_web_search: z.boolean(),
  supports_vision: z.boolean(),
  official_kind: officialKindSchema,
  image_kind: imageKindSchema
});

export const SaveSettingsSchema = z.object({
  configs: z.array(apiConfigInputSchema).optional(),
  prefs: z.record(z.string(), z.string()).optional()
});

export const TestConnectionSchema = z.object({
  base_url: z.string().url(),
  api_key_plain: z.string().min(1),
  type: z.enum(['image', 'text']),
  model_id: z.string().optional()
});

export const PlanUpsertSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(100)
});

export const ChatSendSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().max(50_000),
  /** 用户消息附带的图片（data URI / https URL）；提交时由后端拼成多模态消息 */
  attachedImages: z.array(z.string()).max(8).optional()
});

export const ImageGenerateSchema = z.object({
  modelId: z.string().min(1),
  positivePrompt: z.string().min(1).max(20_000),
  negativePrompt: z.string().max(20_000).optional(),
  params: z.record(z.string(), z.unknown()),
  referenceImages: z.array(z.string()).max(10).optional()
});

export const ThemeSaveSchema = z.object({
  name: z.string().min(1).max(50),
  atmosphere: z.string(),
  palette: z.string()
});
