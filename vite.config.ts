import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  resolve: {
    alias: {
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
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          'vendor-charts': ['recharts'],
        }
      }
    },
    chunkSizeWarningLimit: 500,
    target: 'es2020',
  },
  test: {
    exclude: ['node_modules/**', 'functions/**', '**/.claude/**']
  }
})