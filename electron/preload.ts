import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import type { ElectronAPI, PushChannel } from '@shared/ipc';

/**
 * 仅暴露白名单 IPC 通道。渲染进程拿不到 Node、fs、path、fetch 等任何系统能力。
 * 详见 ARCHITECTURE.md §6（安全模型）。
 */

console.log('[preload] starting; contextIsolation=', process.contextIsolated);

const PUSH_CHANNELS: ReadonlySet<PushChannel> = new Set<PushChannel>([
  'chat:chunk',
  'chat:reasoning-chunk',
  'chat:done',
  'chat:sources',
  'image:done',
  'image:progress',
  'notification:append',
  'upscale:progress',
  'upscale:done',
  'upscale:install-progress',
  'upscale:onnx-download-progress',
  // 图像转矢量 v2
  'vec:progress',
  'vec:batch-progress',
  // 画板 Photoshop 联动
  'ps:file-changed',
  // ComfyUI 编排器
  'comfyui:status',
  'comfyui:run-progress',
  'comfyui:run-done',
  'comfyui:queue',
  // AI 视频生成（异步进度 / 完成）
  'video:progress',
  'video:done',
  // 视频插帧（RIFE）
  'interp:progress',
  'interp:install-progress',
  // 资产库内容有变（产物自动入库后广播，Manager/便携资产库刷新用）
  'gallery:changed'
]);

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const api: ElectronAPI = {
  settings: {
    get: () => invoke('api:settings:get'),
    save: (input) => invoke('api:settings:save', input),
    testConnection: (input) => invoke('api:settings:test-connection', input),
    testProtocol: (input) => invoke('api:settings:test-protocol', input),
    applyOverrides: (input) => invoke('api:settings:apply-overrides', input)
  },
  plan: {
    list: () => invoke('api:plan:list'),
    upsert: (input) => invoke('api:plan:upsert', input),
    delete: (id) => invoke('api:plan:delete', id),
    configs: (planId) => invoke('api:plan:configs', planId),
    configDelete: (id) => invoke('api:plan:config:delete', id)
  },
  chat: {
    send: (input) => invoke('api:chat:send', input),
    sendEphemeral: (input) => invoke('api:chat:send-ephemeral', input),
    cancel: (messageId) => invoke('api:chat:cancel', messageId),
    create: (input) => invoke('api:chat:create', input),
    list: () => invoke('api:chat:list'),
    history: (id) => invoke('api:chat:history', id),
    rename: (input) => invoke('api:chat:rename', input),
    delete: (id) => invoke('api:chat:delete', id),
    clearAll: () => invoke('api:chat:clear-all'),
    optimizePrompt: (input) => invoke('api:chat:optimize-prompt', input)
  },
  image: {
    generate: (input) => invoke('api:image:generate', input),
    status: (id) => invoke('api:image:status', id),
    cancel: (id) => invoke('api:image:cancel', id),
    queue: () => invoke('api:image:queue')
  },
  video: {
    generate: (input) => invoke('api:video:generate', input),
    cancel: (taskId) => invoke('api:video:cancel', taskId),
    saveThumbnail: (input) => invoke('api:video:save-thumbnail', input),
    uploadAsset: (input) => invoke('api:video:upload-asset', input),
    scale: (input) => invoke('api:video:scale', input),
    edit: (input) => invoke('api:video:edit', input)
  },
  interp: {
    status: () => invoke('api:interp:status'),
    installEngine: (input) => invoke('api:interp:install-engine', input ?? {}),
    removeEngine: () => invoke('api:interp:remove-engine'),
    run: (input) => invoke('api:interp:run', input),
    cancel: (input) => invoke('api:interp:cancel', input ?? {})
  },
  gallery: {
    list: (input) => invoke('api:gallery:list', input),
    detail: (id) => invoke('api:gallery:detail', id),
    update: (input) => invoke('api:gallery:update', input),
    importFromBuffer: (input) => invoke('api:gallery:import-from-buffer', input),
    importFiles: (input) => invoke('api:gallery:import-files', input),
    probeMissingFiles: (input) => invoke('api:gallery:probe-missing-files', input),
    batchDeleteWithFiles: (input) => invoke('api:gallery:batch-delete-with-files', input),
    listGroups: () => invoke('api:gallery:list-groups'),
    setGroup: (input) => invoke('api:gallery:set-group', input)
  },
  // 提示词卡片：提示词管家 UI 2026-06-12 复活（/manager 提示词视图 + 画布提示词库弹窗共用）
  prompt: {
    list: (input) => invoke('api:prompt:list', input),
    upsert: (input) => invoke('api:prompt:upsert', input),
    delete: (id) => invoke('api:prompt:delete', id),
    categoryList: () => invoke('api:prompt:category:list')
  },
  album: {
    list: () => invoke('api:album:list'),
    upsert: (input) => invoke('api:album:upsert', input),
    delete: (id) => invoke('api:album:delete', id)
  },
  // 实验室页面已下线；reverse/translate 后端保留（智能画布 LLM 节点「图片反推」复用 reverse）
  lab: {
    reverse: (input) => invoke('api:lab:reverse', input),
    translate: (input) => invoke('api:lab:translate', input),
    history: (input) => invoke('api:lab:history', input)
  },
  theme: {
    list: () => invoke('api:theme:list'),
    save: (input) => invoke('api:theme:save', input)
  },
  storage: {
    selectFolder: () => invoke('api:storage:select'),
    pickImages: () => invoke('api:storage:pick-images'),
    pickFile: (input) => invoke('api:storage:pick-file', input),
    pickFiles: (input) => invoke('api:storage:pick-files', input),
    showInFolder: (filePath) => invoke('api:storage:show-in-folder', filePath),
    openPath: (input) => invoke('api:storage:open-path', input),
    saveTempImage: (input) => invoke('api:storage:save-temp-image', input),
    saveTempText: (input) => invoke('api:storage:save-temp-text', input),
    pathInfo: (input) => invoke('api:storage:path-info', input),
    saveAs: (input) => invoke('api:storage:save-as', input),
    saveCanvasAsset: (input) => invoke('api:storage:save-canvas-asset', input),
    listImages: (input) => invoke('api:storage:list-images', input),
    copyInto: (input) => invoke('api:storage:copy-into', input),
    openUrl: (url) => invoke('api:storage:open-url', url),
    scanLoras: () => invoke('api:storage:scan-loras'),
    openConfigFolder: () => invoke('api:storage:open-config-folder')
  },
  web: {
    pagePreview: (input) => invoke('api:web:page-preview', input)
  },
  shortcuts: {
    launchExe: (input) => invoke('api:shortcuts:launch-exe', input),
    getFileIcon: (input) => invoke('api:shortcuts:get-file-icon', input),
    openWith: (input) => invoke('api:shortcuts:open-with', input)
  },
  llm: {
    status: () => invoke('api:llm:status'),
    stop: () => invoke('api:llm:stop')
  },
  tools: {
    saveOutput: (input) => invoke('api:tools:save-output', input)
  },
  vec: {
    runVtracer: (input) => invoke('api:vec:run-vtracer', input),
    runPotrace: (input) => invoke('api:vec:run-potrace', input),
    runBatch: (input) => invoke('api:vec:run-batch', input),
    pauseBatch: (input) => invoke('api:vec:pause-batch', input),
    resumeBatch: (input) => invoke('api:vec:resume-batch', input),
    cancelBatch: (input) => invoke('api:vec:cancel-batch', input),
    cancelTask: (input) => invoke('api:vec:cancel-task', input),
    listBatches: () => invoke('api:vec:list-batches'),
    historyList: (input) => invoke('api:vec:history-list', input),
    historyClear: (input) => invoke('api:vec:history-clear', input),
    detectType: (input) => invoke('api:vec:detect-type', input),
    reportGet: (input) => invoke('api:vec:report-get', input),
    debugOpen: (input) => invoke('api:vec:debug-open', input)
  },
  upscale: {
    status: () => invoke('api:upscale:status'),
    installEngine: (input) => invoke('api:upscale:install-engine', input),
    installEngineFromZip: (input) => invoke('api:upscale:install-engine-from-zip', input),
    importLocalModelFiles: (input) => invoke('api:upscale:import-local-model-files', input),
    removeEngine: () => invoke('api:upscale:remove-engine'),
    installModel: (input) => invoke('api:upscale:install-model', input),
    removeModel: (input) => invoke('api:upscale:remove-model', input),
    runSingle: (input) => invoke('api:upscale:run-single', input),
    runBatch: (input) => invoke('api:upscale:run-batch', input),
    cancel: (input) => invoke('api:upscale:cancel', input ?? {}),
    onnxList: () => invoke('api:upscale:onnx-list'),
    onnxDownload: (input) => invoke('api:upscale:onnx-download', input),
    onnxRemove: (input) => invoke('api:upscale:onnx-remove', input),
    onnxImportFiles: (input) => invoke('api:upscale:onnx-import-files', input),
    onnxUnload: () => invoke('api:upscale:onnx-unload'),
    onnxPrewarm: (input) => invoke('api:upscale:onnx-prewarm', input)
  },
  config: {
    export: (input) => invoke('api:config:export', input),
    preview: (input) => invoke('api:config:preview', input),
    import: (input) => invoke('api:config:import', input),
    pickImportFile: () => invoke('api:config:pick-import-file'),
    exportImages: (input) => invoke('api:image-io:export', input),
    scanImageDir: (input) => invoke('api:image-io:scan', input),
    importImages: (input) => invoke('api:image-io:import', input)
  },
  template: {
    list: () => invoke('api:template:list'),
    save: (input) => invoke('api:template:save', input),
    remove: (input) => invoke('api:template:remove', input),
    rename: (input) => invoke('api:template:rename', input)
  },
  ps: {
    status: () => invoke('api:ps:status'),
    setConfig: (input) => invoke('api:ps:set-config', input),
    send: (input) => invoke('api:ps:send', input),
    readBack: (input) => invoke('api:ps:read-back', input),
    stopWatch: (input) => invoke('api:ps:stop-watch', input ?? {}),
    openTempDir: () => invoke('api:ps:open-temp-dir')
  },
  comfyui: {
    getConfig: () => invoke('api:comfyui:get-config'),
    setConfig: (input) => invoke('api:comfyui:set-config', input),
    detect: (input) => invoke('api:comfyui:detect', input ?? null),
    scanLaunch: (input) => invoke('api:comfyui:scan-launch', input),
    status: () => invoke('api:comfyui:status'),
    start: () => invoke('api:comfyui:start'),
    stop: () => invoke('api:comfyui:stop'),
    freeMemory: (input) => invoke('api:comfyui:free-memory', input),
    import: (input) => invoke('api:comfyui:import', input),
    refreshObjectInfo: () => invoke('api:comfyui:refresh-object-info'),
    templateList: () => invoke('api:comfyui:template:list'),
    templateGet: (input) => invoke('api:comfyui:template:get', input),
    templateUpsert: (input) => invoke('api:comfyui:template:upsert', input),
    templateDelete: (input) => invoke('api:comfyui:template:delete', input),
    runSingle: (input) => invoke('api:comfyui:run-single', input),
    runBatch: (input) => invoke('api:comfyui:run-batch', input),
    cancel: (input) => invoke('api:comfyui:cancel', input),
    skip: (input) => invoke('api:comfyui:skip', input),
    pause: () => invoke('api:comfyui:pause'),
    resume: () => invoke('api:comfyui:resume'),
    runStatus: (input) => invoke('api:comfyui:run-status', input),
    resultsGet: (input) => invoke('api:comfyui:results:get', input),
    resultsList: (input) => invoke('api:comfyui:results:list', input),
    resultsRestore: (input) => invoke('api:comfyui:results:restore', input),
    resultsDelete: (input) => invoke('api:comfyui:results:delete', input),
    resultsExport: (input) => invoke('api:comfyui:results:export', input),
    resultsToGallery: (input) => invoke('api:comfyui:results:to-gallery', input)
  },
  exporter: {
    card: (input) => invoke('api:export:card', input)
  },
  window: {
    minimize: () => invoke('api:window:minimize'),
    maximizeToggle: () => invoke('api:window:maximize-toggle'),
    close: () => invoke('api:window:close'),
    state: () => invoke('api:window:state'),
    flash: () => invoke('api:window:flash'),
    // 整窗界面缩放：webFrame 同步缩放当前渲染帧（1=100%）。setZoom 在 [0.5, 2.0] 内 clamp 并返回实际系数。
    getZoom: () => webFrame.getZoomFactor(),
    setZoom: (factor: number) => {
      const f = Math.min(2, Math.max(0.5, Math.round(factor * 100) / 100));
      webFrame.setZoomFactor(f);
      return f;
    }
  },
  drag: {
    // fire-and-forget：必须在 dragstart 同步路径里调用；主进程异步起 startDrag
    startFromDataUri: (dataUri, suggestedName) =>
      ipcRenderer.send('api:drag:start-from-data-uri', { dataUri, suggestedName }),
    startFromPath: (filePath) =>
      ipcRenderer.send('api:drag:start-from-path', { filePath })
  },
  on: (channel, handler) => {
    if (!PUSH_CHANNELS.has(channel)) {
      throw new Error(`unsupported push channel: ${channel}`);
    }
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => handler(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  }
};

try {
  contextBridge.exposeInMainWorld('electronAPI', api);
  console.log('[preload] electronAPI exposed OK');
} catch (e) {
  console.error('[preload] exposeInMainWorld failed', e);
}
