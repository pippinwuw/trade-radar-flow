import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyCandidate } from "../src/domain.js";
import {
  buildEvidenceCatalog,
  type CompanyAnalysisDraft,
  CompanyAnalysisValidationError,
  locateVerbatimQuote,
  validateAndNormalizeCompanyAnalysis,
} from "../src/validation/company-analysis-validator.js";

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
