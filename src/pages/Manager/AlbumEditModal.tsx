import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { toast } from '@/store/toastStore';
import type { AlbumInput, SmartAlbumRules } from '@/types/domain';

/**
 * 相册新建 / 编辑弹窗。
 * - 手动相册：只填名字；图片靠右键「加入相册」逐张归入（写 images.album_ids）。
 * - 智能相册：填规则（评分 / 标签 / 模型 / 日期），资产库按规则实时匹配，不存成员。
 */
export function AlbumEditModal({
  value,
  availableModels,
  onClose,
  onSave
}: {
  /** null = 关闭；对象 = 打开（带 id 为编辑，无 id 为新建） */
  value: AlbumInput | null;
  availableModels: string[];
  onClose: () => void;
  onSave: (input: AlbumInput) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [type, setType] = useState<'manual' | 'smart'>('manual');
  const [minRating, setMinRating] = useState(0);
  const [tagsText, setTagsText] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // 每次打开（value 变化）时把表单同步成该相册的当前值
  useEffect(() => {
    if (!value) return;
    setName(value.name ?? '');
    setType(value.type ?? 'manual');
    const r: SmartAlbumRules = value.smart_rules ?? {};
    setMinRating(typeof r.minRating === 'number' ? r.minRating : 0);
    setTagsText(Array.isArray(r.tags) ? r.tags.join(', ') : '');
    setModels(Array.isArray(r.models) ? r.models : []);
    setDateFrom(r.dateFrom ? r.dateFrom.slice(0, 10) : '');
    setDateTo(r.dateTo ? r.dateTo.slice(0, 10) : '');
  }, [value]);

  function toggleModel(m: string): void {
    setModels((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  function handleSave(): void {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('请填写相册名称');
      return;
    }
    let smart_rules: SmartAlbumRules | null = null;
    if (type === 'smart') {
      const rules: SmartAlbumRules = {};
      if (minRating > 0) rules.minRating = minRating;
      const tags = tagsText
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (tags.length) rules.tags = tags;
      if (models.length) rules.models = models;
      if (dateFrom) rules.dateFrom = `${dateFrom}T00:00:00`;
      if (dateTo) rules.dateTo = `${dateTo}T23:59:59`;
      smart_rules = rules;
    }
    onSave({
      id: value?.id,
      name: trimmed,
      type,
      smart_rules,
      cover_image_id: value?.cover_image_id ?? null
    });
  }

  return (
    <Modal open={value !== null} onClose={onClose} title={value?.id ? '编辑相册' : '新建相册'} width={520}>
      <div className="mb-album-form">
        <label className="mb-album-field">
          <span>名称</span>
          <input
            type="text"
            className="mb-input"
            value={name}
            placeholder="相册名称，如「客户A · 海报」"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <label className="mb-album-field">
          <span>类型</span>
          <div className="mb-album-type">
            <button
              type="button"
              className={`mb-album-type-btn ${type === 'manual' ? 'is-active' : ''}`}
              onClick={() => setType('manual')}
            >
              手动相册
              <em>自己挑图归入</em>
            </button>
            <button
              type="button"
              className={`mb-album-type-btn ${type === 'smart' ? 'is-active' : ''}`}
              onClick={() => setType('smart')}
            >
              ✦ 智能相册
              <em>按规则自动收录</em>
            </button>
          </div>
        </label>

        {type === 'smart' && (
          <div className="mb-album-rules">
            <div className="mb-album-rules-hint">满足全部条件的图片会自动出现在这个相册里（实时匹配，不固定成员）。</div>

            <label className="mb-album-field">
              <span>最低评分</span>
              <select className="mb-select" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
                <option value={0}>不限</option>
                <option value={1}>≥ 1 星</option>
                <option value={2}>≥ 2 星</option>
                <option value={3}>≥ 3 星</option>
                <option value={4}>≥ 4 星</option>
                <option value={5}>= 5 星</option>
              </select>
            </label>

            <label className="mb-album-field">
              <span>标签（逗号分隔，需全部包含）</span>
              <input
                type="text"
                className="mb-input"
                value={tagsText}
                placeholder="如：人像, 赛博朋克"
                onChange={(e) => setTagsText(e.target.value)}
              />
            </label>

            <div className="mb-album-field">
              <span>模型（任选其一命中）</span>
              {availableModels.length === 0 ? (
                <div className="mb-album-models-empty">资产库里还没有模型记录</div>
              ) : (
                <div className="mb-album-models">
                  {availableModels.map((m) => (
                    <button
                      type="button"
                      key={m}
                      className={`mb-album-chip ${models.includes(m) ? 'is-active' : ''}`}
                      onClick={() => toggleModel(m)}
                    >
                      {models.includes(m) ? '✓ ' : ''}
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-album-dates">
              <label className="mb-album-field">
                <span>起始日期</span>
                <input type="date" className="mb-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="mb-album-field">
                <span>结束日期</span>
                <input type="date" className="mb-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
            </div>
          </div>
        )}

        <div className="mb-album-actions">
          <button type="button" className="mb-btn mb-btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="mb-btn mb-btn-primary" onClick={handleSave}>
            {value?.id ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
