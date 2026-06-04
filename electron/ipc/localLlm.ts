/**
 * 本地大语言模型（内嵌 llama.cpp）状态查询 IPC。
 *
 * 不暴露 start —— 启动是 chat handler 内部按需 lazy 完成的。
 * 这里只让前端能"看一眼"现在跑没跑、跑的是哪个模型。
 */

import { register, ok } from './helpers';
import { localLlmServer } from '../services/localLlmServer';

export function registerLocalLlmHandlers(): void {
  register('api:llm:status', null, async () => ok(localLlmServer.getStatus()));

  register('api:llm:stop', null, async () => {
    await localLlmServer.stop();
    return ok(true as const);
  });
}
