#!/usr/bin/env node
// Guard de dependencias (principio II de la constitución): falla si aparecen `bootstrap` o `next`
// en los manifiestos, en el lockfile o en los imports del código fuente.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const FORBIDDEN = ['bootstrap', 'next'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', 'coverage', '.git', '.aws-sam', 'specs', '.specify', '.opencode']);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const violations = [];

function walk(dir, visit) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function isForbidden(name) {
  return FORBIDDEN.some((bad) => name === bad || name.startsWith(`${bad}/`));
}

function checkManifest(file) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (isForbidden(name)) violations.push(`${relative(ROOT, file)}: ${section} incluye "${name}"`);
    }
  }
}

function checkLockfile(file) {
  const lock = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of Object.keys(lock.packages ?? {})) {
    const name = key.split('node_modules/').pop() ?? '';
    if (name && isForbidden(name)) violations.push(`${relative(ROOT, file)}: paquete "${key}"`);
  }
}

const IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function checkSource(file) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? '';
    if (isForbidden(spec)) violations.push(`${relative(ROOT, file)}: import de "${spec}"`);
  }
}

walk(ROOT, (file) => {
  if (file.endsWith('package.json')) checkManifest(file);
  else if (SOURCE_EXT.test(file) && !file.endsWith('check-deps.mjs')) checkSource(file);
});
const lockfile = join(ROOT, 'package-lock.json');
if (existsSync(lockfile)) checkLockfile(lockfile);

if (violations.length > 0) {
  console.error('Dependencias prohibidas (Bootstrap / Next.js):');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log('check-deps: sin Bootstrap ni Next.js.');
