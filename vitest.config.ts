import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 单测不依赖外网，也不读真实凭据。
    environment: 'node',
  },
})
