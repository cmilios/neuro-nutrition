import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { APPLICATION_BASE_PATH } from './services/applicationRoutes';
import { copyGithubPagesRouteEntrypoints } from './build/githubPagesRouteEntrypoints';

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
        name: 'github-pages-application-routes',
        async closeBundle() {
          await copyGithubPagesRouteEntrypoints(
            path.resolve(__dirname, 'dist'),
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
