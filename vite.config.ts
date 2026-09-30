import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/popup/popup.html'),
        dashboard: resolve(import.meta.dirname, 'src/dashboard/dashboard.html'),
        'service-worker': resolve(import.meta.dirname, 'src/background/service-worker.ts'),
        'link-interceptor': resolve(import.meta.dirname, 'src/content/link-interceptor.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') {
            return 'src/background/service-worker.js';
          }
          if (chunkInfo.name === 'link-interceptor') {
            return 'src/content/link-interceptor.js';
          }
          return 'src/[name]/[name].js';
        },
        chunkFileNames: 'src/chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            if (assetInfo.name.includes('popup')) return 'src/popup/popup.css';
            if (assetInfo.name.includes('dashboard')) return 'src/dashboard/dashboard.css';
          }
          return 'src/assets/[name].[ext]';
        },
      },
    },
  },
  plugins: [
    {
      name: 'copy-extension-manifest-and-assets',
      closeBundle() {
        // Copy manifest.json
        if (fs.existsSync('manifest.json')) {
          fs.copyFileSync('manifest.json', 'dist/manifest.json');
        }

        // Copy icon assets
        const iconsDir = 'src/assets/icons';
        const distIconsDir = 'dist/src/assets/icons';
        if (fs.existsSync(iconsDir)) {
          fs.mkdirSync(distIconsDir, { recursive: true });
          for (const file of fs.readdirSync(iconsDir)) {
            fs.copyFileSync(`${iconsDir}/${file}`, `${distIconsDir}/${file}`);
          }
        }

        // Copy _locales if existing
        if (fs.existsSync('_locales')) {
          fs.cpSync('_locales', 'dist/_locales', { recursive: true });
        }
      },
    },
  ],
});
