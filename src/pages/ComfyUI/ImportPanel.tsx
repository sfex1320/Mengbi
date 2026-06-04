import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from '@/store/toastStore';
import { confirmDialog } from '@/components/ConfirmDialog';
import { useComfyuiStore } from '@/store/comfyuiStore';
import { CustomSelect } from '@/components/CustomSelect';
import type { WorkflowTemplateSummary } from '@shared/comfyui';

export function ImportPanel(): JSX.Element {
  const {
    importText,
    setImportText,
    setActiveWorkflow,
    activeWorkflowId,
    activeWorkflowName,
    activeGraph,
    activeControls,
    outputNodeIds,
    clearOutputNodes
  } = useComfyuiStore();
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshTemplates = useCallback(async () => {
    const r = await window.electronAPI.comfyui.templateList();
    if (r.ok) setTemplates(r.data);
  }, []);

  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);

  const doImport = useCallback(
    async (text: string, nameOverride?: string): Promise<void> => {
      if (!text.trim()) {
        toast.error('请先粘贴或拖入工作流 JSON');
        return;
      }
      setBusy(true);
      const r = await window.electronAPI.comfyui.import({ json: text });
      setBusy(false);
      if (!r.ok) {
        toast.error(r.error.message, r.error.hint);
        return;
      }
      const nodeCount = r.data.graph?.nodes.length ?? 0;
      const rec = r.data.recommended;
      setActiveWorkflow({
        id: null,
        name: nameOverride || nameInput || '未命名工作流',
        json: text,
        graph: r.data.graph,
        controls: rec?.inputControls ?? [],
        bindings: rec?.bindings ?? []
      });
      toast.success(
        '已导入 API 工作流',
        `${nodeCount} 节点 · 自动识别 ${rec?.inputControls.length ?? 0} 个可调参数`
      );
    },
    [nameInput, setActiveWorkflow]
  );

  function loadFile(file: File): void {
    if (!/\.json$/i.test(file.name)) {
      toast.error('请选择 .json 工作流文件');
      return;
    }
    // 自动用文件名（去掉 .json）填进工作流名称
    const base = file.name.replace(/\.json$/i, '');
    setNameInput(base);
    void file.text().then((text) => {
      setImportText(text);
      void doImport(text, base);
    });
  }

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  async function saveTemplate(): Promise<void> {
    const st = useComfyuiStore.getState();
    if (!st.activeWorkflowJson) {
      toast.error('请先导入工作流再保存');
      return;
    }
    const name = (nameInput || st.activeWorkflowName || '未命名工作流').trim();
    const typeTags = tagsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // 输出限定复用 output_controls 列：每个限定节点存一条 OutputControl（运行时只用 source.nodeId）
    const outputControls = st.outputNodeIds.map((id) => ({
      id: `out:${id}`,
      label: `输出 ${id}`,
      type: 'output_image' as const,
      source: { nodeId: id }
    }));
    setTplBusy(true);
    const r = await window.electronAPI.comfyui.templateUpsert({
      workflowId: st.activeWorkflowId ?? undefined,
      name,
      typeTags,
      originalApiWorkflowJson: st.activeWorkflowJson,
      inputControls: st.activeControls,
      outputControls,
      bindings: st.activeBindings,
      uiLayout: { cardOrder: st.cardOrder }
    });
    setTplBusy(false);
    if (!r.ok) {
      toast.error(r.error.message, r.error.hint);
      return;
    }
    setActiveWorkflow({
      id: r.data.workflowId,
      name,
      json: st.activeWorkflowJson,
      graph: st.activeGraph,
      controls: st.activeControls,
      bindings: st.activeBindings,
      outputNodeIds: st.outputNodeIds,
      cardOrder: st.cardOrder
    });
    toast.success('已保存为模板', name);
    void refreshTemplates();
  }

  async function loadTemplate(id: string): Promise<void> {
    setTplBusy(true);
    const r = await window.electronAPI.comfyui.templateGet({ workflowId: id });
    if (!r.ok) {
      setTplBusy(false);
      toast.error(r.error.message);
      return;
    }
    const tpl = r.data;
    const imp = await window.electronAPI.comfyui.import({ json: tpl.originalApiWorkflowJson });
    setTplBusy(false);
    // 解析失败就别半加载（否则名称已改、graph 为 null，UI 显示「已加载」却画不出图、易混淆）
    if (!imp.ok) {
      toast.error('模板解析失败，未加载', imp.error.message);
      return;
    }
    const graph = imp.data.graph;
    // 模板里存了控件/绑定就用它的；旧模板没有就用本次自动推荐
    const controls = tpl.inputControls.length ? tpl.inputControls : imp.data.recommended?.inputControls ?? [];
    const bindings = tpl.bindings.length ? tpl.bindings : imp.data.recommended?.bindings ?? [];
    // 输出限定从 output_controls 还原（source.nodeId）
    const restoredOutputNodeIds = (tpl.outputControls ?? [])
      .map((o) => o.source?.nodeId)
      .filter((v): v is string => !!v);
    const restoredCardOrder = tpl.uiLayout?.cardOrder ?? [];
    setImportText(tpl.originalApiWorkflowJson);
    setNameInput(tpl.name);
    setTagsInput((tpl.typeTags ?? []).join(', '));
    setActiveWorkflow({
      id: tpl.workflowId,
      name: tpl.name,
      json: tpl.originalApiWorkflowJson,
      graph,
      controls,
      bindings,
      outputNodeIds: restoredOutputNodeIds,
      cardOrder: restoredCardOrder
    });
    toast.success('已加载模板', tpl.name);
  }

  async function deleteTemplate(): Promise<void> {
    const st = useComfyuiStore.getState();
    if (!st.activeWorkflowId) {
      toast.error('当前工作流还不是已保存的模板');
      return;
    }
    if (!(await confirmDialog({ message: `删除模板「${st.activeWorkflowName}」？（不影响已生成的图）`, danger: true })))
      return;
    setTplBusy(true);
    const r = await window.electronAPI.comfyui.templateDelete({ workflowId: st.activeWorkflowId });
    setTplBusy(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    // 解除模板关联但保留当前已加载的工作流可继续用
    setActiveWorkflow({
      id: null,
      name: st.activeWorkflowName,
      json: st.activeWorkflowJson ?? '',
      graph: st.activeGraph,
      controls: st.activeControls,
      bindings: st.activeBindings,
      outputNodeIds: st.outputNodeIds,
      cardOrder: st.cardOrder
    });
    toast.success('已删除模板');
    void refreshTemplates();
  }

  return (
    <section
      className={`mb-cfy-import mb-card ${dragover ? 'is-dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragover(true);
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={onDrop}
    >
      <div className="mb-cfy-import-head">
        <span className="mb-cfy-section-title">工作流</span>
        {templates.length > 0 && (
          <div className="mb-cfy-tplpick">
            <CustomSelect
              value={activeWorkflowId ?? ''}
              onChange={(v) => v && void loadTemplate(v)}
              options={templates.map((t) => ({ value: t.workflowId, label: t.name }))}
              placeholder="加载已存模板…"
            />
          </div>
        )}
      </div>

      {/* 紧凑拖入区：拖 .json 或点击选择，不显示代码 */}
      <button
        type="button"
        className={`mb-cfy-drop ${dragover ? 'is-over' : ''}`}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? '导入中…' : '把 .json 工作流拖到这里，或点击选择文件'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />

      <div className="mb-cfy-import-foot">
        <input
          className="mb-input mb-cfy-name"
          placeholder="工作流名称"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
        <input
          className="mb-input mb-cfy-tags"
          placeholder="标签（逗号分隔，可选）"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
      </div>
      <div className="mb-cfy-import-foot">
        <button className="mb-btn mb-btn-sm" onClick={() => void saveTemplate()} disabled={tplBusy}>
          {tplBusy ? '处理中…' : '保存为模板'}
        </button>
        {activeWorkflowId && (
          <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void deleteTemplate()} disabled={tplBusy}>
            删除此模板
          </button>
        )}
        <button className="mb-btn mb-btn-sm mb-btn-ghost mb-cfy-jsontoggle" onClick={() => setShowJson((v) => !v)}>
          {showJson ? '收起 JSON' : '粘贴 JSON'}
        </button>
      </div>

      {showJson && (
        <>
          <textarea
            className="mb-textarea mb-cfy-import-text"
            placeholder="粘贴 ComfyUI 导出的 API Format Workflow JSON"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            spellCheck={false}
          />
          <button className="mb-btn mb-btn-sm" onClick={() => void doImport(importText)} disabled={busy}>
            导入粘贴的 JSON
          </button>
        </>
      )}

      {activeGraph && (
        <div className="mb-cfy-active-info">
          当前：<b>{activeWorkflowName || '未命名'}</b> · {activeGraph.nodes.length} 节点 ·{' '}
          {activeGraph.edges.length} 连线 · {activeControls.length} 个可调参数
          {outputNodeIds.length > 0 && (
            <>
              {' · '}输出限定 {outputNodeIds.length} 个节点{' '}
              <button type="button" className="mb-cfy-linkbtn" onClick={() => clearOutputNodes()}>
                全部
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
