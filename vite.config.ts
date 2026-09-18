import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_PORT || 5173),
      proxy: env.VITE_PROXY
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
