# Security Policy

## Supported version

安全修复优先应用于 `main` 和最新发布版本。

## Reporting a vulnerability

请不要通过公开 Issue 报告可能泄露密钥、联系人、客户数据或可被利用的漏洞。

优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私下提交报告。报告请包含：

- 受影响的版本或 commit；
- 复现步骤与最小示例；
- 预期影响；
- 已知的缓解方式。

维护者会尽快确认报告，并在修复可用后协调披露。

## Security boundaries

- 服务默认只监听 `127.0.0.1`，不提供远程认证。不要直接暴露到公网。
- `.env`、SQLite 数据库、日志和导出文件都可能包含敏感信息，不应提交。
- 爬虫必须保留私有网络、重定向、响应类型和响应大小检查。
- 网页、搜索摘要和模型输出均视为不可信数据。
- Agent 不得生成未从公开来源提取的联系人。
- 策略、Market Skill 变更和触达发送必须由人类审批。
