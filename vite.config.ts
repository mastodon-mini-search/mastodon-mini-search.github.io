import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  test: {
    // stripHTML / createIndex use the DOM (document.createElement); happy-dom
    // provides a lightweight DOM so these run under Node.
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
  },
})
