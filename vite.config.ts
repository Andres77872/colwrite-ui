import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rawKatexCssPlugin } from './vite.raw-katex'

// Resolved from `import.meta.url` rather than `__dirname` so the config
// typechecks without pulling in @types/node.
const projectDir = new URL('.', import.meta.url).pathname

// The deployed ColWrite API. COLWRITE_API_URL overrides it, for example with
// http://127.0.0.1:5002 for a backend running on this machine.
const DEFAULT_API_URL = 'https://colwrite-api.novus.chat'
const SESSION_COOKIE = 'colwrite_session_token'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function apiTarget(raw: string | undefined): URL {
  const value = raw?.trim() || DEFAULT_API_URL
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`COLWRITE_API_URL must be an absolute URL, got "${value}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`COLWRITE_API_URL must use http or https, got "${value}"`)
  }
  return url
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || undefined
  }
  return undefined
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectDir, 'COLWRITE_')
  const api = apiTarget(env.COLWRITE_API_URL)
  const target = api.href.replace(/\/$/, '')
  const localApi = LOOPBACK_HOSTS.has(api.hostname) || api.hostname.endsWith('.localhost')

  return {
    plugins: [rawKatexCssPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
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
        '/api/agent': localApi
          ? {
              target,
              ws: true,
              // Keep the browser's Host. The API accepts the assistant WebSocket
              // when Origin matches Host, and a page opened over the network sends
              // its LAN address as Origin. The local-engine gate still requires a
              // localhost Host and Origin, so Claude Code / Codex stay local-only.
              changeOrigin: false,
            }
          : {
              target,
              ws: true,
              // A remote API is reached by its own host name.
              changeOrigin: true,
              configure: (proxy) => {
                // The deployed API accepts a browser WebSocket only from its own
                // origin or CORS_ALLOWED_ORIGINS, and this dev page is neither.
                // A socket opened by this dev server's own page is forwarded as
                // a non-browser client instead: no Origin, and the page's
                // session cookie as the Bearer credential the API requires in
                // that case. Any other page keeps its Origin and is refused.
                proxy.on('proxyReqWs', (proxyReq, req) => {
                  const { origin, host, cookie } = req.headers
                  let ownPage = false
                  try {
                    ownPage = Boolean(origin && host && new URL(origin).host === host)
                  } catch { /* A malformed Origin is never this page. */ }
                  const token = ownPage ? cookieValue(cookie, SESSION_COOKIE) : undefined
                  if (!token) return
                  proxyReq.removeHeader('origin')
                  proxyReq.setHeader('authorization', `Bearer ${token}`)
                })
              },
            },
        '/api': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          // The browser calls the refresh route at /api/auth/refresh. An API
          // deployed without AUTH_COOKIE_PATH_PREFIX=/api scopes its refresh
          // cookie to /auth, where the browser would never send it back.
          cookiePathRewrite: { '/auth': '/api/auth' },
        },
      },
    },
  }
})
