import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));

if (packageJson.version !== manifest.version) {
    throw new Error(
        `package.json version ${packageJson.version} does not match manifest.json version ${manifest.version}`,
    );
}
if (versions[manifest.version] !== manifest.minAppVersion) {
    throw new Error(`versions.json does not map ${manifest.version} to ${manifest.minAppVersion}`);
}

for (const file of ["main.js", "manifest.json", "styles.css"]) {
    await access(resolve("dist", file));
}

console.log(`Release ${manifest.version} is ready`);
