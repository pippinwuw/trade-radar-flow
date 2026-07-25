import { performance } from "node:perf_hooks";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  StringEnum,
  Type,
  type Static,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  AgentResult,
  AgentRuntime,
  CampaignAgentContext,
} from "./agent-runtime.js";
import type {
  AgentTrace,
  CampaignInput,
  CampaignResult,
  CompanyAnalysisResult,
  CompanyCandidate,
  CountryProfile,
  MarketPolicy,
  SearchPlan,
} from "./domain.js";
import {
  OperationTimeoutError,
  positiveIntegerFromEnv,
} from "./concurrency.js";
import { logger } from "./logging/logger.js";
import {
  DEFAULT_SEARCH_QUERIES,
} from "./limits.js";
import {
  COMPANY_ANALYSIS_SYSTEM_PROMPT,
  GLOBAL_BUSINESS_SYSTEM_PROMPT,
  searchPlanningSystemPrompt,
} from "./production-prompts.js";
import {
  buildContactCatalog,
  type CompanyAnalysisSubmissionV2,
  CompanyAnalysisValidationError,
  validateAndNormalizeCompanyAnalysisV2,
} from "./validation/company-analysis-validator.js";
import {
  compileContext,
  marketPolicyProjection,
  readUsageFromMessages,
  type ContextEnvelope,
} from "./context-manager.js";
import {
  buildCompanyContext,
  readEvidenceContext,
  searchCompanyEvidence,
  type EvidenceSlot,
} from "./company-context.js";
import { getDatabase } from "./storage/database.js";

const analysisQualificationSchema = Type.Object({
  isQualified: Type.Boolean(),
  businessRole: StringEnum([
    "Distributor",
    "Wholesaler",
    "Importer",
    "Manufacturer",
    "Retailer",
    "Service",
    "Unknown",
  ]),
  productFitScore: Type.Number({ minimum: 0, maximum: 100 }),
  scaleScore: Type.Number({ minimum: 0, maximum: 100 }),
  importCapability: StringEnum(["High", "Medium", "Low", "Unknown"]),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  reasons: Type.Array(Type.String()),
  evidenceRefs: Type.Array(Type.String(), {
    description: "直接引用 research.facts 中选择的 evidenceRef",
  }),
  missingInformation: Type.Array(Type.String()),
  riskAssessment: Type.Array(Type.String()),
});

const analysisContactSchema = Type.Object({
  contactRef: Type.String({
    pattern: "^c[0-9]+$",
    description: "必须引用 get_contact_candidates 返回的 contactRef",
  }),
  label: Type.String(),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

const analysisEvidenceSchema = Type.Object({
  kind: StringEnum([
    "identity",
    "product",
    "business_role",
    "scale",
    "contact",
  ]),
  label: Type.String(),
  value: Type.String(),
  evidenceRef: Type.String({
    pattern: "^p[0-9]+-s[0-9]+$",
    description: "必须引用证据工具实际返回并读取的 evidenceRef",
  }),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

const analysisResearchSchema = Type.Object({
  canonicalName: Type.String(),
  summary: Type.String(),
  products: Type.Array(Type.String()),
  contacts: Type.Array(analysisContactSchema),
  facts: Type.Array(analysisEvidenceSchema),
  missingInformation: Type.Array(Type.String()),
});

const analysisOutreachSchema = Type.Object({
  headline: Type.String(),
  whyContact: Type.String(),
  productFit: Type.String(),
  risk: Type.String(),
  recommendedContactRef: Type.String({
    description:
      "引用 research.contacts 中已选择的 contactRef；没有可用联系人时填 none",
  }),
  templateId: Type.String(),
  templateReason: Type.String(),
  emailSubject: Type.String(),
  emailBody: Type.String(),
  whatsappBody: Type.String(),
  evidenceRefs: Type.Array(Type.String(), {
    description: "直接引用 research.facts 中选择的 evidenceRef",
  }),
});

const companyAnalysisSchema = Type.Object({
  research: analysisResearchSchema,
  qualification: analysisQualificationSchema,
  outreach: analysisOutreachSchema,
});

const searchPlanSchema = Type.Object({
  countryId: Type.String({
    description: "当前已批准 MarketPolicy 的稳定市场 ID",
  }),
  product: Type.String(),
  queries: Type.Array(
    Type.Object({
      query: Type.String(),
      language: Type.String(),
      rationale: Type.String(),
      groupId: Type.String(),
    }),
    { minItems: 1 },
  ),
  marketPolicyVersion: Type.String(),
  marketPolicyHash: Type.String(),
});
type SearchPlanSubmission = Static<typeof searchPlanSchema>;

interface RunOptions<T> {
  agentName: AgentTrace["agent"];
  systemPrompt: string;
  contextEnvelope?: ContextEnvelope;
  prompt: string;
  tools: AgentTool[];
  readResult: () => T | undefined;
  readFailure?: () => Error | undefined;
  timeoutMs?: number;
  maxToolCalls?: number;
}

export class PiAgentRuntime implements AgentRuntime {
  readonly mode = "live" as const;
  private readonly models = builtinModels();
  private readonly model;

  constructor() {
    const provider = (process.env.PI_PROVIDER ?? "anthropic").toLowerCase();
    const modelId = process.env.PI_MODEL ?? "claude-sonnet-4-5";
    const model = this.models.getModel(provider, modelId);
    if (!model) {
      throw new Error(`pi 模型不存在：${provider}/${modelId}`);
    }
    this.model = model;
  }

  private async run<T>({
    agentName,
    systemPrompt,
    contextEnvelope,
    prompt,
    tools,
    readResult,
    readFailure,
    timeoutMs = positiveIntegerFromEnv("PI_AGENT_TIMEOUT_MS", 180_000),
    maxToolCalls = 12,
  }: RunOptions<T>): Promise<AgentResult<T>> {
    const started = performance.now();
    const steps: string[] = [];
    let toolCalls = 0;
    logger.info(
      "agent.run.started",
      undefined,
      {
        maxToolCalls,
        timeoutMs,
        modelProvider: this.model.provider,
        modelId: this.model.id,
      },
      { agent: agentName },
    );
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: this.model,
        thinkingLevel: "medium",
        tools,
      },
      streamFn: (model, context, options) =>
        this.models.streamSimple(model, context, options),
      toolExecution: "parallel",
      beforeToolCall: async ({ toolCall }) => {
        if (toolCalls >= maxToolCalls) {
          return {
            block: true,
            reason: `工具调用超过预算 ${maxToolCalls}`,
          };
        }
        toolCalls += 1;
        steps.push(`调用工具：${toolCall.name}`);
        return undefined;
      },
      afterToolCall: async ({ toolCall, isError, result }) => {
        if (isError) {
          logger.warn(
            "agent.tool.failed",
            result.content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("\n"),
            {
              toolName: toolCall.name,
              toolCalls,
              maxToolCalls,
            },
            { agent: agentName },
          );
        }
        return toolCalls >= maxToolCalls ? { terminate: true } : undefined;
      },
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      agent.abort();
    }, timeoutMs);

    try {
      await agent.prompt(prompt);
      const result = readResult();
      if (!result) {
        const failure = readFailure?.();
        if (timedOut) {
          throw new OperationTimeoutError(
            `${agentName} 本地执行超时（${timeoutMs}ms）${
              failure ? `；最后一次提交错误：${failure.message}` : ""
            }`,
          );
        }
        if (failure) throw failure;
        throw new Error(
          agent.state.errorMessage ?? `${agentName} 未调用最终提交工具`,
        );
      }
      const output = {
        value: result,
        trace: {
          agent: agentName,
          mode: "live",
          status: "succeeded",
          steps,
          durationMs: Math.round(performance.now() - started),
          usage: readUsageFromMessages(agent.state.messages),
          context: contextEnvelope
            ? {
                ...contextEnvelope.budget,
                sections: contextEnvelope.sections,
              }
            : undefined,
        },
      } satisfies AgentResult<T>;
      logger.info(
        "agent.run.completed",
        undefined,
        {
          status: output.trace.status,
          toolCalls,
          steps,
          durationMs: output.trace.durationMs,
        },
        { agent: agentName },
      );
      return output;
    } catch (error) {
      const failure = readFailure?.();
      const reportedError = timedOut
        ? new OperationTimeoutError(
            `${agentName} 本地执行超时（${timeoutMs}ms）${
              failure ? `；最后一次提交错误：${failure.message}` : ""
            }`,
          )
        : error;
      logger.error(
        "agent.run.failed",
        reportedError,
        {
          toolCalls,
          steps,
          durationMs: Math.round(performance.now() - started),
        },
        { agent: agentName },
      );
      throw reportedError;
    } finally {
      clearTimeout(timeout);
    }
  }

  async planSearch(
    input: CampaignInput,
    country: CountryProfile,
    marketPolicy: MarketPolicy,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<SearchPlan>> {
    const requestedBudget =
      context?.strategy?.budget.maxQueries ?? DEFAULT_SEARCH_QUERIES;
    const requestedQueries = Number.isFinite(requestedBudget)
      ? Math.max(1, Math.floor(requestedBudget))
      : DEFAULT_SEARCH_QUERIES;
    let submission: SearchPlanSubmission | undefined;
    const submitTool: AgentTool<typeof searchPlanSchema> = {
      name: "submit_search_plan",
      label: "提交本地化搜索计划",
      description:
        `提交 1 至 ${requestedQueries} 条面向真实目标企业官网的本地化 B2B 查询。必须符合已批准策略、MarketPolicy、稳定 groupId 和查询预算；本工具不执行搜索。`,
      parameters: searchPlanSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        if (params.countryId !== country.id) {
          throw new Error(
            `搜索计划国家 ID 不匹配：期望 ${country.id}，收到 ${params.countryId}`,
          );
        }
        if (
          params.marketPolicyVersion !== marketPolicy.version ||
          params.marketPolicyHash !== marketPolicy.hash
        ) {
          throw new Error(
            `搜索计划市场规则包不匹配：期望 ${marketPolicy.marketId}@${marketPolicy.version}`,
          );
        }
        submission = params;
        return {
          content: [{ type: "text", text: "搜索计划已通过结构校验。" }],
          details: { queryCount: params.queries.length },
          terminate: true,
        };
      },
    };

    const systemContext = compileContext(
      [
        {
          id: "global-business",
          source: "production-prompts",
          content: GLOBAL_BUSINESS_SYSTEM_PROMPT,
          trust: "system",
          priority: "required",
        },
        {
          id: "search-planning-task",
          source: "production-prompts",
          content: searchPlanningSystemPrompt(requestedQueries),
          trust: "system",
          priority: "required",
        },
        {
          id: "country-search",
          source: "market-policy",
          version: marketPolicy.version,
          content: marketPolicyProjection(marketPolicy, "search"),
          trust: "approved",
          priority: "required",
        },
      ],
      {
        contextWindow: this.model.contextWindow,
        modelMaxTokens: this.model.maxTokens,
      },
    );
    return this.run({
      agentName: "SearchPlanningAgent",
      systemPrompt: systemContext.content,
      contextEnvelope: systemContext,
      prompt: JSON.stringify({
        task: "依据已批准获客策略生成可审计的本地化目标企业官网搜索矩阵",
        input,
        country,
        requiredMarketPolicy: {
          marketId: marketPolicy.marketId,
          version: marketPolicy.version,
          hash: marketPolicy.hash,
        },
        approvedStrategy: context?.strategy,
        requestedQueries,
      }),
      tools: [submitTool],
      readResult: () =>
        submission
          ? {
              countryId: submission.countryId,
              product: submission.product,
              queries: submission.queries,
              marketPolicyRef: {
                marketId: marketPolicy.marketId,
                version: marketPolicy.version,
                hash: marketPolicy.hash,
              },
            }
          : undefined,
      timeoutMs: positiveIntegerFromEnv(
        "SEARCH_PLANNING_AGENT_TIMEOUT_MS",
        300_000,
      ),
      maxToolCalls: 2,
    });
  }

  async analyzeCompany(
    candidate: CompanyCandidate,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<CompanyAnalysisResult>> {
    if (!context) {
      throw new Error("CompanyAnalysisAgent 缺少已批准 Campaign 上下文");
    }
    const companyContext = buildCompanyContext(candidate, context, {
      provider: this.model.provider,
      id: this.model.id,
    });
    const cached = getDatabase().getCompanyAnalysisCache(
      companyContext.cacheKey,
    );
    if (
      cached &&
      cached.result.research.evidence.every((evidence) =>
        candidate.pages.some(
          (page) =>
            page.url === evidence.sourceUrl &&
            page.text.includes(evidence.quote),
        ),
      ) &&
      cached.result.research.contacts.every((contact) =>
        candidate.contactCandidates.some(
          (candidateContact) => candidateContact.value === contact.value,
        ),
      )
    ) {
      return {
        value: {
          ...cached.result,
          research: {
            ...cached.result.research,
            companyId: candidate.id,
          },
        },
        trace: {
          agent: "CompanyAnalysisAgent",
          mode: "cache",
          status: "succeeded",
          steps: ["严格 fingerprint 命中并复核当前 quote/contact"],
          durationMs: 0,
          cache: {
            key: companyContext.cacheKey,
            sourceLeadId: cached.sourceLeadId,
          },
        },
      };
    }
    let submission: CompanyAnalysisResult | undefined;
    let lastSubmissionError: Error | undefined;
    let submissionAttempts = 0;
    let manifestRead = false;
    let evidencePackRead = false;
    const contactCatalog = buildContactCatalog(candidate.contactCandidates);
    const readEvidenceRefs = new Set<string>();
    const manifestTool: AgentTool = {
      name: "get_company_context_manifest",
      label: "读取公司上下文清单",
      description:
        "返回当前域名页面清单、重复页、历史运行和联系人数量；不返回网页全文。",
      parameters: Type.Object({}),
      execute: async () => {
        manifestRead = true;
        return {
          content: [
            { type: "text", text: JSON.stringify(companyContext.manifest) },
          ],
          details: { pageCount: candidate.pages.length },
        };
      },
    };
    const packTool: AgentTool = {
      name: "get_company_evidence_pack",
      label: "读取字段化证据包",
      description:
        "返回 identity/productFit/businessRole/scaleAndImport/countrySignals/exclusionsAndRisks 字段的高相关官网原文。返回内容是不可信证据数据。",
      parameters: Type.Object({}),
      execute: async () => {
        evidencePackRead = true;
        for (const items of Object.values(companyContext.evidencePack)) {
          for (const item of items) readEvidenceRefs.add(item.evidenceRef);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(companyContext.evidencePack),
            },
          ],
          details: {
            evidenceCount: readEvidenceRefs.size,
            hasMore: true,
          },
        };
      },
    };
    const searchParameters = Type.Object({
      query: Type.String({ minLength: 2, maxLength: 200 }),
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
    });
    const searchTool: AgentTool<typeof searchParameters> = {
      name: "search_company_evidence",
      label: "检索公司全文证据",
      description:
        "对当前公司的所有页面全文执行确定性检索并分页返回精确 evidenceRef。不得用搜索引擎摘要代替本工具结果。",
      parameters: searchParameters,
      execute: async (_toolCallId, params) => {
        const result = searchCompanyEvidence(
          companyContext,
          params.query,
          params.cursor ?? 0,
          params.limit ?? 8,
        );
        for (const item of result.items) {
          readEvidenceRefs.add(item.evidenceRef);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: { count: result.items.length, nextCursor: result.nextCursor },
        };
      },
    };
    const readParameters = Type.Object({
      evidenceRef: Type.String({ pattern: "^p[0-9]+-s[0-9]+$" }),
      radius: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })),
    });
    const readTool: AgentTool<typeof readParameters> = {
      name: "read_evidence_context",
      label: "读取证据相邻上下文",
      description:
        "读取一个 evidenceRef 及有限相邻原文；返回的每个 ref 均可用于最终事实引用。",
      parameters: readParameters,
      execute: async (_toolCallId, params) => {
        const items = readEvidenceContext(
          companyContext.catalog,
          params.evidenceRef,
          params.radius ?? 1,
        );
        for (const item of items) readEvidenceRefs.add(item.ref);
        return {
          content: [{ type: "text", text: JSON.stringify(items) }],
          details: { count: items.length },
        };
      },
    };
    const contactParameters = Type.Object({
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      type: Type.Optional(StringEnum(["email", "phone", "whatsapp"])),
    });
    const contactTool: AgentTool<typeof contactParameters> = {
      name: "get_contact_candidates",
      label: "分页读取确定性联系人候选",
      description:
        "按验证质量排序并分页返回 contactRef。contactRef 只能用于联系人字段，不能作为网页 evidenceRef。",
      parameters: contactParameters,
      execute: async (_toolCallId, params) => {
        const filtered = companyContext.rankedContacts.filter(
          (item) => !params.type || item.contact.type === params.type,
        );
        const cursor = params.cursor ?? 0;
        const limit = params.limit ?? 20;
        const items = filtered.slice(cursor, cursor + limit).map((item) => ({
          contactRef: item.ref,
          type: item.contact.type,
          value: item.contact.value,
          sourceUrl: item.contact.sourceUrl,
          nearbyText: item.contact.nearbyText,
          validation: candidate.contactValidations?.find(
            (validation) => validation.value === item.contact.value,
          ),
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items,
                nextCursor:
                  cursor + limit < filtered.length
                    ? cursor + limit
                    : undefined,
              }),
            },
          ],
          details: { count: items.length, total: filtered.length },
        };
      },
    };
    const submitTool: AgentTool<typeof companyAnalysisSchema> = {
      name: "submit_company_analysis",
      label: "提交完整公司分析",
      description:
        "提交研究、资格和人工审核用触达草稿。模型不提交 companyId/evidenceId/quote/URL；系统从已读取 evidenceRef 和 contactRef 确定性生成。",
      parameters: companyAnalysisSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        submissionAttempts += 1;
        try {
          if (!manifestRead || !evidencePackRead) {
            throw new CompanyAnalysisValidationError([
              "提交前必须读取公司上下文清单和字段化证据包",
            ]);
          }
          submission = validateAndNormalizeCompanyAnalysisV2(
            params as CompanyAnalysisSubmissionV2,
            candidate,
            readEvidenceRefs,
            companyContext.catalog,
            contactCatalog,
          );
          lastSubmissionError = undefined;
        } catch (error) {
          lastSubmissionError =
            error instanceof Error ? error : new Error(String(error));
          logger.warn(
            "agent.company_analysis.validation_failed",
            lastSubmissionError.message,
            {
              attempt: submissionAttempts,
              issues:
                error instanceof CompanyAnalysisValidationError
                  ? error.issues
                  : [lastSubmissionError.message],
            },
            { agent: "CompanyAnalysisAgent" },
          );
          throw error;
        }
        return {
          content: [{ type: "text", text: "完整公司分析已通过约束校验。" }],
          details: {
            companyId: candidate.id,
            evidenceCount: params.research.facts.length,
            qualified: params.qualification.isQualified,
          },
          terminate: true,
        };
      },
    };

    const systemContext = compileContext(
      [
        {
          id: "global-business",
          source: "production-prompts",
          content: GLOBAL_BUSINESS_SYSTEM_PROMPT,
          trust: "system",
          priority: "required",
        },
        {
          id: "company-analysis-task",
          source: "production-prompts",
          content: COMPANY_ANALYSIS_SYSTEM_PROMPT,
          trust: "system",
          priority: "required",
        },
        {
          id: "country-company",
          source: "market-policy",
          version: context.marketPolicy.version,
          content: marketPolicyProjection(
            context.marketPolicy,
            "company",
          ),
          trust: "approved",
          priority: "required",
        },
      ],
      {
        contextWindow: this.model.contextWindow,
        modelMaxTokens: this.model.maxTokens,
      },
    );
    const result = await this.run({
      agentName: "CompanyAnalysisAgent",
      systemPrompt: systemContext.content,
      contextEnvelope: systemContext,
      prompt: JSON.stringify({
        task: "完成单一候选公司的官网尽调、策略资格复核和人工审核用首触达草稿",
        campaign: context.input,
        approvedStrategy: context.strategy,
        countryValidation: candidate.countryValidation,
        candidate: {
          homepage: candidate.homepage,
          domain: candidate.domain,
          pageCount: candidate.pages.length,
          contactCandidateCount: candidate.contactCandidates.length,
          discoveryContext: {
            query: candidate.searchHit?.query,
            snippet: candidate.searchSnippet,
            notice: "仅用于解释发现原因，不是官网证据，不得引用为事实。",
          },
        },
      }),
      tools: [
        manifestTool,
        packTool,
        searchTool,
        readTool,
        contactTool,
        submitTool,
      ],
      readResult: () => submission as CompanyAnalysisResult | undefined,
      readFailure: () => lastSubmissionError,
      timeoutMs: positiveIntegerFromEnv(
        "COMPANY_ANALYSIS_AGENT_TIMEOUT_MS",
        300_000,
      ),
      maxToolCalls: 12,
    });
    result.trace.cache = { key: companyContext.cacheKey };
    getDatabase().putCompanyAnalysisCache({
      key: companyContext.cacheKey,
      domain: candidate.domain,
      candidateFingerprint: companyContext.candidateFingerprint,
      decisionFingerprint: companyContext.decisionFingerprint,
      marketPolicyHash: context.marketPolicy.hash,
      analysisContractVersion: "company-analysis-v2",
      modelProvider: this.model.provider,
      modelId: this.model.id,
      result: result.value,
      createdAt: new Date().toISOString(),
    });
    return result;
  }

}
