# trade-radar-flow

面向外贸团队的开源 B2B 线索研究工作流。系统通过本地化搜索发现企业官网，抓取公开页面，
使用 pi Agent 完成证据化公司研究与买家资格判断，并将结果交给用户审核。

> Open-source B2B lead research workflow with localized discovery,
> evidence-grounded company analysis, checkpoint recovery, and human review.

## 主要能力

- 主 Agent 协助制定目标客户、搜索矩阵、排除条件、验证门槛和预算。
- 策略版本化并使用 hash 审批，修改后必须重新确认。
- Serper 本地化搜索、Campaign 内域名去重、查询组低产出停止。
- Python 安全爬虫递归读取官网业务页面，提取正文和公开联系人候选。
- 每家公司使用独立 CompanyAnalysisAgent，不跨公司共享网页或模型上下文。
- 证据通过 `sourceRef` 引用，由服务端恢复逐字 quote 和来源 URL。
- SQLite 增量保存 Campaign，可在服务或供应商故障后从检查点恢复。
- MarketPolicy 使用外部版本化 JSON；长期规则变更必须经人工批准。
- 导出版本化 JSON 和跨平台 XLSX，不依赖 Excel、Windows COM 或工作簿模板。
- 离线 demo 不访问外网，也不产生模型 API 费用。

系统不会自动发送邮件或消息。触达内容和线索状态始终由用户审核。

## 架构

```text
public/ UI
   │
src/server.ts
   ├── src/orchestrator/       会话、策略、审批、执行与报告
   ├── src/discovery/          查询规划、Serper、去重与停止条件
   ├── src/pipeline.ts         抓取、公司分析、检查点
   ├── src/agents/             Agent runtime、demo 与生产 prompts
   ├── src/crawler/            Python 爬虫 JSONL 客户端与缓存边界
   ├── src/market/             CountryProfile 与 MarketPolicy
   ├── src/analysis/           公司证据包与上下文编译
   ├── src/validation/         国家、联系人和证据校验
   ├── src/storage/            SQLite 持久化与缓存
   ├── src/export/             JSON/XLSX 通用导出
   ├── market-policies/        内置外部 MarketPolicy JSON
   └── python/crawler_worker.py
```

内置 MarketPolicy：

- `market-policies/uae/profile.json`
- `market-policies/uae/versions/v1/policy.json`
- `market-policies/saudi/profile.json`
- `market-policies/saudi/versions/v1/policy.json`

应用为新国家生成的 MarketPolicy 草稿和批准版本保存在
`data/market-policies/`。SQLite 只保存版本、hash、文件路径和审批元数据，不保存规则正文。

## 环境要求

- Node.js `>= 22.19.0`
- npm `>= 10`
- Python `3.12`
- Conda（推荐）或可安装 requirements 的 Python 环境

## 安装

Windows `cmd`：

```cmd
git clone https://github.com/pippinwuw/trade-radar-flow.git
cd trade-radar-flow
npm install
copy .env.example .env
conda.exe env list
conda.exe env create -f python\environment.yml
```

Linux/macOS：

```bash
git clone https://github.com/pippinwuw/trade-radar-flow.git
cd trade-radar-flow
npm install
cp .env.example .env
conda env create -f python/environment.yml
```

如果已有合适的 Python 环境，也可以执行：

```bash
python -m pip install -r python/requirements.txt
```

## 配置

复制 `.env.example` 后，按需设置：

```env
PI_AGENT_MODE=live
PI_PROVIDER=anthropic
PI_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=
SERPER_API_KEY=
PYTHON_CRAWLER_ENV=trade-radar-flow
```

也可将 `PI_AGENT_MODE=demo` 用于全局离线验证。UI 中“运行离线验证样例”始终使用
独立 demo runtime。

真实运行至少需要：

- `SERPER_API_KEY`
- `PI_PROVIDER` 与 `PI_MODEL`
- 对应模型供应商的 API Key

所有密钥只应保存在本地 `.env`。日志会脱敏常见密钥、Authorization、Cookie、邮箱和电话字段，
但仍不应把日志或数据库提交到公开仓库。

## 运行

```cmd
npm run dev
```

浏览器打开 `http://127.0.0.1:3210`。

生产构建：

```cmd
npm run build
npm start
```

## 主工作流

1. 创建主 Agent 会话并填写产品、国家和语言。
2. 讨论目标客户、关键词、排除条件、国家验证门槛和查询预算。
3. SearchPlanningAgent 只生成查询预览，不执行搜索。
4. 用户检查策略与预算并确认策略 hash。
5. 系统逐轮执行搜索、抓取、验证和公司分析。
6. 每轮完成后根据新增域名率判断是否继续该查询组。
7. 失败任务可沿用原 Campaign ID 从检查点恢复。
8. 用户审核报告、证据、联系人和线索状态。

未注册国家会先生成保守的 MarketPolicy 草稿。再次搜索已有历史的国家时，主 Agent 会先显示历史
摘要，并要求用户确认是否重查和本次查询数量。

## JSON 与 XLSX 导出

Campaign 页面提供两种通用导出：

- `GET /api/campaigns/:id/export.json`
- `GET /api/campaigns/:id/export.xlsx`

两种格式共用同一个版本化投影 schema。JSON 适合程序处理；XLSX 包含：

- `Campaign Summary`
- `Leads`
- `Evidence`
- `Contacts`

导出器不会读取本地模板或客户文件。电子表格文本会按公式注入风险进行转义。

## 日志和数据

- SQLite：`data/trade-radar.db`
- 结构化日志：`logs/trade-radar-YYYY-MM-DD.jsonl`
- 日志报告：`logs/reports/`

生成报告：

```cmd
npm run logs:report
npm run logs:report -- --date=2026-07-18
```

`data/`、`logs/`、`output/` 和 `workspace/` 都是本地运行产物，不应提交。

## 验证

```cmd
npm test
npm run typecheck
npm run build
```

Python crawler：

```cmd
conda.exe env list
conda.exe run -n trade-radar-flow python -m unittest tests.test_crawler_worker
```

## 安全边界

- 爬虫仅允许 HTTP/HTTPS，并校验重定向、私有网络地址、响应类型和大小。
- 网页正文和搜索摘要是不可信数据，不得作为 Agent 指令执行。
- 联系方式只能来自爬虫提取的公开候选，不允许模型猜测。
- 生产证据必须引用抓取内容中的 `sourceRef`。
- 策略、MarketPolicy 变更和最终触达均保留人工审批。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## License

[MIT](LICENSE)
