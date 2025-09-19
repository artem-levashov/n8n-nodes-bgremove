
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function resolvePkgDir(pkg) {
  try { return path.dirname(require.resolve(pkg + '/package.json')); }
  catch { return null; }
}

const dir = resolvePkgDir('rembg-node');
if (!dir) { console.log('[bgremove] rembg-node not installed (skipping build)'); process.exit(0); }

const dist = path.join(dir, 'dist', 'index.js');
if (fs.existsSync(dist)) { console.log('[bgremove] rembg-node dist already present'); process.exit(0); }

try {
  console.log('[bgremove] building rembg-node (dist missing)…');
  execSync('npm i', { cwd: dir, stdio: 'inherit' });
  execSync('npm run build', { cwd: dir, stdio: 'inherit' });
  console.log('[bgremove] rembg-node build complete');
} catch (e) {
  console.warn('[bgremove] failed to build rembg-node:', e.message);
}
