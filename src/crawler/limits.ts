function boundedPositiveEnv(
  names: readonly string[],
  fallback: number,
  maximum: number,
): number {
  for (const name of names) {
    const raw = process.env[name];
    if (!raw?.trim()) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    return Math.min(maximum, Math.max(1, Math.floor(parsed)));
  }
  return fallback;
}

export function crawlerMaxHtmlBytes(): number {
  return boundedPositiveEnv(
    ["CRAWLER_MAX_HTML_BYTES", "PYTHON_CRAWLER_MAX_HTML_BYTES"],
    4_000_000,
    10_000_000,
  );
}

export function crawlerDomainDeadlineMs(): number {
  return (
    boundedPositiveEnv(
      [
        "CRAWLER_DOMAIN_DEADLINE_SECONDS",
        "PYTHON_CRAWLER_DOMAIN_DEADLINE_SECONDS",
      ],
      75,
      110,
    ) * 1_000
  );
}

export function crawlerRequestTimeoutMs(): number {
  return boundedPositiveEnv(
    ["CRAWLER_TIMEOUT_MS", "PYTHON_CRAWLER_TIMEOUT_MS"],
    120_000,
    300_000,
  );
}

export function crawlerWorkerCount(): number {
  return boundedPositiveEnv(
    ["CRAWLER_WORKERS", "PYTHON_CRAWLER_WORKERS"],
    5,
    32,
  );
}

export function crawlerRetryCount(): number {
  for (const name of ["CRAWLER_RETRIES", "PYTHON_CRAWLER_RETRIES"]) {
    const raw = process.env[name];
    if (!raw?.trim()) continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) continue;
    return Math.floor(parsed);
  }
  return 2;
}

export const MAX_REDIRECTS = 3;
export const DEFAULT_MAX_PAGES = 20;
export const USER_AGENT =
  "TradeRadarFlow/0.2 (+single-user public company research)";
export const CONNECT_TIMEOUT_MS = 6_000;
export const BODY_TIMEOUT_MS = 15_000;
