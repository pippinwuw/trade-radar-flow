import assert from "node:assert/strict";
import test from "node:test";
import { DemoAgentRuntime } from "../src/demo-agent-runtime.js";
import { demoCandidates } from "../src/demo-data.js";
import {
  runCampaign,
  runOfflineSampleCampaign,
  updateLeadStatus,
} from "../src/pipeline.js";

test("单公司 Agent 只消歧爬虫提供的联系方式候选", async () => {
  const runtime = new DemoAgentRuntime();
  const candidate = demoCandidates[0];
  assert.ok(candidate);

  const result = await runtime.analyzeCompany(candidate);
  assert.deepEqual(
    result.value.research.contacts.map((contact) => contact.value).sort(),
    candidate.contactCandidates.map((contact) => contact.value).sort(),
  );
  assert.ok(
    result.value.research.evidence.every((item) => item.sourceUrl),
  );
});

test("单公司 Agent 淘汰零售维修店并保留 B2B 分销商", async () => {
  const runtime = new DemoAgentRuntime();
  const distributor = demoCandidates[0];
  const retailer = demoCandidates[1];
  assert.ok(distributor && retailer);

  const distributorDecision = await runtime.analyzeCompany(distributor);
  const retailerDecision = await runtime.analyzeCompany(retailer);

  assert.equal(distributorDecision.value.qualification.isQualified, true);
  assert.equal(retailerDecision.value.qualification.isQualified, false);
  assert.equal(retailerDecision.value.qualification.businessRole, "Retailer");
  assert.equal(retailerDecision.value.qualification.reviewPerformed, true);
});

test("离线验证样例生成排序后的黄金买家队列并支持人工批准", async () => {
  const campaign = await runOfflineSampleCampaign({
    product: "PVC tarpaulin",
    country: "United Arab Emirates",
    language: "English",
  });

  assert.equal(campaign.leads.length, 3);
  assert.equal(
    campaign.leads.filter((lead) => lead.qualification.isQualified).length,
    2,
  );
  assert.equal(campaign.leads[0]?.qualification.isQualified, true);
  assert.equal(campaign.leads.at(-1)?.qualification.isQualified, false);
  assert.ok(campaign.leads.every((lead) => lead.outreach.headline));
  assert.ok(campaign.leads.every((lead) => lead.traces.length === 1));
  assert.ok(
    campaign.leads.every(
      (lead) => lead.traces[0]?.agent === "CompanyAnalysisAgent",
    ),
  );
  assert.equal(campaign.marketPolicyRef?.marketId, "uae");
  assert.equal("countryContextSnapshot" in campaign, false);

  const lead = campaign.leads[0];
  assert.ok(lead);
  const updated = updateLeadStatus(campaign.id, lead.id, "approved");
  assert.equal(updated?.status, "approved");
});

test("低置信否定进入人工复核且本地联系人校验不冒充已验证", async () => {
  class LowConfidenceRuntime extends DemoAgentRuntime {
    override async analyzeCompany(
      candidate: NonNullable<(typeof demoCandidates)[number]>,
    ) {
      const result = await super.analyzeCompany(candidate);
      result.value.qualification.isQualified = false;
      result.value.qualification.confidence = 0.6;
      result.value.qualification.reviewPerformed = true;
      return result;
    }
  }
  const source = demoCandidates[0];
  assert.ok(source);
  const candidate = structuredClone(source);
  candidate.id = "low-confidence-review";
  const contact = candidate.contactCandidates[0];
  assert.ok(contact);
  candidate.contactValidations = [
    {
      value: contact.value,
      syntaxValid: true,
      mxPresent: true,
      sameCompanyDomain: true,
      contextRole: "sales",
      confidence: 0.98,
      notes: ["确定性检查通过，但不代表邮箱存在、可投递或同意营销"],
    },
  ];
  const campaign = await runCampaign(
    {
      product: "PVC tarpaulin",
      country: "United Arab Emirates",
      language: "English",
    },
    [candidate],
    { runtime: new LowConfidenceRuntime() },
  );
  assert.equal(campaign.leads[0]?.status, "needs_review");
  assert.ok(
    campaign.leads[0]?.research.contacts.every(
      (resolved) => resolved.verified === false,
    ),
  );
});
