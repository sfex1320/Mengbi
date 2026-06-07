/**
 * 扫描用户选定的 ComfyUI 文件夹，自动识别可用的启动方式。
 *
 * 纯读：只列目录 + 读 .bat 文本，**绝不执行任何东西**。
 * 启动器走 `cmd.exe /c <command>`（cwd=工作目录，见 launcher.ts）。
 *
 * 关键设计：
 *   1) **递归搜索**，不假设「python 与 main.py / 启动脚本在同一文件夹」。整合包（秋叶 aki / 绘世
 *      启动器版等）常把内置 python、ComfyUI 本体、启动脚本分散在不同子目录，甚至 python 是所选目录
 *      的兄弟文件夹。这里把所选目录树（必要时上探一层搜兄弟目录）里的：内置 python.exe、ComfyUI
 *      main.py、引用了 main.py 的启动 .bat 全找出来再两两配对。
 *   2) **命令一律用 main.py 的绝对路径**（cwd 写错也能开到文件），python 也用绝对路径（引号兜空格）。
 *      ComfyUI 以脚本自身位置算 base_path，绝对路径与 cwd 都对就最稳。
 *   3) 系统 python 往往缺 ComfyUI/整合包依赖（filelock 等）会直接崩，所以**只有在没搜到任何内置
 *      python 时才把系统 python 作为垫底候选**，避免误选。
 */
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { ComfyLaunchCandidate } from '@shared/comfyui';

const DEFAULT_HOST = '127.0.0.1:8188';
const MAX_DEPTH = 6;
const SCAN_BUDGET = 20000; // 目录项预算，挡极端大树（一次性用户操作，足够覆盖整合包）
/** 递归时跳过的重目录（与找 python / main.py / 启动脚本无关，且可能极大）。 */
const SKIP_DIRS = new Set([
  'models', 'custom_nodes', 'output', 'input', 'temp', 'cache', '.cache',
  '.git', '.github', '__pycache__', 'node_modules', 'site-packages', 'lib',
  'libs', 'web', 'user', 'workflows', '.venv', 'venv', 'tcl', 'include',
  'share', 'dlls', 'docs', 'test', 'tests', '.idea', '.vscode', 'logs', 'db'
]);

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 这个 main.py 同级是否像 ComfyUI 本体（区分插件 / 其它项目里的 main.py）。 */
function looksLikeComfyMain(dir: string): boolean {
  return (
    isDir(join(dir, 'comfy')) ||
    isFile(join(dir, 'execution.py')) ||
    isFile(join(dir, 'nodes.py')) ||
    isFile(join(dir, 'comfyui_version.py'))
  );
}

interface Walked {
  pythons: string[];
  mains: string[];
  bats: string[];
}

/** 递归走目录树（有界），收集内置 python.exe / main.py / .bat。skipAbs：跳过的绝对目录（避免重walk）。 */
function walkTree(root: string, skipAbs?: Set<string>): Walked {
  const pythons: string[] = [];
  const mains: string[] = [];
  const bats: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let budget = SCAN_BUDGET;
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    const { dir, depth } = node;
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (budget-- <= 0) return { pythons, mains, bats };
      const name = e.name;
      const full = join(dir, name);
      if (e.isFile()) {
        const lower = name.toLowerCase();
        if (lower === 'python.exe') {
          // venv 的 python 在 Scripts\ 下，单独走 findVenvPython，不当成「内置 python」
          if (basename(dir).toLowerCase() !== 'scripts') pythons.push(full);
        } else if (lower === 'main.py') {
          mains.push(full);
        } else if (depth <= 2 && lower.endsWith('.bat')) {
          bats.push(full);
        }
      } else if (
        e.isDirectory() &&
        depth < MAX_DEPTH &&
        !SKIP_DIRS.has(name.toLowerCase()) &&
        !skipAbs?.has(full.toLowerCase())
      ) {
        stack.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return { pythons, mains, bats };
}

/** 内置 python 排序：python_embeded / 含 embed 最佳；名为 python 次之；runtime/py 再次；越浅越优先。 */
function pythonRank(p: string): number {
  const lower = p.toLowerCase();
  const folder = basename(dirname(lower)); // python.exe 所在文件夹名
  let tier = 5;
  if (lower.includes('python_embeded') || lower.includes('python_embedded') || lower.includes('embed')) tier = 0;
  else if (folder === 'python') tier = 1;
  else if (folder === 'py' || folder === 'runtime' || /^py3\d/.test(folder)) tier = 2;
  return tier * 1000 + p.split(/[\\/]/).length; // 同档浅层优先
}

/** .bat 是否是启动脚本（内容引用 main.py）。过滤掉 update / 安装类无关 bat。 */
function isLaunchBat(p: string): boolean {
  try {
    return /main\.py/i.test(readFileSync(p, 'utf8'));
  } catch {
    return false;
  }
}

/** 从 .bat 文本抠 --listen / --port，拼连接用 host（0.0.0.0 / 空 → 127.0.0.1）；读不到就默认。 */
function hostFromBat(batPath: string): string {
  let text = '';
  try {
    text = readFileSync(batPath, 'utf8');
  } catch {
    return DEFAULT_HOST;
  }
  const portM = /--port[=\s]+(\d{2,5})/i.exec(text);
  const listenM = /--listen[=\s]+([\d.]+)/i.exec(text);
  const port = portM ? portM[1] : '8188';
  let listen = listenM ? listenM[1] : '127.0.0.1';
  if (listen === '0.0.0.0' || listen === '') listen = '127.0.0.1';
  return `${listen}:${port}`;
}

/** 在 dir 下找 venv 的 python（Windows 优先），返回绝对路径或 null。 */
function findVenvPython(dir: string): string | null {
  const cands = [
    join(dir, 'venv', 'Scripts', 'python.exe'),
    join(dir, '.venv', 'Scripts', 'python.exe'),
    join(dir, 'venv', 'bin', 'python'),
    join(dir, '.venv', 'bin', 'python')
  ];
  for (const c of cands) if (isFile(c)) return c;
  return null;
}

/** .bat 排序：run_nvidia_gpu 最常用排最前，fast 变体次之，cpu 垫底。 */
function batRank(f: string): number {
  const l = f.toLowerCase();
  if (l.includes('nvidia') && !l.includes('fast')) return 0;
  if (l.includes('nvidia')) return 1;
  if (l.includes('cpu')) return 3;
  return 2;
}

/** 路径深度（分隔符数），用于「浅层优先」。 */
function depthOf(p: string): number {
  return p.split(/[\\/]/).length;
}

export function scanComfyLaunch(rawDir: string): ComfyLaunchCandidate[] {
  const out: ComfyLaunchCandidate[] = [];
  const dir = (rawDir ?? '').trim();
  if (!dir || !existsSync(dir)) return out;

  const seen = new Set<string>();
  const push = (c: ComfyLaunchCandidate): void => {
    const key = `${c.command}|${c.cwd}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };

  const walked = walkTree(dir);
  // 内置 python 可能在所选目录的兄弟文件夹（启动脚本/本体与 python 分离的整合包）→ 没找到就上探一层，
  // 但跳过已 walk 过的所选目录，避免在巨大的本体目录里耗尽预算而漏掉兄弟目录里的 python。
  if (walked.pythons.length === 0) {
    const parent = dirname(dir);
    if (parent && parent !== dir) {
      walked.pythons = walkTree(parent, new Set([dir.toLowerCase()])).pythons;
    }
  }

  const rankedPy = [...new Set(walked.pythons)].sort((a, b) => pythonRank(a) - pythonRank(b));

  // main.py：优先「像 ComfyUI 本体」的，没有就退而用全部；浅层优先；最多取 2 个，避免插件 main 干扰
  const allMains = [...new Set(walked.mains)];
  const comfyMains = allMains.filter((m) => looksLikeComfyMain(dirname(m)));
  const chosenMains = (comfyMains.length ? comfyMains : allMains)
    .sort((a, b) => depthOf(a) - depthOf(b))
    .slice(0, 2);

  // —— A. 启动脚本（.bat 内容引用 main.py）：整合包/官方现成命令，最稳，排最前 ——
  const launchBats = [...new Set(walked.bats)]
    .filter(isLaunchBat)
    .sort((a, b) => batRank(basename(a)) - batRank(basename(b)) || a.localeCompare(b));
  for (const bat of launchBats) {
    push({
      kind: 'portable-bat',
      label: `启动脚本 · ${basename(bat)}`,
      command: `"${basename(bat)}"`,
      cwd: dirname(bat), // bat 内部多用相对路径，以它自身所在目录为工作目录
      host: hostFromBat(bat)
    });
  }

  // —— B. 内置 python × ComfyUI main.py 配对（两者可分处不同文件夹；main.py 用绝对路径，cwd 无关也能开）——
  for (const main of chosenMains) {
    const mainDir = dirname(main);
    rankedPy.forEach((py, i) => {
      push({
        kind: 'portable-python',
        label:
          (i === 0 ? '内置 Python + ComfyUI · ' : '内置 Python（备选）· ') +
          `${basename(dirname(py))}\\python.exe`,
        command: `"${py}" -s "${main}" --windows-standalone-build`,
        cwd: mainDir,
        host: DEFAULT_HOST
      });
    });

    // —— C. venv —— main.py 同级或父级
    const venvPy = findVenvPython(mainDir) ?? findVenvPython(dirname(mainDir));
    if (venvPy) {
      push({
        kind: 'venv',
        label: `venv · ${basename(dirname(dirname(venvPy)))}`,
        command: `"${venvPy}" -s "${main}"`,
        cwd: mainDir,
        host: DEFAULT_HOST
      });
    }

    // —— D. 系统 python 仅在「没搜到任何内置 python」时垫底（避免误选导致缺依赖崩溃）——
    if (rankedPy.length === 0) {
      push({
        kind: 'bare-main',
        label: 'python main.py（系统 Python，可能缺依赖）',
        command: `python -s "${main}"`,
        cwd: mainDir,
        host: DEFAULT_HOST
      });
    }
  }

  return out;
}
