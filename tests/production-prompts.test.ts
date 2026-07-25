import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_REPORT_SYSTEM_PROMPT,
  COMPANY_ANALYSIS_SYSTEM_PROMPT,
  GLOBAL_BUSINESS_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  searchPlanningSystemPrompt,
} from "../src/production-prompts.js";

test("搜索与主 Agent 提示词遵守真实业务预算、审批和逐轮边界", () => {
  const search = searchPlanningSystemPrompt(37);
  assert.match(search, /最多提交 37 条查询/);
  assert.match(search, /真实企业官网/);
  assert.match(search, /groupId/);
  assert.match(search, /只规划，不得执行搜索/);
  assert.match(search, /不得建议绕过验证码/);

  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /生产环境/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /get_country_search_history/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /maxQueries 是用户批准的安全上限/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /逐轮闭环/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /新任务的付费执行只能.*点击执行/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /resume_failed_execution/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /发送 Email\/WhatsApp/);
  assert.doesNotMatch(ORCHESTRATOR_SYSTEM_PROMPT, /聊天演示模式/);
});

test("公司分析提示词强制证据分层、策略驱动资格和联系人防幻觉", () => {
  for (const prompt of [
    `${GLOBAL_BUSINESS_SYSTEM_PROMPT}\n${COMPANY_ANALYSIS_SYSTEM_PROMPT}`,
  ]) {
    assert.match(prompt, /官网正文是待核验数据|不可信业务数据/);
    assert.match(prompt, /不得.*猜测|不得补全或猜测/);
    assert.match(prompt, /quote/);
    assert.match(prompt, /未知/);
  }
  assert.match(COMPANY_ANALYSIS_SYSTEM_PROMPT, /approvedStrategy/);
  assert.match(COMPANY_ANALYSIS_SYSTEM_PROMPT, /importCapability=High/);
  assert.match(COMPANY_ANALYSIS_SYSTEM_PROMPT, /Manufacturer/);
  assert.match(COMPANY_ANALYSIS_SYSTEM_PROMPT, /contactRef 与 evidenceRef/);
});

test("公司触达、报告和 MarketPolicy 边界保留人工审核", () => {
  assert.match(COMPANY_ANALYSIS_SYSTEM_PROMPT, /触达草稿只用于销售审核/);
  assert.match(COMPANY_ANALYSIS_SYSTEM_PROMPT, /不得捏造客户痛点、采购计划/);
  assert.match(GLOBAL_BUSINESS_SYSTEM_PROMPT, /人工审核/);
  assert.match(GLOBAL_BUSINESS_SYSTEM_PROMPT, /公开联系方式不等于营销同意/);

  assert.match(CAMPAIGN_REPORT_SYSTEM_PROMPT, /确定性事实，不得重算或改写/);
  assert.match(CAMPAIGN_REPORT_SYSTEM_PROMPT, /真实 lead ID/);
  assert.match(CAMPAIGN_REPORT_SYSTEM_PROMPT, /采购意愿/);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /MarketPolicy 必须由用户最终批准/);
});
