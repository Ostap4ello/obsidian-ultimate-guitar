import { MarkdownView, Notice, Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { SearchModal } from "./search";
import { UltimateGuitarSettingTab } from "./settings";
import { SONG_VIEW_TYPE, UltimateGuitarSongView } from "./song-view";
import type { SearchResult, SongData, UltimateGuitarSettings } from "./types";
import { fetchSong } from "./ultimate-guitar";
import { quoteYaml, sanitizeFileName } from "./utils";

const DEFAULT_SETTINGS: UltimateGuitarSettings = {
    songFolder: "Ultimate Guitar",
    defaultBpm: 100,
    soundEnabled: true,
    vibrationEnabled: true,
    bpmBySource: {},
};

const MODE_POLL_INTERVAL_MS = 300;

export default class UltimateGuitarPlugin extends Plugin {
    settings: UltimateGuitarSettings = DEFAULT_SETTINGS;
    private readonly leafModes = new WeakMap<WorkspaceLeaf, "reading" | "editing">();

    async onload(): Promise<void> {
        await this.loadSettings();
        this.addSettingTab(new UltimateGuitarSettingTab(this.app, this));
        this.registerView(SONG_VIEW_TYPE, (leaf) => new UltimateGuitarSongView(leaf, this));

        this.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                void this.routeActiveImportedFile(file);
            }),
        );
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", (leaf) => {
                void this.routeActiveLeaf(leaf);
            }),
        );
        this.registerEvent(
            this.app.workspace.on("layout-change", () => {
                void this.routeActiveLeaf(this.getMainLeaf());
            }),
        );
        this.app.workspace.onLayoutReady(() => {
            void this.routeActiveLeaf(this.getMainLeaf());
        });
        this.registerInterval(
            window.setInterval(() => {
                void this.routeActiveLeaf(this.getMainLeaf());
            }, MODE_POLL_INTERVAL_MS),
        );

        this.addCommand({
            id: "search-ultimate-guitar",
            name: "Search Ultimate Guitar",
            callback: () => new SearchModal(this.app, this).open(),
        });

        const ribbonIcon = this.addRibbonIcon("music", "Search Ultimate Guitar", () => {
            new SearchModal(this.app, this).open();
        });
        this.app.workspace.onLayoutReady(() => {
            const ribbon = ribbonIcon.parentElement;
            if (ribbon) ribbon.appendChild(ribbonIcon);
        });
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private getMainLeaf(): WorkspaceLeaf | null {
        return this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    }

    private async routeActiveImportedFile(file: TFile | null): Promise<void> {
        if (!(file instanceof TFile) || !this.isImportedSong(file)) return;
        const mainLeaf = this.getMainLeaf();
        if (!mainLeaf) return;

        if (this.leafModes.get(mainLeaf) === "editing") {
            const state = mainLeaf.getViewState();
            if (state.state?.file === file.path) return;
        }

        for (const leaf of this.app.workspace.getLeavesOfType(SONG_VIEW_TYPE)) {
            if (leaf.getRoot() !== this.app.workspace.rootSplit) continue;
            const state = leaf.getViewState();
            if (state.state?.file !== file.path) continue;
            this.app.workspace.setActiveLeaf(leaf, { focus: true });
            if (mainLeaf !== leaf) {
                const mainState = mainLeaf.getViewState();
                if (mainLeaf.view instanceof MarkdownView && mainState.state?.file === file.path) {
                    mainLeaf.detach();
                }
            }
            return;
        }
        await this.routeActiveLeaf(mainLeaf, file);
    }

    private async routeActiveLeaf(
        leaf: WorkspaceLeaf | null,
        fileOverride?: TFile | null,
    ): Promise<void> {
        if (!leaf || leaf.getRoot() !== this.app.workspace.rootSplit) return;
        const file = fileOverride ?? this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || !this.isImportedSong(file)) {
            this.leafModes.delete(leaf);
            return;
        }
        if (leaf.view?.getViewType() === SONG_VIEW_TYPE) {
            this.leafModes.set(leaf, "reading");
            const state = leaf.getViewState();
            if (state.state?.file !== file.path) await this.openSongView(file, leaf);
            return;
        }
        if (leaf.view instanceof MarkdownView) {
            if (leaf.view.getMode() === "source") {
                if (this.leafModes.get(leaf) !== "editing") {
                    await this.openSongView(file, leaf);
                    return;
                }
                this.leafModes.set(leaf, "editing");
                return;
            }
            this.leafModes.set(leaf, "reading");
            await this.openSongView(file, leaf);
            return;
        }
        if (this.leafModes.get(leaf) === "editing") return;
        await this.openSongView(file, leaf);
    }

    isImportedSong(file: TFile): boolean {
        return this.app.metadataCache.getFileCache(file)?.frontmatter?.ug_imported === true;
    }

    async openSongView(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
        this.leafModes.set(leaf, "reading");
        await leaf.setViewState({
            type: SONG_VIEW_TYPE,
            active: true,
            state: { file: file.path },
        });
    }

    async openMarkdownView(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
        this.leafModes.set(leaf, "editing");
        await leaf.setViewState({
            type: "markdown",
            active: true,
            state: { file: file.path, mode: "source", source: true },
        });
    }

    async importSong(result: SearchResult, fetchedSong?: SongData): Promise<void> {
        const song = fetchedSong ?? (await fetchSong(result));
        const folder = await this.chooseFolder();
        await this.ensureFolder(folder);
        const path = await this.getUniqueSongPath(folder, `${song.artist} - ${song.title}`);
        const body = [
            "---",
            "ug_imported: true",
            "cssclasses: ug-song-note",
            `ug_source_url: ${quoteYaml(song.sourceUrl)}`,
            `ug_artist: ${quoteYaml(song.artist)}`,
            `ug_type: ${quoteYaml(song.type)}`,
            `ug_bpm: ${song.bpm ?? this.settings.defaultBpm}`,
            `ug_rating: ${song.rating ?? ""}`,
            `ug_votes: ${song.votes ?? ""}`,
            `ug_views: ${song.views ?? ""}`,
            "---",
            "",
            `# ${song.title}`,
            "",
            `Source: [Ultimate Guitar](${song.sourceUrl})`,
            "",
            "```ug-song",
            JSON.stringify({ ...song, bpm: song.bpm ?? this.settings.defaultBpm }),
            "```",
            "",
        ].join("\n");
        await this.app.vault.create(path, body);
        new Notice(`Imported ${path}`);
    }

    private async getUniqueSongPath(folder: string, name: string): Promise<string> {
        const baseName = sanitizeFileName(name);
        let suffix = 1;
        let path = `${folder}/${baseName}.md`;
        while (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
            suffix += 1;
            path = `${folder}/${baseName} ${suffix}.md`;
        }
        return path;
    }

    async chooseFolder(): Promise<string> {
        const configured = this.settings.songFolder.trim().replace(/^\/+|\/+$/g, "");
        return configured || "Ultimate Guitar";
    }

    async ensureFolder(path: string): Promise<void> {
        const parts = path.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
                await this.app.vault.createFolder(current);
            }
        }
    }
}
