import { performance } from "node:perf_hooks";
import type {
  AgentResult,
  AgentRuntime,
  CampaignAgentContext,
} from "./agent-runtime.js";
import type {
  BusinessRole,
  CampaignInput,
  CompanyAnalysisResult,
  CompanyCandidate,
  CompanyResearchPacket,
  CountryProfile,
  MarketPolicy,
  Evidence,
  OutreachBrief,
  QualificationDecision,
  ResolvedContact,
  SearchPlan,
} from "./domain.js";
import {
  DEFAULT_SEARCH_QUERIES,
} from "./limits.js";

const PRODUCT_TERMS = [
  "tarpaulin",
  "truck side curtain",
  "coated fabric",
  "printable pvc banner",
  "coated textile",
  "mesh",
  "custom cover",
];

const SCALE_TERMS = [
  "warehouse",
  "branch",
  "oem",
  "global",
  "distribution network",
  "founded",
];

function sentenceContaining(text: string, term: string): string {
  return (
    text
      .split(/(?<=[.!?])\s+/)
      .find((sentence) => sentence.toLowerCase().includes(term.toLowerCase())) ??
    text.slice(0, 260)
  );
}

function canonicalName(candidate: CompanyCandidate): string {
  const title = candidate.pages[0]?.title ?? candidate.domain;
  const cleanedTitle = title
    .replace(/^(about|company profile|welcome to)\s+/i, "")
    .replace(/\s+[|–-].*$/, "")
    .trim();
  if (!cleanedTitle || /^(company profile|home|about us)$/i.test(title.trim())) {
    const opening = candidate.pages[0]?.text.match(
      /^(.{2,80}?)(?:\s+is\b|\s+supplies\b|\s+distributes\b)/i,
    )?.[1];
    if (opening) return opening.trim();
  }
  return cleanedTitle;
}

function createEvidence(candidate: CompanyCandidate): Evidence[] {
  const evidence: Evidence[] = [];
  let sequence = 1;
  for (const page of candidate.pages) {
    const lower = page.text.toLowerCase();
    for (const term of PRODUCT_TERMS) {
      if (lower.includes(term)) {
        evidence.push({
          id: `ev-${candidate.id}-${sequence++}`,
          kind: "product",
          label: "主营产品",
          value: term,
          quote: sentenceContaining(page.text, term),
          sourceUrl: page.url,
          confidence: 0.94,
        });
      }
    }
    for (const term of SCALE_TERMS) {
      if (lower.includes(term)) {
        evidence.push({
          id: `ev-${candidate.id}-${sequence++}`,
          kind: "scale",
          label: "规模线索",
          value: term,
          quote: sentenceContaining(page.text, term),
          sourceUrl: page.url,
          confidence: 0.9,
        });
      }
    }
    const roleMatch = page.text.match(
      /\b(distributor|importer|wholesaler|manufacturer|retail(?:er)?|repair shop)\b/i,
    );
    const roleTerm =
      roleMatch?.[0] ??
      (/distribution network|\bsuppl(?:y|ies|ier)\b/i.test(page.text)
        ? "Distributor"
        : undefined);
    if (roleTerm) {
      evidence.push({
        id: `ev-${candidate.id}-${sequence++}`,
        kind: "business_role",
        label: "经营角色",
        value: roleTerm,
        quote: sentenceContaining(page.text, roleTerm),
        sourceUrl: page.url,
        confidence: 0.95,
      });
    }
  }
  return evidence;
}

function resolveContacts(candidate: CompanyCandidate): ResolvedContact[] {
  return candidate.contactCandidates.map((contact) => {
    const local = contact.value.split("@")[0]?.toLowerCase() ?? "";
    const isSales = /sales|trade|commercial|export/.test(
      `${local} ${contact.nearbyText ?? ""}`.toLowerCase(),
    );
    const isSupport = /help|support|service/.test(local);
    return {
      type: contact.type,
      value: contact.value,
      label: isSales
        ? "推荐业务联系人"
        : isSupport
          ? "客户支持（非首选）"
          : "公司公开联系方式",
      confidence: isSales ? 0.96 : isSupport ? 0.58 : 0.82,
      sourceUrl: contact.sourceUrl,
      verified: false,
    };
  });
}

function inferRole(research: CompanyResearchPacket): BusinessRole {
  const text = `${research.summary} ${research.evidence
    .map((item) => `${item.value} ${item.quote}`)
    .join(" ")}`.toLowerCase();
  if (text.includes("repair shop") || text.includes("retail")) return "Retailer";
  if (text.includes("distributor")) return "Distributor";
  if (text.includes("importer")) return "Importer";
  if (text.includes("wholesaler")) return "Wholesaler";
  if (text.includes("manufacturer")) return "Manufacturer";
  return "Unknown";
}

function bestContact(research: CompanyResearchPacket): string {
  const contact = [...research.contacts].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  return contact ? `${contact.label}：${contact.value}` : "尚未发现可靠联系人";
}

export class DemoAgentRuntime implements AgentRuntime {
  readonly mode = "demo" as const;

  async planSearch(
    input: CampaignInput,
    country: CountryProfile,
    marketPolicy: MarketPolicy,
    context?: CampaignAgentContext,
  ): Promise<AgentResult<SearchPlan>> {
    const started = performance.now();
    const strategy = context?.strategy;
    const requestedBudget =
      strategy?.budget.maxQueries ?? DEFAULT_SEARCH_QUERIES;
    const targetQueries = Number.isFinite(requestedBudget)
      ? Math.max(1, Math.floor(requestedBudget))
      : DEFAULT_SEARCH_QUERIES;
    const cities =
      strategy?.search.cities.length
        ? strategy.search.cities
        : country.cities;
    const terms = [
      input.product,
      ...(strategy?.search.requiredKeywords ?? []),
      ...(strategy?.search.alternativeKeywords ?? []),
      ...(strategy?.search.localLanguageKeywords ?? []),
    ].filter((term, index, values) => term && values.indexOf(term) === index);
    const roles = (
      strategy?.targetCustomer.businessRoles.length
        ? strategy.targetCustomer.businessRoles
        : ["Distributor", "Importer", "Wholesaler"]
    ).map((role) => role.toLowerCase());
    const queryCandidates = terms.flatMap((term) =>
      roles.flatMap((role) =>
        cities.map((city) => ({
          query: `${term} ${role} ${city}`,
          language: /[\u0600-\u06ff]/.test(term) ? "Arabic" : input.language,
          rationale: "产品词 + 目标经营角色 + 重点城市",
          groupId: `${term.trim().toLowerCase()}::${role}::${
            /[\u0600-\u06ff]/.test(term) ? "arabic" : input.language.toLowerCase()
          }`,
        })),
      ),
    );
    const value: SearchPlan = {
      countryId: country.id,
      product: input.product,
      marketPolicyRef: {
        marketId: marketPolicy.marketId,
        version: marketPolicy.version,
        hash: marketPolicy.hash,
      },
      queries: queryCandidates.slice(0, targetQueries),
    };
    return {
      value,
      trace: {
        agent: "SearchPlanningAgent",
        mode: "demo",
        status: "succeeded",
        steps: [
          `加载 ${marketPolicy.marketId}@${marketPolicy.version} 市场规则包`,
          `按预算生成 ${value.queries.length} 条本地化查询`,
        ],
        durationMs: Math.round(performance.now() - started),
      },
    };
  }

  async analyzeCompany(
    candidate: CompanyCandidate,
    _context?: CampaignAgentContext,
  ): Promise<AgentResult<CompanyAnalysisResult>> {
    const started = performance.now();
    const evidence = createEvidence(candidate);
    const contacts = resolveContacts(candidate);
    const products = [
      ...new Set(
        evidence
          .filter((item) => item.kind === "product")
          .map((item) => item.value),
      ),
    ];
    const name = canonicalName(candidate);
    const research: CompanyResearchPacket = {
      companyId: candidate.id,
      canonicalName: name,
      summary: `${name}：${candidate.searchSnippet}`,
      products,
      contacts,
      evidence,
      missingInformation: contacts.length === 0 ? ["可靠联系方式"] : [],
    };
    const role = inferRole(research);
    const productEvidence = research.evidence.filter(
      (item) => item.kind === "product",
    );
    const scaleEvidence = research.evidence.filter(
      (item) => item.kind === "scale",
    );
    const disqualifiedRole = role === "Retailer" || role === "Service";
    const productFitScore = Math.min(98, productEvidence.length * 18 + 34);
    const scaleScore = Math.min(95, scaleEvidence.length * 13 + 28);
    const confidence =
      role === "Unknown"
        ? 0.58
        : Math.min(0.97, 0.76 + productEvidence.length * 0.04);
    const reviewPerformed = confidence < 0.8 || disqualifiedRole;
    const qualification: QualificationDecision = {
      isQualified:
        !disqualifiedRole &&
        role !== "Unknown" &&
        productFitScore >= 60 &&
        scaleScore >= 50,
      businessRole: role,
      productFitScore,
      scaleScore,
      importCapability: scaleEvidence.some((item) =>
        /global|oem|import/i.test(`${item.value} ${item.quote}`),
      )
        ? "High"
        : scaleEvidence.length > 0
          ? "Medium"
          : "Unknown",
      confidence,
      reasons: disqualifiedRole
        ? ["经营模式以零售或维修服务为主，不符合批发获客目标"]
        : [
            `识别为 ${role}`,
            `发现 ${productEvidence.length} 条产品匹配证据`,
            `发现 ${scaleEvidence.length} 条规模或采购能力证据`,
          ],
      evidenceIds: research.evidence.map((item) => item.id),
      missingInformation: research.missingInformation,
      reviewPerformed,
    };
    const printable = research.products.some((product) =>
      /print|mesh|textile/.test(product),
    );
    const templateId = printable ? "printing-media" : "distributor";
    const product = research.products[0] ?? "industrial coated fabrics";
    const evidenceIds = qualification.evidenceIds.slice(0, 4);
    const outreach: OutreachBrief = {
      headline: `${research.canonicalName} · ${role} · 产品匹配 ${qualification.productFitScore}`,
      whyContact: qualification.isQualified
        ? `该公司与目标产品匹配，且存在${qualification.scaleScore >= 70 ? "较强" : "可验证的"}区域分销或采购线索。`
        : "当前证据不足以进入主动触达队列。",
      productFit: research.products.join("、") || "未识别到明确匹配产品",
      keyEvidence: research.evidence
        .filter((item) => evidenceIds.includes(item.id))
        .map((item) => item.quote),
      risk:
        research.missingInformation.join("、") ||
        (research.contacts.some((item) => !item.verified)
          ? "演示联系方式未做真实可投递验证"
          : "未发现明显风险"),
      recommendedContact: bestContact(research),
      templateId,
      templateReason: printable
        ? "网站主营可打印介质，匹配广告喷绘商模板"
        : "经营角色与产品证据匹配分销商模板",
      emailSubject: `Coated fabric supply for ${research.canonicalName}`,
      emailBody:
        `Hi ${research.canonicalName} team,\n\n` +
        `I noticed your work with ${product}. We supply stable-volume coated fabric programs with flexible specifications and sample support for ${role.toLowerCase()} partners.\n\n` +
        "Would it be useful if I shared a concise catalogue and the closest specification options for your current range?\n\nBest regards,",
      whatsappBody:
        `Hi, I noticed ${research.canonicalName} works with ${product}. ` +
        "We supply matching coated fabrics for volume buyers. May I send a short catalogue and sample options?",
      evidenceIds,
    };
    return {
      value: {
        research,
        qualification,
        outreach,
      },
      trace: {
        agent: "CompanyAnalysisAgent",
        mode: "demo",
        status: "succeeded",
        steps: [
          `一次性读取 ${candidate.pages.length} 个已抓取页面`,
          `整理 ${research.evidence.length} 条证据并消歧 ${research.contacts.length} 个联系方式`,
          `完成资格判断与低置信复核：${qualification.isQualified ? "合格" : "不合格"}`,
          `生成触达简报与模板：${outreach.templateId}`,
        ],
        durationMs: Math.round(performance.now() - started),
      },
    };
  }

}
