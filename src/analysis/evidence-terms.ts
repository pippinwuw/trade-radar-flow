import type { CampaignAgentContext } from "../agents/agent-runtime.js";

export type EvidenceSlot =
  | "identity"
  | "productFit"
  | "businessRole"
  | "scaleAndImport"
  | "countrySignals"
  | "exclusionsAndRisks";

export function normalizedTokens(values: readonly string[]): Set<string> {
  return new Set(
    values
      .flatMap((value) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u))
      .map((value) => value.trim())
      .filter((value) => value.length >= 2),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeTerms(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function extractMatchablePhrases(text: string): string[] {
  const phrases: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) return phrases;
  const parenthetical = trimmed.match(/\(([^)]+)\)/);
  if (parenthetical?.[1]) {
    phrases.push(parenthetical[1].trim());
  }
  for (const part of trimmed.split(/[,;]/)) {
    const normalized = part.replace(/\([^)]*\)/g, "").trim();
    if (normalized.length >= 3 && normalized.length <= 80) {
      phrases.push(normalized);
    }
  }
  if (trimmed.length <= 80) phrases.push(trimmed);
  return phrases;
}

export function countTermHits(text: string, terms: readonly string[]): number {
  const normalized = text.toLowerCase().replace(/\s+/gu, " ").trim();
  if (!normalized) return 0;
  let hits = 0;
  for (const term of terms) {
    const value = term.trim().toLowerCase();
    if (value.length < 2) continue;
    if (value.includes(" ") || value.length >= 8) {
      if (normalized.includes(value)) hits += 1;
      continue;
    }
    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(value)}(?:$|[^\\p{L}\\p{N}])`,
      "iu",
    );
    if (pattern.test(normalized) || normalized === value) hits += 1;
  }
  return hits;
}

export function termsForEvidenceSlot(
  slot: EvidenceSlot,
  context: CampaignAgentContext,
): string[] {
  const strategy = context.strategy;
  const marketPolicy = context.marketPolicy;
  switch (slot) {
    case "identity":
      return [
        "about",
        "company",
        "founded",
        "established",
        "profile",
        ...marketPolicy.companyAnalysis.identitySignals,
        ...marketPolicy.companyAnalysis.legalSuffixSemantics,
      ];
    case "productFit":
      return [
        context.input.product,
        ...(strategy?.search.requiredKeywords ?? []),
        ...(strategy?.search.alternativeKeywords ?? []),
        ...(strategy?.search.localLanguageKeywords ?? []),
        "product",
        "application",
        "solution",
      ];
    case "businessRole":
      return [
        ...(strategy?.targetCustomer.businessRoles ?? []),
        ...marketPolicy.searchLocalization.buyerRoleTerms,
        ...marketPolicy.companyAnalysis.buyerSignals,
      ];
    case "scaleAndImport":
      return [
        "import",
        "warehouse",
        "branch",
        "global",
        "sourcing",
        "oem",
        "distribution network",
        ...marketPolicy.companyAnalysis.importAndScaleSignals,
      ];
    case "countrySignals":
      return [
        context.country.displayName,
        context.country.shortName,
        ...context.country.cities,
        context.country.callingCode,
        context.country.domainSuffix,
        ...context.country.businessSuffixes,
        ...marketPolicy.companyAnalysis.identitySignals,
      ];
    case "exclusionsAndRisks":
      return [
        ...(strategy?.exclusions.terms ?? []),
        ...(strategy?.exclusions.businessRoles ?? []),
        ...marketPolicy.companyAnalysis.falsePositivePatterns,
        ...marketPolicy.companyAnalysis.exclusions,
      ];
  }
}

export interface PreAnalysisLexicon {
  productTerms: string[];
  buyerTerms: string[];
  exclusionTerms: string[];
}

export function compilePreAnalysisLexicon(
  context: CampaignAgentContext,
  extraProductTerms: readonly string[] = [],
): PreAnalysisLexicon {
  const strategy = context.strategy;
  const marketPolicy = context.marketPolicy;
  return {
    productTerms: dedupeTerms([
      context.input.product,
      ...(strategy?.product ? [strategy.product] : []),
      ...(strategy?.search.requiredKeywords ?? []),
      ...(strategy?.search.alternativeKeywords ?? []),
      ...(strategy?.search.localLanguageKeywords ?? []),
      ...extraProductTerms,
    ]),
    buyerTerms: dedupeTerms([
      ...(strategy?.targetCustomer.businessRoles ?? []).map((role) =>
        role.toLowerCase(),
      ),
      ...marketPolicy.searchLocalization.buyerRoleTerms,
      ...marketPolicy.companyAnalysis.buyerSignals.flatMap(
        extractMatchablePhrases,
      ),
    ]),
    exclusionTerms: dedupeTerms([
      ...(strategy?.exclusions.terms ?? []),
      ...(strategy?.exclusions.businessRoles ?? []).map((role) =>
        role.toLowerCase(),
      ),
      ...marketPolicy.companyAnalysis.exclusions.flatMap(extractMatchablePhrases),
    ]),
  };
}
