/**
 * sharp 懒加载（2026-07-07 启动提速）。
 *
 * sharp 是 native 模块（libvips 绑定），顶层静态 import 会在启动注册 IPC 时就同步加载。
 * 所有主进程用到 sharp 的模块统一从这里取：首次真正处理图片时才加载，之后走模块级缓存
 * （与 localLlmServer 对 node-llama-cpp、realesrganOnnxRunner 对 onnxruntime-node 的 lazy 模式一致）。
 * 类型引用请用 `import type { Sharp } from 'sharp'`（零运行时开销）。
 */
import type SharpNS from 'sharp';

let cached: typeof SharpNS | null = null;

export async function getSharp(): Promise<typeof SharpNS> {
  if (!cached) cached = (await import('sharp')).default;
  return cached;
}
