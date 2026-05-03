import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ElectronAPI, PushChannel } from '@shared/ipc';

/**
 * 仅暴露白名单 IPC 通道。渲染进程拿不到 Node、fs、path、fetch 等任何系统能力。
 * 详见 ARCHITECTURE.md §6（安全模型）。
 */

console.log('[preload] starting; contextIsolation=', process.contextIsolated);

const PUSH_CHANNELS: ReadonlySet<PushChannel> = new Set<PushChannel>([
  'chat:chunk',
  'chat:done',
  'image:done',
  'image:progress',
  'update:available',
  'update:downloaded'
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
    queue: () => invoke('api:image:queue'),
    reorder: (input) => invoke('api:image:reorder', input)
  },
  gallery: {
    list: (input) => invoke('api:gallery:list', input),
    detail: (id) => invoke('api:gallery:detail', id),
    update: (input) => invoke('api:gallery:update', input)
  },
  prompt: {
    list: (input) => invoke('api:prompt:list', input),
    upsert: (input) => invoke('api:prompt:upsert', input),
    delete: (id) => invoke('api:prompt:delete', id),
    categoryList: () => invoke('api:prompt:category:list')
  },
  album: {
    list: () => invoke('api:album:list'),
    upsert: (input) => invoke('api:album:upsert', input)
  },
  lab: {
    reverse: (input) => invoke('api:lab:reverse', input),
    split: (input) => invoke('api:lab:split', input),
    compare: (input) => invoke('api:lab:compare', input),
    translate: (input) => invoke('api:lab:translate', input),
    fuse: (input) => invoke('api:lab:fuse', input),
    history: (input) => invoke('api:lab:history', input)
  },
  theme: {
    list: () => invoke('api:theme:list'),
    save: (input) => invoke('api:theme:save', input)
  },
  storage: {
    selectFolder: () => invoke('api:storage:select'),
    pickImages: () => invoke('api:storage:pick-images'),
    showInFolder: (filePath) => invoke('api:storage:show-in-folder', filePath)
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
