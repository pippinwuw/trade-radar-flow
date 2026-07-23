import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  NodeExecutionEnv,
  formatSkillInvocation,
  loadSkills,
  type FileError,
  type FileInfo,
  type Result,
  type Skill,
} from "@earendil-works/pi-agent-core/node";
import type {
  MarketSkillSummary,
  SupportedCountryId,
} from "../domain.js";
import { logger } from "../logging/logger.js";
import { resolveCountry } from "../countries/registry.js";

function portablePath(value: string): string {
  return value.replaceAll("\\", "/");
}

// pi-agent-core 0.80.10's skill loader compares paths with POSIX separators.
// Normalize NodeExecutionEnv metadata so recursive loading also works on Windows.
class SkillExecutionEnv extends NodeExecutionEnv {
  override async fileInfo(
    value: string,
  ): Promise<Result<FileInfo, FileError>> {
    const result = await super.fileInfo(value);
    return result.ok
      ? { ok: true, value: { ...result.value, path: portablePath(result.value.path) } }
      : result;
  }

  override async listDir(
    value: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<FileInfo[], FileError>> {
    const result = await super.listDir(value, abortSignal);
    return result.ok
      ? {
          ok: true,
          value: result.value.map((item) => ({
            ...item,
            path: portablePath(item.path),
          })),
        }
      : result;
  }
}

function versionOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function sectionLines(content: string, title: string): string[] {
  const lines = content.split(/\r?\n/);
  const heading = `## ${title}`.toLowerCase();
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === heading,
  );
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const normalized = line
      .replace(/^\s*(?:[-*]|\d+\.)\s+/, "")
      .trim();
    if (normalized) section.push(normalized);
  }
  return section.slice(0, 12);
}

export class MarketSkillRegistry {
  private skills = new Map<SupportedCountryId, Skill>();
  private summaries = new Map<SupportedCountryId, MarketSkillSummary>();
  private loaded = false;
  readonly directory: string;
  readonly generatedDirectory: string;

  constructor(rootDirectory = process.cwd()) {
    this.directory = path.join(rootDirectory, "agent-skills", "markets");
    this.generatedDirectory = path.join(
      rootDirectory,
      "data",
      "generated-market-skills",
    );
  }

  async reload(): Promise<void> {
    const started = performance.now();
    const env = new SkillExecutionEnv({ cwd: process.cwd() });
    let generatedNames: string[] = [];
    try {
      generatedNames = (await readdir(this.generatedDirectory, {
        withFileTypes: true,
      }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      // Generated market directory is optional.
    }
    const directories = [
      path.join(this.directory, "uae"),
      path.join(this.directory, "saudi"),
      ...generatedNames.map((name) => path.join(this.generatedDirectory, name)),
    ].map((directory) =>
      path.relative(process.cwd(), directory).replaceAll(path.sep, "/"),
    );
    const result = await loadSkills(env, directories);
    if (result.diagnostics.length > 0) {
      const diagnostics = result.diagnostics
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ");
      throw new Error(`市场 Skill 加载失败：${diagnostics}`);
    }

    const nextSkills = new Map<SupportedCountryId, Skill>();
    const nextSummaries = new Map<SupportedCountryId, MarketSkillSummary>();
    for (const skill of result.skills) {
      const country = resolveCountry(skill.name);
      if (!country || country.id !== skill.name) continue;
      const countryId = country.id;
      const info = await stat(skill.filePath);
      nextSkills.set(countryId, skill);
      nextSummaries.set(countryId, {
        name: countryId,
        description: skill.description,
        filePath: skill.filePath,
        version: versionOf(skill.content),
        updatedAt: info.mtime.toISOString(),
        content: skill.content,
        keyInformation: {
          searchConfiguration: sectionLines(
            skill.content,
            "Search configuration",
          ),
          queryPatterns: sectionLines(skill.content, "Query planning"),
          validationSignals: sectionLines(
            skill.content,
            "Company validation signals",
          ),
          exclusions: sectionLines(skill.content, "Exclusions"),
        },
      });
    }
    if (!nextSkills.has("uae") || !nextSkills.has("saudi")) {
      throw new Error(
        `必须同时提供 uae 与 saudi 市场 Skill；当前加载：${[
          ...nextSkills.keys(),
        ].join(", ") || "无"}`,
      );
    }
    this.skills = nextSkills;
    this.summaries = nextSummaries;
    this.loaded = true;
    logger.info("skill.registry.loaded", undefined, {
      skillCount: nextSkills.size,
      skills: [...nextSummaries.values()].map((skill) => ({
        name: skill.name,
        version: skill.version,
        updatedAt: skill.updatedAt,
      })),
      durationMs: Math.round(performance.now() - started),
    });
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error("市场 SkillRegistry 尚未加载");
    }
  }

  get(countryId: SupportedCountryId): Skill {
    this.assertLoaded();
    const skill = this.skills.get(countryId);
    if (!skill) throw new Error(`缺少国家 Skill：${countryId}`);
    return skill;
  }

  getSummary(countryId: SupportedCountryId): MarketSkillSummary {
    this.assertLoaded();
    const summary = this.summaries.get(countryId);
    if (!summary) throw new Error(`缺少国家 Skill 摘要：${countryId}`);
    return summary;
  }

  list(): MarketSkillSummary[] {
    this.assertLoaded();
    return [...this.summaries.values()];
  }

  invocation(
    countryId: SupportedCountryId,
    instructions?: string,
  ): string {
    return formatSkillInvocation(this.get(countryId), instructions);
  }
}

let singleton: MarketSkillRegistry | undefined;
let singletonLoad: Promise<MarketSkillRegistry> | undefined;

export async function getMarketSkillRegistry(): Promise<MarketSkillRegistry> {
  if (!singleton) {
    singleton = new MarketSkillRegistry();
    singletonLoad = singleton.reload().then(() => singleton as MarketSkillRegistry);
  }
  return singletonLoad ?? singleton;
}
