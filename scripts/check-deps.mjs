#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Principio de la Constitución II: Prohibición absoluta de Bootstrap y Next.js
const FORBIDDEN_PACKAGES = ['bootstrap', 'react-bootstrap', 'next'];

console.log('🔒 Verificando invariantes de dependencias (DevSecOps - Zero Trust)...');

let hasViolations = false;

function inspectPackageJson(filePath) {
  if (!existsSync(filePath)) return;
  const content = JSON.parse(readFileSync(filePath, 'utf8'));
  const allDeps = {
    ...content.dependencies,
    ...content.devDependencies,
    ...content.peerDependencies,
  };

  for (const forbidden of FORBIDDEN_PACKAGES) {
    if (allDeps[forbidden] || Object.keys(allDeps).some(dep => dep.startsWith(forbidden))) {
      console.error(`❌ VIOLACIÓN DE LA CONSTITUCIÓN: Se detectó dependencia prohibida '${forbidden}' en ${filePath}`);
      hasViolations = true;
    }
  }
}

// 1. Verificar package.json raíz y workspaces
const packageFiles = [
  'package.json',
  'frontend/package.json',
  'backend/package.json',
  'packages/shared/package.json',
];

for (const pkgFile of packageFiles) {
  inspectPackageJson(pkgFile);
}

// 2. Verificar lockfile si existe
if (existsSync('package-lock.json')) {
  const lockContent = readFileSync('package-lock.json', 'utf8');
  for (const forbidden of FORBIDDEN_PACKAGES) {
    if (lockContent.includes(`"node_modules/${forbidden}"`)) {
      console.error(`❌ VIOLACIÓN DE LA CONSTITUCIÓN: Se detectó '${forbidden}' en package-lock.json`);
      hasViolations = true;
    }
  }
}

if (hasViolations) {
  console.error('\n🚫 Falló la verificación de dependencias de la Constitución.');
  process.exit(1);
} else {
  console.log('✅ Verificación de dependencias aprobada: Sin Bootstrap ni Next.js.');
  process.exit(0);
}
