import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'SurgiLog',
        short_name: 'SurgiLog',
        description: 'A clearer path to surgery',
        theme_color: '#176b9a',
        background_color: '#f4f8fb',
        display: 'standalone',
        icons: [
          { src: '/surgilog-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/surgilog-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['api/**'],
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 700 },
});
