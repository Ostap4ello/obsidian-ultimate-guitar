export interface UltimateGuitarSettings {
    songFolder: string;
    defaultBpm: number;
    soundEnabled: boolean;
    vibrationEnabled: boolean;
    bpmBySource: Record<string, number>;
}

export interface SearchResult {
    title: string;
    artist: string;
    type: string;
    url: string;
    rating?: number;
    votes?: number;
    views?: number;
}

export interface SongData {
    title: string;
    artist: string;
    type: string;
    sourceUrl: string;
    bpm?: number;
    content: string;
    rating?: number;
    votes?: number;
    views?: number;
}

export interface UltimateGuitarPluginHost {
    settings: UltimateGuitarSettings;
    importSong(result: SearchResult, fetchedSong?: SongData): Promise<void>;
    saveSettings(): Promise<void>;
    openMarkdownView(
        file: import("obsidian").TFile,
        leaf: import("obsidian").WorkspaceLeaf,
    ): Promise<void>;
}
