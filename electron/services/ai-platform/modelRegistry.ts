/**
 * Model Registry —— 所有 AI 模型权重的统一登记表。
 *
 * 设计：
 *   - 一个 ModelSpec = 一个权重(文件 / 目录) + 来源(HF / 镜像) + 用到它的 feature 列表
 *   - 同一权重可被多个 feature 复用（如 SD2.1-base 同时给 HYPIR 和某未来 inpaint feature 用）
 *   - 查询模型存在性时按 ModelSpec.relPath 拼 portableRoot 得到绝对路径
 *
 * 注意：注册表本身**不下载**模型；下载逻辑在 modelDownloader.ts（后续步骤）。
 * 这里只管"声明 / 查询 / 体检"。
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { getPortableRoot } from './pythonRuntime';
import type { ModelSpec, ModelProbe } from './types';

class ModelRegistry {
  private models = new Map<string, ModelSpec>();

  /** 注册一个模型；同 id 重复注册会覆盖 */
  register(spec: ModelSpec): void {
    this.models.set(spec.id, spec);
  }

  /** 把多条 spec 一次性灌进来 —— 启动期常用 */
  registerMany(specs: ModelSpec[]): void {
    for (const s of specs) this.register(s);
  }

  get(id: string): ModelSpec | undefined {
    return this.models.get(id);
  }

  list(): ModelSpec[] {
    return [...this.models.values()];
  }

  /** 查所有被指定 feature.id 用到的模型 */
  listForFeature(featureId: string): ModelSpec[] {
    return this.list().filter((m) => m.usedBy.includes(featureId));
  }

  /** 体检一个模型：是否在盘上 + 大小 */
  probeModel(modelId: string): ModelProbe {
    const spec = this.models.get(modelId);
    if (!spec) {
      return { id: modelId, exists: false, path: '', sizeBytes: 0 };
    }
    const root = getPortableRoot();
    const absPath = path.join(root, spec.relPath);
    if (!existsSync(absPath)) {
      return { id: modelId, exists: false, path: absPath, sizeBytes: 0 };
    }
    let size = 0;
    try {
      if (spec.isDirectory) {
        // 目录类模型：判断是否是目录就行，大小不算（diffusers 目录递归算太重）
        const st = statSync(absPath);
        if (!st.isDirectory()) {
          return { id: modelId, exists: false, path: absPath, sizeBytes: 0 };
        }
        size = 0; // 不算目录递归大小
      } else {
        size = statSync(absPath).size;
      }
    } catch {
      return { id: modelId, exists: false, path: absPath, sizeBytes: 0 };
    }
    const sizeMismatch =
      !spec.isDirectory && spec.expectedBytes > 0 && size < spec.expectedBytes * 0.95;
    return {
      id: modelId,
      exists: true,
      path: absPath,
      sizeBytes: size,
      sizeMismatch
    };
  }

  /** 体检所有模型 */
  probeAll(): ModelProbe[] {
    return this.list().map((m) => this.probeModel(m.id));
  }
}

let singleton: ModelRegistry | null = null;

export function getModelRegistry(): ModelRegistry {
  if (!singleton) singleton = new ModelRegistry();
  return singleton;
}

export type { ModelRegistry };
