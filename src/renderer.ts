import { ButtonComponent, MarkdownRenderChild } from "obsidian";
import type { SongData, UltimateGuitarPluginHost } from "./types";
import { clamp } from "./utils";

export class SongRenderer extends MarkdownRenderChild {
    private metronome?: Metronome;

    constructor(
        containerEl: HTMLElement,
        private readonly song: SongData,
        private readonly plugin: UltimateGuitarPluginHost,
    ) {
        super(containerEl);
    }

    onload(): void {
        const root = this.containerEl.createDiv({ cls: "ug-song" });
        root.createEl("h2", { text: this.song.title });
        root.createEl("p", { text: `${this.song.artist} · ${this.song.type}` });
        const toolbar = root.createDiv({ cls: "ug-song-toolbar" });
        const content = root.createDiv({ cls: "ug-song-content" });
        for (const line of this.song.content.split("\n")) renderSongLine(content, line);

        const textToggle = toolbar.createDiv({ cls: "ug-text-toggle" });
        const textToggleLabel = textToggle.createEl("label", { cls: "ug-switch" });
        const textToggleInput = textToggleLabel.createEl("input", { type: "checkbox" });
        textToggleLabel.createSpan({ cls: "ug-switch-slider" });
        textToggleLabel.createSpan({ cls: "ug-switch-text", text: "Text only" });
        textToggleInput.addEventListener("change", () => {
            const textOnly = textToggleInput.checked;
            root.classList.toggle("ug-text-only-mode", textOnly);
            content.classList.toggle("ug-text-only", textOnly);
            applyTextOnlyMode(content, textOnly);
        });

        this.metronome = new Metronome(toolbar, this.song, this.plugin);
        this.metronome.render();
    }

    onunload(): void {
        this.metronome?.stop();
    }
}

class Metronome {
    private timer?: number;
    private firstBeatTimer?: number;
    private audio?: AudioContext;
    private bpm: number;

    constructor(
        private readonly container: HTMLElement,
        private readonly song: SongData,
        private readonly plugin: UltimateGuitarPluginHost,
    ) {
        this.bpm =
            plugin.settings.bpmBySource[song.sourceUrl] ?? song.bpm ?? plugin.settings.defaultBpm;
    }

    render(): void {
        const wrapper = this.container.createDiv({ cls: "ug-metronome" });
        const bpm = wrapper.createEl("input", { type: "number" });
        bpm.min = "30";
        bpm.max = "240";
        bpm.value = String(this.bpm);
        bpm.setAttribute("aria-label", "BPM");
        const toggle = wrapper.createEl("button", { text: "Start metronome" });
        toggle.onclick = () => {
            if (this.timer) {
                this.stop();
                toggle.setText("Start metronome");
            } else {
                this.bpm = clamp(Number(bpm.value), 30, 240);
                this.song.bpm = this.bpm;
                this.plugin.settings.bpmBySource[this.song.sourceUrl] = this.bpm;
                void this.plugin.saveSettings();
                this.start();
                toggle.setText("Stop metronome");
            }
        };
    }

    start(): void {
        const interval = 60000 / this.bpm;
        this.firstBeatTimer = window.setTimeout(() => {
            this.firstBeatTimer = undefined;
            this.tick();
            this.timer = window.setInterval(() => this.tick(), interval);
        }, interval);
    }

    stop(): void {
        if (this.timer) window.clearInterval(this.timer);
        if (this.firstBeatTimer) window.clearTimeout(this.firstBeatTimer);
        this.timer = undefined;
        this.firstBeatTimer = undefined;
        this.audio?.close();
        this.audio = undefined;
    }

    tick(): void {
        if (this.plugin.settings.vibrationEnabled && "vibrate" in navigator) navigator.vibrate(45);
        if (!this.plugin.settings.soundEnabled) return;
        this.audio ??= new AudioContext();
        const oscillator = this.audio.createOscillator();
        const gain = this.audio.createGain();
        oscillator.frequency.value = 880;
        gain.gain.value = 0.05;
        oscillator.connect(gain);
        gain.connect(this.audio.destination);
        oscillator.start();
        oscillator.stop(this.audio.currentTime + 0.04);
    }
}

function renderSongLine(container: HTMLElement, rawLine: string): void {
    const line = rawLine
        .replace(/\[\/?(?:tab|title|intro|verse[^\]]*|chorus|bridge|solo|outro)\]/gi, "")
        .replace(/^\s+/, "");
    const sectionMatch = rawLine.match(
        /^\s*(?:\[tab\])?\s*\[(intro|verse[^]]*|chorus|bridge|solo|outro)[^\]]*\]\s*$/i,
    );
    const chordOnly = isChordOnlyLine(line);
    const structureOnly = isStructureOnlyLine(line);
    const classes = [
        sectionMatch ? "ug-song-section" : "",
        rawLine.trim() ? "" : "ug-empty-line",
        chordOnly ? "ug-chord-only" : "",
        structureOnly ? "ug-structure-only" : "",
    ]
        .filter(Boolean)
        .join(" ");
    const lineEl = container.createDiv({ cls: classes || undefined });
    if (!line) {
        lineEl.setText("\u00a0");
        return;
    }
    let cursor = 0;
    const chordPattern = /\[ch\](.*?)\[\/ch\]/gi;
    for (const match of line.matchAll(chordPattern)) {
        const index = match.index ?? 0;
        if (index > cursor) lineEl.appendText(line.slice(cursor, index));
        lineEl.createSpan({ cls: "ug-chord", text: match[1] });
        cursor = index + match[0].length;
    }
    if (cursor < line.length) lineEl.appendText(line.slice(cursor));
    if (!lineEl.textContent) lineEl.setText(line.replace(/\[\/?[^]]+\]/g, ""));
}

function isStructureOnlyLine(line: string): boolean {
    const withoutChords = line.replace(/\[ch\].*?\[\/ch\]/gi, "").trim();
    if (/\[ch\].*?\[\/ch\]/i.test(line) && /^[\s|/,-]*$/.test(withoutChords)) return true;
    if (!withoutChords.includes("|") && !/[/-]/.test(withoutChords)) return false;
    return /^(\|?\s*(?:[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?|fm|x\d+)\s*[|/,-]?\s*)+$/i.test(
        withoutChords,
    );
}

function isChordOnlyLine(line: string): boolean {
    if (!/\[ch\].*?\[\/ch\]/i.test(line)) return false;
    const withoutChords = line.replace(/\[ch\].*?\[\/ch\]/gi, "");
    return /^[\s|/,-]*$/.test(withoutChords);
}

function applyTextOnlyMode(content: HTMLElement, enabled: boolean): void {
    let consecutiveEmptyRows = 0;
    for (const child of Array.from(content.children)) {
        const row = child as HTMLElement;
        if (!row.classList.contains("ug-empty-line")) {
            consecutiveEmptyRows = 0;
            row.style.removeProperty("display");
            continue;
        }
        consecutiveEmptyRows += 1;
        row.style.display = enabled && consecutiveEmptyRows > 1 ? "none" : "";
    }
}
