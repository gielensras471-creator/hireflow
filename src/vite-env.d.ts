/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PORT?: string
  readonly VITE_HIREFLOW_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
