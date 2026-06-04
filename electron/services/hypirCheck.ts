/**
 * HYPIR（AI 高质量修复放大模式）依赖检查。
 *
 * 设计原则：
 * - 引擎本体不打进安装包；走独立 Python 本地后端，模型权重单独下载
 * - 启动放大前必须依次满足：Python ≥ 3.10、CUDA 可用（nvidia-smi）、PyTorch 已装且能看到 CUDA、HYPIR 权重存在、SD2.1 base 权重存在
 * - 任何一项缺失只报告状态，不擅自下载或装包——尊重用户的 Python 环境
 *
 * 本服务"只读"：spawn 几次 shell 命令探测 + 文件存在判断，绝不修改用户系统。
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logger } from './logger';

export interface HypirDependencyCheck {
  /** 全部就绪才能开始放大 */
  ready: boolean;
  python: {
    found: boolean;
    /** 实际探到的解释器路径 */
    path: string | null;
    /** 形如 "3.11.7" */
    version: string | null;
    /** 满足 ≥3.10 */
    versionOk: boolean;
  };
  cuda: {
    /** 是否能跑通 nvidia-smi */
    nvidiaSmi: boolean;
    /** 解析到的驱动版本 */
    driverVersion: string | null;
    /** 解析到的 CUDA 版本 */
    cudaVersion: string | null;
  };
  torch: {
    installed: boolean;
    version: string | null;
    /** torch.cuda.is_available() */
    cudaAvailable: boolean;
  };
  hypirRepo: {
    /** HYPIR 仓库或 site-package 是否能 import */
    importable: boolean;
  };
  weights: {
    /** HYPIR 模型权重 */
    hypirPath: string | null;
    hypirExists: boolean;
    /** Stable Diffusion 2.1 base */
    sd21Path: string | null;
    sd21Exists: boolean;
  };
  /** 文档 / 安装向导跳转 URL（前端按钮直接 openExternal） */
  guides: {
    hypirRepo: string;
    sd21: string;
    pytorchInstall: string;
    cuda: string;
  };
}

interface CheckPrefs {
  pythonPath?: string;
  hypirWeightsPath?: string;
  sd21Path?: string;
}

const HYPIR_REPO_URL = 'https://github.com/XPixelGroup/HYPIR';
const SD21_URL = 'https://huggingface.co/stabilityai/stable-diffusion-2-1-base';
const PYTORCH_INSTALL_URL = 'https://pytorch.org/get-started/locally/';
const CUDA_URL = 'https://developer.nvidia.com/cuda-downloads';

function defaultWeightsRoot(): string {
  return path.join(app.getPath('userData'), 'engines', 'hypir');
}

export async function checkHypirDependencies(prefs: CheckPrefs = {}): Promise<HypirDependencyCheck> {
  const pythonResult = await probePython(prefs.pythonPath);
  const cudaResult = await probeNvidiaSmi();
  const torchResult = pythonResult.found
    ? await probeTorch(pythonResult.path as string)
    : { installed: false, version: null, cudaAvailable: false };
  const hypirResult = pythonResult.found
    ? await probeHypir(pythonResult.path as string)
    : { importable: false };

  const root = defaultWeightsRoot();
  const hypirPath = prefs.hypirWeightsPath ?? path.join(root, 'HYPIR_sd2.pth');
  const sd21Path = prefs.sd21Path ?? path.join(root, 'sd-2-1-base');
  const hypirExists = pathHasContent(hypirPath);
  const sd21Exists = pathHasContent(sd21Path);

  const ready =
    pythonResult.versionOk &&
    cudaResult.nvidiaSmi &&
    torchResult.installed &&
    torchResult.cudaAvailable &&
    hypirResult.importable &&
    hypirExists &&
    sd21Exists;

  return {
    ready,
    python: pythonResult,
    cuda: cudaResult,
    torch: torchResult,
    hypirRepo: hypirResult,
    weights: { hypirPath, hypirExists, sd21Path, sd21Exists },
    guides: {
      hypirRepo: HYPIR_REPO_URL,
      sd21: SD21_URL,
      pytorchInstall: PYTORCH_INSTALL_URL,
      cuda: CUDA_URL
    }
  };
}

function pathHasContent(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    const st = statSync(p);
    if (st.isDirectory()) return true; // SD2.1 base 是目录
    return st.size > 64 * 1024; // 模型权重至少 64KB，避免空占位
  } catch {
    return false;
  }
}

// ─── Python ──────────────────────────────────────────────

async function probePython(
  pref?: string
): Promise<HypirDependencyCheck['python']> {
  const candidates = pref ? [pref] : pythonCandidates();
  for (const cand of candidates) {
    try {
      const out = await runCapture(cand, ['--version']);
      const v = out.match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/);
      if (v) {
        const major = Number(v[1]);
        const minor = Number(v[2]);
        const patch = Number(v[3] ?? 0);
        const version = `${major}.${minor}.${patch}`;
        return {
          found: true,
          path: cand,
          version,
          versionOk: major > 3 || (major === 3 && minor >= 10)
        };
      }
    } catch {
      /* try next */
    }
  }
  return { found: false, path: null, version: null, versionOk: false };
}

function pythonCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['py', 'python', 'python3'];
  }
  return ['python3', 'python'];
}

// ─── nvidia-smi ─────────────────────────────────────────

async function probeNvidiaSmi(): Promise<HypirDependencyCheck['cuda']> {
  try {
    const out = await runCapture('nvidia-smi', []);
    const driver = out.match(/Driver Version:\s*([\d.]+)/);
    const cuda = out.match(/CUDA Version:\s*([\d.]+)/);
    return {
      nvidiaSmi: true,
      driverVersion: driver ? driver[1] : null,
      cudaVersion: cuda ? cuda[1] : null
    };
  } catch {
    return { nvidiaSmi: false, driverVersion: null, cudaVersion: null };
  }
}

// ─── PyTorch ─────────────────────────────────────────────

async function probeTorch(
  python: string
): Promise<HypirDependencyCheck['torch']> {
  try {
    const out = await runCapture(python, [
      '-c',
      'import torch, json; print(json.dumps({"v": torch.__version__, "cuda": bool(torch.cuda.is_available())}))'
    ]);
    const m = out.match(/\{.*\}/s);
    if (!m) throw new Error('parse failed');
    const parsed = JSON.parse(m[0]) as { v: string; cuda: boolean };
    return { installed: true, version: parsed.v, cudaAvailable: parsed.cuda };
  } catch {
    return { installed: false, version: null, cudaAvailable: false };
  }
}

// ─── HYPIR import ────────────────────────────────────────

async function probeHypir(
  python: string
): Promise<HypirDependencyCheck['hypirRepo']> {
  try {
    const out = await runCapture(python, ['-c', 'import HYPIR']);
    return { importable: out !== null };
  } catch {
    return { importable: false };
  }
}

// ─── 子进程辅助 ──────────────────────────────────────────

function runCapture(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const t = setTimeout(() => {
      killed = true;
      proc.kill();
    }, timeoutMs);
    proc.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    proc.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    proc.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(t);
      if (killed) {
        reject(new Error(`${cmd} timed out`));
        return;
      }
      // nvidia-smi 在没 GPU 时可能 exit 1，但我们只关心 stdout 是否有内容
      const merged = stdout || stderr;
      if (code === 0 || (code !== null && /(Driver Version|Python|torch)/i.test(merged))) {
        resolve(merged);
      } else {
        logger.debug(`[hypir-check] ${cmd} ${args.join(' ')} exit ${code}`);
        reject(new Error(`${cmd} exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });
  });
}
