import {
  App,
  ButtonComponent,
  ItemView,
  MarkdownView,
  MarkdownRenderChild,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  ViewStateResult,
  WorkspaceLeaf,
  requestUrl
} from "obsidian";

interface UltimateGuitarSettings {
  songFolder: string;
  defaultBpm: number;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  bpmBySource: Record<string, number>;
}

interface SearchResult {
  title: string;
  artist: string;
  type: string;
  url: string;
  rating?: number;
  votes?: number;
  views?: number;
}

interface SongData {
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

const DEFAULT_SETTINGS: UltimateGuitarSettings = {
  songFolder: "Ultimate Guitar",
  defaultBpm: 100,
  soundEnabled: true,
  vibrationEnabled: true,
  bpmBySource: {}
};

const SEARCH_URL = "https://www.ultimate-guitar.com/search.php?search_type=title&value=";

export default class UltimateGuitarPlugin extends Plugin {
  settings = DEFAULT_SETTINGS;
  private readonly leafModes = new WeakMap<WorkspaceLeaf, "reading" | "editing">();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new UltimateGuitarSettingTab(this.app, this));
    this.registerView("ultimate-guitar-song", (leaf) => new UltimateGuitarSongView(leaf, this));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      void this.routeActiveImportedFile(file);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      void this.routeActiveLeaf(leaf);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      void this.routeActiveLeaf(this.getMainLeaf());
    }));
    this.app.workspace.onLayoutReady(() => {
      void this.routeActiveLeaf(this.getMainLeaf());
    });
    this.registerInterval(window.setInterval(() => {
      void this.routeActiveLeaf(this.getMainLeaf());
    }, 300));
    this.addCommand({
      id: "search-ultimate-guitar",
      name: "Search Ultimate Guitar",
      callback: () => new SearchModal(this.app, this).open()
    });
    const ultimateGuitarRibbonIcon = this.addRibbonIcon("music", "Search Ultimate Guitar", () => {
      new SearchModal(this.app, this).open();
    });
    this.app.workspace.onLayoutReady(() => {
      const ribbon = ultimateGuitarRibbonIcon.parentElement;
      if (ribbon) ribbon.appendChild(ultimateGuitarRibbonIcon);
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

    for (const leaf of this.app.workspace.getLeavesOfType("ultimate-guitar-song")) {
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

  private async routeActiveLeaf(leaf: WorkspaceLeaf | null, fileOverride?: TFile | null): Promise<void> {
    if (!leaf) return;
    if (leaf.getRoot() !== this.app.workspace.rootSplit) return;
    const file = fileOverride ?? this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || !this.isImportedSong(file)) {
      this.leafModes.delete(leaf);
      return;
    }
    if (leaf.view?.getViewType() === "ultimate-guitar-song") {
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
      type: "ultimate-guitar-song",
      active: true,
      state: { file: file.path }
    });
  }

  async openMarkdownView(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    this.leafModes.set(leaf, "editing");
    await leaf.setViewState({
      type: "markdown",
      active: true,
      state: { file: file.path, mode: "source", source: true }
    });
  }

  async importSong(result: SearchResult, fetchedSong?: SongData): Promise<void> {
    const song = fetchedSong ?? await fetchSong(result);
    const folder = await this.chooseFolder();
    const path = `${folder}/${sanitizeFileName(`${song.artist} - ${song.title}`)}.md`;
    const existing = this.app.vault.getAbstractFileByPath(path);
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
      ""
    ].join("\n");
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, body);
      new Notice(`Updated ${path}`);
      return;
    }
    await this.ensureFolder(folder);
    await this.app.vault.create(path, body);
    new Notice(`Imported ${path}`);
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

class UltimateGuitarSongView extends ItemView {
  private filePath = "";
  private renderer?: SongRenderer;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: UltimateGuitarPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return "ultimate-guitar-song";
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
      this.contentEl.createEl("p", { text: "This note has no Ultimate Guitar song payload." });
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

class SearchModal extends Modal {
  private readonly plugin: UltimateGuitarPlugin;
  private resultsEl!: HTMLElement;

  constructor(app: App, plugin: UltimateGuitarPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.contentEl.addClass("ug-search-modal");
    this.titleEl.setText("Search Ultimate Guitar");
    new Setting(this.contentEl)
      .setName("Song or artist")
      .addText((text) => {
        text.inputEl.focus();
        text.setPlaceholder("Type song name or paste Ultimate Guitar link");
        text.onChange(async (value) => {
          if (value.trim().length >= 2) await this.search(value.trim());
        });
      });
    this.resultsEl = this.contentEl.createDiv({ cls: "ug-search-results" });
  }

  async search(query: string): Promise<void> {
    this.resultsEl.empty();
    this.resultsEl.createEl("p", { text: "Searching..." });
    try {
      const results = await searchUltimateGuitar(query);
      this.resultsEl.empty();
      if (!results.length) {
        this.resultsEl.createEl("p", { text: "No results found." });
        return;
      }
      for (const result of results) {
        const item = this.resultsEl.createDiv({ cls: "ug-search-result" });
        item.createDiv({ cls: "ug-search-result-title", text: result.title });
        item.createDiv({ cls: "ug-search-result-meta", text: `${result.artist} · ${result.type}` });
        if (result.rating !== undefined || result.views !== undefined) {
          item.createDiv({
            cls: "ug-search-result-meta",
            text: formatStats(result)
          });
        }
        new ButtonComponent(item)
          .setButtonText("Preview")
          .onClick(async () => {
            try {
              new PreviewModal(this.app, this.plugin, result).open();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Ultimate Guitar import failed.");
            }
          });
      }
    } catch (error) {
      this.resultsEl.empty();
      this.resultsEl.createEl("p", { text: error instanceof Error ? error.message : "Search failed." });
    }
  }
}

class PreviewModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: UltimateGuitarPlugin,
    private readonly result: SearchResult
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
        text: song.content.slice(0, 4000)
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
        text: error instanceof Error ? error.message : "Unable to load preview."
      });
    }
  }
}

class SongRenderer extends MarkdownRenderChild {
  private readonly song: SongData;
  private readonly plugin: UltimateGuitarPlugin;

  constructor(containerEl: HTMLElement, song: SongData, plugin: UltimateGuitarPlugin) {
    super(containerEl);
    this.song = song;
    this.plugin = plugin;
  }

  onload(): void {
    const root = this.containerEl.createDiv({ cls: "ug-song" });
    root.createEl("h2", { text: this.song.title });
    root.createEl("p", { text: `${this.song.artist} · ${this.song.type}` });
    const toolbar = root.createDiv({ cls: "ug-song-toolbar" });
    const content = root.createDiv({ cls: "ug-song-content" });
    for (const line of this.song.content.split("\n")) {
      renderSongLine(content, line);
    }
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
    const metronome = new Metronome(toolbar, this.song, this.plugin);
    metronome.render();
  }

  onunload(): void {}
}

class Metronome {
  private timer?: number;
  private firstBeatTimer?: number;
  private audio?: AudioContext;
  private bpm: number;
  private readonly song: SongData;
  private readonly plugin: UltimateGuitarPlugin;

  constructor(private readonly container: HTMLElement, song: SongData, plugin: UltimateGuitarPlugin) {
    this.song = song;
    this.plugin = plugin;
    this.bpm = plugin.settings.bpmBySource[song.sourceUrl] ?? song.bpm ?? plugin.settings.defaultBpm;
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

class UltimateGuitarSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: UltimateGuitarPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Song folder")
      .setDesc("Vault-relative folder for imported songs.")
      .addText((text) =>
        text.setValue(this.plugin.settings.songFolder).onChange(async (value) => {
          this.plugin.settings.songFolder = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Default BPM")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.defaultBpm)).onChange(async (value) => {
          this.plugin.settings.defaultBpm = clamp(Number(value), 30, 240);
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Metronome sound")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.soundEnabled).onChange(async (value) => {
          this.plugin.settings.soundEnabled = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Metronome vibration")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.vibrationEnabled).onChange(async (value) => {
          this.plugin.settings.vibrationEnabled = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

async function searchUltimateGuitar(query: string): Promise<SearchResult[]> {
  const directUrl = parseUltimateGuitarUrl(query);
  if (directUrl) return [directUrl];
  const searchUrl = `${SEARCH_URL}${encodeURIComponent(query)}`;
  const response = await requestUrl({ url: searchUrl });
  if (response.status < 200 || response.status >= 300) throw new Error(`Ultimate Guitar search failed (${response.status}).`);
  const doc = new DOMParser().parseFromString(response.text, "text/html");
  const linkResults = Array.from(doc.querySelectorAll("a[href]"))
    .map((anchor) => {
      const href = anchor.getAttribute("href") ?? "";
      const url = new URL(href, "https://www.ultimate-guitar.com").toString();
      const surroundingText = anchor.parentElement?.textContent?.trim() ?? "";
      return {
        title: anchor.textContent?.trim() ?? "",
        artist: surroundingText.replace(anchor.textContent?.trim() ?? "", "").trim() || "Unknown artist",
        type: /chords/i.test(url) ? "Chords" : "Tab",
        url
      };
    })
    .filter((result) => result.title && /ultimate-guitar\.com\//.test(result.url) && /\/(?:tab|chords|pro)\//.test(result.url));
  const embeddedResults = extractEmbeddedSearchResults(response.text);
  const results = [...linkResults, ...embeddedResults]
    .filter((result, index, all) => all.findIndex((candidate) => candidate.url === result.url) === index)
    .slice(0, 20);
  if (!results.length) {
    throw new Error(`Ultimate Guitar returned no parsable results for "${query}". The site may have changed its HTML or blocked the request.`);
  }
  return results;
}

function parseUltimateGuitarUrl(value: string): SearchResult | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!/(^|\.)ultimate-guitar\.com$/i.test(url.hostname) || !/\/(?:tab|chords|pro)\//i.test(url.pathname)) {
    return undefined;
  }
  const slug = url.pathname.split("/").filter(Boolean).at(-1) ?? "Ultimate Guitar song";
  const title = slug
    .replace(/-\d+$/, "")
    .replace(/-(?:chords|tabs?|pro|guitar-pro)$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    title,
    artist: "Ultimate Guitar",
    type: /chords/i.test(url.pathname) ? "Chords" : "Tab",
    url: url.toString()
  };
}

function extractEmbeddedSearchResults(html: string): SearchResult[] {
  const decoded = html
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'");
  const results: SearchResult[] = [];
  const pattern = /"localized_song_name":"([^"]+)","localized_artist_name":"([^"]+)"/g;
  for (const match of decoded.matchAll(pattern)) {
    const preceding = decoded.slice(Math.max(0, (match.index ?? 0) - 2500), match.index ?? 0);
    const urlMatch = [...preceding.matchAll(/"tab_url":"([^"]+)"/g)].at(-1);
    if (!urlMatch) continue;
    const url = urlMatch[1];
    if (!/\/tab\//.test(url)) continue;
    const rating = Number(preceding.match(/"rating":([0-9.]+)/)?.[1]);
    const votes = Number(preceding.match(/"votes":(\d+)/)?.[1]);
    const views = Number(preceding.match(/"tab_views":(\d+)/)?.[1]);
    results.push({
      title: match[1],
      artist: match[2],
      type: /chords/i.test(url) ? "Chords" : "Tab",
      url,
      rating: Number.isFinite(rating) ? rating : undefined,
      votes: Number.isFinite(votes) ? votes : undefined,
      views: Number.isFinite(views) ? views : undefined
    });
  }
  return results;
}

async function fetchSong(result: SearchResult): Promise<SongData> {
  const response = await requestUrl({ url: result.url });
  if (response.status < 200 || response.status >= 300) throw new Error(`Ultimate Guitar page failed (${response.status}).`);
  const doc = new DOMParser().parseFromString(response.text, "text/html");
  const payload = extractSongPayload(response.text);
  const content = payload?.content ?? extractSongContent(doc);
  if (!content) throw new Error("The page did not contain readable song content.");
  const title = payload?.title || result.title;
  const artist = payload?.artist || result.artist;
  const bpm = extractBpm(doc, response.text);
  return {
    title,
    artist,
    type: payload?.type || result.type,
    sourceUrl: result.url,
    bpm,
    content,
    rating: payload?.rating ?? result.rating,
    votes: payload?.votes ?? result.votes,
    views: payload?.views ?? result.views
  };
}

function extractSongContent(doc: Document): string {
  const candidates = [
    "[class*='js-store']",
    "[class*='tab-view']",
    "[class*='song-content']",
    "pre"
  ];
  for (const selector of candidates) {
    const node = doc.querySelector(selector);
    const text = node?.textContent;
    if (text && text.length > 30) return text;
  }

  return doc.body?.innerText ?? "";
}

function extractSongPayload(html: string): Partial<SongData> | undefined {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const store = doc.querySelector(".js-store[data-content]")?.getAttribute("data-content");
  if (!store) return undefined;
  try {
    const root = JSON.parse(store);
    const pageData = root.store?.page?.data;
    const tab = pageData?.tab;
    const tabView = pageData?.tab_view;
    const content = tabView?.wiki_tab?.content;
    if (typeof content !== "string") return undefined;
    return {
      title: tab?.localized_song_name || tab?.song_name,
      artist: tab?.localized_artist_name || tab?.artist_name,
      type: tab?.type_name || tab?.type,
      content,
      rating: toNumber(tab?.rating),
      votes: toNumber(tab?.votes),
      views: toNumber(tabView?.stats?.view_total ?? tab?.tab_views)
    };
  } catch {
    return undefined;
  }
}

function renderSongLine(container: HTMLElement, rawLine: string): void {
  const line = rawLine
    .replace(/\[\/?(?:tab|title|intro|verse[^\]]*|chorus|bridge|solo|outro)\]/gi, "")
    .replace(/^\s+/, "");
  const sectionMatch = rawLine.match(/^\s*(?:\[tab\])?\s*\[(intro|verse[^]]*|chorus|bridge|solo|outro)[^\]]*\]\s*$/i);
  const chordOnly = isChordOnlyLine(line);
  const structureOnly = isStructureOnlyLine(line);
  const classes = [
    sectionMatch ? "ug-song-section" : "",
    rawLine.trim() ? "" : "ug-empty-line",
    chordOnly ? "ug-chord-only" : "",
    structureOnly ? "ug-structure-only" : ""
  ].filter(Boolean).join(" ");
  const lineEl = container.createDiv({
    cls: classes || undefined
  });
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
  return /^(\|?\s*(?:[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?|fm|x\d+)\s*[|/,-]?\s*)+$/i.test(withoutChords);
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

function toNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function formatStats(result: Pick<SearchResult, "rating" | "votes" | "views">): string {
  const stats = [];
  if (result.rating !== undefined) stats.push(`★ ${result.rating.toFixed(1)}`);
  if (result.votes !== undefined) stats.push(`${result.votes.toLocaleString()} ratings`);
  if (result.views !== undefined) stats.push(`${formatCompact(result.views)} views`);
  return stats.join(" · ");
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function extractBpm(doc: Document, html: string): number | undefined {
  const text = `${doc.body?.innerText ?? ""}\n${html}`;
  const match = text.match(/\b(?:bpm|tempo)\D{0,20}(\d{2,3})\b/i);
  return match ? clamp(Number(match[1]), 30, 240) : undefined;
}

function quoteYaml(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 180);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}


