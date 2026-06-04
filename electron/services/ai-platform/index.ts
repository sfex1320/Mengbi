/**
 * AI Platform 模块对外门面 —— 集中 re-export + 启动期初始化钩子。
 *
 * 谁需要 AI 通用底座的能力，从这里取：
 *
 *   import {
 *     getSidecarManager, getFeatureRegistry, getModelRegistry,
 *     installFeature, bootstrapPortable, ...
 *   } from '../services/ai-platform';
 *
 * 启动期：electron/ipc/index.ts 或 main.ts 调一次 `initializeAiPlatform()`，
 * 把 HYPIR / SUPIR 这些既有功能 register 到 SidecarManager + ModelRegistry。
 * 之后 IPC 层 / UI 层都只跟通用底座说话，不直接 import 具体 feature 的服务文件。
 */
export { getSidecarManager } from './sidecarManager';
export type { SidecarManager } from './sidecarManager';
export { getFeatureRegistry } from './featureRegistry';
export type { FeatureRegistry } from './featureRegistry';
export { getModelRegistry } from './modelRegistry';
export type { ModelRegistry } from './modelRegistry';
export {
  getPortableRoot,
  setPortableRoot,
  isPortableRootConfigured,
  getPythonExePath,
  probePython,
  bootstrapPortable
} from './pythonRuntime';
export {
  installFeature,
  cancelInstall,
  listRunningInstalls,
  type InstallFeatureResult
} from './installManager';
export { runInstallBat } from './installScriptRunner';
export { sweepOrphanSidecars } from './orphanRegistry';
export type { SweepResult } from './orphanRegistry';
export { killProcessTree, killProcessTreeSync, isProcessAlive } from './processKill';
export type {
  FeatureSpec,
  FeatureCategory,
  ModelSpec,
  FeatureProbe,
  FeatureStatus,
  ModelProbe,
  TaskStatusRaw,
  SidecarStartResult,
  SidecarStatusResult,
  InstallProgressEvent,
  InstallResult
} from './types';
