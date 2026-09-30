import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

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
      name: 'extension-packager',
      closeBundle() {
        const root = import.meta.dirname;
        const dist = resolve(root, 'dist');
        const zipFile = resolve(root, 'all-downloader.zip');

        // 1. Copy manifest.json
        if (fs.existsSync('manifest.json')) {
          fs.copyFileSync('manifest.json', resolve(dist, 'manifest.json'));
        }

        // 2. Copy icon assets
        const iconsDir = resolve(root, 'src/assets/icons');
        const distIconsDir = resolve(dist, 'src/assets/icons');
        if (fs.existsSync(iconsDir)) {
          fs.mkdirSync(distIconsDir, { recursive: true });
          for (const file of fs.readdirSync(iconsDir)) {
            fs.copyFileSync(resolve(iconsDir, file), resolve(distIconsDir, file));
          }
        }

        // 3. Copy _locales if existing
        if (fs.existsSync('_locales')) {
          fs.cpSync('_locales', resolve(dist, '_locales'), { recursive: true });
        }

        // 4. Generate all-downloader.zip
        if (fs.existsSync(zipFile)) fs.rmSync(zipFile);
        try {
          const distNorm = dist.replace(/\\/g, '/');
          const zipNorm = zipFile.replace(/\\/g, '/');
          try {
            execSync(`zip -r "${zipNorm}" .`, { cwd: dist, stdio: 'pipe' });
          } catch {
            execSync(
              `powershell -Command "Compress-Archive -Path '${distNorm}\\*' -DestinationPath '${zipNorm}' -Force"`,
              { stdio: 'pipe' }
            );
          }
        } catch (e) {
          console.warn('[Vite Packager] Could not create zip archive:', e);
        }
      },
    },
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.js'],
  },
});
