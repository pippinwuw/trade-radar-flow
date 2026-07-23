import assert from "node:assert/strict";
import test from "node:test";
import {
  getMarketSkillRegistry,
  MarketSkillRegistry,
} from "../src/agent-skills/registry.js";
import {
  listCountryProfiles,
  requireCountry,
  resolveCountry,
} from "../src/countries/registry.js";
import { DemoAgentRuntime } from "../src/demo-agent-runtime.js";
import { buildCampaignAgentContext } from "../src/discovery/query-planner.js";
import { createDefaultStrategy } from "../src/orchestrator/strategy-template.js";

test("国家注册表规范化 UAE 与 Saudi 常用别名", () => {
  assert.equal(resolveCountry("阿联酋")?.id, "uae");
  assert.equal(resolveCountry("KSA")?.id, "saudi");
  assert.equal(requireCountry("United Arab Emirates").gl, "ae");
  assert.equal(requireCountry("Saudi Arabia").googleDomain, "google.com.sa");
  assert.ok(listCountryProfiles().length >= 2);
});

test("pi 运行时 SkillRegistry 加载并显式调用国家 Skill", async () => {
  const registry = new MarketSkillRegistry();
  await registry.reload();
  const skills = registry.list();

  assert.ok(skills.some((skill) => skill.name === "uae"));
  assert.ok(skills.some((skill) => skill.name === "saudi"));
  assert.match(registry.invocation("uae"), /UAE B2B market research/);
  assert.ok(registry.getSummary("saudi").keyInformation.queryPatterns.length > 0);
});

test("并发首次读取共享同一个已完成加载的 SkillRegistry", async () => {
  const registries = await Promise.all(
    Array.from({ length: 10 }, () => getMarketSkillRegistry()),
  );

  assert.ok(registries.every((registry) => registry === registries[0]));
  assert.ok(registries.every((registry) => registry.list().length >= 2));
});

test("搜索规划默认生成三条本地化查询并记录 Skill 版本", async () => {
  const registry = new MarketSkillRegistry();
  await registry.reload();
  const country = requireCountry("UAE");
  const skill = registry.getSummary("uae");
  const result = await new DemoAgentRuntime().planSearch(
    {
      product: "PVC tarpaulin",
      country: country.displayName,
      language: "English",
    },
    country,
    skill,
    registry.invocation("uae"),
  );

  assert.equal(result.value.countryId, "uae");
  assert.equal(result.value.skillVersion, skill.version);
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
    context.skill,
    context.skillInvocation,
    context,
  );

  assert.equal(result.value.queries.length, 12);
});
