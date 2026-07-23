import { randomUUID } from "node:crypto";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { AgentRuntime } from "../agent-runtime.js";
import { buildCampaignAgentContext } from "../discovery/query-planner.js";
import type {
  BusinessRole,
  CampaignResult,
  CampaignStrategy,
  OrchestratorMessage,
  OrchestratorReport,
  OrchestratorSession,
} from "../domain.js";
import {
  estimateStrategyBudget,
  TARGET_ROLE_OPTIONS,
} from "./strategy-template.js";
import { compactCampaignForMainAgent } from "./report-view.js";
import { logger } from "../logging/logger.js";
import {
  OperationTimeoutError,
  positiveIntegerFromEnv,
} from "../concurrency.js";
import {
  CAMPAIGN_REPORT_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from "../production-prompts.js";
import { listCountryProfiles } from "../countries/registry.js";
import type { RuntimeMarketCountryInput } from "../countries/runtime-market.js";

interface StrategyPatch {
  product?: string;
  objective?: string;
  businessRoles?: BusinessRole[];
  industries?: string[];
  requiredKeywords?: string[];
  alternativeKeywords?: string[];
  localLanguageKeywords?: string[];
  cities?: string[];
  exclusionTerms?: string[];
  exclusionDomains?: string[];
  maxQueries?: number;
  resultsPerQuery?: number;
  maxPagesPerCompany?: number;
  lowYieldNewDomains?: number;
  lowYieldRate?: number;
  consecutiveLowYieldRounds?: number;
  minimumCountryScore?: number;
  reportLanguage?: string;
}

export interface CountrySearchHistory {
  country: string;
  realSearchCampaigns: number;
  lastRunAt?: string;
  totalQueries: number;
  totalSearchHits: number;
  totalLeads: number;
  uniqueDomains: number;
  recentRuns: Array<{
    campaignId: string;
    product: string;
    completedAt: string;
    queryCount: number;
    searchHits: number;
    leadCount: number;
  }>;
}

export interface MainAgentCallbacks {
  getSession(): OrchestratorSession;
  updateStrategy(
    mutate: (strategy: CampaignStrategy) => CampaignStrategy,
  ): OrchestratorSession;
  markAwaitingApproval(message: string): OrchestratorSession;
  getCampaign(): CampaignResult | undefined;
  getCountrySearchHistory(country: string): CountrySearchHistory;
  setTargetCountry(
    country: string,
    generatedProfile?: RuntimeMarketCountryInput,
  ): Promise<OrchestratorSession>;
  createSkillProposal(): Promise<{ id: string; title: string; status: string }>;
  resumeFailedExecution(): OrchestratorSession;
}

export interface MainAgentTurn {
  content: string;
  nextAction: string;
}

const bootstrapMarketProfileSchema = Type.Object({
  id: Type.String({ pattern: "^[a-z][a-z0-9-]{1,39}$" }),
  displayName: Type.String(),
  shortName: Type.String(),
  aliases: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
  gl: Type.String({ pattern: "^[a-z]{2}$" }),
  defaultHl: Type.String(),
  googleDomain: Type.String(),
  location: Type.String(),
  cities: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
  phoneCountryCode: Type.String({ pattern: "^[A-Z]{2}$" }),
  callingCode: Type.String({ pattern: "^\\+[0-9]{1,4}$" }),
  domainSuffix: Type.String({ pattern: "^\\.[a-z0-9.-]+$" }),
  businessSuffixes: Type.Array(Type.String(), { maxItems: 20 }),
  queryPatterns: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
  validationSignals: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 20,
  }),
  exclusions: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
});

function ensureNextStep(content: string, nextAction: string): string {
  return /下一步[：:]/.test(content)
    ? content
    : `${content.trim()}\n\n下一步：${nextAction}`;
}

export function isResumeExecutionIntent(message: string): boolean {
  if (/(?:不要|不需要|别|暂不).{0,8}(?:继续|恢复|重试)/.test(message)) {
    return false;
  }
  if (
    /(?:改成|换成|改为|切换到|目标(?:国家|市场)?.{0,4}(?:是|为)|国家.{0,6}(?:改|换|是|为))/.test(
      message,
    )
  ) {
    return false;
  }
  return (
    /(?:继续|恢复|重试).{0,12}(?:任务|执行|campaign|流程)/i.test(message) ||
    /(?:任务|执行|campaign|流程).{0,12}(?:继续|恢复|重试)/i.test(message)
  );
}

function applyPatch(
  strategy: CampaignStrategy,
  patch: StrategyPatch,
): CampaignStrategy {
  return {
    ...strategy,
    product: patch.product ?? strategy.product,
    objective: patch.objective ?? strategy.objective,
    targetCustomer: {
      ...strategy.targetCustomer,
      businessRoles:
        patch.businessRoles ?? strategy.targetCustomer.businessRoles,
      industries: patch.industries ?? strategy.targetCustomer.industries,
    },
    search: {
      ...strategy.search,
      requiredKeywords:
        patch.requiredKeywords ?? strategy.search.requiredKeywords,
      alternativeKeywords:
        patch.alternativeKeywords ?? strategy.search.alternativeKeywords,
      localLanguageKeywords:
        patch.localLanguageKeywords ??
        strategy.search.localLanguageKeywords,
      cities: patch.cities ?? strategy.search.cities,
    },
    exclusions: {
      ...strategy.exclusions,
      terms: patch.exclusionTerms ?? strategy.exclusions.terms,
      domains: patch.exclusionDomains ?? strategy.exclusions.domains,
    },
    validation: {
      ...strategy.validation,
      minimumCountryScore:
        patch.minimumCountryScore ??
        strategy.validation.minimumCountryScore,
    },
    budget: {
      ...strategy.budget,
      maxQueries: patch.maxQueries ?? strategy.budget.maxQueries,
      resultsPerQuery:
        patch.resultsPerQuery ?? strategy.budget.resultsPerQuery,
      maxPagesPerCompany:
        patch.maxPagesPerCompany ??
        strategy.budget.maxPagesPerCompany,
      lowYieldNewDomains:
        patch.lowYieldNewDomains ?? strategy.budget.lowYieldNewDomains,
      lowYieldRate: patch.lowYieldRate ?? strategy.budget.lowYieldRate,
      consecutiveLowYieldRounds:
        patch.consecutiveLowYieldRounds ??
        strategy.budget.consecutiveLowYieldRounds,
    },
    output: {
      ...strategy.output,
      reportLanguage:
        patch.reportLanguage ?? strategy.output.reportLanguage,
    },
  };
}

export class CampaignOrchestratorAgent {
  private readonly models = builtinModels();
  private readonly model;

  constructor(private readonly runtime: AgentRuntime) {
    const provider = (process.env.PI_PROVIDER ?? "anthropic").toLowerCase();
    const modelId = process.env.PI_MODEL ?? "claude-sonnet-4-5";
    const model = this.models.getModel(provider, modelId);
    if (!model) throw new Error(`pi 模型不存在：${provider}/${modelId}`);
    this.model = model;
  }

  private async run(
    operation: "chat" | "report",
    systemPrompt: string,
    prompt: string,
    tools: AgentTool[],
    maxToolCalls = 10,
  ): Promise<string> {
    const started = performance.now();
    const timeoutMs = positiveIntegerFromEnv(
      "ORCHESTRATOR_AGENT_TIMEOUT_MS",
      600_000,
    );
    let text = "";
    let toolCalls = 0;
    let timedOut = false;
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model: this.model,
        thinkingLevel: "medium",
        tools,
      },
      streamFn: (model, context, options) =>
        this.models.streamSimple(model, context, options),
      toolExecution: "sequential",
      beforeToolCall: async () => {
        toolCalls += 1;
        return toolCalls > maxToolCalls
          ? { block: true, reason: `主 Agent 工具调用超过预算 ${maxToolCalls}` }
          : undefined;
      },
    });
    agent.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        text += event.assistantMessageEvent.delta;
      }
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      agent.abort();
    }, timeoutMs);
    logger.info(
      "orchestrator.agent.started",
      undefined,
      {
        operation,
        maxToolCalls,
        timeoutMs,
        modelProvider: this.model.provider,
        modelId: this.model.id,
      },
      { agent: "CampaignOrchestratorAgent" },
    );
    try {
      await agent.prompt(prompt);
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      logger.info(
        "orchestrator.agent.completed",
        undefined,
        {
          operation,
          toolCalls,
          responseCharacters: text.length,
          durationMs: Math.round(performance.now() - started),
        },
        { agent: "CampaignOrchestratorAgent" },
      );
      return text.trim();
    } catch (error) {
      const reportedError = timedOut
        ? new OperationTimeoutError(
            `主 Agent ${operation === "chat" ? "对话" : "报告"}执行超时（${timeoutMs}ms），请重试；已保存的策略和会话不会丢失`,
          )
        : error;
      logger.error(
        "orchestrator.agent.failed",
        reportedError,
        {
          operation,
          toolCalls,
          durationMs: Math.round(performance.now() - started),
        },
        { agent: "CampaignOrchestratorAgent" },
      );
      throw reportedError;
    } finally {
      clearTimeout(timeout);
    }
  }

  async bootstrapMarketCountry(
    countryInput: string,
  ): Promise<RuntimeMarketCountryInput> {
    if (this.runtime.mode === "demo") {
      throw new Error(
        `演示模式无法核验新国家“${countryInput}”的市场配置，请使用实时 Agent`,
      );
    }
    let submitted: RuntimeMarketCountryInput | undefined;
    const submit: AgentTool<typeof bootstrapMarketProfileSchema> = {
      name: "submit_market_profile",
      label: "提交新国家 Market Skill 配置",
      description:
        "提交目标国家的规范标识、搜索本地化参数、主要城市、电话/域名/企业验证信号和查询模式。所有国家代码与号码必须是该国家的真实标准值。",
      parameters: bootstrapMarketProfileSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        submitted = params as RuntimeMarketCountryInput;
        return {
          content: [{ type: "text", text: "国家配置已提交。" }],
          details: { countryId: params.id },
          terminate: true,
        };
      },
    };
    await this.run(
      "chat",
      [
        "你是 B2B 搜索国家配置生成器。",
        "根据用户明确指定的国家，生成一个保守、可审计的初始 Market Skill 配置。",
        "displayName/location 使用标准英文国名；id 使用稳定小写英文 slug；gl 和 phoneCountryCode 使用真实 ISO alpha-2；callingCode、Google 域名和国家域名必须准确。",
        "查询模式只写可泛化的 B2B buyer/importer/distributor 模式；验证信号和排除项不得虚构具体企业。",
        "只调用一次 submit_market_profile。",
      ].join("\n"),
      JSON.stringify({
        task: "为尚未注册的目标国家生成初始运行时 Market Skill",
        requestedCountry: countryInput,
      }),
      [submit],
      2,
    );
    if (!submitted) throw new Error("新国家 Market Skill 配置生成失败");
    return submitted;
  }

  async chat(
    userMessage: string,
    history: OrchestratorMessage[],
    callbacks: MainAgentCallbacks,
  ): Promise<MainAgentTurn> {
    if (this.runtime.mode === "demo") {
      return this.demoTurn(userMessage, callbacks);
    }
    const session = callbacks.getSession();
    let countrySearchHistory = callbacks.getCountrySearchHistory(
      session.strategy.country,
    );
    let rerunConfirmationId = `country-rerun:${session.strategy.skillName}`;
    const priorRerunConfirmation = session.strategy.customSections.some(
      (section) => section.id === rerunConfirmationId,
    );
    let presentedMessage: string | undefined;
    let previewedThisTurn = false;
    let rerunDecision:
      | "not_required"
      | "confirmed"
      | "declined"
      | undefined =
      countrySearchHistory.realSearchCampaigns === 0
        ? "not_required"
        : priorRerunConfirmation
          ? "confirmed"
          : undefined;
    const currentStrategy: AgentTool = {
      name: "get_current_strategy",
      label: "读取当前策略模板",
      description:
        "读取当前会话完整的获客目标、客户画像、查询、排除项、验证规则、预算、输出要求及审批状态。讨论或修改前应先以此为准。",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: callbacks.getSession().status,
              strategy: callbacks.getSession().strategy,
              registeredMarkets: listCountryProfiles().map((profile) => ({
                id: profile.id,
                displayName: profile.displayName,
                shortName: profile.shortName,
                aliases: profile.aliases,
              })),
            }),
          },
        ],
        details: { version: callbacks.getSession().strategyVersion },
      }),
    };
    const marketContext: AgentTool = {
      name: "get_market_context",
      label: "读取国家市场 Skill",
      description:
        "读取当前目标国家已人工批准并持久化的本地化搜索、国家信号、联系人验证、排除和触达边界。",
      parameters: Type.Object({}),
      execute: async () => {
        const context = await buildCampaignAgentContext({
          product: callbacks.getSession().strategy.product,
          country: callbacks.getSession().strategy.country,
          language: callbacks.getSession().strategy.language,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                country: context.country,
                skill: context.skill,
              }),
            },
          ],
          details: { skillVersion: context.skill.version },
        };
      },
    };
    const runtimeMarketProfileSchema = Type.Object({
      id: Type.String({
        pattern: "^[a-z][a-z0-9-]{1,39}$",
        description: "稳定的小写英文 slug，例如 germany、south-africa",
      }),
      displayName: Type.String({
        description: "国家的标准英文全名",
      }),
      shortName: Type.String(),
      aliases: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
      gl: Type.String({
        pattern: "^[a-z]{2}$",
        description: "Serper/Google 两位小写国家代码",
      }),
      defaultHl: Type.String({
        description: "默认搜索语言代码，例如 de、fr、en",
      }),
      googleDomain: Type.String(),
      location: Type.String({
        description: "Serper 使用的标准英文地理位置",
      }),
      cities: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
      phoneCountryCode: Type.String({
        pattern: "^[A-Z]{2}$",
        description: "两位大写 ISO 国家代码",
      }),
      callingCode: Type.String({
        pattern: "^\\+[0-9]{1,4}$",
      }),
      domainSuffix: Type.String({
        pattern: "^\\.[a-z0-9.-]+$",
      }),
      businessSuffixes: Type.Array(Type.String(), { maxItems: 20 }),
      queryPatterns: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
      validationSignals: Type.Array(Type.String(), {
        minItems: 1,
        maxItems: 20,
      }),
      exclusions: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }),
    });
    const targetCountrySchema = Type.Object({
      country: Type.String({
        description: "用户明确指定的目标国家名称或别名",
      }),
      generatedProfile: Type.Optional(runtimeMarketProfileSchema),
    });
    const setTargetCountry: AgentTool<typeof targetCountrySchema> = {
      name: "set_target_country",
      label: "切换目标国家并准备 Market Skill",
      description:
        "当用户指定的目标国家与当前 strategy.country 不同时必须先调用。若国家已出现在 get_current_strategy.registeredMarkets，只传 country；若尚未注册，必须同时提交准确完整的 generatedProfile，系统会先持久化生成运行时 Market Skill，再切换结构化国家、清空旧国家查询并要求重新预览和审批。不得仅修改目标文案。",
      parameters: targetCountrySchema,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const updated = await callbacks.setTargetCountry(
          params.country,
          params.generatedProfile as RuntimeMarketCountryInput | undefined,
        );
        countrySearchHistory = callbacks.getCountrySearchHistory(
          updated.strategy.country,
        );
        rerunConfirmationId = `country-rerun:${updated.strategy.skillName}`;
        const confirmed = updated.strategy.customSections.some(
          (section) => section.id === rerunConfirmationId,
        );
        rerunDecision =
          countrySearchHistory.realSearchCampaigns === 0
            ? "not_required"
            : confirmed
              ? "confirmed"
              : undefined;
        previewedThisTurn = false;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                country: updated.strategy.country,
                skillName: updated.strategy.skillName,
                skillVersion: updated.strategy.skillVersion,
                strategyVersion: updated.strategyVersion,
                requiresSearchPreview: true,
                requiresApproval: true,
              }),
            },
          ],
          details: {
            country: updated.strategy.country,
            skillName: updated.strategy.skillName,
          },
        };
      },
    };
    const searchHistory: AgentTool = {
      name: "get_country_search_history",
      label: "读取国家历史搜索",
      description:
        "读取当前国家历史真实 Campaign 的实际查询数、最近执行时间、搜索命中和线索摘要。制定或预览新查询前必须调用，用于避免用户在不知情时重复付费搜索。",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(countrySearchHistory),
          },
        ],
        details: {
          realSearchCampaigns: countrySearchHistory.realSearchCampaigns,
          lastRunAt: countrySearchHistory.lastRunAt,
        },
      }),
    };
    const rerunConfirmationSchema = Type.Object({
      rerun: Type.Boolean(),
      queryCount: Type.Optional(Type.Integer({ minimum: 1 })),
    });
    const confirmRerun: AgentTool<typeof rerunConfirmationSchema> = {
      name: "confirm_country_rerun_decision",
      label: "记录国家重查确认",
      description:
        "仅记录用户在当前会话中明确作出的国家重查决定；同意时必须同时提供用户确认的 maxQueries，不得由 Agent 猜测或沿用历史数量。",
      parameters: rerunConfirmationSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, decision) => {
        if (decision.rerun && !decision.queryCount) {
          throw new Error("用户同意重查时必须明确查询数量");
        }
        rerunDecision = decision.rerun ? "confirmed" : "declined";
        if (decision.rerun && decision.queryCount) {
          callbacks.updateStrategy((strategy) => {
            const updated = applyPatch(strategy, {
              maxQueries: decision.queryCount,
            });
            return {
              ...updated,
              customSections: [
                ...updated.customSections.filter(
                  (section) => section.id !== rerunConfirmationId,
                ),
                {
                  id: rerunConfirmationId,
                  title: "历史国家重查确认",
                  content: `用户已确认再次查询 ${countrySearchHistory.country}，查询数量 ${decision.queryCount}。`,
                  source: "agent",
                },
              ],
            };
          });
        }
        return {
          content: [
            {
              type: "text",
              text: decision.rerun
                ? `已记录用户同意重查，查询数量 ${decision.queryCount}。`
                : "已记录用户不同意再次搜索。",
            },
          ],
          details: {
            rerun: decision.rerun,
            queryCount: decision.queryCount,
          },
        };
      },
    };
    const previewSearch: AgentTool = {
      name: "preview_search_plan",
      label: "预览搜索查询",
      description:
        "调用 SearchPlanningAgent 按当前已编辑策略、国家 Skill 和 maxQueries 生成可审核的分组查询矩阵；只预览，不调用 Serper、爬虫或公司 Agent。",
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async () => {
        if (
          countrySearchHistory.realSearchCampaigns > 0 &&
          rerunDecision !== "confirmed"
        ) {
          throw new Error(
            "该国家已有历史搜索；必须先让用户确认是否重查以及查询数量",
          );
        }
        const current = callbacks.getSession().strategy;
        const context = await buildCampaignAgentContext(
          {
            product: current.product,
            country: current.country,
            language: current.language,
          },
          current,
        );
        const result = await this.runtime.planSearch(
          context.input,
          context.country,
          context.skill,
          context.skillInvocation,
          context,
        );
        previewedThisTurn = true;
        callbacks.updateStrategy((strategy) => ({
          ...strategy,
          search: {
            ...strategy.search,
            queries: result.value.queries.slice(
              0,
              strategy.budget.maxQueries,
            ),
          },
        }));
        return {
          content: [
            { type: "text", text: JSON.stringify(result.value.queries) },
          ],
          details: { queryCount: result.value.queries.length },
        };
      },
    };
    const patchSchema = Type.Object({
      product: Type.Optional(Type.String()),
      objective: Type.Optional(Type.String()),
      businessRoles: Type.Optional(
        Type.Array(StringEnum(TARGET_ROLE_OPTIONS)),
      ),
      industries: Type.Optional(Type.Array(Type.String())),
      requiredKeywords: Type.Optional(Type.Array(Type.String())),
      alternativeKeywords: Type.Optional(Type.Array(Type.String())),
      localLanguageKeywords: Type.Optional(Type.Array(Type.String())),
      cities: Type.Optional(Type.Array(Type.String())),
      exclusionTerms: Type.Optional(Type.Array(Type.String())),
      exclusionDomains: Type.Optional(Type.Array(Type.String())),
      maxQueries: Type.Optional(Type.Integer({ minimum: 1 })),
      resultsPerQuery: Type.Optional(
        Type.Integer({ minimum: 1, maximum: 100 }),
      ),
      maxPagesPerCompany: Type.Optional(Type.Integer({ minimum: 1 })),
      lowYieldNewDomains: Type.Optional(Type.Integer({ minimum: 0 })),
      lowYieldRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      consecutiveLowYieldRounds: Type.Optional(
        Type.Integer({ minimum: 1 }),
      ),
      minimumCountryScore: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 100 }),
      ),
      reportLanguage: Type.Optional(Type.String()),
    });
    const updateStrategy: AgentTool<typeof patchSchema> = {
      name: "patch_strategy_draft",
      label: "更新策略草稿",
      description:
        "把用户明确表达的产品、目标客户、关键词、排除、验证、预算或输出要求写入策略草稿。不得静默扩大预算、放宽排除条件或覆盖未提及字段。",
      parameters: patchSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, patch) => {
        const updated = callbacks.updateStrategy((strategy) =>
          applyPatch(strategy, patch),
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                version: updated.strategyVersion,
                strategy: updated.strategy,
              }),
            },
          ],
          details: { strategyVersion: updated.strategyVersion },
        };
      },
    };
    const customSectionSchema = Type.Object({
      title: Type.String({ maxLength: 100 }),
      content: Type.String({ maxLength: 1000 }),
    });
    const addCustomSection: AgentTool<typeof customSectionSchema> = {
      name: "add_custom_strategy_section",
      label: "增加 Agent 建议段落",
      description:
        "将模板字段无法表达、但会影响本次搜索或资格判断的用户要求/Agent 建议写入当前策略，并标明边界。只影响本会话，不修改国家长期 Skill。",
      parameters: customSectionSchema,
      execute: async (_toolCallId, params) => {
        callbacks.updateStrategy((strategy) => ({
          ...strategy,
          customSections: [
            ...strategy.customSections,
            { id: randomUUID(), ...params, source: "agent" },
          ],
        }));
        return {
          content: [{ type: "text", text: "Agent 建议段落已加入策略卡。" }],
          details: { title: params.title },
        };
      },
    };
    const estimateBudget: AgentTool = {
      name: "estimate_run_budget",
      label: "估算任务调用量",
      description:
        "按当前策略确定性计算最坏情况下的 Serper 请求、搜索命中、官网抓取和公司模型调用量；实际执行可能因去重、缓存和低新增早停而更少。",
      parameters: Type.Object({}),
      execute: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              estimateStrategyBudget(callbacks.getSession().strategy),
            ),
          },
        ],
        details: {},
      }),
    };
    const presentSchema = Type.Object({
      message: Type.String({ maxLength: 2000 }),
    });
    const presentForApproval: AgentTool<typeof presentSchema> = {
      name: "present_strategy_for_approval",
      label: "提交策略供用户确认",
      description:
        "仅在目标、排除项、查询矩阵和预算已清楚时，向用户总结覆盖范围、关键假设、停止条件和最坏预算，并请求人工确认；不会执行任何付费操作。",
      parameters: presentSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, { message }) => {
        if (
          countrySearchHistory.realSearchCampaigns > 0 &&
          rerunDecision !== "confirmed"
        ) {
          throw new Error(
            "该国家已有历史搜索；未确认重查和查询数量，不能提交策略审批",
          );
        }
        presentedMessage = ensureNextStep(
          message,
          "请检查右侧策略卡；需要修改就继续告诉我，确认无误后点击“确认策略”。",
        );
        callbacks.markAwaitingApproval(presentedMessage);
        return {
          content: [{ type: "text", text: presentedMessage }],
          details: { strategyHash: callbacks.getSession().strategyHash },
          terminate: true,
        };
      },
    };
    const campaignSummary: AgentTool = {
      name: "get_campaign_summary",
      label: "读取子 Agent 综合结果",
      description:
        "读取确定性搜索/处理统计、逐轮停止原因，以及每家公司的研究、资格、联系人质量和证据索引；用于任务复盘，不包含整站原文。",
      parameters: Type.Object({}),
      execute: async () => {
        const campaign = callbacks.getCampaign();
        if (!campaign) throw new Error("当前会话还没有任务结果");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(compactCampaignForMainAgent(campaign)),
            },
          ],
          details: { leadCount: campaign.leads.length },
        };
      },
    };
    const leadSchema = Type.Object({ leadId: Type.String() });
    const leadReport: AgentTool<typeof leadSchema> = {
      name: "get_lead_report",
      label: "读取单条线索报告",
      description:
        "按真实 lead ID 读取该公司的官网研究、资格评分与复核、触达草稿、国家和联系人确定性验证，用于核对推荐依据或风险。",
      parameters: leadSchema,
      execute: async (_toolCallId, { leadId }) => {
        const campaign = callbacks.getCampaign();
        const lead = campaign?.leads.find((item) => item.id === leadId);
        if (!lead) throw new Error("线索不存在");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: lead.id,
                research: lead.research,
                qualification: lead.qualification,
                outreach: lead.outreach,
                countryValidation: lead.candidate.countryValidation,
                contactValidations: lead.candidate.contactValidations,
              }),
            },
          ],
          details: { leadId },
        };
      },
    };
    const finalGuidance: AgentTool<typeof presentSchema> = {
      name: "present_final_guidance",
      label: "提交报告解读与下一步",
      description:
        "提交基于确定性统计、真实 lead/evidence ID 的报告解读和唯一下一步；必须区分官网事实、验证结果、子 Agent 判断和建议。",
      parameters: presentSchema,
      executionMode: "sequential",
      execute: async (_toolCallId, { message }) => {
        presentedMessage = ensureNextStep(
          message,
          "请审核推荐线索的原文证据和联系人；需要调整搜索时，新建一轮策略会话。",
        );
        return {
          content: [{ type: "text", text: presentedMessage }],
          details: {},
          terminate: true,
        };
      },
    };
    const proposeSkillUpdate: AgentTool = {
      name: "create_skill_proposal",
      label: "创建待审批 Skill 提案",
      description:
        "仅在用户明确要求沉淀经验时，从本次真实 Campaign 创建一项带适用边界的待审批国家 Skill 提案；不会直接修改文件或启用规则。",
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async () => {
        const proposal = await callbacks.createSkillProposal();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                id: proposal.id,
                title: proposal.title,
                status: proposal.status,
              }),
            },
          ],
          details: { proposalId: proposal.id },
        };
      },
    };
    const resumeFailedExecution: AgentTool = {
      name: "resume_failed_execution",
      label: "从失败检查点继续任务",
      description:
        "仅当当前会话 status=failed 且用户明确要求继续、恢复或重试原任务时调用。保留原审批、Campaign ID、已完成查询和公司结果，从失败检查点续跑；不得用于扩大预算或新建 Campaign。",
      parameters: Type.Object({}),
      executionMode: "sequential",
      execute: async () => {
        const resumed = callbacks.resumeFailedExecution();
        presentedMessage =
          "已按你的要求保留原 Campaign 和现有进度，从失败检查点继续执行；已完成公司不会重复分析。\n\n下一步：等待续跑完成，并在进度区查看当前阶段。";
        return {
          content: [{ type: "text", text: presentedMessage }],
          details: { campaignId: resumed.campaignId },
          terminate: true,
        };
      },
    };

    const tools =
      session.status === "drafting" || session.status === "awaiting_approval"
        ? [
            currentStrategy,
            marketContext,
            setTargetCountry,
            searchHistory,
            confirmRerun,
            previewSearch,
            updateStrategy,
            addCustomSection,
            estimateBudget,
            presentForApproval,
          ]
        : session.status === "awaiting_report_review" ||
            session.status === "completed"
          ? [
              currentStrategy,
              campaignSummary,
              leadReport,
              proposeSkillUpdate,
              finalGuidance,
            ]
          : session.status === "failed"
            ? [
                currentStrategy,
                campaignSummary,
                setTargetCountry,
                resumeFailedExecution,
                estimateBudget,
              ]
            : [currentStrategy, estimateBudget];
    const recentHistory = history.slice(-12).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const systemPrompt = ORCHESTRATOR_SYSTEM_PROMPT;
    const text = await this.run(
      "chat",
      systemPrompt,
      JSON.stringify({
        task:
          session.status === "awaiting_report_review" ||
          session.status === "completed"
            ? "解释真实 Campaign 结果并给出销售审核下一步"
            : session.status === "failed"
              ? "解释失败原因；如果用户明确要求原国家原策略继续，调用 resume_failed_execution；如果用户指定不同国家，调用 set_target_country 生成或选择对应 Market Skill，回到草稿重新预览和审批"
            : "与用户协作完善并送审一份可执行、可控预算的真实 B2B 获客策略",
        sessionStatus: session.status,
        currentStrategy: session.strategy,
        countrySearchHistory,
        recentConversation: recentHistory,
        userMessage,
      }),
      tools,
    );
    let latest = callbacks.getSession();
    if (
      latest.status === "drafting" &&
      previewedThisTurn &&
      latest.strategy.search.queries.length
    ) {
      latest = callbacks.markAwaitingApproval(
        text || "查询已经预览完成，请检查策略卡。",
      );
    }
    const nextAction =
      latest.status === "awaiting_approval"
        ? "review_and_approve_strategy"
        : latest.status === "running"
          ? "wait_for_resumed_execution"
        : "reply_to_agent";
    return {
      content: ensureNextStep(
        presentedMessage || text || "我已读取当前策略。",
        nextAction === "review_and_approve_strategy"
          ? "请检查策略卡并点击“确认策略”，或继续告诉我需要修改的内容。"
          : nextAction === "wait_for_resumed_execution"
            ? "等待续跑完成，并在进度区查看当前阶段。"
          : "请回答我提出的问题，或直接修改右侧策略卡。",
      ),
      nextAction,
    };
  }

  private async demoTurn(
    userMessage: string,
    callbacks: MainAgentCallbacks,
  ): Promise<MainAgentTurn> {
    let session = callbacks.getSession();
    if (
      session.status === "awaiting_report_review" ||
      session.status === "completed"
    ) {
      const report = session.report;
      const message = ensureNextStep(
        report?.executiveSummary ?? "任务报告已经生成。",
        report?.recommendedLeadIds.length
          ? `请优先审核线索 ${report.recommendedLeadIds.join("、")} 的原文证据和联系人。`
          : "请调整关键词或目标客户画像后新建一轮任务。",
      );
      return { content: message, nextAction: "review_campaign_report" };
    }
    const normalizedMessage = userMessage.toLowerCase();
    const requestedCountry = listCountryProfiles().find(
      (profile) =>
        profile.id !== session.strategy.skillName &&
        [
          profile.displayName,
          profile.shortName,
          ...profile.aliases,
        ].some((alias) => {
          const normalizedAlias = alias.trim().toLowerCase();
          return (
            (normalizedAlias.length >= 3 ||
              /[^\x00-\x7f]/.test(normalizedAlias)) &&
            normalizedMessage.includes(normalizedAlias)
          );
        }),
    );
    if (
      requestedCountry &&
      (session.status === "drafting" ||
        session.status === "awaiting_approval" ||
        session.status === "failed")
    ) {
      session = await callbacks.setTargetCountry(
        requestedCountry.displayName,
      );
    }
    if (session.status === "approved") {
      return {
        content:
          "策略已经确认，系统正在等待你的明确执行操作。\n\n下一步：点击“开始执行”启动受预算限制的搜索与分析。",
        nextAction: "execute_approved_strategy",
      };
    }
    if (session.status === "failed") {
      if (isResumeExecutionIntent(userMessage)) {
        const resumed = callbacks.resumeFailedExecution();
        return {
          content:
            "已保留原策略、Campaign ID 和现有检查点，从失败位置继续执行；已完成公司不会重复处理。\n\n下一步：等待续跑完成，并在进度区查看当前阶段。",
          nextAction: resumed.campaignId
            ? "wait_for_resumed_execution"
            : "review_error",
        };
      }
      return {
        content: `上一次执行失败：${session.error ?? "未知错误"}\n\n下一步：修复配置或服务问题后，直接回复“继续之前的任务”，我会保留原 Campaign 检查点续跑。`,
        nextAction: "review_error",
      };
    }
    const countryHistory = callbacks.getCountrySearchHistory(
      session.strategy.country,
    );
    const confirmationId = `country-rerun:${session.strategy.skillName}`;
    const alreadyConfirmed = session.strategy.customSections.some(
      (section) => section.id === confirmationId,
    );
    if (countryHistory.realSearchCampaigns > 0 && !alreadyConfirmed) {
      const explicitlyDeclined =
        /不再|不要|不查|否|无需|取消.*(?:查询|搜索)/.test(userMessage);
      const explicitlyConfirmed =
        /确认|同意|再次|重新|重查|继续查|是的|要查/.test(userMessage);
      const queryCount = Number(
        userMessage.match(/(?:查询|搜索|重查)\D{0,8}(\d+)/)?.[1] ??
          userMessage.match(/\b(\d+)\b/)?.[1],
      );
      if (explicitlyDeclined) {
        return {
          content: ensureNextStep(
            `数据库中已有 ${countryHistory.realSearchCampaigns} 次 ${countryHistory.country} 真实搜索记录；已按你的决定停止再次查询。`,
            "如需查看已有结果，请打开对应历史会话；如需重查，请明确说明并给出查询数量。",
          ),
          nextAction: "reply_to_agent",
        };
      }
      if (!explicitlyConfirmed || !Number.isInteger(queryCount)) {
        return {
          content: ensureNextStep(
            `数据库中已有 ${countryHistory.realSearchCampaigns} 次 ${countryHistory.country} 真实搜索记录，最近一次为 ${countryHistory.lastRunAt ?? "未知时间"}，累计保存 ${countryHistory.totalLeads} 条线索。`,
            explicitlyConfirmed
              ? "请明确本次需要执行多少条查询。"
              : "请确认是否再次查询；如果同意，请同时给出本次查询数量。",
          ),
          nextAction: "confirm_country_rerun",
        };
      }
      session = callbacks.updateStrategy((strategy) => ({
        ...applyPatch(strategy, { maxQueries: queryCount }),
        customSections: [
          ...strategy.customSections,
          {
            id: confirmationId,
            title: "历史国家重查确认",
            content: `用户已确认再次查询 ${countryHistory.country}，查询数量 ${queryCount}。`,
            source: "agent",
          },
        ],
      }));
    }
    if (!session.strategy.search.queries.length) {
      const context = await buildCampaignAgentContext(
        session.input,
        session.strategy,
      );
      const plan = await this.runtime.planSearch(
        context.input,
        context.country,
        context.skill,
        context.skillInvocation,
        context,
      );
      callbacks.updateStrategy((strategy) => ({
        ...strategy,
        search: { ...strategy.search, queries: plan.value.queries },
      }));
    }
    const targetRoles = session.strategy.targetCustomer.businessRoles.join(
      "、",
    );
    const message = ensureNextStep(
      `已根据“${userMessage}”检查策略并生成查询预览。当前目标角色为 ${targetRoles || "待确认"}，最多执行 ${session.strategy.budget.maxQueries} 条查询；系统将逐条查询，每轮新增公司全部抓取和分析完成后再继续，并在分组连续低新增时提前停止。`,
      "请检查右侧策略卡；需要修改就继续告诉我，确认无误后点击“确认策略”。",
    );
    callbacks.markAwaitingApproval(message);
    return { content: message, nextAction: "review_and_approve_strategy" };
  }

  async analyzeCampaign(
    session: OrchestratorSession,
    campaign: CampaignResult,
    baseline: OrchestratorReport,
  ): Promise<OrchestratorReport> {
    if (this.runtime.mode === "demo") return baseline;
    let submitted:
      | Pick<
          OrchestratorReport,
          | "executiveSummary"
          | "recommendedLeadIds"
          | "strengths"
          | "risks"
          | "nextSteps"
        >
      | undefined;
    const schema = Type.Object({
      executiveSummary: Type.String({ maxLength: 1600 }),
      recommendedLeadIds: Type.Array(Type.String(), { maxItems: 5 }),
      strengths: Type.Array(Type.String(), { maxItems: 8 }),
      risks: Type.Array(Type.String(), { maxItems: 8 }),
      nextSteps: Type.Array(Type.String(), { minItems: 1, maxItems: 6 }),
    });
    const submit: AgentTool<typeof schema> = {
      name: "submit_campaign_report",
      label: "提交主 Agent 综合报告",
      description:
        "提交不改写确定性统计的 Campaign 综合报告。推荐线索必须引用真实 lead ID、说明证据与风险，下一步必须具体可执行。",
      parameters: schema,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        submitted = params;
        return {
          content: [{ type: "text", text: "综合报告已保存。" }],
          details: { recommended: params.recommendedLeadIds.length },
          terminate: true,
        };
      },
    };
    await this.run(
      "report",
      CAMPAIGN_REPORT_SYSTEM_PROMPT,
      JSON.stringify({
        task:
          "在不改写确定性统计的前提下，生成黄金买家审核优先级、关键风险和可执行下一步",
        approvedStrategy: session.strategy,
        baseline,
        campaign: compactCampaignForMainAgent(campaign),
      }),
      [submit],
      2,
    );
    return submitted ? { ...baseline, ...submitted } : baseline;
  }
}
