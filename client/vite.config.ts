import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^leaflet-draw$/,
        replacement: path.resolve(__dirname, 'src/vendor/leaflet-draw.ts'),
      },
    ],
  },
})
