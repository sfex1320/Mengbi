import fs from 'node:fs';
import path from 'node:path';

interface ChatMockOpts {
  send: (channel: string, payload: unknown) => void;
  messageId: string;
  signal: AbortSignal;
}

interface ChatMockData {
  chunks: string[];
  delay_ms: number;
}

let cached: ChatMockData | null = null;

function loadMock(): ChatMockData {
  if (cached) return cached;
  // 在主进程 bundle 后该路径相对 out/main/main.js
  // 但 bundle 是 inlined 的，文件在 dev 模式从源码读
  const candidates = [
    path.join(__dirname, '../../electron/ipc/mocks/chat-stream.json'),
    path.join(__dirname, '../ipc/mocks/chat-stream.json'),
    path.join(process.cwd(), 'electron/ipc/mocks/chat-stream.json')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cached = JSON.parse(fs.readFileSync(p, 'utf-8')) as ChatMockData;
      return cached;
    }
  }
  // fallback：内嵌
  cached = {
    chunks: [
      '你好！',
      '我是梦笔的 ',
      'Mock 对话模型。',
      '\n\n',
      '当前没有配置真实模型，',
      '所以这一段是本地夹具回放出来的。',
      '\n\n',
      '设置 → 模型方案里加上你的 API Key 即可走真实流式。'
    ],
    delay_ms: 80
  };
  return cached;
}

export async function runMockChatStream(opts: ChatMockOpts): Promise<string> {
  const data = loadMock();
  let assembled = '';
  for (const chunk of data.chunks) {
    if (opts.signal.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    await sleep(data.delay_ms);
    assembled += chunk;
    opts.send('chat:chunk', { id: opts.messageId, delta: chunk });
  }
  return assembled;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
