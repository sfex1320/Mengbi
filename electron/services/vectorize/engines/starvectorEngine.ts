/**
 * StarVector 引擎 —— 实现 EngineRunner 接口。
 *
 * 走通用 ai-platform/sidecarManager,Python sidecar 在端口 7867。
 *
 * 流程:
 *   1. isAvailable():
 *        a. 检查 vec_starvector_path 设置非空(用户必须先填模型路径)
 *        b. 检查 sidecar /api/status 可达
 *        若都满足 → 可用
 *   2. run():
 *        a. submitTask → 拿 task_id
 *        b. 轮询 getTaskStatus,直到 done / failed / cancelled
 *        c. done 时从 result_info 拿 svg 字符串(StarVector adapter 把 SVG 写到那)
 *        d. failed 时把 error_code 经 mapStarVectorErrorCode 映射回 AppErrorCode
 *
 * 关键守则(用户清单 §6):
 *   - 截断检测:adapter 端通过 was_truncated 标记;mengbi 后处理层会再次检查可见元素
 *   - 不允许伪造 —— 这里 ok=true 必须真的拿到合法 SVG;空 / 非 SVG 一律 ok=false
 */
import { getDb } from '../../db';
import { logger } from '../../logger';
import { getSidecarManager } from '../../ai-platform/sidecarManager';
import {
  STARVECTOR_FEATURE_ID,
  buildStarVectorSubmitBody,
  mapStarVectorErrorCode
} from '../../ai-features/starvector';
import type {
  EngineRunner,
  EngineRunInput,
  EngineResult,
  EngineAvailability,
  StarVectorParams,
  VecMode
} from '../types';

const ID: VecMode = 'starvector';

function readUserStarVectorPath(): string {
  try {
    const row = getDb()
      .prepare(`SELECT value FROM settings WHERE key = 'vec_starvector_path'`)
      .get() as { value: string } | undefined;
    return (row?.value ?? '').trim();
  } catch {
    return '';
  }
}

export class StarVectorEngine implements EngineRunner {
  readonly id = ID;

  async isAvailable(): Promise<EngineAvailability> {
    const modelPath = readUserStarVectorPath();
    if (!modelPath) {
      return {
        available: false,
        reason: '未配置 StarVector 模型路径。请在设置里填入模型目录绝对路径。'
      };
    }
    const status = await getSidecarManager().getServerStatus(STARVECTOR_FEATURE_ID);
    if (!status.reachable) {
      return {
        available: false,
        reason: `StarVector sidecar 未启动(端口 7867)。请先在 AI 面板点「启动服务」。`
      };
    }
    return { available: true };
  }

  async run(input: EngineRunInput, signal?: AbortSignal): Promise<EngineResult> {
    const t0 = Date.now();
    const params = (input.params || {}) as StarVectorParams;

    // 提前 probe,避免提交后才发现 sidecar 没起
    const avail = await this.isAvailable();
    if (!avail.available) {
      return {
        ok: false,
        errorCode: 'CONFIG_MISSING',
        errorTag: 'STARVECTOR_NOT_READY',
        errorMessageZh: avail.reason ?? 'StarVector 不可用',
        errorHint: '在设置 → AI 功能里配置模型路径并启动服务。',
        rawError: avail.reason ?? '',
        durationMs: Date.now() - t0
      };
    }

    try {
      const body = buildStarVectorSubmitBody({
        inputPath: input.preprocessedPath,
        maxNewTokens: params.maxNewTokens,
        temperature: params.temperature,
        doSample: params.doSample
      });

      const submitRes = await getSidecarManager().submitTask<{ task_id: string; status: string }>(
        STARVECTOR_FEATURE_ID,
        body,
        10000
      );
      const taskId = submitRes.task_id;

      // 轮询(最多 3 分钟 / 800ms 间隔)
      const POLL_INTERVAL = 800;
      const MAX_POLL_MS = 180_000;
      const pollStart = Date.now();

      while (true) {
        if (signal?.aborted) {
          try {
            await getSidecarManager().cancelTask(STARVECTOR_FEATURE_ID, taskId, 3000);
          } catch {
            /* */
          }
          return {
            ok: false,
            errorCode: 'CANCELLED',
            errorTag: 'STARVECTOR_CANCELLED',
            errorMessageZh: 'StarVector 任务已取消',
            errorHint: '',
            rawError: 'aborted',
            durationMs: Date.now() - t0
          };
        }
        if (Date.now() - pollStart > MAX_POLL_MS) {
          try {
            await getSidecarManager().cancelTask(STARVECTOR_FEATURE_ID, taskId, 3000);
          } catch {
            /* */
          }
          return {
            ok: false,
            errorCode: 'NETWORK_TIMEOUT',
            errorTag: 'STARVECTOR_TIMEOUT',
            errorMessageZh: 'StarVector 推理超时(> 3 分钟)',
            errorHint: '减小 max_new_tokens 或换更简单的图。',
            rawError: 'poll timeout',
            durationMs: Date.now() - t0
          };
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL));

        let st;
        try {
          st = await getSidecarManager().getTaskStatus(STARVECTOR_FEATURE_ID, taskId, 5000);
        } catch (e) {
          logger.warn(`[vec.starvector] poll failed: ${(e as Error).message}`);
          continue; // 网络瞬断重试
        }

        if (st.status === 'done') {
          // result_info 期望包含 svg 字符串 + 是否截断 + 模型信息
          const info = (st.result_info ?? {}) as {
            svg?: string;
            raw_output?: string;
            was_truncated?: boolean;
            model_name?: string;
            model_path?: string;
          };
          const svg = info.svg ?? '';
          if (!svg || !svg.trim().startsWith('<')) {
            return {
              ok: false,
              errorCode: 'API_FAILED',
              errorTag: 'STARVECTOR_OUTPUT_NO_SVG',
              errorMessageZh: 'StarVector 输出不含合法 SVG',
              errorHint: '截断或生成失败;尝试简单图标 / 调高 max_new_tokens。',
              rawError: info.raw_output?.slice(0, 500) ?? 'empty result',
              durationMs: Date.now() - t0
            };
          }
          return {
            ok: true,
            svg,
            rawOutput: info.raw_output,
            durationMs: Date.now() - t0,
            meta: {
              modelName: info.model_name ?? null,
              modelPath: info.model_path ?? null,
              wasTruncated: info.was_truncated ?? false
            }
          };
        }
        if (st.status === 'failed') {
          return {
            ok: false,
            errorCode: mapStarVectorErrorCode(st.error_code),
            errorTag: `STARVECTOR_${st.error_code ?? 'UNKNOWN'}`,
            errorMessageZh: st.error_message_zh ?? 'StarVector 推理失败',
            errorHint: st.error_hint ?? '',
            rawError: st.error_detail ?? '',
            durationMs: Date.now() - t0
          };
        }
        if (st.status === 'cancelled') {
          return {
            ok: false,
            errorCode: 'CANCELLED',
            errorTag: 'STARVECTOR_CANCELLED',
            errorMessageZh: 'StarVector 任务已取消',
            errorHint: '',
            rawError: 'cancelled by sidecar',
            durationMs: Date.now() - t0
          };
        }
        // queued / running:继续轮
      }
    } catch (e) {
      const err = e as Error;
      logger.warn('[vec.starvector] submit/poll threw', err);
      return {
        ok: false,
        errorCode: 'NETWORK_OFFLINE',
        errorTag: 'STARVECTOR_HTTP_FAILED',
        errorMessageZh: `StarVector HTTP 调用失败: ${err.message}`,
        errorHint: '确认 sidecar 仍在运行;查看日志。',
        rawError: err.message,
        durationMs: Date.now() - t0
      };
    }
  }
}

let _instance: StarVectorEngine | null = null;
export function getStarVectorEngine(): StarVectorEngine {
  if (!_instance) _instance = new StarVectorEngine();
  return _instance;
}
