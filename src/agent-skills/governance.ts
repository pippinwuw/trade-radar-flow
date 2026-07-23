import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentRuntime } from "../pipeline.js";
import { getDatabase } from "../storage/database.js";
import type {
  MarketSkillSummary,
  SkillProposal,
  SupportedCountryId,
} from "../domain.js";
import { buildCampaignAgentContext } from "../discovery/query-planner.js";
import { getMarketSkillRegistry } from "./registry.js";
import { logger } from "../logging/logger.js";
import { resolveCountry } from "../countries/registry.js";

function versionOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function assertSafeProposal(content: string): void {
  if (!content.trim()) throw new Error("Skill 提案内容不能为空");
  if (content.length > 2_000) throw new Error("Skill 提案内容超过 2000 字符");
  if (
    /(?:api[_-]?key|password|private[_-]?key|bearer\s+|sk-[a-z0-9]{12,})/i.test(
      content,
    )
  ) {
    throw new Error("Skill 提案疑似包含密钥或敏感凭据");
  }
}

function appendToSection(
  document: string,
  section: string,
  proposedContent: string,
): string {
  const lines = document.split(/\r?\n/);
  const heading = `## ${section}`;
  const index = lines.findIndex(
    (line) => line.trim().toLowerCase() === heading.toLowerCase(),
  );
  const block = [
    "",
    `<!-- approved skill proposal ${new Date().toISOString()} -->`,
    proposedContent.trim(),
  ];
  if (index < 0) {
    return `${document.trimEnd()}\n\n${heading}\n${block.join("\n")}\n`;
  }
  let nextHeading = lines.length;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor]?.startsWith("## ")) {
      nextHeading = cursor;
      break;
    }
  }
  lines.splice(nextHeading, 0, ...block);
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function listMarketSkills(): Promise<MarketSkillSummary[]> {
  return (await getMarketSkillRegistry()).list();
}

export function listSkillProposals(): SkillProposal[] {
  return getDatabase().listSkillProposals();
}

export async function generateSkillProposal(
  campaignId: string,
): Promise<SkillProposal> {
  const campaign = getDatabase().getCampaign(campaignId);
  if (!campaign) throw new Error("任务不存在");
  const context = await buildCampaignAgentContext({
    product: campaign.product,
    country: campaign.country,
    language: campaign.language,
  });
  const generated = await getAgentRuntime().proposeSkillUpdate(
    context,
    campaign,
  );
  logger.info("agent.trace.recorded", undefined, generated.trace, {
    agent: generated.trace.agent,
    campaignId,
  });
  assertSafeProposal(generated.value.proposedContent);
  const proposal: SkillProposal = {
    id: randomUUID(),
    ...generated.value,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  getDatabase().createSkillProposal(proposal);
  logger.info(
    "skill.proposal.created",
    undefined,
    {
      proposalId: proposal.id,
      countryId: proposal.countryId,
      section: proposal.section,
      title: proposal.title,
      evidenceCount: proposal.evidence.length,
      contentCharacters: proposal.proposedContent.length,
    },
    { campaignId },
  );
  return proposal;
}

export function editSkillProposal(
  id: string,
  proposedContent: string,
): SkillProposal {
  assertSafeProposal(proposedContent);
  const current = getDatabase().getSkillProposal(id);
  if (!current) throw new Error("Skill 提案不存在");
  if (current.status !== "pending") {
    throw new Error("只能修改待审批提案");
  }
  const updated = getDatabase().updateSkillProposal(id, { proposedContent });
  if (!updated) throw new Error("Skill 提案更新失败");
  logger.info("skill.proposal.edited", undefined, {
    proposalId: id,
    countryId: updated.countryId,
    contentCharacters: updated.proposedContent.length,
  });
  return updated;
}

export async function approveSkillProposal(id: string): Promise<{
  proposal: SkillProposal;
  skill: MarketSkillSummary;
}> {
  const database = getDatabase();
  const proposal = database.getSkillProposal(id);
  if (!proposal) throw new Error("Skill 提案不存在");
  if (proposal.status !== "pending") throw new Error("提案已处理");
  assertSafeProposal(proposal.proposedContent);

  const registry = await getMarketSkillRegistry();
  const current = registry.getSummary(proposal.countryId);
  const fullDocument = await readFile(current.filePath, "utf8");
  database.saveSkillVersion(
    proposal.countryId,
    versionOf(fullDocument),
    fullDocument,
  );
  const updatedDocument = appendToSection(
    fullDocument,
    proposal.section,
    proposal.proposedContent,
  );
  const temporaryPath = path.join(
    path.dirname(current.filePath),
    `.SKILL.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, updatedDocument, "utf8");
  await rename(temporaryPath, current.filePath);
  await registry.reload();
  const nextSkill = registry.getSummary(proposal.countryId);
  database.saveSkillVersion(
    proposal.countryId,
    nextSkill.version,
    updatedDocument,
    proposal.id,
  );
  const updated = database.updateSkillProposal(id, {
    status: "approved",
    reviewedAt: new Date().toISOString(),
  });
  if (!updated) throw new Error("Skill 提案状态更新失败");
  logger.info("skill.proposal.approved", undefined, {
    proposalId: id,
    countryId: updated.countryId,
    previousSkillVersion: current.version,
    skillVersion: nextSkill.version,
  });
  return { proposal: updated, skill: nextSkill };
}

export function rejectSkillProposal(id: string): SkillProposal {
  const current = getDatabase().getSkillProposal(id);
  if (!current) throw new Error("Skill 提案不存在");
  if (current.status !== "pending") throw new Error("提案已处理");
  const updated = getDatabase().updateSkillProposal(id, {
    status: "rejected",
    reviewedAt: new Date().toISOString(),
  });
  if (!updated) throw new Error("Skill 提案状态更新失败");
  logger.info("skill.proposal.rejected", undefined, {
    proposalId: id,
    countryId: updated.countryId,
    section: updated.section,
  });
  return updated;
}

export function assertCountryId(value: string): SupportedCountryId {
  const country = resolveCountry(value);
  if (!country || country.id !== value) {
    throw new Error("不支持的 Skill 国家");
  }
  return country.id;
}
