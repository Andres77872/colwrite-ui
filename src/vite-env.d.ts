/// <reference types="vite/client" />

declare module 'virtual:colwrite-katex-css' {
  const css: string;
  export default css;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_ARZ_API?: string
  readonly VITE_COLPALI_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
