import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignAgentContext } from "../src/agent-runtime.js";
import { DemoAgentRuntime } from "../src/demo-agent-runtime.js";
import { demoCandidates } from "../src/demo-data.js";
import type { CompanyCandidate } from "../src/domain.js";
import {
  DEFAULT_COMPANY_ANALYSIS_ACTIVE_LIMIT,
  DEFAULT_COMPANY_ANALYSIS_CONCURRENCY,
  runCampaign,
} from "../src/pipeline.js";

test("公司分析保留 50 个待处理上限，并默认最多同时激活 12 个", () => {
  assert.equal(DEFAULT_COMPANY_ANALYSIS_CONCURRENCY, 50);
  assert.equal(DEFAULT_COMPANY_ANALYSIS_ACTIVE_LIMIT, 12);
});

class TrackingRuntime extends DemoAgentRuntime {
  active = 0;
  maximumActive = 0;
  calls = 0;

  override async analyzeCompany(
    candidate: CompanyCandidate,
    context?: CampaignAgentContext,
  ) {
    this.calls += 1;
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      await new Promise((resolve) =>
        setTimeout(resolve, 3 + (Number(candidate.id.split("-").at(-1)) % 4)),
      );
      if (candidate.id === "candidate-7") {
        throw new Error("permanent company failure");
      }
      return await super.analyzeCompany(candidate, context);
    } finally {
      this.active -= 1;
    }
  }
}

function candidates(count: number): CompanyCandidate[] {
  const template = demoCandidates[0];
  assert.ok(template);
  return Array.from({ length: count }, (_, index) => {
    const candidate = structuredClone(template);
    candidate.id = `candidate-${index}`;
    candidate.domain = `company-${String(index).padStart(2, "0")}.example`;
    candidate.homepage = `https://${candidate.domain}`;
    candidate.pages = candidate.pages.map((page, pageIndex) => ({
      ...page,
      url: `${candidate.homepage}/page-${pageIndex}`,
    }));
    candidate.contactCandidates = [];
    return candidate;
  });
}

test("20 家公司最多并发 5 个 Agent，单项失败不影响其余公司", async () => {
  process.env.DATABASE_PATH = ":memory:";
  const previousConcurrency = process.env.COMPANY_ANALYSIS_CONCURRENCY;
  const previousActiveLimit = process.env.COMPANY_ANALYSIS_ACTIVE_LIMIT;
  const previousRetries = process.env.COMPANY_ANALYSIS_RETRIES;
  process.env.COMPANY_ANALYSIS_CONCURRENCY = "50";
  process.env.COMPANY_ANALYSIS_ACTIVE_LIMIT = "5";
  process.env.COMPANY_ANALYSIS_RETRIES = "0";
  try {
    const runtime = new TrackingRuntime();
    const inputCandidates = candidates(20);
    const campaign = await runCampaign(
      {
        product: "PVC tarpaulin",
        country: "United Arab Emirates",
        language: "English",
      },
      inputCandidates,
      { runtime },
    );

    assert.equal(runtime.maximumActive, 5);
    assert.equal(runtime.calls, 20);
    assert.equal(campaign.leads.length, 19);
    assert.equal(campaign.analysisFailures?.length, 1);
    assert.equal(campaign.analysisFailures?.[0]?.candidateId, "candidate-7");
    assert.ok(
      campaign.leads.every(
        (lead) =>
          lead.traces.length === 1 &&
          lead.traces[0]?.agent === "CompanyAnalysisAgent",
      ),
    );

    const resumed = await runCampaign(
      {
        product: "PVC tarpaulin",
        country: "United Arab Emirates",
        language: "English",
      },
      inputCandidates,
      { runtime, campaignId: campaign.id },
    );
    assert.equal(resumed.leads.length, 19);
    assert.equal(runtime.calls, 21);
    assert.equal(new Set(resumed.leads.map((lead) => lead.candidate.id)).size, 19);
    assert.equal(resumed.analysisFailures?.length, 1);
  } finally {
    if (previousConcurrency === undefined) {
      delete process.env.COMPANY_ANALYSIS_CONCURRENCY;
    } else {
      process.env.COMPANY_ANALYSIS_CONCURRENCY = previousConcurrency;
    }
    if (previousActiveLimit === undefined) {
      delete process.env.COMPANY_ANALYSIS_ACTIVE_LIMIT;
    } else {
      process.env.COMPANY_ANALYSIS_ACTIVE_LIMIT = previousActiveLimit;
    }
    if (previousRetries === undefined) {
      delete process.env.COMPANY_ANALYSIS_RETRIES;
    } else {
      process.env.COMPANY_ANALYSIS_RETRIES = previousRetries;
    }
  }
});
