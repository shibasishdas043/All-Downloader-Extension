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
        offscreen: resolve(import.meta.dirname, 'src/offscreen/offscreen.html'),
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
          if (chunkInfo.name === 'offscreen') {
            return 'src/offscreen/offscreen.js';
          }
          return 'src/[name]/[name].js';
        },
        chunkFileNames: 'src/chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            if (assetInfo.name.includes('popup')) return 'src/popup/popup.css';
            if (assetInfo.name.includes('dashboard')) return 'src/dashboard/dashboard.css';
          }
          if (assetInfo.name && assetInfo.name.endsWith('.ttf')) {
            return 'src/assets/fonts/[name].[ext]';
          }
          if (assetInfo.name && assetInfo.name.endsWith('.png')) {
            return 'src/assets/icons/[name].[ext]';
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
        
        let version = '1.0.1';
        try {
          const pkg = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf-8'));
          if (pkg.version) version = pkg.version;
        } catch {
          /* fallback */
        }

        const versionedZipFile = resolve(root, `all-downloader-v${version}.zip`);

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

        // 2b. Copy font assets
        const fontsDir = resolve(root, 'src/assets/fonts');
        const distFontsDir = resolve(dist, 'src/assets/fonts');
        if (fs.existsSync(fontsDir)) {
          fs.mkdirSync(distFontsDir, { recursive: true });
          for (const file of fs.readdirSync(fontsDir)) {
            fs.copyFileSync(resolve(fontsDir, file), resolve(distFontsDir, file));
          }
        }

        // 2c. Clean up any loose duplicate files directly under dist/src/assets
        const distAssets = resolve(dist, 'src/assets');
        if (fs.existsSync(distAssets)) {
          for (const item of fs.readdirSync(distAssets)) {
            const itemPath = resolve(distAssets, item);
            if (fs.statSync(itemPath).isFile()) {
              fs.unlinkSync(itemPath);
            }
          }
        }

        // 3. Copy _locales if existing
        if (fs.existsSync('_locales')) {
          fs.cpSync('_locales', resolve(dist, '_locales'), { recursive: true });
        }

        // 4. Clean up any previous / legacy zip archives in root
        try {
          for (const file of fs.readdirSync(root)) {
            if (file.startsWith('all-downloader') && file.endsWith('.zip')) {
              fs.rmSync(resolve(root, file), { force: true });
            }
          }
        } catch {
          /* fallback */
        }

        // 5. Generate single versioned distribution zip
        try {
          const distNorm = dist.replace(/\\/g, '/');
          const zipNorm = versionedZipFile.replace(/\\/g, '/');
          try {
            execSync(`zip -r "${zipNorm}" .`, { cwd: dist, stdio: 'pipe' });
          } catch {
            execSync(
              `powershell -Command "Compress-Archive -Path '${distNorm}\\*' -DestinationPath '${zipNorm}' -Force"`,
              { stdio: 'pipe' }
            );
          }
          if (fs.existsSync(versionedZipFile)) {
            console.log(`[Vite Packager] Generated distribution archive: all-downloader-v${version}.zip`);
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
