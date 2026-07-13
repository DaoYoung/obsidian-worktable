/**
 * build-styles.mjs — Concatenate component styles into root styles.css
 *
 * Inputs:  src/styles/base.css, src/styles/productivity.css, src/styles/learning.css
 * Output:  styles.css (root)
 *
 * Generates a header comment marking the build timestamp and source files.
 * Fails clearly if any input is missing.
 */

import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const INPUTS = [
  "src/styles/base.css",
  "src/styles/productivity.css",
  "src/styles/learning.css",
];

const OUTPUT = "styles.css";

async function exists(path) {
  try {
    const s = await stat(resolve(ROOT, path));
    return s.isFile();
  } catch {
    return false;
  }
}

async function read(path) {
  return readFile(resolve(ROOT, path), "utf8");
}

// Verify all inputs present
const missing = [];
for (const input of INPUTS) {
  if (!(await exists(input))) {
    missing.push(input);
  }
}

if (missing.length > 0) {
  console.error(`build-styles: missing input(s):\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

// Read all sources
const sources = await Promise.all(INPUTS.map(read));

// Generate header
const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const sourceComments = INPUTS.map((s) => ` *  - ${s}`).join("\n");

const header = `/* ===========================================================================
   Obsidian Worktable — Built Styles
   Generated: ${timestamp}
   Sources:
${sourceComments}
   =========================================================================== */
`;

const combined = header + sources.join("\n\n");

await writeFile(resolve(ROOT, OUTPUT), combined, "utf8");

console.log(`build-styles: wrote ${OUTPUT} (${combined.split("\n").length} lines)`);
