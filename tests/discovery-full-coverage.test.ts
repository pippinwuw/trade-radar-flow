import assert from "node:assert/strict";
import test from "node:test";
import { DemoAgentRuntime } from "../src/agents/demo-agent-runtime.js";
import {
  discoverCompanies,
  isExcludedSearchHit,
} from "../src/discovery/discovery-service.js";
import type { SerperClient } from "../src/discovery/serper-client.js";
import type { CompanyCandidate, SearchHit } from "../src/domain.js";

test("发现流程抓取全部去重官网，但不把低国家分数候选送入分析", async () => {
  const hits: SearchHit[] = Array.from({ length: 8 }, (_, index) => ({
    query: "test query",
    position: index + 1,
    title: `Company ${index}`,
    link: `https://company-${index}.example`,
    snippet: "B2B supplier",
    domain: `company-${index}.example`,
  }));
  const requestedResults: number[] = [];
  const client = {
    search: async (
      _query: unknown,
      _country: unknown,
      num: number,
    ) => {
      requestedResults.push(num);
      return { hits, cacheHit: false, requestCount: 1 };
    },
  } as unknown as SerperClient;
  const crawledDomains: string[] = [];

  const result = await discoverCompanies(
    {
      product: "PVC tarpaulin",
      country: "United Arab Emirates",
      language: "English",
    },
    new DemoAgentRuntime(),
    client,
    {
      resultsPerQuery: 1,
      minimumCountryScore: 100,
      crawl: async (_url, searchHit): Promise<CompanyCandidate> => {
        assert.ok(searchHit);
        crawledDomains.push(searchHit.domain);
        return {
          id: `candidate-${searchHit.position}`,
          homepage: searchHit.link,
          domain: searchHit.domain,
          searchSnippet: searchHit.snippet,
          searchHit,
          pages: [
            {
              url: searchHit.link,
              title: searchHit.title,
              text: "Generic B2B supplier without explicit country signals.",
            },
          ],
          contactCandidates: [],
        };
      },
    },
  );

  assert.equal(result.candidates.length, 0);
  assert.ok(requestedResults.every((num) => num === 100));
  assert.equal(new Set(crawledDomains).size, 8);
  assert.equal(result.discovery.companies?.length, 8);
  assert.ok(
    result.discovery.companies?.every(
      (company) => company.status === "country_rejected",
    ),
  );
  assert.equal(result.discovery.errors.length, 0);
  assert.equal(
    result.discovery.skipped.filter((item) =>
      item.reason.includes("国家一致性"),
    ).length,
    8,
  );
});

test("已知目录域名和目录型搜索结果在抓取前排除", () => {
  assert.equal(
    isExcludedSearchHit({
      query: "test",
      position: 1,
      title: "UAE Yellow Pages",
      link: "https://yellowpages-uae.com",
      snippet: "Find local businesses",
      domain: "yellowpages-uae.com",
    }),
    true,
  );
  assert.equal(
    isExcludedSearchHit({
      query: "test",
      position: 2,
      title: "Suppliers Business Directory",
      link: "https://directory.example",
      snippet: "Company directory listings",
      domain: "directory.example",
    }),
    true,
  );
  assert.equal(
    isExcludedSearchHit({
      query: "test",
      position: 3,
      title: "Example Industrial",
      link: "https://example.ae",
      snippet: "PVC tarpaulin distributor",
      domain: "example.ae",
    }),
    false,
  );
  assert.equal(
    isExcludedSearchHit({
      query: "test",
      position: 4,
      title: "PVC Tarpaulin Buyers",
      link: "https://free.globalimporter.net/buyers/tarpaulin",
      snippet: "Global buying leads",
      domain: "free.globalimporter.net",
    }),
    true,
  );
  assert.equal(
    isExcludedSearchHit({
      query: "test",
      position: 5,
      title: "Saudi textile regulation",
      link: "https://example.sa/regulation.pdf",
      snippet: "Official PDF",
      domain: "example.sa",
    }),
    true,
  );
  assert.equal(
    isExcludedSearchHit({
      query: "test",
      position: 6,
      title: "Saudi Yellow Pages Online",
      link: "https://saudiyellowpagesonline.com/tarpaulin",
      snippet: "Find suppliers",
      domain: "saudiyellowpagesonline.com",
    }),
    true,
  );
});
