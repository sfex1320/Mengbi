/**
 * 从 LLM 回复里提取「纯 JSON 提示词」（renderer，纯函数、可单测）。
 * 模型常把 JSON 包在 ```json 围栏里、或前后加说明文字；这里 best-effort 清洗：
 *   1) 去掉 markdown 代码围栏；
 *   2) 从首个 { / [ 起按「字符串/转义感知」扫描，截出首个平衡的 JSON 块（剥前后赘文）；
 *   3) JSON.parse 校验：成功 → 规范化美化（2 空格缩进，节点上更易读）；失败 → 退回去围栏后的文本。
 * 永不抛错、永不丢内容（拿不到 JSON 就原样返回 trim 文本）。
 */

/** 去掉整段被 ``` / ```json / ```JSON 围栏包裹的代码块，取内层；否则原样返回。 */
function stripCodeFence(s: string): string {
  const t = s.trim();
  if (!t.startsWith('```')) return t;
  // 去掉首行围栏（可带语言标记，如 ```json），再去掉结尾围栏
  const withoutOpen = t.replace(/^```[^\n]*\n?/, '');
  const close = withoutOpen.lastIndexOf('```');
  return (close === -1 ? withoutOpen : withoutOpen.slice(0, close)).trim();
}

/**
 * 从字符串里截出首个平衡的 JSON 块（对象或数组）。识别字符串字面量与转义，
 * 不被内部的 { } [ ] 或引号干扰。找不到返回 null。
 */
function sliceFirstJsonBlock(s: string): string | null {
  let start = -1;
  let open = '';
  let close = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      start = i;
      open = '{';
      close = '}';
      break;
    }
    if (s[i] === '[') {
      start = i;
      open = '[';
      close = ']';
      break;
    }
  }
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // 不平衡（被截断）→ 交由调用方走 best-effort
}

/** 主入口：把 LLM 回复清成纯 JSON 字符串（best-effort，永不抛）。 */
export function extractJsonBlock(text: string): string {
  if (typeof text !== 'string') return '';
  const unfenced = stripCodeFence(text);
  const block = sliceFirstJsonBlock(unfenced);
  if (block !== null) {
    try {
      return JSON.stringify(JSON.parse(block), null, 2);
    } catch {
      return block.trim(); // 截到了块但解析失败 → 退回该块原文
    }
  }
  return unfenced.trim(); // 没有 JSON 块 → 退回去围栏后的文本
}
