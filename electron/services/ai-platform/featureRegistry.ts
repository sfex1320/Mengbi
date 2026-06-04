/**
 * Feature Registry —— 把 SidecarManager + ModelRegistry 编排成 "AI 功能列表" 视图。
 *
 * 这层只做汇总查询；spec 的注册其实是发生在 SidecarManager.register() 上。
 * 此处提供:
 *   - listFeatures()              → 给 UI 渲染"AI 功能"表格
 *   - getFeatureStatus(id)        → 单个 feature 的"是否就绪 / 缺什么 / 服务是否在跑"
 *   - getAllFeatureStatus()       → 批量
 *
 * 失败原因尽量分类：missingSystem（Python / 脚手架 / bat 缺）vs missingModelIds（权重缺）
 * —— UI 决定要不要显示"安装"按钮、是不是只缺权重等。
 */
import { getSidecarManager } from './sidecarManager';
import type { FeatureSpec, FeatureStatus } from './types';

class FeatureRegistry {
  /** 注册 = 把 spec 塞进 SidecarManager；本类不另存一份 */
  register(spec: FeatureSpec): void {
    getSidecarManager().register(spec);
  }

  registerMany(specs: FeatureSpec[]): void {
    const mgr = getSidecarManager();
    for (const s of specs) mgr.register(s);
  }

  list(): FeatureSpec[] {
    return getSidecarManager().list();
  }

  get(id: string): FeatureSpec | undefined {
    return getSidecarManager().get(id);
  }

  /** 单个 feature 完整状态体检 */
  async getStatus(id: string): Promise<FeatureStatus> {
    const mgr = getSidecarManager();
    const spec = mgr.get(id);
    if (!spec) {
      throw new Error(`未注册的 AI feature：${id}`);
    }
    const probe = await mgr.probe(id);
    const serverStatus = await mgr.getServerStatus(id);

    const missingSystem: string[] = [];
    if (!probe.portableExists) missingSystem.push('便携包目录');
    if (!probe.pythonExists) missingSystem.push('Python 解释器');
    if (!probe.serverScaffoldExists) missingSystem.push(`server 脚手架(${spec.serverScaffoldRelPath})`);
    if (!probe.startBatExists) missingSystem.push(spec.startBat);
    for (const [bat, exists] of Object.entries(probe.installBatsExist)) {
      if (!exists) missingSystem.push(bat);
    }

    const missingModelIds = Object.entries(probe.models)
      .filter(([_, m]) => !m.exists || m.sizeMismatch)
      .map(([id]) => id);

    const installed =
      missingSystem.length === 0 && missingModelIds.length === 0;

    const summary = installed
      ? '✓ 已就绪'
      : missingSystem.length > 0
        ? `缺系统级文件：${missingSystem.slice(0, 2).join('、')}${missingSystem.length > 2 ? '…' : ''}`
        : `缺权重：${missingModelIds.join('、')}`;

    return {
      id: spec.id,
      displayName: spec.displayName,
      category: spec.category,
      experimental: !!spec.experimental,
      installed,
      serverRunning: serverStatus.reachable,
      missingModelIds,
      missingSystem,
      summary,
      probe
    };
  }

  async getAllStatus(): Promise<FeatureStatus[]> {
    const specs = this.list();
    return Promise.all(specs.map((s) => this.getStatus(s.id)));
  }
}

let singleton: FeatureRegistry | null = null;

export function getFeatureRegistry(): FeatureRegistry {
  if (!singleton) singleton = new FeatureRegistry();
  return singleton;
}

export type { FeatureRegistry };
