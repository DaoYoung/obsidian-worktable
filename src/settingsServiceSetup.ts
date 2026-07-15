/**
 * settingsServiceSetup — renders the "Setup local service" wizard block in
 * the plugin settings tab.
 *
 * Why a separate module: settings.ts would create a circular import if it
 * pulled in CloakfetchClient directly (CloakfetchClient.ts already imports
 * the WorktableSettings type from settings.ts). Keeping the wizard here
 * breaks the cycle and keeps settings.ts focused on setting definitions.
 */

import { Platform, Setting } from "obsidian";
import type ObsidianWorktablePlugin from "./main";
import { CloakfetchClient } from "./services/CloakfetchClient";
import type { SettingsStrings } from "./settingsStrings";

type HostPlatform = "macos" | "linux" | "windows" | "unknown";

/** Detect the host platform via Obsidian's `Platform` API. Falls back to
 * `unknown` so the wizard can still render cross-platform instructions. */
function detectPlatform(): HostPlatform {
  if (Platform.isMacOS) return "macos";
  if (Platform.isWin) return "windows";
  if (Platform.isLinux) return "linux";
  return "unknown";
}

/** Copy a string to the clipboard, falling back to a hidden textarea when
 * `navigator.clipboard` is unavailable (older Electron versions). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }
  try {
    const ta = document.createElement("textarea");
    ta.className = "worktable-clipboard-fallback";
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Build a click-to-copy command block. Clicking copies the text and
 * shows the localized "Copied!" feedback for ~1.5s. */
function makeCopyableCode(parent: HTMLElement, text: string, copiedLabel: string): HTMLElement {
  const wrap = parent.createDiv({ cls: "worktable-cmd-wrap" });
  const pre = wrap.createEl("pre", { cls: "worktable-cmd" });
  pre.textContent = text;
  pre.setAttr("title", copiedLabel);
  pre.addEventListener("click", async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    const original = pre.textContent;
    pre.textContent = copiedLabel;
    pre.addClass("worktable-cmd-copied");
    window.setTimeout(() => {
      pre.textContent = original;
      pre.removeClass("worktable-cmd-copied");
    }, 1500);
  });
  return pre;
}

/** Render the platform-specific install instructions into `container`. */
function renderInstructions(container: HTMLElement, t: SettingsStrings, platform: HostPlatform): void {
  if (platform === "macos") {
    container.createEl("p", {
      cls: "worktable-setup-subtitle",
      text: t.serviceSetupMacosTitle,
    });
    container.createEl("p", {
      cls: "setting-item-description",
      text: t.serviceSetupMacosStep1,
    });
    makeCopyableCode(container, t.serviceSetupMacosCloneCmd, t.serviceSetupCopied);
    container.createEl("p", {
      cls: "setting-item-description",
      text: t.serviceSetupMacosStep2,
    });
    makeCopyableCode(container, t.serviceSetupMacosInstallCmd, t.serviceSetupCopied);
  } else {
    container.createEl("p", {
      cls: "setting-item-description",
      text: t.serviceSetupOtherOs,
    });
  }
}

/** Render the "Test connection" button + inline status into `container`. */
function renderTestButton(
  container: HTMLElement,
  plugin: ObsidianWorktablePlugin,
  t: SettingsStrings,
): void {
  const status = container.createDiv({ cls: "worktable-service-test-status" });
  status.setText("");

  new Setting(container)
    .setName(t.serviceSetupTestButton)
    .addButton((button) => {
      button
        .setButtonText(t.serviceSetupTestButton)
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          button.setButtonText(t.serviceSetupTesting);
          status.setText(t.serviceSetupTesting);
          try {
            const client = new CloakfetchClient(plugin.settings);
            const result = await client.aiHealth();
            if (result.ok && result.path === "direct") {
              status.setText(t.serviceSetupResultDirectAi);
            } else if (result.ok && result.path === "service") {
              status.setText(t.serviceSetupResultOkServiceAt(plugin.settings.serviceBaseUrl));
            } else {
              status.setText(t.serviceSetupResultDown(result.detail || "unknown error"));
            }
          } catch (err) {
            status.setText(t.serviceSetupResultDown((err as Error).message));
          } finally {
            button.setDisabled(false);
            button.setButtonText(t.serviceSetupTestButton);
          }
        });
    });
}

/** Public entry: render the whole wizard block (heading + intro +
 * instructions + test button) into `containerEl`. */
export function renderServiceSetup(
  containerEl: HTMLElement,
  plugin: ObsidianWorktablePlugin,
  t: SettingsStrings,
): void {
  const block = containerEl.createDiv({ cls: "worktable-service-setup" });
  block.createEl("h4", { text: t.serviceSetupHeading });
  block.createEl("p", {
    cls: "setting-item-description",
    text: t.serviceSetupIntro,
  });
  renderInstructions(block, t, detectPlatform());
  renderTestButton(block, plugin, t);
}