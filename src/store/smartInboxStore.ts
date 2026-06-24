/**
 * 智能画布「收件箱」：其他模块（资产库 / 生图结果 / 工具箱 / ComfyUI）点「发送到智能画布」时，
 * 把图片塞进这里 + 路由跳 /smart-canvas。进入智能画布后消费：有打开的画布就加图片节点，
 * 没有就新建一张「导入素材」画布再加。与 toolsStore.pendingImport 同思路，内存态（不持久化）。
 */
import { create } from 'zustand';

export interface SmartInboxItem {
  /** 'image'（默认）= 落成图片节点；'prompt' = 落成提示词节点 */
  kind?: 'image' | 'prompt';
  /** 本地绝对路径或 data:URI（image 节点 src 两者都吃；路径更省内存） */
  src?: string;
  /** kind==='prompt' 时的提示词文本 */
  text?: string;
  name?: string;
}

interface SmartInboxState {
  items: SmartInboxItem[];
  push: (items: SmartInboxItem[]) => void;
  /** 取出并清空（进入智能画布时调用） */
  consume: () => SmartInboxItem[];
}

export const useSmartInboxStore = create<SmartInboxState>((set, get) => ({
  items: [],
  push: (items) => set((s) => ({ items: [...s.items, ...items] })),
  consume: () => {
    const cur = get().items;
    if (cur.length) set({ items: [] });
    return cur;
  }
}));
