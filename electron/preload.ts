import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
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
  'hypir:progress',
  // 通用 AI 平台底座（安装脚本进度）
  'ai-feature:install-progress',
  // 图像转矢量 v2
  'vec:progress',
  'vec:batch-progress',
  // 画板 Photoshop 联动
  'ps:file-changed',
  // ComfyUI 编排器
  'comfyui:status',
  'comfyui:run-progress',
  'comfyui:run-done',
  'comfyui:queue'
]);

function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

const api: ElectronAPI = {
  settings: {
    get: () => invoke('api:settings:get'),
    save: (input) => invoke('api:settings:save', input),
    testConnection: (input) => invoke('api:settings:test-connection', input)
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
  gallery: {
    list: (input) => invoke('api:gallery:list', input),
    detail: (id) => invoke('api:gallery:detail', id),
    update: (input) => invoke('api:gallery:update', input),
    importFromBuffer: (input) => invoke('api:gallery:import-from-buffer', input),
    probeMissingFiles: (input) => invoke('api:gallery:probe-missing-files', input),
    batchDeleteWithFiles: (input) => invoke('api:gallery:batch-delete-with-files', input)
  },
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
    saveAs: (input) => invoke('api:storage:save-as', input),
    openUrl: (url) => invoke('api:storage:open-url', url),
    scanLoras: () => invoke('api:storage:scan-loras')
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
  hypir: {
    check: (input) => invoke('api:hypir:check', input),
    probe: () => invoke('api:hypir:probe'),
    setPortablePath: (input) => invoke('api:hypir:set-portable-path', input),
    bootstrap: () => invoke('api:hypir:bootstrap'),
    startServer: () => invoke('api:hypir:start-server'),
    stopServer: () => invoke('api:hypir:stop-server'),
    serverStatus: () => invoke('api:hypir:server-status'),
    submitTask: (input) => invoke('api:hypir:submit-task', input),
    taskStatus: (input) => invoke('api:hypir:task-status', input),
    cancelTask: (input) => invoke('api:hypir:cancel-task', input),
    unloadModel: () => invoke('api:hypir:unload-model')
  },
  aiFeature: {
    list: () => invoke('api:ai-feature:list'),
    status: (input) => invoke('api:ai-feature:status', input),
    probe: (input) => invoke('api:ai-feature:probe', input),
    start: (input) => invoke('api:ai-feature:start', input),
    stop: (input) => invoke('api:ai-feature:stop', input),
    serverStatus: (input) => invoke('api:ai-feature:server-status', input),
    unloadModel: (input) => invoke('api:ai-feature:unload-model', input),
    bootstrap: () => invoke('api:ai-feature:bootstrap'),
    setPortablePath: (input) => invoke('api:ai-feature:set-portable-path', input),
    install: (input) => invoke('api:ai-feature:install', input),
    cancelInstall: (input) => invoke('api:ai-feature:cancel-install', input),
    cleanupAll: (input) => invoke('api:ai-feature:cleanup-all', input)
  },
  aiModel: {
    list: () => invoke('api:ai-model:list'),
    get: (input) => invoke('api:ai-model:get', input),
    listForFeature: (input) => invoke('api:ai-model:list-for-feature', input)
  },
  config: {
    export: (input) => invoke('api:config:export', input),
    preview: (input) => invoke('api:config:preview', input),
    import: (input) => invoke('api:config:import', input),
    pickImportFile: () => invoke('api:config:pick-import-file')
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
    state: () => invoke('api:window:state')
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
