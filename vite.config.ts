import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Resolved from `import.meta.url` rather than `__dirname` so the config
      // typechecks without pulling in @types/node.
      "@": new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      '/api/agent': {
        target: 'http://127.0.0.1:5002',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:5002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
