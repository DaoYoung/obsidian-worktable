/**
 * settingsStrings — locale-aware UI strings for the plugin settings tab.
 *
 * The tabs re-render whenever the user opens them (and could re-render on
 * Obsidian language change), so we resolve the current locale fresh on each
 * `display()` call rather than caching it. Non-Chinese Obsidian locales fall
 * back to the English bundle, which preserves the existing user experience
 * for every other language.
 */

export interface SettingsStrings {
  heading: string;
  pathSection: string;
  knowledgeFileName: string;
  knowledgeFileDesc: string;
  newsFolderName: string;
  newsFolderDesc: string;
  serviceSection: string;
  serviceBaseUrlName: string;
  serviceBaseUrlDesc: string;
  serviceTokenName: string;
  serviceTokenDesc: string;
  openOnStartupName: string;
  openOnStartupDesc: string;
  fallbackProxiesName: string;
  fallbackProxiesDesc: string;
  serviceSetupHeading: string;
  serviceSetupIntro: string;
  serviceSetupMacosTitle: string;
  serviceSetupMacosStep1: string;
  serviceSetupMacosCloneCmd: string;
  serviceSetupMacosStep2: string;
  serviceSetupMacosInstallCmd: string;
  serviceSetupOtherOs: string;
  serviceSetupTestButton: string;
  serviceSetupTesting: string;
  serviceSetupResultOkService: string;
  serviceSetupResultOkServiceAt: (url: string) => string;
  serviceSetupResultDirectAi: string;
  serviceSetupResultDown: (detail: string) => string;
  serviceSetupCopied: string;
  directAiSection: string;
  directAiIntro: string;
  aiProviderName: string;
  aiProviderDesc: string;
  aiProviderOption: string;
  aiApiKeyName: string;
  aiApiKeyDesc: string;
  aiBaseUrlName: string;
  aiBaseUrlDesc: string;
  aiModelName: string;
  aiModelDesc: string;
  aiStatusActive: (model: string) => string;
  aiStatusInactive: string;
}

const en: SettingsStrings = {
  heading: "Obsidian Worktable",
  pathSection: "Vault paths",
  knowledgeFileName: "Knowledge file",
  knowledgeFileDesc:
    "Vault-relative path used by the Learning and Review widgets (e.g. plans/知识点.md).",
  newsFolderName: "News folder",
  newsFolderDesc:
    "Folder used by the News widget. Files outside this folder with the #news tag are also picked up.",
  serviceSection: "Local Cloakfetch service",
  serviceBaseUrlName: "Service base URL",
  serviceBaseUrlDesc:
    "Base URL for the local Cloakfetch service (used for fetching pages and, when no direct AI key is set, for AI calls).",
  serviceTokenName: "Service token (advanced override)",
  serviceTokenDesc:
    "Override the auto-discovered service token. Leave empty — the plugin reads from ~/.config/obsidian-worktable/server.json automatically once the install script has been run. Fill only to bypass the config file.",
  openOnStartupName: "Open on startup",
  openOnStartupDesc: "Open the Worktable view automatically when Obsidian starts.",
  fallbackProxiesName: "Enable fallback proxies",
  fallbackProxiesDesc:
    "Allow the Learning widget to fall back to public CORS proxies if the local service is unreachable.",
  serviceSetupHeading: "Setup local service",
  serviceSetupIntro:
    "The local service handles article fetching for the Learning widget. Direct AI calls work without it — skip this section if you only use direct AI.",
  serviceSetupMacosTitle: "macOS — one-shot install",
  serviceSetupMacosStep1:
    "1. Clone the repo (or download server/install-macos.sh from the latest release):",
  serviceSetupMacosCloneCmd:
    "git clone https://github.com/DaoYoung/obsidian-worktable.git ~/obsidian-worktable",
  serviceSetupMacosStep2: "2. Run the installer (sets up venv, deps, and launchd):",
  serviceSetupMacosInstallCmd:
    "bash ~/obsidian-worktable/server/install-macos.sh",
  serviceSetupOtherOs:
    "Linux / Windows: launchd is unavailable — start the server manually with `python3 server/server.py` after `pip install -r server/requirements.txt`. See the README for details.",
  serviceSetupTestButton: "Test connection",
  serviceSetupTesting: "Testing…",
  serviceSetupResultOkService: "✓ Local service reachable",
  serviceSetupResultOkServiceAt: (url) => `✓ Local service reachable at ${url}`,
  serviceSetupResultDirectAi:
    "✓ Direct AI is configured. The local service is optional.",
  serviceSetupResultDown: (detail) => `✗ Local service is not reachable: ${detail}`,
  serviceSetupCopied: "Copied!",
  directAiSection: "Direct AI (optional)",
  directAiIntro:
    "When all three fields below are filled, the plugin calls AI directly through the Anthropic Messages API and does not need the local Cloakfetch service for AI features. Leave blank to keep using the local service.",
  aiProviderName: "Provider",
  aiProviderDesc: "AI provider. Only Anthropic is supported in this release.",
  aiProviderOption: "Anthropic (Messages API)",
  aiApiKeyName: "API key",
  aiApiKeyDesc:
    "Anthropic API key (sk-ant-...). Stored in the plugin's data.json like any other setting.",
  aiBaseUrlName: "Base URL",
  aiBaseUrlDesc:
    "Anthropic-compatible endpoint. Use https://api.anthropic.com for the official API, or a proxy/MiniMax-compatible URL.",
  aiModelName: "Model",
  aiModelDesc:
    "Model identifier sent in the API request (e.g. claude-sonnet-4-5).",
  aiStatusActive: (model) => `✓ Direct AI active · model = ${model}`,
  aiStatusInactive:
    "Direct AI not configured — using the local Cloakfetch service for AI calls.",
};

const zh: SettingsStrings = {
  heading: "Obsidian Worktable",
  pathSection: "库内路径",
  knowledgeFileName: "知识点文件",
  knowledgeFileDesc:
    "学习与复习模块所使用的库内相对路径(例如 plans/知识点.md)。",
  newsFolderName: "新闻文件夹",
  newsFolderDesc:
    "新闻模块扫描的文件夹。带有 #news 标签的其他位置文件也会一并被列出。",
  serviceSection: "本地 Cloakfetch 服务",
  serviceBaseUrlName: "服务地址",
  serviceBaseUrlDesc:
    "本地 Cloakfetch 服务的访问地址,用于抓取网页;未配置直连 AI 时,AI 调用也走这里。",
  serviceTokenName: "服务令牌(高级覆盖)",
  serviceTokenDesc:
    "覆盖自动发现的服务令牌。一般留空即可——运行安装脚本后,插件会自动从 ~/.config/obsidian-worktable/server.json 读取。仅在需要绕过配置文件时才填写。",
  openOnStartupName: "启动时自动打开",
  openOnStartupDesc: "Obsidian 启动时自动打开 Worktable 视图。",
  fallbackProxiesName: "启用公共代理回退",
  fallbackProxiesDesc:
    "本地服务不可用时,允许学习模块回退到公共 CORS 代理。",
  serviceSetupHeading: "本地服务一键安装",
  serviceSetupIntro:
    "本地服务用于学习模块抓取网页。直连 AI 不依赖它——只用直连 AI 时可跳过本节。",
  serviceSetupMacosTitle: "macOS —— 一键安装",
  serviceSetupMacosStep1:
    "1. 克隆仓库(或从最新 Release 单独下载 server/install-macos.sh):",
  serviceSetupMacosCloneCmd:
    "git clone https://github.com/DaoYoung/obsidian-worktable.git ~/obsidian-worktable",
  serviceSetupMacosStep2: "2. 运行安装脚本(自动建 venv、装依赖、注册 launchd):",
  serviceSetupMacosInstallCmd:
    "bash ~/obsidian-worktable/server/install-macos.sh",
  serviceSetupOtherOs:
    "Linux / Windows:launchd 不可用,需手动 `python3 server/server.py` 启动,先 `pip install -r server/requirements.txt`。详见 README。",
  serviceSetupTestButton: "测试连接",
  serviceSetupTesting: "测试中…",
  serviceSetupResultOkService: "✓ 本地服务可达",
  serviceSetupResultOkServiceAt: (url) => `✓ 本地服务可达 ${url}`,
  serviceSetupResultDirectAi: "✓ 已配置直连 AI。本地服务可选。",
  serviceSetupResultDown: (detail) => `✗ 本地服务不可达:${detail}`,
  serviceSetupCopied: "已复制!",
  directAiSection: "直连 AI(可选)",
  directAiIntro:
    "当下列三项均填写后,插件将通过 Anthropic Messages API 直接调用 AI,不再依赖本地 Cloakfetch 服务。留空则继续使用本地服务。",
  aiProviderName: "服务商",
  aiProviderDesc: "AI 服务商。当前仅支持 Anthropic。",
  aiProviderOption: "Anthropic(消息 API)",
  aiApiKeyName: "API 密钥",
  aiApiKeyDesc:
    "Anthropic API 密钥(sk-ant-...)。与其他设置一同保存在插件的 data.json 中。",
  aiBaseUrlName: "接入地址",
  aiBaseUrlDesc:
    "兼容 Anthropic 的接口地址。官方请填写 https://api.anthropic.com,也可填写代理或第三方兼容地址。",
  aiModelName: "模型",
  aiModelDesc: "API 请求使用的模型标识(例如 claude-sonnet-4-5)。",
  aiStatusActive: (model) => `✓ 直连 AI 已启用 · 模型 = ${model}`,
  aiStatusInactive: "未配置直连 AI — AI 调用继续使用本地 Cloakfetch 服务。",
};

/**
 * Returns Chinese for Chinese-locale variants (`zh`, `zh-CN`, `zh-TW`, `zh-HK`),
 * and English for every other locale. Empty/unknown input falls back to English.
 *
 * Exported for unit testing.
 */
export function pickSettingsLocale(locale: string | null | undefined): "zh" | "en" {
  if (!locale) return "en";
  return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** Returns the visible UI strings for the given Obsidian locale code. */
export function getSettingsStrings(locale: string | null | undefined): SettingsStrings {
  return pickSettingsLocale(locale) === "zh" ? zh : en;
}