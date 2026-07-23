import { createHash } from "node:crypto";
import { getDomain } from "tldts";
import type {
  CountryProfile,
  SearchHit,
  SearchQuery,
} from "../domain.js";
import type { AppDatabase } from "../storage/database.js";
import { getDatabase } from "../storage/database.js";
import { logger } from "../logging/logger.js";

interface SerperOrganicResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerperResponse {
  message?: string;
  organic?: SerperOrganicResult[];
}

export interface SerperSearchResult {
  hits: SearchHit[];
  cacheHit: boolean;
  requestCount: number;
}

export interface SerperClientOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  database?: AppDatabase;
  cacheTtlMs?: number;
}

export class SerperClient {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly database: AppDatabase;
  private readonly cacheTtlMs: number;

  constructor(options: SerperClientOptions = {}) {
    this.apiKey =
      options.apiKey ??
      process.env.SERPER_API_KEY ??
      process.env.SERPAPI_API_KEY ??
      "";
    this.fetchFn = options.fetchFn ?? fetch;
    this.database = options.database ?? getDatabase();
    this.cacheTtlMs = options.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  private cacheKey(
    query: SearchQuery,
    country: CountryProfile,
    num: number,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          provider: "serper",
          q: query.query,
          language: query.language,
          gl: country.gl,
          location: country.location,
          num,
        }),
      )
      .digest("hex");
  }

  async search(
    query: SearchQuery,
    country: CountryProfile,
    num = 10,
  ): Promise<SerperSearchResult> {
    if (!this.apiKey) {
      throw new Error(
        "缺少 SERPER_API_KEY（兼容 SERPAPI_API_KEY），无法执行真实搜索",
      );
    }
    const boundedNum = Math.max(1, Math.min(num, 100));
    const cacheKey = this.cacheKey(query, country, boundedNum);
    const cached = this.database.getSearchCache<SearchHit[]>(cacheKey);
    if (cached) {
      logger.info("search.serper.cache_hit", undefined, {
        cacheKey: cacheKey.slice(0, 12),
        query: query.query,
        countryId: country.id,
        requestedResults: boundedNum,
        hitCount: cached.length,
      });
      return { hits: cached, cacheHit: true, requestCount: 0 };
    }

    const started = performance.now();
    const language = /^[a-z]{2}$/i.test(query.language)
      ? query.language.toLowerCase()
      : country.defaultHl;
    const hasAdvancedExclusions = /(?:^|\s)-(?:site:|")/iu.test(query.query);
    // Serper free accounts may reject quoted/operator queries with num > 10,
    // and plain num=100 responses still expose only one result page. Always
    // page in free-compatible chunks so requested coverage is real and stable.
    const freeCompatiblePageSize = Math.min(boundedNum, 10);
    const plannedPages = Math.ceil(boundedNum / freeCompatiblePageSize);
    logger.info("search.serper.started", undefined, {
      query: query.query,
      countryId: country.id,
      gl: country.gl,
      language,
      location: country.location,
      requestedResults: boundedNum,
      pageSize: freeCompatiblePageSize,
      plannedPages,
      advancedExclusions: hasAdvancedExclusions,
    });
    let requestCount = 0;
    const hitsByLink = new Map<string, SearchHit>();
    for (let page = 1; page <= plannedPages; page += 1) {
      let response: Response;
      try {
        requestCount += 1;
        response = await this.fetchFn("https://google.serper.dev/search", {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify({
            q: query.query,
            gl: country.gl,
            hl: language,
            location: country.location,
            num: freeCompatiblePageSize,
            ...(page > 1 ? { page } : {}),
          }),
        });
      } catch (error) {
        logger.error("search.serper.network_failed", error, {
          query: query.query,
          countryId: country.id,
          page,
          durationMs: Math.round(performance.now() - started),
        });
        throw error;
      }
      const payload = (await response.json().catch(() => ({}))) as SerperResponse;
      if (!response.ok) {
        logger.warn("search.serper.http_failed", payload.message, {
          query: query.query,
          countryId: country.id,
          statusCode: response.status,
          page,
          pageSize: freeCompatiblePageSize,
          durationMs: Math.round(performance.now() - started),
        });
        throw new Error(
          `Serper 请求失败：HTTP ${response.status}${
            payload.message ? `（${payload.message}）` : ""
          }`,
        );
      }
      if (payload.message) {
        throw new Error(`Serper 返回错误：${payload.message}`);
      }

      for (const [index, item] of (payload.organic ?? []).entries()) {
        if (!item.link || !item.title) continue;
        let hostname: string;
        try {
          hostname = new URL(item.link).hostname;
        } catch {
          continue;
        }
        const domain = getDomain(hostname) ?? hostname.replace(/^www\./, "");
        hitsByLink.set(item.link, {
          query: query.query,
          position:
            item.position ?? (page - 1) * freeCompatiblePageSize + index + 1,
          title: item.title,
          link: item.link,
          snippet: item.snippet ?? "",
          displayedLink: hostname,
          domain,
        });
      }
      if ((payload.organic ?? []).length === 0) break;
    }
    const hits = [...hitsByLink.values()].slice(0, boundedNum);
    this.database.putSearchCache(cacheKey, hits, this.cacheTtlMs);
    logger.info("search.serper.completed", undefined, {
      query: query.query,
      countryId: country.id,
      requestedResults: boundedNum,
      hitCount: hits.length,
      requestCount,
      paginated: plannedPages > 1,
      domains: hits.slice(0, 20).map((hit) => hit.domain),
      durationMs: Math.round(performance.now() - started),
      cacheKey: cacheKey.slice(0, 12),
    });
    return { hits, cacheHit: false, requestCount };
  }
}
