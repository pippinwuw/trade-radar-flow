import type {
  CampaignResult,
  OrchestratorReport,
  OrchestratorSession,
} from "../domain.js";

export function compactCampaignForMainAgent(campaign: CampaignResult): unknown {
  const rankedLeads = [...campaign.leads].sort(
    (left, right) =>
      Number(right.qualification.isQualified) -
        Number(left.qualification.isQualified) ||
      right.qualification.confidence - left.qualification.confidence ||
      right.qualification.productFitScore -
        left.qualification.productFitScore ||
      right.qualification.scaleScore - left.qualification.scaleScore ||
      left.id.localeCompare(right.id),
  );
  const companies = campaign.discovery?.companies ?? [];
  const companyStatusCounts = Object.fromEntries(
    [
      "pending",
      "crawling",
      "crawl_failed",
      "country_rejected",
      "analyzing",
      "analyzed",
      "analysis_failed",
    ].map((status) => [
      status,
      companies.filter((company) => company.status === status).length,
    ]),
  );
  return {
    id: campaign.id,
    product: campaign.product,
    country: campaign.country,
    discovery: campaign.discovery
      ? {
          provider: campaign.discovery.provider,
          queryCount: campaign.discovery.plan.queries.length,
          queries: campaign.discovery.plan.queries.slice(0, 50),
          hitCount: campaign.discovery.hits.length,
          skippedCount: campaign.discovery.skipped.length,
          skipped: campaign.discovery.skipped.slice(0, 20),
          errorCount: campaign.discovery.errors.length,
          errors: campaign.discovery.errors.slice(0, 20),
          searchRequests: campaign.discovery.serpRequests,
          cacheHits: campaign.discovery.cacheHits,
          companyStatusCounts,
          companies: companies.slice(0, 30),
          roundCount: campaign.discovery.rounds?.length ?? 0,
          rounds: campaign.discovery.rounds?.slice(-50),
          progress: campaign.discovery.progress,
        }
      : undefined,
    leadCount: campaign.leads.length,
    omittedLeadCount: Math.max(0, campaign.leads.length - 30),
    leads: rankedLeads.slice(0, 30).map((lead) => ({
      id: lead.id,
      domain: lead.candidate.domain,
      company: lead.research.canonicalName,
      status: lead.status,
      role: lead.qualification.businessRole,
      productFitScore: lead.qualification.productFitScore,
      scaleScore: lead.qualification.scaleScore,
      confidence: lead.qualification.confidence,
      importCapability: lead.qualification.importCapability,
      reasons: lead.qualification.reasons,
      missingInformation: lead.qualification.missingInformation,
      countryValidation: lead.candidate.countryValidation,
      validatedContacts: (lead.candidate.contactValidations ?? []).map(
        (contact) => ({
          value: contact.normalizedValue ?? contact.value,
          role: contact.contextRole,
          confidence: contact.confidence,
        }),
      ),
      evidence: lead.research.evidence.map((evidence) => ({
        id: evidence.id,
        kind: evidence.kind,
        label: evidence.label,
        value: evidence.value,
        sourceUrl: evidence.sourceUrl,
      })),
    })),
  };
}

export function createDeterministicReport(
  session: OrchestratorSession,
  campaign: CampaignResult,
): OrchestratorReport {
  const qualified = campaign.leads.filter(
    (lead) => lead.status === "qualified" || lead.status === "approved",
  );
  const needsReview = campaign.leads.filter(
    (lead) => lead.status === "needs_review",
  );
  const rejected = campaign.leads.filter(
    (lead) => lead.status === "rejected",
  );
  const discovery = campaign.discovery;
  const companyProgress = discovery?.companies ?? [];
  const crawlSucceeded = companyProgress.filter(
    (company) => company.status !== "crawl_failed",
  ).length;
  const analyzed = companyProgress.filter(
    (company) => company.status === "analyzed",
  ).length;
  const countryRejected = companyProgress.filter(
    (company) => company.status === "country_rejected",
  ).length;
  const analysisErrors =
    campaign.analysisFailures?.length ??
    companyProgress.filter((company) => company.status === "analysis_failed")
      .length;
  const risks = [
    ...(discovery?.errors.length
      ? [`${discovery.errors.length} 个官网抓取失败`]
      : []),
    ...(analysisErrors
      ? [`${analysisErrors} 个公司 Agent 分析失败，可重新入队`]
      : []),
    ...(countryRejected
      ? [`${countryRejected} 个域名因缺少目标国家证据未进入模型分析`]
      : []),
    ...(needsReview.length
      ? [`${needsReview.length} 条线索需要人工复核`]
      : []),
    ...(campaign.leads.some(
      (lead) => !(lead.candidate.contactValidations ?? []).length,
    )
      ? ["部分公司缺少可本地验证的联系方式"]
      : []),
  ];
  const recommendedLeadIds = qualified.slice(0, 5).map((lead) => lead.id);
  const executedQueries =
    discovery?.progress?.executedQueries ?? discovery?.plan.queries.length ?? 0;
  const plannedQueries = discovery?.plan.queries.length ?? 0;
  const seenDomains =
    discovery?.progress?.seenDomains.length ?? companyProgress.length;
  return {
    sessionId: session.id,
    campaignId: campaign.id,
    executiveSummary: `本次逐轮执行 ${executedQueries}/${session.strategy.budget.maxQueries} 条查询，累计处理 ${seenDomains} 个去重域名，成功分析 ${campaign.leads.length} 家，${countryRejected} 家因国家证据不足被过滤，${discovery?.errors.length ?? 0} 家抓取失败，${analysisErrors} 家分析失败；建议优先触达 ${qualified.length} 家，${needsReview.length} 家需要复核，${rejected.length} 家不建议触达。`,
    recommendedLeadIds,
    qualificationSummary: {
      qualified: qualified.length,
      needsReview: needsReview.length,
      rejected: rejected.length,
    },
    searchSummary: {
      queries: executedQueries,
      hits: discovery?.hits.length ?? 0,
      searchedRequests: discovery?.serpRequests ?? 0,
      cacheHits: discovery?.cacheHits ?? 0,
      crawlErrors: discovery?.errors.length ?? 0,
      deduplicatedCompanies: companyProgress.length,
      crawlSucceeded,
      countryRejected,
      analyzed,
      analysisErrors,
      plannedQueries,
      executedQueries,
      seenDomains,
      stopReason: discovery?.progress?.stopReason,
    },
    strengths: qualified.slice(0, 3).map(
      (lead) =>
        `${lead.research.canonicalName}：${lead.qualification.reasons.join("；")}`,
    ),
    risks: risks.length ? risks : ["未发现需要特别提示的系统性风险"],
    nextSteps: recommendedLeadIds.length
      ? [
          "逐条审核推荐线索的原文证据与联系人验证结果",
          "批准或修改触达草稿后再由人工发送",
          "如搜索命中偏离目标，可与主 Agent 调整关键词和排除条件后新建一轮任务",
        ]
      : [
          "与主 Agent 放宽或修正目标客户画像",
          "补充产品同义词、当地语言词或重点城市后重新规划",
        ],
    createdAt: new Date().toISOString(),
  };
}
