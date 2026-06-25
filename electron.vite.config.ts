import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      rollupOptions: {
        // linkedom 的可选 peer 依赖；不 external 时 Vite 会生成顶层 throw 桩，dev 不 tree-shake 会直接崩。
        // external 后保留原始 require，由 linkedom 自身 try/catch 回退到 canvas-shim。
        external: ['canvas'],
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve('src/renderer/src/routes'),
        generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts'),
      }),
      react(),
      tailwindcss(),
    ],
    server: {
      fs: {
        allow: [resolve('.')],
      },
    },
  },
});
