# Obsidian Worktable

一款用于专注、任务、学习、回顾和资讯的原生 Obsidian 仪表盘插件。

## 功能特性

- **原生自定义视图** — 无需 Dataview 插件，完整的数据展示能力
- **多视图支持** — 仪表盘、专注模式、任务看板、学习追踪
- **本地数据兼容** — 纯原生实现，数据完全存储在 vault 中
- **热更新样式** — 样式与逻辑分离，支持自定义主题
- **服务状态监控** — 实时查看服务连接状态
- **AI 配置优先** — 支持从 `~/.claude/settings.json` 读取 AI 配置

## 系统要求

- Obsidian v1.4.5 或更高版本
- macOS / Windows / Linux
- Node.js 20+ (仅开发/构建需要)

## 安装

### 方式一：BRAT 插件安装（推荐）

1. 安装 BRAT 插件
   - 打开 Obsidian 设置 → 社区插件
   - 搜索 "BRAT"
   - 启用插件

2. 添加 Worktable 插件
   - 设置 → BRAT → Add a beta plugin
   - 输入仓库地址：`DaoYoung/obsidian-worktable`

### 方式二：手动安装发布版本

1. 从 GitHub Release 页面下载最新版本的 `obsidian-worktable.zip`
2. 解压后将 `main.js`、`manifest.json`、`styles.css` 放入 vault 目录：
   ```
   vault/.obsidian/plugins/obsidian-worktable/
   ```
3. 在 Obsidian 设置中启用社区插件

### 方式三：源码构建安装

```bash
git clone https://github.com/DaoYoung/obsidian-worktable.git
cd obsidian-worktable
npm install
npm run build
```

构建产物将生成在项目根目录：
- `main.js` — 插件入口
- `manifest.json` — 插件清单
- `styles.css` — 样式文件

将这三个文件复制到 vault 插件目录，启用插件即可。

### 本地开发部署

```bash
# 安装依赖
npm install

# 开发模式（监视文件变化）
npm run dev

# 构建生产版本
npm run build

# 验证构建产物
npm run check:artifacts

# 完整验证流程
npm run verify
```

## 配置说明

### 默认配置

插件开箱即用，无需额外配置即可正常运行。

### AI 配置

插件支持从 `~/.claude/settings.json` 读取 AI 配置以实现高级功能：

```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "your-api-key",
    "model": "claude-sonnet-4-20250514"
  }
}
```

此配置仅用于 AI 功能增强，不会影响 Obsidian 本身的功能。

**配置优先级**：插件内部配置 > `~/.claude/settings.json` > 默认配置

### 服务 Token 安全

使用 AI 功能时，API Token 遵循以下安全原则：

- Token 仅在本地使用，不会发送至第三方服务器
- Token 存储在本地配置中，不上传至 GitHub
- 建议使用环境变量或安全的密钥管理工具管理 Token

## 端点说明

| 端点 | 说明 |
|------|------|
| `/` | 仪表盘主视图 |
| `/focus` | 专注模式视图 |
| `/tasks` | 任务看板视图 |
| `/learning` | 学习追踪视图 |

## 故障排除

### 插件无法启用

1. 确认 Obsidian 版本 >= 1.4.5
2. 检查插件文件是否完整（`main.js`、`manifest.json`、`styles.css`）
3. 查看 Obsidian 控制台错误信息

### 构建失败

确保 Node.js 版本为 20 或更高：

```bash
node --version  # 应显示 v20.x.x
```

### 样式异常

运行完整构建流程：

```bash
npm run build && npm run check:artifacts
```

## 常见问题

**Q: 是否需要安装 Dataview 插件？**

A: 不需要。Obsidian Worktable 是原生实现，不依赖 Dataview。

**Q: 数据存储在哪里？**

A: 所有数据存储在 Obsidian vault 的标准位置，不使用外部数据库。

**Q: 是否支持 Linux 和 Windows？**

A: 支持。插件在 macOS、Windows、Linux 上均可运行。Linux 和 Windows 用户可通过手动启动本地服务器的方式使用部分高级功能。

## 开发

### 项目结构

```
obsidian-worktable/
├── src/
│   ├── main.ts           # 插件主入口
│   └── styles/
│       ├── base.css      # 基础样式
│       ├── productivity.css  # 生产力视图样式
│       └── learning.css     # 学习视图样式
├── scripts/
│   ├── build-styles.mjs  # 样式构建脚本
│   └── check-artifacts.mjs # 构建产物检查
├── .github/
│   └── workflows/
│       ├── ci.yml        # 持续集成
│       └── release.yml   # 发布流程
├── main.js               # 构建产物
├── manifest.json         # 插件清单
└── styles.css           # 构建产物（合并后样式）
```

### 构建流程

1. `build-styles.mjs` 将 `src/styles/*.css` 合并为根目录 `styles.css`
2. `esbuild.config.mjs` 打包 TypeScript 源码为 `main.js`
3. `check-artifacts.mjs` 验证所有构建产物

### 运行测试

```bash
# TypeScript 类型检查
npm run typecheck

# Vitest 单元测试
npm test

# Python 服务测试
npm run test:server

# 完整验证
npm run verify
```

## 发布

### 版本规范

遵循语义化版本：`major.minor.patch`

### 发布流程

1. 更新 `package.json` 和 `manifest.json` 中的版本号
2. 更新 `versions.json` 添加版本映射
3. 创建 Git tag：
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. GitHub Actions 自动构建并创建 Draft Release
5. 审核后发布 Release

## 隐私与安全

- 插件所有数据存储在本地 vault
- 不收集任何用户数据
- 不包含任何遥测或追踪功能
- API Token 仅用于本地 AI 功能，不会上传至任何服务器

## 局限性

- 部分高级功能需要有效的 AI API Token
- 某些视图可能需要特定的 Obsidian 社区插件配合（可选，非必需）
- 本地服务器功能在 Linux/Windows 上需要手动启动

## 许可证

MIT
