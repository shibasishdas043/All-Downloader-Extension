// ============================================================
//  All Downloader — Build Script
//  Copies all extension files to /dist, validates integrity,
//  generates a ready-to-upload .zip, and prints a full report.
// ============================================================
import fs   from 'fs';
import path from 'path';
import { fileURLToPath }  from 'url';
import { execSync }       from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ZIP  = path.join(ROOT, 'all-downloader.zip');

// ── What to include in the final extension package ──────────
const INCLUDE = [
  'manifest.json',
  'src',
  '_locales',
];

// ── Files/extensions to silently exclude from the copy ──────
const EXCLUDE_NAMES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
  '.gitkeep', '.gitignore',
]);
const EXCLUDE_EXTS = new Set([
  '.map',   // source maps — not needed in the extension
  '.ts',    // typescript sources — compiled into .js bundles
]);

// ── Helper: human-readable file size ─────────────────────────
function fmtBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Helper: recursive copy (respects EXCLUDE lists) ──────────
let filesCopied = 0;
let bytesCopied = 0;
const copiedFiles = [];

function copyRecursive(src, dest) {
  const name = path.basename(src);
  const ext  = path.extname(src).toLowerCase();

  if (EXCLUDE_NAMES.has(name) || EXCLUDE_EXTS.has(ext)) return;

  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    filesCopied++;
    bytesCopied += stat.size;
    copiedFiles.push({ rel: path.relative(DIST, dest), size: stat.size });
  }
}

// ── Helper: extract every string value from a manifest object ─
function collectManifestPaths(obj, results = []) {
  if (typeof obj === 'string') {
    // Strip glob wildcards — we validate the directory instead
    const clean = obj.replace(/\*.*$/, '');
    if (clean) results.push(clean);
  } else if (Array.isArray(obj)) {
    obj.forEach(v => collectManifestPaths(v, results));
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(v => collectManifestPaths(v, results));
  }
  return results;
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
} catch (err) {
  console.error('\n❌  TypeScript check or Vite build failed.');
  process.exit(1);
}

// ── Step 4: Verify all manifest-referenced paths exist ────────
console.log('\n🔍  Verifying manifest references...');
const skipKeys = new Set(['matches', 'permissions', 'host_permissions', 'commands',
                          'description', 'author', 'homepage_url', 'default_locale',
                          'default_title', 'suggested_key', 'run_at', 'type',
                          'manifest_version', 'name', 'version']);

// Collect only path-like strings (start with src/ or have an extension)
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

// Use PowerShell Compress-Archive (cross-platform fallback on Windows)
try {
  const distNorm = DIST.replace(/\\/g, '/');
  const zipNorm  = ZIP.replace(/\\/g, '/');

  // Try native zip first (Linux/macOS), fall back to PowerShell (Windows)
  try {
    execSync(`zip -r "${zipNorm}" .`, { cwd: DIST, stdio: 'pipe' });
  } catch {
    // PowerShell fallback
    execSync(
      `powershell -Command "Compress-Archive -Path '${distNorm}\\*' -DestinationPath '${zipNorm}' -Force"`,
      { stdio: 'pipe' }
    );
  }

  const zipSize = fs.statSync(ZIP).size;
  console.log(`  ✓  all-downloader.zip  (${fmtBytes(zipSize)})`);
} catch (err) {
  console.warn(`  ⚠  Could not generate ZIP automatically: ${err.message}`);
  console.warn('     Run manually: cd dist && zip -r ../all-downloader.zip .');
}

// ── Step 6: Summary report ────────────────────────────────────
console.log('\n' + '─'.repeat(48));
console.log(`  Files copied : ${filesCopied}`);
console.log(`  Total size   : ${fmtBytes(bytesCopied)}`);
console.log('─'.repeat(48));
console.log('\n✅  Build complete → dist/\n');
