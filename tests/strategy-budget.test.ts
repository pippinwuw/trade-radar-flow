import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultStrategy,
  estimateStrategyBudget,
} from "../src/orchestrator/strategy-template.js";

test("预算估算包含免费 Serper 排除查询的最坏翻页请求数", async () => {
  const strategy = await createDefaultStrategy({
    product: "PVC tarpaulin",
    country: "United Arab Emirates",
    language: "English",
  });
  strategy.budget.maxQueries = 3;
  strategy.budget.resultsPerQuery = 100;

  const estimate = estimateStrategyBudget(strategy);

  assert.equal(estimate.serperRequests, 30);
  assert.equal(estimate.maximumSearchHits, 300);
});
