import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      ANTHROPIC_API_KEY: 'sk-test-dummy',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-key-dummy',
    },
  },
})
