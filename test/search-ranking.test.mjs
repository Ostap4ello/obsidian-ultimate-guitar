import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("text match, views, votes, and rating determine search result order", async () => {
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

        const lowPopularity = {
            title: "Hallelujah",
            artist: "Other Artist",
            type: "Chords",
            url: "https://example.com/low",
            rating: 5,
            votes: 500,
            views: 1000,
        };
        const highPopularity = {
            title: "Hallelujah",
            artist: "Another Artist",
            type: "Chords",
            url: "https://example.com/high",
            rating: 1,
            votes: 400,
            views: 2000,
        };
        const tieResults = [lowPopularity, highPopularity].sort((left, right) =>
            compareSearchResults(left, right, "hallelujah"),
        );
        if (tieResults[0] !== highPopularity) {
            throw new Error("View count was not used after text match");
        }
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
