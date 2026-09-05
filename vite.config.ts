import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { licenseBanner } from './license-banner.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), licenseBanner()],
})
