#!/usr/bin/env node
// Guardia de dependencias (constitución, principio II): falla si Bootstrap o Next.js aparecen en
// manifiestos, lockfile, imports, HTML (CDN) o como copias vendidas.
//
// Uso: node scripts/check-deps.mjs [directorio-raíz]

import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(process.argv[2] ?? join(dirname(SELF), ".."));

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-types",
  "build",
  "coverage",
  ".aws-sam",
  ".claude",
  ".opencode",
  ".specify",
  "_to_delete",
  "specs",
]);
const SOURCE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const FORBIDDEN_NAME = /^(?:bootstrap|react-bootstrap|next|@next\/.+)$/;
const VENDORED_FILE = /^bootstrap.*\.(?:css|scss|js|mjs)$/i;
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const CDN_RE = /<(?:link|script)\b[^>]*bootstrap[^>]*>/i;

/** @type {string[]} */
const violations = [];
const report = (file, message) => violations.push(`${relative(ROOT, file) || file}: ${message}`);

/** Obtiene el nombre de paquete de un especificador de import. */
function packageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return null;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function checkManifest(file, json) {
  const sections = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
    "overrides",
    "resolutions",
  ];
  for (const section of sections) {
    for (const name of Object.keys(json[section] ?? {})) {
      if (FORBIDDEN_NAME.test(name)) report(file, `"${name}" en ${section}`);
    }
  }
}

function checkLockfile(file, json) {
  for (const key of Object.keys(json.packages ?? {})) {
    const index = key.lastIndexOf("node_modules/");
    const name = index === -1 ? null : key.slice(index + "node_modules/".length);
    if (name && FORBIDDEN_NAME.test(name)) report(file, `paquete "${name}" en el lockfile`);
  }
}

for await (const file of walk(ROOT)) {
  if (file === SELF) continue;
  const name = basename(file);

  if (VENDORED_FILE.test(name)) report(file, "copia vendida de Bootstrap");

  if (name === "package.json" || name === "package-lock.json") {
    try {
      const json = JSON.parse(await readFile(file, "utf8"));
      if (name === "package.json") checkManifest(file, json);
      else checkLockfile(file, json);
    } catch (error) {
      report(file, `no se pudo analizar el JSON (${error.message})`);
    }
  } else if (SOURCE_EXT.test(name)) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(IMPORT_RE)) {
      const pkg = packageName(match[1]);
      if (pkg && FORBIDDEN_NAME.test(pkg)) report(file, `import de "${match[1]}"`);
    }
  } else if (name.endsWith(".html")) {
    if (CDN_RE.test(await readFile(file, "utf8"))) report(file, "referencia a Bootstrap (CDN)");
  }
}

if (violations.length > 0) {
  console.error("Dependencias prohibidas por la constitución (Bootstrap / Next.js):");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`check-deps: sin Bootstrap ni Next.js en ${ROOT.split(sep).slice(-2).join("/")}`);
