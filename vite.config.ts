import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { themeBootstrapScript } from './shared/themeBootstrap.ts';

export default defineConfig({
  plugins: [react(), {
    name: 'appearance-before-paint',
    transformIndexHtml: { order: 'pre', handler: html => html.replace('<!-- appearance-bootstrap -->', `<script>${themeBootstrapScript()}</script>`) },
  }],
  server: {
    host: '127.0.0.1', allowedHosts: ['localhost', '127.0.0.1'],
    watch: { ignored: ['**/.cache/**', '**/.tools/**', '**/.npm-cache/**', '**/data/**', '**/releases/**', '**/test-results/**', '**/playwright-report/**', '**/tests/**', '**/docs/**'] },
  },
  build: { target: 'es2022' },
});
