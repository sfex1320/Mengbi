/**
 * 智能画布「节点模板」IPC（api:template:*）。
 * 模板以独立 .json 文件存于 userData/node-templates/（见 services/nodeTemplateStore.ts）。
 * 渲染端 smartTemplateStore 走这些通道读写，不再用 localStorage 持久化。
 */
import { z } from 'zod';
import { register, ok, err } from './helpers';
import {
  listNodeTemplates,
  saveNodeTemplate,
  removeNodeTemplate,
  renameNodeTemplate,
  type StoredTemplate
} from '../services/nodeTemplateStore';
import { makeError } from '@shared/error';

const TemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  notes: z.string().optional(),
  createdAt: z.string(),
  count: z.number(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown())
});

export function registerNodeTemplateHandlers(): void {
  register('api:template:list', null, async () => {
    try {
      return ok({ templates: await listNodeTemplates() });
    } catch (e) {
      return err(
        makeError('UNKNOWN', `读取节点模板失败：${(e as Error).message}`, { severity: 'toast' })
      );
    }
  });

  register('api:template:save', TemplateSchema, async (input) => {
    try {
      await saveNodeTemplate(input as StoredTemplate);
      return ok({ saved: true as const });
    } catch (e) {
      return err(
        makeError('FILE_PERMISSION', `保存节点模板失败：${(e as Error).message}`, {
          severity: 'toast',
          hint: '检查配置文件夹写入权限'
        })
      );
    }
  });

  register('api:template:remove', z.object({ id: z.string().min(1) }), async (input) => {
    await removeNodeTemplate(input.id);
    return ok({ removed: true as const });
  });

  register(
    'api:template:rename',
    z.object({ id: z.string().min(1), name: z.string() }),
    async (input) => {
      await renameNodeTemplate(input.id, input.name);
      return ok({ renamed: true as const });
    }
  );
}
