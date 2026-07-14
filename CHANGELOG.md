# Changelog

All notable changes to Obsidian Worktable will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-14

### Added

- **Multi-provider direct AI.** The Direct AI section in Settings now
  offers nine providers, each with a per-provider default base URL and
  model that auto-populate when you switch:
  - **Anthropic (Claude)** — `claude-sonnet-4-5`
  - **OpenAI (GPT)** — `gpt-4o-mini`
  - **Google Gemini** — `gemini-2.0-flash`
  - **DeepSeek** — `deepseek-chat`
  - **Moonshot (Kimi)** — `moonshot-v1-8k`
  - **Zhipu (GLM)** — `glm-4-flash`
  - **Alibaba Bailian (Qwen)** — `qwen-plus`
  - **Volcengine (Doubao)** — `doubao-1-5-pro-32k-250115`
  - **MiniMax** — `MiniMax-M3`
- A new `src/services/ai/` module — `types.ts`, `anthropic.ts`,
  `openaiCompat.ts`, `gemini.ts`, `registry.ts`, `client.ts` — models each
  provider as a spec with `buildRequest` / `parseResponse` / `parseError`.
  Anthropic-compatible proxies (MiniMax) share the Anthropic helpers; the
  six OpenAI-compatible Chinese providers share the OpenAI helpers; Gemini
  has its own. The transport is shared via a single `AiClient.call()`.
- 55 new unit tests in `tests/aiProviders.test.ts` (one `describe` per
  provider) lock down the request URL, auth header, body shape, response
  parser, error parser, and the conditional
  `anthropic-dangerous-direct-browser-access` header.

### Changed

- **Direct AI dropdown auto-populates base URL and model.** Picking a
  provider in Settings now writes the provider's defaults to
  `aiBaseUrl` and `aiModel` and re-renders the panel so the new
  placeholders / values are visible immediately. The user can still
  override either field after switching.
- `DirectAiClient` is now a thin wrapper over `AiClient`. The
  Anthropic-specific URL/header/body code moved into
  `src/services/ai/anthropic.ts`; `CloakfetchClient` passes the configured
  `aiProvider` through unchanged.

## [0.2.4] - 2026-07-14

### Fixed

- **Learning widget**: the `enablePublicFetchFallbacks` setting was a dead
  field — the widget read a name that did not exist on `WorktableSettings`.
  Renamed the interface field to `enableFallbackProxies` (the actual key) so
  public CORS proxies (`api.allorigins.win`, `corsproxy.io`) now actually
  get used as a fallback when the local Cloakfetch service is unavailable.
  Regression test added in `tests/cloakfetch.test.ts`.

### Changed

- **Learning widget: Cloakfetch is now optional.** A new "📋 Process
  pasted text" entry sits beside the URL fetch — paste any article body,
  the widget lifts a probable title from the first line, and the rest goes
  straight to the AI handlers with no local service required. This makes
  the Learning widget fully usable on **Obsidian Mobile** (no CloakBrowser,
  no local server). If fetch fails, the widget now surfaces a hint
  pointing at the paste fallback.
- Extracted the paste-parsing logic into `src/widgets/parsePastedArticle.ts`
  with 11 unit tests covering short/long titles, CJK punctuation, empty
  input, whitespace collapse, and the 6,000-char trim cap.

### Added

- **Server-side article extraction**: Cloakfetch now uses
  [`trafilatura`](https://trafilatura.readthedocs.io/) inside `_do_fetch()`
  to clean page HTML → Markdown before sending it back to the plugin. This
  removes nav / ads / scripts at the source so AI prompts stay short and
  focused. The new `markdown` field is preferred over `html` in
  `LearningWidget.fetchArticle()` when present; old clients and servers
  stay compatible (graceful fallback to client-side `htmlToArticle`).
- `trafilatura>=1.6.0,<3.0` added to `server/requirements.txt` — 1 MB
  Python lib, no LLM calls, no extra runtime cost beyond the one-time
  extract per fetch.
- 3 new server tests (`TestTrafilaturaExtraction`) covering success,
  missing-library, and runtime-error paths.

## [0.2.3] - 2026-07-14

### Changed

- The "Service token" setting is now framed as an **advanced override**. The
  description leads with the auto-discovery path
  (`~/.config/obsidian-worktable/server.json`) so users know the field can
  stay empty after running `install-macos.sh`.

### Added

- New **Setup local service** wizard inside the settings tab: shows
  platform-aware copy-to-clipboard install commands (macOS one-shot
  installer; Linux / Windows manual instructions) and a **Test connection**
  button that calls `CloakfetchClient.aiHealth()` and reports whether the
  local service is reachable — or that direct AI is configured and the
  local service is optional.

## [0.2.2] - 2026-07-13

### Changed

- Settings tab is now locale-aware. When Obsidian's language is set to a
  Chinese variant (`zh`, `zh-CN`, `zh-TW`, `zh-HK`), the Worktable settings
  panel renders Chinese labels and descriptions for every field, including
  the new "直连 AI" section. Any other language falls back to English so
  non-Chinese users keep the existing copy.
- The active locale is read via Obsidian's public `moment.locale()` API on
  every render of the settings tab, so switching Obsidian's language takes
  effect on the next open without reloading the plugin.

## [0.2.1] - 2026-07-13

### Changed

- Pomodoro widget now shows 20 records in a scrollable list (~6 visible at a
  time); the pause button label cycles between `⏸ 暂停` (running) and
  `▶ 继续` (paused) instead of being left empty.

### Fixed

- Learning widget gained a polished card frame (gradient background, rounded
  corners, drop shadow) and full typography for status badges, sections,
  options, feedback, explanations, key-point list, and concept previews so
  the panel no longer renders as a flat form.
- Review "定义解释" button now actually reveals the markdown body — the CSS
  selector matched a `.revealed` class but the widget toggles `.open`, so the
  body stayed hidden. Both classes now style the open state.

## [0.2.0] - 2026-07-13

### Added

- Added direct Anthropic-compatible AI settings for provider, API key, base URL,
  and model, with fallback to the local cloakfetch service.
- Added dynamic knowledge subject sections and cross-discipline review sampling.

### Changed

- Knowledge and review widgets now honor the configured knowledge file path.
- Pomodoro recent history now displays the latest three records by default while
  retaining the complete history for statistics and CSV export.
- Release automation now publishes BRAT-compatible GitHub Release assets and a
  manual-install ZIP after the full verification suite passes.

### Fixed

- Fixed Python server test discovery so CI loads `server/server.py` instead of
  the empty `server` package.

## [0.1.0] - 2026-07-13

### Added

- Initial release of Obsidian Worktable as a desktop-only Obsidian plugin.
- Six widgets rendered in a single custom view (`WorktableView`):
  - **Pomodoro** — focus timer with work / short break / long break / custom modes,
    IndexedDB-backed history, and CSV export.
  - **Todo** — priority-sorted (P0–P3) task list with inline editing, completion
    toggling, and bulk-clear of completed items.
  - **Learning** — fetch an article URL, AI-extract key points, run a quiz,
    archive the record (小红花), and preview/confirm before writing the concept
    into the knowledge file.
  - **小红花 (Flowers)** — running total plus expandable recent learning archive
    with question, user answer, correct answer, and source link.
  - **Review** — daily-draw flashcards for English vocabulary and math
    knowledge loaded from the configured knowledge file.
  - **News** — auto-list from `news/` folder or `#news` tag, with read/unread
    state and one-click marking.
- Custom Obsidian `ItemView` (`WorktableView`) registered via the standard
  `registerView` API and opened from the ribbon icon, command palette, and
  optional auto-open on startup.
- IndexedDB schemas preserved from the original DataviewJS dashboard so
  existing user data continues to load: `pomodoro-db` (v1), `home-db` (v2).
- Localstorage keys preserved: `pomo-state-v1`, `home-learning-flowers`,
  `home-knowledge-cache-v1`, `home-review-history-v1`, `home-review-today-v1`.
- Portable `server/` directory containing the local Python `cloakfetch`
  service source (`server.py`, `requirements.txt`, `config.example.json`),
  `install-macos.sh`, `manage.sh`, `uninstall-macos.sh`, and a launchd plist
  template — all using `$HOME`-derived paths.
- Settings tab for the knowledge file path, news folder, cloakfetch base URL,
  service token override, public-proxy fallback toggle, and
  open-on-startup preference.
- Service health banner that surfaces actionable setup guidance when the
  cloakfetch service is unavailable, while keeping non-AI widgets usable.
- Server token authentication via `X-Worktable-Token`, localhost binding only
  (`127.0.0.1`), request-size limits, and HTTP(S)-only fetch targets.
- Build pipeline (`npm run build`) that bundles `main.js`, `manifest.json`,
  and `styles.css`, plus a verification command (`npm run verify`) that runs
  TypeScript type-checking, vitest, the Python unittest suite, the esbuild
  build, and an artifact sanity check.
- GitHub Actions CI (`.github/workflows/ci.yml`) running type-check, tests,
  build, and artifact checks, plus release workflow
  (`.github/workflows/release.yml`) attaching the release bundle to version
  tags.
- Repository smoke checks guarding against hardcoded machine paths, secrets,
  Dataview imports, skipped/only tests, and stub/TODO placeholders.

### Changed

- Migrated the 8-block DataviewJS dashboard from `Home.md` to a native
  Obsidian plugin — no Dataview runtime dependency at runtime.

### Security

- Removed hardcoded `/Users/yidao/...` paths from the plugin code; the
  plugin resolves the service config from `$HOME/.config/obsidian-worktable/`,
  `/etc/obsidian-worktable/server.json`, or the existing
  `~/.claude/settings.json` fallback.
- Server now requires a generated local-only service token for operational
  routes and validates incoming URLs.

[0.2.0]: https://github.com/DaoYoung/obsidian-worktable/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/DaoYoung/obsidian-worktable/releases/tag/v0.1.0
