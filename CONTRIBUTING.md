# 贡献指南

感谢您对 Obsidian Worktable 的关注与贡献。

## 开发环境

```bash
# 克隆仓库
git clone https://github.com/DaoYoung/obsidian-worktable.git
cd obsidian-worktable

# 安装依赖
npm install

# 创建开发分支
git checkout -b feature/your-feature-name
```

## 开发流程

1. **代码风格** — 遵循项目现有风格，使用有意义的变量命名
2. **类型安全** — TypeScript strict 模式，保持类型完整
3. **测试覆盖** — 新功能应包含相应的测试用例
4. **提交规范** — 使用清晰的提交信息，描述改动内容

## 构建验证

```bash
# 类型检查
npm run typecheck

# 运行测试
npm test

# 构建
npm run build

# 完整验证
npm run verify
```

## Pull Request 流程

1. Fork 仓库并创建功能分支
2. 确保所有测试通过
3. 提交 PR 并描述改动内容
4. 等待代码审核

## 样式指南

- 所有 CSS 类名以 `.obsidian-worktable-` 为前缀
- 样式文件位于 `src/styles/` 目录
- 使用 CSS 变量引用 Obsidian 主题变量

## 注意事项

- 不要在代码中硬编码 Token 或密钥
- 不要引入未审核的依赖
- 保持构建产物干净，不包含调试代码
