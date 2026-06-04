/**
 * Install Manager —— 串起 FeatureSpec.installBats 的执行流程 + 并发锁。
 *
 * 一次只允许一个 feature 在装；用户连点两次同 feature 第二次 return 'already-running'。
 * UI 通过 onProgress 拿到全过程进度（含 stage = 当前 bat 名）。
 *
 * 卸载 / 升级 / 修复都是同一套路：跑同一个 install_or_repair.bat。
 */
import { logger } from '../logger';
import { getSidecarManager } from './sidecarManager';
import { runInstallBat } from './installScriptRunner';
import type { InstallProgressEvent, InstallResult } from './types';

interface RunningInstall {
  featureId: string;
  controller: AbortController;
}

const RUNNING: Map<string, RunningInstall> = new Map();

export interface InstallFeatureResult {
  featureId: string;
  /** 所有 install bat 都成功才 true */
  success: boolean;
  /** 每个 bat 的结果 */
  steps: Array<{ bat: string } & InstallResult>;
}

export async function installFeature(
  featureId: string,
  onProgress: (e: InstallProgressEvent) => void,
  signal?: AbortSignal
): Promise<InstallFeatureResult> {
  const spec = getSidecarManager().get(featureId);
  if (!spec) {
    throw new Error(`未注册的 AI feature：${featureId}`);
  }
  if (RUNNING.has(featureId)) {
    throw new Error(`Feature ${featureId} 正在安装中，请等待完成`);
  }
  if (spec.installBats.length === 0) {
    return { featureId, success: true, steps: [] };
  }

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  RUNNING.set(featureId, { featureId, controller });

  const steps: InstallFeatureResult['steps'] = [];
  try {
    for (const bat of spec.installBats) {
      logger.info(`[ai-platform] feature=${featureId} running ${bat}`);
      const r = await runInstallBat(bat, onProgress, controller.signal);
      steps.push({ bat, ...r });
      if (!r.success) {
        return { featureId, success: false, steps };
      }
    }
    return { featureId, success: true, steps };
  } finally {
    RUNNING.delete(featureId);
  }
}

export function cancelInstall(featureId: string): { cancelled: boolean } {
  const r = RUNNING.get(featureId);
  if (!r) return { cancelled: false };
  r.controller.abort();
  return { cancelled: true };
}

export function listRunningInstalls(): string[] {
  return [...RUNNING.keys()];
}
