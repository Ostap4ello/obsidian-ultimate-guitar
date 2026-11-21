import { PluginSettingTab, Setting } from "obsidian";
import { clamp } from "./utils";
import type { UltimateGuitarPluginHost } from "./types";

export class UltimateGuitarSettingTab extends PluginSettingTab {
  constructor(app: import("obsidian").App, private readonly plugin: UltimateGuitarPluginHost & import("obsidian").Plugin) {
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
    new Setting(containerEl).setName("Default BPM").addText((text) =>
      text.setValue(String(this.plugin.settings.defaultBpm)).onChange(async (value) => {
        this.plugin.settings.defaultBpm = clamp(Number(value), 30, 240);
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("Metronome sound").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.soundEnabled).onChange(async (value) => {
        this.plugin.settings.soundEnabled = value;
        await this.plugin.saveSettings();
      })
    );
    new Setting(containerEl).setName("Metronome vibration").addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.vibrationEnabled).onChange(async (value) => {
        this.plugin.settings.vibrationEnabled = value;
        await this.plugin.saveSettings();
      })
    );
  }
}
