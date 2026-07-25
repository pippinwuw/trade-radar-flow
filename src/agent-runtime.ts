import type {
  AgentTrace,
  CampaignInput,
  CampaignStrategy,
  CompanyAnalysisResult,
  CompanyCandidate,
  CountryProfile,
  MarketPolicy,
  SearchPlan,
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
    marketPolicy: MarketPolicy,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<SearchPlan>>;
  analyzeCompany(
    candidate: CompanyCandidate,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<CompanyAnalysisResult>>;
}

export interface CampaignAgentContext {
  input: CampaignInput;
  strategy?: CampaignStrategy;
  country: CountryProfile;
  marketPolicy: MarketPolicy;
}
