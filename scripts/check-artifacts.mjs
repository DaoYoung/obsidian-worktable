import { readFile, stat } from "node:fs/promises";

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new Error(`${file} is missing or empty`);
}
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
if (manifest.version !== pkg.version) throw new Error("manifest and package versions differ");
if (!versions[manifest.version]) throw new Error("versions.json is missing the current version");
console.log(`Release artifacts verified for v${manifest.version}`);
