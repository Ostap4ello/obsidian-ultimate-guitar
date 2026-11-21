import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("text match precedes rating and popularity when sorting search results", async () => {
    const temp = await mkdtemp(join(tmpdir(), "obsidian-ug-ranking-"));
    const bundle = join(temp, "search-ranking.mjs");
    try {
        await execFileAsync("npx", [
            "esbuild",
            "src/search-ranking.ts",
            "--bundle",
            "--platform=node",
            "--format=esm",
            `--outfile=${bundle}`,
        ]);
        const { compareSearchResults } = await import(`file://${bundle}`);
        const exact = {
            title: "Hallelujah",
            artist: "Jeff Buckley",
            type: "Chords",
            url: "https://example.com/exact",
            rating: 3,
            votes: 10,
            views: 100,
        };
        const popularPartial = {
            title: "Hallelujah cover",
            artist: "Leonard Cohen",
            type: "Chords",
            url: "https://example.com/popular",
            rating: 5,
            votes: 5000,
            views: 100000,
        };
        const results = [popularPartial, exact].sort((left, right) =>
            compareSearchResults(left, right, "hallelujah"),
        );
        if (results[0] !== exact) {
            throw new Error("Exact text match was not prioritized");
        }
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
