import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getLogDirectory,
  type LogRecord,
} from "../src/logging/logger.js";

interface EventSummary {
  event: string;
  count: number;
}

export interface LogSummary {
  generatedAt: string;
  sourceFiles: string[];
  period: { from?: string; to?: string };
  totalRecords: number;
  levels: Record<string, number>;
  events: EventSummary[];
  http: {
    requests: number;
    failed: number;
    averageDurationMs: number;
    maximumDurationMs: number;
    statusCodes: Record<string, number>;
  };
  agents: {
    completed: number;
    failed: number;
    averageDurationMs: number;
    byAgent: Record<string, number>;
  };
  search: {
    requests: number;
    cacheHits: number;
    returnedHits: number;
    failed: number;
  };
  crawler: {
    completed: number;
    failed: number;
    cacheHits: number;
    averageDurationMs: number;
    pages: number;
    contactCandidates: number;
  };
  campaigns: {
    completed: number;
    leads: number;
    qualified: number;
    needsReview: number;
    rejected: number;
    analysisFailures: number;
    retries: number;
  };
  orchestrator: {
    sessionsCreated: number;
    chatsCompleted: number;
    strategiesApproved: number;
    executionsCompleted: number;
    executionsFailed: number;
  };
  recentErrors: Array<{
    timestamp: string;
    event: string;
    message?: string;
    requestId?: string;
    sessionId?: string;
    campaignId?: string;
  }>;
}

function numberData(record: LogRecord, key: string): number {
  const value = (record.data as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : 0;
}

function average(values: number[]): number {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

export function summarizeRecords(
  records: LogRecord[],
  sourceFiles: string[] = [],
): LogSummary {
  const sorted = [...records].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const levels: Record<string, number> = {};
  const eventCounts = new Map<string, number>();
  for (const record of sorted) {
    levels[record.level] = (levels[record.level] ?? 0) + 1;
    eventCounts.set(record.event, (eventCounts.get(record.event) ?? 0) + 1);
  }
  const event = (name: string) =>
    sorted.filter((record) => record.event === name);
  const httpCompleted = event("http.request.completed");
  const agentCompleted = [
    ...event("agent.trace.recorded"),
    ...event("orchestrator.agent.completed"),
  ];
  const agentFailed = [
    ...event("agent.run.failed"),
    ...event("orchestrator.agent.failed"),
  ];
  const crawlerCompleted = event("crawler.completed");
  const campaignCompleted = event("pipeline.campaign.completed");

  return {
    generatedAt: new Date().toISOString(),
    sourceFiles,
    period: {
      from: sorted[0]?.timestamp,
      to: sorted.at(-1)?.timestamp,
    },
    totalRecords: sorted.length,
    levels,
    events: [...eventCounts.entries()]
      .map(([eventName, count]) => ({ event: eventName, count }))
      .sort((left, right) => right.count - left.count),
    http: {
      requests: httpCompleted.length,
      failed: httpCompleted.filter(
        (record) => numberData(record, "statusCode") >= 400,
      ).length,
      averageDurationMs: average(
        httpCompleted.map((record) => numberData(record, "durationMs")),
      ),
      maximumDurationMs: Math.max(
        0,
        ...httpCompleted.map((record) => numberData(record, "durationMs")),
      ),
      statusCodes: Object.fromEntries(
        [...new Set(httpCompleted.map((record) => numberData(record, "statusCode")))]
          .sort()
          .map((status) => [
            String(status),
            httpCompleted.filter(
              (record) => numberData(record, "statusCode") === status,
            ).length,
          ]),
      ),
    },
    agents: {
      completed: agentCompleted.length,
      failed: agentFailed.length,
      averageDurationMs: average(
        agentCompleted.map((record) => numberData(record, "durationMs")),
      ),
      byAgent: Object.fromEntries(
        [...new Set(agentCompleted.map((record) => String(record.agent ?? "unknown")))]
          .sort()
          .map((agent) => [
            agent,
            agentCompleted.filter((record) => record.agent === agent).length,
          ]),
      ),
    },
    search: {
      requests: event("search.serper.completed").length,
      cacheHits: event("search.serper.cache_hit").length,
      returnedHits: event("search.serper.completed").reduce(
        (sum, record) => sum + numberData(record, "hitCount"),
        0,
      ),
      failed:
        event("search.serper.network_failed").length +
        event("search.serper.http_failed").length,
    },
    crawler: {
      completed: crawlerCompleted.length,
      failed:
        event("crawler.page_skipped").length,
      cacheHits:
        event("crawler.cache_hit").length +
        event("crawler.inflight_reused").length,
      averageDurationMs: average(
        crawlerCompleted.map((record) => numberData(record, "durationMs")),
      ),
      pages: crawlerCompleted.reduce(
        (sum, record) => sum + numberData(record, "pageCount"),
        0,
      ),
      contactCandidates: crawlerCompleted.reduce(
        (sum, record) => sum + numberData(record, "contactCandidateCount"),
        0,
      ),
    },
    campaigns: {
      completed: campaignCompleted.length,
      leads: campaignCompleted.reduce(
        (sum, record) => sum + numberData(record, "leadCount"),
        0,
      ),
      qualified: campaignCompleted.reduce(
        (sum, record) => sum + numberData(record, "qualified"),
        0,
      ),
      needsReview: campaignCompleted.reduce(
        (sum, record) => sum + numberData(record, "needsReview"),
        0,
      ),
      rejected: campaignCompleted.reduce(
        (sum, record) => sum + numberData(record, "rejected"),
        0,
      ),
      analysisFailures: campaignCompleted.reduce(
        (sum, record) => sum + numberData(record, "analysisFailures"),
        0,
      ),
      retries:
        event("pipeline.candidate.retry_scheduled").length +
        event("discovery.candidate.retry_scheduled").length,
    },
    orchestrator: {
      sessionsCreated: event("orchestrator.session.created").length,
      chatsCompleted: event("orchestrator.chat.completed").length,
      strategiesApproved: event("orchestrator.strategy.approved").length,
      executionsCompleted: event("orchestrator.execution.completed").length,
      executionsFailed: event("orchestrator.execution.failed").length,
    },
    recentErrors: sorted
      .filter(
        (record) =>
          record.level === "error" ||
          (record.event === "http.request.completed" &&
            numberData(record, "statusCode") >= 500),
      )
      .slice(-20)
      .reverse()
      .map((record) => ({
        timestamp: record.timestamp,
        event: record.event,
        message: record.error?.message ?? record.message,
        requestId: record.requestId,
        sessionId: record.sessionId,
        campaignId: record.campaignId,
      })),
  };
}

export function renderMarkdown(summary: LogSummary): string {
  const lines = [
    "# Trade Radar Flow 日志报告",
    "",
    `- 生成时间：${summary.generatedAt}`,
    `- 日志范围：${summary.period.from ?? "无"} — ${summary.period.to ?? "无"}`,
    `- 记录总数：${summary.totalRecords}`,
    `- 错误数：${summary.levels.error ?? 0}`,
    "",
    "## 核心流程",
    "",
    `- HTTP：${summary.http.requests} 次，失败 ${summary.http.failed} 次，平均 ${summary.http.averageDurationMs}ms，最大 ${summary.http.maximumDurationMs}ms`,
    `- Agent：成功 ${summary.agents.completed} 次，失败 ${summary.agents.failed} 次，平均 ${summary.agents.averageDurationMs}ms`,
    `- Serper：请求 ${summary.search.requests} 次，缓存 ${summary.search.cacheHits} 次，返回 ${summary.search.returnedHits} 条`,
    `- 爬虫：成功 ${summary.crawler.completed} 次，缓存复用 ${summary.crawler.cacheHits} 次，失败 ${summary.crawler.failed} 次，页面 ${summary.crawler.pages} 个，联系人候选 ${summary.crawler.contactCandidates} 个`,
    `- Campaign：完成 ${summary.campaigns.completed} 次，线索 ${summary.campaigns.leads} 条，建议触达 ${summary.campaigns.qualified} 条，待复核 ${summary.campaigns.needsReview} 条，淘汰 ${summary.campaigns.rejected} 条，分析失败 ${summary.campaigns.analysisFailures} 条，重试 ${summary.campaigns.retries} 次`,
    `- 主 Agent：会话 ${summary.orchestrator.sessionsCreated}，对话 ${summary.orchestrator.chatsCompleted}，批准 ${summary.orchestrator.strategiesApproved}，执行成功 ${summary.orchestrator.executionsCompleted}，执行失败 ${summary.orchestrator.executionsFailed}`,
    "",
    "## Agent 调用",
    "",
    ...Object.entries(summary.agents.byAgent).map(
      ([agent, count]) => `- ${agent}: ${count}`,
    ),
    "",
    "## 最近错误",
    "",
    ...(summary.recentErrors.length
      ? summary.recentErrors.map(
          (error) =>
            `- ${error.timestamp} · ${error.event} · ${error.message ?? "无错误信息"} · request=${error.requestId ?? "-"} session=${error.sessionId ?? "-"} campaign=${error.campaignId ?? "-"}`,
        )
      : ["- 无"]),
    "",
    "## 高频事件",
    "",
    ...summary.events
      .slice(0, 20)
      .map((item) => `- ${item.event}: ${item.count}`),
    "",
  ];
  return lines.join("\n");
}

async function readRecords(files: string[]): Promise<LogRecord[]> {
  const records: LogRecord[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as LogRecord);
      } catch {
        // Keep report generation resilient to a partially written final line.
      }
    }
  }
  return records;
}

async function main(): Promise<void> {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const requestedDate = dateArg?.slice("--date=".length);
  const directory = getLogDirectory();
  const names = (await readdir(directory))
    .filter(
      (name) =>
        /^trade-radar-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) &&
        (!requestedDate || name.includes(requestedDate)),
    )
    .sort();
  const files = names.map((name) => path.join(directory, name));
  const summary = summarizeRecords(await readRecords(files), names);
  const markdown = renderMarkdown(summary);
  const reportDirectory = path.join(directory, "reports");
  await mkdir(reportDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const markdownPath = path.join(reportDirectory, `log-report-${stamp}.md`);
  const jsonPath = path.join(reportDirectory, `log-report-${stamp}.json`);
  await Promise.all([
    writeFile(markdownPath, markdown, "utf8"),
    writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8"),
  ]);
  process.stdout.write(
    `${markdown}\n报告已写入：\n- ${markdownPath}\n- ${jsonPath}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
