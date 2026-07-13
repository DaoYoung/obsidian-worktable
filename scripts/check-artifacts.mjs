/**
 * check-artifacts.mjs — Verify release artifacts are valid
 *
 * Checks:
 *  - Release files (main.js, manifest.json, styles.css) exist and are nonempty
 *  - Version agreement: manifest.json, package.json, versions.json
 *  - styles.css contains scoped CSS (no empty file)
 *  - main.js has no Dataview imports or references
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const FILES = ["main.js", "manifest.json", "styles.css"];

async function checkFile(file) {
  const info = await stat(resolve(ROOT, file));
  if (!info.isFile()) throw new Error(`${file} is not a file`);
  if (info.size === 0) throw new Error(`${file} is empty`);
  return info.size;
}

// 1. Release files exist and are nonempty
for (const file of FILES) {
  const size = await checkFile(file);
  console.log(`  ${file}: ${size} bytes`);
}

// 2. Version agreement
const manifest = JSON.parse(await readFile(resolve(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const versions = JSON.parse(await readFile(resolve(ROOT, "versions.json"), "utf8"));

if (manifest.version !== pkg.version) {
  throw new Error(`Version mismatch: manifest.json=${manifest.version} package.json=${pkg.version}`);
}
if (!versions[manifest.version]) {
  throw new Error(`versions.json is missing entry for ${manifest.version}`);
}
console.log(`  versions agree: ${manifest.version}`);

// 3. styles.css must contain scoped CSS
const css = await readFile(resolve(ROOT, "styles.css"), "utf8");
if (!css.includes(".obsidian-worktable")) {
  throw new Error("styles.css is missing scoped CSS (no .obsidian-worktable selector)");
}
const cssSizeKB = (css.length / 1024).toFixed(1);
console.log(`  styles.css: ${cssSizeKB} KB, scoped`);

// 4. main.js must not import or reference Dataview
const main = await readFile(resolve(ROOT, "main.js"), "utf8");
const dataviewPatterns = [
  /require\s*\(\s*["']dataview["']\s*\)/i,
  /import\s+.*\s+from\s+["']dataview["']/i,
  /from\s+["']dataview["']/i,
  /(["'])dataview\1/i,
];

for (const pattern of dataviewPatterns) {
  if (pattern.test(main)) {
    throw new Error(`main.js contains Dataview reference matching ${pattern}`);
  }
}
console.log(`  main.js: no Dataview references`);

console.log(`\nRelease artifacts verified for v${manifest.version}`);
