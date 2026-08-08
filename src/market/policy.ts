import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  CountryProfile,
  MarketPolicy,
  MarketPolicyRecord,
  MarketPolicyRef,
} from "../domain.js";
import { getDatabase } from "../storage/database.js";

const BUILTIN_CREATED_AT = "2026-01-01T00:00:00.000Z";
const LEGACY_MIGRATION_ID = "country-context-json-to-market-policy-files-v1";

type MarketPolicyContent = Pick<
  MarketPolicy,
  "searchLocalization" | "companyAnalysis" | "contactAndOutreach"
>;

interface MarketPolicyFile extends MarketPolicyContent {
  schemaVersion: 1;
  marketId: string;
}

interface ActiveMarketPolicyFile {
  marketId: string;
  version: string;
  hash: string;
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

function policyHash(policy: MarketPolicyFile): string {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(policy)))
    .digest("hex");
}

function assertStringArray(
  value: unknown,
  field: string,
): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`MarketPolicy 字段 ${field} 必须是字符串数组`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw new Error(
      `MarketPolicy ${field} 包含未声明字段：${unexpected.join(", ")}`,
    );
  }
}

function parsePolicyFile(value: unknown, sourcePath: string): MarketPolicyFile {
  if (!value || typeof value !== "object") {
    throw new Error(`MarketPolicy 文件不是对象：${sourcePath}`);
  }
  const policy = value as Record<string, unknown>;
  if (policy.schemaVersion !== 1 || typeof policy.marketId !== "string") {
    throw new Error(`MarketPolicy schemaVersion/marketId 无效：${sourcePath}`);
  }
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(policy.marketId)) {
    throw new Error(`MarketPolicy marketId 格式无效：${sourcePath}`);
  }
  const search = policy.searchLocalization as Record<string, unknown>;
  const company = policy.companyAnalysis as Record<string, unknown>;
  const contact = policy.contactAndOutreach as Record<string, unknown>;
  if (!search || !company || !contact) {
    throw new Error(`MarketPolicy 缺少结构化分区：${sourcePath}`);
  }
  assertExactKeys(
    policy,
    [
      "schemaVersion",
      "marketId",
      "searchLocalization",
      "companyAnalysis",
      "contactAndOutreach",
    ],
    "root",
  );
  assertExactKeys(
    search,
    [
      "languages",
      "buyerRoleTerms",
      "queryPatterns",
      "translationRestrictions",
    ],
    "searchLocalization",
  );
  assertExactKeys(
    company,
    [
      "identitySignals",
      "legalSuffixSemantics",
      "buyerSignals",
      "importAndScaleSignals",
      "falsePositivePatterns",
      "exclusions",
    ],
    "companyAnalysis",
  );
  assertExactKeys(
    contact,
    [
      "preferredContactTerms",
      "validationNotes",
      "defaultLanguage",
      "etiquette",
    ],
    "contactAndOutreach",
  );
  assertStringArray(search.languages, "searchLocalization.languages");
  assertStringArray(
    search.buyerRoleTerms,
    "searchLocalization.buyerRoleTerms",
  );
  assertStringArray(
    search.queryPatterns,
    "searchLocalization.queryPatterns",
  );
  assertStringArray(
    search.translationRestrictions,
    "searchLocalization.translationRestrictions",
  );
  assertStringArray(
    company.identitySignals,
    "companyAnalysis.identitySignals",
  );
  assertStringArray(
    company.legalSuffixSemantics,
    "companyAnalysis.legalSuffixSemantics",
  );
  assertStringArray(company.buyerSignals, "companyAnalysis.buyerSignals");
  assertStringArray(
    company.importAndScaleSignals,
    "companyAnalysis.importAndScaleSignals",
  );
  assertStringArray(
    company.falsePositivePatterns,
    "companyAnalysis.falsePositivePatterns",
  );
  assertStringArray(company.exclusions, "companyAnalysis.exclusions");
  assertStringArray(
    contact.preferredContactTerms,
    "contactAndOutreach.preferredContactTerms",
  );
  assertStringArray(
    contact.validationNotes,
    "contactAndOutreach.validationNotes",
  );
  assertStringArray(contact.etiquette, "contactAndOutreach.etiquette");
  if (typeof contact.defaultLanguage !== "string") {
    throw new Error(
      "MarketPolicy 字段 contactAndOutreach.defaultLanguage 必须是字符串",
    );
  }
  return policy as unknown as MarketPolicyFile;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function readPolicy(filePath: string): MarketPolicyFile {
  return parsePolicyFile(readJson(filePath), filePath);
}

export function marketPolicyDataDirectory(): string {
  const configured = process.env.MARKET_POLICY_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_TEST_CONTEXT) {
    return path.join(
      tmpdir(),
      "trade-radar-flow-market-policies",
      String(process.pid),
    );
  }
  return path.join(process.cwd(), "data", "market-policies");
}

function relativePolicyPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? path.resolve(filePath)
    : relative.replaceAll("\\", "/");
}

function resolvePolicyPath(filePath: string): string {
  const resolved = path.resolve(process.cwd(), filePath);
  const allowedRoots = [
    path.resolve(process.cwd(), "market-policies"),
    marketPolicyDataDirectory(),
  ];
  if (
    !allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
    )
  ) {
    throw new Error(`MarketPolicy 路径越界：${filePath}`);
  }
  return resolved;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function materializePolicy(record: MarketPolicyRecord): MarketPolicy {
  const filePath = resolvePolicyPath(record.filePath);
  const file = readPolicy(filePath);
  if (file.marketId !== record.marketId) {
    throw new Error(
      `MarketPolicy marketId 不匹配：${file.marketId} != ${record.marketId}`,
    );
  }
  const hash = policyHash(file);
  if (hash !== record.hash) {
    throw new Error(
      `MarketPolicy 内容 hash 不匹配：${record.marketId}@${record.version}`,
    );
  }
  return {
    ...file,
    version: record.version,
    hash,
    status: record.status,
    metadata: {
      source: record.source,
      reviewNotes: record.reviewNotes,
      createdAt: record.createdAt,
      reviewedAt: record.reviewedAt,
      approvedAt: record.approvedAt,
    },
  };
}

function registerActiveRoot(
  root: string,
  source: MarketPolicyRecord["source"],
): void {
  if (!existsSync(root)) return;
  const database = getDatabase();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "schema") continue;
    const activePath = path.join(root, entry.name, "active.json");
    if (!existsSync(activePath)) continue;
    const active = readJson(activePath) as ActiveMarketPolicyFile;
    const policyPath = path.join(
      root,
      entry.name,
      "versions",
      active.version,
      "policy.json",
    );
    const policy = readPolicy(policyPath);
    const hash = policyHash(policy);
    if (
      active.marketId !== policy.marketId ||
      active.marketId !== entry.name ||
      active.hash !== hash
    ) {
      throw new Error(`MarketPolicy active manifest 校验失败：${activePath}`);
    }
    if (database.getMarketPolicyRecord(active.marketId, active.version)) {
      continue;
    }
    database.saveMarketPolicyRecord({
      marketId: active.marketId,
      version: active.version,
      hash,
      status: "approved",
      filePath: relativePolicyPath(policyPath),
      source,
      reviewNotes:
        source === "builtin"
          ? ["Repository MarketPolicy reviewed before release."]
          : ["Recovered from an external approved MarketPolicy manifest."],
      createdAt: source === "builtin" ? BUILTIN_CREATED_AT : new Date().toISOString(),
      reviewedAt:
        source === "builtin" ? BUILTIN_CREATED_AT : new Date().toISOString(),
      approvedAt:
        source === "builtin" ? BUILTIN_CREATED_AT : new Date().toISOString(),
    });
  }
}

function writePolicyVersion(
  policy: MarketPolicyFile,
  area: "drafts" | "migrated",
  version = policyHash(policy).slice(0, 12),
): { version: string; hash: string; filePath: string } {
  const hash = policyHash(policy);
  const filePath = path.join(
    marketPolicyDataDirectory(),
    area,
    policy.marketId,
    "versions",
    version,
    "policy.json",
  );
  if (!existsSync(filePath)) atomicWriteJson(filePath, policy);
  return { version, hash, filePath: relativePolicyPath(filePath) };
}

function migrateLegacyCountryContexts(): void {
  const database = getDatabase();
  if (database.isMigrationApplied(LEGACY_MIGRATION_ID)) return;
  for (const serialized of database.listLegacyCountryContextJson()) {
    const legacy = JSON.parse(serialized) as {
      schemaVersion?: number;
      countryId?: string;
      version?: string;
      status?: MarketPolicy["status"];
      searchLocalization?: MarketPolicy["searchLocalization"];
      companyAnalysis?: MarketPolicy["companyAnalysis"];
      contactAndOutreach?: MarketPolicy["contactAndOutreach"];
      metadata?: MarketPolicy["metadata"];
    };
    if (
      !legacy.countryId ||
      !legacy.searchLocalization ||
      !legacy.companyAnalysis ||
      !legacy.contactAndOutreach
    ) {
      continue;
    }
    if (
      legacy.version &&
      database.getMarketPolicyRecord(legacy.countryId, legacy.version)
    ) {
      continue;
    }
    const file = parsePolicyFile(
      {
        schemaVersion: 1,
        marketId: legacy.countryId,
        searchLocalization: legacy.searchLocalization,
        companyAnalysis: legacy.companyAnalysis,
        contactAndOutreach: legacy.contactAndOutreach,
      },
      `legacy:${legacy.countryId}`,
    );
    const written = writePolicyVersion(
      file,
      "migrated",
      legacy.version ?? policyHash(file).slice(0, 12),
    );
    const hasApproved = database.getMarketPolicyRecordByStatus(
      legacy.countryId,
      "approved",
    );
    const status =
      legacy.status === "approved" && hasApproved
        ? "superseded"
        : (legacy.status ?? "reviewed");
    database.saveMarketPolicyRecord({
      marketId: legacy.countryId,
      ...written,
      status,
      source: "migrated",
      reviewNotes: [
        ...(legacy.metadata?.reviewNotes ?? []),
        "Migrated once from legacy CountryContext SQL content.",
      ],
      createdAt: legacy.metadata?.createdAt ?? new Date().toISOString(),
      reviewedAt: legacy.metadata?.reviewedAt,
      approvedAt: status === "approved" ? legacy.metadata?.approvedAt : undefined,
    });
  }
  database.markMigrationApplied(LEGACY_MIGRATION_ID);
}

export function ensureMarketPolicies(): void {
  registerActiveRoot(
    path.join(process.cwd(), "market-policies"),
    "builtin",
  );
  registerActiveRoot(
    path.join(marketPolicyDataDirectory(), "approved"),
    "user",
  );
  migrateLegacyCountryContexts();
}

export function listMarketPolicies(marketId?: string): MarketPolicy[] {
  ensureMarketPolicies();
  return getDatabase()
    .listMarketPolicyRecords(marketId)
    .map(materializePolicy);
}

export function getApprovedMarketPolicy(marketId: string): MarketPolicy {
  ensureMarketPolicies();
  const record = getDatabase().getMarketPolicyRecordByStatus(
    marketId,
    "approved",
  );
  if (!record) {
    throw new Error(
      `市场规则包 ${marketId} 尚未获用户批准，请先审阅并批准`,
    );
  }
  return materializePolicy(record);
}

export function getMarketPolicy(
  marketId: string,
  version: string,
): MarketPolicy {
  ensureMarketPolicies();
  const record = getDatabase().getMarketPolicyRecord(marketId, version);
  if (!record) throw new Error(`市场规则包不存在：${marketId}@${version}`);
  return materializePolicy(record);
}

export function marketPolicyRef(policy: MarketPolicy): MarketPolicyRef {
  return {
    marketId: policy.marketId,
    version: policy.version,
    hash: policy.hash,
  };
}

export function createGeneratedMarketPolicy(
  profile: CountryProfile,
  input: {
    queryPatterns: string[];
    validationSignals: string[];
    exclusions: string[];
  },
): MarketPolicy {
  return saveMarketPolicyDraft({
    schemaVersion: 1,
    marketId: profile.id,
    searchLocalization: {
      languages: [...new Set([profile.defaultHl, "en"])],
      buyerRoleTerms: [
        "distributor",
        "importer",
        "wholesaler",
        "supplier",
      ],
      queryPatterns: input.queryPatterns,
      translationRestrictions: [
        "Use only user-approved or verified local-language product terms.",
        "Add local-language buyerRoleTerms that can match Serper snippets and page text for pre-analysis filtering.",
      ],
    },
    companyAnalysis: {
      identitySignals: input.validationSignals,
      legalSuffixSemantics: profile.businessSuffixes.map(
        (suffix) =>
          `${suffix} is an identity signal only when tied to the official company context.`,
      ),
      buyerSignals: [
        "Evidence of buying, importing, distributing, processing, or commercially using the target product.",
      ],
      importAndScaleSignals: [
        "Explicit import, sourcing, warehouse, branch, OEM, or market coverage evidence.",
      ],
      falsePositivePatterns: [
        "Missing information is not negative evidence.",
        "General company wording alone is not proof of purchasing capability.",
      ],
      exclusions: input.exclusions,
    },
    contactAndOutreach: {
      preferredContactTerms: [
        "sales",
        "commercial",
        "export",
        "procurement",
      ],
      validationNotes: [
        "Syntax and country formatting do not prove deliverability or consent.",
      ],
      defaultLanguage: "English",
      etiquette: [
        "Use concise professional language and only approved seller claims.",
      ],
    },
    metadata: {
      reviewNotes: [
        "Agent-generated draft; review and user approval are required.",
        "Ensure exclusions and buyerRoleTerms include matchable local phrases for conservative pre-analysis filtering.",
      ],
    },
  }, "generated");
}

export function saveMarketPolicyDraft(
  input: Omit<
    MarketPolicy,
    "version" | "hash" | "status" | "metadata"
  > & {
    metadata?: Pick<MarketPolicy["metadata"], "reviewNotes">;
  },
  source: MarketPolicyRecord["source"] = "user",
): MarketPolicy {
  const file = parsePolicyFile(
    {
      schemaVersion: 1,
      marketId: input.marketId,
      searchLocalization: input.searchLocalization,
      companyAnalysis: input.companyAnalysis,
      contactAndOutreach: input.contactAndOutreach,
    },
    `draft:${input.marketId}`,
  );
  const written = writePolicyVersion(file, "drafts");
  const existing = getDatabase().getMarketPolicyRecord(
    input.marketId,
    written.version,
  );
  if (!existing) {
    getDatabase().saveMarketPolicyRecord({
      marketId: input.marketId,
      ...written,
      status: "draft",
      source,
      reviewNotes: input.metadata?.reviewNotes ?? [],
      createdAt: new Date().toISOString(),
    });
  }
  return getMarketPolicy(input.marketId, written.version);
}

export function markMarketPolicyReviewed(
  marketId: string,
  version: string,
  reviewNotes: string[],
): MarketPolicy {
  const current = getDatabase().getMarketPolicyRecord(marketId, version);
  if (!current || (current.status !== "draft" && current.status !== "reviewed")) {
    throw new Error("只有草稿或已审阅市场规则包可以重新审阅");
  }
  getDatabase().saveMarketPolicyRecord({
    ...current,
    status: "reviewed",
    reviewNotes,
    reviewedAt: new Date().toISOString(),
  });
  return getMarketPolicy(marketId, version);
}

export function approveMarketPolicy(
  marketId: string,
  version: string,
): MarketPolicy {
  const database = getDatabase();
  const current = database.getMarketPolicyRecord(marketId, version);
  if (!current || (current.status !== "reviewed" && current.status !== "approved")) {
    throw new Error("市场规则包必须先由主 Agent 审阅");
  }
  const sourcePath = resolvePolicyPath(current.filePath);
  const approvedPath = path.join(
    marketPolicyDataDirectory(),
    "approved",
    marketId,
    "versions",
    version,
    "policy.json",
  );
  mkdirSync(path.dirname(approvedPath), { recursive: true });
  if (!existsSync(approvedPath)) copyFileSync(sourcePath, approvedPath);
  const active: ActiveMarketPolicyFile = {
    marketId,
    version,
    hash: current.hash,
  };
  atomicWriteJson(
    path.join(
      marketPolicyDataDirectory(),
      "approved",
      marketId,
      "active.json",
    ),
    active,
  );
  database.supersedeApprovedMarketPolicies(marketId, version);
  database.saveMarketPolicyRecord({
    ...current,
    status: "approved",
    filePath: relativePolicyPath(approvedPath),
    approvedAt: current.approvedAt ?? new Date().toISOString(),
  });
  return getMarketPolicy(marketId, version);
}

export function rejectMarketPolicy(
  marketId: string,
  version: string,
): MarketPolicy {
  const current = getDatabase().getMarketPolicyRecord(marketId, version);
  if (!current) throw new Error(`市场规则包不存在：${marketId}@${version}`);
  if (current.status === "approved") {
    throw new Error("已批准版本不能直接拒绝；请批准一个替代版本");
  }
  getDatabase().saveMarketPolicyRecord({
    ...current,
    status: "superseded",
  });
  return getMarketPolicy(marketId, version);
}
