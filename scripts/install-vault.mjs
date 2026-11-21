import { access, cp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const vault = process.argv[2];
if (!vault) {
    console.error("Usage: npm run install:vault -- /path/to/vault");
    process.exit(1);
}

const source = resolve("dist");
const target = join(resolve(vault), ".obsidian", "plugins", "ultimate-guitar");
try {
    await access(join(source, "main.js"));
} catch {
    console.error("dist/main.js is missing. Run npm run build first.");
    process.exit(1);
}
await mkdir(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) {
    await cp(join(source, file), join(target, file));
}
console.log(`Installed Ultimate Guitar plugin into ${target}`);
