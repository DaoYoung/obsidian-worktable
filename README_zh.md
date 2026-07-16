# Obsidian Worktable

一款用于专注、任务、学习、回顾和资讯的原生 Obsidian 仪表盘插件。基于单个自定义 `ItemView`（不依赖 Dataview），六个 widget 在网格中独立渲染，并通过原生 IndexedDB 共享状态。AI 功能既可以走自带的本地 Cloakfetch 服务，也可以从浏览器直连 Anthropic / OpenAI / Gemini 兼容端点。

[🇬🇧 English → README.md](./README.md)

---

## 功能特性

- **原生 `ItemView` 仪表盘** — 单视图，无 Dataview 依赖，启动后自动打开。
- **🍅 番茄钟** — 环形进度环、自定义时长、会话历史、每日平均专注时长（自动排除今日）。
- **✅ 任务看板** — 添加、完成、清理待办，支持优先级，数据落 IndexedDB。
- **🌱 探究性学习** — 任意词条查询，AI 自动补全翻译、词性、结构化 Markdown（适合英文词汇、数学公式、理科笔记）。
- **🧠 主动回忆** — AI 根据文章生成单选 / 填空 / 是非题，按知识点记录掌握度到 `plans/知识点.md`。
- **🎓 今日复习** — 汇总当日写入、归档、标记复习的内容，做跨 widget 的"今日"流。
- **📰 新闻聚合** — 同时扫描 news 目录下的 markdown 与 vault 中任意带 `#news` 标签的文件，按 mtime 倒序展示。
- **🌸 小红花** — 完成奖励 widget，归档所有学习记录。
- **多 AI 服务商** — Anthropic（Claude）、OpenAI（GPT）、Google Gemini、DeepSeek、Moonshot（Kimi）、智谱 GLM、阿里百炼（Qwen）、火山方舟（豆包）、MiniMax — 设置面板一键切换。
- **本地 Cloakfetch 服务** — 负责 `/fetch` 网页抓取与 AI 兜底代理；token 自动从 `~/.config/obsidian-worktable/server.json` 读取。
- **样式流水线简洁** — `src/styles/*.css` 由 `scripts/build-styles.mjs` 拼接，无 PostCSS，方便主题化。

## 安装

### 方式一：BRAT 安装（推荐 — 无需先通过 Community Plugins 审核）

1. 在 Obsidian 社区插件中安装 **BRAT**。
2. 打开 `Settings → BRAT → Add a beta plugin`。
3. 填入仓库地址：`https://github.com/DaoYoung/obsidian-worktable.git`
4. 在 Community Plugins 中启用 **Worktable**。

> BRAT 从 **GitHub 最新已发布 Release 的附件**读取 `manifest.json`、`main.js`、`styles.css`，不是从仓库根目录安装。Release 不能保持为 Draft，并且必须直接附带这些文件。
>
> 仓库如果保持 Private，需要先在 BRAT 的 SecretStorage 中配置有权访问该仓库的 GitHub Token，并在添加插件时选择对应 secret；希望直接通过仓库地址安装则需要将仓库设为 Public。

### 方式二：手动下载发布版本

1. 从 [Releases 页面](https://github.com/DaoYoung/obsidian-worktable/releases) 下载最新版本的 `obsidian-worktable.zip`。
2. 解压到 vault 插件目录：
   ```
   vault/.obsidian/plugins/obsidian-worktable/
   ```
3. 在 Community Plugins 中启用 **Worktable**。

### 方式三：源码构建安装

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git
cd obsidian-worktable
npm install
npm run build
```

把仓库根目录的 `main.js`、`manifest.json`、`styles.css` 三个文件复制到 vault 的插件目录即可。开发时使用 `npm run dev` 监视文件变化。

> 通过审核正式进入 Obsidian Community Plugins 之后，本插件可以直接在 `Settings → Community plugins → Browse` 搜索一键安装。在那之前，BRAT 是受支持的安装渠道。

## 本地服务（Cloakfetch）

文章抓取（`/fetch`）与未配置 Direct AI 时的 AI 代理，都走 `server/server.py` 提供的小型 Python 服务。token 自动发现机制意味着你通常不需要把任何东西贴进插件设置——安装脚本会把 token 写到 `~/.config/obsidian-worktable/server.json`，插件在首次请求时自动读取。

### macOS — 一键安装

打开 `Settings → Community plugins → Worktable → Options`，底部"本地服务一键安装"卡片里有两条可点开的命令，复制到终端执行：

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git ~/obsidian-worktable
bash ~/obsidian-worktable/server/install-macos.sh
```

脚本会：
- 把 Python 服务注册为 macOS `launchd` 用户级 agent（开机自起，崩溃自重启）。
- 生成随机 `serviceToken`，写入 `~/.config/obsidian-worktable/server.json`。
- 立即启动服务。

安装完成后，回到同一张设置卡片点 **Test connection** 验证；显示绿色"✓ 本地服务可达"就搞定了。

### Linux / Windows

`launchd` 是 macOS 专属。Linux 和 Windows 上需要手动启动：

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git ~/obsidian-worktable
cd ~/obsidian-worktable/server
pip3 install -r requirements.txt   # 仅首次需要
python3 server.py
```

可以让终端常开，或在 tmux / systemd-user / NSSM 下托管。`serviceToken` 鉴权机制完全一致——在 `~/.config/obsidian-worktable/server.json` 中填一个值（或者设置 `WORKTABLE_SERVICE_TOKEN`），插件就会自动读取。

### 服务配置

`~/.config/obsidian-worktable/server.json`：

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

- **`host`** — 监听地址。**不要改成 `0.0.0.0`**，插件只走 loopback。
- **`port`** — 默认 `8765`，端口冲突时再改。
- **`serviceToken`** — 每次请求都要携带 `X-Worktable-Token` 头。**留空表示不鉴权**（适合单机、无信任威胁的本地场景）。
- **`aiAuthToken`** — Anthropic 兼容密钥（也接受别名 `anthropicApiKey`）。环境变量 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` / `~/.claude/settings.json` 优先级更高。
- **`aiBaseUrl`** / **`aiModel`** — 默认值已对齐官方 endpoint，可指向任何兼容网关。

任何字段都可以用 `WORKTABLE_<FIELD_NAME>` 环境变量覆盖（驼峰转 `UPPER_SNAKE`），优先级 **高于** 配置文件：

```bash
export WORKTABLE_SERVICE_TOKEN="your-token"
export WORKTABLE_AI_BASE_URL="https://your-proxy.example.com"
export WORKTABLE_PORT=9001
```

### Token 自动发现

插件按以下顺序读取服务 token：

1. 插件设置里"Service token (advanced override)"输入框——**除非绕过配置文件，否则保持留空**。
2. `~/.config/obsidian-worktable/server.json` 的 `serviceToken`。
3. `/etc/obsidian-worktable/server.json` 的 `serviceToken`。
4. 都为空 → 服务端 `_check_auth` 放行请求。

运行过 `install-macos.sh` 后，第 2 步会自动设置好，不需要再动插件设置。

## 插件设置

`Settings → Community plugins → Obsidian Worktable → Options`：

| 设置项 | 默认值 | 说明 |
|---|---|---|
| Knowledge file | `plans/知识点.md` | 学习模块读写、复习模块读取的知识库路径 |
| News folder | `news` | 新闻 widget 扫描的目录；带 `#news` 标签的文件也会被收录 |
| Service base URL | `http://127.0.0.1:8765` | 本地 Cloakfetch 服务地址 |
| Service token (advanced override) | `""` | **默认留空**——自动从 `~/.config/obsidian-worktable/server.json` 读取 |
| Open on startup | ✅ | Obsidian 启动时自动打开 Worktable 视图 |
| Enable fallback proxies | ✅ | 文章抓取失败时回退到公共 CORS 代理 |
| Provider | `anthropic` | Direct AI 模式下的服务商 |
| API key | `""` | 服务商 API key |
| Base URL | `https://api.anthropic.com` | 切换服务商时自动填入；可改为代理 / 私有部署 |
| Model | `claude-sonnet-4-5` | 切换服务商时自动填入；可手动覆盖 |

设置数据保存在 `.obsidian/plugins/obsidian-worktable/data.json`，由 Obsidian 管理。

### Direct AI vs 本地服务

当 **API key + Base URL + Model** 三项均填写时，插件直接由浏览器调用所选服务商（适用于原生支持 CORS 的端点：Anthropic、OpenAI、Google Gemini）。`/fetch` 仍走本地 Cloakfetch 服务。

这三项任一留空时，AI 调用回落到本地服务的 `/ai/*` 端点（由服务端按 `server.json` 中的配置完成请求）。

## 支持的 AI 服务商

| 服务商 | 默认 Base URL | 默认 Model |
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

任何 OpenAI Chat Completions 兼容端点都可以通过选 `openai` 后改 `Base URL` 来用。切换服务商时，`Base URL` 和 `Model` 会自动填默认值；之后你可以手动覆盖。

## 故障排除

### 插件无法启用

1. 确认 Obsidian 版本 ≥ 1.5.0（`Settings → About`）。
2. 检查 `main.js`、`manifest.json`、`styles.css` 三个文件是否齐全。
3. 打开 `Ctrl/Cmd + P → "Show debug console"`，重载插件，查看有没有提到 `worktable` 的红色错误。

### "Local service is not reachable: ECONNREFUSED"

按上文 macOS / Linux / Windows 流程启动服务，回到插件设置卡片点 **Test connection**。服务起来了但插件连不上，多半是设置里的 `Service base URL` 写错了。

### News widget 显示为空

widget 同时扫描配置的 news 目录与带 `#news` 标签的文件——任选其一：在 vault 创建 `news/` 并放入 md，或给现有 md 的 frontmatter / 正文加上 `#news` 标签。

### 数据与重置

所有 widget 数据存在 IndexedDB（数据库 `home-db`）及 `src/widgets/*.ts` 文档过的 localStorage key 里。打开 Obsidian 调试控制台 → "Inspect" 可以清空，或卸载再重装插件（Obsidian 在删除存储前会确认）。

## 开发

```bash
npm install
npm run dev          # 监视模式 (CSS + esbuild)
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run test:server  # python3 -m unittest in server/tests
npm run verify       # typecheck + tests + build + artifact checks
```

源码结构：

- `src/main.ts` — 插件入口，注册视图
- `src/view/WorktableView.ts` — 单 `ItemView`、网格布局、widget descriptor 注册表
- `src/widgets/<name>Widget.ts` 与 `src/widgets/<name>.ts` — 每个 widget 一对（逻辑 + lazy-load wrapper）
- `src/services/CloakfetchClient.ts` — 唯一的 AI 传输层；负责路由 Direct AI vs 本地服务
- `src/services/ai/{registry,anthropic,openaiCompat,gemini,client}.ts` — provider specs
- `src/styles/{base,productivity,learning}.css` — 由 `scripts/build-styles.mjs` 拼到根 `styles.css`
- `server/` — Python Cloakfetch 服务（FastAPI / uvicorn）
- `tests/` — Vitest 单测 + `server/tests/` Python 侧

## 隐私与安全

- 所有 widget 数据存在本地 vault（IndexedDB + 文件 `plans/知识点.md`）。
- 插件不收集任何遥测 / 上报。
- Token 与 API key 仅存放于 `.obsidian/plugins/obsidian-worktable/data.json`（由 Obsidian 管理）与 `~/.config/obsidian-worktable/server.json`，并仅在 loopback 上发送给本地服务。
- `server.json` 已在 `.gitignore` 中排除——任何密钥都不会进仓库。

## 许可证

MIT
