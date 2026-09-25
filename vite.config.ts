import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rawKatexCssPlugin } from './vite.raw-katex'

// https://vite.dev/config/
export default defineConfig({
  plugins: [rawKatexCssPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      // Resolved from `import.meta.url` rather than `__dirname` so the config
      // typechecks without pulling in @types/node.
      "@": new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    // Listen on every interface: the app opens on this machine
    // (http://localhost:<port>) and from other devices on the local network
    // (http://<lan-ip>:<port>). `vite --host 127.0.0.1` keeps it loopback-only.
    // `vite preview` inherits host, allowedHosts and proxy from here.
    host: true,
    // IP addresses and localhost always pass Vite's Host check; also allow
    // mDNS names such as http://my-pc.local:<port>.
    allowedHosts: ['.local'],
    proxy: {
      '/api/agent': {
        target: 'http://127.0.0.1:5002',
        ws: true,
        // Keep the browser's Host. The API accepts the assistant WebSocket
        // when Origin matches Host, and a page opened over the network sends
        // its LAN address as Origin. The local-engine gate still requires a
        // localhost Host and Origin, so Claude Code / Codex stay local-only.
        changeOrigin: false,
      },
      '/api': {
        target: 'http://127.0.0.1:5002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
