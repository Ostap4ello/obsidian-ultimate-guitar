import { ButtonComponent, ItemView, TFile, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { SongRenderer } from "./renderer";
import type { SongData, UltimateGuitarPluginHost } from "./types";

export const SONG_VIEW_TYPE = "ultimate-guitar-song";

export class UltimateGuitarSongView extends ItemView {
    private filePath = "";
    private renderer?: SongRenderer;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: UltimateGuitarPluginHost,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return SONG_VIEW_TYPE;
    }
    getDisplayText(): string {
        return "Reading";
    }
    getIcon(): string {
        return "book-open";
    }
    getState(): Record<string, unknown> {
        return { file: this.filePath };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const stateRecord = state as Record<string, unknown>;
        this.filePath = typeof stateRecord.file === "string" ? stateRecord.file : "";
        result.history = true;
        await super.setState(state, result);
        await this.renderFile();
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass("ug-whole-song-view");
        await this.renderFile();
    }

    async onClose(): Promise<void> {
        this.renderer?.onunload();
    }

    private async renderFile(): Promise<void> {
        this.contentEl.empty();
        if (!this.filePath) return;
        const file = this.app.vault.getAbstractFileByPath(this.filePath);
        if (!(file instanceof TFile)) {
            this.contentEl.createEl("p", { text: "Ultimate Guitar song file not found." });
            return;
        }
        const markdown = await this.app.vault.read(file);
        const songMatch = markdown.match(/```ug-song\s*\n([\s\S]*?)\n```/);
        if (!songMatch) {
            this.contentEl.createEl("p", {
                text: "This note has no Ultimate Guitar song payload.",
            });
            return;
        }
        try {
            const song = JSON.parse(songMatch[1]) as SongData;
            const toolbar = this.contentEl.createDiv({ cls: "ug-whole-view-toolbar" });
            new ButtonComponent(toolbar)
                .setButtonText("Edit")
                .onClick(() => void this.plugin.openMarkdownView(file, this.leaf));
            const songContainer = this.contentEl.createDiv();
            this.renderer = new SongRenderer(songContainer, song, this.plugin);
            this.renderer.onload();
        } catch {
            this.contentEl.createEl("p", { text: "Unable to read this Ultimate Guitar song." });
        }
    }
}
