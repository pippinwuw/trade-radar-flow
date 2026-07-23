import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  buildCampaignWorkbook,
  campaignExportFilename,
  projectCampaignExport,
  serializeCampaignJson,
} from "../src/campaign-export.js";
import type { CampaignResult, LeadRecord } from "../src/domain.js";

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function lead(): LeadRecord {
  return {
    id: "lead-1",
    candidate: {
      id: "candidate-1",
      homepage: "https://example.test",
      domain: "example.test",
      searchSnippet: "Industrial distributor",
      pages: [],
      contactCandidates: [],
      countryValidation: {
        countryId: "uae",
        score: 0.9,
        matched: true,
        signals: [],
        warnings: [],
      },
    },
    research: {
      companyId: "candidate-1",
      canonicalName: "=FORMULA()",
      summary: "工业材料经销商",
      products: ["industrial fabrics"],
      contacts: [
        {
          type: "email",
          value: "sales@example.test",
          label: "sales",
          confidence: 0.9,
          sourceUrl: "https://example.test/contact",
          verified: false,
          validation: {
            value: "sales@example.test",
            syntaxValid: true,
            mxPresent: true,
            sameCompanyDomain: true,
            contextRole: "sales",
            confidence: 0.9,
            notes: ["public contact page"],
          },
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          kind: "business_role",
          label: "Distributor role",
          value: "Industrial distributor",
          quote: "We distribute industrial fabrics.",
          sourceUrl: "https://example.test/about",
          confidence: 0.95,
        },
      ],
      missingInformation: ["Import history"],
    },
    qualification: {
      isQualified: true,
      businessRole: "Distributor",
      productFitScore: 88,
      scaleScore: 62,
      importCapability: "Unknown",
      confidence: 0.86,
      reasons: ["Relevant product and business role"],
      evidenceIds: ["evidence-1"],
      missingInformation: ["Import history"],
      reviewPerformed: false,
    },
    outreach: {
      headline: "Potential distributor",
      whyContact: "Relevant product range",
      productFit: "Industrial fabrics",
      keyEvidence: ["We distribute industrial fabrics."],
      risk: "Import history unknown",
      recommendedContact: "sales@example.test",
      templateId: "distributor",
      templateReason: "Distributor role",
      emailSubject: "Supply introduction",
      emailBody: "Draft",
      whatsappBody: "Draft",
      evidenceIds: ["evidence-1"],
    },
    traces: [],
    status: "qualified",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}

function campaign(leads: LeadRecord[] = [lead()]): CampaignResult {
  return {
    id: "campaign-1",
    product: "industrial fabrics",
    country: "United Arab Emirates",
    language: "English",
    mode: "demo",
    searchMode: "demo",
    startedAt: "2026-07-23T00:00:00.000Z",
    completedAt: "2026-07-23T00:01:00.000Z",
    leads,
  };
}

test("JSON 导出使用稳定 schema 并保留线索、证据和联系人", () => {
  const document = projectCampaignExport(
    campaign(),
    "2026-07-23T00:02:00.000Z",
  );

  assert.equal(document.schemaVersion, 1);
  assert.equal(document.campaign.leadCount, 1);
  assert.equal(document.campaign.statusCounts.qualified, 1);
  assert.equal(document.leads[0]?.contacts[0]?.value, "sales@example.test");
  assert.equal(document.evidence[0]?.evidenceId, "evidence-1");

  const serialized = JSON.parse(
    serializeCampaignJson(document).toString("utf8"),
  ) as typeof document;
  assert.equal(serialized.campaign.id, "campaign-1");
  assert.equal(serialized.leads[0]?.companyName, "=FORMULA()");
});

test("XLSX 导出跨平台生成通用工作表并转义公式前缀", async () => {
  const document = projectCampaignExport(
    campaign(),
    "2026-07-23T00:02:00.000Z",
  );
  const buffer = await buildCampaignWorkbook(document);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asArrayBuffer(buffer));

  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ["Campaign Summary", "Leads", "Evidence", "Contacts"],
  );
  assert.equal(
    workbook.getWorksheet("Leads")?.getCell("C2").value,
    "'=FORMULA()",
  );
  assert.equal(
    workbook.getWorksheet("Evidence")?.getCell("H2").value,
    "https://example.test/about",
  );
});

test("空 Campaign 仍可导出，文件名不包含路径非法字符", async () => {
  const emptyCampaign = {
    ...campaign([]),
    country: "UAE / Gulf",
    product: "fabric:rolls",
  };
  const document = projectCampaignExport(emptyCampaign);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    asArrayBuffer(await buildCampaignWorkbook(document)),
  );

  assert.equal(document.campaign.leadCount, 0);
  assert.equal(workbook.getWorksheet("Leads")?.rowCount, 1);
  assert.doesNotMatch(
    campaignExportFilename(emptyCampaign, "xlsx"),
    /[<>:"/\\|?*]/,
  );
});
