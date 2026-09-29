// ============================================================
//  All-Downloader — Build Script
//  Copies all extension files to /dist, ready for zip & upload.
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SRC  = path.join(__dirname, '..');
const DIST = path.join(__dirname, '..', 'dist');

// Files/folders to include
const INCLUDE = [
  'manifest.json',
  'src',
  '_locales',
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// Clean dist
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

for (const item of INCLUDE) {
  const from = path.join(SRC, item);
  const to   = path.join(DIST, item);
  if (fs.existsSync(from)) {
    copyRecursive(from, to);
    console.log(`✓ Copied: ${item}`);
  } else {
    console.warn(`⚠ Skipped (not found): ${item}`);
  }
}

console.log('\n✅ Build complete → dist/');
