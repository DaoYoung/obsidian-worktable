# Obsidian Worktable

A native Obsidian dashboard plugin for focus, tasks, learning, review, and
news. Built as a single custom `ItemView` (no Dataview dependency), six
widgets render in a grid layout and share state through native IndexedDB.
AI features can run either through the bundled local Cloakfetch service or
via direct browser calls to Anthropic / OpenAI / Gemini-compatible
endpoints.

[🇨🇳 简体中文 → README_zh.md](./README_zh.md)

---

## Features

- **Native `ItemView` dashboard** — single view, no Dataview dependency,
  opens automatically on startup.
- **Pomodoro focus timer** — circular ring, custom durations, session
  history, daily focus averages (excluding today).
- **Todo board** — add, complete, and clear todos with priority levels;
  data persisted in IndexedDB.
- **Inquiry-based learning** — look up any concept; the AI expands it
  with translation, part of speech, and structured Markdown (great for
  vocabulary, math formulas, science notes).
- **Active recall** — AI-generates MCQ / cloze / true-false questions
  from an article and tracks per-knowledge-point mastery in
  `plans/知识点.md`.
- **End-of-day review** — surfaces items you wrote, archived, or marked
  for review; cross-widget "today" feed.
- **News aggregation** — surfaces any markdown inside the news folder
  *or* any file tagged `#news` anywhere in the vault, sorted by mtime.
- **"小红花" encouragement widget** — completion rewards and an archive
  of every archived learning record.
- **Direct AI providers** — Anthropic (Claude), OpenAI (GPT), Google
  Gemini, DeepSeek, Moonshot (Kimi), Zhipu (GLM), Alibaba Bailian (Qwen),
  Volcengine (Doubao), MiniMax — switchable in settings without code
  changes.
- **Local Cloakfetch service** for article fetching (`/fetch`) and as
  the AI proxy fallback; token auto-discovered from
  `~/.config/obsidian-worktable/server.json`.
- **Plain CSS** — `src/styles/*.css` files are concatenated by
  `scripts/build-styles.mjs`; theme-friendly, no PostCSS step.

## Installation

### Option A: BRAT (recommended — works without submitting to Community Plugins)

1. Install **BRAT** from Obsidian's Community Plugins.
2. Open `Settings → BRAT → Add a beta plugin`.
3. Paste:
   `https://github.com/DaoYoung/obsidian-worktable.git`
4. Enable **Worktable** under Community Plugins.

> BRAT installs from the **latest published GitHub Release's
> attachments**, not from the repo root. Releases must not be Draft, and
> must attach `main.js`, `manifest.json`, `styles.css`, and
> `obsidian-worktable.zip`.
>
> If the repo is private, configure a GitHub token with read access in
> BRAT's SecretStorage and select that token when adding the plugin.

### Option B: Manual install from GitHub Release

1. Download the latest `obsidian-worktable.zip` from
   [Releases](https://github.com/DaoYoung/obsidian-worktable/releases).
2. Unzip into your vault:
   ```
   vault/.obsidian/plugins/obsidian-worktable/
   ```
3. Enable **Worktable** under Community Plugins.

### Option C: Build from source

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git
cd obsidian-worktable
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` from the repo root into
your vault's plugin directory. `npm run dev` watches for changes during
development.

> Once submitted and accepted into Obsidian's Community Plugins, this
> plugin will appear in `Settings → Community plugins → Browse` and can
> be installed with one click. Until then, BRAT is the supported install
> channel.

## Local service (Cloakfetch)

Article fetching (`/fetch`) and the AI proxy when Direct AI is not
configured both go through a small Python service bundled in
`server/server.py`. Token auto-discovery means you usually do not have to
copy anything into the plugin's settings — the installer writes the token
to `~/.config/obsidian-worktable/server.json` and the plugin reads it on
first request.

### macOS — one-shot install

`Settings → Community plugins → Worktable → Options` shows a "Setup
local service" card. Click the install command, paste it into Terminal:

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git ~/obsidian-worktable
bash ~/obsidian-worktable/server/install-macos.sh
```

The script:
- Installs the Python service as a macOS `launchd` user agent (auto-start
  on login, restart on crash).
- Generates a random `serviceToken` and writes it to
  `~/.config/obsidian-worktable/server.json`.
- Launches the service immediately.

After install, click **Test connection** in the same settings card to
verify. A green "✓ Local service reachable" line means you're done.

### Linux / Windows

`launchd` is macOS-only. On Linux and Windows, run the service manually:

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git ~/obsidian-worktable
cd ~/obsidian-worktable/server
pip3 install -r requirements.txt   # first time only
python3 server.py
```

Leave the terminal open, or run under tmux / systemd-user / NSSM.
`serviceToken` auth works the same way; just put a value into
`~/.config/obsidian-worktable/server.json` (or set
`WORKTABLE_SERVICE_TOKEN`) and the plugin picks it up.

### Configuration file

`~/.config/obsidian-worktable/server.json`:

```json
{
  "host": "127.0.0.1",
  "port": 8765,
  "serviceToken": "your-service-token-here",
  "aiAuthToken": "sk-ant-api03-xxxxxxxx",
  "aiBaseUrl": "https://api.anthropic.com",
  "aiModel": "claude-sonnet-4-5",
  "aiMaxTokens": 2048,
  "aiTimeout": 60,
  "upstreamFetchTimeout": 30
}
```

- **`host`** — listen address. **Do not change to `0.0.0.0`**; the plugin
  talks to the service over loopback only.
- **`port`** — defaults to `8765`. Change if you have a port conflict.
- **`serviceToken`** — required header `X-Worktable-Token` for every
  request. Leave empty to disable auth (fine for single-user, no-trust
  local).
- **`aiAuthToken`** — Anthropic-compatible key (also accepts
  `anthropicApiKey`). Env vars `ANTHROPIC_AUTH_TOKEN` /
  `ANTHROPIC_API_KEY` / `~/.claude/settings.json` override the file.
- **`aiBaseUrl`** / **`aiModel`** — defaults follow the model's defaults
  but can be repointed to any compatible gateway.

Any field can be overridden with `WORKTABLE_<FIELD_NAME>` env vars
(camelCase → `UPPER_SNAKE`), which take precedence over the file:

```bash
export WORKTABLE_SERVICE_TOKEN="your-token"
export WORKTABLE_AI_BASE_URL="https://your-proxy.example.com"
export WORKTABLE_PORT=9001
```

### Token auto-discovery

The plugin reads the service token in this order:

1. The "Service token (advanced override)" field in plugin settings —
   **leave empty unless bypassing the config file**.
2. `~/.config/obsidian-worktable/server.json` `serviceToken`.
3. `/etc/obsidian-worktable/server.json` `serviceToken`.
4. Empty string → server's `_check_auth` allows the request.

After running `install-macos.sh`, step 2 is set automatically and you do
not need to touch plugin settings.

## Plugin settings

`Settings → Community plugins → Obsidian Worktable → Options`:

| Setting | Default | Notes |
|---|---|---|
| Knowledge file | `plans/知识点.md` | Vault-relative path the learning modules read and write |
| News folder | `news` | Folder for the news widget; `#news`-tagged files anywhere also appear |
| Service base URL | `http://127.0.0.1:8765` | Local Cloakfetch service endpoint |
| Service token (advanced override) | `""` | Leave empty — auto-discovered from `~/.config/obsidian-worktable/server.json` |
| Open on startup | ✅ | Auto-open the Worktable view when Obsidian starts |
| Enable fallback proxies | ✅ | CORS proxy fallback when article fetching fails |
| Provider | `anthropic` | AI provider for Direct AI mode |
| API key | `""` | Provider API key |
| Base URL | `https://api.anthropic.com` | Auto-fills on provider change; supports private gateways |
| Model | `claude-sonnet-4-5` | Auto-fills on provider change; manual override allowed |

Settings live in `.obsidian/plugins/obsidian-worktable/data.json`,
managed by Obsidian.

### Direct AI vs local service

When **API key + Base URL + Model** are all filled, the plugin calls
your provider directly from the browser (works with native CORS-enabled
endpoints: Anthropic, OpenAI, Google Gemini). `/fetch` still goes
through the local Cloakfetch service.

If any of those three is empty, AI calls fall through to the local
service's `/ai/*` endpoints (which read the same provider config from
`server.json` server-side).

## AI providers

| Provider | Default Base URL | Default Model |
|---|---|---|
| Anthropic (Claude) | `https://api.anthropic.com` | `claude-sonnet-4-5` |
| OpenAI (GPT) | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.0-flash` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Zhipu (GLM) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| Alibaba Bailian (Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Volcengine (Doubao) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-1-5-pro-32k-250115` |
| MiniMax | `https://api.minimaxi.com/anthropic` | `MiniMax-M3` |

Any OpenAI Chat-Completions-compatible endpoint works: pick `openai` and
override `Base URL`. Switching providers auto-fills `Base URL` and
`Model`; you can override either afterwards.

## Troubleshooting

### Plugin fails to enable

1. Confirm Obsidian version ≥ 1.5.0 (`Settings → About`).
2. Check `main.js`, `manifest.json`, `styles.css` are all present.
3. Open `Ctrl/Cmd + P → "Show debug console"`, reload, look for red
   errors mentioning `worktable`.

### "Local service is not reachable: ECONNREFUSED"

Run the appropriate install step above, then `Test connection` in the
plugin settings card. If the service is running but the plugin can't
reach it, the Service base URL in plugin settings is probably wrong.

### News widget shows nothing

The widget scans the configured folder plus any markdown with the
`#news` tag. Either create `news/` in the vault and add a file, or add
`#news` to an existing note's frontmatter / inline.

### Storage and reset

All widget data lives in IndexedDB under the database `home-db` and the
localStorage keys documented in `src/widgets/*.ts`. Use the Obsidian
debug console → "Inspect" to clear them, or uninstall + reinstall the
plugin (Obsidian prompts before deleting storage).

## Development

```bash
npm install
npm run dev          # watch mode (CSS + esbuild)
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run test:server  # python3 -m unittest in server/tests
npm run verify       # typecheck + tests + build + artifact checks
```

Source layout:

- `src/main.ts` — plugin entry, view registration
- `src/view/WorktableView.ts` — single `ItemView`, grid layout,
  widget descriptor registry
- `src/widgets/<name>Widget.ts` and `src/widgets/<name>.ts` — each
  widget pair (logic + lazy-load wrapper)
- `src/services/CloakfetchClient.ts` — the only AI transport; routes
  Direct AI vs local service
- `src/services/ai/{registry,anthropic,openaiCompat,gemini,client}.ts`
  — provider specs
- `src/styles/{base,productivity,learning}.css` — concatenated by
  `scripts/build-styles.mjs` to root `styles.css`
- `server/` — Python Cloakfetch service (FastAPI / uvicorn)
- `tests/` — Vitest specs + `server/tests/` for the Python side

## Privacy

- All widget data is stored locally in your vault (IndexedDB + the
  file `plans/知识点.md` for knowledge points).
- The plugin does not collect telemetry. No analytics calls.
- Tokens and API keys live in `.obsidian/plugins/obsidian-worktable/data.json`
  (managed by Obsidian) or `~/.config/obsidian-worktable/server.json`,
  and are sent only to the local service over loopback.
- `server.json` is in `.gitignore` — no secrets reach the repo.

## License

MIT
