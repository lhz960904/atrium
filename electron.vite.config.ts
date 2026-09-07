import { cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

/**
 * The SQLite session backend reads its migration SQL at runtime, relative to
 * its own module URL. Bundling main into one file rewrites that URL to the
 * bundle's, so the .sql has to sit next to the bundle or the session store
 * throws on first open — in dev and in the packaged app alike.
 */
function copySessionMigrations() {
  return {
    name: 'copy-session-migrations',
    closeBundle() {
      // The package is ESM-only and exports no CJS main, so it has to be
      // resolved the way it is imported.
      const entry = fileURLToPath(
        import.meta.resolve('@earendil-works/pi-session-backend-sqlite-node'),
      );
      cpSync(join(dirname(entry), 'sqlite', 'migrations'), resolve('out/main/migrations'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [copySessionMigrations()],
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
