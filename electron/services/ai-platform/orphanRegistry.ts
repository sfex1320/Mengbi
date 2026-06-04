/**
 * 启动期孤儿 sidecar 清扫。
 *
 * 场景:上一轮 mengbi 异常退出(任务管理器强杀 / 崩溃 / 断电)→ before-quit
 * 钩子根本没跑 → Python sidecar 还活着,占着显存。本轮 mengbi 启动时检测端口,
 * 发现还有人在监听就 = 上一轮的孤儿,杀掉。
 *
 * 实现选了"端口探测"而非"PID 文件":
 *   - 不依赖文件持久化(文件可能损坏 / 路径漂移 / PID 被回收)
 *   - 不依赖 PID(Windows 上 PID 可能被新进程复用)
 *   - 端口就是事实:谁在监听 7865/7866,谁就是孤儿
 *
 * 走的是 SidecarManager.stop() 完整流程(graceful HTTP + stop bat + taskkill),
 * 所以即便 Python 还能响应 HTTP 也会被优雅退出,响应不了就强杀。
 */
import { logger } from '../logger';
import { getSidecarManager } from './sidecarManager';

export interface SweepResult {
  /** 探测到孤儿并已尝试清扫的 feature.id 列表 */
  swept: string[];
  /** 探测但拒绝清扫的 feature.id 列表（端口虽通但本轮已经 spawn,可能是同进程内部状态混乱） */
  skipped: string[];
}

export async function sweepOrphanSidecars(): Promise<SweepResult> {
  const mgr = getSidecarManager();
  const swept: string[] = [];
  const skipped: string[] = [];

  for (const spec of mgr.list()) {
    try {
      const status = await mgr.getServerStatus(spec.id);
      if (!status.reachable) continue;
      // 端口通 = 有进程在监听。判断是不是本轮 spawn 的:
      // 用 getServerStatus 之外没有公开 API 看 managed.proc,所以我们间接判断:
      // 启动期(在用户能交互之前) mgr 内部 managed.proc 必然是 null。
      // 即使是,本函数也只在 app ready 后立刻调一次,此时还没人会调 start()。
      logger.warn(
        `[ai-platform] orphan sidecar detected: feature=${spec.id} port=${spec.port} — sweeping`
      );
      try {
        const r = await mgr.stop(spec.id);
        if (r.stopped) {
          swept.push(spec.id);
          logger.info(`[ai-platform] orphan ${spec.id} stopped`);
        } else {
          skipped.push(spec.id);
          logger.warn(`[ai-platform] orphan ${spec.id} stop returned stopped=false`);
        }
      } catch (e) {
        skipped.push(spec.id);
        logger.warn(`[ai-platform] orphan ${spec.id} sweep failed: ${(e as Error).message}`);
      }
    } catch (e) {
      logger.warn(`[ai-platform] sweep probe failed for ${spec.id}: ${(e as Error).message}`);
    }
  }

  if (swept.length > 0) {
    logger.info(`[ai-platform] startup sweep killed ${swept.length} orphan sidecar(s): ${swept.join(', ')}`);
  } else {
    logger.info('[ai-platform] startup sweep: no orphan sidecars');
  }
  return { swept, skipped };
}
