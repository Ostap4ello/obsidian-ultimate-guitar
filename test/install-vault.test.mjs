import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("install:vault copies the plugin bundle into a vault plugin directory", async () => {
    const vault = await mkdtemp(join(tmpdir(), "obsidian-ug-vault-"));
    try {
        await execFileAsync("node", ["scripts/install-vault.mjs", vault]);
        const manifest = JSON.parse(
            await readFile(
                join(vault, ".obsidian", "plugins", "ultimate-guitar", "manifest.json"),
                "utf8",
            ),
        );
        const main = await readFile(
            join(vault, ".obsidian", "plugins", "ultimate-guitar", "main.js"),
            "utf8",
        );
        if (manifest.id !== "ultimate-guitar") throw new Error("plugin manifest was not copied");
        if (!main.includes("Ultimate Guitar")) throw new Error("plugin bundle was not copied");
    } finally {
        await rm(vault, { recursive: true, force: true });
    }
});
