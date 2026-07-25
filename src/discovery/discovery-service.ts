import type {
  AgentRuntime,
  CampaignAgentContext,
} from "../agents/agent-runtime.js";
import { crawlCandidate } from "../crawler/index.js";
import type {
  CampaignInput,
  CompanyCandidate,
  CompanyProcessingRecord,
  DiscoveryProgress,
  DiscoveryRound,
  DiscoveryRun,
  CampaignStrategy,
  SearchQuery,
  SearchPlan,
  SearchHit,
} from "../domain.js";
import { validateContactCandidates } from "../validation/contact-validator.js";
import { validateCompanyCountry } from "../validation/country-validator.js";
import { planCampaignSearch } from "./query-planner.js";
import { buildCampaignAgentContext } from "./query-planner.js";
import { SerperClient } from "./serper-client.js";
import { logger } from "../logging/logger.js";
import {
  isTransientError,
  mapWithConcurrency,
  positiveIntegerFromEnv,
  withRetry,
} from "../lib/concurrency.js";
import {
  DEFAULT_SEARCH_QUERIES,
  MAX_RESULTS_PER_QUERY,
} from "../lib/limits.js";
import {
  buildEffectiveSearchQuery,
  resolveQueryGroupId,
} from "./query-exclusions.js";

const EXCLUDED_DOMAINS = new Set([
  "google.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "x.com",
  "twitter.com",
  "wikipedia.org",
  "amazon.com",
  "amazon.ae",
  "amazon.sa",
  "noon.com",
  "alibaba.com",
  "made-in-china.com",
  "yellowpages-uae.com",
  "atninfo.com",
  "tiktok.com",
  "wa.me",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "exporthub.com",
  "go4worldbusiness.com",
  "tradewheel.com",
  "tradeford.com",
  "exportersindia.com",
  "indiamart.com",
  "globaltradeplaza.com",
  "fibre2fashion.com",
  "globalsources.com",
  "globalimporter.net",
  "volza.com",
  "cybex.in",
  "exportgenius.in",
  "eximpedia.app",
  "tradedata.pro",
  "turkish-manufacturers.com",
  "strategicmarketresearch.com",
  "futuremarketinsights.com",
  "marketreportsworld.com",
  "verifiedmarketresearch.com",
  "kohantextilejournal.com",
  "tarpaulin-manufacturers.com",
]);

const DIRECTORY_SIGNAL =
  /\b(?:yellow\s*pages|business\s+directory|company\s+directory|b2b\s+directory|supplier\s+directory|buying\s+leads?|katalog\s+firm|baza\s+firm|spis\s+firm|portal\s+firm)\b/i;
const NON_COMPANY_CONTENT_SIGNAL =
  /\b(?:market\s+(?:research|report|size|forecast)|industry\s+report|trade\s+data|import\s+data|export\s+data|product\s+listing|consumer\s+marketplace|classified\s+ads?|translation\s+dictionary|portal\s+ogłoszeniowy|serwis\s+ogłoszeniowy|ogłoszenia\s+lokalne|słownik\s+internetowy)\b/i;
const PLATFORM_DOMAIN_SIGNAL =
  /(?:^|\.)(?:[^.]*yellowpages[^.]*|[^.]*businessdirectory[^.]*|kompass|europages|industrystock|panoramafirm|polskiefirmy|sprzedajemy|oferteo|linguee)\.[a-z.]{2,}$|^(?:amazon|ebay|ubuy)\./i;
const NON_HTML_PATH_SIGNAL =
  /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z)(?:$|[?#])/i;

function domainMatches(domain: string, excluded: string): boolean {
  const normalized = excluded.trim().toLowerCase().replace(/^\.+/, "");
  return Boolean(
    normalized &&
      (domain === normalized || domain.endsWith(`.${normalized}`)),
  );
}

export function isExcludedSearchHit(
  hit: SearchHit,
  extraExclusions: readonly string[] = [],
): boolean {
  const domain = hit.domain.toLowerCase().replace(/^www\./, "");
  if (
    [...EXCLUDED_DOMAINS].some((excluded) =>
      domainMatches(domain, excluded),
    ) ||
    extraExclusions.some((excluded) => domainMatches(domain, excluded)) ||
    PLATFORM_DOMAIN_SIGNAL.test(domain) ||
    NON_HTML_PATH_SIGNAL.test(hit.link)
  ) {
    return true;
  }
  const summary = `${hit.title} ${hit.snippet}`;
  return (
    DIRECTORY_SIGNAL.test(summary) ||
    NON_COMPANY_CONTENT_SIGNAL.test(summary)
  );
}

export interface DiscoveryOptions {
  maxQueries?: number;
  resultsPerQuery?: number;
  approvedPlan?: SearchPlan;
  strategy?: CampaignStrategy;
  excludedDomains?: string[];
  minimumCountryScore?: number;
  crawl?: typeof crawlCandidate;
}

export interface DiscoveryServiceResult {
  discovery: DiscoveryRun;
  candidates: CompanyCandidate[];
  context: CampaignAgentContext;
}

function dedupeHits(hits: SearchHit[], extraExclusions: string[] = []): {
  accepted: SearchHit[];
  skipped: DiscoveryRun["skipped"];
} {
  const accepted = new Map<string, SearchHit>();
  const skipped: DiscoveryRun["skipped"] = [];
  for (const hit of hits) {
    if (isExcludedSearchHit(hit, extraExclusions)) {
      skipped.push({
        url: hit.link,
        reason: "排除社交、内容、消费者平台或企业目录站",
      });
      continue;
    }
    if (accepted.has(hit.domain)) {
      skipped.push({ url: hit.link, reason: "同一公司域名重复" });
      continue;
    }
    accepted.set(hit.domain, hit);
  }
  return { accepted: [...accepted.values()], skipped };
}

export function createDiscoveryProgress(): DiscoveryProgress {
  return {
    nextQueryIndex: 0,
    executedQueries: 0,
    seenDomains: [],
    domainRepeatCounts: {},
    domainCompanyIds: {},
    brandFingerprints: [],
    groups: {},
  };
}

export interface DiscoveryRoundOptions {
  input: CampaignInput;
  query: SearchQuery;
  queryIndex: number;
  roundIndex: number;
  context: CampaignAgentContext;
  progress: DiscoveryProgress;
  strategy: CampaignStrategy;
  client?: SerperClient;
  excludedDomains?: string[];
  crawl?: typeof crawlCandidate;
  onProgress?: (snapshot: {
    round: DiscoveryRound;
    companies: CompanyProcessingRecord[];
  }) => void | Promise<void>;
}

export interface DiscoveryRoundResult {
  round: DiscoveryRound;
  hits: SearchHit[];
  skipped: DiscoveryRun["skipped"];
  errors: DiscoveryRun["errors"];
  companies: CompanyProcessingRecord[];
  candidates: CompanyCandidate[];
}

export async function executeDiscoveryRound({
  input,
  query,
  queryIndex,
  roundIndex,
  context,
  progress,
  strategy,
  client = new SerperClient(),
  excludedDomains = [],
  crawl = crawlCandidate,
  onProgress,
}: DiscoveryRoundOptions): Promise<DiscoveryRoundResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const groupId = resolveQueryGroupId(query, queryIndex);
  const effective = buildEffectiveSearchQuery(query, progress);
  const round: DiscoveryRound = {
    index: roundIndex,
    queryIndex,
    groupId,
    baseQuery: query,
    effectiveQuery: effective.query,
    filters: effective.filters,
    status: "analyzing",
    phase: "searching",
    rawHitCount: 0,
    duplicateDomainCount: 0,
    excludedHitCount: 0,
    newDomainCount: 0,
    newDomains: [],
    crawlSucceeded: 0,
    crawlFailed: 0,
    countryRejected: 0,
    crawlCacheHits: 0,
    analysisSucceeded: 0,
    analysisFailed: 0,
    cacheHit: false,
    serpRequests: 0,
    startedAt,
  };
  let companies: CompanyProcessingRecord[] = [];
  const emitProgress = async (): Promise<void> => {
    if (!onProgress) return;
    await onProgress({
      round: { ...round },
      companies: companies.map((company) => ({ ...company })),
    });
  };
  await emitProgress();
  logger.info("discovery.round.started", undefined, {
    roundIndex,
    queryIndex,
    groupId,
    baseQuery: query.query,
    effectiveQuery: effective.query.query,
    filterCount: effective.filters.length,
    seenDomainCount: progress.seenDomains.length,
  });
  const response = await client.search(
    effective.query,
    context.country,
    MAX_RESULTS_PER_QUERY,
  );
  const seenDomains = new Set(
    progress.seenDomains.map((domain) => domain.toLowerCase()),
  );
  const accepted = new Map<string, SearchHit>();
  const skipped: DiscoveryRun["skipped"] = [];
  let duplicateDomainCount = 0;
  let excludedHitCount = 0;
  for (const hit of response.hits) {
    const domain = hit.domain.toLowerCase();
    if (isExcludedSearchHit(hit, excludedDomains)) {
      excludedHitCount += 1;
      skipped.push({
        url: hit.link,
        reason: "排除社交、内容、消费者平台、企业目录站或策略域名",
      });
      continue;
    }
    if (seenDomains.has(domain) || accepted.has(domain)) {
      duplicateDomainCount += 1;
      progress.domainRepeatCounts[domain] =
        (progress.domainRepeatCounts[domain] ?? 0) + 1;
      skipped.push({
        url: hit.link,
        reason: seenDomains.has(domain)
          ? "当前 Campaign 已阅读公司"
          : "本轮同一公司域名重复",
      });
      continue;
    }
    accepted.set(domain, hit);
  }
  const newHits = [...accepted.values()];
  for (const hit of newHits) {
    const domain = hit.domain.toLowerCase();
    seenDomains.add(domain);
    progress.domainRepeatCounts[domain] ??= 0;
  }
  progress.seenDomains = [...seenDomains];
  round.rawHitCount = response.hits.length;
  round.duplicateDomainCount = duplicateDomainCount;
  round.excludedHitCount = excludedHitCount;
  round.newDomainCount = newHits.length;
  round.newDomains = newHits.map((hit) => hit.domain);
  round.cacheHit = response.cacheHit;
  round.serpRequests = response.requestCount;
  round.phase = "crawling";
  companies = newHits.map((hit) => ({
    domain: hit.domain,
    url: hit.link,
    roundIndex,
    status: "pending",
    retryCount: 0,
  }));
  await emitProgress();

  const crawlConcurrency = positiveIntegerFromEnv(
    "PYTHON_CRAWLER_WORKERS",
    5,
  );
  const configuredCrawlRetries = Number(process.env.PYTHON_CRAWLER_RETRIES);
  const crawlRetries =
    Number.isFinite(configuredCrawlRetries) && configuredCrawlRetries >= 0
      ? Math.floor(configuredCrawlRetries)
      : 2;
  const errors: DiscoveryRun["errors"] = [];
  const companyByDomain = new Map(
    companies.map((company) => [company.domain, company]),
  );
  let successfulCrawls = 0;
  let crawlCacheHits = 0;
  let countryRejected = 0;
  let lastProgressAt = 0;
  const crawled = await mapWithConcurrency(
    newHits,
    crawlConcurrency,
    async (hit): Promise<CompanyCandidate | undefined> => {
      const company = companyByDomain.get(hit.domain);
      if (company) {
        company.status = "crawling";
        company.crawlStartedAt = new Date().toISOString();
      }
      try {
        const candidate = await withRetry(
          () =>
            crawl(hit.link, hit, {
              maxPages: strategy.budget.maxPagesPerCompany,
            }),
          {
            retries: crawlRetries,
            baseDelayMs: 500,
            shouldRetry: isTransientError,
            onRetry: (error, retryNumber, delayMs) => {
              if (company) company.retryCount += 1;
              logger.warn(
                "discovery.round.candidate.retry_scheduled",
                error instanceof Error ? error.message : String(error),
                {
                  roundIndex,
                  domain: hit.domain,
                  retryNumber,
                  delayMs,
                },
              );
            },
          },
        );
        successfulCrawls += 1;
        if (candidate.crawlCacheHit) crawlCacheHits += 1;
        candidate.countryValidation = validateCompanyCountry(
          candidate,
          context.country,
        );
        if (
          candidate.countryValidation.score <
          strategy.validation.minimumCountryScore
        ) {
          candidate.countryValidation.warnings.push(
            `国家一致性 ${candidate.countryValidation.score} 低于策略阈值 ${strategy.validation.minimumCountryScore}；未进入 CompanyAnalysisAgent`,
          );
          countryRejected += 1;
          if (company) {
            company.candidateId = candidate.id;
            company.status = "country_rejected";
            company.crawlCompletedAt = new Date().toISOString();
            company.error = candidate.countryValidation.warnings.at(-1);
          }
          skipped.push({
            url: hit.link,
            reason: `国家一致性 ${candidate.countryValidation.score} 低于策略阈值 ${strategy.validation.minimumCountryScore}`,
          });
          logger.info("discovery.round.candidate.country_rejected", undefined, {
            roundIndex,
            domain: hit.domain,
            score: candidate.countryValidation.score,
            minimumCountryScore: strategy.validation.minimumCountryScore,
          });
          return undefined;
        }
        candidate.contactValidations = await validateContactCandidates(
          candidate,
          context.country,
        );
        if (company) {
          company.candidateId = candidate.id;
          company.status = "pending";
          company.crawlCompletedAt = new Date().toISOString();
        }
        progress.domainCompanyIds[hit.domain.toLowerCase()] = candidate.id;
        return candidate;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "未知抓取错误";
        if (company) {
          company.status = "crawl_failed";
          company.crawlCompletedAt = new Date().toISOString();
          company.error = message;
        }
        errors.push({ url: hit.link, message });
        logger.warn("discovery.round.candidate.failed", message, {
          roundIndex,
          domain: hit.domain,
          url: hit.link,
        });
        return undefined;
      } finally {
        round.crawlSucceeded = successfulCrawls;
        round.crawlFailed = errors.length;
        round.countryRejected = countryRejected;
        round.crawlCacheHits = crawlCacheHits;
        const nowMs = performance.now();
        if (nowMs - lastProgressAt >= 800) {
          lastProgressAt = nowMs;
          await emitProgress();
        }
      }
    },
  );
  const candidates = crawled.filter(
    (candidate): candidate is CompanyCandidate => candidate !== undefined,
  );
  progress.nextQueryIndex = queryIndex + 1;
  progress.executedQueries += 1;
  round.crawlSucceeded = successfulCrawls;
  round.crawlFailed = errors.length;
  round.countryRejected = countryRejected;
  round.crawlCacheHits = crawlCacheHits;
  round.phase = "analyzing";
  await emitProgress();
  logger.info("discovery.round.completed", undefined, {
    roundIndex,
    queryIndex,
    groupId,
    rawHitCount: round.rawHitCount,
    newDomainCount: round.newDomainCount,
    duplicateDomainCount,
    crawlSucceeded: round.crawlSucceeded,
    crawlFailed: round.crawlFailed,
    countryRejected: round.countryRejected,
    crawlCacheHits: round.crawlCacheHits,
    durationMs: Math.round(performance.now() - started),
  });
  return {
    round,
    hits: response.hits,
    skipped,
    errors,
    companies,
    candidates,
  };
}

export async function discoverCompanies(
  input: CampaignInput,
  runtime: AgentRuntime,
  client = new SerperClient(),
  options: DiscoveryOptions = {},
): Promise<DiscoveryServiceResult> {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const requestedQueries = options.maxQueries ?? DEFAULT_SEARCH_QUERIES;
  const maxQueries = Number.isFinite(requestedQueries)
    ? Math.max(1, Math.floor(requestedQueries))
    : DEFAULT_SEARCH_QUERIES;
  const resultsPerQuery = MAX_RESULTS_PER_QUERY;
  const crawlConcurrency = positiveIntegerFromEnv(
    "PYTHON_CRAWLER_WORKERS",
    5,
  );
  const configuredCrawlRetries = Number(process.env.PYTHON_CRAWLER_RETRIES);
  const crawlRetries =
    Number.isFinite(configuredCrawlRetries) && configuredCrawlRetries >= 0
      ? Math.floor(configuredCrawlRetries)
      : 2;
  logger.info("discovery.run.started", undefined, {
    product: input.product,
    country: input.country,
    language: input.language,
    maxQueries,
    resultsPerQuery,
    crawlScope: "all_deduplicated_domains",
    crawlConcurrency,
    crawlRetries,
    maxPagesPerCompany: options.strategy?.budget.maxPagesPerCompany,
    approvedPlan: Boolean(options.approvedPlan),
    extraExcludedDomainCount: options.excludedDomains?.length ?? 0,
    minimumCountryScore: options.minimumCountryScore,
  });
  const planned = options.approvedPlan
    ? {
        context: await buildCampaignAgentContext(input, options.strategy),
        plan: {
          value: options.approvedPlan,
          trace: undefined,
        },
      }
    : await planCampaignSearch(input, runtime);
  if (planned.plan.trace) {
    logger.info("agent.trace.recorded", undefined, planned.plan.trace, {
      agent: planned.plan.trace.agent,
    });
  }
  const allHits: SearchHit[] = [];
  let serpRequests = 0;
  let cacheHits = 0;

  for (const query of planned.plan.value.queries.slice(0, maxQueries)) {
    const response = await client.search(
      query,
      planned.context.country,
      resultsPerQuery,
    );
    allHits.push(...response.hits);
    if (response.cacheHit) cacheHits += 1;
    serpRequests += response.requestCount;
  }

  const deduped = dedupeHits(allHits, options.excludedDomains);
  const crawl = options.crawl ?? crawlCandidate;
  const errors: DiscoveryRun["errors"] = [];
  const companies: NonNullable<DiscoveryRun["companies"]> =
    deduped.accepted.map((hit) => ({
      domain: hit.domain,
      url: hit.link,
      status: "pending",
      retryCount: 0,
    }));
  const companyByDomain = new Map(
    companies.map((company) => [company.domain, company]),
  );
  let lastCrawlCompleted = 0;
  const crawled = await mapWithConcurrency(
    deduped.accepted,
    crawlConcurrency,
    async (hit): Promise<CompanyCandidate | undefined> => {
      const company = companyByDomain.get(hit.domain);
      if (company) {
        company.status = "crawling";
        company.crawlStartedAt = new Date().toISOString();
        company.error = undefined;
      }
      try {
        const candidate = await withRetry(
          () =>
            crawl(hit.link, hit, {
              maxPages: options.strategy?.budget.maxPagesPerCompany,
            }),
          {
            retries: crawlRetries,
            baseDelayMs: 500,
            shouldRetry: isTransientError,
            onRetry: (error, retryNumber, delayMs) => {
              if (company) company.retryCount += 1;
              logger.warn(
                "discovery.candidate.retry_scheduled",
                error instanceof Error ? error.message : String(error),
                {
                  url: hit.link,
                  domain: hit.domain,
                  retryNumber,
                  delayMs,
                },
              );
            },
          },
        );
        candidate.countryValidation = validateCompanyCountry(
          candidate,
          planned.context.country,
        );
        if (
          options.minimumCountryScore !== undefined &&
          candidate.countryValidation.score < options.minimumCountryScore
        ) {
          candidate.countryValidation.warnings.push(
            `国家一致性 ${candidate.countryValidation.score} 低于策略阈值 ${options.minimumCountryScore}；未进入 CompanyAnalysisAgent`,
          );
          if (company) {
            company.candidateId = candidate.id;
            company.status = "country_rejected";
            company.crawlCompletedAt = new Date().toISOString();
            company.error = candidate.countryValidation.warnings.at(-1);
          }
          deduped.skipped.push({
            url: hit.link,
            reason: `国家一致性 ${candidate.countryValidation.score} 低于策略阈值 ${options.minimumCountryScore}`,
          });
          logger.info("discovery.candidate.country_rejected", undefined, {
            domain: hit.domain,
            score: candidate.countryValidation.score,
            minimumCountryScore: options.minimumCountryScore,
          });
          return undefined;
        }
        candidate.contactValidations = await validateContactCandidates(
          candidate,
          planned.context.country,
        );
        if (company) {
          company.candidateId = candidate.id;
          company.status = "pending";
          company.crawlCompletedAt = new Date().toISOString();
        }
        return candidate;
      } catch (error) {
        if (company) {
          company.status = "crawl_failed";
          company.crawlCompletedAt = new Date().toISOString();
          company.error =
            error instanceof Error ? error.message : "未知抓取错误";
        }
        logger.warn(
          "discovery.candidate.skipped",
          error instanceof Error ? error.message : "未知抓取错误",
          {
            url: hit.link,
            domain: hit.domain,
          },
        );
        errors.push({
          url: hit.link,
          message: error instanceof Error ? error.message : "未知抓取错误",
        });
        return undefined;
      }
    },
    ({ active, completed, total }) => {
      if (completed === lastCrawlCompleted) return;
      lastCrawlCompleted = completed;
      logger.info("discovery.crawl.progress", undefined, {
        active,
        completed,
        total,
        crawlConcurrency,
      });
    },
  );
  const candidates = crawled.filter(
    (candidate): candidate is CompanyCandidate => candidate !== undefined,
  );

  const result = {
    context: planned.context,
    candidates,
    discovery: {
      provider: "serper",
      countryId: planned.context.country.id,
      plan: planned.plan.value,
      hits: allHits,
      skipped: deduped.skipped,
      errors,
      serpRequests,
      cacheHits,
      companies,
      planningTrace: planned.plan.trace,
      startedAt,
      completedAt: new Date().toISOString(),
    },
  } satisfies DiscoveryServiceResult;
  logger.info("discovery.run.completed", undefined, {
    plannedQueries: planned.plan.value.queries.length,
    executedQueries: Math.min(
      planned.plan.value.queries.length,
      maxQueries,
    ),
    searchHitCount: allHits.length,
    deduplicatedCount: deduped.accepted.length,
    skippedCount: deduped.skipped.length,
    candidateCount: candidates.length,
    errorCount: errors.length,
    searchRequests: serpRequests,
    cacheHits,
    durationMs: Math.round(performance.now() - started),
  });
  return result;
}
