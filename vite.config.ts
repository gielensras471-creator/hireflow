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
      host: '127.0.0.1',
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
    plugins: [
      vue(),
      {
        name: 'hireflow-disable-dev-editor-launch',
        apply: 'serve',
        configureServer(server) {
          // Block the editor shortcut before Vite installs its own handler.
          server.middlewares.use('/__open-in-editor', (_req, res) => {
            res.statusCode = 404
            res.end()
          })
        }
      },
      ...(mode === 'v3-demo'
        ? [
            {
              name: 'demo-manifest',
              generateBundle() {
                this.emitFile({
                  type: 'asset' as const,
                  fileName: 'demo-build.json',
                  source: JSON.stringify({ kind: 'hireflow-isolated-demo', apiBase: '/api/v3' })
                })
              }
            }
          ]
        : [])
    ],
    build: {
      outDir: mode === 'v3-demo' ? 'dist-demo' : mode === 'v3-production' ? 'dist-v3' : 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1800
    }
  }
})
