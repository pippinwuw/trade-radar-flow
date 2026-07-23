export interface ConcurrencyStats {
  active: number;
  completed: number;
  total: number;
}

export class OperationTimeoutError extends Error {
  readonly code = "ETIMEDOUT";

  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  requestedConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (stats: ConcurrencyStats) => void,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.min(
    items.length,
    Math.max(1, Math.floor(requestedConcurrency)),
  );
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let active = 0;
  let completed = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      active += 1;
      onProgress?.({ active, completed, total: items.length });
      try {
        results[index] = await worker(item, index);
      } finally {
        active -= 1;
        completed += 1;
        onProgress?.({ active, completed, total: items.length });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

export function positiveIntegerFromEnv(
  name: string,
  fallback: number,
): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (error: unknown, retryNumber: number, delayMs: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const retries = Math.max(0, Math.floor(options.retries));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= retries ||
        (options.shouldRetry && !options.shouldRetry(error))
      ) {
        throw error;
      }
      const retryNumber = attempt + 1;
      const delayMs = baseDelayMs * 2 ** attempt;
      options.onRetry?.(error, retryNumber, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof OperationTimeoutError) return true;
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /(?:408|425|429|500|502|503|504|rate.?limit|timeout|timed out|temporar|overload|econn|enet|eai_again|getaddrinfo|name resolution|fetch failed|network|socket|aborted?|超时|域名解析|服务暂不可用)/i.test(
    message,
  );
}
