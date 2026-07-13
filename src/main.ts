import { Plugin } from "obsidian";

export default class ObsidianWorktablePlugin extends Plugin {
  async onload(): Promise<void> {
    console.info("Obsidian Worktable loaded");
  }
}
