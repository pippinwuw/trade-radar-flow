import assert from "node:assert/strict";
import test from "node:test";
import { shouldLogHttpRequest } from "../src/logging/http-request-log.js";

test("状态轮询和健康检查默认不记 HTTP 访问日志", () => {
  assert.equal(
    shouldLogHttpRequest("GET", "/api/health", {}),
    false,
  );
  assert.equal(
    shouldLogHttpRequest(
      "GET",
      "/api/orchestrator/sessions/session-1/activity",
      {},
    ),
    false,
  );
  assert.equal(
    shouldLogHttpRequest(
      "GET",
      "/api/orchestrator/sessions/session-1",
      { "x-trade-radar-poll": "1" },
    ),
    false,
  );
  assert.equal(
    shouldLogHttpRequest(
      "GET",
      "/api/campaigns/campaign-1",
      { "X-Trade-Radar-Poll": "1" },
    ),
    false,
  );
});

test("非轮询 API 以及轮询失败仍记 HTTP 访问日志", () => {
  assert.equal(
    shouldLogHttpRequest("GET", "/api/orchestrator/sessions/session-1", {}),
    true,
  );
  assert.equal(
    shouldLogHttpRequest("POST", "/api/orchestrator/sessions", {}),
    true,
  );
  assert.equal(shouldLogHttpRequest("GET", "/index.html", {}), false);
  assert.equal(
    shouldLogHttpRequest(
      "GET",
      "/api/orchestrator/sessions/session-1",
      { "x-trade-radar-poll": "1" },
      500,
    ),
    true,
  );
});
