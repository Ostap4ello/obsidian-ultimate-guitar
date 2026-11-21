import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { SearchResult, UltimateGuitarPluginHost } from "./types";
import { fetchSong, searchUltimateGuitar } from "./ultimate-guitar";
import { formatStats } from "./utils";

export class SearchModal extends Modal {
    private readonly plugin: UltimateGuitarPluginHost;
    private resultsEl!: HTMLElement;
    private searchTimer?: number;
    private searchSequence = 0;

    constructor(app: App, plugin: UltimateGuitarPluginHost) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        this.contentEl.addClass("ug-search-modal");
        this.titleEl.setText("Search Ultimate Guitar");
        new Setting(this.contentEl).setName("Song or artist").addText((text) => {
            text.inputEl.focus();
            text.setPlaceholder("Type song name or paste Ultimate Guitar link");
            text.onChange(async (value) => {
                this.cancelPendingSearch();
                const query = value.trim();
                if (query.length < 2) {
                    this.resultsEl.empty();
                    return;
                }
                this.searchTimer = window.setTimeout(() => {
                    this.searchTimer = undefined;
                    void this.search(query);
                }, 400);
            });
        });
        this.resultsEl = this.contentEl.createDiv({ cls: "ug-search-results" });
    }

    onClose(): void {
        this.cancelPendingSearch();
    }

    private cancelPendingSearch(): void {
        this.searchSequence += 1;
        if (this.searchTimer) {
            window.clearTimeout(this.searchTimer);
            this.searchTimer = undefined;
        }
    }

    async search(query: string): Promise<void> {
        const sequence = ++this.searchSequence;
        this.resultsEl.empty();
        this.resultsEl.createEl("p", { text: "Searching..." });
        try {
            const results = await searchUltimateGuitar(query);
            if (sequence !== this.searchSequence) return;
            this.resultsEl.empty();
            if (!results.length) {
                this.resultsEl.createEl("p", { text: "No results found." });
                return;
            }
            for (const result of results) this.renderResult(result);
        } catch (error) {
            if (sequence !== this.searchSequence) return;
            this.resultsEl.empty();
            this.resultsEl.createEl("p", {
                text: error instanceof Error ? error.message : "Search failed.",
            });
        }
    }

    private renderResult(result: SearchResult): void {
        const item = this.resultsEl.createDiv({ cls: "ug-search-result" });
        item.createDiv({ cls: "ug-search-result-title", text: result.title });
        item.createDiv({ cls: "ug-search-result-meta", text: `${result.artist} · ${result.type}` });
        if (result.rating !== undefined || result.views !== undefined) {
            item.createDiv({ cls: "ug-search-result-meta", text: formatStats(result) });
        }
        new ButtonComponent(item).setButtonText("Preview").onClick(() => {
            new PreviewModal(this.app, this.plugin, result).open();
        });
    }
}

class PreviewModal extends Modal {
    constructor(
        app: App,
        private readonly plugin: UltimateGuitarPluginHost,
        private readonly result: SearchResult,
    ) {
        super(app);
    }

    async onOpen(): Promise<void> {
        this.titleEl.setText("Preview Ultimate Guitar song");
        this.contentEl.createEl("p", { text: "Loading preview..." });
        try {
            const song = await fetchSong(this.result);
            this.contentEl.empty();
            this.contentEl.createEl("h2", { text: song.title });
            this.contentEl.createEl("p", { text: `${song.artist} · ${song.type}` });
            const stats = formatStats(song);
            if (stats) this.contentEl.createEl("p", { cls: "ug-search-result-meta", text: stats });
            this.contentEl.createEl("pre", {
                cls: "ug-preview-content",
                text: song.content.slice(0, 4000),
            });
            const actions = this.contentEl.createDiv({ cls: "ug-preview-actions" });
            new ButtonComponent(actions)
                .setButtonText("Import to vault")
                .setCta()
                .onClick(async () => {
                    try {
                        await this.plugin.importSong(this.result, song);
                        this.close();
                    } catch (error) {
                        new Notice(error instanceof Error ? error.message : "Import failed.");
                    }
                });
            new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
        } catch (error) {
            this.contentEl.empty();
            this.contentEl.createEl("p", {
                text: error instanceof Error ? error.message : "Unable to load preview.",
            });
        }
    }
}
