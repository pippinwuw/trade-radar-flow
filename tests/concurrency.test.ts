import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientError,
  mapWithConcurrency,
  OperationTimeoutError,
  withRetry,
} from "../src/lib/concurrency.js";

test("并发池不超过指定并发数且保持输入顺序", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6, 7],
    3,
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
  );

  assert.deepEqual(result, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(maximumActive, 3);
});

test("并发池在单项失败时向调用方传播错误", async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("expected failure");
      return value;
    }),
    /expected failure/,
  );
});

test("临时失败按退避策略有限重试", async () => {
  let attempts = 0;
  const retries: number[] = [];
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary timeout");
      return "ok";
    },
    {
      retries: 2,
      baseDelayMs: 1,
      onRetry: (_error, retryNumber) => retries.push(retryNumber),
    },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(retries, [1, 2]);
});

test("类型化超时不依赖中英文错误文本即可触发重试", () => {
  assert.equal(
    isTransientError(new OperationTimeoutError("公司分析本地执行超时")),
    true,
  );
  assert.equal(isTransientError(new Error("Python 爬虫请求超时")), true);
  assert.equal(isTransientError(new Error("HTTP 503 Service Unavailable")), true);
  assert.equal(
    isTransientError(new Error("[Errno 11001] getaddrinfo failed")),
    true,
  );
  assert.equal(isTransientError(new Error("永久校验失败")), false);
});
