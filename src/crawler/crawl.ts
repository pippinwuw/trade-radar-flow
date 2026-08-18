import { randomUUID } from "node:crypto";
import type { CompanyCandidate, SearchHit } from "../domain.js";
import { logger } from "../logging/logger.js";
import {
  crawlerDomainDeadlineMs,
  crawlerRequestTimeoutMs,
  crawlerWorkerCount,
  DEFAULT_MAX_PAGES,
} from "./limits.js";
import {
  extractContacts,
  homepageUrl,
  normalizedPageUrl,
  parsePage,
} from "./extract.js";
import { fetchHtml } from "./fetch-html.js";

export interface CrawlerOptions {
  enableRegexCleaning?: boolean;
  maxPages?: number;
}

type FetchedPage = {
  page: { url: string; title: string; text: string };
  links: Array<readonly [number, string]>;
};

async function cleanPage(
  url: string,
  enableRegexCleaning: boolean,
): Promise<FetchedPage> {
  const fetched = await fetchHtml(url);
  const parsed = parsePage(fetched.html, fetched.finalUrl, enableRegexCleaning);
  return {
    page: {
      ...parsed.page,
      url: normalizedPageUrl(parsed.page.url),
    },
    links: parsed.links,
  };
}

export async function crawlSite(
  url: string,
  searchHit?: SearchHit,
  options: CrawlerOptions = {},
): Promise<CompanyCandidate> {
  const started = performance.now();
  const enableRegexCleaning = options.enableRegexCleaning ?? true;
  const maxPages =
    Number.isFinite(options.maxPages) && Number(options.maxPages) > 0
      ? Math.floor(Number(options.maxPages))
      : DEFAULT_MAX_PAGES;
  if (maxPages < 1) throw new Error("maxPages 必须是正整数");
  logger.info("crawler.started", undefined, {
    url,
    regexCleaning: enableRegexCleaning,
    maxPages,
  });

  let first: FetchedPage;
  try {
    first = await cleanPage(url, enableRegexCleaning);
  } catch (initialError) {
    const fallbackUrl = homepageUrl(url);
    if (fallbackUrl === normalizedPageUrl(url)) throw initialError;
    logger.warn("crawler.initial_page_fallback", undefined, {
      url,
      fallbackUrl,
      error:
        initialError instanceof Error
          ? initialError.message
          : String(initialError),
    });
    first = await cleanPage(fallbackUrl, enableRegexCleaning);
  }

  const pages = [first.page];
  const attempted = new Set([first.page.url]);
  const captured = new Set([first.page.url]);
  const rootUrl = homepageUrl(first.page.url);
  const queue: Array<readonly [number, string]> = [...first.links];
  if (!attempted.has(rootUrl)) queue.push([110, rootUrl]);

  const deadlineMs = crawlerDomainDeadlineMs();
  let deadlineReached = false;
  while (queue.length && pages.length < maxPages) {
    if (performance.now() - started >= deadlineMs) {
      deadlineReached = true;
      logger.warn("crawler.deadline_reached", undefined, {
        url: first.page.url,
        pageCount: pages.length,
        deadlineSeconds: Math.round(deadlineMs / 1000),
      });
      break;
    }
    queue.sort((left, right) => right[0] - left[0] || left[1].localeCompare(right[1]));
    const next = queue.shift();
    if (!next) break;
    const [, link] = next;
    if (attempted.has(link)) continue;
    attempted.add(link);
    try {
      const discovered = await cleanPage(link, enableRegexCleaning);
      if (!captured.has(discovered.page.url)) {
        captured.add(discovered.page.url);
        pages.push(discovered.page);
      }
      for (const item of discovered.links) {
        if (!attempted.has(item[1])) queue.push(item);
      }
    } catch (error) {
      logger.warn("crawler.page_skipped", undefined, {
        url: link,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const homepage = first.page.url;
  const domain = new URL(homepage).hostname.toLowerCase().replace(/^www\./u, "");
  const snippet =
    typeof searchHit?.snippet === "string" ? searchHit.snippet : "";
  const contactCandidates = extractContacts(pages);
  const result: CompanyCandidate = {
    id: randomUUID(),
    homepage,
    domain,
    searchSnippet: snippet || first.page.text.slice(0, 280),
    pages,
    contactCandidates,
    searchHit,
    crawlWarnings: deadlineReached
      ? [
          `Reached safe crawl deadline after ${Math.round(deadlineMs / 1000)}s; retained partial pages.`,
        ]
      : [],
  };
  logger.info("crawler.completed", undefined, {
    domain,
    pageCount: pages.length,
    contactCandidateCount: contactCandidates.length,
    regexCleaning: enableRegexCleaning,
    durationMs: Math.round(performance.now() - started),
    deadlineReached,
  });
  return result;
}

class CrawlerPool {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async crawl(
    url: string,
    searchHit?: SearchHit,
    options?: CrawlerOptions,
  ): Promise<CompanyCandidate> {
    await this.acquire();
    const timeoutMs = crawlerRequestTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        crawlSite(url, searchHit, options),
        new Promise<CompanyCandidate>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("官网抓取请求超时"));
          }, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiting.shift();
    if (next) next();
  }
}

let singleton: CrawlerPool | undefined;

export function getCrawler(): CrawlerPool {
  singleton ??= new CrawlerPool(crawlerWorkerCount());
  return singleton;
}
