import ExcelJS from "exceljs";
import type {
  CampaignResult,
  ContactValidation,
  LeadStatus,
} from "./domain.js";

export const CAMPAIGN_EXPORT_SCHEMA_VERSION = 1 as const;

export interface CampaignExportContact {
  type: "email" | "phone" | "whatsapp";
  value: string;
  label: string;
  confidence: number;
  sourceUrl: string;
  verified: boolean;
  validation?: ContactValidation;
}

export interface CampaignExportLead {
  id: string;
  status: LeadStatus;
  companyName: string;
  domain: string;
  homepage: string;
  summary: string;
  products: string[];
  businessRole: string;
  isQualified: boolean;
  productFitScore: number;
  scaleScore: number;
  importCapability: string;
  confidence: number;
  reasons: string[];
  missingInformation: string[];
  countryScore?: number;
  countryMatched?: boolean;
  contacts: CampaignExportContact[];
  createdAt: string;
}

export interface CampaignExportEvidence {
  leadId: string;
  companyName: string;
  evidenceId: string;
  kind: string;
  label: string;
  value: string;
  quote: string;
  sourceUrl: string;
  confidence: number;
}

export interface CampaignExportDocument {
  schemaVersion: typeof CAMPAIGN_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  campaign: {
    id: string;
    product: string;
    country: string;
    language: string;
    mode: CampaignResult["mode"];
    searchMode?: CampaignResult["searchMode"];
    startedAt: string;
    completedAt: string;
    leadCount: number;
    statusCounts: Record<LeadStatus, number>;
    discovery?: {
      provider: CampaignResult["discovery"] extends infer T
        ? T extends { provider: infer P }
          ? P
          : never
        : never;
      hitCount: number;
      skippedCount: number;
      errorCount: number;
      serpRequests: number;
      cacheHits: number;
      executedQueries?: number;
      stopReason?: string;
    };
  };
  leads: CampaignExportLead[];
  evidence: CampaignExportEvidence[];
}

function statusCounts(
  campaign: CampaignResult,
): Record<LeadStatus, number> {
  const counts: Record<LeadStatus, number> = {
    qualified: 0,
    needs_review: 0,
    rejected: 0,
    approved: 0,
  };
  for (const lead of campaign.leads) {
    counts[lead.status] += 1;
  }
  return counts;
}

export function projectCampaignExport(
  campaign: CampaignResult,
  exportedAt = new Date().toISOString(),
): CampaignExportDocument {
  const leads: CampaignExportLead[] = campaign.leads.map((lead) => ({
    id: lead.id,
    status: lead.status,
    companyName: lead.research.canonicalName,
    domain: lead.candidate.domain,
    homepage: lead.candidate.homepage,
    summary: lead.research.summary,
    products: [...lead.research.products],
    businessRole: lead.qualification.businessRole,
    isQualified: lead.qualification.isQualified,
    productFitScore: lead.qualification.productFitScore,
    scaleScore: lead.qualification.scaleScore,
    importCapability: lead.qualification.importCapability,
    confidence: lead.qualification.confidence,
    reasons: [...lead.qualification.reasons],
    missingInformation: [
      ...new Set([
        ...lead.research.missingInformation,
        ...lead.qualification.missingInformation,
      ]),
    ],
    countryScore: lead.candidate.countryValidation?.score,
    countryMatched: lead.candidate.countryValidation?.matched,
    contacts: lead.research.contacts.map((contact) => ({
      type: contact.type,
      value: contact.value,
      label: contact.label,
      confidence: contact.confidence,
      sourceUrl: contact.sourceUrl,
      verified: contact.verified,
      validation: contact.validation,
    })),
    createdAt: lead.createdAt,
  }));
  const evidence = campaign.leads.flatMap((lead) =>
    lead.research.evidence.map((item) => ({
      leadId: lead.id,
      companyName: lead.research.canonicalName,
      evidenceId: item.id,
      kind: item.kind,
      label: item.label,
      value: item.value,
      quote: item.quote,
      sourceUrl: item.sourceUrl,
      confidence: item.confidence,
    })),
  );
  const progress = campaign.discovery?.progress;

  return {
    schemaVersion: CAMPAIGN_EXPORT_SCHEMA_VERSION,
    exportedAt,
    campaign: {
      id: campaign.id,
      product: campaign.product,
      country: campaign.country,
      language: campaign.language,
      mode: campaign.mode,
      searchMode: campaign.searchMode,
      startedAt: campaign.startedAt,
      completedAt: campaign.completedAt,
      leadCount: campaign.leads.length,
      statusCounts: statusCounts(campaign),
      discovery: campaign.discovery
        ? {
            provider: campaign.discovery.provider,
            hitCount: campaign.discovery.hits.length,
            skippedCount: campaign.discovery.skipped.length,
            errorCount: campaign.discovery.errors.length,
            serpRequests: campaign.discovery.serpRequests,
            cacheHits: campaign.discovery.cacheHits,
            executedQueries: progress?.executedQueries,
            stopReason: progress?.stopReason,
          }
        : undefined,
    },
    leads,
    evidence,
  };
}

export function serializeCampaignJson(document: CampaignExportDocument): Buffer {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function campaignExportFilename(
  campaign: Pick<CampaignResult, "country" | "product">,
  extension: "json" | "xlsx",
): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const maximumBaseLength = 160 - extension.length - 1;
  let base = `trade-radar-${campaign.country}-${campaign.product}-${date}`
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[ .-]+$/g, "")
    .slice(0, maximumBaseLength)
    .replace(/[ .-]+$/g, "");
  if (/[\ud800-\udbff]$/.test(base)) {
    base = base.slice(0, -1);
  }
  return `${base || "trade-radar-export"}.${extension}`;
}

function spreadsheetText(value: unknown): string {
  const text = Array.isArray(value)
    ? value.map((item) => String(item)).join("\n")
    : String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function applyHeaderStyle(worksheet: ExcelJS.Worksheet): void {
  const row = worksheet.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: "middle", wrapText: true };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };
}

export async function buildCampaignWorkbook(
  document: CampaignExportDocument,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "trade-radar-flow";
  workbook.lastModifiedBy = "trade-radar-flow";
  workbook.created = new Date(document.exportedAt);
  workbook.modified = new Date(document.exportedAt);

  const summary = workbook.addWorksheet("Campaign Summary");
  summary.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 72 },
  ];
  const summaryRows: Array<[string, unknown]> = [
    ["Schema version", document.schemaVersion],
    ["Exported at", document.exportedAt],
    ["Campaign ID", document.campaign.id],
    ["Product", document.campaign.product],
    ["Country", document.campaign.country],
    ["Language", document.campaign.language],
    ["Agent mode", document.campaign.mode],
    ["Search mode", document.campaign.searchMode],
    ["Started at", document.campaign.startedAt],
    ["Completed at", document.campaign.completedAt],
    ["Lead count", document.campaign.leadCount],
    ["Qualified", document.campaign.statusCounts.qualified],
    ["Needs review", document.campaign.statusCounts.needs_review],
    ["Rejected", document.campaign.statusCounts.rejected],
    ["Approved", document.campaign.statusCounts.approved],
    ["Search provider", document.campaign.discovery?.provider],
    ["Search hits", document.campaign.discovery?.hitCount],
    ["Serper requests", document.campaign.discovery?.serpRequests],
    ["Search cache hits", document.campaign.discovery?.cacheHits],
    ["Executed queries", document.campaign.discovery?.executedQueries],
    ["Stop reason", document.campaign.discovery?.stopReason],
  ];
  for (const [field, value] of summaryRows) {
    summary.addRow({
      field,
      value: spreadsheetText(value),
    });
  }
  applyHeaderStyle(summary);

  const leads = workbook.addWorksheet("Leads");
  leads.columns = [
    { header: "Lead ID", key: "id", width: 38 },
    { header: "Status", key: "status", width: 16 },
    { header: "Company", key: "companyName", width: 32 },
    { header: "Domain", key: "domain", width: 28 },
    { header: "Homepage", key: "homepage", width: 42 },
    { header: "Summary", key: "summary", width: 60 },
    { header: "Products", key: "products", width: 36 },
    { header: "Business role", key: "businessRole", width: 20 },
    { header: "Qualified", key: "isQualified", width: 12 },
    { header: "Product fit", key: "productFitScore", width: 12 },
    { header: "Scale", key: "scaleScore", width: 12 },
    { header: "Import capability", key: "importCapability", width: 18 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Country score", key: "countryScore", width: 14 },
    { header: "Country matched", key: "countryMatched", width: 16 },
    { header: "Reasons", key: "reasons", width: 52 },
    { header: "Missing information", key: "missingInformation", width: 42 },
    { header: "Created at", key: "createdAt", width: 26 },
  ];
  for (const lead of document.leads) {
    leads.addRow({
      ...lead,
      companyName: spreadsheetText(lead.companyName),
      domain: spreadsheetText(lead.domain),
      homepage: spreadsheetText(lead.homepage),
      summary: spreadsheetText(lead.summary),
      products: spreadsheetText(lead.products),
      reasons: spreadsheetText(lead.reasons),
      missingInformation: spreadsheetText(lead.missingInformation),
    });
  }
  applyHeaderStyle(leads);

  const evidence = workbook.addWorksheet("Evidence");
  evidence.columns = [
    { header: "Lead ID", key: "leadId", width: 38 },
    { header: "Company", key: "companyName", width: 32 },
    { header: "Evidence ID", key: "evidenceId", width: 38 },
    { header: "Kind", key: "kind", width: 18 },
    { header: "Label", key: "label", width: 28 },
    { header: "Value", key: "value", width: 40 },
    { header: "Quote", key: "quote", width: 72 },
    { header: "Source URL", key: "sourceUrl", width: 48 },
    { header: "Confidence", key: "confidence", width: 12 },
  ];
  for (const item of document.evidence) {
    evidence.addRow({
      ...item,
      companyName: spreadsheetText(item.companyName),
      label: spreadsheetText(item.label),
      value: spreadsheetText(item.value),
      quote: spreadsheetText(item.quote),
      sourceUrl: spreadsheetText(item.sourceUrl),
    });
  }
  applyHeaderStyle(evidence);

  const contacts = workbook.addWorksheet("Contacts");
  contacts.columns = [
    { header: "Lead ID", key: "leadId", width: 38 },
    { header: "Company", key: "companyName", width: 32 },
    { header: "Type", key: "type", width: 14 },
    { header: "Value", key: "value", width: 34 },
    { header: "Label", key: "label", width: 24 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Verified", key: "verified", width: 12 },
    { header: "Context role", key: "contextRole", width: 16 },
    { header: "Syntax valid", key: "syntaxValid", width: 14 },
    { header: "MX present", key: "mxPresent", width: 12 },
    { header: "Same company domain", key: "sameCompanyDomain", width: 20 },
    { header: "Country format valid", key: "countryFormatValid", width: 20 },
    { header: "Source URL", key: "sourceUrl", width: 48 },
    { header: "Notes", key: "notes", width: 48 },
  ];
  for (const lead of document.leads) {
    for (const contact of lead.contacts) {
      contacts.addRow({
        leadId: lead.id,
        companyName: spreadsheetText(lead.companyName),
        type: contact.type,
        value: spreadsheetText(contact.value),
        label: spreadsheetText(contact.label),
        confidence: contact.confidence,
        verified: contact.verified,
        contextRole: contact.validation?.contextRole,
        syntaxValid: contact.validation?.syntaxValid,
        mxPresent: contact.validation?.mxPresent,
        sameCompanyDomain: contact.validation?.sameCompanyDomain,
        countryFormatValid: contact.validation?.countryFormatValid,
        sourceUrl: spreadsheetText(contact.sourceUrl),
        notes: spreadsheetText(contact.validation?.notes ?? []),
      });
    }
  }
  applyHeaderStyle(contacts);

  for (const worksheet of workbook.worksheets) {
    worksheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
