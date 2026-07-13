import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const vault = process.env.OBSIDIAN_VAULT;
if (!vault) throw new Error("Set OBSIDIAN_VAULT to your vault root before deploying");

const target = path.join(vault, ".obsidian", "plugins", "obsidian-worktable");
await mkdir(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await stat(file);
  await cp(file, path.join(target, file));
}
console.log(`Deployed Obsidian Worktable to ${target}`);
