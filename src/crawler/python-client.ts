import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import type { CompanyCandidate, SearchHit } from "../domain.js";
import {
  getLogContext,
  logger,
  type LogContext,
} from "../logging/logger.js";

interface WorkerResponse {
  id: string;
  ok: boolean;
  result?: CompanyCandidate;
  error?: string;
}

interface WorkerLog {
  level?: "debug" | "info" | "warn" | "error";
  event?: string;
  data?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (candidate: CompanyCandidate) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  startedAt: number;
  url: string;
  context: LogContext;
}

export interface CrawlerOptions {
  enableRegexCleaning?: boolean;
  maxPages?: number;
}

function regexCleaningDefault(): boolean {
  const configured = process.env.CRAWLER_REGEX_CLEANING?.trim().toLowerCase();
  return !configured || !["false", "0", "off", "no"].includes(configured);
}

export class PythonCrawlerClient {
  private process?: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();

  private start(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) return this.process;
    const script = path.join(
      process.cwd(),
      "python",
      "crawler_worker.py",
    );
    const configuredPython = process.env.PYTHON_CRAWLER_PYTHON;
    const command =
      configuredPython ?? (process.platform === "win32" ? "conda.exe" : "python3");
    const args = configuredPython
      ? ["-u", script]
      : process.platform === "win32"
        ? [
            "run",
            "--no-capture-output",
            "-n",
            process.env.PYTHON_CRAWLER_ENV ?? "trade-radar-flow",
            "python",
            "-u",
            script,
          ]
        : ["-u", script];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    logger.info("crawler.python.process_started", undefined, {
      command,
      environment: process.env.PYTHON_CRAWLER_ENV ?? "trade-radar-flow",
      script,
      processId: child.pid,
    });
    this.process = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    const errorLines = readline.createInterface({ input: child.stderr });
    errorLines.on("line", (message) => {
      if (!message.trim()) return;
      try {
        const workerLog = JSON.parse(message) as WorkerLog;
        const event = `crawler.python.worker.${workerLog.event ?? "message"}`;
        const data = { processId: child.pid, ...workerLog.data };
        if (workerLog.level === "error") {
          logger.error(
            event,
            new Error(String(workerLog.data?.error ?? "Python 爬虫错误")),
            data,
          );
        } else if (workerLog.level === "warn") {
          logger.warn(event, undefined, data);
        } else {
          logger.info(event, undefined, data);
        }
      } catch {
        logger.warn("crawler.python.stderr", message, {
          processId: child.pid,
        });
      }
    });
    child.on("error", (error) => {
      logger.error("crawler.python.process_error", error, {
        processId: child.pid,
      });
      this.failAll(error);
    });
    child.on("exit", (code) => {
      this.process = undefined;
      logger.info("crawler.python.process_exited", undefined, {
        processId: child.pid,
        exitCode: code,
        pendingRequests: this.pending.size,
      });
      if (code !== 0) {
        this.failAll(new Error(`Python 爬虫进程退出：${code ?? "unknown"}`));
      }
    });
    return child;
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      return;
    }
    const request = this.pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(response.id);
    if (response.ok && response.result) {
      logger.info(
        "crawler.python.completed",
        undefined,
        {
          requestId: response.id,
          url: request.url,
          domain: response.result.domain,
          pageCount: response.result.pages.length,
          contactCandidateCount:
            response.result.contactCandidates.length,
          durationMs: Math.round(performance.now() - request.startedAt),
        },
        request.context,
      );
      request.resolve(response.result);
    } else {
      const error = new Error(
        response.error ?? "Python 爬虫返回未知错误",
      );
      logger.error(
        "crawler.python.failed",
        error,
        {
          requestId: response.id,
          url: request.url,
          durationMs: Math.round(performance.now() - request.startedAt),
        },
        request.context,
      );
      request.reject(error);
    }
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  crawl(
    url: string,
    searchHit?: SearchHit,
    options: CrawlerOptions = {},
  ): Promise<CompanyCandidate> {
    const child = this.start();
    const id = randomUUID();
    const startedAt = performance.now();
    const context = getLogContext();
    const enableRegexCleaning =
      options.enableRegexCleaning ?? regexCleaningDefault();
    const maxPages =
      Number.isFinite(options.maxPages) && Number(options.maxPages) > 0
        ? Math.floor(Number(options.maxPages))
        : undefined;
    logger.info(
      "crawler.python.started",
      undefined,
      {
        requestId: id,
        url,
        searchDomain: searchHit?.domain,
        searchPosition: searchHit?.position,
        regexCleaning: enableRegexCleaning,
        maxPages,
      },
      context,
    );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error("Python 爬虫请求超时");
        logger.error(
          "crawler.python.timeout",
          error,
          {
            requestId: id,
            url,
            durationMs: Math.round(performance.now() - startedAt),
          },
          context,
        );
        reject(error);
      }, Number(process.env.PYTHON_CRAWLER_TIMEOUT_MS) || 120_000);
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        startedAt,
        url,
        context,
      });
      child.stdin.write(
        `${JSON.stringify({
          id,
          method: "crawl",
          params: { url, searchHit, enableRegexCleaning, maxPages },
        })}\n`,
      );
    });
  }

  dispose(): void {
    this.process?.kill();
    this.process = undefined;
  }
}

export class PythonCrawlerPool {
  private readonly workers: PythonCrawlerClient[];
  private nextWorker = 0;

  constructor(workerCount = 5) {
    const count = Math.max(1, Math.floor(workerCount));
    this.workers = Array.from(
      { length: count },
      () => new PythonCrawlerClient(),
    );
  }

  crawl(
    url: string,
    searchHit?: SearchHit,
    options?: CrawlerOptions,
  ): Promise<CompanyCandidate> {
    const worker = this.workers[this.nextWorker % this.workers.length];
    this.nextWorker += 1;
    if (!worker) throw new Error("Python 爬虫池没有可用 worker");
    return worker.crawl(url, searchHit, options);
  }

  dispose(): void {
    for (const worker of this.workers) worker.dispose();
  }
}

let singleton: PythonCrawlerPool | undefined;

export function getPythonCrawler(): PythonCrawlerPool {
  const parsed = Number(process.env.PYTHON_CRAWLER_WORKERS);
  const workerCount =
    Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
  singleton ??= new PythonCrawlerPool(workerCount);
  return singleton;
}
