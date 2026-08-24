import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  resolve: {
    alias: {
      // Canonical contracts shared with functions/ (pool-type enum, schemas,
      // payment-handle adapter, editability matrix). Same source functions/
      // gets via the predeploy copy.
      '@shared': path.resolve(rootDir, 'shared'),
      'firebase-functions/v2/https': '/tests/mocks/firebase-functions-v2-https.ts',
      'firebase-functions/v2/scheduler': '/tests/mocks/firebase-functions-v2.ts',
      'firebase-functions/v2/firestore': '/tests/mocks/firebase-functions-v2.ts',
      'firebase-functions/v2': '/tests/mocks/firebase-functions-v2.ts',
      'firebase-functions/params': '/tests/mocks/firebase-functions-params.ts',
      'firebase-admin/firestore': '/tests/mocks/firebase-admin.ts',
      'firebase-admin': '/tests/mocks/firebase-admin.ts',
      'stripe': '/tests/mocks/stripe.ts',
    }
  },
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          // 'vendor-charts' (recharts) removed on purpose (2026-08-23 perf
          // audit): a top-level manualChunks entry gets a modulepreload in
          // index.html, shipping 132KB gzip of charts to the landing page.
          // Every recharts import already lives inside a lazy route, so Vite
          // splits it into that route's chunk on its own.
        }
      }
    },
    chunkSizeWarningLimit: 500,
    target: 'es2020',
  },
  test: {
    // shared/ is a standalone package (own tsconfig + package.json); its
    // self-checks run via `npx tsc -p shared && node shared/dist/...`, not root vitest.
    // tests/e2e/** are Playwright specs (own `test`/`expect`, own runner via
    // `npx playwright test`) — vitest's runner errors if it loads them.
    exclude: ['node_modules/**', 'functions/**', '**/.claude/**', 'shared/**', 'tests/e2e/**']
  }
})