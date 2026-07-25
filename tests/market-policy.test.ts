import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  approveMarketPolicy,
  getApprovedMarketPolicy,
  listMarketPolicies,
  markMarketPolicyReviewed,
  saveMarketPolicyDraft,
} from "../src/market-policy.js";
import {
  listCountryProfiles,
  requireCountry,
  resolveCountry,
} from "../src/countries/registry.js";
import { DemoAgentRuntime } from "../src/demo-agent-runtime.js";
import { buildCampaignAgentContext } from "../src/discovery/query-planner.js";
import { createDefaultStrategy } from "../src/orchestrator/strategy-template.js";
import { getDatabase } from "../src/storage/database.js";

test("国家注册表规范化 UAE 与 Saudi 常用别名", () => {
  assert.equal(resolveCountry("阿联酋")?.id, "uae");
  assert.equal(resolveCountry("KSA")?.id, "saudi");
  assert.equal(requireCountry("United Arab Emirates").gl, "ae");
  assert.equal(requireCountry("Saudi Arabia").googleDomain, "google.com.sa");
  assert.ok(listCountryProfiles().length >= 2);
});

test("内置 MarketPolicy 从外部 JSON 加载且 SQL 只保存元数据", () => {
  const policies = listMarketPolicies();
  const uae = getApprovedMarketPolicy("uae");
  const saudi = getApprovedMarketPolicy("saudi");
  const record = getDatabase().getMarketPolicyRecord("uae", uae.version);

  assert.ok(policies.length >= 2);
  assert.equal(uae.status, "approved");
  assert.equal(saudi.status, "approved");
  assert.ok(uae.searchLocalization.queryPatterns.length > 0);
  assert.ok(saudi.companyAnalysis.identitySignals.length > 0);
  assert.ok(record);
  assert.match(record.filePath, /market-policies\/uae\/versions\/v1\/policy\.json$/);
  const filePath = path.resolve(process.cwd(), record.filePath);
  assert.ok(existsSync(filePath));
  assert.equal(
    JSON.parse(readFileSync(filePath, "utf8")).marketId,
    "uae",
  );
  assert.equal("searchLocalization" in record, false);
});

test("MarketPolicy 必须经过 draft、reviewed 才能 approved", () => {
  const source = getApprovedMarketPolicy("uae");
  const draft = saveMarketPolicyDraft({
    schemaVersion: 1,
    marketId: "test-market-policy",
    searchLocalization: source.searchLocalization,
    companyAnalysis: source.companyAnalysis,
    contactAndOutreach: source.contactAndOutreach,
  });
  assert.equal(draft.status, "draft");
  assert.throws(
    () => approveMarketPolicy(draft.marketId, draft.version),
    /必须先由主 Agent 审阅/,
  );

  const reviewed = markMarketPolicyReviewed(
    draft.marketId,
    draft.version,
    ["结构化字段与安全边界已审阅"],
  );
  const approved = approveMarketPolicy(
    reviewed.marketId,
    reviewed.version,
  );
  assert.equal(reviewed.status, "reviewed");
  assert.equal(approved.status, "approved");
  assert.ok(approved.metadata.approvedAt);
  assert.match(
    (
      getDatabase().getMarketPolicyRecord(
        approved.marketId,
        approved.version,
      )?.filePath ?? ""
    ).replaceAll("\\", "/"),
    /approved\/test-market-policy\/versions\//,
  );
});

test("搜索规划默认生成三条本地化查询并记录 MarketPolicy 版本", async () => {
  const country = requireCountry("UAE");
  const marketPolicy = getApprovedMarketPolicy("uae");
  const result = await new DemoAgentRuntime().planSearch(
    {
      product: "PVC tarpaulin",
      country: country.displayName,
      language: "English",
    },
    country,
    marketPolicy,
  );

  assert.equal(result.value.countryId, "uae");
  assert.equal(
    result.value.marketPolicyRef?.version,
    marketPolicy.version,
  );
  assert.ok(result.value.queries.length <= 3);
  assert.ok(result.value.queries.every((query) => query.query.includes("PVC")));
});

test("搜索规划可按已确认预算生成超过三条查询且无固定硬上限", async () => {
  const input = {
    product: "PVC tarpaulin",
    country: "Saudi Arabia",
    language: "English",
  };
  const strategy = await createDefaultStrategy(input);
  strategy.budget.maxQueries = 12;
  strategy.search.cities = requireCountry("Saudi Arabia").cities;
  const context = await buildCampaignAgentContext(input, strategy);
  const result = await new DemoAgentRuntime().planSearch(
    context.input,
    context.country,
    context.marketPolicy,
    context,
  );

  assert.equal(result.value.queries.length, 12);
});
