import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { localPathToImageUrl, thumbUrlFromOriginalPath } from '@/lib/imageUrl';
import { toast } from '@/store/toastStore';
import {
  buildPalettePrompt,
  colorName,
  colorValueStrings,
  deriveScheme,
  hexToRgb,
  rgbToHex,
  paletteCopyAllText,
  PALETTE_SCHEME_HINTS
} from '@/lib/paletteColor';
import { extractPaletteFromImage } from '@/lib/paletteExtract';
import { buildAse, buildAco, bytesToDataUri } from '@/lib/swatchExport';
import {
  PALETTE_MODE_LABELS,
  PALETTE_SCHEME_LABELS,
  type PaletteColorEntry,
  type PaletteMode,
  type PaletteNodeData,
  type PaletteScheme,
  type SmartNodeData
} from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { SegmentedControl } from '../nodePanel/consoleControls';
import { CopyButton, ToPromptButton, copyText, areaMenu, makePromptNodeFrom, useFitNodeToContent } from '../nodeArea';

const SCHEMES = Object.keys(PALETTE_SCHEME_LABELS) as PaletteScheme[];
const COUNTS = [2, 3, 4, 5, 6, 8, 10, 12];

function imgUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : localPathToImageUrl(src);
}

/**
 * 取样用 URL：本地路径优先取 512px 缩略图（巨图也飞快），data: 直接用。
 * 提取走 createImageBitmap 缩解码，绝不整张解原图（防卡死）。
 */
function sampleUrl(src?: string): string | null {
  if (!src) return null;
  return src.startsWith('data:') ? src : thumbUrlFromOriginalPath(src);
}

/** 两组颜色是否等价：长度同 + 每项 hex 同 + pct 取整同（替代逐次 JSON.stringify 深比较）。 */
function sameColors(a: PaletteColorEntry[], b: PaletteColorEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].hex !== b[i].hex) return false;
    if (Math.round(a[i].pct ?? 0) !== Math.round(b[i].pct ?? 0)) return false;
  }
  return true;
}

/** 调色模式里方案标签（喂提示词的「色彩关系为…」一句）。 */
function schemeLabelOf(d: PaletteNodeData): string | undefined {
  return d.mode === 'scheme' ? PALETTE_SCHEME_LABELS[d.scheme] : undefined;
}

/** 按最新 data 重算 colors（仅调色模式）与 generatedPrompt。 */
function recompute(next: PaletteNodeData): PaletteNodeData {
  if (next.mode === 'scheme') {
    next.colors = deriveScheme(next.baseHex, next.scheme, next.count).map((hex) => ({ hex }));
  }
  next.generatedPrompt = buildPalettePrompt(next.colors, {
    includeValues: next.promptIncludeValues,
    schemeLabel: schemeLabelOf(next)
  });
  return next;
}

/**
 * 配色工具节点：
 * - 提取模式：接上游图（或卡上上传）→ 本地中位切分提取 N 个主色（实时、零成本）
 * - 调色模式：基准色 + 互补/对比/邻近/分裂互补/四角/单色 方案推导
 * 每色可复制 HEX/RGB/CMYK/HSL/HSB；整板可导出 .ase/.aco 进 PS / Illustrator / CorelDRAW；
 * 实时生成配色提示词文本喂下游（与 视角/光源 同类，不直接生图）。
 */
export function PaletteNode({ id, data }: NodeProps): JSX.Element {
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const updateNodeData = useSmartCanvasStore((s) => s.updateNodeData);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const fileRef = useRef<HTMLInputElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const d = data as unknown as PaletteNodeData;
  const [sel, setSel] = useState(0);

  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const src = up.images[0] || d.inputImage?.url;
  const url = imgUrl(src);
  // 提取专用 URL：本地路径走缩略图（512px），缩略图缺失再回退原图（fallback），data: 直接用
  const extractUrl = sampleUrl(src);
  const extractFallback = src && !src.startsWith('data:') ? localPathToImageUrl(src) : undefined;

  useFitNodeToContent(id, fitRef, 46);

  function patch(p: Partial<PaletteNodeData>): void {
    const next = recompute({ ...d, ...p });
    updateNodeData(id, next as Partial<SmartNodeData>);
  }
  function loadFile(file: File | null | undefined): void {
    if (!file || !file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = () => patch({ inputImage: { url: String(r.result), name: file.name } });
    r.readAsDataURL(file);
  }

  // 提取模式：图 / 数量变化 → 去抖后本地重新提取（确定性算法，结果不变就不写，避免循环）
  useEffect(() => {
    if (d.mode !== 'extract' || !extractUrl) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void extractPaletteFromImage(extractUrl, d.count, extractFallback).then((cols) => {
        if (!alive || !cols.length) return;
        const st = useSmartCanvasStore.getState();
        const n = st.nodes.find((x) => x.id === id);
        if (!n) return;
        const cur = n.data as unknown as PaletteNodeData;
        if (cur.mode !== 'extract') return;
        if (sameColors(cur.colors, cols)) return; // 廉价浅比较，避免逐次 stringify 整个数组
        const next = { ...cur, colors: cols };
        next.generatedPrompt = buildPalettePrompt(cols, { includeValues: cur.promptIncludeValues });
        st.updateNodeData(id, next as Partial<SmartNodeData>);
      });
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [id, extractUrl, extractFallback, d.count, d.mode]);

  async function exportSwatches(fmt: 'ase' | 'aco'): Promise<void> {
    if (!d.colors.length) {
      toast.error('当前没有颜色可导出');
      return;
    }
    const entries = d.colors.map((c, i) => ({ hex: c.hex, name: `mengbi-${i + 1} ${c.hex.toUpperCase()}` }));
    const bytes = fmt === 'ase' ? buildAse(entries) : buildAco(entries);
    const r = await window.electronAPI.storage.saveAs({
      dataUri: bytesToDataUri(bytes),
      defaultName: `palette.${fmt}`,
      filters: [{ name: fmt === 'ase' ? 'Adobe Swatch Exchange' : 'Photoshop 色板', extensions: [fmt] }]
    });
    if (r.ok && r.data) toast.success('已导出色板', r.data.filePath);
    else if (!r.ok) toast.error(r.error.message, r.error.hint);
  }

  async function pickBaseFromImage(): Promise<void> {
    if (!extractUrl) {
      toast.error('先接入或上传一张图');
      return;
    }
    const cols = await extractPaletteFromImage(extractUrl, 3, extractFallback);
    if (cols.length) patch({ baseHex: cols[0].hex });
    else toast.error('取色失败', '图片无法解码');
  }

  const selIdx = Math.min(sel, Math.max(0, d.colors.length - 1));
  const selColor: PaletteColorEntry | undefined = d.colors[selIdx];

  return (
    <>
      <NodeResizer isVisible minWidth={250} minHeight={300} />
      <NodeShell title="配色工具" accent="is-palette" inputs outputs fill onDelete={() => remove(id)} label={d.label} labelColor={d.labelColor}>
        <div ref={fitRef} className="mb-sc-fit">
          <div className="nodrag">
            <SegmentedControl
              value={d.mode}
              options={(Object.keys(PALETTE_MODE_LABELS) as PaletteMode[]).map((m) => ({ value: m, label: PALETTE_MODE_LABELS[m] }))}
              onChange={(v) => {
                setSel(0);
                patch({ mode: v as PaletteMode });
              }}
            />
          </div>

          {d.mode === 'extract' ? (
            <>
              {/* 不渲染原图预览：巨图整张栅格化会卡死，提取走 createImageBitmap 缩解码即可 */}
              {up.images[0] ? (
                <div className="mb-sc-fromup is-fed nodrag">图片由上游输入（实时），本节点上传已禁用</div>
              ) : (
                <div className="mb-sc-angle-uploadrow">
                  <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" onClick={() => fileRef.current?.click()}>
                    {url ? '换图' : '上传图片'}
                  </button>
                  {!url && <span className="mb-sc-pal-hint">接入上游图片或上传一张图开始提取</span>}
                </div>
              )}
              <div className="mb-sc-light-selrow nodrag">
                <label className="mb-sc-flabel">提取数量</label>
                <select className="mb-select" value={String(d.count)} onChange={(e) => patch({ count: Number(e.target.value) })}>
                  {COUNTS.map((c) => (
                    <option key={c} value={String(c)}>
                      {c} 色
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className="mb-sc-light-selrow nodrag">
                <label className="mb-sc-flabel">基准色</label>
                <div className="mb-sc-pal-baserow">
                  <input
                    type="color"
                    className="mb-sc-pal-picker nodrag"
                    value={d.baseHex}
                    onChange={(e) => patch({ baseHex: e.target.value.toUpperCase() })}
                    title="点击拾色"
                  />
                  <HexInput value={d.baseHex} onCommit={(v) => patch({ baseHex: v })} />
                  {url && (
                    <button className="mb-btn mb-btn-sm mb-btn-ghost nodrag" title="从接入/上传的图片里取主色作基准色" onClick={() => void pickBaseFromImage()}>
                      取图主色
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-sc-light-selrow nodrag">
                <label className="mb-sc-flabel">方案</label>
                <select
                  className="mb-select"
                  value={d.scheme}
                  title={PALETTE_SCHEME_HINTS[d.scheme]}
                  onChange={(e) => {
                    setSel(0);
                    patch({ scheme: e.target.value as PaletteScheme });
                  }}
                >
                  {SCHEMES.map((s) => (
                    <option key={s} value={s}>
                      {PALETTE_SCHEME_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              {(d.scheme === 'analogous' || d.scheme === 'monochrome') && (
                <div className="mb-sc-light-selrow nodrag">
                  <label className="mb-sc-flabel">取色数</label>
                  <select className="mb-select" value={String(d.count)} onChange={(e) => patch({ count: Number(e.target.value) })}>
                    {COUNTS.map((c) => (
                      <option key={c} value={String(c)}>
                        {c} 色
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mb-sc-pal-hint nodrag">{PALETTE_SCHEME_HINTS[d.scheme]}</div>
            </>
          )}

          {d.colors.length > 0 && (
            <>
              <div className="mb-sc-pal-swatches nodrag">
                {d.colors.map((c, i) => (
                  <button
                    key={`${c.hex}-${i}`}
                    className={`mb-sc-pal-chip ${i === selIdx ? 'is-sel' : ''}`}
                    style={{ background: c.hex }}
                    title={`${colorName(c.hex)} ${c.hex.toUpperCase()}${typeof c.pct === 'number' ? ` · 占比约 ${Math.round(c.pct)}%` : ''}\n点击查看色值 · 双击复制 HEX · 右键复制各格式`}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => copyText(c.hex.toUpperCase())}
                    onContextMenu={(e) =>
                      areaMenu(
                        e,
                        colorValueStrings(c.hex).map((v) => ({
                          label: `复制 ${v.label}：${v.value}`,
                          onClick: () => copyText(v.value)
                        }))
                      )
                    }
                  />
                ))}
              </div>

              {selColor && (
                <div className="mb-sc-pal-vals nodrag">
                  <div className="mb-sc-pal-valhead">
                    <span className="mb-sc-pal-dot" style={{ background: selColor.hex }} />
                    {colorName(selColor.hex)}
                    {typeof selColor.pct === 'number' ? ` · 占比约 ${Math.round(selColor.pct)}%` : ''}
                  </div>
                  {colorValueStrings(selColor.hex).map((v) => (
                    <div key={v.label} className="mb-sc-pal-valrow">
                      <span className="mb-sc-pal-vallabel">{v.label}</span>
                      <code className="mb-sc-pal-valcode">{v.value}</code>
                      <button className="mb-btn mb-btn-sm mb-btn-ghost" title={`复制 ${v.label} 色值`} onClick={() => copyText(v.value)}>
                        复制
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-sc-pal-actions nodrag">
                <button className="mb-btn mb-btn-sm mb-btn-ghost" title="把全部颜色的全部色值复制为文本" onClick={() => copyText(paletteCopyAllText(d.colors))}>
                  复制全部
                </button>
                <button
                  className="mb-btn mb-btn-sm mb-btn-ghost"
                  title="Adobe Swatch Exchange：Photoshop / Illustrator / InDesign / 新版 CorelDRAW 可直接导入"
                  onClick={() => void exportSwatches('ase')}
                >
                  导出 .ase
                </button>
                <button
                  className="mb-btn mb-btn-sm mb-btn-ghost"
                  title="Photoshop 色板文件：色板面板 → 载入色板 直接用"
                  onClick={() => void exportSwatches('aco')}
                >
                  导出 .aco
                </button>
              </div>
            </>
          )}

          <label className="mb-sc-switch-row nodrag">
            <input type="checkbox" checked={d.promptIncludeValues} onChange={(e) => patch({ promptIncludeValues: e.target.checked })} />
            提示词附 HEX 色值
          </label>

          {d.generatedPrompt && (
            <div className="mb-sc-arearel">
              <CopyButton onClick={() => copyText(d.generatedPrompt)} title="复制配色提示词" />
              <div
                className="mb-sc-angle-prompt nodrag"
                title="右键：复制 / 用输出建提示词节点"
                onContextMenu={(e) =>
                  areaMenu(e, [
                    { label: '复制提示词', onClick: () => copyText(d.generatedPrompt) },
                    { label: '用输出建提示词节点', onClick: () => makePromptNodeFrom(id, d.generatedPrompt) }
                  ])
                }
              >
                {d.generatedPrompt}
              </div>
              <ToPromptButton onClick={() => makePromptNodeFrom(id, d.generatedPrompt)} title="把配色提示词导入一个下游提示词节点" />
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              loadFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </NodeShell>
    </>
  );
}

/** HEX 文本输入：编辑期自由输入，失焦/回车校验合法才提交（非法回退原值）。 */
function HexInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }): JSX.Element {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const commit = (): void => {
    const rgb = hexToRgb(txt);
    if (rgb) onCommit(rgbToHex(rgb.r, rgb.g, rgb.b));
    else setTxt(value);
  };
  return (
    <input
      className="mb-input mb-sc-pal-hex nodrag"
      value={txt}
      spellCheck={false}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}
