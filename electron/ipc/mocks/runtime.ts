import { logger } from '../../services/logger';
import type { TestConnectionResult } from '@shared/ipc';

/**
 * Mock 运行时：MENGBI_MOCK=1 时所有 Adapter 走本地夹具，详见 ENVIRONMENT.md §六。
 */

export function isMockMode(): boolean {
  return process.env.MENGBI_MOCK === '1';
}

if (isMockMode()) {
  logger.info('mock mode ENABLED — no external API will be called');
}

export async function runMockTestConnection(input: {
  base_url: string;
  type: string;
}): Promise<TestConnectionResult> {
  await sleep(200 + Math.random() * 200);
  return {
    ok: true,
    latency_ms: 220,
    models: input.type === 'image' ? ['mock-image-v1', 'mock-image-v2'] : ['mock-chat-v1', 'mock-chat-vision']
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
