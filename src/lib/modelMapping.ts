/**
 * 模型映射判定（渲染端共用）：把 api_configs 的 model_mapping 展开成「可用/不可用」模型列表，
 * 并给出「某对话模型为何不可用」的精确原因。供 ChatPanel / 智能画布 LLM 节点 / runner 共用，
 * 避免「下拉能选到但一跑就报『不在当前方案』」的坑。
 *
 * 可用 = 该显示名在 model_mapping 里、且「实际模型 ID（映射值）」非空。
 * 后端 findConfigForModel 用 `if (map[显示名])` 解析，空值会被当成没找到——这里与之对齐。
 */
import type { ApiConfig, ApiConfigType, ApiPlan } from '@/types/domain';

export interface MappedModel {
  /** 显示名（model_mapping 的键） */
  name: string;
  /** 实际模型 ID（映射值） */
  actualId: string;
  /** 实际 ID 非空才可用 */
  usable: boolean;
  /** 所属中转站/接口名（config.provider_name），用于显示「中转站 / 模型名」区分同名模型 */
  providerName: string;
  /** 展示标签：`{中转站} / {显示名}`（provider_name 为空时退回显示名） */
  label: string;
  /**
   * 复合标识：`{中转站} / {显示名}`（provider 为空时 = 显示名）。**作为下拉 value / 存储的 modelId**，
   * 使「同名模型在不同中转站」彼此可区分——是「前缀成为名字真实组成部分」的载体（资产库 model_used、画布节点 modelId 都存它）。
   */
  ref: string;
}

/** 复合模型标识：把「中转站名 / 显示名」拼成跨应用唯一的值。provider 为空时退回显示名。 */
export function modelRefValue(providerName: string | null | undefined, name: string): string {
  const p = (providerName ?? '').trim();
  return p ? `${p} / ${name}` : name;
}

/** 解析复合模型标识 → { provider, name }。无 " / " 视为裸显示名（旧存量兼容）。 */
export function parseModelRef(ref: string): { provider: string; name: string } {
  const s = ref ?? '';
  const i = s.indexOf(' / ');
  if (i < 0) return { provider: '', name: s };
  return { provider: s.slice(0, i).trim(), name: s.slice(i + 3) };
}

/**
 * 在 configs 里按复合标识解析出 { config, actualId }（实际模型 ID）。**对旧裸名向后兼容**：
 *   1) 复合：中转站名 + 映射名 精确命中（区分同名模型）；
 *   2) 回退：按裸名（或复合名的 name 段）首个命中——等价于旧的 `map[显示名]` 首个命中逻辑，故旧存量绝不退化。
 */
export function resolveModelRef(
  configs: ApiConfig[],
  type: ApiConfigType,
  ref: string,
  planId: number | null = null
): { config: ApiConfig; actualId: string } | null {
  const { provider, name } = parseModelRef(ref);
  const pool = configs.filter((c) => c.type === type && (planId === null || c.plan_id === planId));
  const pick = (c: ApiConfig, key: string): { config: ApiConfig; actualId: string } | null => {
    const v = (c.model_mapping ?? {})[key];
    return v && v.trim() ? { config: c, actualId: v } : null;
  };
  if (provider) {
    for (const c of pool) {
      if ((c.provider_name ?? '').trim() !== provider) continue;
      const r = pick(c, name);
      if (r) return r;
    }
  }
  for (const c of pool) {
    const r = pick(c, name);
    if (r) return r;
  }
  return null;
}

/** 列出某方案下某类型（text/image/video）所有已映射模型（按复合标识去重——同名不同中转站各自保留）。 */
export function listMappedModels(
  configs: ApiConfig[],
  planId: number | null,
  type: ApiConfigType
): MappedModel[] {
  const out: MappedModel[] = [];
  const seen = new Set<string>();
  for (const c of configs) {
    if (c.type !== type) continue;
    if (planId !== null && c.plan_id !== planId) continue;
    const provider = (c.provider_name ?? '').trim();
    for (const [name, actualId] of Object.entries(c.model_mapping ?? {})) {
      const ref = modelRefValue(provider, name);
      if (seen.has(ref)) continue;
      seen.add(ref);
      const id = (actualId ?? '').trim();
      out.push({
        name,
        actualId: id,
        usable: id !== '',
        providerName: provider,
        label: provider ? `${provider} / ${name}` : name,
        ref
      });
    }
  }
  return out;
}

/** 把映射模型转成下拉选项（value=复合标识，显示「中转站 / 模型名」）：不可用项 disabled + 标注「（实际ID未填）」。 */
export function mappedModelOptions(
  models: MappedModel[]
): Array<{ value: string; label: string; disabled: boolean }> {
  return models.map((m) => ({
    value: m.ref,
    label: m.usable ? m.label : `${m.label}（实际ID未填）`,
    disabled: !m.usable
  }));
}

/**
 * 诊断「为什么这个对话模型不可用」。可用返回 null，否则返回「做什么 + 怎么办」的具体原因。
 * 顺序：未选 → 当前方案有但实际ID空 → 配在别的方案 → 其实是绘画模型 → 哪都没配。
 */
export function diagnoseChatModel(
  configs: ApiConfig[],
  plans: ApiPlan[],
  planId: number | null,
  modelId: string
): string | null {
  const id = (modelId ?? '').trim();
  if (!id) return '还没给这个节点选对话模型（右侧检查器里选一个）';

  // id 可能是复合标识「中转站 / 名」或旧裸名——两者都匹配
  const bareName = parseModelRef(id).name;
  const inActive = listMappedModels(configs, planId, 'text').find((m) => m.ref === id || m.name === id);
  if (inActive) {
    if (inActive.usable) return null;
    return `「${id}」的『实际模型 ID』为空 —— 去 设置 → 方案 → 对话模型，把它填成上游真实模型 ID（如 kimi-latest / abab6.5s-chat）`;
  }

  // 别的方案的对话配置里有
  const otherPlanIds = new Set<number>();
  for (const c of configs) {
    if (c.type !== 'text') continue;
    if (planId !== null && c.plan_id === planId) continue;
    if (Object.prototype.hasOwnProperty.call(c.model_mapping ?? {}, bareName)) otherPlanIds.add(c.plan_id);
  }
  if (otherPlanIds.size) {
    const names = [...otherPlanIds].map((pid) => plans.find((p) => p.id === pid)?.name ?? `#${pid}`);
    const cur = plans.find((p) => p.id === planId)?.name ?? '当前方案';
    return `「${id}」配在方案「${names.join('、')}」里，当前激活的是「${cur}」 —— 切换方案，或在当前方案的对话模型里也加上它`;
  }

  // 只在绘画(image)配置里
  const inImage = configs.some(
    (c) => c.type === 'image' && Object.prototype.hasOwnProperty.call(c.model_mapping ?? {}, bareName)
  );
  if (inImage) return `「${id}」是绘画模型，LLM 节点需要的是「对话(文本)模型」 —— 去 设置 加一个对话模型`;

  return `当前方案没有对话模型「${id}」 —— 去 设置 → 方案 → 对话模型 添加它`;
}
