import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * 单元测试（vitest）。当前聚焦"参数流"纯函数：
 *   - src/types/imageModelFamilies.ts（family 识别 + buildBody）
 *   - electron/ipc/imageBody.ts（resolveSize / applyBodyOverrides / 尺寸换算）
 * 这些都是纯函数，不依赖 electron / better-sqlite3，可直接在 node 环境跑。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/types'),
      '@': resolve(__dirname, 'src')
    }
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'app/**'],
    environment: 'node'
  }
});
