import type {
  BrandFingerprint,
  CampaignStrategy,
  DiscoveryProgress,
  LeadRecord,
  SearchExclusionFilter,
  SearchQuery,
} from "../domain.js";

const FILTER_CHARACTER_BUDGET = 1_000;
const MAX_DOMAIN_FILTERS = 12;
const MAX_BRAND_FILTERS = 8;
const GENERIC_BRAND_WORDS = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "enterprise",
  "enterprises",
  "establishment",
  "global",
  "group",
  "inc",
  "industries",
  "industry",
  "international",
  "llc",
  "ltd",
  "service",
  "services",
  "shop",
  "solutions",
  "store",
  "trade",
  "trading",
  "شركة",
  "مجموعة",
  "مؤسسة",
  "تجارة",
  "للتجارة",
]);
const NON_BRAND_SIGNAL =
  /(?:captcha|access denied|robot|verification|verify you are human|blocked|error|not found|页面|机器人|验证|拦截|错误|无法访问|提示)/iu;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

export function resolveQueryGroupId(
  query: SearchQuery,
  queryIndex: number,
): string {
  if (query.groupId?.trim()) return query.groupId.trim();
  const rationale = normalize(query.rationale) || "legacy";
  const language = normalize(query.language) || "unknown";
  return `${language}::${rationale}::legacy-${Math.floor(queryIndex / 3)}`;
}

function blockedBrandTokens(strategy: CampaignStrategy): Set<string> {
  return new Set(
    [
      strategy.product,
      ...strategy.search.requiredKeywords,
      ...strategy.search.alternativeKeywords,
      ...strategy.search.localLanguageKeywords,
      ...strategy.search.cities,
      ...strategy.targetCustomer.businessRoles,
      ...strategy.targetCustomer.industries,
    ].flatMap(tokens),
  );
}

function isDistinctiveBrand(
  value: string,
  strategy: CampaignStrategy,
): boolean {
  const trimmed = value.trim();
  if (
    trimmed.length > 80 ||
    tokens(trimmed).length > 8 ||
    NON_BRAND_SIGNAL.test(trimmed) ||
    /[\n\r.!?。！？]/u.test(trimmed)
  ) {
    return false;
  }
  const normalized = normalize(value);
  if (normalized.length < 3) return false;
  const blocked = blockedBrandTokens(strategy);
  const distinctive = tokens(value).filter(
    (token) =>
      !GENERIC_BRAND_WORDS.has(token) &&
      !blocked.has(token) &&
      (token.length >= 4 || /[^\x00-\x7f]/.test(token)),
  );
  return distinctive.length > 0;
}

export function appendBrandFingerprints(
  existing: readonly BrandFingerprint[],
  leads: readonly LeadRecord[],
  strategy: CampaignStrategy,
): BrandFingerprint[] {
  const fingerprints = new Map(
    existing.map((item) => [
      `${item.normalizedValue}\n${item.sourceDomain}`,
      item,
    ]),
  );
  for (const lead of leads) {
    if (lead.status !== "qualified" && lead.status !== "approved") continue;
    const sourceDomain =
      lead.candidate.searchHit?.domain ?? lead.candidate.domain;
    for (const evidence of lead.research.evidence) {
      if (
        evidence.kind !== "identity" ||
        evidence.confidence < 0.85 ||
        !isDistinctiveBrand(evidence.value, strategy)
      ) {
        continue;
      }
      const normalizedValue = normalize(evidence.value);
      const fingerprint: BrandFingerprint = {
        value: evidence.value.trim(),
        normalizedValue,
        sourceCompanyId: lead.candidate.id,
        sourceDomain,
        evidenceId: evidence.id,
        confidence: evidence.confidence,
      };
      fingerprints.set(
        `${normalizedValue}\n${sourceDomain}`,
        fingerprint,
      );
    }
  }
  return [...fingerprints.values()];
}

function uniqueBrandFingerprints(
  progress: DiscoveryProgress,
): BrandFingerprint[] {
  const domainsByBrand = new Map<string, Set<string>>();
  for (const item of progress.brandFingerprints) {
    const domains =
      domainsByBrand.get(item.normalizedValue) ?? new Set<string>();
    domains.add(item.sourceDomain);
    domainsByBrand.set(item.normalizedValue, domains);
  }
  return progress.brandFingerprints.filter(
    (item) => domainsByBrand.get(item.normalizedValue)?.size === 1,
  );
}

function escapeBrand(value: string): string {
  return value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildEffectiveSearchQuery(
  baseQuery: SearchQuery,
  progress: DiscoveryProgress,
  characterBudget = FILTER_CHARACTER_BUDGET,
): {
  query: SearchQuery;
  filters: SearchExclusionFilter[];
} {
  const filters: SearchExclusionFilter[] = [];
  let usedCharacters = 0;
  const addFilter = (filter: SearchExclusionFilter): boolean => {
    const cost = filter.token.length + 1;
    if (
      filters.length >= MAX_DOMAIN_FILTERS + MAX_BRAND_FILTERS ||
      usedCharacters + cost > characterBudget
    ) {
      return false;
    }
    filters.push(filter);
    usedCharacters += cost;
    return true;
  };

  const domains = [...progress.seenDomains].sort((left, right) => {
    const repeatDifference =
      (progress.domainRepeatCounts[right] ?? 0) -
      (progress.domainRepeatCounts[left] ?? 0);
    return repeatDifference || left.localeCompare(right);
  });
  for (const domain of domains.slice(0, MAX_DOMAIN_FILTERS)) {
    addFilter({
      type: "domain",
      value: domain,
      token: `-site:${domain}`,
      sourceCompanyId: progress.domainCompanyIds[domain] ?? domain,
      sourceDomain: domain,
      reason: `当前 Campaign 已处理；后续结果重复 ${progress.domainRepeatCounts[domain] ?? 0} 次`,
    });
  }

  const brands = uniqueBrandFingerprints(progress).sort((left, right) => {
    const repeatDifference =
      (progress.domainRepeatCounts[right.sourceDomain] ?? 0) -
      (progress.domainRepeatCounts[left.sourceDomain] ?? 0);
    return (
      repeatDifference ||
      right.confidence - left.confidence ||
      left.normalizedValue.localeCompare(right.normalizedValue)
    );
  });
  let brandCount = 0;
  for (const brand of brands) {
    if (brandCount >= MAX_BRAND_FILTERS) break;
    const value = escapeBrand(brand.value);
    if (!value) continue;
    if (
      addFilter({
        type: "brand",
        value,
        token: `-"${value}"`,
        sourceCompanyId: brand.sourceCompanyId,
        sourceDomain: brand.sourceDomain,
        reason: `官网身份类证据 ${brand.evidenceId}，置信度 ${brand.confidence.toFixed(2)}`,
      })
    ) {
      brandCount += 1;
    }
  }

  return {
    query: {
      ...baseQuery,
      query: [baseQuery.query, ...filters.map((filter) => filter.token)].join(
        " ",
      ),
    },
    filters,
  };
}
