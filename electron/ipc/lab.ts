import { z } from 'zod';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { makeError } from '@shared/error';
import { isMockMode } from './mocks/runtime';
import { logger } from '../services/logger';

/**
 * 实验室：当前实现 reverse / translate；split / compare / fuse 留接口骨架。
 */

const TranslateSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(['zh-to-en', 'en-to-zh'])
});

const ReverseSchema = z.object({
  imagePaths: z.array(z.string()).min(1).max(5),
  modelId: z.string().min(1),
  resultType: z.enum(['description', 'tags', 'style'])
});

export function registerLabHandlers(): void {
  register('api:lab:reverse', ReverseSchema, async (input) => {
    if (isMockMode()) {
      const result = mockReverse(input.resultType);
      logHistory('reverse', input, result);
      return ok({ result });
    }
    return err(
      makeError(
        'NOT_IMPLEMENTED',
        '反推需要支持 vision 的对话模型，请先在设置页配置一个并标记 supports_vision',
        { severity: 'modal' }
      )
    );
  });

  register('api:lab:translate', TranslateSchema, async (input) => {
    if (isMockMode()) {
      const result =
        input.direction === 'zh-to-en'
          ? `[mock translation EN] ${input.text.slice(0, 80)}`
          : `[mock 译文] ${input.text.slice(0, 80)}`;
      logHistory('translate', input, { result });
      return ok({ result });
    }
    return err(
      makeError(
        'NOT_IMPLEMENTED',
        '翻译需要先在设置页配置一个对话模型',
        { severity: 'modal' }
      )
    );
  });

  register(
    'api:lab:split',
    z.object({ text: z.string(), modelId: z.string() }),
    async () => err(makeError('NOT_IMPLEMENTED', 'P1 · 拆解将在 v1.1 实现', { severity: 'toast' }))
  );

  register(
    'api:lab:compare',
    z.object({ text: z.string(), modelIds: z.array(z.string()) }),
    async () => err(makeError('NOT_IMPLEMENTED', 'P2 · 多模型对比将在 v1.5 实现', { severity: 'toast' }))
  );

  register(
    'api:lab:fuse',
    z.object({ textA: z.string(), textB: z.string(), ratioA: z.number().min(0).max(1) }),
    async () => err(makeError('NOT_IMPLEMENTED', 'P2 · 融合将在 v1.5 实现', { severity: 'toast' }))
  );

  register(
    'api:lab:history',
    z.object({ operation_type: z.string().optional() }).optional(),
    async (input) => {
      const opType = input?.operation_type;
      const rows = opType
        ? getDb()
            .prepare(
              `SELECT * FROM prompt_lab_history WHERE operation_type = ? ORDER BY id DESC LIMIT 100`
            )
            .all(opType)
        : getDb()
            .prepare(`SELECT * FROM prompt_lab_history ORDER BY id DESC LIMIT 100`)
            .all();
      return ok(rows);
    }
  );
}

function logHistory(opType: string, input: unknown, output: unknown): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO prompt_lab_history(operation_type, input_data, output_data, created_at)
         VALUES(?, ?, ?, ?)`
      )
      .run(opType, JSON.stringify(input), JSON.stringify(output), new Date().toISOString());
  } catch (e) {
    logger.warn('lab history log failed', e);
  }
}

function mockReverse(type: 'description' | 'tags' | 'style'): unknown {
  switch (type) {
    case 'description':
      return {
        text: '一位身穿白色 T 恤的女子站在树林中，柔和的午后光线穿过树叶在她身上洒下斑驳光影，景深虚化背景突出人物，画面整体呈现温暖怀旧的胶片质感。'
      };
    case 'tags':
      return { tags: ['人像', '户外', '树林', '白T', '胶片质感', '柔光', '景深', '暖色调'] };
    case 'style':
      return { text: '胶片摄影风格，色彩偏暖橘，构图为三分法竖构图，光线属于黄金时刻自然光' };
  }
}
