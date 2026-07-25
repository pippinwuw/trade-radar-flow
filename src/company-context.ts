import { createHash } from "node:crypto";
import type { CampaignAgentContext } from "./agent-runtime.js";
import type {
  CompanyCandidate,
  ContactValidation,
  LeadRecord,
} from "./domain.js";
import { getDatabase } from "./storage/database.js";
import {
  buildContactCatalog,
  buildEvidenceCatalog,
  type ContactReference,
  type EvidenceSnippet,
} from "./validation/company-analysis-validator.js";

export const COMPANY_ANALYSIS_CONTRACT_VERSION = "company-analysis-v2";

export type EvidenceSlot =
  | "identity"
  | "productFit"
  | "businessRole"
  | "scaleAndImport"
  | "countrySignals"
  | "exclusionsAndRisks";

const SLOT_QUOTAS: Record<EvidenceSlot, number> = {
  identity: 6,
  productFit: 10,
  businessRole: 6,
  scaleAndImport: 6,
  countrySignals: 4,
  exclusionsAndRisks: 4,
};

export interface CompanyEvidenceItem {
  evidenceRef: string;
  pageIndex: number;
  url: string;
  title: string;
  text: string;
  score: number;
  revalidatedPriorEvidence: boolean;
}

export interface CompanyContextBuild {
  pageFingerprint: string;
  candidateFingerprint: string;
  decisionFingerprint: string;
  cacheKey: string;
  manifest: {
    domain: string;
    pages: Array<{
      pageIndex: number;
      url: string;
      title: string;
      characters: number;
      duplicateOf?: number;
    }>;
    contactCandidateCount: number;
    historicalRuns: number;
    revalidatedPriorEvidenceCount: number;
    nonEvidenceNotice: string;
  };
  catalog: EvidenceSnippet[];
  evidencePack: Record<EvidenceSlot, CompanyEvidenceItem[]>;
  rankedContacts: ContactReference[];
  priorLeads: LeadRecord[];
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")
    .slice(0, 24);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function normalizedTokens(values: readonly string[]): Set<string> {
  return new Set(
    values
      .flatMap((value) => value.toLowerCase().split(/[^\p{L}\p{N}]+/u))
      .map((value) => value.trim())
      .filter((value) => value.length >= 2),
  );
}

function pageTypeBoost(url: string, title: string, slot: EvidenceSlot): number {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    // Keep malformed source URLs searchable as plain data.
  }
  const value = `${path} ${title}`.toLowerCase();
  if ((path === "/" || path === "") && slot === "identity") return 5;
  if (/about|profile|company|who-we-are|our-story/.test(value)) {
    return slot === "identity" || slot === "scaleAndImport" ? 4 : 1;
  }
  if (/product|catalog|solution|application|industr|service/.test(value)) {
    return slot === "productFit" || slot === "businessRole" ? 4 : 1;
  }
  if (/contact|location|find-us|reach-us/.test(value)) {
    return slot === "identity" || slot === "countrySignals" ? 3 : 0;
  }
  return 0;
}

function termsForSlot(
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

function validationForContact(
  candidate: CompanyCandidate,
  value: string,
): ContactValidation | undefined {
  return candidate.contactValidations?.find(
    (validation) => validation.value === value,
  );
}

function contactScore(
  candidate: CompanyCandidate,
  reference: ContactReference,
): number {
  const contact = reference.contact;
  const validation = validationForContact(candidate, contact.value);
  let score = (validation?.confidence ?? 0) * 10;
  if (validation?.sameCompanyDomain) score += 8;
  if (validation?.mxPresent) score += 2;
  if (validation?.countryFormatValid) score += 2;
  if (validation?.contextRole === "sales") score += 6;
  if (validation?.contextRole === "general") score += 3;
  const local = contact.value.split("@")[0]?.toLowerCase() ?? "";
  if (/sales|trade|commercial|export|procurement/.test(local)) score += 4;
  if (contact.type === "email") score += 2;
  return score;
}

export function buildCompanyContext(
  candidate: CompanyCandidate,
  context: CampaignAgentContext,
  model: { provider: string; id: string },
): CompanyContextBuild {
  const pageHashes = candidate.pages.map((page) => hash(page.text.trim()));
  const firstPageByHash = new Map<string, number>();
  const duplicateByIndex = new Map<number, number>();
  pageHashes.forEach((pageHash, index) => {
    const previous = firstPageByHash.get(pageHash);
    if (previous === undefined) firstPageByHash.set(pageHash, index);
    else duplicateByIndex.set(index, previous);
  });

  const normalizedPages = candidate.pages
    .map((page) => ({
      url: page.url,
      title: page.title,
      text: page.text.trim(),
    }))
    .sort((left, right) => left.url.localeCompare(right.url));
  const pageFingerprint = hash({
    domain: candidate.domain.toLowerCase(),
    pages: normalizedPages,
  });
  const candidateFingerprint = hash({
    domain: candidate.domain.toLowerCase(),
    pages: normalizedPages,
    contacts: [...candidate.contactCandidates].sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.value.localeCompare(right.value) ||
        left.sourceUrl.localeCompare(right.sourceUrl),
    ),
    countryValidation: candidate.countryValidation,
    contactValidations: [...(candidate.contactValidations ?? [])].sort(
      (left, right) => left.value.localeCompare(right.value),
    ),
  });
  const decisionFingerprint = hash({
    strategy: context.strategy
      ? {
          product: context.strategy.product,
          targetCustomer: context.strategy.targetCustomer,
          exclusions: context.strategy.exclusions,
          validation: context.strategy.validation,
          output: context.strategy.output,
          customSections: context.strategy.customSections,
        }
      : context.input,
    marketPolicyHash: context.marketPolicy.hash,
  });
  const cacheKey = hash({
    candidateFingerprint,
    decisionFingerprint,
    marketPolicyHash: context.marketPolicy.hash,
    analysisContractVersion: COMPANY_ANALYSIS_CONTRACT_VERSION,
    model,
  });

  const priorLeads = getDatabase().listLeadHistoryByDomain(
    candidate.domain,
    10,
  );
  const priorQuotes = new Set(
    priorLeads.flatMap((lead) =>
      lead.research.evidence.map((evidence) => evidence.quote),
    ),
  );
  const database = getDatabase();
  const storedIndex = database.getCompanyEvidenceIndex(
    candidate.domain,
    pageFingerprint,
  );
  const catalog = storedIndex?.snippets ?? buildEvidenceCatalog(candidate.pages);
  if (!storedIndex) {
    database.putCompanyEvidenceIndex({
      key: hash({ domain: candidate.domain.toLowerCase(), pageFingerprint }),
      domain: candidate.domain,
      pageFingerprint,
      snippets: catalog,
      duplicatePages: [...duplicateByIndex].map(
        ([pageIndex, duplicateOf]) => ({ pageIndex, duplicateOf }),
      ),
      createdAt: new Date().toISOString(),
    });
  }
  const normalizedPriorQuotes = [...priorQuotes]
    .map((quote) => quote.replace(/\s+/gu, " ").trim())
    .filter((quote) => quote.length >= 16);
  const revalidatedRefs = new Set(
    catalog
      .filter((snippet) => {
        const current = snippet.text.replace(/\s+/gu, " ").trim();
        return normalizedPriorQuotes.some(
          (quote) =>
            current === quote ||
            current.includes(quote) ||
            quote.includes(current) ||
            (quote.length >= 48 &&
              current.includes(quote.slice(0, 48))),
        );
      })
      .map((snippet) => snippet.ref),
  );

  const evidencePack = Object.fromEntries(
    (Object.keys(SLOT_QUOTAS) as EvidenceSlot[]).map((slot) => {
      const terms = normalizedTokens(termsForSlot(slot, context));
      const ranked = catalog
        .filter((snippet) => !duplicateByIndex.has(snippet.pageIndex))
        .map((snippet) => {
          const page = candidate.pages[snippet.pageIndex];
          const tokens = normalizedTokens([
            snippet.text,
            page?.title ?? "",
            page?.url ?? "",
          ]);
          let score = 0;
          for (const term of terms) if (tokens.has(term)) score += 1;
          score += pageTypeBoost(
            page?.url ?? "",
            page?.title ?? "",
            slot,
          );
          if (snippet.pageIndex === 0) score += 1;
          if (revalidatedRefs.has(snippet.ref)) score += 12;
          return {
            evidenceRef: snippet.ref,
            pageIndex: snippet.pageIndex,
            url: snippet.url,
            title: page?.title ?? "",
            text: snippet.text,
            score,
            revalidatedPriorEvidence: revalidatedRefs.has(snippet.ref),
          } satisfies CompanyEvidenceItem;
        })
        .filter((item) => item.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.pageIndex - right.pageIndex ||
            left.evidenceRef.localeCompare(right.evidenceRef),
        )
        .slice(0, SLOT_QUOTAS[slot]);
      return [slot, ranked];
    }),
  ) as Record<EvidenceSlot, CompanyEvidenceItem[]>;

  const rankedContacts = buildContactCatalog(candidate.contactCandidates).sort(
    (left, right) =>
      contactScore(candidate, right) - contactScore(candidate, left) ||
      left.ref.localeCompare(right.ref),
  );

  return {
    pageFingerprint,
    candidateFingerprint,
    decisionFingerprint,
    cacheKey,
    manifest: {
      domain: candidate.domain,
      pages: candidate.pages.map((page, pageIndex) => ({
        pageIndex,
        url: page.url,
        title: page.title,
        characters: page.text.length,
        duplicateOf: duplicateByIndex.get(pageIndex),
      })),
      contactCandidateCount: candidate.contactCandidates.length,
      historicalRuns: priorLeads.length,
      revalidatedPriorEvidenceCount: revalidatedRefs.size,
      nonEvidenceNotice:
        "Search queries and snippets explain discovery only and are not official-site evidence.",
    },
    catalog,
    evidencePack,
    rankedContacts,
    priorLeads,
  };
}

export function readEvidenceContext(
  catalog: readonly EvidenceSnippet[],
  evidenceRef: string,
  radius = 1,
): EvidenceSnippet[] {
  const match = /^p(\d+)-s(\d+)$/.exec(evidenceRef);
  if (!match) throw new Error(`证据引用格式无效：${evidenceRef}`);
  const pageIndex = Number(match[1]);
  const snippetIndex = Number(match[2]);
  return catalog.filter((snippet) => {
    const parsed = /^p(\d+)-s(\d+)$/.exec(snippet.ref);
    return (
      parsed &&
      Number(parsed[1]) === pageIndex &&
      Math.abs(Number(parsed[2]) - snippetIndex) <= radius
    );
  });
}

export function searchCompanyEvidence(
  build: CompanyContextBuild,
  query: string,
  cursor: number,
  limit: number,
): { items: CompanyEvidenceItem[]; nextCursor?: number } {
  const terms = normalizedTokens([query]);
  const items = build.catalog
    .map((snippet) => {
      const tokens = normalizedTokens([snippet.text]);
      let score = 0;
      for (const term of terms) if (tokens.has(term)) score += 1;
      return {
        evidenceRef: snippet.ref,
        pageIndex: snippet.pageIndex,
        url: snippet.url,
        title: "",
        text: snippet.text,
        score,
        revalidatedPriorEvidence: false,
      } satisfies CompanyEvidenceItem;
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.evidenceRef.localeCompare(right.evidenceRef),
    );
  const start = Math.max(0, cursor);
  const size = Math.max(1, Math.min(8, limit));
  return {
    items: items.slice(start, start + size),
    nextCursor: start + size < items.length ? start + size : undefined,
  };
}
