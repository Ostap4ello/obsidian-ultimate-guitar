import { MarkdownRenderChild, setIcon } from "obsidian";
import type { SongData, UltimateGuitarPluginHost } from "./types";

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
        const header = root.createDiv({ cls: "ug-song-header" });
        header.createEl("h2", { cls: "ug-song-title", text: this.song.title });
        header.createEl("span", {
            cls: "ug-song-author",
            text: `${this.song.artist} · ${this.song.type}`,
        });
        const toolbar = root.createDiv({ cls: "ug-song-toolbar" });
        const content = root.createDiv({ cls: "ug-song-content" });
        for (const line of this.song.content.split("\n")) renderSongLine(content, line);

        const textToggle = toolbar.createDiv({ cls: "ug-mode-switch" });
        const chordsButton = textToggle.createEl("button", {
            cls: "ug-mode-option is-selected",
            text: "Chords",
        });
        const textButton = textToggle.createEl("button", {
            cls: "ug-mode-option",
            text: "Text only",
        });
        const setTextOnly = (textOnly: boolean) => {
            root.classList.toggle("ug-text-only-mode", textOnly);
            content.classList.toggle("ug-text-only", textOnly);
            applyTextOnlyMode(content, textOnly);
            chordsButton.classList.toggle("is-selected", !textOnly);
            textButton.classList.toggle("is-selected", textOnly);
        };
        chordsButton.onclick = () => setTextOnly(false);
        textButton.onclick = () => setTextOnly(true);

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
        const configured =
            plugin.settings.bpmBySource[song.sourceUrl] ?? song.bpm ?? plugin.settings.defaultBpm;
        this.bpm = Math.min(299, Math.max(2, configured));
    }

    render(): void {
        const wrapper = this.container.createDiv({ cls: "ug-metronome" });
        wrapper.createEl("span", { cls: "ug-metronome-label", text: "Metronome:" });
        const controls = wrapper.createDiv({ cls: "ug-metronome-controls" });
        const bpm = controls.createEl("input", {
            cls: "ug-bpm-input",
            type: "text",
            attr: {
                "aria-label": "BPM",
                inputmode: "numeric",
                maxlength: "3",
            },
        });
        bpm.value = String(this.bpm);
        const setBpm = (value: number) => {
            if (!Number.isFinite(value) || value <= 1 || value >= 300) {
                bpm.addClass("is-invalid");
                return;
            }
            bpm.removeClass("is-invalid");
            this.bpm = Math.floor(value);
            bpm.value = String(this.bpm);
        };
        bpm.oninput = () => {
            const value = Number(bpm.value.replace(/\D/g, "").slice(0, 3));
            if (bpm.value !== String(value)) bpm.value = String(value);
            setBpm(value);
        };
        bpm.onblur = () => setBpm(Number(bpm.value));
        const bpmSteps = controls.createDiv({ cls: "ug-bpm-steps" });
        const minus = bpmSteps.createEl("button", { cls: "ug-bpm-step", text: "-" });
        const plus = bpmSteps.createEl("button", { cls: "ug-bpm-step", text: "+" });
        minus.onclick = () => setBpm(this.bpm - 1);
        plus.onclick = () => setBpm(this.bpm + 1);
        controls.createEl("span", { cls: "ug-bpm-unit", text: "bpm" });
        const toggle = controls.createEl("button", {
            cls: "ug-metronome-toggle",
            attr: { "aria-label": "Start metronome" },
        });
        const setRunning = (running: boolean) => {
            toggle.classList.toggle("is-on", running);
            toggle.classList.toggle("is-off", !running);
            toggle.empty();
            setIcon(toggle, running ? "pause" : "play");
            toggle.setAttribute("aria-label", running ? "Stop metronome" : "Start metronome");
        };
        toggle.onclick = () => {
            if (this.timer) {
                this.stop();
                setRunning(false);
            } else {
                setBpm(Number(bpm.value));
                if (bpm.hasClass("is-invalid")) return;
                this.song.bpm = this.bpm;
                this.plugin.settings.bpmBySource[this.song.sourceUrl] = this.bpm;
                void this.plugin.saveSettings();
                this.start();
                setRunning(true);
            }
        };
        setRunning(false);
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
