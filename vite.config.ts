import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''}/` : '/',
  plugins: [react(), {
    name: 'production-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; frame-src https://freestyle-libr.firebaseapp.com; object-src 'none'; base-uri 'self'; form-action 'self'",
      }, injectTo: 'head-prepend' as const }, { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head' as const }]
    },
  }],
})
