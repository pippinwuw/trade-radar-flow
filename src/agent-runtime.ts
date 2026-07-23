import type {
  AgentTrace,
  CampaignInput,
  CampaignResult,
  CampaignStrategy,
  CompanyAnalysisResult,
  CompanyCandidate,
  CompanyResearchPacket,
  CountryProfile,
  MarketSkillSummary,
  OutreachBrief,
  QualificationDecision,
  SearchPlan,
  SkillProposalDraft,
} from "./domain.js";

export interface AgentResult<T> {
  value: T;
  trace: AgentTrace;
}

export interface AgentRuntime {
  readonly mode: "demo" | "live";
  planSearch(
    input: CampaignInput,
    country: CountryProfile,
    skill: MarketSkillSummary,
    skillInvocation: string,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<SearchPlan>>;
  analyzeCompany(
    candidate: CompanyCandidate,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<CompanyAnalysisResult>>;
  researchCompany(
    candidate: CompanyCandidate,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<CompanyResearchPacket>>;
  qualifyCompany(
    research: CompanyResearchPacket,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<QualificationDecision>>;
  composeOutreach(
    research: CompanyResearchPacket,
    qualification: QualificationDecision,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<OutreachBrief>>;
  proposeSkillUpdate(
    context: CampaignAgentContext,
    campaign: CampaignResult,
  ): Promise<AgentResult<SkillProposalDraft>>;
}

export interface CampaignAgentContext {
  input: CampaignInput;
  strategy?: CampaignStrategy;
  country: CountryProfile;
  skill: MarketSkillSummary;
  skillInvocation: string;
}
