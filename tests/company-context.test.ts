import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyContext } from "../src/analysis/company-context.js";
import { compileContext } from "../src/analysis/context-manager.js";
import { demoCandidates } from "../src/agents/demo-data.js";
import { buildCampaignAgentContext } from "../src/discovery/query-planner.js";
import { createDefaultStrategy } from "../src/orchestrator/strategy-template.js";
import { AppDatabase } from "../src/storage/database.js";
import {
  buildContactCatalog,
  buildEvidenceCatalog,
  validateAndNormalizeCompanyAnalysisV2,
  type CompanyAnalysisSubmissionV2,
} from "../src/validation/company-analysis-validator.js";

test("Context Manager 保留必需分区并按预算丢弃可选分区", () => {
  const envelope = compileContext(
    [
      {
        id: "required",
        source: "test",
        content: "required business rules",
        trust: "system",
        priority: "required",
      },
      {
        id: "optional",
        source: "test",
        content: "x".repeat(20_000),
        trust: "runtime",
        priority: "optional",
      },
    ],
    { contextWindow: 2_000, modelMaxTokens: 500 },
  );

  assert.match(envelope.content, /required business rules/);
  assert.equal(
    envelope.sections.find((section) => section.id === "optional")?.included,
    false,
  );
});

test("CompanyContextBuilder 全文索引页面尾部并区分输入与决策 fingerprint", async () => {
  const source = demoCandidates[0];
  assert.ok(source);
  const candidate = structuredClone(source);
  candidate.pages = [
    {
      url: candidate.homepage,
      title: "Home",
      text: `${"ordinary text ".repeat(1_300)} global sourcing warehouse import`,
    },
  ];
  const strategy = await createDefaultStrategy({
    product: "PVC tarpaulin",
    country: "United Arab Emirates",
    language: "English",
  });
  const context = await buildCampaignAgentContext(
    {
      product: strategy.product,
      country: strategy.country,
      language: strategy.language,
    },
    strategy,
  );
  const first = buildCompanyContext(candidate, context, {
    provider: "test",
    id: "test-model",
  });
  const tail = first.evidencePack.scaleAndImport.find((item) =>
    /global sourcing warehouse import/i.test(item.text),
  );
  assert.ok(tail, "页面尾部的规模/进口证据应进入字段化证据包");

  const changedStrategy = {
    ...strategy,
    targetCustomer: {
      ...strategy.targetCustomer,
      businessRoles: ["Manufacturer" as const],
    },
  };
  const changedContext = await buildCampaignAgentContext(
    context.input,
    changedStrategy,
  );
  const second = buildCompanyContext(candidate, changedContext, {
    provider: "test",
    id: "test-model",
  });
  assert.equal(first.pageFingerprint, second.pageFingerprint);
  assert.deepEqual(first.catalog, second.catalog);
  assert.equal(first.candidateFingerprint, second.candidateFingerprint);
  assert.notEqual(first.decisionFingerprint, second.decisionFingerprint);
  assert.notEqual(first.cacheKey, second.cacheKey);
});

test("v2 公司提交由系统生成 company/evidence 字段并隔离 contactRef", () => {
  const source = demoCandidates[0];
  assert.ok(source);
  const candidate = structuredClone(source);
  const catalog = buildEvidenceCatalog(candidate.pages);
  const evidenceRef = catalog[0]?.ref;
  const contactRef = buildContactCatalog(candidate.contactCandidates)[0]?.ref;
  assert.ok(evidenceRef && contactRef);
  const submission: CompanyAnalysisSubmissionV2 = {
    research: {
      canonicalName: "Example",
      summary: "Evidence-backed summary",
      products: ["PVC tarpaulin"],
      contacts: [{ contactRef, label: "sales", confidence: 0.9 }],
      facts: [
        {
          kind: "identity",
          label: "identity",
          value: "Example",
          evidenceRef,
          confidence: 0.9,
        },
      ],
      missingInformation: [],
    },
    qualification: {
      isQualified: true,
      businessRole: "Distributor",
      productFitScore: 80,
      scaleScore: 70,
      importCapability: "Medium",
      confidence: 0.9,
      reasons: ["官网证据支持"],
      evidenceRefs: [evidenceRef],
      missingInformation: [],
      riskAssessment: [],
    },
    outreach: {
      headline: "Review",
      whyContact: "Evidence-backed",
      productFit: "PVC tarpaulin",
      risk: "人工审核",
      recommendedContactRef: contactRef,
      templateId: "distributor",
      templateReason: "role",
      emailSubject: "Subject",
      emailBody: "Body",
      whatsappBody: "Message",
      evidenceRefs: [evidenceRef],
    },
  };
  const result = validateAndNormalizeCompanyAnalysisV2(
    submission,
    candidate,
    new Set([evidenceRef]),
    catalog,
  );

  assert.equal(result.research.companyId, candidate.id);
  assert.equal(result.research.evidence[0]?.id, "ev-1");
  assert.equal(
    result.research.evidence[0]?.quote,
    catalog[0]?.text,
  );
  assert.equal(
    result.outreach.recommendedContact,
    candidate.contactCandidates[0]?.value,
  );
});

test("公司分析缓存按完整 key 读写", () => {
  const database = new AppDatabase(":memory:");
  database.putCompanyAnalysisCache({
    key: "cache-key",
    domain: "example.com",
    candidateFingerprint: "candidate",
    decisionFingerprint: "decision",
    marketPolicyHash: "market-policy",
    analysisContractVersion: "v2",
    modelProvider: "test",
    modelId: "model",
    result: {
      research: {
        companyId: "company",
        canonicalName: "Example",
        summary: "Summary",
        products: [],
        contacts: [],
        evidence: [],
        missingInformation: [],
      },
      qualification: {
        isQualified: false,
        businessRole: "Unknown",
        productFitScore: 0,
        scaleScore: 0,
        importCapability: "Unknown",
        confidence: 0,
        reasons: [],
        evidenceIds: [],
        missingInformation: [],
        reviewPerformed: true,
      },
      outreach: {
        headline: "",
        whyContact: "",
        productFit: "",
        keyEvidence: [],
        risk: "",
        recommendedContact: "",
        templateId: "",
        templateReason: "",
        emailSubject: "",
        emailBody: "",
        whatsappBody: "",
        evidenceIds: [],
      },
    },
    createdAt: new Date().toISOString(),
  });

  assert.equal(database.getCompanyAnalysisCache("cache-key")?.domain, "example.com");
  assert.equal(database.getCompanyAnalysisCache("other"), undefined);
});

test("页面证据索引按域名和页面 fingerprint 持久化", () => {
  const database = new AppDatabase(":memory:");
  database.putCompanyEvidenceIndex({
    key: "index-key",
    domain: "example.com",
    pageFingerprint: "pages-v1",
    snippets: [
      {
        ref: "p0-s0",
        pageIndex: 0,
        url: "https://example.com/",
        text: "official evidence",
      },
    ],
    duplicatePages: [{ pageIndex: 1, duplicateOf: 0 }],
    createdAt: new Date().toISOString(),
  });

  const restored = database.getCompanyEvidenceIndex(
    "example.com",
    "pages-v1",
  );
  assert.equal(restored?.snippets[0]?.text, "official evidence");
  assert.equal(restored?.duplicatePages[0]?.duplicateOf, 0);
});
