import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompanyContext,
  pageCompanyEvidenceSlot,
} from "../src/analysis/company-context.js";
import { compileContext } from "../src/analysis/context-manager.js";
import { demoCandidates } from "../src/agents/demo-data.js";
import { buildCampaignAgentContext } from "../src/discovery/query-planner.js";
import { createDefaultStrategy } from "../src/orchestrator/strategy-template.js";
import { AppDatabase } from "../src/storage/database.js";
import {
  buildContactCatalog,
  buildEvidenceCatalog,
  EVIDENCE_CHUNK_MAX_LENGTH,
  EVIDENCE_CHUNK_MIN_LENGTH,
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

test("证据索引使用较大连续 chunk，并在建索引前跳过空页和重复页", () => {
  const source = demoCandidates[0];
  assert.ok(source);
  const candidate = structuredClone(source);
  const paragraph = `${"PVC coated industrial fabric supports warehouse distribution. ".repeat(18)}\n`;
  candidate.pages = [
    {
      url: candidate.homepage,
      title: "Home",
      text: paragraph.repeat(8),
    },
    {
      url: `${candidate.homepage}/duplicate`,
      title: "Duplicate",
      text: paragraph.repeat(8),
    },
    {
      url: `${candidate.homepage}/empty`,
      title: "Empty",
      text: "   ",
    },
  ];
  const catalog = buildEvidenceCatalog(candidate.pages, new Set([1, 2]));

  assert.ok(catalog.length > 1);
  assert.ok(catalog.every((item) => item.pageIndex === 0));
  assert.ok(
    catalog.slice(0, -1).every(
      (item) =>
        item.text.length >= EVIDENCE_CHUNK_MIN_LENGTH &&
        item.text.length <= EVIDENCE_CHUNK_MAX_LENGTH,
    ),
  );
});

test("字段证据支持更大的初始包和独立 cursor 分页", async () => {
  const source = demoCandidates[0];
  assert.ok(source);
  const candidate = structuredClone(source);
  candidate.pages = [
    {
      url: candidate.homepage,
      title: "Products and distribution",
      text: Array.from(
        { length: 80 },
        (_, index) =>
          `PVC tarpaulin product ${index} distributor warehouse import global sourcing company Poland. ` +
          "This official product description is intended for industrial buyers and commercial applications.",
      ).join("\n"),
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
  const build = buildCompanyContext(candidate, context, {
    provider: "test",
    id: "test-model",
  });

  assert.ok(build.evidencePack.productFit.length > 10);
  const firstPage = pageCompanyEvidenceSlot(build, "productFit", 0, 12);
  assert.equal(firstPage.items.length, 12);
  assert.equal(firstPage.nextCursor, 12);
  const secondPage = pageCompanyEvidenceSlot(
    build,
    "productFit",
    firstPage.nextCursor ?? 0,
    12,
  );
  assert.ok(secondPage.items.length > 0);
  assert.notEqual(
    firstPage.items[0]?.evidenceRef,
    secondPage.items[0]?.evidenceRef,
  );
});

test("v2 公司提交由系统生成 company/evidence 字段并隔离 contactRef", () => {
  const source = demoCandidates[0];
  assert.ok(source);
  const candidate = structuredClone(source);
  candidate.pages = [
    {
      url: candidate.homepage,
      title: "About",
      text: "Example Industrial LLC is the official company identity.",
    },
    {
      url: `${candidate.homepage}/products`,
      title: "Products",
      text: "The company supplies PVC tarpaulin for industrial applications.",
    },
    {
      url: `${candidate.homepage}/distribution`,
      title: "Distribution",
      text: "The company operates as a commercial distributor.",
    },
    {
      url: `${candidate.homepage}/scale`,
      title: "Scale",
      text: "The company maintains warehouse distribution and import operations.",
    },
  ];
  const catalog = buildEvidenceCatalog(candidate.pages);
  const evidenceRef = catalog[0]?.ref;
  const productRef = catalog[1]?.ref;
  const roleRef = catalog[2]?.ref;
  const scaleRef = catalog[3]?.ref;
  const contactRef = buildContactCatalog(candidate.contactCandidates)[0]?.ref;
  assert.ok(evidenceRef && productRef && roleRef && scaleRef && contactRef);
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
        {
          kind: "product",
          label: "product",
          value: "PVC tarpaulin",
          evidenceRef: productRef,
          confidence: 0.9,
        },
        {
          kind: "business_role",
          label: "role",
          value: "Distributor",
          evidenceRef: roleRef,
          confidence: 0.9,
        },
        {
          kind: "scale",
          label: "scale",
          value: "Commercial distribution",
          evidenceRef: scaleRef,
          confidence: 0.8,
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
      evidenceRefs: [productRef, roleRef, scaleRef],
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
      evidenceRefs: [productRef],
    },
  };
  const result = validateAndNormalizeCompanyAnalysisV2(
    submission,
    candidate,
    new Set([evidenceRef, productRef, roleRef, scaleRef]),
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
