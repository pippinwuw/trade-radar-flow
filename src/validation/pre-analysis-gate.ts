import {
  compilePreAnalysisLexicon,
  countTermHits,
} from "../analysis/evidence-terms.js";
import type { CampaignAgentContext } from "../agents/agent-runtime.js";
import type {
  CampaignStrategy,
  CompanyCandidate,
  SearchHit,
} from "../domain.js";

export interface PreAnalysisGateConfig {
  enabled: boolean;
  minPageTextChars: number;
  requireStrongExclusion: boolean;
  useQueryTermsInSnippetGate: boolean;
}

export const DEFAULT_PRE_ANALYSIS_GATE: PreAnalysisGateConfig = {
  enabled: true,
  minPageTextChars: 400,
  requireStrongExclusion: true,
  useQueryTermsInSnippetGate: true,
};

export interface PreAnalysisGateEvaluation {
  skip: boolean;
  reason?: string;
  productHits: number;
  buyerHits: number;
  exclusionHits: number;
}

export function resolvePreAnalysisGateConfig(
  strategy: CampaignStrategy | undefined,
): PreAnalysisGateConfig {
  const gate = strategy?.validation.preAnalysisGate;
  return {
    enabled: gate?.enabled ?? DEFAULT_PRE_ANALYSIS_GATE.enabled,
    minPageTextChars:
      gate?.minPageTextChars ?? DEFAULT_PRE_ANALYSIS_GATE.minPageTextChars,
    requireStrongExclusion:
      gate?.requireStrongExclusion ??
      DEFAULT_PRE_ANALYSIS_GATE.requireStrongExclusion,
    useQueryTermsInSnippetGate:
      gate?.useQueryTermsInSnippetGate ??
      DEFAULT_PRE_ANALYSIS_GATE.useQueryTermsInSnippetGate,
  };
}

function shouldSkipPreAnalysis(
  config: PreAnalysisGateConfig,
  productHits: number,
  buyerHits: number,
  exclusionHits: number,
): boolean {
  if (!config.enabled) return false;
  if (productHits > 0 || buyerHits > 0) return false;
  if (config.requireStrongExclusion && exclusionHits === 0) return false;
  return true;
}

export function evaluateSearchSnippetGate(
  hit: SearchHit,
  context: CampaignAgentContext,
  config: PreAnalysisGateConfig = resolvePreAnalysisGateConfig(context.strategy),
): PreAnalysisGateEvaluation {
  if (!config.enabled) {
    return {
      skip: false,
      productHits: 0,
      buyerHits: 0,
      exclusionHits: 0,
    };
  }
  const extraProductTerms = config.useQueryTermsInSnippetGate
    ? [hit.query]
    : [];
  const lexicon = compilePreAnalysisLexicon(context, extraProductTerms);
  const text = `${hit.title} ${hit.snippet}`;
  const productHits = countTermHits(text, lexicon.productTerms);
  const buyerHits = countTermHits(text, lexicon.buyerTerms);
  const exclusionHits = countTermHits(text, lexicon.exclusionTerms);
  const skip = shouldSkipPreAnalysis(
    config,
    productHits,
    buyerHits,
    exclusionHits,
  );
  return {
    skip,
    reason: skip
      ? `搜索摘要预筛：无产品词(${productHits})、无买家角色(${buyerHits})、命中排除(${exclusionHits})`
      : undefined,
    productHits,
    buyerHits,
    exclusionHits,
  };
}

export function evaluatePreAnalysisGate(
  candidate: CompanyCandidate,
  context: CampaignAgentContext,
  config: PreAnalysisGateConfig = resolvePreAnalysisGateConfig(context.strategy),
): PreAnalysisGateEvaluation {
  if (!config.enabled) {
    return {
      skip: false,
      productHits: 0,
      buyerHits: 0,
      exclusionHits: 0,
    };
  }
  const lexicon = compilePreAnalysisLexicon(context);
  const text = candidate.pages
    .map((page) => `${page.title} ${page.text}`)
    .join("\n");
  const compactLength = text.replace(/\s+/gu, "").length;
  if (compactLength < config.minPageTextChars) {
    return {
      skip: false,
      productHits: 0,
      buyerHits: 0,
      exclusionHits: 0,
    };
  }
  const productHits = countTermHits(text, lexicon.productTerms);
  const buyerHits = countTermHits(text, lexicon.buyerTerms);
  const exclusionHits = countTermHits(text, lexicon.exclusionTerms);
  const skip = shouldSkipPreAnalysis(
    config,
    productHits,
    buyerHits,
    exclusionHits,
  );
  return {
    skip,
    reason: skip
      ? `抓取后预筛：无产品词(${productHits})、无买家角色(${buyerHits})、命中排除(${exclusionHits})`
      : undefined,
    productHits,
    buyerHits,
    exclusionHits,
  };
}
