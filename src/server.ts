import { randomUUID } from "node:crypto";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  buildCampaignWorkbook,
  campaignExportFilename,
  projectCampaignExport,
  serializeCampaignJson,
} from "./campaign-export.js";
import { crawlCandidate } from "./crawler.js";
import { listCountryProfiles } from "./countries/registry.js";
import type {
  CampaignInput,
  CampaignStrategy,
  LeadStatus,
  MarketPolicy,
} from "./domain.js";
import { saveMarketPolicyDraft } from "./market-policy.js";
import { getOrchestratorService } from "./orchestrator/service.js";
import { logger, runWithLogContext } from "./logging/logger.js";
import { OperationTimeoutError } from "./concurrency.js";
import {
  getAgentRuntime,
  getCampaign,
  listCampaigns,
  runManualCampaign,
  runOfflineSampleCampaign,
  runSearchCampaign,
  updateLeadStatus,
} from "./pipeline.js";

const app = express();
const port = Number(process.env.PORT ?? 3210);
const publicDirectory = path.join(process.cwd(), "public");

app.use((request, response, next) => {
  const requestId =
    (typeof request.headers["x-request-id"] === "string"
      ? request.headers["x-request-id"]
      : undefined) ?? randomUUID();
  response.setHeader("x-request-id", requestId);
  const started = performance.now();
  runWithLogContext({ requestId }, () => {
    if (request.path.startsWith("/api/")) {
      logger.info("http.request.started", undefined, {
        method: request.method,
        path: request.path,
        contentLength: request.headers["content-length"],
        userAgent: request.headers["user-agent"],
      });
    }
    response.on("finish", () => {
      if (request.path.startsWith("/api/")) {
        logger.info("http.request.completed", undefined, {
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Math.round(performance.now() - started),
        });
      }
    });
    next();
  });
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDirectory));

function campaignInput(body: unknown): CampaignInput {
  const value =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  return {
    product:
      typeof value.product === "string" && value.product.trim()
        ? value.product.trim()
        : "industrial fabrics",
    country:
      typeof value.country === "string" && value.country.trim()
        ? value.country.trim()
        : "United Arab Emirates",
    language:
      typeof value.language === "string" && value.language.trim()
        ? value.language.trim()
        : "English",
  };
}

function setExportHeaders(
  response: Response,
  filename: string,
  leadCount: number,
): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-exported-lead-count", String(leadCount));
  response.setHeader(
    "content-disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    agentMode: getAgentRuntime().mode,
    searchConfigured: Boolean(
      process.env.SERPER_API_KEY ?? process.env.SERPAPI_API_KEY,
    ),
    supportedCountries: listCountryProfiles().map((country) => country.id),
    version: "0.1.0",
  });
});

app.get("/api/countries", (_request, response) => {
  response.json(listCountryProfiles());
});

app.post("/api/client-logs", (request, response) => {
  const body =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {};
  const event =
    typeof body.event === "string"
      ? body.event.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80)
      : "unknown";
  logger.warn(`frontend.${event}`, "浏览器端事件", {
    path: typeof body.path === "string" ? body.path : undefined,
    data: body.data,
  });
  response.status(204).end();
});

app.get("/api/orchestrator/sessions", (_request, response) => {
  response.json(getOrchestratorService().listSessions());
});

app.post("/api/orchestrator/sessions", async (request, response) => {
  response
    .status(201)
    .json(
      await getOrchestratorService().createSession(
        campaignInput(request.body),
      ),
    );
});

app.get("/api/orchestrator/sessions/:id", (request, response) => {
  response.json(getOrchestratorService().getSessionView(request.params.id));
});

app.post("/api/orchestrator/sessions/:id/messages", async (
  request,
  response,
) => {
  const content = (request.body as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string" || !content.trim()) {
    response.status(400).json({ error: "消息不能为空" });
    return;
  }
  response.json(
    await getOrchestratorService().chat(request.params.id, content),
  );
});

app.post(
  "/api/orchestrator/sessions/:id/messages/resume",
  async (request, response) => {
    response.json(
      await getOrchestratorService().resumeChat(request.params.id),
    );
  },
);

app.put("/api/orchestrator/sessions/:id/strategy", (request, response) => {
  const strategy = (
    request.body as { strategy?: CampaignStrategy } | undefined
  )?.strategy;
  if (!strategy || typeof strategy !== "object") {
    response.status(400).json({ error: "请提供完整策略" });
    return;
  }
  response.json(
    getOrchestratorService().replaceStrategy(request.params.id, strategy),
  );
});

app.post("/api/orchestrator/sessions/:id/approve", (request, response) => {
  const strategyHash = (
    request.body as { strategyHash?: unknown } | undefined
  )?.strategyHash;
  if (typeof strategyHash !== "string") {
    response.status(400).json({ error: "请提供 strategyHash" });
    return;
  }
  response.json(
    getOrchestratorService().approveStrategy(
      request.params.id,
      strategyHash,
    ),
  );
});

app.post("/api/orchestrator/sessions/:id/execute", (request, response) => {
  response
    .status(202)
    .json(getOrchestratorService().startExecution(request.params.id));
});

app.post(
  "/api/orchestrator/sessions/:id/execute/resume",
  (request, response) => {
    response
      .status(202)
      .json(getOrchestratorService().resumeExecution(request.params.id));
  },
);

app.post(
  "/api/orchestrator/sessions/:id/report/confirm",
  (request, response) => {
    response.json(
      getOrchestratorService().confirmReport(request.params.id),
    );
  },
);

app.get("/api/campaigns", (_request, response) => {
  response.json(listCampaigns());
});

app.get("/api/campaigns/:id", (request, response) => {
  const campaign = getCampaign(request.params.id);
  if (!campaign) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  response.json(campaign);
});

app.get("/api/campaigns/:id/export.json", (request, response) => {
  const campaign = getCampaign(request.params.id);
  if (!campaign) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  const document = projectCampaignExport(campaign);
  setExportHeaders(
    response,
    campaignExportFilename(campaign, "json"),
    document.campaign.leadCount,
  );
  response.type("application/json").send(serializeCampaignJson(document));
});

app.get(
  "/api/campaigns/:id/export.xlsx",
  async (request, response, next) => {
    const campaign = getCampaign(request.params.id);
    if (!campaign) {
      response.status(404).json({ error: "任务不存在" });
      return;
    }
    try {
      const document = projectCampaignExport(campaign);
      const workbook = await buildCampaignWorkbook(document);
      setExportHeaders(
        response,
        campaignExportFilename(campaign, "xlsx"),
        document.campaign.leadCount,
      );
      response
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .send(workbook);
    } catch (error) {
      next(error);
    }
  },
);

app.post("/api/campaigns/demo", async (request, response) => {
  const input = campaignInput(request.body);
  await getOrchestratorService().prepareTargetCountry(input.country);
  const result = await runOfflineSampleCampaign(input);
  response.status(201).json(result);
});

app.post("/api/campaigns/search", async (request, response) => {
  const body =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {};
  const input = campaignInput(body);
  await getOrchestratorService().prepareTargetCountry(input.country);
  const result = await runSearchCampaign(input, {
    maxQueries:
      typeof body.maxQueries === "number" ? body.maxQueries : undefined,
    resultsPerQuery:
      typeof body.resultsPerQuery === "number"
        ? body.resultsPerQuery
        : undefined,
  });
  response.status(201).json(result);
});

app.post("/api/campaigns/analyze", async (request, response) => {
  const body =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {};
  if (typeof body.url !== "string" || !body.url.trim()) {
    response.status(400).json({ error: "请提供需要分析的公司官网 URL" });
    return;
  }
  if (
    body.enableRegexCleaning !== undefined &&
    typeof body.enableRegexCleaning !== "boolean"
  ) {
    response
      .status(400)
      .json({ error: "enableRegexCleaning 必须是布尔值" });
    return;
  }
  const input = campaignInput(body);
  await getOrchestratorService().prepareTargetCountry(input.country);
  const candidate = await crawlCandidate(body.url.trim(), undefined, {
    enableRegexCleaning:
      typeof body.enableRegexCleaning === "boolean"
        ? body.enableRegexCleaning
        : undefined,
  });
  const result = await runManualCampaign(input, candidate);
  response.status(201).json(result);
});

app.get("/api/market-policies", (request, response) => {
  const marketId =
    typeof request.query.marketId === "string"
      ? request.query.marketId
      : undefined;
  response.json(
    getOrchestratorService().listMarketPolicies(marketId),
  );
});

app.get(
  "/api/market-policies/:marketId/:version",
  (request, response) => {
    response.json(
      getOrchestratorService().getMarketPolicy(
        request.params.marketId,
        request.params.version,
      ),
    );
  },
);

app.post("/api/market-policies/drafts", (request, response) => {
  const body =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Partial<MarketPolicy>)
      : undefined;
  if (
    !body?.marketId ||
    !body.searchLocalization ||
    !body.companyAnalysis ||
    !body.contactAndOutreach
  ) {
    response.status(400).json({ error: "MarketPolicy 草稿字段不完整" });
    return;
  }
  response.status(201).json(
    saveMarketPolicyDraft({
      schemaVersion: 1,
      marketId: body.marketId,
      searchLocalization: body.searchLocalization,
      companyAnalysis: body.companyAnalysis,
      contactAndOutreach: body.contactAndOutreach,
      metadata: {
        reviewNotes: body.metadata?.reviewNotes ?? [],
      },
    }),
  );
});

app.patch(
  "/api/market-policies/:marketId/:version",
  (request, response) => {
    const current = getOrchestratorService().getMarketPolicy(
      request.params.marketId,
      request.params.version,
    );
    if (current.status !== "draft" && current.status !== "reviewed") {
      response.status(409).json({ error: "只能修订草稿或已审阅版本" });
      return;
    }
    const patch =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Partial<MarketPolicy>)
        : {};
    response.status(201).json(
      saveMarketPolicyDraft({
        schemaVersion: 1,
        marketId: current.marketId,
        searchLocalization:
          patch.searchLocalization ?? current.searchLocalization,
        companyAnalysis: patch.companyAnalysis ?? current.companyAnalysis,
        contactAndOutreach:
          patch.contactAndOutreach ?? current.contactAndOutreach,
        metadata: {
          reviewNotes: patch.metadata?.reviewNotes ?? [],
        },
      }),
    );
  },
);

app.post(
  "/api/market-policies/:marketId/:version/review",
  async (request, response) => {
    response.json(
      await getOrchestratorService().reviewMarketPolicy(
        request.params.marketId,
        request.params.version,
      ),
    );
  },
);

app.post(
  "/api/market-policies/:marketId/:version/approve",
  (request, response) => {
    response.json(
      getOrchestratorService().approveMarketPolicy(
        request.params.marketId,
        request.params.version,
      ),
    );
  },
);

app.post(
  "/api/market-policies/:marketId/:version/reject",
  (request, response) => {
    response.json(
      getOrchestratorService().rejectMarketPolicy(
        request.params.marketId,
        request.params.version,
      ),
    );
  },
);

app.all(/^\/api\/(?:country-contexts(?:\/.*)?|skills|skill-proposals(?:\/.*)?)$/, (
  _request,
  response,
) => {
  response.status(410).json({
    error:
      "市场规则包接口已迁移到 /api/market-policies；旧接口不再写入数据",
  });
});

app.patch(
  "/api/campaigns/:campaignId/leads/:leadId",
  (request, response) => {
    const status = (request.body as { status?: LeadStatus } | undefined)?.status;
    if (
      status !== "approved" &&
      status !== "rejected" &&
      status !== "needs_review"
    ) {
      response.status(400).json({ error: "不支持的审核状态" });
      return;
    }
    const lead = updateLeadStatus(
      request.params.campaignId,
      request.params.leadId,
      status,
    );
    if (!lead) {
      response.status(404).json({ error: "线索不存在" });
      return;
    }
    response.json(lead);
  },
);

app.get("*path", (_request, response) => {
  response.sendFile(path.join(publicDirectory, "index.html"));
});

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    const rawMessage = error instanceof Error ? error.message : "未知错误";
    const message = /request was aborted/i.test(rawMessage)
      ? "模型请求被中止，通常是供应商连接或上游超时；会话与策略已保存，请稍后重试"
      : rawMessage;
    const statusCode =
      error instanceof OperationTimeoutError ||
      /request was aborted/i.test(rawMessage)
        ? 504
        : 500;
    logger.error("http.request.failed", error, {
      method: _request.method,
      path: _request.path,
      statusCode,
    });
    response.status(statusCode).json({ error: message });
  },
);

app.listen(port, "127.0.0.1", () => {
  logger.info(
    "application.started",
    `Trade Radar Flow: http://127.0.0.1:${port}`,
    {
      port,
      host: "127.0.0.1",
      agentMode: getAgentRuntime().mode,
      searchConfigured: Boolean(
        process.env.SERPER_API_KEY ?? process.env.SERPAPI_API_KEY,
      ),
      pythonCrawlerEnvironment:
        process.env.PYTHON_CRAWLER_ENV ?? "trade-radar-flow",
      nodeVersion: process.version,
    },
  );
});

process.on("unhandledRejection", (error) => {
  logger.error("process.unhandled_rejection", error);
});

process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", error);
  process.exit(1);
});
