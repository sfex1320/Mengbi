import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// 用 process.cwd() 而不是 __dirname：electron-vite 通过 bundle-require 加载本配置，
// 编译后的 __dirname 可能指向临时目录，process.cwd() 永远是用户启动 npm run dev 的项目根。
const root = process.cwd();
const r = (p: string): string => resolve(root, p);

// 构建标识（修「打包后新功能没进去、还是旧行为」）：把 git 短哈希 + 构建时间 + 版本号
// 在构建时注入为全局常量，关于页 / 主进程日志会显示——用户据此一眼确认「正在运行的包
// 是否就是最新源码构建的」（再不会误以为旧包是新功能缺失）。dev 时这些值即开发会话启动时间。
function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    return 'nogit';
  }
}
function pkgVersion(): string {
  try {
    return (JSON.parse(readFileSync(r('package.json'), 'utf8')).version as string) ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
const buildDefine = {
  __GIT_HASH__: JSON.stringify(gitHash()),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  __APP_VERSION__: JSON.stringify(pkgVersion())
};

export default defineConfig({
  main: {
    define: buildDefine,
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: r('electron/main.ts')
      },
      rollupOptions: {
        external: ['better-sqlite3', 'electron-log', 'electron-updater', 'sharp', 'node-llama-cpp']
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/types')
      }
    }
  },
  preload: {
    define: buildDefine,
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: r('electron/preload.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/types')
      }
    }
  },
  renderer: {
    define: buildDefine,
    root: '.',
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/onnxruntime-web/dist/*.{wasm,mjs}',
            dest: 'ort'
          }
        ]
      })
    ],
    resolve: {
      alias: {
        '@': r('src'),
        '@shared': r('src/types')
      }
    },
    // 关键：onnxruntime-web 自身做了完整的 ESM 打包，并在运行时动态 import
    // 自己的 .mjs / .wasm 工作模块。让 Vite 的 dep-optimizer 帮忙"预打包"
    // 反而会把这些动态 import 的相对路径搞坏（dev 模式 fetch 404）。
    optimizeDeps: {
      exclude: ['onnxruntime-web']
    },
    // 把所有 .wasm 当作普通资源，而不是要解析的 ESM 模块
    assetsInclude: ['**/*.wasm'],
    build: {
      rollupOptions: {
        input: r('index.html')
      }
    },
    server: {
      // Windows 的 Hyper-V/WSL 会保留 5113–5312 端口段，5173 落在里面直接 EACCES。
      // 5400 在所有 excludedportrange 之外；显式 127.0.0.1 避免 Vite 默认绑 ::1 触发 IPv6 权限错。
      host: '127.0.0.1',
      port: 5400,
      strictPort: true
    }
  }
});
