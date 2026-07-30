import path from 'path';
import { copyFile, mkdir } from 'node:fs/promises';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { APPLICATION_BASE_PATH } from './services/applicationRoutes';

export default defineConfig(() => {
  return {
    base: APPLICATION_BASE_PATH,
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      {
        name: 'github-pages-recovery-route',
        async closeBundle() {
          const recoveryDirectory = path.resolve(__dirname, 'dist/recover-password');
          await mkdir(recoveryDirectory, { recursive: true });
          await copyFile(
            path.resolve(__dirname, 'dist/index.html'),
            path.join(recoveryDirectory, 'index.html'),
          );
        },
      },
    ],
    build: {
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, 'index.html'),
          weeklyPlanBridge: path.resolve(__dirname, 'bridge.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
