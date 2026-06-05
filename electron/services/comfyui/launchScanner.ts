/**
 * 扫描用户选定的 ComfyUI 文件夹，自动识别可用的启动方式。
 *
 * 纯读：只列目录 + 读 .bat 文本，**绝不执行任何东西**。
 * 启动器走 `cmd.exe /c <command>`（cwd=工作目录，见 launcher.ts），所以这里产出的
 * command 都按"在 cwd 下用 cmd 跑"来构造（便携包 .bat / python_embeded / venv / 裸 main.py）。
 *
 * 覆盖的真实安装布局：
 *   - 官方 Windows 便携包：根目录有 run_nvidia_gpu.bat / run_cpu.bat / ...，
 *     还有 python_embeded\python.exe + ComfyUI\main.py
 *   - 手动 / venv 安装：仓库根 main.py + venv\Scripts\python.exe（或 .venv）
 *   - 裸装：只有 main.py，用系统 Python
 *   - 用户选了内层 ComfyUI 子目录或外层父目录都能兜到（往里看一层 + venv 往上看一层）
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import type { ComfyLaunchCandidate } from '@shared/comfyui';

const DEFAULT_HOST = '127.0.0.1:8188';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
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

  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    entries = [];
  }

  // —— A. 便携包启动脚本 run_*.bat（最稳，直接是官方命令）——
  const bats = entries.filter((f) => /^run.*\.bat$/i.test(f) && isFile(join(dir, f)));
  bats.sort((a, b) => batRank(a) - batRank(b) || a.localeCompare(b));
  for (const bat of bats) {
    push({
      kind: 'portable-bat',
      label: `便携包脚本 · ${bat}`,
      command: bat,
      cwd: dir,
      host: hostFromBat(join(dir, bat))
    });
  }

  // —— B. 便携包内核：python_embeded + ComfyUI\main.py（.bat 被删时兜底）——
  if (isFile(join(dir, 'python_embeded', 'python.exe')) && isFile(join(dir, 'ComfyUI', 'main.py'))) {
    push({
      kind: 'portable-python',
      label: '便携包 · python_embeded + ComfyUI\\main.py',
      command: '.\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build',
      cwd: dir,
      host: DEFAULT_HOST
    });
  }

  // —— C/D. 手动 / venv 安装：main.py 在 dir 直下，或 dir\ComfyUI 下 ——
  const mainDirs: string[] = [];
  if (isFile(join(dir, 'main.py'))) mainDirs.push(dir);
  if (isFile(join(dir, 'ComfyUI', 'main.py'))) mainDirs.push(join(dir, 'ComfyUI'));
  for (const mainDir of mainDirs) {
    // venv 可能在 main.py 同级，或父级（dir\venv + dir\ComfyUI\main.py 这种布局）
    const venvPy = findVenvPython(mainDir) ?? findVenvPython(dirname(mainDir));
    if (venvPy) {
      push({
        kind: 'venv',
        label: `venv · ${basename(dirname(dirname(venvPy)))}`,
        command: `"${venvPy}" -s main.py`,
        cwd: mainDir,
        host: DEFAULT_HOST
      });
    }
    push({
      kind: 'bare-main',
      label: 'python main.py（系统 / 当前环境 Python）',
      command: 'python -s main.py',
      cwd: mainDir,
      host: DEFAULT_HOST
    });
  }

  return out;
}
