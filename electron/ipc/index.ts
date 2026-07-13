import { registerSettingsHandlers } from './settings';
import { registerChatHandlers } from './chat';
import { registerGenerateHandlers } from './generate';
import { registerVideoHandlers } from './video';
import { registerGalleryHandlers } from './gallery';
// 实验室「页面」已下线，但 reverse/translate 后端保留：智能画布 LLM 节点的「图片反推」复用 api:lab:reverse
import { registerLabHandlers } from './lab';
import { registerMiscHandlers } from './misc';
import { registerDragHandlers } from './drag';
import { registerToolsHandlers } from './tools';
import { registerConfigIOHandlers } from './configIO';
import { registerImageIOHandlers } from './imageIO';
import { registerNodeTemplateHandlers } from './nodeTemplates';
import { registerLocalLlmHandlers } from './localLlm';
import { registerUpscaleHandlers } from './upscale';
import { registerInterpHandlers } from './interp';
import { registerVecHandlers } from './vec';
import { registerPsHandlers } from './ps';
import { registerComfyuiConnectionHandlers } from './comfyuiConnection';
import { registerComfyuiWorkflowHandlers } from './comfyuiWorkflow';
import { registerComfyuiRunHandlers } from './comfyuiRun';
import { registerComfyuiResultsHandlers } from './comfyuiResults';
import { registerShortcutsHandlers } from './shortcuts';
import { registerVaultHandlers } from './vault';
import { registerMcpHandlers } from './mcp';

export function registerAllIpcHandlers(): void {
  registerSettingsHandlers();
  registerChatHandlers();
  registerGenerateHandlers();
  registerVideoHandlers();
  registerGalleryHandlers();
  registerLabHandlers();
  registerMiscHandlers();
  registerDragHandlers();
  registerToolsHandlers();
  registerConfigIOHandlers();
  // 资产库图片导出 / 导入（文件夹 + 清单，api:image-io:*）
  registerImageIOHandlers();
  // 智能画布节点模板（存 userData/node-templates/，api:template:*）
  registerNodeTemplateHandlers();
  registerLocalLlmHandlers();
  registerUpscaleHandlers();
  // 视频插帧（本地 RIFE ncnn Vulkan，api:interp:*）
  registerInterpHandlers();
  // 图像转矢量:VTracer(彩色)+ Potrace(单色)在 Node 层跑;AI 模式(OmniSVG)已于 2026-05-27 砍除
  registerVecHandlers();
  // 画板 Photoshop 联动（api:ps:*）—— 画板首个主进程 IPC 子系统，详见 CLAUDE.md §4.8
  registerPsHandlers();
  // ComfyUI 通用工作流编排器（api:comfyui:*）—— 连接 / 工作流模板 / 单次运行
  registerComfyuiConnectionHandlers();
  registerComfyuiWorkflowHandlers();
  registerComfyuiRunHandlers();
  registerComfyuiResultsHandlers();
  // 侧栏外部软件 / 文件夹快捷方式（api:shortcuts:*）
  registerShortcutsHandlers();
  // Obsidian 资产库桥（api:vault:*）—— 导出/检索/读取本地 vault 里的 .md 笔记
  registerVaultHandlers();
  // MCP 服务器（api:mcp:*）—— 供 Hermes Studio 等智能体经 MCP 操作梦笔
  registerMcpHandlers();
}
