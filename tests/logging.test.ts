import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeLogValue,
  type LogRecord,
} from "../src/logging/logger.js";
import { summarizeRecords } from "../scripts/log-report.js";

test("日志脱敏 API Key、Token、邮箱和电话", () => {
  const sanitized = sanitizeLogValue({
    SERPER_API_KEY: "secret-value",
    authorization: "Bearer secret",
    nested: {
      note: "Contact sales@example.com or +971 50 123 4567",
      tokenText: "sk-1234567890abcdefgh",
    },
  }) as Record<string, unknown>;

  assert.equal(sanitized.SERPER_API_KEY, "[REDACTED]");
  assert.equal(sanitized.authorization, "[REDACTED]");
  const nested = sanitized.nested as Record<string, string>;
  assert.doesNotMatch(nested.note ?? "", /sales@example\.com/);
  assert.match(nested.note ?? "", /\*\*\*4567/);
  assert.match(nested.tokenText ?? "", /\[REDACTED_TOKEN\]/);
});

test("日志报告汇总 HTTP、Agent、搜索、爬虫和 Campaign 指标", () => {
  const base = {
    service: "trade-radar-flow" as const,
    level: "info" as const,
    environment: "test",
    processId: 1,
  };
  const records: LogRecord[] = [
    {
      ...base,
      timestamp: "2026-07-18T10:00:00.000Z",
      event: "http.request.completed",
      data: { statusCode: 200, durationMs: 20 },
    },
    {
      ...base,
      timestamp: "2026-07-18T10:00:01.000Z",
      event: "agent.trace.recorded",
      agent: "QualificationAgent",
      data: { durationMs: 100 },
    },
    {
      ...base,
      timestamp: "2026-07-18T10:00:02.000Z",
      event: "search.serper.completed",
      data: { hitCount: 3 },
    },
    {
      ...base,
      timestamp: "2026-07-18T10:00:03.000Z",
      event: "crawler.python.completed",
      data: {
        durationMs: 50,
        pageCount: 2,
        contactCandidateCount: 1,
      },
    },
    {
      ...base,
      timestamp: "2026-07-18T10:00:04.000Z",
      event: "pipeline.campaign.completed",
      data: {
        leadCount: 2,
        qualified: 1,
        needsReview: 1,
        rejected: 0,
      },
    },
  ];
  const summary = summarizeRecords(records, ["test.jsonl"]);

  assert.equal(summary.totalRecords, 5);
  assert.equal(summary.http.requests, 1);
  assert.equal(summary.agents.completed, 1);
  assert.equal(summary.search.returnedHits, 3);
  assert.equal(summary.crawler.pages, 2);
  assert.equal(summary.campaigns.qualified, 1);
});
