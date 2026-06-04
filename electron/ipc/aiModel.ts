/**
 * 通用 AI 模型管理 IPC —— `api:ai-model:*`
 *
 * 第一版只做"列表 + 体检 + 查所属 feature"，下载 / 镜像 / 导入等后续接入。
 *
 * 通道：
 *   api:ai-model:list       所有已注册模型 + 当前体检（exists / sizeBytes / sizeMismatch）
 *   api:ai-model:get        单个模型的 spec + probe
 *   api:ai-model:list-for-feature  指定 feature 用到的模型
 */
import { z } from 'zod';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { getModelRegistry } from '../services/ai-platform';

const ModelIdSchema = z.object({ modelId: z.string().min(1) });
const FeatureIdSchema = z.object({ featureId: z.string().min(1) });

export function registerAiModelHandlers(): void {
  register('api:ai-model:list', null, async () => {
    const reg = getModelRegistry();
    const list = reg.list().map((spec) => ({
      spec,
      probe: reg.probeModel(spec.id)
    }));
    return ok(list);
  });

  register('api:ai-model:get', ModelIdSchema, async (input) => {
    const reg = getModelRegistry();
    const spec = reg.get(input.modelId);
    if (!spec) {
      return err(
        makeError('VALIDATION_FAILED', `未注册的模型：${input.modelId}`, { severity: 'toast' })
      );
    }
    return ok({ spec, probe: reg.probeModel(input.modelId) });
  });

  register('api:ai-model:list-for-feature', FeatureIdSchema, async (input) => {
    const reg = getModelRegistry();
    const list = reg.listForFeature(input.featureId).map((spec) => ({
      spec,
      probe: reg.probeModel(spec.id)
    }));
    return ok(list);
  });
}
