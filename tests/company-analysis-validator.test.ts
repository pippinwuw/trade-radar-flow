import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyCandidate } from "../src/domain.js";
import {
  attemptDeterministicRepairV2,
  buildEvidenceCatalog,
  buildValidationHints,
  type CompanyAnalysisDraft,
  type CompanyAnalysisSubmissionV2,
  CompanyAnalysisValidationError,
  classifyCompanyAnalysisFailureKind,
  locateVerbatimQuote,
  validateAndNormalizeCompanyAnalysis,
  validateAndNormalizeCompanyAnalysisV2,
} from "../src/validation/company-analysis-validator.js";
import { AgentExecutionError } from "../src/agents/agent-runtime.js";

const candidate: CompanyCandidate = {
  id: "company-1",
  homepage: "https://example.ae",
  domain: "example.ae",
  searchSnippet: "Industrial distributor",
  pages: [
    {
      url: "https://example.ae/about",
      title: "About",
      text: "Example Trading\u00a0LLC distributes industrial tarpaulins.\nWe serve the UAE market.",
    },
  ],
  contactCandidates: [
    {
      type: "email",
      value: "sales@example.ae",
      sourceUrl: "https://example.ae/about",
    },
  ],
};

function validSubmission(): CompanyAnalysisDraft {
  return {
    research: {
      companyId: candidate.id,
      canonicalName: "Example Trading LLC",
      summary: "Industrial distributor",
      products: ["tarpaulins"],
      contacts: [
        {
          sourceRef: "c0",
          label: "sales",
          confidence: 0.9,
        },
      ],
      evidence: [
        {
          id: "e1",
          kind: "identity",
          label: "Company identity",
          value: "Example Trading LLC",
          sourceRef: "p0-s0",
          confidence: 0.95,
        },
      ],
      missingInformation: [],
    },
    qualification: {
      isQualified: true,
      businessRole: "Distributor",
      productFitScore: 90,
      scaleScore: 50,
      importCapability: "Unknown",
      confidence: 0.9,
      reasons: ["Direct distributor"],
      evidenceIds: ["e1"],
      missingInformation: [],
      reviewPerformed: false,
    },
    outreach: {
      headline: "Potential distributor",
      whyContact: "Product fit",
      productFit: "Tarpaulins",
      risk: "Import capability unknown",
      recommendedContactRef: "c0",
      templateId: "distributor",
      templateReason: "Distributor role",
      emailSubject: "Tarpaulin supply",
      emailBody: "Draft",
      whatsappBody: "Draft",
      evidenceIds: ["e1"],
    },
  };
}

test("证据引用由服务端恢复逐字原文、URL、联系人来源和 keyEvidence", () => {
  const located = locateVerbatimQuote(
    candidate.pages[0]?.text ?? "",
    "Example Trading LLC distributes industrial tarpaulins.",
  );
  assert.equal(
    located,
    "Example Trading\u00a0LLC distributes industrial tarpaulins.",
  );

  const normalized = validateAndNormalizeCompanyAnalysis(
    validSubmission(),
    candidate,
    true,
    buildEvidenceCatalog(candidate.pages),
  );
  assert.equal(
    normalized.research.evidence[0]?.quote,
    candidate.pages[0]?.text,
  );
  assert.equal(
    normalized.outreach.keyEvidence[0],
    candidate.pages[0]?.text,
  );
  assert.equal(
    normalized.research.evidence[0]?.sourceUrl,
    "https://example.ae/about",
  );
  assert.equal(
    normalized.research.contacts[0]?.sourceUrl,
    "https://example.ae/about",
  );
  assert.equal(normalized.research.contacts[0]?.verified, false);
  assert.equal(normalized.outreach.recommendedContact, "sales@example.ae");
});

test("一次提交返回全部约束错误，避免模型逐项试错耗尽预算", () => {
  const submitted = validSubmission();
  submitted.research.companyId = "wrong-company";
  submitted.research.evidence[0]!.sourceRef = "missing-ref";
  submitted.qualification.evidenceIds = ["missing"];
  submitted.qualification.confidence = 0.5;
  submitted.qualification.reviewPerformed = false;
  submitted.outreach.recommendedContactRef = "missing-contact";

  assert.throws(
    () => validateAndNormalizeCompanyAnalysis(submitted, candidate, true),
    (error: unknown) => {
      assert.ok(error instanceof CompanyAnalysisValidationError);
      assert.ok(error.issues.length >= 4);
      assert.match(error.message, /companyId/);
      assert.match(error.message, /证据引用不存在/);
      assert.match(error.message, /不存在的证据 ID/);
      assert.match(error.message, /推荐联系方式/);
      assert.match(error.message, /必须完成复核/);
      return true;
    },
  );
});

function v2Candidate(): CompanyCandidate {
  return {
    id: "company-v2",
    homepage: "https://example.ae",
    domain: "example.ae",
    searchSnippet: "Industrial distributor",
    pages: [
      {
        url: "https://example.ae/about",
        title: "About",
        text: "Example Trading LLC distributes industrial tarpaulins across warehouses.",
      },
      {
        url: "https://example.ae/scale",
        title: "Scale",
        text: "The company maintains warehouse distribution and import operations.",
      },
    ],
    contactCandidates: [
      {
        type: "email",
        value: "sales@example.ae",
        sourceUrl: "https://example.ae/about",
      },
    ],
  };
}

function validV2Submission(
  candidate: CompanyCandidate,
  catalog = buildEvidenceCatalog(candidate.pages),
): CompanyAnalysisSubmissionV2 {
  const identityRef = catalog[0]?.ref;
  const productRef = catalog[0]?.ref;
  const scaleRef = catalog[1]?.ref;
  assert.ok(identityRef && productRef && scaleRef);
  return {
    research: {
      canonicalName: "Example Trading LLC",
      summary: "Industrial distributor",
      products: ["tarpaulins"],
      contacts: [{ contactRef: "c0", label: "sales", confidence: 0.9 }],
      facts: [
        {
          kind: "identity",
          label: "identity",
          value: "Example Trading LLC",
          evidenceRef: identityRef,
          confidence: 0.9,
        },
        {
          kind: "product",
          label: "product",
          value: "tarpaulins",
          evidenceRef: productRef,
          confidence: 0.9,
        },
        {
          kind: "scale",
          label: "scale",
          value: "warehouse distribution",
          evidenceRef: scaleRef,
          confidence: 0.8,
        },
      ],
      missingInformation: [],
    },
    qualification: {
      isQualified: true,
      businessRole: "Unknown",
      productFitScore: 80,
      scaleScore: 70,
      importCapability: "Medium",
      confidence: 0.9,
      reasons: ["Evidence-backed"],
      evidenceRefs: [productRef, scaleRef],
      missingInformation: [],
      riskAssessment: [],
    },
    outreach: {
      headline: "Review",
      whyContact: "Evidence-backed",
      productFit: "Tarpaulins",
      risk: "",
      recommendedContactRef: "c0",
      templateId: "distributor",
      templateReason: "role",
      emailSubject: "Subject",
      emailBody: "Body",
      whatsappBody: "Message",
      evidenceRefs: [productRef],
    },
  };
}

test("v2 未写入 facts 的 qualification 引用返回结构化修正提示", () => {
  const candidate = v2Candidate();
  const catalog = buildEvidenceCatalog(candidate.pages);
  const scaleRef = catalog[1]?.ref;
  assert.ok(scaleRef);
  const submission = validV2Submission(candidate, catalog);
  submission.qualification.evidenceRefs.push(scaleRef);
  submission.research.facts = submission.research.facts.filter(
    (fact) => fact.evidenceRef !== scaleRef,
  );

  assert.throws(
    () =>
      validateAndNormalizeCompanyAnalysisV2(
        submission,
        candidate,
        new Set(catalog.map((item) => item.ref)),
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CompanyAnalysisValidationError);
      assert.match(error.message, /未写入 research\.facts/);
      assert.match(error.message, /修正提示/);
      assert.ok(error.hints.some((hint) => hint.includes(scaleRef)));
      return true;
    },
  );
});

test("deterministic repair 可补全 qualification 引用缺失的 facts", () => {
  const candidate = v2Candidate();
  const catalog = buildEvidenceCatalog(candidate.pages);
  const scaleRef = catalog[1]?.ref;
  assert.ok(scaleRef);
  const submission = validV2Submission(candidate, catalog);
  submission.research.facts = submission.research.facts.filter(
    (fact) => fact.kind !== "scale",
  );
  assert.ok(submission.qualification.evidenceRefs.includes(scaleRef));

  const readRefs = new Set(catalog.map((item) => item.ref));
  const { repaired, applied } = attemptDeterministicRepairV2(
    submission,
    readRefs,
    catalog,
  );
  assert.ok(applied.some((item) => item.startsWith("backfill_fact:")));

  const normalized = validateAndNormalizeCompanyAnalysisV2(
    repaired,
    candidate,
    readRefs,
    catalog,
  );
  assert.equal(normalized.qualification.scaleScore, 70);
});

test("classifyCompanyAnalysisFailureKind 区分 validation 与 terminated", () => {
  const validationError = new CompanyAnalysisValidationError(["bad refs"], [
    "fix refs",
  ]);
  assert.equal(
    classifyCompanyAnalysisFailureKind(validationError),
    "validation",
  );
  assert.equal(
    classifyCompanyAnalysisFailureKind(new Error("terminated")),
    "terminated",
  );
  assert.equal(
    classifyCompanyAnalysisFailureKind(
      new AgentExecutionError("failed", {
        agent: "CompanyAnalysisAgent",
        mode: "live",
        status: "budget_exhausted",
        steps: [],
        durationMs: 1,
      }),
      {
        agent: "CompanyAnalysisAgent",
        mode: "live",
        status: "budget_exhausted",
        steps: [],
        durationMs: 1,
      },
    ),
    "budget_exhausted",
  );
});

test("buildValidationHints 为 scaleScore 问题给出可执行建议", () => {
  const candidate = v2Candidate();
  const submission = validV2Submission(candidate);
  submission.qualification.scaleScore = 50;
  submission.research.facts = submission.research.facts.filter(
    (fact) => fact.kind !== "scale",
  );
  submission.qualification.evidenceRefs = submission.qualification.evidenceRefs.filter(
    (ref) => submission.research.facts.some((fact) => fact.evidenceRef === ref),
  );

  const hints = buildValidationHints(
    ["scaleScore 大于 0 但缺少 qualification 引用的 scale 事实"],
    submission,
  );
  assert.ok(hints.some((hint) => hint.includes("kind=scale")));
});
