/**
 * 文件夹输出节点（folder-output）的命名规则（纯函数 + vitest）。
 * 主进程 copy-into 还有「存在冲突自动 -2/-3」兜底；这里负责一批内部不自撞。
 */
import type { FolderNameRule } from '@/types/smartCanvas';

/** 从路径 / dataUri 提取源文件名（dataUri 无名时回退 image.png）。 */
export function srcBaseName(src: string): string {
  if (src.startsWith('data:')) {
    const m = src.match(/^data:image\/(\w+)/);
    return `image.${m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png'}`;
  }
  const name = src.split(/[\\/]/).pop() || 'image.png';
  return name.includes('.') ? name : `${name}.png`;
}

/**
 * 计算一条输出文件名。taken=本批已用名集合（调用方传同一个 Set，内部自动登记防自撞）。
 * - original：沿用源文件名，重名加 -2/-3…
 * - prefix-seq：`{prefix}-{seq 四位}` + 源扩展名
 */
export function buildOutputName(rule: FolderNameRule, prefix: string, seq: number, srcName: string, taken: Set<string>): string {
  const ext = srcName.includes('.') ? srcName.slice(srcName.lastIndexOf('.')) : '.png';
  let name: string;
  if (rule === 'prefix-seq') {
    name = `${(prefix || 'output').replace(/[\\/:*?"<>|]/g, '_')}-${String(Math.max(0, seq)).padStart(4, '0')}${ext}`;
  } else {
    name = srcName.replace(/[\\/:*?"<>|]/g, '_');
  }
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()) && i < 1000; i++) {
    candidate = `${base}-${i}${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}
