import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "./agent-runtime.js";
import type { CampaignAgentContext } from "./agent-runtime.js";
import { getMarketSkillRegistry } from "./agent-skills/registry.js";
import { requireCountry } from "./countries/registry.js";
import { crawlCandidate } from "./crawler.js";
import { DemoAgentRuntime } from "./demo-agent-runtime.js";
import { demoCandidates } from "./demo-data.js";
import {
  createDiscoveryProgress,
  discoverCompanies,
  executeDiscoveryRound,
} from "./discovery/discovery-service.js";
import { buildCampaignAgentContext } from "./discovery/query-planner.js";
import { SerperClient } from "./discovery/serper-client.js";
import {
  appendBrandFingerprints,
  resolveQueryGroupId,
} from "./discovery/query-exclusions.js";
import {
  isTransientError,
  mapWithConcurrency,
  positiveIntegerFromEnv,
  withRetry,
} from "./concurrency.js";
import type {
  CampaignInput,
  CompanyAnalysisFailure,
  CampaignResult,
  CampaignStrategy,
  CompanyCandidate,
  DiscoveryRound,
  DiscoveryRun,
  LeadRecord,
  LeadStatus,
  OrchestratorRunPhase,
  SearchPlan,
} from "./domain.js";
import { PiAgentRuntime } from "./pi-agent-runtime.js";
import { getDatabase } from "./storage/database.js";
import { logger, runWithLogContext } from "./logging/logger.js";
import { validateContactCandidates } from "./validation/contact-validator.js";
import { validateCompanyCountry } from "./validation/country-validator.js";

export const DEFAULT_COMPANY_ANALYSIS_CONCURRENCY = 50;
export const DEFAULT_COMPANY_ANALYSIS_ACTIVE_LIMIT = 12;

let runtime: AgentRuntime | undefined;

export function getAgentRuntime(): AgentRuntime {
  if (runtime) return runtime;
  const mode = (process.env.PI_AGENT_MODE ?? "live").toLowerCase();
  if (mode !== "live" && mode !== "demo") {
    throw new Error(`不支持的 PI_AGENT_MODE：${mode}`);
  }
  runtime = mode === "demo" ? new DemoAgentRuntime() : new PiAgentRuntime();
  return runtime;
}

async function processCandidate(
  candidate: CompanyCandidate,
  activeRuntime: AgentRuntime,
  context?: CampaignAgentContext,
  campaignId?: string,
): Promise<LeadRecord> {
  const started = performance.now();
  logger.info("pipeline.candidate.started", undefined, {
    domain: candidate.domain,
    pageCount: candidate.pages.length,
    contactCandidateCount: candidate.contactCandidates.length,
  });
  const analysis = await activeRuntime.analyzeCompany(candidate, context);
  logger.info("agent.trace.recorded", undefined, analysis.trace, {
    agent: analysis.trace.agent,
    campaignId,
  });
  if (candidate.contactValidations) {
    analysis.value.research.contacts = analysis.value.research.contacts.map((contact) => {
      const validation = candidate.contactValidations?.find(
        (item) => item.value === contact.value,
      );
      return {
        ...contact,
        verified: false,
        validation,
      };
    });
  }
  const { research, qualification, outreach } = analysis.value;
  const status: LeadStatus =
    qualification.confidence < 0.8
      ? "needs_review"
      : qualification.isQualified
        ? "qualified"
        : "rejected";

  const lead: LeadRecord = {
    id: randomUUID(),
    candidate,
    research,
    qualification,
    outreach,
    traces: [analysis.trace],
    status,
    createdAt: new Date().toISOString(),
  };
  logger.info(
    "pipeline.candidate.completed",
    undefined,
    {
      domain: candidate.domain,
      leadId: lead.id,
      status,
      businessRole: qualification.businessRole,
      productFitScore: qualification.productFitScore,
      scaleScore: qualification.scaleScore,
      confidence: qualification.confidence,
      evidenceCount: research.evidence.length,
      resolvedContactCount: research.contacts.length,
      countryValidationScore: candidate.countryValidation?.score,
      countryMatched: candidate.countryValidation?.matched,
      contactValidationCount: candidate.contactValidations?.length ?? 0,
      highConfidenceContacts:
        candidate.contactValidations?.filter(
          (contact) => contact.confidence >= 0.75,
        ).length ?? 0,
      durationMs: Math.round(performance.now() - started),
    },
    { campaignId, leadId: lead.id },
  );
  return lead;
}

export async function runCampaign(
  input: CampaignInput,
  candidates: CompanyCandidate[],
  options: {
    searchMode?: CampaignResult["searchMode"];
    discovery?: DiscoveryRun;
    context?: CampaignAgentContext;
    campaignId?: string;
    runtime?: AgentRuntime;
    finalize?: boolean;
  } = {},
): Promise<CampaignResult> {
  const activeRuntime = options.runtime ?? getAgentRuntime();
  const database = getDatabase();
  const campaignId = options.campaignId ?? randomUUID();
  const previous = database.getCampaign(campaignId);
  const startedAt = previous?.startedAt ?? new Date().toISOString();
  const leads: LeadRecord[] = [...(previous?.leads ?? [])];
  const completedCandidateIds = new Set(
    leads.map((lead) => lead.candidate.id),
  );
  const completedDomains = new Set(
    leads.map((lead) => lead.candidate.domain.toLowerCase()),
  );
  const workCandidates = candidates.filter(
    (candidate) =>
      !completedCandidateIds.has(candidate.id) &&
      !completedDomains.has(candidate.domain.toLowerCase()),
  );
  const workCandidateIds = new Set(
    workCandidates.map((candidate) => candidate.id),
  );
  const workDomains = new Set(
    workCandidates.map((candidate) => candidate.domain.toLowerCase()),
  );
  const analysisFailures: CompanyAnalysisFailure[] = (
    previous?.analysisFailures ?? []
  ).filter(
    (failure) =>
      !workCandidateIds.has(failure.candidateId) &&
      !workDomains.has(failure.domain.toLowerCase()),
  );
  const queueByDomain = new Map(
    (previous?.candidateQueue ?? []).map((candidate) => [
      candidate.domain.toLowerCase(),
      candidate,
    ]),
  );
  for (const candidate of candidates) {
    queueByDomain.set(candidate.domain.toLowerCase(), candidate);
  }
  const requestedAnalysisConcurrency = positiveIntegerFromEnv(
    "COMPANY_ANALYSIS_CONCURRENCY",
    DEFAULT_COMPANY_ANALYSIS_CONCURRENCY,
  );
  const analysisActiveLimit = positiveIntegerFromEnv(
    "COMPANY_ANALYSIS_ACTIVE_LIMIT",
    DEFAULT_COMPANY_ANALYSIS_ACTIVE_LIMIT,
  );
  const analysisConcurrency = Math.min(
    requestedAnalysisConcurrency,
    analysisActiveLimit,
  );
  const configuredRetries = Number(process.env.COMPANY_ANALYSIS_RETRIES);
  const analysisRetries =
    Number.isFinite(configuredRetries) && configuredRetries >= 0
      ? Math.floor(configuredRetries)
      : 2;
  const campaign: CampaignResult = {
    id: campaignId,
    ...input,
    mode: activeRuntime.mode,
    startedAt,
    completedAt: startedAt,
    leads,
    searchMode: options.searchMode ?? "demo",
    discovery: options.discovery ?? previous?.discovery,
    analysisFailures,
    candidateQueue: [...queueByDomain.values()],
  };
  const finalize = options.finalize ?? true;
  logger.info(
    finalize ? "pipeline.campaign.started" : "pipeline.campaign.batch_started",
    undefined,
    {
      product: input.product,
      country: input.country,
      language: input.language,
      candidateCount: candidates.length,
      resumedCandidateCount: workCandidates.length,
      alreadyCompletedCount: leads.length,
      searchMode: options.searchMode ?? "demo",
      agentMode: activeRuntime.mode,
      requestedAnalysisConcurrency,
      analysisActiveLimit,
      analysisConcurrency,
      analysisRetries,
    },
    { campaignId },
  );
  database.saveCampaign(campaign);

  let lastLoggedCompleted = 0;
  await mapWithConcurrency(
    workCandidates,
    analysisConcurrency,
    async (candidate) => {
      const companyProgress = campaign.discovery?.companies?.find(
        (company) =>
          company.candidateId === candidate.id ||
          company.domain === candidate.domain,
      );
      const analysisStartedAt = new Date();
      if (companyProgress) {
        if (
          companyProgress.status === "analyzing" ||
          companyProgress.status === "analysis_failed"
        ) {
          companyProgress.retryCount += 1;
        }
        companyProgress.status = "analyzing";
        companyProgress.analysisStartedAt = analysisStartedAt.toISOString();
        companyProgress.error = undefined;
        database.saveCampaign(campaign);
      }
      try {
        const lead = await withRetry(
          () =>
            runWithLogContext(
              {
                campaignId,
                companyId: candidate.id,
                domain: candidate.domain,
              },
              () =>
                processCandidate(
                  candidate,
                  activeRuntime,
                  options.context,
                  campaignId,
                ),
            ),
          {
            retries: analysisRetries,
            baseDelayMs: 1_000,
            shouldRetry: isTransientError,
            onRetry: (error, retryNumber, delayMs) => {
              if (companyProgress) companyProgress.retryCount += 1;
              logger.warn(
                "pipeline.candidate.retry_scheduled",
                error instanceof Error ? error.message : String(error),
                {
                  domain: candidate.domain,
                  retryNumber,
                  delayMs,
                },
                { campaignId, companyId: candidate.id },
              );
            },
          },
        );
        leads.push(lead);
        if (companyProgress) {
          companyProgress.status = "analyzed";
          companyProgress.analysisCompletedAt = new Date().toISOString();
          companyProgress.analysisDurationMs =
            new Date(companyProgress.analysisCompletedAt).getTime() -
            analysisStartedAt.getTime();
        }
      } catch (error) {
        analysisFailures.push({
          candidateId: candidate.id,
          domain: candidate.domain,
          stage: "analysis",
          message: error instanceof Error ? error.message : String(error),
          failedAt: new Date().toISOString(),
        });
        if (companyProgress) {
          companyProgress.status = "analysis_failed";
          companyProgress.analysisCompletedAt = new Date().toISOString();
          companyProgress.analysisDurationMs =
            new Date(companyProgress.analysisCompletedAt).getTime() -
            analysisStartedAt.getTime();
          companyProgress.error =
            error instanceof Error ? error.message : String(error);
        }
        logger.error(
          "pipeline.candidate.failed",
          error,
          { domain: candidate.domain },
          { campaignId },
        );
      } finally {
        campaign.completedAt = new Date().toISOString();
        database.saveCampaign(campaign);
        logger.info(
          "pipeline.campaign.checkpointed",
          undefined,
          {
            completedCompanies: leads.length + analysisFailures.length,
            succeededCompanies: leads.length,
            failedCompanies: analysisFailures.length,
            candidateCount: campaign.candidateQueue?.length ?? candidates.length,
          },
          { campaignId },
        );
      }
    },
    ({ active, completed, total }) => {
      if (completed === lastLoggedCompleted) return;
      lastLoggedCompleted = completed;
      logger.info(
        "pipeline.analysis.progress",
        undefined,
        { active, completed, total, analysisConcurrency },
        { campaignId },
      );
    },
  );

  leads.sort((left, right) => {
    if (left.qualification.isQualified !== right.qualification.isQualified) {
      return left.qualification.isQualified ? -1 : 1;
    }
    const scoreDifference =
      right.qualification.productFitScore +
      right.qualification.scaleScore -
      left.qualification.productFitScore -
      left.qualification.scaleScore;
    return (
      scoreDifference ||
      left.candidate.domain.localeCompare(right.candidate.domain)
    );
  });

  campaign.completedAt = new Date().toISOString();
  database.saveCampaign(campaign);
  logger.info(
    finalize ? "pipeline.campaign.completed" : "pipeline.campaign.batch_completed",
    undefined,
    {
      leadCount: campaign.leads.length,
      qualified: campaign.leads.filter(
        (lead) => lead.status === "qualified" || lead.status === "approved",
      ).length,
      needsReview: campaign.leads.filter(
        (lead) => lead.status === "needs_review",
      ).length,
      rejected: campaign.leads.filter((lead) => lead.status === "rejected")
        .length,
      analysisFailures: campaign.analysisFailures?.length ?? 0,
      searchRequests: campaign.discovery?.serpRequests ?? 0,
      searchCacheHits: campaign.discovery?.cacheHits ?? 0,
      searchHits: campaign.discovery?.hits.length ?? 0,
      durationMs:
        new Date(campaign.completedAt).getTime() -
        new Date(campaign.startedAt).getTime(),
    },
    { campaignId },
  );
  return campaign;
}

export async function runOfflineSampleCampaign(
  input: CampaignInput,
): Promise<CampaignResult> {
  return runCampaign(input, structuredClone(demoCandidates), {
    searchMode: "demo",
    runtime: new DemoAgentRuntime(),
  });
}

export function listCampaigns(): CampaignResult[] {
  return getDatabase().listCampaigns();
}

export function getCampaign(id: string): CampaignResult | undefined {
  return getDatabase().getCampaign(id);
}

async function buildManualContext(
  input: CampaignInput,
  candidate: CompanyCandidate,
): Promise<CampaignAgentContext> {
  const country = requireCountry(input.country);
  const registry = await getMarketSkillRegistry();
  const skill = registry.getSummary(country.id);
  candidate.countryValidation = validateCompanyCountry(candidate, country);
  candidate.contactValidations = await validateContactCandidates(
    candidate,
    country,
  );
  return {
    input: { ...input, country: country.displayName },
    country,
    skill,
    skillInvocation: registry.invocation(
      country.id,
      `当前产品：${input.product}\n首选语言：${input.language}`,
    ),
  };
}

export async function runManualCampaign(
  input: CampaignInput,
  candidate: CompanyCandidate,
): Promise<CampaignResult> {
  const context = await buildManualContext(input, candidate);
  return runCampaign(context.input, [candidate], {
    searchMode: "manual",
    context,
  });
}

export async function runSearchCampaign(
  input: CampaignInput,
  limits?: {
    maxQueries?: number;
    resultsPerQuery?: number;
  },
): Promise<CampaignResult> {
  const activeRuntime = getAgentRuntime();
  const result = await discoverCompanies(input, activeRuntime, undefined, limits);
  return runCampaign(result.context.input, result.candidates, {
    searchMode: "serper",
    discovery: result.discovery,
    context: result.context,
  });
}

export interface ApprovedStrategyRunOptions {
  runtime?: AgentRuntime;
  client?: SerperClient;
  crawl?: typeof crawlCandidate;
}

function ensureRoundDiscovery(
  campaign: CampaignResult,
  plan: SearchPlan,
): DiscoveryRun {
  const discovery: DiscoveryRun = campaign.discovery ?? {
    provider: "serper",
    countryId: plan.countryId,
    plan,
    hits: [],
    skipped: [],
    errors: [],
    serpRequests: 0,
    cacheHits: 0,
    companies: [],
    rounds: [],
    progress: createDiscoveryProgress(),
    startedAt: campaign.startedAt,
    completedAt: campaign.startedAt,
  };
  discovery.plan = plan;
  discovery.companies ??= [];
  discovery.rounds ??= [];
  discovery.progress ??= createDiscoveryProgress();
  if (!discovery.progress.seenDomains.length) {
    discovery.progress.seenDomains = [
      ...new Set(
        (campaign.candidateQueue ?? []).map((candidate) =>
          candidate.searchHit?.domain.toLowerCase() ??
          candidate.domain.toLowerCase(),
        ),
      ),
    ];
  }
  discovery.progress.domainCompanyIds ??= {};
  discovery.progress.domainRepeatCounts ??= {};
  discovery.progress.brandFingerprints ??= [];
  discovery.progress.groups ??= {};
  campaign.discovery = discovery;
  return discovery;
}

function mergeCandidateQueue(
  campaign: CampaignResult,
  candidates: readonly CompanyCandidate[],
): void {
  const merged = new Map(
    (campaign.candidateQueue ?? []).map((candidate) => [
      candidate.domain.toLowerCase(),
      candidate,
    ]),
  );
  for (const candidate of candidates) {
    merged.set(candidate.domain.toLowerCase(), candidate);
  }
  campaign.candidateQueue = [...merged.values()];
}

function candidatesForRound(
  campaign: CampaignResult,
  round: DiscoveryRound,
): CompanyCandidate[] {
  const domains = new Set(round.newDomains.map((domain) => domain.toLowerCase()));
  return (campaign.candidateQueue ?? []).filter((candidate) =>
    domains.has(
      candidate.searchHit?.domain.toLowerCase() ??
        candidate.domain.toLowerCase(),
    ),
  );
}

function completeRound(
  campaign: CampaignResult,
  round: DiscoveryRound,
  strategy: CampaignStrategy,
): void {
  const discovery = campaign.discovery;
  const progress = discovery?.progress;
  if (!discovery || !progress) throw new Error("Campaign 缺少逐轮发现状态");
  const roundCandidateIds = new Set(
    candidatesForRound(campaign, round).map((candidate) => candidate.id),
  );
  const roundLeads = campaign.leads.filter((lead) =>
    roundCandidateIds.has(lead.candidate.id),
  );
  const roundFailures = (campaign.analysisFailures ?? []).filter((failure) =>
    roundCandidateIds.has(failure.candidateId),
  );
  round.analysisSucceeded = roundLeads.length;
  round.analysisFailed = roundFailures.length;
  round.status = "completed";
  round.completedAt = new Date().toISOString();
  const newDomainRate =
    round.rawHitCount > 0
      ? round.newDomainCount / round.rawHitCount
      : 0;
  const lowYieldNewDomains = strategy.budget.lowYieldNewDomains ?? 2;
  const lowYieldRate = strategy.budget.lowYieldRate ?? 0.02;
  const consecutiveLowYieldRounds =
    strategy.budget.consecutiveLowYieldRounds ?? 3;
  round.lowYield =
    round.newDomainCount <= lowYieldNewDomains ||
    newDomainRate <= lowYieldRate;
  const group = progress.groups[round.groupId] ?? {
    executedRounds: 0,
    consecutiveLowYieldRounds: 0,
    saturated: false,
    lastNewDomainCount: 0,
    lastNewDomainRate: 0,
  };
  group.executedRounds += 1;
  group.consecutiveLowYieldRounds = round.lowYield
    ? group.consecutiveLowYieldRounds + 1
    : 0;
  group.saturated =
    group.consecutiveLowYieldRounds >= consecutiveLowYieldRounds;
  group.lastNewDomainCount = round.newDomainCount;
  group.lastNewDomainRate = newDomainRate;
  progress.groups[round.groupId] = group;
  progress.brandFingerprints = appendBrandFingerprints(
    progress.brandFingerprints,
    roundLeads,
    strategy,
  );
  discovery.completedAt = round.completedAt;
}

function nextRunnableQueryIndex(
  plan: SearchPlan,
  progress: NonNullable<DiscoveryRun["progress"]>,
): number | undefined {
  let queryIndex = progress.nextQueryIndex;
  while (queryIndex < plan.queries.length) {
    const query = plan.queries[queryIndex];
    if (!query) return undefined;
    const groupId = resolveQueryGroupId(query, queryIndex);
    if (!progress.groups[groupId]?.saturated) return queryIndex;
    queryIndex += 1;
    progress.nextQueryIndex = queryIndex;
  }
  return undefined;
}

function finalStopReason(
  strategy: CampaignStrategy,
  plan: SearchPlan,
  discovery: DiscoveryRun,
): NonNullable<DiscoveryRun["progress"]>["stopReason"] {
  const progress = discovery.progress;
  if (!progress) return "failed";
  if (progress.executedQueries >= strategy.budget.maxQueries) {
    return "max_queries";
  }
  const groupIds = new Set(
    plan.queries.map((query, index) => resolveQueryGroupId(query, index)),
  );
  if (
    groupIds.size > 0 &&
    [...groupIds].every((groupId) => progress.groups[groupId]?.saturated)
  ) {
    return "all_groups_saturated";
  }
  return "plan_exhausted";
}

export async function runApprovedStrategy(
  strategy: CampaignStrategy,
  onPhase?: (
    phase: Extract<
      OrchestratorRunPhase,
      "discovering" | "analyzing" | "deciding"
    >,
  ) => void,
  campaignId?: string,
  executionOptions: ApprovedStrategyRunOptions = {},
): Promise<CampaignResult> {
  logger.info("pipeline.approved_strategy.started", undefined, {
    skillVersion: strategy.skillVersion,
    product: strategy.product,
    country: strategy.country,
    queryCount: strategy.search.queries.length,
    budget: strategy.budget,
    validation: strategy.validation,
  });
  if (!strategy.search.queries.length) {
    throw new Error("已批准策略缺少搜索查询，请先让主 Agent 预览搜索计划");
  }
  const input: CampaignInput = {
    product: strategy.product,
    country: strategy.country,
    language: strategy.language,
  };
  const activeRuntime = executionOptions.runtime ?? getAgentRuntime();
  const database = getDatabase();
  const id = campaignId ?? randomUUID();
  const context = await buildCampaignAgentContext(input, strategy);
  const approvedPlan: SearchPlan = {
    countryId: strategy.skillName,
    product: strategy.product,
    queries: strategy.search.queries,
    skillName: strategy.skillName,
    skillVersion: strategy.skillVersion,
  };
  let campaign: CampaignResult =
    database.getCampaign(id) ?? {
      id,
      ...context.input,
      mode: activeRuntime.mode,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      leads: [],
      searchMode: "serper",
      analysisFailures: [],
      candidateQueue: [],
    };
  const discovery = ensureRoundDiscovery(campaign, approvedPlan);
  const progress = discovery.progress;
  if (!progress) throw new Error("无法初始化逐轮发现状态");
  if (progress.stopReason === "failed") {
    progress.stopReason = undefined;
    campaign.completedAt = new Date().toISOString();
    database.saveCampaign(campaign);
    logger.info(
      "pipeline.approved_strategy.failure_checkpoint_reopened",
      undefined,
      {
        nextQueryIndex: progress.nextQueryIndex,
        executedQueries: progress.executedQueries,
      },
      { campaignId: id },
    );
  }
  database.saveCampaign(campaign);

  const unfinishedRound = discovery.rounds?.find(
    (round) => round.status === "analyzing",
  );
  if (unfinishedRound) {
    onPhase?.("analyzing");
    campaign = await runCampaign(
      context.input,
      candidatesForRound(campaign, unfinishedRound),
      {
        campaignId: id,
        searchMode: "serper",
        discovery,
        context,
        runtime: activeRuntime,
        finalize: false,
      },
    );
    completeRound(campaign, unfinishedRound, strategy);
    onPhase?.("deciding");
    database.saveCampaign(campaign);
  }

  while (
    !progress.stopReason &&
    progress.executedQueries < strategy.budget.maxQueries
  ) {
    const queryIndex = nextRunnableQueryIndex(approvedPlan, progress);
    if (queryIndex === undefined) break;
    const query = approvedPlan.queries[queryIndex];
    if (!query) break;
    onPhase?.("discovering");
    let roundResult;
    try {
      roundResult = await executeDiscoveryRound({
        input: context.input,
        query,
        queryIndex,
        roundIndex: discovery.rounds?.length ?? 0,
        context,
        progress,
        strategy,
        client: executionOptions.client,
        excludedDomains: strategy.exclusions.domains,
        crawl: executionOptions.crawl,
      });
    } catch (error) {
      progress.stopReason = "failed";
      campaign.completedAt = new Date().toISOString();
      database.saveCampaign(campaign);
      throw error;
    }
    discovery.hits.push(...roundResult.hits);
    discovery.skipped.push(...roundResult.skipped);
    discovery.errors.push(...roundResult.errors);
    discovery.serpRequests += roundResult.round.serpRequests;
    discovery.cacheHits += roundResult.round.cacheHit ? 1 : 0;
    discovery.companies?.push(...roundResult.companies);
    discovery.rounds?.push(roundResult.round);
    mergeCandidateQueue(campaign, roundResult.candidates);
    campaign.completedAt = new Date().toISOString();
    database.saveCampaign(campaign);

    onPhase?.("analyzing");
    campaign = await runCampaign(context.input, roundResult.candidates, {
      campaignId: id,
      searchMode: "serper",
      discovery,
      context,
      runtime: activeRuntime,
      finalize: false,
    });
    completeRound(campaign, roundResult.round, strategy);
    onPhase?.("deciding");
    database.saveCampaign(campaign);
  }

  progress.stopReason ??= finalStopReason(strategy, approvedPlan, discovery);
  campaign.completedAt = new Date().toISOString();
  database.saveCampaign(campaign);
  return runCampaign(context.input, [], {
    campaignId: id,
    searchMode: "serper",
    discovery,
    context,
    runtime: activeRuntime,
    finalize: true,
  });
}

export function updateLeadStatus(
  campaignId: string,
  leadId: string,
  status: Extract<LeadStatus, "approved" | "rejected" | "needs_review">,
): LeadRecord | undefined {
  const campaign = getDatabase().getCampaign(campaignId);
  const lead = campaign?.leads.find((candidate) => candidate.id === leadId);
  if (!lead) return undefined;
  const previousStatus = lead.status;
  lead.status = status;
  if (campaign) getDatabase().saveCampaign(campaign);
  logger.info(
    "lead.review_status.updated",
    undefined,
    {
      previousStatus,
      status,
      domain: lead.candidate.domain,
    },
    { campaignId, leadId },
  );
  return lead;
}
