import assert from "node:assert/strict";
import test from "node:test";
import { requireCountry } from "../src/countries/registry.js";
import { SerperClient } from "../src/discovery/serper-client.js";
import { AppDatabase } from "../src/storage/database.js";

test("Serper 请求携带 UAE 本地化参数、认证头并缓存响应", async () => {
  const requested: Array<{ input: URL | RequestInfo; init?: RequestInit }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    requested.push({ input, init });
    return new Response(
      JSON.stringify({
        organic: [
          {
            position: 1,
            title: "Example Distributor",
            link: "https://www.example.ae/about",
            snippet: "Industrial distributor in Dubai",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = new SerperClient({
    apiKey: "test-key",
    fetchFn,
    database: new AppDatabase(":memory:"),
  });
  const query = {
    query: "PVC tarpaulin distributor Dubai",
    language: "en",
    rationale: "test",
  };
  const first = await client.search(query, requireCountry("UAE"), 10);
  const second = await client.search(query, requireCountry("UAE"), 10);

  assert.equal(requested.length, 1);
  assert.equal(String(requested[0]?.input), "https://google.serper.dev/search");
  assert.equal(requested[0]?.init?.method, "POST");
  assert.equal(
    new Headers(requested[0]?.init?.headers).get("x-api-key"),
    "test-key",
  );
  const body = JSON.parse(String(requested[0]?.init?.body)) as {
    gl: string;
    location: string;
    num: number;
  };
  assert.equal(body.gl, "ae");
  assert.equal(body.location, "United Arab Emirates");
  assert.equal(body.num, 10);
  assert.equal(first.hits[0]?.domain, "example.ae");
  assert.equal(first.cacheHit, false);
  assert.equal(first.requestCount, 1);
  assert.equal(second.cacheHit, true);
  assert.equal(second.requestCount, 0);
});

test("带引号的大结果集按免费账号限制自动使用 num=10 翻页", async () => {
  const bodies: Array<{ num: number; page?: number }> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      num: number;
      page?: number;
    };
    bodies.push(body);
    const page = body.page ?? 1;
    return new Response(
      JSON.stringify({
        organic: Array.from({ length: 10 }, (_, index) => ({
          position: index + 1,
          title: `Company ${page}-${index}`,
          link:
            index === 0 && page > 1
              ? "https://duplicate.example/about"
              : `https://company-${page}-${index}.example/about`,
          snippet: "Industrial distributor",
        })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = new SerperClient({
    apiKey: "test-key",
    fetchFn,
    database: new AppDatabase(":memory:"),
  });

  const result = await client.search(
    {
      query: '"PVC tarpaulin" distributor Saudi Arabia',
      language: "en",
      rationale: "test",
    },
    requireCountry("UAE"),
    30,
  );

  assert.deepEqual(
    bodies.map(({ num, page }) => ({ num, page })),
    [
      { num: 10, page: undefined },
      { num: 10, page: 2 },
      { num: 10, page: 3 },
    ],
  );
  assert.equal(result.requestCount, 3);
  assert.equal(result.cacheHit, false);
  assert.ok(result.hits.length < 30);
  assert.equal(
    new Set(result.hits.map((hit) => hit.link)).size,
    result.hits.length,
  );
});

test("Serper 客户端拒绝缺少独立搜索密钥", async () => {
  const client = new SerperClient({
    apiKey: "",
    database: new AppDatabase(":memory:"),
  });
  await assert.rejects(
    client.search(
      { query: "test", language: "en", rationale: "test" },
      requireCountry("Saudi Arabia"),
      1,
    ),
    /SERPER_API_KEY/,
  );
});
