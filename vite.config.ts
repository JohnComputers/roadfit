import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const repositoryName = env.GITHUB_REPOSITORY?.split('/')[1];
  const configuredBase = env.VITE_BASE_PATH?.trim();
  const base = configuredBase
    ? `${configuredBase.startsWith('/') ? '' : '/'}${configuredBase.replace(/\/$/, '')}/`
    : env.GITHUB_ACTIONS === 'true' && repositoryName
      ? `/${repositoryName}/`
      : '/';

  return {
    base,
    plugins: [react(), tailwindcss()],
    build: {
      target: 'es2022',
      sourcemap: true,
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
      coverage: {
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
      },
    },
  };
});
