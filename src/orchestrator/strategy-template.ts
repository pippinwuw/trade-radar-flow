import { createHash, randomUUID } from "node:crypto";
import { requireCountry } from "../market/registry.js";
import type {
  BusinessRole,
  CampaignInput,
  CampaignStrategy,
} from "../domain.js";
import {
  getApprovedMarketPolicy,
  marketPolicyRef,
} from "../market/policy.js";
import {
  DEFAULT_SEARCH_QUERIES,
  MAX_RESULTS_PER_QUERY,
} from "../lib/limits.js";
import { DEFAULT_PRE_ANALYSIS_GATE } from "../validation/pre-analysis-gate.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function strategyHash(strategy: CampaignStrategy): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(strategy)))
    .digest("hex")
    .slice(0, 16);
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : fallback;
}

export function clampStrategy(strategy: CampaignStrategy): CampaignStrategy {
  const country = requireCountry(strategy.country);
  const approvedPolicy = getApprovedMarketPolicy(country.id);
  const maxQueries = positiveInteger(
    strategy.budget.maxQueries,
    DEFAULT_SEARCH_QUERIES,
  );
  const resultsPerQuery = MAX_RESULTS_PER_QUERY;
  return {
    ...strategy,
    schemaVersion: 2,
    product: strategy.product.trim(),
    country: country.displayName,
    language: strategy.language.trim() || "English",
    objective: strategy.objective.trim(),
    budget: {
      maxQueries,
      resultsPerQuery,
      maxPagesPerCompany: positiveInteger(
        strategy.budget.maxPagesPerCompany,
        20,
      ),
      maxReanalysisPerLead: Number.isFinite(
        strategy.budget.maxReanalysisPerLead,
      )
        ? Math.max(0, Math.floor(strategy.budget.maxReanalysisPerLead))
        : 1,
      lowYieldNewDomains: Number.isFinite(
        strategy.budget.lowYieldNewDomains,
      )
        ? Math.max(0, Math.floor(strategy.budget.lowYieldNewDomains))
        : 2,
      lowYieldRate: Number.isFinite(strategy.budget.lowYieldRate)
        ? Math.max(0, Math.min(strategy.budget.lowYieldRate, 1))
        : 0.02,
      consecutiveLowYieldRounds: positiveInteger(
        strategy.budget.consecutiveLowYieldRounds,
        3,
      ),
    },
    validation: {
      ...strategy.validation,
      minimumCountryScore: Math.max(
        0,
        Math.min(strategy.validation.minimumCountryScore, 100),
      ),
      preAnalysisGate: {
        enabled:
          strategy.validation.preAnalysisGate?.enabled ??
          DEFAULT_PRE_ANALYSIS_GATE.enabled,
        minPageTextChars: Math.max(
          0,
          strategy.validation.preAnalysisGate?.minPageTextChars ??
            DEFAULT_PRE_ANALYSIS_GATE.minPageTextChars,
        ),
        requireStrongExclusion:
          strategy.validation.preAnalysisGate?.requireStrongExclusion ??
          DEFAULT_PRE_ANALYSIS_GATE.requireStrongExclusion,
        useQueryTermsInSnippetGate:
          strategy.validation.preAnalysisGate?.useQueryTermsInSnippetGate ??
          DEFAULT_PRE_ANALYSIS_GATE.useQueryTermsInSnippetGate,
      },
    },
    marketPolicyRef:
      strategy.marketPolicyRef?.marketId === country.id
        ? strategy.marketPolicyRef
        : marketPolicyRef(approvedPolicy),
  };
}

export function assertStrategy(strategy: CampaignStrategy): void {
  if (!strategy.product) throw new Error("策略缺少目标产品");
  if (!strategy.objective) throw new Error("策略缺少任务目标");
  const country = requireCountry(strategy.country);
  const policyMarket = strategy.marketPolicyRef?.marketId;
  if (strategy.schemaVersion === 2 && policyMarket !== country.id) {
    throw new Error(
      `策略国家 ${country.displayName} 与市场规则包 ${policyMarket ?? "未设置"} 不一致`,
    );
  }
  if (strategy.schemaVersion === 2 && !strategy.marketPolicyRef) {
    throw new Error("schema v2 策略缺少已批准市场规则包引用");
  }
  if (!strategy.targetCustomer.businessRoles.length) {
    throw new Error("策略至少需要一个目标客户角色");
  }
  const validRoles = new Set<BusinessRole>([
    "Distributor",
    "Wholesaler",
    "Importer",
    "Manufacturer",
    "Retailer",
    "Service",
    "Unknown",
  ]);
  if (
    strategy.targetCustomer.businessRoles.some(
      (role) => !validRoles.has(role),
    )
  ) {
    throw new Error("策略包含不支持的目标客户角色");
  }
  if (!strategy.search.requiredKeywords.length) {
    throw new Error("策略至少需要一个核心关键词");
  }
}

export async function createDefaultStrategy(
  input: CampaignInput,
): Promise<CampaignStrategy> {
  const country = requireCountry(input.country);
  const policy = getApprovedMarketPolicy(country.id);
  return {
    schemaVersion: 2,
    product: input.product,
    country: country.displayName,
    language: input.language,
    objective: `寻找 ${country.displayName} 市场中适合 ${input.product} 的 B2B 买家，并生成可审核的触达简报`,
    targetCustomer: {
      businessRoles: ["Distributor", "Wholesaler", "Importer"],
      industries: [],
      companyScale: "具备 B2B 分销、批发、进口或规模化制造能力",
      importCapability: ["High", "Medium", "Unknown"],
      preferredContactRoles: ["sales", "commercial", "export", "procurement"],
    },
    search: {
      requiredKeywords: [input.product],
      alternativeKeywords: [],
      localLanguageKeywords: [],
      cities: [...country.cities.slice(0, 3)],
      channels: ["serper"],
      manualUrls: [],
      queries: [],
    },
    exclusions: {
      businessRoles: ["Retailer", "Service"],
      domains: [],
      terms: [
        "retail only",
        "repair only",
        "consumer marketplace",
        "classified ads",
        "directory listing",
      ],
    },
    validation: {
      minimumCountryScore: 35,
      requireCompanyDomainEmail: false,
      requireMx: true,
      requireLocalPhone: false,
      preAnalysisGate: { ...DEFAULT_PRE_ANALYSIS_GATE },
    },
    budget: {
      maxQueries: DEFAULT_SEARCH_QUERIES,
      resultsPerQuery: MAX_RESULTS_PER_QUERY,
      maxPagesPerCompany: 20,
      maxReanalysisPerLead: 1,
      lowYieldNewDomains: 2,
      lowYieldRate: 0.02,
      consecutiveLowYieldRounds: 3,
    },
    output: {
      reportLanguage: "Chinese",
      rankingPriorities: [
        "产品匹配度",
        "B2B 经营角色",
        "公司规模",
        "联系方式质量",
      ],
      generateOutreach: true,
    },
    customSections: [
      {
        id: randomUUID(),
        title: "人工确认重点",
        content:
          "执行前确认产品/应用、目标客户画像、排除条件、查询覆盖、验证门槛、预分析过滤与预算。",
        source: "template",
      },
      {
        id: randomUUID(),
        title: "触达可用卖方事实",
        content:
          "默认仅确认目标产品，不预设价格、MOQ、交期、认证、性能、画册或样品承诺；需要在触达草稿中使用的卖方优势应由用户明确补充并批准。",
        source: "template",
      },
    ],
    marketPolicyRef: marketPolicyRef(policy),
  };
}

export function estimateStrategyBudget(strategy: CampaignStrategy): {
  serperRequests: number;
  maximumSearchHits: number;
  maximumCrawls: number;
  estimatedModelCalls: number;
} {
  const maximumSerperPagesPerQuery = Math.max(
    1,
    Math.ceil(strategy.budget.resultsPerQuery / 10),
  );
  return {
    serperRequests:
      strategy.budget.maxQueries * maximumSerperPagesPerQuery,
    maximumSearchHits:
      strategy.budget.maxQueries * strategy.budget.resultsPerQuery,
    maximumCrawls:
      strategy.budget.maxQueries * strategy.budget.resultsPerQuery,
    estimatedModelCalls:
      1 +
      strategy.budget.maxQueries * strategy.budget.resultsPerQuery +
      1,
  };
}

export const TARGET_ROLE_OPTIONS: BusinessRole[] = [
  "Distributor",
  "Wholesaler",
  "Importer",
  "Manufacturer",
  "Retailer",
  "Service",
  "Unknown",
];
