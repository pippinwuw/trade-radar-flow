export type EvidenceKind =
  | "identity"
  | "product"
  | "business_role"
  | "scale"
  | "contact";

export type SupportedCountryId = string;

export interface CountryProfile {
  id: SupportedCountryId;
  displayName: string;
  shortName: string;
  aliases: string[];
  countryNameAliases?: string[];
  gl: string;
  defaultHl: string;
  googleDomain: string;
  location: string;
  cities: string[];
  phoneCountryCode: string;
  callingCode: string;
  domainSuffix: string;
  businessSuffixes: string[];
}

export interface SearchQuery {
  query: string;
  language: string;
  rationale: string;
  groupId?: string;
}

export interface SearchPlan {
  countryId: SupportedCountryId;
  product: string;
  queries: SearchQuery[];
  marketPolicyRef?: MarketPolicyRef;
}

export interface SearchHit {
  query: string;
  position: number;
  title: string;
  link: string;
  snippet: string;
  displayedLink?: string;
  domain: string;
}

export type CompanyProcessingStatus =
  | "pending"
  | "crawling"
  | "crawl_failed"
  | "country_rejected"
  | "pre_analysis_rejected"
  | "analyzing"
  | "analyzed"
  | "analysis_failed";

export interface CompanyProcessingRecord {
  domain: string;
  url: string;
  roundIndex?: number;
  candidateId?: string;
  status: CompanyProcessingStatus;
  crawlStartedAt?: string;
  crawlCompletedAt?: string;
  analysisStartedAt?: string;
  analysisCompletedAt?: string;
  analysisDurationMs?: number;
  retryCount: number;
  error?: string;
}

export interface SearchExclusionFilter {
  type: "domain" | "brand";
  value: string;
  token: string;
  sourceCompanyId: string;
  sourceDomain: string;
  reason: string;
}

export interface BrandFingerprint {
  value: string;
  normalizedValue: string;
  sourceCompanyId: string;
  sourceDomain: string;
  evidenceId: string;
  confidence: number;
}

export type DiscoveryStopReason =
  | "max_queries"
  | "all_groups_saturated"
  | "plan_exhausted"
  | "failed";

export interface QueryGroupProgress {
  executedRounds: number;
  consecutiveLowYieldRounds: number;
  saturated: boolean;
  lastNewDomainCount: number;
  lastNewDomainRate: number;
}

export type DiscoveryRoundPhase =
  | "searching"
  | "crawling"
  | "analyzing"
  | "completed";

export interface DiscoveryRound {
  index: number;
  queryIndex: number;
  groupId: string;
  baseQuery: SearchQuery;
  effectiveQuery: SearchQuery;
  filters: SearchExclusionFilter[];
  /** Round lifecycle: in-progress rounds stay analyzing until completeRound. */
  status: "analyzing" | "completed";
  /** Finer in-round stage for live progress UI. */
  phase?: DiscoveryRoundPhase;
  rawHitCount: number;
  duplicateDomainCount: number;
  excludedHitCount: number;
  newDomainCount: number;
  newDomains: string[];
  crawlSucceeded: number;
  crawlFailed: number;
  countryRejected?: number;
  preAnalysisRejected?: number;
  snippetGateRejected?: number;
  crawlCacheHits: number;
  analysisSucceeded: number;
  analysisFailed: number;
  cacheHit: boolean;
  serpRequests: number;
  lowYield?: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface DiscoveryProgress {
  nextQueryIndex: number;
  executedQueries: number;
  seenDomains: string[];
  domainRepeatCounts: Record<string, number>;
  domainCompanyIds: Record<string, string>;
  brandFingerprints: BrandFingerprint[];
  groups: Record<string, QueryGroupProgress>;
  stopReason?: DiscoveryStopReason;
}

export interface DiscoveryRun {
  provider: "demo" | "serper";
  countryId: SupportedCountryId;
  plan: SearchPlan;
  hits: SearchHit[];
  skipped: Array<{ url: string; reason: string }>;
  errors: Array<{ url?: string; message: string }>;
  serpRequests: number;
  cacheHits: number;
  companies?: CompanyProcessingRecord[];
  rounds?: DiscoveryRound[];
  progress?: DiscoveryProgress;
  planningTrace?: AgentTrace;
  startedAt: string;
  completedAt: string;
}

export interface ContactValidation {
  value: string;
  syntaxValid: boolean;
  mxPresent?: boolean;
  sameCompanyDomain?: boolean;
  countryFormatValid?: boolean;
  normalizedValue?: string;
  contextRole: "sales" | "general" | "support" | "unknown";
  confidence: number;
  notes: string[];
}

export interface CountryValidation {
  countryId: SupportedCountryId;
  score: number;
  matched: boolean;
  signals: Array<{
    kind: "domain" | "phone" | "address" | "city" | "business_suffix";
    value: string;
    sourceUrl?: string;
  }>;
  warnings: string[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
}

export interface ContactCandidate {
  type: "email" | "phone" | "whatsapp";
  value: string;
  sourceUrl: string;
  nearbyText?: string;
}

export interface CompanyCandidate {
  id: string;
  homepage: string;
  domain: string;
  searchSnippet: string;
  pages: PageSnapshot[];
  contactCandidates: ContactCandidate[];
  searchHit?: SearchHit;
  crawlCacheHit?: boolean;
  crawlWarnings?: string[];
  countryValidation?: CountryValidation;
  contactValidations?: ContactValidation[];
}

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  label: string;
  value: string;
  quote: string;
  sourceUrl: string;
  confidence: number;
}

export interface ResolvedContact {
  type: ContactCandidate["type"];
  value: string;
  label: string;
  confidence: number;
  sourceUrl: string;
  verified: boolean;
  validation?: ContactValidation;
}

export interface CompanyResearchPacket {
  companyId: string;
  canonicalName: string;
  summary: string;
  products: string[];
  contacts: ResolvedContact[];
  evidence: Evidence[];
  missingInformation: string[];
}

export type BusinessRole =
  | "Distributor"
  | "Wholesaler"
  | "Importer"
  | "Manufacturer"
  | "Retailer"
  | "Service"
  | "Unknown";

export interface QualificationDecision {
  isQualified: boolean;
  businessRole: BusinessRole;
  productFitScore: number;
  scaleScore: number;
  importCapability: "High" | "Medium" | "Low" | "Unknown";
  confidence: number;
  reasons: string[];
  evidenceIds: string[];
  missingInformation: string[];
  reviewPerformed: boolean;
}

export interface OutreachBrief {
  headline: string;
  whyContact: string;
  productFit: string;
  keyEvidence: string[];
  risk: string;
  recommendedContact: string;
  templateId: string;
  templateReason: string;
  emailSubject: string;
  emailBody: string;
  whatsappBody: string;
  evidenceIds: string[];
}

export interface CompanyAnalysisResult {
  research: CompanyResearchPacket;
  qualification: QualificationDecision;
  outreach: OutreachBrief;
}

export interface CompanyAnalysisCacheEntry {
  key: string;
  domain: string;
  candidateFingerprint: string;
  decisionFingerprint: string;
  marketPolicyHash: string;
  analysisContractVersion: string;
  modelProvider: string;
  modelId: string;
  result: CompanyAnalysisResult;
  sourceLeadId?: string;
  createdAt: string;
}

export interface CompanyEvidenceIndexEntry {
  key: string;
  domain: string;
  pageFingerprint: string;
  snippets: Array<{
    ref: string;
    pageIndex: number;
    url: string;
    text: string;
  }>;
  duplicatePages: Array<{
    pageIndex: number;
    duplicateOf: number;
  }>;
  createdAt: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface ContextSectionTrace {
  id: string;
  source: string;
  version?: string;
  trust: "system" | "approved" | "runtime" | "untrusted";
  priority: "required" | "high" | "normal" | "optional";
  estimatedTokens: number;
  included: boolean;
  truncated?: boolean;
  reason?: string;
  contentHash: string;
}

export interface AgentTrace {
  agent:
    | "CampaignOrchestratorAgent"
    | "SearchPlanningAgent"
    | "CompanyAnalysisAgent";
  mode: "demo" | "live" | "cache";
  status: "succeeded" | "failed" | "budget_exhausted";
  steps: string[];
  durationMs: number;
  usage?: AgentUsage;
  context?: {
    contextWindow: number;
    outputReserve: number;
    safetyMargin: number;
    estimatedInputTokens: number;
    sections: ContextSectionTrace[];
  };
  cache?: {
    key: string;
    sourceLeadId?: string;
  };
  error?: {
    name: string;
    message: string;
  };
}

export type LeadStatus =
  | "qualified"
  | "needs_review"
  | "rejected"
  | "approved";

export interface LeadRecord {
  id: string;
  candidate: CompanyCandidate;
  research: CompanyResearchPacket;
  qualification: QualificationDecision;
  outreach: OutreachBrief;
  traces: AgentTrace[];
  status: LeadStatus;
  createdAt: string;
}

export type CompanyAnalysisFailureKind =
  | "validation"
  | "timeout"
  | "terminated"
  | "transient"
  | "budget_exhausted"
  | "unknown";

export interface CompanyAnalysisFailure {
  candidateId: string;
  domain: string;
  stage: "analysis";
  message: string;
  failedAt: string;
  failureKind?: CompanyAnalysisFailureKind;
  trace?: AgentTrace;
}

export interface CampaignResult {
  id: string;
  product: string;
  country: string;
  language: string;
  mode: "demo" | "live";
  startedAt: string;
  completedAt: string;
  leads: LeadRecord[];
  searchMode?: "demo" | "serper" | "manual";
  discovery?: DiscoveryRun;
  analysisFailures?: CompanyAnalysisFailure[];
  candidateQueue?: CompanyCandidate[];
  marketPolicyRef?: MarketPolicyRef;
}

export interface CampaignInput {
  product: string;
  country: string;
  language: string;
}

export type OrchestratorSessionStatus =
  | "drafting"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "awaiting_report_review"
  | "completed"
  | "failed";

export type OrchestratorRunPhase =
  | "planning"
  | "discovering"
  | "analyzing"
  | "deciding"
  | "summarizing";

export type OrchestratorAgentActivityPhase =
  | "idle"
  | "thinking"
  | "tool"
  | "responding";

/** Live main-Agent UI status while a chat turn is in flight (in-memory only). */
export interface OrchestratorAgentActivity {
  sessionId: string;
  phase: OrchestratorAgentActivityPhase;
  detail: string;
  toolName?: string;
  toolCallId?: string;
  updatedAt: string;
}

export interface StrategyCustomSection {
  id: string;
  title: string;
  content: string;
  source: "template" | "user" | "agent";
}

export type MarketPolicyStatus =
  | "draft"
  | "reviewed"
  | "approved"
  | "superseded";

export interface MarketPolicyRef {
  marketId: SupportedCountryId;
  version: string;
  hash: string;
}

export interface MarketPolicy {
  schemaVersion: 1;
  marketId: SupportedCountryId;
  version: string;
  hash: string;
  status: MarketPolicyStatus;
  searchLocalization: {
    languages: string[];
    buyerRoleTerms: string[];
    queryPatterns: string[];
    translationRestrictions: string[];
  };
  companyAnalysis: {
    identitySignals: string[];
    legalSuffixSemantics: string[];
    buyerSignals: string[];
    importAndScaleSignals: string[];
    falsePositivePatterns: string[];
    exclusions: string[];
  };
  contactAndOutreach: {
    preferredContactTerms: string[];
    validationNotes: string[];
    defaultLanguage: string;
    etiquette: string[];
  };
  metadata: {
    source: "builtin" | "generated" | "migrated" | "user";
    reviewNotes: string[];
    createdAt: string;
    reviewedAt?: string;
    approvedAt?: string;
  };
}

export interface MarketPolicyRecord {
  marketId: SupportedCountryId;
  version: string;
  hash: string;
  status: MarketPolicyStatus;
  filePath: string;
  source: MarketPolicy["metadata"]["source"];
  reviewNotes: string[];
  createdAt: string;
  reviewedAt?: string;
  approvedAt?: string;
}

export interface CampaignStrategy {
  schemaVersion: 1 | 2;
  product: string;
  country: string;
  language: string;
  objective: string;
  targetCustomer: {
    businessRoles: BusinessRole[];
    industries: string[];
    companyScale: string;
    importCapability: Array<QualificationDecision["importCapability"]>;
    preferredContactRoles: string[];
  };
  search: {
    requiredKeywords: string[];
    alternativeKeywords: string[];
    localLanguageKeywords: string[];
    cities: string[];
    channels: Array<"serper" | "manual_url">;
    manualUrls: string[];
    queries: SearchQuery[];
  };
  exclusions: {
    businessRoles: BusinessRole[];
    domains: string[];
    terms: string[];
  };
  validation: {
    minimumCountryScore: number;
    requireCompanyDomainEmail: boolean;
    requireMx: boolean;
    requireLocalPhone: boolean;
    preAnalysisGate?: {
      enabled: boolean;
      minPageTextChars: number;
      requireStrongExclusion: boolean;
      useQueryTermsInSnippetGate: boolean;
    };
  };
  budget: {
    maxQueries: number;
    resultsPerQuery: number;
    maxPagesPerCompany: number;
    maxReanalysisPerLead: number;
    lowYieldNewDomains: number;
    lowYieldRate: number;
    consecutiveLowYieldRounds: number;
  };
  output: {
    reportLanguage: string;
    rankingPriorities: string[];
    generateOutreach: boolean;
  };
  customSections: StrategyCustomSection[];
  marketPolicyRef?: MarketPolicyRef;
}

export interface OrchestratorMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  nextAction?: string;
  createdAt: string;
}

export interface OrchestratorReport {
  sessionId: string;
  campaignId: string;
  executiveSummary: string;
  recommendedLeadIds: string[];
  qualificationSummary: {
    qualified: number;
    needsReview: number;
    rejected: number;
  };
  searchSummary: {
    queries: number;
    hits: number;
    searchedRequests: number;
    cacheHits: number;
    crawlErrors: number;
    deduplicatedCompanies: number;
    crawlSucceeded: number;
    countryRejected?: number;
    preAnalysisRejected?: number;
    analyzed: number;
    analysisErrors: number;
    plannedQueries: number;
    executedQueries: number;
    seenDomains: number;
    stopReason?: DiscoveryStopReason;
  };
  strengths: string[];
  risks: string[];
  nextSteps: string[];
  createdAt: string;
}

export interface OrchestratorSession {
  id: string;
  status: OrchestratorSessionStatus;
  runPhase?: OrchestratorRunPhase;
  input: CampaignInput;
  strategy: CampaignStrategy;
  strategyVersion: number;
  strategyHash: string;
  approvedStrategyHash?: string;
  approvalId?: string;
  approvedAt?: string;
  campaignId?: string;
  report?: OrchestratorReport;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
