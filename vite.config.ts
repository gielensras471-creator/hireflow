import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const localV3 = mode === 'v3-local'
  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host: localV3 ? '127.0.0.1' : '0.0.0.0',
      port: Number(env.VITE_PORT || 5173),
      proxy:
        !localV3 && env.VITE_PROXY
          ? {
              '/api': {
                target: env.VITE_PROXY,
                changeOrigin: true
              }
            }
          : undefined
    },
    plugins: [vue()],
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1800
    }
  }
})
