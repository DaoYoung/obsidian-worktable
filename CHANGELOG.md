# Changelog

All notable changes to Obsidian Worktable will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/DaoYoung/obsidian-worktable/releases/tag/v0.1.0