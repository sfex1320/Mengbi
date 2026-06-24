/**
 * 视频模型配置中心（设置 → 视频模型）。
 * 编辑供应商（端点/超时/轮询/并发/鉴权…）与模型（能力/限制/默认参数）。
 * 持久化走 useVideoProvidersStore（settings 表 video_providers_json）；凭证仍在上方的视频模型 api_configs 里填。
 * 连接测试只做本地配置检查（不联网、不产生费用）。
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useVideoProvidersStore } from '@/store/videoProvidersStore';
import { toast } from '@/store/toastStore';
import { useVideoHistoryStore } from '@/store/videoHistoryStore';
import {
  BUILTIN_VIDEO_PROVIDERS,
  type VideoProvidersConfig,
  type VideoProviderConfig,
  type VideoModelConfig,
  type VideoModelCapabilities,
  type VideoAuthType
} from '@shared/videoProviders';
import { VIDEO_MODE_LABELS, VIDEO_TASK_STATE_LABELS, type VideoMode } from '@shared/video';

const CAP_LABELS: Record<keyof VideoModelCapabilities, string> = {
  textToVideo: '文生视频',
  imageToVideo: '图生视频',
  firstLastFrame: '首尾帧',
  referenceImages: '参考图',
  referenceVideo: '参考视频',
  referenceAudio: '参考音频',
  generateAudio: '生成音频',
  returnLastFrame: '返回末帧',
  realPerson: '真人',
  continuousVideo: '连续视频'
};
const AUTH_TYPES: VideoAuthType[] = ['bearer', 'header', 'custom'];

function clone<T>(c: T): T {
  return JSON.parse(JSON.stringify(c)) as T;
}

export function VideoProvidersCenter(): JSX.Element {
  const config = useVideoProvidersStore((s) => s.config);
  const ensureLoaded = useVideoProvidersStore((s) => s.ensureLoaded);
  const save = useVideoProvidersStore((s) => s.save);
  const resetToBuiltin = useVideoProvidersStore((s) => s.resetToBuiltin);

  const [draft, setDraft] = useState<VideoProvidersConfig>(() => clone(config));
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  // 配置（异步加载完成）变化时刷新 draft（仅在未编辑态——以 open 折叠态近似）
  useEffect(() => {
    if (!open) setDraft(clone(config));
  }, [config, open]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);

  const patch = (p: Partial<VideoProvidersConfig>): void => setDraft((d) => ({ ...d, ...p }));
  const patchProvider = (pid: string, p: Partial<VideoProviderConfig>): void =>
    setDraft((d) => ({ ...d, providers: { ...d.providers, [pid]: { ...d.providers[pid], ...p } } }));
  const patchModel = (mid: string, p: Partial<VideoModelConfig>): void =>
    setDraft((d) => ({ ...d, models: { ...d.models, [mid]: { ...d.models[mid], ...p } } }));
  const patchCap = (mid: string, key: keyof VideoModelCapabilities, val: boolean): void =>
    setDraft((d) => ({
      ...d,
      models: { ...d.models, [mid]: { ...d.models[mid], capabilities: { ...d.models[mid].capabilities, [key]: val } } }
    }));

  async function doSave(): Promise<void> {
    await save(draft);
    toast.success('视频配置中心已保存');
  }
  async function doReset(): Promise<void> {
    await resetToBuiltin();
    setDraft(clone(BUILTIN_VIDEO_PROVIDERS));
    toast.success('已恢复内置模板（含 APIMart Seedance）');
  }
  function doImport(): void {
    try {
      const parsed = JSON.parse(importText) as Partial<VideoProvidersConfig>;
      const next = clone(draft);
      if (parsed.providers) next.providers = { ...next.providers, ...parsed.providers };
      if (parsed.models) next.models = { ...next.models, ...parsed.models };
      setDraft(next);
      setShowImport(false);
      setImportText('');
      toast.success('模板已导入到草稿', '检查无误后点「保存」生效');
    } catch {
      toast.error('导入失败', 'JSON 解析错误，请检查格式');
    }
  }
  function testProvider(pid: string): void {
    const p = draft.providers[pid];
    const issues: string[] = [];
    if (!p.generationEndpoint || !p.generationEndpoint.startsWith('/')) issues.push('生成端点应以 / 开头');
    if (p.baseUrl && !/^https?:\/\//.test(p.baseUrl)) issues.push('baseUrl 不是合法 URL（留空则用视频模型凭证里的 base_url）');
    if (p.pollingInterval < 1000) issues.push('轮询间隔过小（建议 ≥2000ms）');
    if (issues.length) toast.error(`「${p.providerName}」配置检查未通过`, issues.join('；'));
    else toast.success(`「${p.providerName}」配置检查通过`, '注意：本检查不联网、不产生费用；真实可用性以生成时为准');
  }
  function addModel(): void {
    const base = clone(BUILTIN_VIDEO_PROVIDERS.models['doubao-seedance-2.0-fast']);
    const pid = Object.keys(draft.providers)[0] ?? 'seedance';
    const id = `custom-model-${Object.keys(draft.models).length + 1}`;
    base.modelId = id;
    base.displayName = '新模型';
    base.providerId = pid;
    base.isDefault = false;
    setDraft((d) => ({ ...d, models: { ...d.models, [id]: base } }));
  }
  function removeModel(mid: string): void {
    setDraft((d) => {
      const m = { ...d.models };
      delete m[mid];
      return { ...d, models: m };
    });
  }
  function addProvider(): void {
    const id = `provider-${Object.keys(draft.providers).length + 1}`;
    setDraft((d) => ({
      ...d,
      providers: {
        ...d.providers,
        [id]: {
          providerId: id,
          providerName: '新供应商',
          enabled: false,
          baseUrl: '',
          authType: 'bearer',
          generationEndpoint: '/v1/videos/generations',
          taskQueryEndpoint: '',
          cancelEndpoint: '',
          uploadEndpoint: '',
          timeout: 0, // 0 = 不限时（默认）
          pollingInterval: 8000,
          maxConcurrentTasks: 1,
          defaultModel: '',
          remark: ''
        }
      }
    }));
  }
  function removeProvider(pid: string): void {
    setDraft((d) => {
      const p = { ...d.providers };
      delete p[pid];
      return { ...d, providers: p };
    });
  }

  const providers = Object.values(draft.providers);
  const records = useVideoHistoryStore((s) => s.records);

  return (
    <div className="mb-vpc">
      <div className="mb-vpc-head">
        <button
          className="mb-btn mb-btn-ghost mb-btn-sm"
          title="高级可选：常规使用不用打开——上方「视频模型」里填 地址 + API Key + 模型映射 即可直接生成"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '▾' : '▸'} 高级（可选）：视频供应商微调（能力 / 限制 / 端点 / 费用阈值）
        </button>
        {open && (
          <div className="mb-vpc-actions">
            <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={() => setShowImport((v) => !v)}>导入模型模板</button>
            <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={doReset}>恢复默认模板</button>
            <button className="mb-btn mb-btn-primary mb-btn-sm" disabled={!dirty} onClick={() => void doSave()}>
              保存{dirty ? ' *' : ''}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mb-vpc-body">
          <div className="mb-vpc-row">
            <label className="mb-vpc-l">费用二次确认阈值（元）</label>
            <input
              className="mb-input mb-vpc-num"
              type="number"
              step="0.1"
              value={draft.costConfirmThreshold ?? 1}
              onChange={(e) => patch({ costConfirmThreshold: Number(e.target.value) })}
            />
            <label className="mb-vpc-l">
              <input type="checkbox" checked={!!draft.batchEnabled} onChange={(e) => patch({ batchEnabled: e.target.checked })} />
              允许批量任务（默认关）
            </label>
          </div>
          <div className="mb-field-hint">凭证（base_url + API Key + 模型映射）在上方「视频」配置里填；这里只配能力/端点。连接测试仅本地检查，不联网、不产生费用。</div>

          {showImport && (
            <div className="mb-vpc-import">
              <textarea
                className="mb-textarea"
                rows={5}
                placeholder='粘贴 {"providers":{...},"models":{...}} 模板 JSON'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <button className="mb-btn mb-btn-primary mb-btn-sm" onClick={doImport}>导入到草稿</button>
            </div>
          )}

          {/* 供应商 */}
          <div className="mb-vpc-sec">
            <div className="mb-vpc-sec-h">
              <h5>供应商</h5>
              <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={addProvider}>＋ 新增供应商</button>
            </div>
            {providers.map((p) => (
              <div key={p.providerId} className="mb-vpc-card">
                <div className="mb-vpc-card-h">
                  <input className="mb-input mb-vpc-name" value={p.providerName} onChange={(e) => patchProvider(p.providerId, { providerName: e.target.value })} />
                  <span className="mb-vpc-id">{p.providerId}</span>
                  <label className="mb-vpc-l">
                    <input type="checkbox" checked={p.enabled} onChange={(e) => patchProvider(p.providerId, { enabled: e.target.checked })} />
                    启用
                  </label>
                  <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => testProvider(p.providerId)}>连接测试</button>
                  <button className="mb-btn mb-btn-danger mb-btn-sm" onClick={() => removeProvider(p.providerId)}>删除</button>
                </div>
                <div className="mb-vpc-grid">
                  <Field l="baseUrl（留空=用凭证）"><input className="mb-input" value={p.baseUrl ?? ''} onChange={(e) => patchProvider(p.providerId, { baseUrl: e.target.value })} /></Field>
                  <Field l="鉴权">
                    <select className="mb-select" value={p.authType} onChange={(e) => patchProvider(p.providerId, { authType: e.target.value as VideoAuthType })}>
                      {AUTH_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Field>
                  <Field l="生成端点"><input className="mb-input" value={p.generationEndpoint} onChange={(e) => patchProvider(p.providerId, { generationEndpoint: e.target.value })} /></Field>
                  <Field l="查询端点（可空，支持 {taskId}）"><input className="mb-input" value={p.taskQueryEndpoint} onChange={(e) => patchProvider(p.providerId, { taskQueryEndpoint: e.target.value })} /></Field>
                  <Field l="取消端点（可空）"><input className="mb-input" value={p.cancelEndpoint} onChange={(e) => patchProvider(p.providerId, { cancelEndpoint: e.target.value })} /></Field>
                  <Field l="上传端点（可空）"><input className="mb-input" value={p.uploadEndpoint} onChange={(e) => patchProvider(p.providerId, { uploadEndpoint: e.target.value })} /></Field>
                  <Field l="图片上传端点（可空；站点不收 base64 时提交前自动换公网 URL）"><input className="mb-input" placeholder="如 /v1/uploads/images" value={p.imageUploadEndpoint ?? ''} onChange={(e) => patchProvider(p.providerId, { imageUploadEndpoint: e.target.value })} /></Field>
                  <Field l="超时(ms)，0 = 不限时（默认）：进行中一直等，上游报错才判失败"><input className="mb-input" type="number" value={p.timeout} onChange={(e) => patchProvider(p.providerId, { timeout: Number(e.target.value) })} /></Field>
                  <Field l="轮询(ms)"><input className="mb-input" type="number" value={p.pollingInterval} onChange={(e) => patchProvider(p.providerId, { pollingInterval: Number(e.target.value) })} /></Field>
                  <Field l="并发上限"><input className="mb-input" type="number" value={p.maxConcurrentTasks} onChange={(e) => patchProvider(p.providerId, { maxConcurrentTasks: Number(e.target.value) })} /></Field>
                  <Field l="默认模型"><input className="mb-input" value={p.defaultModel} onChange={(e) => patchProvider(p.providerId, { defaultModel: e.target.value })} /></Field>
                </div>
                <input className="mb-input mb-vpc-remark" placeholder="备注" value={p.remark ?? ''} onChange={(e) => patchProvider(p.providerId, { remark: e.target.value })} />
              </div>
            ))}
          </div>

          {/* 模型 */}
          <div className="mb-vpc-sec">
            <div className="mb-vpc-sec-h">
              <h5>模型（能力 / 限制 / 默认参数）</h5>
              <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={addModel}>＋ 新增模型</button>
            </div>
            {Object.values(draft.models).map((m) => (
              <div key={m.modelId} className="mb-vpc-card">
                <div className="mb-vpc-card-h">
                  <input className="mb-input mb-vpc-name" value={m.displayName} onChange={(e) => patchModel(m.modelId, { displayName: e.target.value })} />
                  <span className="mb-vpc-id">{m.modelId}</span>
                  <label className="mb-vpc-l"><input type="checkbox" checked={m.enabled} onChange={(e) => patchModel(m.modelId, { enabled: e.target.checked })} />启用</label>
                  <label className="mb-vpc-l"><input type="checkbox" checked={m.isDefault} onChange={(e) => patchModel(m.modelId, { isDefault: e.target.checked })} />默认</label>
                  <button className="mb-btn mb-btn-danger mb-btn-sm" onClick={() => removeModel(m.modelId)}>删除</button>
                </div>
                <div className="mb-vpc-grid">
                  <Field l="modelId（真实 id）"><input className="mb-input" value={m.modelId} disabled /></Field>
                  <Field l="供应商"><input className="mb-input" value={m.providerId} onChange={(e) => patchModel(m.modelId, { providerId: e.target.value })} /></Field>
                  <Field l="价格备注"><input className="mb-input" value={m.priceRemark ?? ''} onChange={(e) => patchModel(m.modelId, { priceRemark: e.target.value })} /></Field>
                  <Field l="每秒单价(元,可空)"><input className="mb-input" type="number" step="0.01" value={m.pricePerSecond ?? ''} onChange={(e) => patchModel(m.modelId, { pricePerSecond: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
                </div>
                <div className="mb-vpc-caps">
                  {(Object.keys(CAP_LABELS) as Array<keyof VideoModelCapabilities>).map((k) => (
                    <label key={k} className="mb-vpc-cap">
                      <input type="checkbox" checked={m.capabilities[k]} onChange={(e) => patchCap(m.modelId, k, e.target.checked)} />
                      {CAP_LABELS[k]}
                    </label>
                  ))}
                </div>
                <div className="mb-vpc-grid">
                  <Field l="时长 min"><input className="mb-input" type="number" value={m.limits.durationMin} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, durationMin: Number(e.target.value) } })} /></Field>
                  <Field l="时长 max"><input className="mb-input" type="number" value={m.limits.durationMax} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, durationMax: Number(e.target.value) } })} /></Field>
                  <Field l="分辨率(逗号)"><input className="mb-input" value={m.limits.supportedResolutions.join(',')} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, supportedResolutions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} /></Field>
                  <Field l="比例(逗号)"><input className="mb-input" value={m.limits.supportedAspectRatios.join(',')} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, supportedAspectRatios: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} /></Field>
                  <Field l="参考图上限"><input className="mb-input" type="number" value={m.limits.maxReferenceImages} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, maxReferenceImages: Number(e.target.value) } })} /></Field>
                  <Field l="参考视频上限"><input className="mb-input" type="number" value={m.limits.maxReferenceVideos} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, maxReferenceVideos: Number(e.target.value) } })} /></Field>
                  <Field l="参考音频上限"><input className="mb-input" type="number" value={m.limits.maxReferenceAudios} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, maxReferenceAudios: Number(e.target.value) } })} /></Field>
                  <Field l="音频总时长上限(s)"><input className="mb-input" type="number" value={m.limits.maxAudioDuration} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, maxAudioDuration: Number(e.target.value) } })} /></Field>
                </div>
                <div className="mb-vpc-row">
                  <label className="mb-vpc-l"><input type="checkbox" checked={m.limits.supportSeed} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, supportSeed: e.target.checked } })} />支持 seed</label>
                  <label className="mb-vpc-l"><input type="checkbox" checked={m.limits.supportNegativePrompt} onChange={(e) => patchModel(m.modelId, { limits: { ...m.limits, supportNegativePrompt: e.target.checked } })} />支持负向</label>
                </div>
                <div className="mb-vpc-grid">
                  <Field l="默认时长"><input className="mb-input" type="number" value={m.defaultParams.duration} onChange={(e) => patchModel(m.modelId, { defaultParams: { ...m.defaultParams, duration: Number(e.target.value) } })} /></Field>
                  <Field l="默认分辨率"><input className="mb-input" value={m.defaultParams.resolution} onChange={(e) => patchModel(m.modelId, { defaultParams: { ...m.defaultParams, resolution: e.target.value } })} /></Field>
                  <Field l="默认比例"><input className="mb-input" value={m.defaultParams.aspectRatio} onChange={(e) => patchModel(m.modelId, { defaultParams: { ...m.defaultParams, aspectRatio: e.target.value } })} /></Field>
                  <Field l="默认模式">
                    <select className="mb-select" value={m.defaultParams.mode} onChange={(e) => patchModel(m.modelId, { defaultParams: { ...m.defaultParams, mode: e.target.value as VideoMode } })}>
                      {(Object.keys(VIDEO_MODE_LABELS) as VideoMode[]).map((md) => <option key={md} value={md}>{VIDEO_MODE_LABELS[md]}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            ))}
          </div>

          {/* 历史 */}
          <div className="mb-vpc-sec">
            <div className="mb-vpc-sec-h">
              <h5>视频任务历史（{records.length}）</h5>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => setShowHistory((v) => !v)}>{showHistory ? '收起' : '展开'}</button>
                <button className="mb-btn mb-btn-danger mb-btn-sm" onClick={() => useVideoHistoryStore.getState().clear()}>清空</button>
              </div>
            </div>
            {showHistory && (
              <div className="mb-vpc-hist">
                {records.length === 0 ? (
                  <div className="mb-field-hint">暂无历史。生成视频后这里会留痕（成功/失败/取消/超时）。</div>
                ) : (
                  records.map((r) => (
                    <div key={r.taskId} className="mb-vpc-hrow">
                      <span className={`mb-vpc-hstat is-${r.status}`}>{VIDEO_TASK_STATE_LABELS[r.status]}</span>
                      <span className="mb-vpc-hmodel">{r.providerName} · {r.modelId}</span>
                      <span className="mb-vpc-hp" title={r.prompt}>{r.prompt || '(无提示词)'}</span>
                      <span className="mb-vpc-hmeta">{VIDEO_MODE_LABELS[r.mode]} · {r.duration}s · {r.resolution}</span>
                      {r.error && <span className="mb-vpc-herr" title={r.error}>✕ {r.error.slice(0, 60)}</span>}
                      <div className="mb-vpc-hbtns">
                        {r.prompt && <button className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => { void navigator.clipboard.writeText(r.prompt); toast.success('已复制提示词'); }}>复制词</button>}
                        {r.videoUrl && <button className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => { void navigator.clipboard.writeText(r.videoUrl ?? ''); toast.success('已复制视频 URL'); }}>复制URL</button>}
                        {r.localVideoPath && <button className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => void window.electronAPI.storage.showInFolder(r.localVideoPath ?? '')}>打开位置</button>}
                        <button className="mb-btn mb-btn-ghost mb-btn-xs" onClick={() => useVideoHistoryStore.getState().remove(r.taskId)}>删除</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ l, children }: { l: string; children: ReactNode }): JSX.Element {
  return (
    <label className="mb-vpc-f">
      <span className="mb-vpc-fl">{l}</span>
      {children}
    </label>
  );
}
