import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { CampaignAgentContext } from "../src/agent-runtime.js";
import type { crawlCandidate } from "../src/crawler.js";
import { DemoAgentRuntime } from "../src/demo-agent-runtime.js";
import { demoCandidates } from "../src/demo-data.js";
import {
  appendBrandFingerprints,
  buildEffectiveSearchQuery,
} from "../src/discovery/query-exclusions.js";
import {
  SerperClient,
  type SerperSearchResult,
} from "../src/discovery/serper-client.js";
import type {
  CampaignResult,
  CampaignStrategy,
  CompanyCandidate,
  CountryProfile,
  DiscoveryProgress,
  LeadRecord,
  SearchHit,
  SearchQuery,
} from "../src/domain.js";
import { runApprovedStrategy } from "../src/pipeline.js";
import { createDefaultStrategy } from "../src/orchestrator/strategy-template.js";
import { getDatabase } from "../src/storage/database.js";

process.env.DATABASE_PATH = ":memory:";
process.env.COMPANY_ANALYSIS_RETRIES = "0";

const input = {
  product: "PVC tarpaulin",
  country: "United Arab Emirates",
  language: "English",
};

function hit(domain: string, query = "test"): SearchHit {
  return {
    query,
    position: 1,
    title: `${domain} industrial distributor`,
    link: `https://${domain}`,
    snippet: `${domain} supplies PVC tarpaulin as a distributor`,
    domain,
  };
}

function candidateFor(searchHit: SearchHit): CompanyCandidate {
  const source = demoCandidates[0];
  assert.ok(source);
  const template = structuredClone(source);
  template.id = `candidate-${searchHit.domain}`;
  template.domain = searchHit.domain;
  template.homepage = searchHit.link;
  template.searchSnippet = searchHit.snippet;
  template.searchHit = searchHit;
  template.contactCandidates = [];
  template.pages = template.pages.map((page, index) => ({
    ...page,
    title: `${searchHit.domain.replace(/\..*$/, "")} Systems`,
    url: `${searchHit.link}/page-${index}`,
  }));
  return template;
}

class QueueSerperClient extends SerperClient {
  readonly queries: SearchQuery[] = [];

  constructor(
    private readonly responses: SearchHit[][],
    private readonly events: string[] = [],
  ) {
    super({ apiKey: "test" });
  }

  override async search(
    query: SearchQuery,
    _country: CountryProfile,
    num = 10,
  ): Promise<SerperSearchResult> {
    assert.equal(num, 100);
    this.queries.push(query);
    this.events.push(`search:${query.query.split(" ")[0]}`);
    return {
      hits: this.responses[this.queries.length - 1] ?? [],
      cacheHit: false,
      requestCount: 1,
    };
  }
}

class TrackingRuntime extends DemoAgentRuntime {
  readonly analyzedDomains: string[] = [];

  constructor(private readonly events: string[] = []) {
    super();
  }

  override async analyzeCompany(
    candidate: CompanyCandidate,
    context?: CampaignAgentContext,
  ) {
    const result = await super.analyzeCompany(candidate, context);
    this.analyzedDomains.push(candidate.domain);
    this.events.push(`analyze:${candidate.domain}`);
    result.value.research.evidence.push({
      id: `identity-${candidate.id}`,
      kind: "identity",
      label: "官网品牌",
      value: `${candidate.domain.replace(/\..*$/, "")} Systems`,
      quote: `Official company name: ${candidate.domain.replace(/\..*$/, "")} Systems`,
      sourceUrl: candidate.homepage,
      confidence: 0.96,
    });
    return result;
  }
}

function trackingCrawl(
  events: string[] = [],
  crawledDomains: string[] = [],
): typeof crawlCandidate {
  return async (_url, searchHit) => {
    assert.ok(searchHit);
    events.push(`crawl:${searchHit.domain}`);
    crawledDomains.push(searchHit.domain);
    return candidateFor(searchHit);
  };
}

async function strategyWithQueries(
  queries: SearchQuery[],
  maxQueries = queries.length,
): Promise<CampaignStrategy> {
  const strategy = await createDefaultStrategy(input);
  strategy.search.queries = queries;
  strategy.budget.maxQueries = maxQueries;
  strategy.budget.resultsPerQuery = 100;
  strategy.budget.lowYieldNewDomains = 2;
  strategy.budget.lowYieldRate = 0.02;
  strategy.budget.consecutiveLowYieldRounds = 3;
  return strategy;
}

test("逐查询完成分析后再继续，并用 Campaign seen 阻止重复处理", async () => {
  const events: string[] = [];
  const crawledDomains: string[] = [];
  const client = new QueueSerperClient(
    [
      [hit("alpha.example"), hit("alpha.example"), hit("beta.example")],
      [hit("alpha.example"), hit("beta.example"), hit("gamma.example")],
    ],
    events,
  );
  const runtime = new TrackingRuntime(events);
  const strategy = await strategyWithQueries([
    {
      query: "round-one",
      language: "English",
      rationale: "variant",
      groupId: "pvc::distributor::english",
    },
    {
      query: "round-two",
      language: "English",
      rationale: "variant",
      groupId: "pvc::distributor::english",
    },
  ]);

  const campaign = await runApprovedStrategy(
    strategy,
    undefined,
    randomUUID(),
    {
      runtime,
      client,
      crawl: trackingCrawl(events, crawledDomains),
    },
  );

  assert.equal(campaign.discovery?.rounds?.length, 2);
  assert.equal(campaign.discovery?.rounds?.[0]?.duplicateDomainCount, 1);
  assert.equal(campaign.discovery?.rounds?.[1]?.duplicateDomainCount, 2);
  assert.equal(campaign.discovery?.rounds?.[1]?.newDomainCount, 1);
  assert.deepEqual(new Set(crawledDomains), new Set([
    "alpha.example",
    "beta.example",
    "gamma.example",
  ]));
  assert.equal(runtime.analyzedDomains.length, 3);
  assert.equal(campaign.leads.length, 3);
  assert.equal(campaign.discovery?.progress?.seenDomains.length, 3);
  const secondSearchIndex = events.findIndex(
    (event) => event === "search:round-two",
  );
  assert.ok(secondSearchIndex > events.indexOf("analyze:alpha.example"));
  assert.ok(secondSearchIndex > events.indexOf("analyze:beta.example"));
  assert.match(client.queries[1]?.query ?? "", /-site:alpha\.example/);
  assert.match(client.queries[1]?.query ?? "", /-"alpha Systems"/);

  const isolatedRuntime = new TrackingRuntime();
  const isolatedCrawls: string[] = [];
  const isolated = await runApprovedStrategy(
    await strategyWithQueries([
      {
        query: "new-campaign",
        language: "English",
        rationale: "variant",
        groupId: "pvc::distributor::english",
      },
    ]),
    undefined,
    randomUUID(),
    {
      runtime: isolatedRuntime,
      client: new QueueSerperClient([[hit("alpha.example")]]),
      crawl: trackingCrawl([], isolatedCrawls),
    },
  );
  assert.deepEqual(isolatedCrawls, ["alpha.example"]);
  assert.equal(isolated.leads.length, 1);
});

test("精确过滤仅接纳官网身份确认的唯一品牌，并按预算稳定截断", async () => {
  const strategy = await strategyWithQueries([]);
  strategy.search.cities = ["Dubai"];
  const runtime = new DemoAgentRuntime();
  const firstCandidate = candidateFor(hit("acme.example"));
  const firstAnalysis = await runtime.analyzeCompany(firstCandidate);
  firstAnalysis.value.research.evidence.push(
    {
      id: "identity-acme",
      kind: "identity",
      label: "官网品牌",
      value: "Acme Industrial",
      quote: "Officially Acme Industrial",
      sourceUrl: firstCandidate.homepage,
      confidence: 0.97,
    },
    {
      id: "identity-product",
      kind: "identity",
      label: "错误产品词",
      value: "PVC Tarpaulin",
      quote: "PVC Tarpaulin",
      sourceUrl: firstCandidate.homepage,
      confidence: 0.99,
    },
    {
      id: "identity-city",
      kind: "identity",
      label: "错误城市词",
      value: "Dubai",
      quote: "Dubai",
      sourceUrl: firstCandidate.homepage,
      confidence: 0.99,
    },
    {
      id: "identity-generic",
      kind: "identity",
      label: "错误通用词",
      value: "Trading Company",
      quote: "Trading Company",
      sourceUrl: firstCandidate.homepage,
      confidence: 0.99,
    },
    {
      id: "identity-shared-one",
      kind: "identity",
      label: "冲突品牌",
      value: "Shared Brand",
      quote: "Shared Brand",
      sourceUrl: firstCandidate.homepage,
      confidence: 0.95,
    },
    {
      id: "identity-robot-message",
      kind: "identity",
      label: "错误拦截提示",
      value: "两个页面均被机器人验证拦截，返回相同验证提示",
      quote: "两个页面均被机器人验证拦截，返回相同验证提示",
      sourceUrl: firstCandidate.homepage,
      confidence: 0.99,
    },
  );
  const secondCandidate = candidateFor(hit("other.example"));
  const secondAnalysis = await runtime.analyzeCompany(secondCandidate);
  secondAnalysis.value.research.evidence.push({
    id: "identity-shared-two",
    kind: "identity",
    label: "冲突品牌",
    value: "Shared Brand",
    quote: "Shared Brand",
    sourceUrl: secondCandidate.homepage,
    confidence: 0.95,
  });
  const reviewCandidate = candidateFor(hit("review.example"));
  const reviewAnalysis = await runtime.analyzeCompany(reviewCandidate);
  reviewAnalysis.value.research.evidence.push({
    id: "identity-review",
    kind: "identity",
    label: "待复核品牌",
    value: "Review Industrial",
    quote: "Review Industrial",
    sourceUrl: reviewCandidate.homepage,
    confidence: 0.96,
  });
  const lead = (
    candidate: CompanyCandidate,
    analysis: Awaited<ReturnType<DemoAgentRuntime["analyzeCompany"]>>,
    status: LeadRecord["status"] = "qualified",
  ): LeadRecord => ({
    id: randomUUID(),
    candidate,
    ...analysis.value,
    traces: [analysis.trace],
    status,
    createdAt: new Date().toISOString(),
  });
  const progress: DiscoveryProgress = {
    nextQueryIndex: 1,
    executedQueries: 1,
    seenDomains: ["acme.example", "other.example", "third.example"],
    domainRepeatCounts: {
      "acme.example": 4,
      "other.example": 2,
      "third.example": 1,
    },
    domainCompanyIds: {
      "acme.example": firstCandidate.id,
      "other.example": secondCandidate.id,
      "third.example": "candidate-third",
    },
    brandFingerprints: appendBrandFingerprints(
      [],
      [
        lead(firstCandidate, firstAnalysis),
        lead(secondCandidate, secondAnalysis),
        lead(reviewCandidate, reviewAnalysis, "needs_review"),
      ],
      strategy,
    ),
    groups: {},
  };
  const baseQuery = {
    query: "PVC tarpaulin distributor",
    language: "English",
    rationale: "test",
    groupId: "test",
  };
  const effective = buildEffectiveSearchQuery(baseQuery, progress);
  assert.match(effective.query.query, /-site:acme\.example/);
  assert.match(effective.query.query, /-"Acme Industrial"/);
  assert.doesNotMatch(effective.query.query, /PVC Tarpaulin"/);
  assert.doesNotMatch(effective.query.query, /-"Dubai"/);
  assert.doesNotMatch(effective.query.query, /Trading Company/);
  assert.doesNotMatch(effective.query.query, /Shared Brand/);
  assert.doesNotMatch(effective.query.query, /机器人验证/);
  assert.doesNotMatch(effective.query.query, /Review Industrial/);

  const limited = buildEffectiveSearchQuery(baseQuery, progress, 30);
  assert.ok(
    limited.filters.reduce(
      (total, filter) => total + filter.token.length + 1,
      0,
    ) <= 30,
  );
  assert.deepEqual(
    limited.filters,
    buildEffectiveSearchQuery(baseQuery, progress, 30).filters,
  );
});

test("同组连续三轮低新增后跳过该组并继续其它组", async () => {
  const client = new QueueSerperClient([
    [],
    [],
    [],
    [hit("other-group.example")],
  ]);
  const runtime = new TrackingRuntime();
  const strategy = await strategyWithQueries([
    { query: "a1", language: "English", rationale: "A", groupId: "group-a" },
    { query: "a2", language: "English", rationale: "A", groupId: "group-a" },
    { query: "a3", language: "English", rationale: "A", groupId: "group-a" },
    { query: "a4", language: "English", rationale: "A", groupId: "group-a" },
    { query: "b1", language: "English", rationale: "B", groupId: "group-b" },
  ]);
  const campaign = await runApprovedStrategy(
    strategy,
    undefined,
    randomUUID(),
    {
      runtime,
      client,
      crawl: trackingCrawl(),
    },
  );

  assert.deepEqual(
    client.queries.map((query) => query.query.split(" ")[0]),
    ["a1", "a2", "a3", "b1"],
  );
  assert.equal(
    campaign.discovery?.progress?.groups["group-a"]?.saturated,
    true,
  );
  assert.equal(
    campaign.discovery?.progress?.groups["group-b"]?.executedRounds,
    1,
  );
  assert.equal(campaign.discovery?.progress?.stopReason, "plan_exhausted");
});

test("高新增轮会重置同组连续低新增计数", async () => {
  const client = new QueueSerperClient([
    [],
    [],
    [
      hit("reset-one.example"),
      hit("reset-two.example"),
      hit("reset-three.example"),
    ],
    [],
    [],
  ]);
  const strategy = await strategyWithQueries(
    Array.from({ length: 5 }, (_, index) => ({
      query: `reset-${index}`,
      language: "English",
      rationale: "reset",
      groupId: "reset-group",
    })),
  );
  const campaign = await runApprovedStrategy(
    strategy,
    undefined,
    randomUUID(),
    {
      runtime: new TrackingRuntime(),
      client,
      crawl: trackingCrawl(),
    },
  );
  assert.equal(client.queries.length, 5);
  assert.equal(
    campaign.discovery?.progress?.groups["reset-group"]
      ?.consecutiveLowYieldRounds,
    2,
  );
  assert.equal(
    campaign.discovery?.progress?.groups["reset-group"]?.saturated,
    false,
  );
});

test("maxQueries 永不突破，恢复时从下一轮继续", async () => {
  const maxStrategy = await strategyWithQueries(
    Array.from({ length: 4 }, (_, index) => ({
      query: `max-${index}`,
      language: "English",
      rationale: "max",
      groupId: "max-group",
    })),
    2,
  );
  const maxClient = new QueueSerperClient([[], [], [], []]);
  const maxCampaign = await runApprovedStrategy(
    maxStrategy,
    undefined,
    randomUUID(),
    {
      runtime: new TrackingRuntime(),
      client: maxClient,
      crawl: trackingCrawl(),
    },
  );
  assert.equal(maxClient.queries.length, 2);
  assert.equal(maxCampaign.discovery?.progress?.executedQueries, 2);
  assert.equal(maxCampaign.discovery?.progress?.stopReason, "max_queries");

  const resumeStrategy = await strategyWithQueries(
    [
      {
        query: "completed-query",
        language: "English",
        rationale: "resume",
        groupId: "resume-group",
      },
      {
        query: "next-query",
        language: "English",
        rationale: "resume",
        groupId: "resume-group",
      },
    ],
    2,
  );
  const resumeId = randomUUID();
  const resumeCandidate = candidateFor(hit("resume.example"));
  const seeded: CampaignResult = {
    id: resumeId,
    ...input,
    mode: "demo",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    leads: [],
    searchMode: "serper",
    analysisFailures: [],
    candidateQueue: [resumeCandidate],
    discovery: {
      provider: "serper",
      countryId: "uae",
      plan: {
        countryId: "uae",
        product: input.product,
        queries: resumeStrategy.search.queries,
        marketPolicyRef: resumeStrategy.marketPolicyRef,
      },
      hits: [hit("resume.example", "completed-query")],
      skipped: [],
      errors: [],
      serpRequests: 1,
      cacheHits: 0,
      companies: [
        {
          domain: "resume.example",
          url: "https://resume.example",
          candidateId: resumeCandidate.id,
          roundIndex: 0,
          status: "pending",
          retryCount: 0,
        },
      ],
      rounds: [
        {
          index: 0,
          queryIndex: 0,
          groupId: "resume-group",
          baseQuery: resumeStrategy.search.queries[0]!,
          effectiveQuery: resumeStrategy.search.queries[0]!,
          filters: [],
          status: "analyzing",
          rawHitCount: 1,
          duplicateDomainCount: 0,
          excludedHitCount: 0,
          newDomainCount: 1,
          newDomains: ["resume.example"],
          crawlSucceeded: 1,
          crawlFailed: 0,
          crawlCacheHits: 0,
          analysisSucceeded: 0,
          analysisFailed: 0,
          cacheHit: false,
          serpRequests: 1,
          startedAt: new Date().toISOString(),
        },
      ],
      progress: {
        nextQueryIndex: 1,
        executedQueries: 1,
        seenDomains: ["resume.example"],
        domainRepeatCounts: { "resume.example": 0 },
        domainCompanyIds: { "resume.example": resumeCandidate.id },
        brandFingerprints: [],
        groups: {},
      },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  };
  getDatabase().saveCampaign(seeded);
  const resumeClient = new QueueSerperClient([[]]);
  const resumeRuntime = new TrackingRuntime();
  const resumed = await runApprovedStrategy(
    resumeStrategy,
    undefined,
    resumeId,
    {
      runtime: resumeRuntime,
      client: resumeClient,
      crawl: trackingCrawl(),
    },
  );
  assert.deepEqual(
    resumeClient.queries.map((query) => query.query.split(" ")[0]),
    ["next-query"],
  );
  assert.deepEqual(resumeRuntime.analyzedDomains, ["resume.example"]);
  assert.equal(resumed.discovery?.rounds?.length, 2);
  assert.equal(resumed.discovery?.rounds?.[0]?.status, "completed");
  assert.equal(resumed.discovery?.progress?.executedQueries, 2);
});

test("搜索失败检查点续跑时重新打开 stopReason 并重试原查询", async () => {
  const strategy = await strategyWithQueries([
    {
      query: "retry-failed-round",
      language: "English",
      rationale: "retry",
      groupId: "retry-group",
    },
  ]);
  const campaignId = randomUUID();
  const timestamp = new Date().toISOString();
  getDatabase().saveCampaign({
    id: campaignId,
    ...input,
    mode: "demo",
    searchMode: "serper",
    startedAt: timestamp,
    completedAt: timestamp,
    leads: [],
    analysisFailures: [],
    candidateQueue: [],
    discovery: {
      provider: "serper",
      countryId: "uae",
      plan: {
        countryId: "uae",
        product: input.product,
        queries: strategy.search.queries,
        marketPolicyRef: strategy.marketPolicyRef,
      },
      hits: [],
      skipped: [],
      errors: [],
      serpRequests: 0,
      cacheHits: 0,
      companies: [],
      rounds: [],
      progress: {
        nextQueryIndex: 0,
        executedQueries: 0,
        seenDomains: [],
        domainRepeatCounts: {},
        domainCompanyIds: {},
        brandFingerprints: [],
        groups: {},
        stopReason: "failed",
      },
      startedAt: timestamp,
      completedAt: timestamp,
    },
  });
  const client = new QueueSerperClient([[]]);

  const resumed = await runApprovedStrategy(
    strategy,
    undefined,
    campaignId,
    {
      runtime: new TrackingRuntime(),
      client,
      crawl: trackingCrawl(),
    },
  );

  assert.equal(client.queries.length, 1);
  assert.equal(resumed.id, campaignId);
  assert.equal(resumed.discovery?.progress?.executedQueries, 1);
  assert.equal(resumed.discovery?.progress?.stopReason, "max_queries");
});
