# Contributing

感谢你改进 trade-radar-flow。

## 开发准备

1. 使用 Node.js 22.19 或更高版本。
2. 复制 `.env.example` 为 `.env`，不要提交真实密钥。
3. 先运行 `conda.exe env list`；没有合适环境时，再使用
   `python/environment.yml` 创建 `trade-radar-flow` 环境。
4. 执行 `npm install`。

## 修改原则

- 保持搜索、抓取、公司分析、验证和人工审核之间的职责边界。
- 不得削弱策略审批、预算、SSRF 防护、证据引用、联系人防猜测或人工发送边界。
- 生产提示词集中放在 `src/agents/production-prompts.ts`。
- 新国家规则放在 `market-policies/<marketId>/`（profile + 版本化 policy JSON），
  不要硬编码到通用流水线。
- 不要提交真实客户名称、Campaign ID、联系人、导出文件、数据库、日志或客户模板。
- 测试必须能在没有真实 API Key 和付费模型调用的情况下运行。

## 提交前验证

```cmd
npm test
npm run typecheck
npm run build
```

修改 Python crawler 时还需运行：

```cmd
conda.exe run -n trade-radar-flow python -m unittest tests.test_crawler_worker
```

## Pull Request

- 说明问题、设计选择和用户可见变化。
- 附上执行过的测试。
- 将重构、行为变化和客户适配拆成独立变更。
- 不要把生成的 `dist/`、`data/`、`logs/`、`output/` 或 `workspace/` 内容加入 PR。
