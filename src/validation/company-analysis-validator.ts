import type {
  CompanyAnalysisResult,
  CompanyCandidate,
  CompanyResearchPacket,
  ContactCandidate,
  OutreachBrief,
  PageSnapshot,
  QualificationDecision,
  ResolvedContact,
} from "../domain.js";

export class CompanyAnalysisValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`公司分析提交未通过校验：\n- ${issues.join("\n- ")}`);
    this.name = "CompanyAnalysisValidationError";
  }
}

interface NormalizedText {
  value: string;
  sourceIndexes: number[];
}

export interface EvidenceSnippet {
  ref: string;
  pageIndex: number;
  url: string;
  text: string;
}

export interface ContactReference {
  ref: string;
  contact: ContactCandidate;
}

export interface CompanyAnalysisDraft {
  research: Omit<CompanyResearchPacket, "evidence" | "contacts"> & {
    contacts: Array<{
      sourceRef: string;
      label: string;
      confidence: number;
    }>;
    evidence: Array<{
      id: string;
      kind: CompanyResearchPacket["evidence"][number]["kind"];
      label: string;
      value: string;
      sourceRef: string;
      confidence: number;
    }>;
  };
  qualification: QualificationDecision;
  outreach: Omit<OutreachBrief, "keyEvidence" | "recommendedContact"> & {
    recommendedContactRef: string;
  };
}

export interface CompanyAnalysisSubmissionV2 {
  research: {
    canonicalName: string;
    summary: string;
    products: string[];
    contacts: Array<{
      contactRef: string;
      label: string;
      confidence: number;
    }>;
    facts: Array<{
      kind: CompanyResearchPacket["evidence"][number]["kind"];
      label: string;
      value: string;
      evidenceRef: string;
      confidence: number;
    }>;
    missingInformation: string[];
  };
  qualification: Omit<
    QualificationDecision,
    "evidenceIds" | "reviewPerformed"
  > & {
    evidenceRefs: string[];
    riskAssessment: string[];
  };
  outreach: Omit<
    OutreachBrief,
    "keyEvidence" | "recommendedContact" | "evidenceIds"
  > & {
    evidenceRefs: string[];
    recommendedContactRef: string;
  };
}

const TYPOGRAPHY_EQUIVALENTS: Readonly<Record<string, string>> = {
  "\u00a0": " ",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
};

function normalizeForLocation(value: string): NormalizedText {
  let normalized = "";
  const sourceIndexes: number[] = [];
  let pendingWhitespaceIndex: number | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) continue;
    if (/\s/u.test(character) || character === "\u00a0") {
      if (normalized.length > 0 && pendingWhitespaceIndex === undefined) {
        pendingWhitespaceIndex = index;
      }
      continue;
    }
    if (pendingWhitespaceIndex !== undefined) {
      normalized += " ";
      sourceIndexes.push(pendingWhitespaceIndex);
      pendingWhitespaceIndex = undefined;
    }
    const replacement = TYPOGRAPHY_EQUIVALENTS[character] ?? character;
    normalized += replacement;
    sourceIndexes.push(...Array.from(replacement, () => index));
  }

  return { value: normalized, sourceIndexes };
}

/**
 * Locate a model-supplied quote without weakening provenance. Only whitespace
 * and common typography differences are tolerated; the returned value is
 * always copied verbatim from the crawled page.
 */
export function locateVerbatimQuote(
  pageText: string,
  submittedQuote: string,
): string | undefined {
  if (!submittedQuote.trim()) return undefined;
  const exactIndex = pageText.indexOf(submittedQuote);
  if (exactIndex >= 0) return pageText.slice(exactIndex, exactIndex + submittedQuote.length);

  const page = normalizeForLocation(pageText);
  const quote = normalizeForLocation(submittedQuote).value;
  if (quote.length < 12) return undefined;
  const normalizedIndex = page.value.indexOf(quote);
  if (normalizedIndex < 0) return undefined;

  const start = page.sourceIndexes[normalizedIndex];
  const last = page.sourceIndexes[normalizedIndex + quote.length - 1];
  if (start === undefined || last === undefined) return undefined;
  return pageText.slice(start, last + 1);
}

export const EVIDENCE_CHUNK_MAX_LENGTH = 960;
export const EVIDENCE_CHUNK_MIN_LENGTH = 480;
export const EVIDENCE_CHUNK_OVERLAP = 120;

function splitExactSnippets(
  text: string,
  maxLength = EVIDENCE_CHUNK_MAX_LENGTH,
  minLength = Math.min(EVIDENCE_CHUNK_MIN_LENGTH, maxLength),
): string[] {
  const snippets: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) cursor += 1;
    if (cursor >= text.length) break;
    const limit = Math.min(text.length, cursor + maxLength);
    let end = limit;
    const minimumEnd = Math.min(limit, cursor + minLength);
    for (let index = limit - 1; index >= minimumEnd; index -= 1) {
      if (/[\n.!?。！？]/u.test(text[index] ?? "")) {
        end = index + 1;
        break;
      }
    }
    if (end === limit && end < text.length) {
      const whitespace = text.lastIndexOf(" ", end);
      if (whitespace >= minimumEnd) end = whitespace;
    }
    const snippet = text.slice(cursor, end).trimEnd();
    if (snippet) snippets.push(snippet);
    if (end >= text.length) break;
    cursor = Math.max(end - EVIDENCE_CHUNK_OVERLAP, cursor + 1);
  }
  return snippets;
}

export function buildEvidenceCatalog(
  pages: readonly PageSnapshot[],
  excludedPageIndexes: ReadonlySet<number> = new Set(),
): EvidenceSnippet[] {
  return pages.flatMap((page, pageIndex) =>
    excludedPageIndexes.has(pageIndex) || !page.text.trim()
      ? []
      : splitExactSnippets(page.text).map((text, snippetIndex) => ({
          ref: `p${pageIndex}-s${snippetIndex}`,
          pageIndex,
          url: page.url,
          text,
        })),
  );
}

export function buildContactCatalog(
  contacts: readonly ContactCandidate[],
): ContactReference[] {
  return contacts.map((contact, index) => ({
    ref: `c${index}`,
    contact,
  }));
}

export function validateAndNormalizeCompanyAnalysisV2(
  submitted: CompanyAnalysisSubmissionV2,
  candidate: CompanyCandidate,
  readEvidenceRefs: ReadonlySet<string>,
  catalog = buildEvidenceCatalog(candidate.pages),
  contactCatalog = buildContactCatalog(candidate.contactCandidates),
): CompanyAnalysisResult {
  const issues: string[] = [];
  const snippetByRef = new Map(catalog.map((snippet) => [snippet.ref, snippet]));
  const contactByRef = new Map(
    contactCatalog.map(({ ref, contact }) => [ref, contact]),
  );
  const normalizedEvidence = submitted.research.facts.map((fact, index) => {
    const snippet = snippetByRef.get(fact.evidenceRef);
    if (!snippet || !readEvidenceRefs.has(fact.evidenceRef)) {
      issues.push(`事实引用未读取或不存在：${fact.evidenceRef}`);
    }
    return {
      id: `ev-${index + 1}`,
      kind: fact.kind,
      label: fact.label,
      value: fact.value,
      quote: snippet?.text ?? "",
      sourceUrl: snippet?.url ?? "",
      confidence: fact.confidence,
    };
  });
  const evidenceIdByRef = new Map(
    submitted.research.facts.map((fact, index) => [
      fact.evidenceRef,
      `ev-${index + 1}`,
    ]),
  );
  const resolveEvidenceIds = (refs: readonly string[], field: string) =>
    [...new Set(refs)].flatMap((ref) => {
      const id = evidenceIdByRef.get(ref);
      if (!id) {
        issues.push(`${field} 引用了未选择的事实：${ref}`);
        return [];
      }
      return [id];
    });
  const selectedFactRefs = new Set(
    submitted.research.facts.map((fact) => fact.evidenceRef),
  );
  const qualificationRefs = new Set(submitted.qualification.evidenceRefs);
  const hasSelectedFact = (kind: CompanyAnalysisSubmissionV2["research"]["facts"][number]["kind"]) =>
    submitted.research.facts.some(
      (fact) =>
        fact.kind === kind &&
        selectedFactRefs.has(fact.evidenceRef) &&
        readEvidenceRefs.has(fact.evidenceRef),
    );
  const hasQualificationFact = (
    kind: CompanyAnalysisSubmissionV2["research"]["facts"][number]["kind"],
  ) =>
    submitted.research.facts.some(
      (fact) =>
        fact.kind === kind &&
        qualificationRefs.has(fact.evidenceRef) &&
        readEvidenceRefs.has(fact.evidenceRef),
    );
  if (submitted.research.canonicalName.trim() && !hasSelectedFact("identity")) {
    issues.push("canonicalName 缺少 identity 官网事实；无法确认时必须留空");
  }
  if (submitted.research.products.length > 0 && !hasSelectedFact("product")) {
    issues.push("products 缺少 product 官网事实；无法确认时必须返回空数组");
  }
  if (
    submitted.qualification.businessRole !== "Unknown" &&
    !hasQualificationFact("business_role")
  ) {
    issues.push("businessRole 缺少 qualification 引用的 business_role 事实；无法确认时必须为 Unknown");
  }
  if (
    submitted.qualification.importCapability !== "Unknown" &&
    !hasQualificationFact("scale")
  ) {
    issues.push("importCapability 缺少 qualification 引用的 scale/import 事实；无法确认时必须为 Unknown");
  }
  if (
    submitted.qualification.productFitScore > 0 &&
    !hasQualificationFact("product")
  ) {
    issues.push("productFitScore 大于 0 但缺少 qualification 引用的 product 事实");
  }
  if (
    submitted.qualification.scaleScore > 0 &&
    !hasQualificationFact("scale")
  ) {
    issues.push("scaleScore 大于 0 但缺少 qualification 引用的 scale 事实");
  }
  const normalizedContacts: ResolvedContact[] =
    submitted.research.contacts.flatMap((selection) => {
      const contact = contactByRef.get(selection.contactRef);
      if (!contact) {
        issues.push(`联系人引用不存在：${selection.contactRef}`);
        return [];
      }
      return [
        {
          type: contact.type,
          value: contact.value,
          label: selection.label,
          confidence: selection.confidence,
          sourceUrl: contact.sourceUrl,
          verified: false,
        },
      ];
    });
  const qualificationEvidenceIds = resolveEvidenceIds(
    submitted.qualification.evidenceRefs,
    "qualification",
  );
  const outreachEvidenceIds = resolveEvidenceIds(
    submitted.outreach.evidenceRefs,
    "outreach",
  );
  if (
    (submitted.qualification.confidence < 0.8 ||
      !submitted.qualification.isQualified) &&
    submitted.qualification.riskAssessment.length === 0
  ) {
    issues.push("低置信或淘汰结论必须提供 riskAssessment");
  }
  const recommendedContact =
    submitted.outreach.recommendedContactRef === "none"
      ? undefined
      : contactByRef.get(submitted.outreach.recommendedContactRef);
  if (
    submitted.outreach.recommendedContactRef !== "none" &&
    (!recommendedContact ||
      !submitted.research.contacts.some(
        (contact) =>
          contact.contactRef === submitted.outreach.recommendedContactRef,
      ))
  ) {
    issues.push("推荐联系人必须来自 research.contacts");
  }
  if (issues.length) throw new CompanyAnalysisValidationError(issues);

  return {
    research: {
      companyId: candidate.id,
      canonicalName: submitted.research.canonicalName,
      summary: submitted.research.summary,
      products: submitted.research.products,
      contacts: normalizedContacts,
      evidence: normalizedEvidence,
      missingInformation: submitted.research.missingInformation,
    },
    qualification: {
      isQualified: submitted.qualification.isQualified,
      businessRole: submitted.qualification.businessRole,
      productFitScore: submitted.qualification.productFitScore,
      scaleScore: submitted.qualification.scaleScore,
      importCapability: submitted.qualification.importCapability,
      confidence: submitted.qualification.confidence,
      reasons: submitted.qualification.reasons,
      evidenceIds: qualificationEvidenceIds,
      missingInformation: submitted.qualification.missingInformation,
      reviewPerformed:
        submitted.qualification.confidence < 0.8 ||
        !submitted.qualification.isQualified
          ? submitted.qualification.riskAssessment.length > 0
          : true,
    },
    outreach: {
      headline: submitted.outreach.headline,
      whyContact: submitted.outreach.whyContact,
      productFit: submitted.outreach.productFit,
      keyEvidence: outreachEvidenceIds.flatMap((id) => {
        const evidence = normalizedEvidence.find((item) => item.id === id);
        return evidence?.quote ? [evidence.quote] : [];
      }),
      risk: [
        submitted.outreach.risk,
        ...submitted.qualification.riskAssessment,
      ]
        .filter(Boolean)
        .join("；"),
      recommendedContact: recommendedContact?.value ?? "",
      templateId: submitted.outreach.templateId,
      templateReason: submitted.outreach.templateReason,
      emailSubject: submitted.outreach.emailSubject,
      emailBody: submitted.outreach.emailBody,
      whatsappBody: submitted.outreach.whatsappBody,
      evidenceIds: outreachEvidenceIds,
    },
  };
}

export function validateAndNormalizeCompanyAnalysis(
  submitted: CompanyAnalysisDraft,
  candidate: CompanyCandidate,
  allPagesRead: boolean,
  catalog = buildEvidenceCatalog(candidate.pages),
  contactCatalog = buildContactCatalog(candidate.contactCandidates),
): CompanyAnalysisResult {
  const issues: string[] = [];
  if (!allPagesRead) issues.push("提交前必须读取全部清洗页面");
  if (submitted.research.companyId !== candidate.id) {
    issues.push("companyId 与当前候选公司不一致");
  }

  const snippetByRef = new Map(catalog.map((snippet) => [snippet.ref, snippet]));
  const contactByRef = new Map(
    contactCatalog.map(({ ref, contact }) => [ref, contact]),
  );

  const normalizedContacts: ResolvedContact[] = [];
  for (const contact of submitted.research.contacts) {
    const extracted = contactByRef.get(contact.sourceRef);
    if (!extracted) {
      issues.push(`联系方式引用不存在：${contact.sourceRef}`);
      continue;
    }
    normalizedContacts.push({
      type: extracted.type,
      value: extracted.value,
      label: contact.label,
      confidence: contact.confidence,
      sourceUrl: extracted.sourceUrl,
      verified: false,
    });
  }

  const evidenceIds = new Set<string>();
  const normalizedEvidence = submitted.research.evidence.map((evidence) => {
    if (evidenceIds.has(evidence.id)) {
      issues.push(`证据 ID 重复：${evidence.id}`);
    }
    evidenceIds.add(evidence.id);
    const snippet = snippetByRef.get(evidence.sourceRef);
    if (!snippet) {
      issues.push(`证据引用不存在：${evidence.id} -> ${evidence.sourceRef}`);
      return {
        ...evidence,
        quote: "",
        sourceUrl: "",
      };
    }
    return {
      id: evidence.id,
      kind: evidence.kind,
      label: evidence.label,
      value: evidence.value,
      quote: snippet.text,
      sourceUrl: snippet.url,
      confidence: evidence.confidence,
    };
  });

  const referencedIds = [
    ...submitted.qualification.evidenceIds,
    ...submitted.outreach.evidenceIds,
  ];
  for (const evidenceId of new Set(referencedIds)) {
    if (!evidenceIds.has(evidenceId)) {
      issues.push(`引用了不存在的证据 ID：${evidenceId}`);
    }
  }

  const normalizedKeyEvidence = submitted.outreach.evidenceIds.flatMap(
    (evidenceId) => {
      const evidence = normalizedEvidence.find((item) => item.id === evidenceId);
      return evidence?.quote ? [evidence.quote] : [];
    },
  );

  const recommendedContact =
    submitted.outreach.recommendedContactRef === "none"
      ? ""
      : contactByRef.get(submitted.outreach.recommendedContactRef)?.value;
  if (
    submitted.outreach.recommendedContactRef !== "none" &&
    (!recommendedContact ||
      !submitted.research.contacts.some(
        (contact) =>
          contact.sourceRef === submitted.outreach.recommendedContactRef,
      ))
  ) {
    issues.push("推荐联系方式必须引用 research.contacts 中已选择的 sourceRef");
  }
  if (
    (submitted.qualification.confidence < 0.8 ||
      !submitted.qualification.isQualified) &&
    !submitted.qualification.reviewPerformed
  ) {
    issues.push("低置信或淘汰结论必须完成复核");
  }

  if (issues.length > 0) throw new CompanyAnalysisValidationError(issues);

  const { recommendedContactRef: _recommendedContactRef, ...outreach } =
    submitted.outreach;
  return {
    ...submitted,
    research: {
      ...submitted.research,
      contacts: normalizedContacts,
      evidence: normalizedEvidence,
    },
    outreach: {
      ...outreach,
      keyEvidence: normalizedKeyEvidence,
      recommendedContact: recommendedContact ?? "",
    },
  };
}
