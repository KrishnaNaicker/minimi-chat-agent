import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app lives in web/ (so Vite never reads the repo's .env) and proxies /api to the Hono server.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
