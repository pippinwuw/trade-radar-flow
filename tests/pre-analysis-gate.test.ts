import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignAgentContext } from "../src/agents/agent-runtime.js";
import type {
  CampaignStrategy,
  CompanyCandidate,
  SearchHit,
} from "../src/domain.js";
import { compilePreAnalysisLexicon } from "../src/analysis/evidence-terms.js";
import {
  evaluatePreAnalysisGate,
  evaluateSearchSnippetGate,
} from "../src/validation/pre-analysis-gate.js";

function buildContext(
  strategyOverrides: Partial<CampaignStrategy> = {},
): CampaignAgentContext {
  const strategy: CampaignStrategy = {
    schemaVersion: 2,
    product: "PVC tarpaulin",
    country: "Hungary",
    language: "English",
    objective: "Find buyers",
    targetCustomer: {
      businessRoles: ["Distributor", "Wholesaler", "Importer"],
      industries: [],
      companyScale: "B2B",
      importCapability: ["High", "Medium", "Unknown"],
      preferredContactRoles: ["sales"],
    },
    search: {
      requiredKeywords: ["tarpaulin", "PVC tarpaulin"],
      alternativeKeywords: [],
      localLanguageKeywords: ["ponyva"],
      cities: ["Budapest"],
      channels: ["serper"],
      manualUrls: [],
      queries: [],
    },
    exclusions: {
      businessRoles: ["Retailer", "Service"],
      domains: [],
      terms: ["retail only", "repair only", "consumer marketplace"],
    },
    validation: {
      minimumCountryScore: 35,
      requireCompanyDomainEmail: false,
      requireMx: true,
      requireLocalPhone: false,
      preAnalysisGate: {
        enabled: true,
        minPageTextChars: 100,
        requireStrongExclusion: true,
        useQueryTermsInSnippetGate: true,
      },
    },
    budget: {
      maxQueries: 5,
      resultsPerQuery: 10,
      maxPagesPerCompany: 5,
      maxReanalysisPerLead: 1,
      lowYieldNewDomains: 2,
      lowYieldRate: 0.02,
      consecutiveLowYieldRounds: 3,
    },
    output: {
      reportLanguage: "Chinese",
      rankingPriorities: [],
      generateOutreach: true,
    },
    customSections: [],
    marketPolicyRef: {
      marketId: "hungary",
      version: "test",
      hash: "test",
    },
    ...strategyOverrides,
  };
  return {
    input: {
      product: strategy.product,
      country: strategy.country,
      language: strategy.language,
    },
    strategy,
    country: {
      id: "hungary",
      displayName: "Hungary",
      shortName: "HU",
      aliases: [],
      gl: "hu",
      defaultHl: "hu",
      googleDomain: "google.hu",
      location: "Hungary",
      cities: ["Budapest"],
      phoneCountryCode: "HU",
      callingCode: "+36",
      domainSuffix: ".hu",
      businessSuffixes: ["Kft."],
    },
    marketPolicy: {
      schemaVersion: 1,
      marketId: "hungary",
      version: "test",
      hash: "test",
      status: "approved",
      searchLocalization: {
        languages: ["hu", "en"],
        buyerRoleTerms: [
          "distributor",
          "forgalmazó",
          "nagykereskedő",
          "importőr",
        ],
        queryPatterns: [],
        translationRestrictions: [],
      },
      companyAnalysis: {
        identitySignals: [],
        legalSuffixSemantics: [],
        buyerSignals: [],
        importAndScaleSignals: [],
        falsePositivePatterns: [],
        exclusions: [
          "pure retail shops",
          "consumer marketplaces",
          "kiskereskedés",
          "javító szolgáltatás",
        ],
      },
      contactAndOutreach: {
        preferredContactTerms: [],
        validationNotes: [],
        defaultLanguage: "English",
        etiquette: [],
      },
      metadata: {
        source: "user",
        reviewNotes: [],
        createdAt: new Date().toISOString(),
      },
    },
  };
}

test("compilePreAnalysisLexicon 不含通用 product/application 词", () => {
  const lexicon = compilePreAnalysisLexicon(buildContext());
  assert.ok(lexicon.productTerms.includes("PVC tarpaulin"));
  assert.ok(lexicon.productTerms.includes("ponyva"));
  assert.equal(lexicon.productTerms.includes("application"), false);
  assert.equal(lexicon.productTerms.includes("solution"), false);
  assert.ok(lexicon.exclusionTerms.some((term) => /retail/i.test(term)));
});

test("搜索摘要预筛在保守条件下跳过明显零售商", () => {
  const context = buildContext();
  const hit: SearchHit = {
    query: "industrial supplier Hungary",
    position: 1,
    title: "Kiskereskedő bolt",
    link: "https://example.hu",
    snippet: "Bolti értékesítés és online piactér, javító szolgáltatás",
    domain: "example.hu",
  };
  const result = evaluateSearchSnippetGate(hit, context);
  assert.equal(result.skip, true);
  assert.equal(result.productHits, 0);
  assert.ok(result.exclusionHits >= 1);
});

test("搜索摘要预筛保留含产品词或买家角色的命中", () => {
  const context = buildContext();
  const hit: SearchHit = {
    query: "PVC tarpaulin distributor Hungary",
    position: 1,
    title: "ABC Tarp Kft - PVC tarpaulin forgalmazó",
    link: "https://abc.hu",
    snippet: "Nagykereskedő és importőr",
    domain: "abc.hu",
  };
  const result = evaluateSearchSnippetGate(hit, context);
  assert.equal(result.skip, false);
});

test("抓取后预筛跳过无产品无买家但命中排除的正文", () => {
  const context = buildContext();
  const candidate: CompanyCandidate = {
    id: "c1",
    domain: "shop.hu",
    homepage: "https://shop.hu",
    searchSnippet: "Kiskereskedő bolt",
    pages: [
      {
        url: "https://shop.hu",
        title: "Shop",
        text: "Kiskereskedés és bolti értékesítés. Javító szolgáltatás ponyvákhoz. ".repeat(
          20,
        ),
      },
    ],
    contactCandidates: [],
    crawlCacheHit: false,
    countryValidation: {
      countryId: "hungary",
      score: 80,
      matched: true,
      signals: [],
      warnings: [],
    },
  };
  const result = evaluatePreAnalysisGate(candidate, context);
  assert.equal(result.skip, true);
});

test("正文过短时保守放行", () => {
  const context = buildContext();
  const candidate: CompanyCandidate = {
    id: "c2",
    domain: "tiny.hu",
    homepage: "https://tiny.hu",
    searchSnippet: "Tiny shop",
    pages: [{ url: "https://tiny.hu", title: "Tiny", text: "kiskereskedés" }],
    contactCandidates: [],
    crawlCacheHit: false,
    countryValidation: {
      countryId: "hungary",
      score: 80,
      matched: true,
      signals: [],
      warnings: [],
    },
  };
  const result = evaluatePreAnalysisGate(candidate, context);
  assert.equal(result.skip, false);
});
