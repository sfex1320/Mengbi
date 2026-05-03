import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// 用 process.cwd() 而不是 __dirname：electron-vite 通过 bundle-require 加载本配置，
// 编译后的 __dirname 可能指向临时目录，process.cwd() 永远是用户启动 npm run dev 的项目根。
const root = process.cwd();
const r = (p: string): string => resolve(root, p);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: r('electron/main.ts')
      },
      rollupOptions: {
        external: ['better-sqlite3', 'electron-log', 'electron-updater', 'sharp']
      }
    },
    resolve: {
      alias: {
        '@shared': r('src/types')
      }
    }
  },
  preload: {
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
    root: '.',
    plugins: [react()],
    resolve: {
      alias: {
        '@': r('src'),
        '@shared': r('src/types')
      }
    },
    build: {
      rollupOptions: {
        input: r('index.html')
      }
    },
    server: {
      port: 5173
    }
  }
});
