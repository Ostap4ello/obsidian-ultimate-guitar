import esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const isProduction = process.argv[2] === "production";

await mkdir("dist", { recursive: true });
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  sourcemap: isProduction ? false : "inline",
  outfile: "dist/main.js",
  minify: isProduction
});
await cp("manifest.json", "dist/manifest.json");
await cp("styles.css", "dist/styles.css");
