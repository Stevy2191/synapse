import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// A new id for every build: the app compares it with the server's (/api/config) and, if the
// server has a newer build, replaces its saved offline copy (see src/appUpdate.js).
const BUILD_ID = `${Date.now().toString(36)}`;
const buildIdFile = {
  name: 'synapse-build-id',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ build: BUILD_ID }) }); },
};

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    buildIdFile,
    // Service worker: caches the app itself so Synapse opens without a connection.
    // (Notes are stored separately in IndexedDB — see src/offline/.)
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Synapse',
        short_name: 'Synapse',
        description: 'Your connected knowledge base',
        theme_color: '#0f0f14',
        background_color: '#0f0f14',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Chat notifications (push) are handled by this small extra script.
        importScripts: ['/push-sw.js'],
        // Excalidraw's fonts (~14 MB, mostly CJK) are cached the first time they're used instead.
        globIgnores: ['excalidraw/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ocr-assets\//],
        runtimeCaching: [
          {
            // Text recognition on this device (used when offline): engine + language files from Synapse.
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr-assets/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr-assets', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/excalidraw/'),
            handler: 'CacheFirst',
            options: { cacheName: 'excalidraw-fonts', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    }
  },
  build: { outDir: 'dist', sourcemap: false }
});
