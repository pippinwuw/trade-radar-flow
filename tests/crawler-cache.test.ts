import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlCandidate,
  crawlerCacheKey,
} from "../src/crawler/index.js";
import type { CompanyCandidate, SearchHit } from "../src/domain.js";
import { getDatabase } from "../src/storage/database.js";

test("同一域名和抓取配置跨搜索命中复用完整抓取缓存", async () => {
  const options = { enableRegexCleaning: true, maxPages: 20 };
  const cacheKey = crawlerCacheKey(
    "https://www.example.com/about",
    options,
  );
  assert.ok(cacheKey);
  const cached: CompanyCandidate = {
    id: "cached-candidate",
    homepage: "https://www.example.com/",
    domain: "example.com",
    searchSnippet: "old snippet",
    pages: [
      {
        url: "https://www.example.com/",
        title: "Example",
        text: "Example wholesale distributor",
      },
    ],
    contactCandidates: [],
  };
  getDatabase().putSearchCache(cacheKey, cached, 60_000);
  const searchHit: SearchHit = {
    query: "new query",
    position: 1,
    title: "Example product",
    link: "https://example.com/products",
    snippet: "new snippet",
    domain: "example.com",
  };

  const result = await crawlCandidate(searchHit.link, searchHit, options);

  assert.notEqual(result.id, cached.id);
  assert.equal(result.searchSnippet, "new snippet");
  assert.deepEqual(result.searchHit, searchHit);
  assert.deepEqual(result.pages, cached.pages);
});
