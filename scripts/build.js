// ============================================================
//  All Downloader — Build Script
//  Runs TypeScript validation, triggers Vite build,
//  validates extension manifest integrity, and packages zip.
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ZIP  = path.join(ROOT, 'all-downloader.zip');

// ── Helper: human-readable file size ─────────────────────────
function fmtBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Helper: extract every string value from a manifest object ─
function collectManifestPaths(obj, results = []) {
  if (typeof obj === 'string') {
    const clean = obj.replace(/\*.*$/, '');
    if (clean) results.push(clean);
  } else if (Array.isArray(obj)) {
    obj.forEach(v => collectManifestPaths(v, results));
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(v => collectManifestPaths(v, results));
  }
  return results;
}

// ── Helper: calculate total files and directory size ─────────
function getDirStats(dirPath) {
  let fileCount = 0;
  let totalSize = 0;

  function walk(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        fileCount++;
        totalSize += fs.statSync(full).size;
      }
    }
  }

  walk(dirPath);
  return { fileCount, totalSize };
}

// ── Step 1: Parse & validate manifest.json ───────────────────
console.log('\n📦  All Downloader — Build Script\n' + '─'.repeat(48));

let manifest;
const manifestSrc = path.join(ROOT, 'manifest.json');
try {
  manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
} catch (err) {
  console.error(`\n❌  manifest.json is invalid JSON:\n    ${err.message}`);
  process.exit(1);
}

if (!manifest.manifest_version || !manifest.name || !manifest.version) {
  console.error('❌  manifest.json is missing required fields (manifest_version, name, version).');
  process.exit(1);
}

console.log(`  Name     : ${manifest.name}`);
console.log(`  Version  : ${manifest.version}`);
console.log(`  MV       : ${manifest.manifest_version}`);

// ── Step 2: Clean /dist ──────────────────────────────────────
console.log('\n🗑   Cleaning dist/...');
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// ── Step 3: TypeScript Check & Vite Build ───────────────────
console.log('\n⚙️   Running TypeScript validation & Vite build...');
try {
  execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'inherit' });
  console.log('  ✓  TypeScript validation passed.');

  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
  console.log('  ✓  Vite bundle successfully generated in dist/.');
} catch {
  console.error('\n❌  TypeScript check or Vite build failed.');
  process.exit(1);
}

// ── Step 4: Verify all manifest-referenced paths exist ────────
console.log('\n🔍  Verifying manifest references...');
const allValues = collectManifestPaths(manifest);
const pathsToCheck = [...new Set(
  allValues.filter(v =>
    (v.startsWith('src/') || v.startsWith('_locales/')) && !v.includes('<')
  )
)];

let verifyFailed = false;
for (const rel of pathsToCheck) {
  const full = path.join(DIST, rel);
  const exists = fs.existsSync(full);
  if (!exists) {
    console.error(`  ❌  Missing in dist: ${rel}`);
    verifyFailed = true;
  } else {
    console.log(`  ✓  ${rel}`);
  }
}

if (verifyFailed) {
  console.error('\n❌  Build failed — some manifest-referenced files are missing from dist.');
  process.exit(1);
}

// ── Step 5: Generate ZIP ─────────────────────────────────────
console.log('\n🗜   Generating zip...');
if (fs.existsSync(ZIP)) fs.rmSync(ZIP);

try {
  const distNorm = DIST.replace(/\\/g, '/');
  const zipNorm  = ZIP.replace(/\\/g, '/');

  try {
    execSync(`zip -r "${zipNorm}" .`, { cwd: DIST, stdio: 'pipe' });
  } catch {
    execSync(
      `powershell -Command "Compress-Archive -Path '${distNorm}\\*' -DestinationPath '${zipNorm}' -Force"`,
      { stdio: 'pipe' }
    );
  }

  const zipSize = fs.statSync(ZIP).size;
  console.log(`  ✓  all-downloader.zip  (${fmtBytes(zipSize)})`);
} catch (err) {
  console.warn(`  ⚠  Could not generate ZIP automatically: ${err.message}`);
}

// ── Step 6: Summary report ────────────────────────────────────
const stats = getDirStats(DIST);
console.log('\n' + '─'.repeat(48));
console.log(`  Total dist files : ${stats.fileCount}`);
console.log(`  Total dist size  : ${fmtBytes(stats.totalSize)}`);
console.log('─'.repeat(48));
console.log('\n✅  Build complete → dist/\n');
