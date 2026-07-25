import { randomUUID } from "node:crypto";
import type {
  CampaignInput,
  CampaignStrategy,
  OrchestratorMessage,
  OrchestratorSession,
} from "../domain.js";
import type { AgentRuntime } from "../agents/agent-runtime.js";
import {
  getAgentRuntime,
  getCampaign,
  runApprovedStrategy,
} from "../pipeline.js";
import {
  requireCountry,
  resolveCountry,
} from "../market/registry.js";
import {
  ensureRuntimeMarketCountry,
  type RuntimeMarketCountryInput,
} from "../market/runtime-market.js";
import {
  approveMarketPolicy,
  createGeneratedMarketPolicy,
  getApprovedMarketPolicy,
  getMarketPolicy,
  listMarketPolicies,
  markMarketPolicyReviewed,
  marketPolicyRef,
  rejectMarketPolicy,
} from "../market/policy.js";
import { AppDatabase, getDatabase } from "../storage/database.js";
import {
  CampaignOrchestratorAgent,
  isResumeExecutionIntent,
  type CountrySearchHistory,
} from "./main-agent.js";
import { createDeterministicReport } from "./report-view.js";
import { logger, runWithLogContext } from "../logging/logger.js";
import {
  assertStrategy,
  clampStrategy,
  createDefaultStrategy,
  strategyHash,
} from "./strategy-template.js";

type ApprovedStrategyRunner = typeof runApprovedStrategy;

function now(): string {
  return new Date().toISOString();
}

function requireEditable(session: OrchestratorSession): void {
  if (
    session.status !== "drafting" &&
    session.status !== "awaiting_approval" &&
    session.status !== "failed"
  ) {
    throw new Error("当前会话状态不允许修改策略");
  }
}

export class OrchestratorService {
  private readonly mainAgent: CampaignOrchestratorAgent;
  private readonly runningJobs = new Set<string>();
  private readonly chattingSessions = new Set<string>();

  constructor(
    private readonly database: AppDatabase = getDatabase(),
    runtime: AgentRuntime = getAgentRuntime(),
    private readonly strategyRunner: ApprovedStrategyRunner = runApprovedStrategy,
  ) {
    this.mainAgent = new CampaignOrchestratorAgent(runtime);
    for (const session of this.database.listOrchestratorSessions()) {
      if (session.status === "running") {
        if (
          session.campaignId &&
          session.approvalId &&
          session.approvedStrategyHash === session.strategyHash
        ) {
          logger.warn(
            "orchestrator.session.resuming",
            "服务启动时恢复未完成任务",
            {
              previousPhase: session.runPhase,
              strategyVersion: session.strategyVersion,
            },
            { sessionId: session.id, campaignId: session.campaignId },
          );
          this.runningJobs.add(session.id);
          queueMicrotask(() => {
            void runWithLogContext(
              { sessionId: session.id, campaignId: session.campaignId },
              () => this.execute(session),
            );
          });
          continue;
        }
        logger.warn(
          "orchestrator.session.interrupted",
          "服务启动时发现未完成任务",
          {
            previousPhase: session.runPhase,
            strategyVersion: session.strategyVersion,
          },
          { sessionId: session.id, campaignId: session.campaignId },
        );
        this.save({
          ...session,
          status: "failed",
          error: "服务重启中断了上一次运行，请确认策略后重新执行",
          runPhase: undefined,
          updatedAt: now(),
        });
      }
    }
  }

  async prepareTargetCountry(countryInput: string): Promise<void> {
    const existing = resolveCountry(countryInput);
    if (existing) {
      try {
        getApprovedMarketPolicy(existing.id);
        return;
      } catch {
        createGeneratedMarketPolicy(existing, {
          queryPatterns: ["{product} distributor {city}"],
          validationSignals: [
            `official address or telephone in ${existing.displayName}`,
            `${existing.domainSuffix} company domain`,
          ],
          exclusions: [
            "consumer marketplaces",
            "directories without an official company website",
            "unrelated retail or repair-only services",
          ],
        });
        throw new Error(
          `已导入 ${existing.displayName} 的旧国家配置为 MarketPolicy 草稿；请先让主 Agent 审阅并由用户批准`,
        );
      }
    }
    const generatedProfile =
      await this.mainAgent.bootstrapMarketCountry(countryInput);
    await ensureRuntimeMarketCountry({
      ...generatedProfile,
      aliases: [countryInput, ...generatedProfile.aliases],
    });
  }

  private save(session: OrchestratorSession): OrchestratorSession {
    const previous = this.database.getOrchestratorSession(session.id);
    this.database.saveOrchestratorSession(session);
    if (
      !previous ||
      previous.status !== session.status ||
      previous.runPhase !== session.runPhase ||
      previous.strategyVersion !== session.strategyVersion
    ) {
      logger.info(
        "orchestrator.session.state_changed",
        undefined,
        {
          previousStatus: previous?.status,
          status: session.status,
          previousPhase: previous?.runPhase,
          runPhase: session.runPhase,
          strategyVersion: session.strategyVersion,
          strategyHash: session.strategyHash,
          hasApproval: Boolean(session.approvalId),
          hasReport: Boolean(session.report),
        },
        { sessionId: session.id, campaignId: session.campaignId },
      );
    }
    return session;
  }

  private addMessage(
    sessionId: string,
    role: OrchestratorMessage["role"],
    content: string,
    nextAction?: string,
  ): OrchestratorMessage {
    const message: OrchestratorMessage = {
      id: randomUUID(),
      sessionId,
      role,
      content,
      nextAction,
      createdAt: now(),
    };
    this.database.createOrchestratorMessage(message);
    const current = this.getSession(sessionId);
    this.save({ ...current, updatedAt: message.createdAt });
    logger.info(
      "orchestrator.message.saved",
      undefined,
      {
        role,
        characterCount: content.length,
        nextAction,
      },
      { sessionId },
    );
    return message;
  }

  async createSession(input: CampaignInput): Promise<{
    session: OrchestratorSession;
    messages: OrchestratorMessage[];
  }> {
    await this.prepareTargetCountry(input.country);
    const strategy = clampStrategy(await createDefaultStrategy(input));
    assertStrategy(strategy);
    const createdAt = now();
    const session: OrchestratorSession = {
      id: randomUUID(),
      status: "drafting",
      input: {
        product: strategy.product,
        country: strategy.country,
        language: strategy.language,
      },
      strategy,
      strategyVersion: 1,
      strategyHash: strategyHash(strategy),
      createdAt,
      updatedAt: createdAt,
    };
    this.save(session);
    this.database.saveStrategyVersion(
      session.id,
      session.strategyVersion,
      session.strategyHash,
      session.strategy,
    );
    this.addMessage(
      session.id,
      "assistant",
      "我已根据目标产品和国家加载生产获客策略。执行前会与你确认买家角色/应用场景、搜索覆盖、排除条件、验证门槛和预算；任何付费搜索都需要你先批准。\n\n下一步：请说明最优先寻找的买家类型或产品应用场景；若当前模板已准确，也可以让我直接生成查询预览。",
      "reply_to_agent",
    );
    logger.info(
      "orchestrator.session.created",
      undefined,
      {
        product: session.input.product,
        country: session.input.country,
        language: session.input.language,
        strategyVersion: session.strategyVersion,
        strategyHash: session.strategyHash,
        marketPolicyRef: strategy.marketPolicyRef,
        budget: strategy.budget,
      },
      { sessionId: session.id },
    );
    return {
      session: this.getSession(session.id),
      messages: this.database.listOrchestratorMessages(session.id),
    };
  }

  getSession(id: string): OrchestratorSession {
    const session = this.database.getOrchestratorSession(id);
    if (!session) throw new Error("主 Agent 会话不存在");
    return session;
  }

  listSessions(): OrchestratorSession[] {
    return this.database.listOrchestratorSessions();
  }

  listMarketPolicies(marketId?: string) {
    return listMarketPolicies(marketId);
  }

  getMarketPolicy(marketId: string, version: string) {
    return getMarketPolicy(marketId, version);
  }

  async reviewMarketPolicy(marketId: string, version: string) {
    const policy = getMarketPolicy(marketId, version);
    const notes = await this.mainAgent.reviewMarketPolicy(policy);
    return markMarketPolicyReviewed(marketId, version, notes);
  }

  approveMarketPolicy(marketId: string, version: string) {
    const approved = approveMarketPolicy(marketId, version);
    for (const session of this.database.listOrchestratorSessions()) {
      let sessionCountryId: string;
      try {
        sessionCountryId = requireCountry(session.strategy.country).id;
      } catch {
        continue;
      }
      if (
        sessionCountryId !== marketId ||
        session.strategy.marketPolicyRef?.hash === approved.hash ||
        session.status === "running" ||
        session.status === "awaiting_report_review" ||
        session.status === "completed"
      ) {
        continue;
      }
      const strategy = clampStrategy({
        ...session.strategy,
        schemaVersion: 2,
        marketPolicyRef: marketPolicyRef(approved),
        search: { ...session.strategy.search, queries: [] },
      });
      const updated: OrchestratorSession = {
        ...session,
        strategy,
        strategyVersion: session.strategyVersion + 1,
        strategyHash: strategyHash(strategy),
        status: "drafting",
        approvedStrategyHash: undefined,
        approvalId: undefined,
        approvedAt: undefined,
        campaignId: undefined,
        report: undefined,
        error: undefined,
        updatedAt: now(),
      };
      this.save(updated);
      this.database.saveStrategyVersion(
        updated.id,
        updated.strategyVersion,
        updated.strategyHash,
        updated.strategy,
      );
    }
    return approved;
  }

  rejectMarketPolicy(marketId: string, version: string) {
    return rejectMarketPolicy(marketId, version);
  }

  getSessionView(id: string): {
    session: OrchestratorSession;
    messages: OrchestratorMessage[];
  } {
    const session = this.getSession(id);
    const messages = this.database.listOrchestratorMessages(id);
    logger.info(
      "orchestrator.session.loaded",
      undefined,
      {
        status: session.status,
        messageCount: messages.length,
        strategyVersion: session.strategyVersion,
        hasCampaign: Boolean(session.campaignId),
      },
      { sessionId: id, campaignId: session.campaignId },
    );
    return { session, messages };
  }

  updateStrategy(
    sessionId: string,
    mutate: (strategy: CampaignStrategy) => CampaignStrategy,
  ): OrchestratorSession {
    const current = this.getSession(sessionId);
    requireEditable(current);
    const strategy = clampStrategy(mutate(current.strategy));
    assertStrategy(strategy);
    const updated: OrchestratorSession = {
      ...current,
      input: {
        product: strategy.product,
        country: strategy.country,
        language: strategy.language,
      },
      strategy,
      strategyVersion: current.strategyVersion + 1,
      strategyHash: strategyHash(strategy),
      status: "drafting",
      runPhase: current.status === "failed" ? undefined : current.runPhase,
      approvedStrategyHash: undefined,
      approvalId: undefined,
      approvedAt: undefined,
      campaignId: current.status === "failed" ? undefined : current.campaignId,
      report: current.status === "failed" ? undefined : current.report,
      error: undefined,
      updatedAt: now(),
    };
    this.save(updated);
    this.database.saveStrategyVersion(
      updated.id,
      updated.strategyVersion,
      updated.strategyHash,
      updated.strategy,
    );
    logger.info(
      "orchestrator.strategy.updated",
      undefined,
      {
        previousVersion: current.strategyVersion,
        strategyVersion: updated.strategyVersion,
        strategyHash: updated.strategyHash,
        keywordCount: updated.strategy.search.requiredKeywords.length,
        queryCount: updated.strategy.search.queries.length,
        targetRoles: updated.strategy.targetCustomer.businessRoles,
        excludedDomainCount: updated.strategy.exclusions.domains.length,
        budget: updated.strategy.budget,
      },
      { sessionId },
    );
    return updated;
  }

  private async setTargetCountry(
    sessionId: string,
    countryInput: string,
    generatedProfile?: RuntimeMarketCountryInput,
  ): Promise<OrchestratorSession> {
    let profile = resolveCountry(countryInput);
    let marketPolicy;
    if (!profile) {
      if (!generatedProfile) {
        throw new Error(
          `国家“${countryInput}”尚未注册，必须先提供完整国家配置以生成 MarketPolicy 草稿`,
        );
      }
      const generated = await ensureRuntimeMarketCountry({
        ...generatedProfile,
        aliases: [countryInput, ...generatedProfile.aliases],
      });
      profile = generated.profile;
      marketPolicy = generated.marketPolicy;
    } else {
      marketPolicy = getApprovedMarketPolicy(profile.id);
    }
    if (marketPolicy.status !== "approved") {
      throw new Error(
        `市场规则包 ${profile.id}@${marketPolicy.version} 等待用户批准`,
      );
    }
    const previous = requireCountry(this.getSession(sessionId).strategy.country);
    return this.updateStrategy(sessionId, (strategy) => ({
      ...strategy,
      country: profile.displayName,
      objective: strategy.objective.replaceAll(
        previous.displayName,
        profile.displayName,
      ),
      search: {
        ...strategy.search,
        localLanguageKeywords: [],
        cities: [...profile.cities.slice(0, 3)],
        queries: [],
      },
      schemaVersion: 2,
      marketPolicyRef: marketPolicyRef(marketPolicy),
      customSections: strategy.customSections.filter(
        (section) => !section.id.startsWith("country-rerun:"),
      ),
    }));
  }

  replaceStrategy(
    sessionId: string,
    strategy: CampaignStrategy,
  ): OrchestratorSession {
    return this.updateStrategy(sessionId, () => strategy);
  }

  private markAwaitingApproval(
    sessionId: string,
    _message: string,
  ): OrchestratorSession {
    const current = this.getSession(sessionId);
    requireEditable(current);
    if (!current.strategy.search.queries.length) {
      throw new Error("策略尚未生成查询预览");
    }
    return this.save({
      ...current,
      status: "awaiting_approval",
      updatedAt: now(),
    });
  }

  private getCountrySearchHistory(country: string): CountrySearchHistory {
    const targetCountry = requireCountry(country);
    const campaigns = this.database
      .listCampaigns()
      .filter((campaign) => {
        if (campaign.searchMode !== "serper") return false;
        try {
          return requireCountry(campaign.country).id === targetCountry.id;
        } catch {
          return false;
        }
      });
    const domains = new Set(
      campaigns.flatMap((campaign) =>
        campaign.leads.map((lead) => lead.candidate.domain),
      ),
    );
    return {
      country: targetCountry.displayName,
      realSearchCampaigns: campaigns.length,
      lastRunAt: campaigns[0]?.completedAt,
      totalQueries: campaigns.reduce(
        (sum, campaign) =>
          sum +
          (campaign.discovery?.progress?.executedQueries ??
            campaign.discovery?.plan.queries.length ??
            0),
        0,
      ),
      totalSearchHits: campaigns.reduce(
        (sum, campaign) => sum + (campaign.discovery?.hits.length ?? 0),
        0,
      ),
      totalLeads: campaigns.reduce(
        (sum, campaign) => sum + campaign.leads.length,
        0,
      ),
      uniqueDomains: domains.size,
      recentRuns: campaigns.slice(0, 5).map((campaign) => ({
        campaignId: campaign.id,
        product: campaign.product,
        completedAt: campaign.completedAt,
        queryCount:
          campaign.discovery?.progress?.executedQueries ??
          campaign.discovery?.plan.queries.length ??
          0,
        searchHits: campaign.discovery?.hits.length ?? 0,
        leadCount: campaign.leads.length,
      })),
    };
  }

  private async completeChat(
    sessionId: string,
    content: string,
    history: OrchestratorMessage[],
  ): Promise<{
    session: OrchestratorSession;
    message: OrchestratorMessage;
  }> {
    const initial = this.getSession(sessionId);
    const turn = await runWithLogContext(
      { sessionId, campaignId: initial.campaignId },
      () =>
        this.mainAgent.chat(content.trim(), history, {
          getSession: () => this.getSession(sessionId),
          updateStrategy: (mutate) =>
            this.updateStrategy(sessionId, mutate),
          markAwaitingApproval: (message) =>
            this.markAwaitingApproval(sessionId, message),
          getCampaign: () => {
            const session = this.getSession(sessionId);
            return session.campaignId
              ? getCampaign(session.campaignId)
              : undefined;
          },
          getCountrySearchHistory: (country) =>
            this.getCountrySearchHistory(country),
          setTargetCountry: (country, generatedProfile) =>
            this.setTargetCountry(sessionId, country, generatedProfile),
          resumeFailedExecution: () =>
            this.resumeExecution(sessionId, false),
        }),
    );
    const message = this.addMessage(
      sessionId,
      "assistant",
      turn.content,
      turn.nextAction,
    );
    logger.info(
      "orchestrator.chat.completed",
      undefined,
      {
        status: this.getSession(sessionId).status,
        responseCharacters: turn.content.length,
        nextAction: turn.nextAction,
      },
      { sessionId, campaignId: this.getSession(sessionId).campaignId },
    );
    return { session: this.getSession(sessionId), message };
  }

  async chat(
    sessionId: string,
    content: string,
  ): Promise<{
    session: OrchestratorSession;
    message: OrchestratorMessage;
  }> {
    if (!content.trim()) throw new Error("消息不能为空");
    const initial = this.getSession(sessionId);
    if (initial.status === "running") {
      throw new Error("任务执行中，请等待当前阶段完成");
    }
    if (this.chattingSessions.has(sessionId)) {
      throw new Error("主 Agent 正在处理上一条消息，请稍候");
    }
    this.chattingSessions.add(sessionId);
    try {
      if (
        initial.status === "failed" &&
        isResumeExecutionIntent(content.trim())
      ) {
        this.addMessage(sessionId, "user", content.trim());
        const resumed = this.resumeExecution(sessionId, false);
        const message = this.addMessage(
          sessionId,
          "assistant",
          "已保留原策略、Campaign ID 和现有检查点，从失败位置继续执行；已完成公司不会重复处理。\n\n下一步：等待续跑完成，并在进度区查看当前阶段。",
          "wait_for_resumed_execution",
        );
        return { session: resumed, message };
      }
      const history = this.database.listOrchestratorMessages(sessionId);
      logger.info(
        "orchestrator.chat.started",
        undefined,
        {
          status: initial.status,
          messageCharacters: content.trim().length,
          historyMessages: history.length,
        },
        { sessionId, campaignId: initial.campaignId },
      );
      this.addMessage(sessionId, "user", content.trim());
      return await this.completeChat(sessionId, content.trim(), history);
    } finally {
      this.chattingSessions.delete(sessionId);
    }
  }

  async resumeChat(sessionId: string): Promise<{
    session: OrchestratorSession;
    message: OrchestratorMessage;
  }> {
    const session = this.getSession(sessionId);
    if (session.status === "running") {
      throw new Error("任务执行中，不能恢复聊天");
    }
    if (this.chattingSessions.has(sessionId)) {
      throw new Error("主 Agent 正在处理上一条消息，请稍候");
    }
    const history = this.database.listOrchestratorMessages(sessionId);
    const pendingMessage = history.at(-1);
    if (!pendingMessage || pendingMessage.role !== "user") {
      throw new Error("当前会话没有待恢复的用户消息");
    }
    this.chattingSessions.add(sessionId);
    logger.warn(
      "orchestrator.chat.resumed",
      "恢复服务中断前未完成的主 Agent 对话",
      {
        pendingMessageId: pendingMessage.id,
        messageCharacters: pendingMessage.content.length,
        historyMessages: history.length - 1,
      },
      { sessionId, campaignId: session.campaignId },
    );
    try {
      return await this.completeChat(
        sessionId,
        pendingMessage.content,
        history.slice(0, -1),
      );
    } finally {
      this.chattingSessions.delete(sessionId);
    }
  }

  approveStrategy(sessionId: string, expectedHash: string): OrchestratorSession {
    const current = this.getSession(sessionId);
    if (current.status !== "awaiting_approval") {
      throw new Error("策略尚未进入待确认状态");
    }
    if (current.strategyHash !== expectedHash) {
      throw new Error("策略已发生变化，请重新检查后确认");
    }
    assertStrategy(current.strategy);
    if (!current.strategy.search.queries.length) {
      throw new Error("策略缺少查询预览");
    }
    const approvedAt = now();
    const updated = this.save({
      ...current,
      status: "approved",
      approvedStrategyHash: current.strategyHash,
      approvalId: randomUUID(),
      approvedAt,
      updatedAt: approvedAt,
    });
    this.database.saveStrategyVersion(
      updated.id,
      updated.strategyVersion,
      updated.strategyHash,
      updated.strategy,
      approvedAt,
    );
    this.addMessage(
      sessionId,
      "assistant",
      "策略已由你确认，系统尚未执行搜索。执行后将逐轮完成本地化查询、官网去重与抓取、独立公司尽调和资格复核，并在每轮保存进度。\n\n下一步：点击“开始执行”启动本次真实搜索与分析。",
      "execute_approved_strategy",
    );
    logger.info(
      "orchestrator.strategy.approved",
      undefined,
      {
        strategyVersion: updated.strategyVersion,
        strategyHash: updated.strategyHash,
        approvalId: updated.approvalId,
        queryCount: updated.strategy.search.queries.length,
        budget: updated.strategy.budget,
      },
      { sessionId },
    );
    return updated;
  }

  startExecution(sessionId: string): OrchestratorSession {
    const current = this.getSession(sessionId);
    if (current.status !== "approved") throw new Error("策略尚未确认");
    if (
      !current.approvalId ||
      current.approvedStrategyHash !== current.strategyHash
    ) {
      throw new Error("审批凭据与当前策略不一致");
    }
    if (this.runningJobs.has(sessionId)) throw new Error("任务已在执行");
    const running = this.save({
      ...current,
      status: "running",
      runPhase: "planning",
      campaignId: randomUUID(),
      error: undefined,
      updatedAt: now(),
    });
    this.runningJobs.add(sessionId);
    logger.info(
      "orchestrator.execution.started",
      undefined,
      {
        approvalId: running.approvalId,
        strategyHash: running.strategyHash,
        budget: running.strategy.budget,
      },
      { sessionId },
    );
    void runWithLogContext({ sessionId }, () => this.execute(running));
    return running;
  }

  resumeExecution(
    sessionId: string,
    announce = true,
  ): OrchestratorSession {
    const current = this.getSession(sessionId);
    if (current.status !== "failed") {
      throw new Error("只有执行失败的任务可以从检查点继续");
    }
    if (
      !current.approvalId ||
      current.approvedStrategyHash !== current.strategyHash
    ) {
      throw new Error("原审批凭据已失效，不能继续执行");
    }
    if (!current.campaignId) {
      throw new Error("失败任务缺少 Campaign 检查点");
    }
    if (this.runningJobs.has(sessionId)) throw new Error("任务已在执行");
    const running = this.save({
      ...current,
      status: "running",
      runPhase: "planning",
      report: undefined,
      error: undefined,
      updatedAt: now(),
    });
    this.runningJobs.add(sessionId);
    if (announce) {
      this.addMessage(
        sessionId,
        "assistant",
        "已保留原策略、Campaign ID 和已完成进度，并从失败检查点继续执行；已成功分析的公司不会重复处理。\n\n下一步：等待当前任务完成，期间可以在进度区查看续跑状态。",
        "wait_for_resumed_execution",
      );
    }
    logger.info(
      "orchestrator.execution.resumed",
      undefined,
      {
        approvalId: running.approvalId,
        strategyHash: running.strategyHash,
        campaignId: running.campaignId,
      },
      { sessionId, campaignId: running.campaignId },
    );
    queueMicrotask(() => {
      void runWithLogContext(
        { sessionId, campaignId: running.campaignId },
        () => this.execute(running),
      );
    });
    return this.getSession(sessionId);
  }

  private async execute(session: OrchestratorSession): Promise<void> {
    try {
      this.save({
        ...this.getSession(session.id),
        runPhase: "discovering",
        updatedAt: now(),
      });
      const campaign = await this.strategyRunner(
        session.strategy,
        (phase) => {
          this.save({
            ...this.getSession(session.id),
            runPhase: phase,
            updatedAt: now(),
          });
        },
        session.campaignId,
      );
      this.save({
        ...this.getSession(session.id),
        campaignId: campaign.id,
        runPhase: "summarizing",
        updatedAt: now(),
      });
      const current = this.getSession(session.id);
      const baseline = createDeterministicReport(current, campaign);
      const report = await this.mainAgent.analyzeCampaign(
        current,
        campaign,
        baseline,
      );
      this.save({
        ...this.getSession(session.id),
        status: "awaiting_report_review",
        runPhase: undefined,
        campaignId: campaign.id,
        report,
        updatedAt: now(),
      });
      this.addMessage(
        session.id,
        "assistant",
        `${report.executiveSummary}\n\n下一步：请打开综合报告，优先审核推荐线索的原文证据；确认报告后再决定触达或调整下一轮策略。`,
        "review_campaign_report",
      );
      logger.info(
        "orchestrator.execution.completed",
        undefined,
        {
          leadCount: campaign.leads.length,
          reportRecommendedLeads: report.recommendedLeadIds.length,
          qualificationSummary: report.qualificationSummary,
          searchSummary: report.searchSummary,
        },
        { sessionId: session.id, campaignId: campaign.id },
      );
    } catch (error) {
      this.save({
        ...this.getSession(session.id),
        status: "failed",
        runPhase: undefined,
        error: error instanceof Error ? error.message : "未知执行错误",
        updatedAt: now(),
      });
      this.addMessage(
        session.id,
        "assistant",
        `任务执行失败：${error instanceof Error ? error.message : "未知错误"}\n\n已保存当前 Campaign 检查点。修复配置或服务问题后，可在对话中告诉我“继续之前的任务”，或点击“从检查点继续”。`,
        "review_error",
      );
      logger.error(
        "orchestrator.execution.failed",
        error,
        {
          runPhase: this.getSession(session.id).runPhase,
        },
        { sessionId: session.id, campaignId: session.campaignId },
      );
    } finally {
      this.runningJobs.delete(session.id);
    }
  }

  confirmReport(sessionId: string): OrchestratorSession {
    const current = this.getSession(sessionId);
    if (current.status !== "awaiting_report_review") {
      throw new Error("当前没有待确认的综合报告");
    }
    const completed = this.save({
      ...current,
      status: "completed",
      updatedAt: now(),
    });
    this.addMessage(
      sessionId,
      "assistant",
      "本次 Campaign 已归档，搜索统计、公司证据、资格结论和触达草稿均已保存。\n\n下一步：先审核推荐线索的官网证据、联系人验证和触达风险，再决定是否批准发送；若命中偏离目标，可新建会话调整画像、关键词或排除条件。",
      "review_leads_or_start_new_session",
    );
    logger.info(
      "orchestrator.report.confirmed",
      undefined,
      {
        recommendedLeadCount:
          completed.report?.recommendedLeadIds.length ?? 0,
      },
      { sessionId, campaignId: completed.campaignId },
    );
    return completed;
  }
}

let singleton: OrchestratorService | undefined;

export function getOrchestratorService(): OrchestratorService {
  singleton ??= new OrchestratorService();
  return singleton;
}
