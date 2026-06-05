import { registerSettingsHandlers } from './settings';
import { registerChatHandlers } from './chat';
import { registerGenerateHandlers } from './generate';
import { registerGalleryHandlers } from './gallery';
// 实验室「页面」已下线，但 reverse/translate 后端保留：智能画布 LLM 节点的「图片反推」复用 api:lab:reverse
import { registerLabHandlers } from './lab';
import { registerMiscHandlers } from './misc';
import { registerDragHandlers } from './drag';
import { registerToolsHandlers } from './tools';
import { registerConfigIOHandlers } from './configIO';
import { registerLocalLlmHandlers } from './localLlm';
import { registerUpscaleHandlers } from './upscale';
import { registerHypirHandlers } from './hypir';
import { registerVecHandlers } from './vec';
import { registerPsHandlers } from './ps';
import { registerComfyuiConnectionHandlers } from './comfyuiConnection';
import { registerComfyuiWorkflowHandlers } from './comfyuiWorkflow';
import { registerComfyuiRunHandlers } from './comfyuiRun';
import { registerComfyuiResultsHandlers } from './comfyuiResults';
import { registerAiFeatureHandlers } from './aiFeature';
import { registerAiModelHandlers } from './aiModel';
import { registerBuiltinAiFeatures } from '../services/ai-features';

export function registerAllIpcHandlers(): void {
  registerSettingsHandlers();
  registerChatHandlers();
  registerGenerateHandlers();
  registerGalleryHandlers();
  registerLabHandlers();
  registerMiscHandlers();
  registerDragHandlers();
  registerToolsHandlers();
  registerConfigIOHandlers();
  registerLocalLlmHandlers();
  registerUpscaleHandlers();
  // 通用 AI 平台底座 —— 先注册 feature spec 再注册 IPC handler，
  // 这样 api:ai-feature:list 等通道初次调用时已经能看到 HYPIR
  registerBuiltinAiFeatures();
  registerAiFeatureHandlers();
  registerAiModelHandlers();
  // HYPIR feature-specific IPC（提交任务请求体 / 错误码映射 / polling）
  registerHypirHandlers();
  // 图像转矢量:VTracer(彩色)+ Potrace(单色)在 Node 层跑;AI 模式(OmniSVG)已于 2026-05-27 砍除
  registerVecHandlers();
  // 画板 Photoshop 联动（api:ps:*）—— 画板首个主进程 IPC 子系统，详见 CLAUDE.md §4.8
  registerPsHandlers();
  // ComfyUI 通用工作流编排器（api:comfyui:*）—— 连接 / 工作流模板 / 单次运行
  registerComfyuiConnectionHandlers();
  registerComfyuiWorkflowHandlers();
  registerComfyuiRunHandlers();
  registerComfyuiResultsHandlers();
}
