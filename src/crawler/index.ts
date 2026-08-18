import { createHash, randomUUID } from "node:crypto";
import { getDomain } from "tldts";
import type { CompanyCandidate, SearchHit } from "../domain.js";
import { getCrawler, type CrawlerOptions } from "./crawl.js";
import { logger } from "../logging/logger.js";
import { getDatabase } from "../storage/database.js";

export type { CrawlerOptions } from "./crawl.js";

const inFlightCrawls = new Map<string, Promise<CompanyCandidate>>();

function regexCleaningEnabled(options?: CrawlerOptions): boolean {
  if (options?.enableRegexCleaning !== undefined) {
    return options.enableRegexCleaning;
  }
  const configured = process.env.CRAWLER_REGEX_CLEANING?.trim().toLowerCase();
  return !configured || !["false", "0", "off", "no"].includes(configured);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : fallback;
}

export function crawlerCacheKey(
  input: string,
  options?: CrawlerOptions,
): string | undefined {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    const domain = getDomain(hostname) ?? hostname;
    const configuration = JSON.stringify({
      version: 4,
      domain,
      maxPages: positiveInteger(options?.maxPages, 20),
      regexCleaning: regexCleaningEnabled(options),
    });
    return `crawl:${createHash("sha256").update(configuration).digest("hex")}`;
  } catch {
    return undefined;
  }
}

function crawlCacheTtlMs(): number {
  const configuredDays = Number(process.env.CRAWLER_CACHE_TTL_DAYS);
  const days =
    Number.isFinite(configuredDays) && configuredDays > 0
      ? configuredDays
      : 7;
  return days * 24 * 60 * 60 * 1_000;
}

export async function crawlCandidate(
  input: string,
  searchHit?: SearchHit,
  options?: CrawlerOptions,
): Promise<CompanyCandidate> {
  const normalizedOptions: CrawlerOptions = {
    ...options,
    maxPages: positiveInteger(options?.maxPages, 20),
    enableRegexCleaning: regexCleaningEnabled(options),
  };
  const cacheKey = crawlerCacheKey(input, normalizedOptions);
  if (cacheKey) {
    const cached = getDatabase().getSearchCache<CompanyCandidate>(cacheKey);
    if (cached) {
      logger.info("crawler.cache_hit", undefined, {
        domain: cached.domain,
        pageCount: cached.pages.length,
        maxPages: normalizedOptions.maxPages,
      });
      return {
        ...structuredClone(cached),
        id: randomUUID(),
        searchSnippet: searchHit?.snippet ?? cached.searchSnippet,
        searchHit,
        crawlCacheHit: true,
      };
    }
    const activeCrawl = inFlightCrawls.get(cacheKey);
    if (activeCrawl) {
      const shared = await activeCrawl;
      logger.info("crawler.inflight_reused", undefined, {
        domain: shared.domain,
        pageCount: shared.pages.length,
      });
      return {
        ...structuredClone(shared),
        id: randomUUID(),
        searchSnippet: searchHit?.snippet ?? shared.searchSnippet,
        searchHit,
        crawlCacheHit: true,
      };
    }
  }
  const crawlPromise = getCrawler().crawl(
    input,
    searchHit,
    normalizedOptions,
  );
  if (cacheKey) inFlightCrawls.set(cacheKey, crawlPromise);
  try {
    const candidate = { ...(await crawlPromise), crawlCacheHit: false };
    if (cacheKey) {
      getDatabase().putSearchCache(cacheKey, candidate, crawlCacheTtlMs());
    }
    return candidate;
  } finally {
    if (cacheKey) inFlightCrawls.delete(cacheKey);
  }
}
