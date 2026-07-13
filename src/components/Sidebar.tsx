import { NavLink, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { useImageParamsStore } from '@/store/imageParamsStore';
import {
  AiBrushIcon,
  GalleryIcon,
  CanvasIcon,
  SettingsIcon,
  ToolboxIcon,
  WorkflowIcon,
  SmartCanvasIcon,
  FolderIcon,
  PlusIcon
} from './Icon';
import logoUrl from '@/assets/mengbi-logo.png';
import { useShortcutsStore, type Shortcut, type ShortcutGroup } from '@/store/shortcutsStore';
import { promptDialog } from '@/components/ConfirmDialog';
import { openContextMenu } from './ContextMenu';
import { toast } from '@/store/toastStore';
import { electronFilePath } from '@/lib/mediaFile';
import { pathsAllFromGalleryDrag } from '@/lib/galleryNativeDrag';
import { toDataUri, sendToShortcut } from '@/lib/mediaActions';
import './Sidebar.css';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  shortcut: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '生图', icon: AiBrushIcon, shortcut: 'Ctrl+1' },
  { to: '/canvas', label: '画板', icon: CanvasIcon, shortcut: 'Ctrl+2' },
  { to: '/manager', label: '资产库', icon: GalleryIcon, shortcut: 'Ctrl+3' },
  { to: '/comfyui', label: 'ComfyUI 工作流', icon: WorkflowIcon, shortcut: 'Ctrl+4' },
  { to: '/tools', label: '工具箱', icon: ToolboxIcon, shortcut: 'Ctrl+5' },
  { to: '/smart-canvas', label: '智能画布', icon: SmartCanvasIcon, shortcut: 'Ctrl+6' }
];

/** 前 3 个快捷方式自动绑 Ctrl+7/8/9（与 App.tsx 一致；Ctrl+1..6=主功能、Ctrl+0/-/= 已被窗口缩放占用）。 */
const HOTKEY_KEYS = ['7', '8', '9'];
const APP_EXT_RE = /\.(exe|lnk|bat|com)$/i;

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}
/** 首字母色块底色（无图标时回退用），按名称 hash 稳定取色 */
function initialColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 48%, 46%)`;
}
/** 缺省图标文字：取名称「第一个单词」首字（而非单个字母）：「Visual Studio」→「V」、「123 工具」→「1」、中文→首字。 */
function firstWordInitial(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return '?';
  const word = s.match(/[A-Za-z][A-Za-z0-9]*/);
  if (word) return word[0][0].toUpperCase();
  return Array.from(s)[0] ?? '?';
}
/** 侧栏每个项的「槽位高度」= 52px 项 + 8px gap（排挤动画位移用）。 */
const SLOT = 60;
/** 哪些主功能接受「图片拖入 → 发送到该功能」。 */
const NAV_DROP = new Set(['/', '/manager', '/smart-canvas']);

/** 把图标 dataURI 等比缩到 size×size 居中（控制 localStorage 体积）。失败返回 null。 */
function downscaleDataUri(dataUri: string, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(c.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/**
 * 侧边栏：主功能按钮（NavLink） + 用户自定义「外部文件夹 / 外部软件」快捷方式 + 末尾「+」。
 * 快捷方式支持：点击打开、长按左键拖拽重排、右键菜单（自定义图标/重命名/移除）、
 * 拖文件夹/软件进侧栏自动添加、把图片/文字拖到其上（软件=打开编辑 / 文件夹=放入）、Ctrl+7… 启动。
 */
export function Sidebar(): JSX.Element {
  const shortcuts = useShortcutsStore((s) => s.shortcuts);
  const groups = useShortcutsStore((s) => s.groups);
  const order = useShortcutsStore((s) => s.order);
  const addShortcut = useShortcutsStore((s) => s.addShortcut);
  const removeShortcut = useShortcutsStore((s) => s.removeShortcut);
  const renameShortcut = useShortcutsStore((s) => s.renameShortcut);
  const reorderEntry = useShortcutsStore((s) => s.reorderEntry);
  const groupOnto = useShortcutsStore((s) => s.groupOnto);
  const removeFromGroup = useShortcutsStore((s) => s.removeFromGroup);
  const ungroup = useShortcutsStore((s) => s.ungroup);
  const renameGroup = useShortcutsStore((s) => s.renameGroup);
  const setShortcutIcon = useShortcutsStore((s) => s.setShortcutIcon);
  const navigate = useNavigate();

  const byId = (id: string): Shortcut | undefined => shortcuts.find((x) => x.id === id);
  const groupById = (id: string): ShortcutGroup | undefined => groups.find((g) => g.id === id);

  // 长按重排（pointer 事件；与「点击打开」「HTML5 内容投送」分开）。overId=松手时悬停的目标条目 id（用于「拖到一起成组」）
  const [reorder, setReorder] = useState<{ id: string; fromIdx: number; overIdx: number; overId: string | null; onTarget: boolean } | null>(null);
  const reorderRef = useRef<{ id: string; fromIdx: number; overIdx: number; overId: string | null; onTarget: boolean } | null>(null);
  const suppressClick = useRef<string | null>(null);
  // 拖拽时跟随鼠标的「虚影」位置（让用户清楚正在拖动）
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  // 内容投送 / 拖入添加 的悬停高亮
  const [dropId, setDropId] = useState<string | null>(null);
  const [addHover, setAddHover] = useState(false);
  // 分组浮窗：点击分组按钮 → 在其右侧弹出成员列表
  const [openGroup, setOpenGroup] = useState<{ id: string; x: number; y: number } | null>(null);

  // 长按 400ms 进入拖拽重排；用 window 级 pointer 监听（不依赖元素 capture，避开 framer whileTap 手势冲突）。
  function onShortcutPointerDown(e: React.PointerEvent, idx: number, id: string): void {
    if (e.button !== 0) return; // 仅左键
    const start = { x: e.clientX, y: e.clientY };
    const timer = window.setTimeout(() => beginReorder(id, idx), 400);
    function move(ev: PointerEvent): void {
      if (reorderRef.current) {
        setGhostPos({ x: ev.clientX, y: ev.clientY });
        const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(
          '.mb-sidebar-shortcut'
        ) as HTMLElement | null;
        if (el?.dataset.idx != null) {
          const overIdx = Number(el.dataset.idx);
          const overEntryId = el.dataset.entryId ?? null;
          // 悬停在「目标条目竖直中段 40%」→ 拖到一起成组；靠上/下边缘 → 重排到该位置
          const r = el.getBoundingClientRect();
          const mid = ev.clientY > r.top + r.height * 0.3 && ev.clientY < r.bottom - r.height * 0.3;
          const onTarget = mid && overEntryId !== reorderRef.current.id;
          updateOver(overIdx, overEntryId, onTarget);
        }
      } else {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (dx * dx + dy * dy > 36) cleanup(); // 长按未触发前移动>6px → 取消（当作误触/拖内容）
      }
    }
    function up(): void {
      if (reorderRef.current) {
        suppressClick.current = id; // 吞掉松手后的 click，避免误触发「打开」
        endReorder(true);
      }
      cleanup();
    }
    function cancel(): void {
      if (reorderRef.current) endReorder(false);
      cleanup();
    }
    function cleanup(): void {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
  function beginReorder(id: string, fromIdx: number): void {
    const v = { id, fromIdx, overIdx: fromIdx, overId: null, onTarget: false };
    reorderRef.current = v;
    setReorder(v);
  }
  function updateOver(overIdx: number, overId: string | null, onTarget: boolean): void {
    const cur = reorderRef.current;
    if (!cur || (cur.overIdx === overIdx && cur.overId === overId && cur.onTarget === onTarget)) return;
    const v = { ...cur, overIdx, overId, onTarget };
    reorderRef.current = v;
    setReorder(v);
  }
  function endReorder(commit: boolean): void {
    const v = reorderRef.current;
    reorderRef.current = null;
    setReorder(null);
    setGhostPos(null);
    if (!commit || !v) return;
    // 拖到另一条目「身上」（中段）→ 成组；否则按落点重排
    if (v.onTarget && v.overId && v.overId !== v.id) groupOnto(v.id, v.overId);
    else if (v.fromIdx !== v.overIdx) reorderEntry(v.fromIdx, v.overIdx);
  }

  /** 主功能按钮接收图片拖入 → 发送到该功能（生图=作参考图 / 资产库=导入 / 智能画布=收件箱）。 */
  async function onNavDropSrcs(to: string, srcs: string[]): Promise<void> {
    if (!srcs.length) return;
    if (to === '/manager') {
      const paths = srcs.filter((s) => !/^(data:|https?:|mengbi-image:)/i.test(s));
      if (!paths.length) {
        toast.info('这些图已在资产库里', '把外部图片（文件）拖到资产库才会导入');
        return;
      }
      const r = await window.electronAPI.gallery.importFiles({ paths });
      if (r.ok) {
        navigate('/manager');
        toast.success(`已导入资产库（${paths.length} 个）`);
      } else toast.error('导入失败', r.error.message);
    } else if (to === '/') {
      const refs: { path: string; dataUri: string }[] = [];
      for (const s of srcs) {
        const du = await toDataUri(s);
        if (du) refs.push({ path: /^(data:|https?:|mengbi-image:)/i.test(s) ? '' : s, dataUri: du });
      }
      if (refs.length) {
        useImageParamsStore.getState().addRefs(refs);
        navigate('/');
        toast.success(`已作为参考图送生图（${refs.length} 张）`);
      }
    } else if (to === '/smart-canvas') {
      const { useSmartInboxStore } = await import('@/store/smartInboxStore');
      const items: { src: string }[] = [];
      for (const s of srcs) {
        const du = s.startsWith('data:') ? s : await toDataUri(s);
        if (du) items.push({ src: du });
      }
      if (items.length) {
        useSmartInboxStore.getState().push(items);
        navigate('/smart-canvas');
        toast.success('已发送到智能画布');
      }
    }
  }

  async function addFolder(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (r.ok && r.data) addShortcut({ kind: 'folder', label: baseName(r.data.path), path: r.data.path });
  }

  async function addApp(): Promise<void> {
    const r = await window.electronAPI.storage.pickFile({
      filters: [{ name: '程序', extensions: ['exe', 'lnk', 'bat', 'com'] }],
      title: '选择要快捷打开的软件'
    });
    if (!r.ok || !r.data.filePath) return;
    void addAppPath(r.data.filePath);
  }

  async function addAppPath(p: string): Promise<void> {
    const label = baseName(p).replace(APP_EXT_RE, '');
    let iconDataUri: string | undefined;
    const ic = await window.electronAPI.shortcuts.getFileIcon({ filePath: p });
    if (ic.ok && ic.data.dataUri) iconDataUri = ic.data.dataUri;
    addShortcut({ kind: 'app', label, path: p, iconDataUri });
  }

  /** 拖文件夹 / 软件进侧栏空白处 → 自动添加（文件夹=folder，exe/lnk=app；其它文件忽略）。 */
  async function addDroppedPaths(paths: string[]): Promise<void> {
    const r = await window.electronAPI.storage.pathInfo({ paths });
    if (!r.ok) return;
    let added = 0;
    for (const it of r.data.items) {
      if (!it.exists) continue;
      if (it.isDir) {
        addShortcut({ kind: 'folder', label: baseName(it.path), path: it.path });
        added++;
      } else if (APP_EXT_RE.test(it.path)) {
        await addAppPath(it.path);
        added++;
      }
    }
    if (added) toast.success(`已添加 ${added} 个快捷方式`);
    else toast.info('未添加', '把文件夹或软件（exe/快捷方式）拖进来即可');
  }

  async function openShortcut(s: Shortcut): Promise<void> {
    if (s.kind === 'folder') {
      const r = await window.electronAPI.storage.openPath({ targetPath: s.path });
      if (!r.ok) toast.error('打开失败', r.error.message);
    } else if (s.kind === 'url') {
      const r = await window.electronAPI.storage.openUrl(s.path);
      if (!r.ok) toast.error('打开失败', r.error.message);
    } else {
      const r = await window.electronAPI.shortcuts.launchExe({ exePath: s.path });
      if (!r.ok) toast.error('启动失败', r.error.message);
    }
  }

  /** 添加网址链接快捷方式（点击 → 系统浏览器打开）。
   *  用 promptDialog 而非 window.prompt——后者在 Electron 渲染进程必抛，点了没反应。 */
  async function addUrl(initial?: string): Promise<void> {
    const raw = await promptDialog({ message: '输入网址（http(s)://…）', initial: initial ?? '' });
    if (!raw || !raw.trim()) return;
    let u = raw.trim();
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    const def = u.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 20);
    const name = (await promptDialog({ message: '名称（可空）', initial: def })) || def || u;
    addShortcut({ kind: 'url', label: name, path: u });
  }

  async function pickCustomIcon(s: Shortcut): Promise<void> {
    const r = await window.electronAPI.storage.pickFile({
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'ico', 'bmp', 'gif'] }],
      title: '选择图标图片'
    });
    if (!r.ok || !r.data.filePath) return;
    const du = await toDataUri(r.data.filePath);
    if (!du) {
      toast.error('读取图片失败');
      return;
    }
    const small = await downscaleDataUri(du, 64);
    setShortcutIcon(s.id, small ?? du);
  }

  async function resetIcon(s: Shortcut): Promise<void> {
    if (s.kind === 'app') {
      const ic = await window.electronAPI.shortcuts.getFileIcon({ filePath: s.path });
      setShortcutIcon(s.id, ic.ok ? ic.data.dataUri ?? undefined : undefined);
    } else {
      setShortcutIcon(s.id, undefined);
    }
  }

  function openAddMenu(e: React.MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openContextMenu({
      x: r.right + 8,
      y: r.top,
      items: [
        { label: '📁 添加文件夹快捷方式', onClick: () => void addFolder() },
        { label: '🖥 添加软件快捷方式', onClick: () => void addApp() },
        { label: '🔗 添加网址链接', onClick: () => void addUrl() }
      ]
    });
  }

  function groupMenu(e: React.MouseEvent, g: ShortcutGroup): void {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: '重命名分组',
          onClick: () =>
            void promptDialog({ message: '分组名称', initial: g.name }).then((name) => {
              if (name && name.trim()) renameGroup(g.id, name.trim());
            })
        },
        { separator: true },
        { label: '解散分组（成员回到外层）', variant: 'danger', onClick: () => ungroup(g.id) }
      ]
    });
  }

  function shortcutMenu(e: React.MouseEvent, s: Shortcut): void {
    e.preventDefault();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '打开', onClick: () => void openShortcut(s) },
        { label: '自定义图标…', onClick: () => void pickCustomIcon(s) },
        ...(s.iconDataUri ? [{ label: '恢复默认图标', onClick: () => void resetIcon(s) }] : []),
        {
          label: '重命名',
          onClick: () =>
            void promptDialog({ message: '快捷方式名称', initial: s.label }).then((name) => {
              if (name && name.trim()) renameShortcut(s.id, name.trim());
            })
        },
        { separator: true },
        { label: '移除', variant: 'danger', onClick: () => removeShortcut(s.id) }
      ]
    });
  }

  /** 内容投送（HTML5 drop）：软件项=用软件打开；文件夹项=放入。reorder 走 pointer，不在此处。 */
  function onContentDrop(e: React.DragEvent, s: Shortcut): void {
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    const files = Array.from(e.dataTransfer.files);
    const scRaw = e.dataTransfer.getData('application/mengbi-sc-node');
    const uriList = e.dataTransfer.getData('text/uri-list');
    const text = e.dataTransfer.getData('text/plain');
    if (files.length) {
      for (const f of files) {
        const p = electronFilePath(f);
        if (p) void sendToShortcut(s, { kind: 'image', src: p, name: f.name });
      }
      return;
    }
    // 应用内拖拽（资产库图 / 智能画布节点图 / 选段文字）—— 用统一 JSON 载荷，无编码歧义，优先于 uri-list
    if (scRaw) {
      try {
        const pl = JSON.parse(scRaw) as { src?: string; text?: string; name?: string };
        if (pl.src) void sendToShortcut(s, { kind: 'image', src: pl.src, name: pl.name });
        else if (pl.text) void sendToShortcut(s, { kind: 'text', text: pl.text });
      } catch {
        /* 忽略非法载荷 */
      }
      return;
    }
    // 外部来源拖拽（OS 原生图片会设 text/uri-list）→ 当图片投送
    if (uriList.trim()) {
      for (const line of uriList.split('\n')) {
        const u = line.trim();
        if (u && !u.startsWith('#')) void sendToShortcut(s, { kind: 'image', src: u });
      }
      return;
    }
    if (text.trim()) void sendToShortcut(s, { kind: 'text', text });
  }

  return (
    <aside className="mb-sidebar">
      <div className="mb-sidebar-brand" aria-label="Mengbi">
        <img src={logoUrl} alt="Mengbi" className="mb-sidebar-brand-img" draggable={false} />
      </div>

      <div className="mb-sidebar-divider" />

      <nav
        className={`mb-sidebar-nav${addHover ? ' is-sc-addhover' : ''}`}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types);
          if (types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')) {
            e.preventDefault();
            if (!addHover) setAddHover(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setAddHover(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setAddHover(false);
          const paths = Array.from(e.dataTransfer.files)
            .map((f) => electronFilePath(f))
            .filter((p): p is string => !!p);
          if (paths.length) {
            // 资产库卡片原生拖出（OS 拖拽只带 Files）误落到侧栏空白：静默忽略，
            // 不弹「未添加」提示（那是给拖文件夹/软件进来的人看的）
            if (pathsAllFromGalleryDrag(paths)) return;
            void addDroppedPaths(paths);
            return;
          }
          // 拖入网址 → 添加超链接快捷方式（点击在浏览器打开）
          const uri = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
          const url = uri.split('\n').map((l) => l.trim()).find((l) => /^https?:\/\//i.test(l));
          if (url) {
            const def = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').slice(0, 20);
            addShortcut({ kind: 'url', label: def || url, path: url });
            toast.success('已添加网址链接', def);
          }
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              draggable={false}
              title={`${item.label} (${item.shortcut})${NAV_DROP.has(item.to) ? '\n（可把图片拖到这里 → 发送到该功能）' : ''}`}
              className={({ isActive }) => `mb-sidebar-item ${isActive ? 'is-active' : ''}`}
              onDragOver={(e) => {
                if (NAV_DROP.has(item.to) && Array.from(e.dataTransfer.types).some((t) => t === 'Files' || t === 'application/mengbi-sc-node')) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.classList.add('is-navdrop');
                }
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove('is-navdrop')}
              onDrop={(e) => {
                if (!NAV_DROP.has(item.to)) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('is-navdrop');
                // 应用内拖拽（资产库图 / 智能画布节点图）：资产库本就在库→跳过；生图=作参考图 / 智能画布=收件箱
                const scRaw = e.dataTransfer.getData('application/mengbi-sc-node');
                if (scRaw) {
                  try {
                    const pl = JSON.parse(scRaw) as { src?: string };
                    if (pl.src && item.to !== '/manager') void onNavDropSrcs(item.to, [pl.src]);
                  } catch {
                    /* 非法载荷忽略 */
                  }
                  return;
                }
                // 真实 OS 文件（外部图）→ 各功能（资产库=导入）
                const filePaths = Array.from(e.dataTransfer.files)
                  .map((f) => electronFilePath(f))
                  .filter((p): p is string => !!p);
                if (filePaths.length) {
                  // 资产库卡片改 OS 原生拖出后，拖回「资产库」按钮也会带 Files——
                  // 本就在库里，跳过导入防重复收录（与旧 sc-node 载荷的跳过语义一致）
                  if (item.to === '/manager' && pathsAllFromGalleryDrag(filePaths)) {
                    toast.info('这些图已在资产库里');
                    return;
                  }
                  void onNavDropSrcs(item.to, filePaths);
                }
              }}
            >
              <motion.span
                className="mb-sidebar-item-inner"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
              >
                <Icon size={22} />
              </motion.span>
            </NavLink>
          );
        })}

        {order.map((entry, i) => {
          // 排挤位移：重排（非成组）拖动中，夹在 from..over 之间的项让出一个槽位
          let offset = 0;
          if (reorder && reorder.id !== entry.id && !reorder.onTarget && reorder.fromIdx !== reorder.overIdx) {
            const { fromIdx, overIdx } = reorder;
            if (fromIdx < overIdx && i > fromIdx && i <= overIdx) offset = -1;
            else if (fromIdx > overIdx && i >= overIdx && i < fromIdx) offset = 1;
          }
          const isGroupTarget = !!reorder?.onTarget && reorder.overId === entry.id;
          const baseCls = [
            'mb-sidebar-item',
            'mb-sidebar-shortcut',
            reorder?.id === entry.id ? 'is-sc-dragging' : '',
            isGroupTarget ? 'is-sc-grouptarget' : '',
            reorder && !reorder.onTarget && reorder.id !== entry.id && reorder.overIdx === i ? 'is-sc-over' : ''
          ];

          if (entry.type === 'group') {
            const g = groupById(entry.id);
            if (!g) return null;
            const cls = [...baseCls, 'is-sc-group'].filter(Boolean).join(' ');
            return (
              <motion.button
                key={g.id}
                type="button"
                data-idx={i}
                data-entry-id={g.id}
                className={cls}
                animate={{ y: offset * SLOT }}
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                title={`分组：${g.name}（${g.itemIds.length}）\n点击展开 · 长按拖动排序 · 右键重命名/解散`}
                onClick={(e) => {
                  if (suppressClick.current === g.id) {
                    suppressClick.current = null;
                    return;
                  }
                  const r = e.currentTarget.getBoundingClientRect();
                  setOpenGroup((cur) => (cur?.id === g.id ? null : { id: g.id, x: r.right + 8, y: r.top }));
                }}
                onContextMenu={(e) => groupMenu(e, g)}
                onPointerDown={(e) => onShortcutPointerDown(e, i, g.id)}
              >
                <motion.span className="mb-sidebar-item-inner" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}>
                  <span className="mb-sidebar-group-icon">
                    <FolderIcon size={20} />
                    <span className="mb-sidebar-group-count">{g.itemIds.length}</span>
                  </span>
                </motion.span>
              </motion.button>
            );
          }

          const s = byId(entry.id);
          if (!s) return null;
          const si = shortcuts.findIndex((x) => x.id === s.id);
          const hk = si >= 0 && si < HOTKEY_KEYS.length ? `\nCtrl+${HOTKEY_KEYS[si]}` : '';
          const cls = [...baseCls, dropId === s.id ? 'is-sc-dropcontent' : ''].filter(Boolean).join(' ');
          return (
            <motion.button
              key={s.id}
              type="button"
              data-idx={i}
              data-entry-id={s.id}
              className={cls}
              animate={{ y: offset * SLOT }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
              title={`${s.label}\n${s.path}${hk}\n（长按拖动排序 / 拖到另一项上成组 · 拖图片/文字可投送）`}
              onClick={() => {
                if (suppressClick.current === s.id) {
                  suppressClick.current = null;
                  return;
                }
                void openShortcut(s);
              }}
              onContextMenu={(e) => shortcutMenu(e, s)}
              onPointerDown={(e) => onShortcutPointerDown(e, i, s.id)}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                if (dropId !== s.id) setDropId(s.id);
              }}
              onDragLeave={() => setDropId((d) => (d === s.id ? null : d))}
              onDrop={(e) => onContentDrop(e, s)}
            >
              <motion.span className="mb-sidebar-item-inner" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}>
                {s.iconDataUri ? (
                  <img src={s.iconDataUri} alt="" className="mb-sidebar-shortcut-img" draggable={false} />
                ) : s.kind === 'folder' ? (
                  <FolderIcon size={20} />
                ) : (
                  <span className={`mb-sidebar-shortcut-initial${s.kind === 'url' ? ' is-url' : ''}`} style={{ background: initialColor(s.label) }}>
                    {s.kind === 'url' ? '🔗' : firstWordInitial(s.label)}
                  </span>
                )}
              </motion.span>
            </motion.button>
          );
        })}

        <button
          type="button"
          className="mb-sidebar-item mb-sidebar-item-add"
          title="添加外部文件夹 / 软件快捷方式（也可直接把文件夹/软件拖进来）"
          onClick={openAddMenu}
        >
          <motion.span className="mb-sidebar-item-inner" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}>
            <PlusIcon size={20} />
          </motion.span>
        </button>
      </nav>

      <NavLink
        to="/settings"
        title="设置 (Ctrl+,)"
        end
        draggable={false}
        className={({ isActive }) =>
          `mb-sidebar-item mb-sidebar-item-foot ${isActive ? 'is-active' : ''}`
        }
      >
        <motion.span
          className="mb-sidebar-item-inner"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 350, damping: 22 }}
        >
          <SettingsIcon size={20} />
        </motion.span>
      </NavLink>

      {/* 拖拽重排时跟随鼠标的虚影（让用户清楚正在拖动哪个项 / 分组） */}
      {reorder && ghostPos
        ? (() => {
            const s = shortcuts.find((x) => x.id === reorder.id);
            return (
              <div className="mb-sidebar-ghost" style={{ left: ghostPos.x - 26, top: ghostPos.y - 26 }}>
                {!s ? (
                  <FolderIcon size={22} />
                ) : s.iconDataUri ? (
                  <img src={s.iconDataUri} alt="" draggable={false} />
                ) : s.kind === 'folder' ? (
                  <FolderIcon size={22} />
                ) : (
                  <span className="mb-sidebar-shortcut-initial" style={{ background: initialColor(s.label) }}>
                    {s.kind === 'url' ? '🔗' : firstWordInitial(s.label)}
                  </span>
                )}
              </div>
            );
          })()
        : null}

      {/* 分组浮窗：列出成员，点击逐个启动；可移出 / 解散
          —— portal 到 body：侧栏/页面用了 framer transform，position:fixed 会被 transform 祖先
          变成相对定位 + 困在其层叠上下文里被正式内容盖住（铁律 27）。挂到 body 才真正脱离。 */}
      {openGroup
        ? createPortal(
            (() => {
            const g = groupById(openGroup.id);
            if (!g) return null;
            return (
              <div className="mb-sidebar-grouppop" style={{ left: openGroup.x, top: openGroup.y }} onMouseLeave={() => setOpenGroup(null)}>
                <input
                  className="mb-sidebar-grouppop-name"
                  defaultValue={g.name}
                  title="分组名称（失焦保存）"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== g.name) renameGroup(g.id, v);
                  }}
                />
                <div className="mb-sidebar-grouppop-list">
                  {g.itemIds.map((id) => {
                    const it = byId(id);
                    if (!it) return null;
                    return (
                      <button
                        key={id}
                        className="mb-sidebar-grouppop-item"
                        title={it.path}
                        onClick={() => {
                          void openShortcut(it);
                          setOpenGroup(null);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            items: [
                              { label: '打开', onClick: () => void openShortcut(it) },
                              { label: '移出分组', onClick: () => removeFromGroup(id) },
                              { separator: true },
                              { label: '移除', variant: 'danger', onClick: () => removeShortcut(id) }
                            ]
                          });
                        }}
                      >
                        {it.iconDataUri ? (
                          <img src={it.iconDataUri} alt="" draggable={false} />
                        ) : it.kind === 'folder' ? (
                          <FolderIcon size={16} />
                        ) : (
                          <span className="mb-sidebar-shortcut-initial" style={{ background: initialColor(it.label) }}>
                            {it.kind === 'url' ? '🔗' : firstWordInitial(it.label)}
                          </span>
                        )}
                        <span className="mb-sidebar-grouppop-label">{it.label}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="mb-sidebar-grouppop-ungroup" onClick={() => { ungroup(g.id); setOpenGroup(null); }}>
                  解散分组
                </button>
              </div>
            );
          })(),
            document.body
          )
        : null}
    </aside>
  );
}
