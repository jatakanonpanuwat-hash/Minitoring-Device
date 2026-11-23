import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// production: backend เสิร์ฟ build ที่ /monitoring-device — ถ้าเปลี่ยน base ต้องเปลี่ยน routes.tsx (basename) และ backend fallback ด้วย
export default defineConfig({
  base: '/monitoring-device/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/monitoring-device/api': {
        target: 'http://localhost:5000',
        xfwd: true, // ส่ง X-Forwarded-For ให้ backend เห็น IP จริงของผู้เปิดเว็บ (แถบล่าง)
        rewrite: (path) => path.replace('/monitoring-device', ''),
      },
    },
  },
  build: {
    outDir: '../backend/build',
    emptyOutDir: true,
  },
});
