/**
 * ComfyUI 运行结果管理 IPC：列表 / 详情 / 恢复参数 / 删除 / 导出到文件夹 / 加入资产库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { register, ok, err } from './helpers';
import { makeError } from '@shared/error';
import { listRuns, getRun, deleteRuns } from '../services/comfyui/store';
import { addImagesToGallery } from '../services/comfyui/gallerySync';
import {
  ComfyuiResultsListSchema,
  ComfyuiResultsDeleteSchema,
  ComfyuiResultsExportSchema,
  ComfyuiResultsToGallerySchema,
  ComfyuiRunIdSchema
} from './schemas';

/** 收集若干 run 的输出文件绝对路径（仅存在于磁盘的）。 */
function collectOutputPaths(runIds: string[]): string[] {
  const paths: string[] = [];
  for (const id of runIds) {
    const run = getRun(id);
    for (const o of run?.outputFiles ?? []) {
      if (o.path && fs.existsSync(o.path)) paths.push(o.path);
    }
  }
  return paths;
}

export function registerComfyuiResultsHandlers(): void {
  register('api:comfyui:results:list', ComfyuiResultsListSchema, async (input) =>
    ok(listRuns(input))
  );

  register('api:comfyui:results:restore', ComfyuiRunIdSchema, async (input) => {
    const run = getRun(input.runId);
    if (!run) return err(makeError('FILE_NOT_FOUND', '运行记录不存在', { severity: 'toast' }));
    return ok({ controlValues: run.inputSnapshot ?? {} });
  });

  register('api:comfyui:results:delete', ComfyuiResultsDeleteSchema, async (input) => {
    const n = deleteRuns(input);
    return ok({ deleted: n });
  });

  // 把选中运行的输出文件复制到用户指定文件夹（重名自动加 -N）
  register('api:comfyui:results:export', ComfyuiResultsExportSchema, async (input) => {
    const paths = collectOutputPaths(input.runIds);
    if (paths.length === 0)
      return err(makeError('FILE_NOT_FOUND', '所选记录没有可导出的输出文件', { severity: 'toast' }));
    try {
      fs.mkdirSync(input.outputDir, { recursive: true });
    } catch (e) {
      return err(
        makeError('FILE_PERMISSION', `无法写入目录：${(e as Error).message}`, { severity: 'toast' })
      );
    }
    let copied = 0;
    for (const src of paths) {
      const base = path.basename(src);
      let dest = path.join(input.outputDir, base);
      let n = 2;
      while (fs.existsSync(dest)) {
        const ext = path.extname(base);
        dest = path.join(input.outputDir, `${base.slice(0, -ext.length || undefined)}-${n++}${ext}`);
        if (n > 9999) break;
      }
      try {
        fs.copyFileSync(src, dest);
        copied++;
      } catch {
        /* 跳过单个失败 */
      }
    }
    return ok({ copied });
  });

  // 把选中运行的输出图加入资产库（去重在 addImagesToGallery 里做；自动同步过的不会重复）
  register('api:comfyui:results:to-gallery', ComfyuiResultsToGallerySchema, async (input) => {
    let added = 0;
    for (const id of input.runIds) {
      const run = getRun(id);
      added += await addImagesToGallery(run?.outputFiles, {
        paramsJson: run?.parameterSnapshot ? JSON.stringify(run.parameterSnapshot) : null
      });
    }
    if (added === 0)
      return ok({ added: 0 }); // 可能都已自动入库——不当成错误
    return ok({ added });
  });
}
