import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CampaignResult,
  CampaignStrategy,
  CompanyAnalysisCacheEntry,
  CompanyEvidenceIndexEntry,
  LeadRecord,
  MarketPolicyRecord,
  MarketPolicyStatus,
  OrchestratorMessage,
  OrchestratorSession,
} from "../domain.js";

function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

function defaultDatabasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured) return configured;
  return process.env.NODE_TEST_CONTEXT
    ? ":memory:"
    : path.join(process.cwd(), "data", "trade-radar.db");
}

export class AppDatabase {
  private readonly database: DatabaseSync;

  constructor(
    filePath = defaultDatabasePath(),
  ) {
    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.database = new DatabaseSync(filePath);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        product TEXT NOT NULL,
        country TEXT NOT NULL,
        language TEXT NOT NULL,
        agent_mode TEXT NOT NULL,
        search_mode TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        domain TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_runs (
        campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crawl_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        company_domain TEXT NOT NULL,
        page_url TEXT NOT NULL,
        data_json TEXT NOT NULL,
        UNIQUE(campaign_id, company_domain, page_url)
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_cache (
        cache_key TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skill_proposals (
        id TEXT PRIMARY KEY,
        country_id TEXT NOT NULL,
        section TEXT NOT NULL,
        title TEXT NOT NULL,
        proposed_content TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS skill_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country_id TEXT NOT NULL,
        version TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        proposal_id TEXT,
        UNIQUE(country_id, version)
      );

      CREATE TABLE IF NOT EXISTS orchestrator_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        session_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orchestrator_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        next_action TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS strategy_versions (
        session_id TEXT NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        strategy_hash TEXT NOT NULL,
        strategy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        PRIMARY KEY(session_id, version)
      );

      CREATE TABLE IF NOT EXISTS country_context_versions (
        country_id TEXT NOT NULL,
        version TEXT NOT NULL,
        hash TEXT NOT NULL,
        status TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        approved_at TEXT,
        PRIMARY KEY(country_id, version)
      );

      CREATE INDEX IF NOT EXISTS country_context_status_idx
        ON country_context_versions(country_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS market_policy_versions (
        market_id TEXT NOT NULL,
        version TEXT NOT NULL,
        hash TEXT NOT NULL,
        status TEXT NOT NULL,
        file_path TEXT NOT NULL,
        source TEXT NOT NULL,
        review_notes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        approved_at TEXT,
        PRIMARY KEY(market_id, version)
      );

      CREATE INDEX IF NOT EXISTS market_policy_status_idx
        ON market_policy_versions(market_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS app_migrations (
        migration_id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS company_analysis_cache (
        cache_key TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        candidate_fingerprint TEXT NOT NULL,
        decision_fingerprint TEXT NOT NULL,
        market_policy_hash TEXT NOT NULL,
        analysis_contract_version TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        source_lead_id TEXT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS company_analysis_cache_domain_idx
        ON company_analysis_cache(domain, created_at DESC);

      CREATE TABLE IF NOT EXISTS company_evidence_indexes (
        index_key TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        page_fingerprint TEXT NOT NULL,
        index_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS company_evidence_indexes_page_idx
        ON company_evidence_indexes(domain, page_fingerprint);
    `);
    const cacheColumns = this.database
      .prepare("PRAGMA table_info(company_analysis_cache)")
      .all()
      .map((row) => String(row.name));
    if (!cacheColumns.includes("market_policy_hash")) {
      this.database.exec(
        "ALTER TABLE company_analysis_cache ADD COLUMN market_policy_hash TEXT",
      );
      if (cacheColumns.includes("country_context_hash")) {
        this.database.exec(
          `UPDATE company_analysis_cache
           SET market_policy_hash = country_context_hash
           WHERE market_policy_hash IS NULL`,
        );
      }
    }
  }

  saveOrchestratorSession(session: OrchestratorSession): void {
    this.database
      .prepare(
        `INSERT INTO orchestrator_sessions
          (id, status, session_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           session_json = excluded.session_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        session.id,
        session.status,
        JSON.stringify(session),
        session.createdAt,
        session.updatedAt,
      );
  }

  getOrchestratorSession(id: string): OrchestratorSession | undefined {
    const row = this.database
      .prepare("SELECT session_json FROM orchestrator_sessions WHERE id = ?")
      .get(id);
    return row
      ? json<OrchestratorSession>(String(row.session_json))
      : undefined;
  }

  listOrchestratorSessions(): OrchestratorSession[] {
    return this.database
      .prepare(
        "SELECT session_json FROM orchestrator_sessions ORDER BY updated_at DESC",
      )
      .all()
      .map((row) => json<OrchestratorSession>(String(row.session_json)));
  }

  createOrchestratorMessage(message: OrchestratorMessage): void {
    this.database
      .prepare(
        `INSERT INTO orchestrator_messages
          (id, session_id, role, content, next_action, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.content,
        message.nextAction ?? null,
        message.createdAt,
      );
  }

  listOrchestratorMessages(sessionId: string): OrchestratorMessage[] {
    return this.database
      .prepare(
        `SELECT * FROM orchestrator_messages
         WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionId)
      .map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        role: String(row.role) as OrchestratorMessage["role"],
        content: String(row.content),
        nextAction: row.next_action ? String(row.next_action) : undefined,
        createdAt: String(row.created_at),
      }));
  }

  saveStrategyVersion(
    sessionId: string,
    version: number,
    strategyHash: string,
    strategy: CampaignStrategy,
    approvedAt?: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO strategy_versions
          (session_id, version, strategy_hash, strategy_json, created_at, approved_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, version) DO UPDATE SET
           strategy_hash = excluded.strategy_hash,
           strategy_json = excluded.strategy_json,
           approved_at = excluded.approved_at`,
      )
      .run(
        sessionId,
        version,
        strategyHash,
        JSON.stringify(strategy),
        new Date().toISOString(),
        approvedAt ?? null,
      );
  }

  saveCampaign(campaign: CampaignResult): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO campaigns (
             id, product, country, language, agent_mode, search_mode,
             started_at, completed_at, result_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             completed_at = excluded.completed_at,
             result_json = excluded.result_json`,
        )
        .run(
          campaign.id,
          campaign.product,
          campaign.country,
          campaign.language,
          campaign.mode,
          campaign.searchMode ?? "demo",
          campaign.startedAt,
          campaign.completedAt,
          JSON.stringify(campaign),
        );
      this.database
        .prepare("DELETE FROM leads WHERE campaign_id = ?")
        .run(campaign.id);
      this.database
        .prepare("DELETE FROM crawl_snapshots WHERE campaign_id = ?")
        .run(campaign.id);
      this.database
        .prepare("DELETE FROM agent_runs WHERE campaign_id = ?")
        .run(campaign.id);
      const insertLead = this.database.prepare(
        `INSERT INTO leads (id, campaign_id, status, domain, data_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertPage = this.database.prepare(
        `INSERT INTO crawl_snapshots
          (campaign_id, company_domain, page_url, data_json)
         VALUES (?, ?, ?, ?)`,
      );
      const insertTrace = this.database.prepare(
        `INSERT INTO agent_runs
          (campaign_id, lead_id, agent_name, data_json)
         VALUES (?, ?, ?, ?)`,
      );
      for (const lead of campaign.leads) {
        insertLead.run(
          lead.id,
          campaign.id,
          lead.status,
          lead.candidate.domain,
          JSON.stringify(lead),
        );
        for (const trace of lead.traces) {
          insertTrace.run(
            campaign.id,
            lead.id,
            trace.agent,
            JSON.stringify(trace),
          );
        }
      }
      for (const failure of campaign.analysisFailures ?? []) {
        if (!failure.trace) continue;
        insertTrace.run(
          campaign.id,
          `failure:${failure.candidateId}`,
          failure.trace.agent,
          JSON.stringify(failure.trace),
        );
      }
      const snapshotCandidates =
        campaign.candidateQueue ?? campaign.leads.map((lead) => lead.candidate);
      const savedPages = new Set<string>();
      for (const candidate of snapshotCandidates) {
        for (const page of candidate.pages) {
          const key = `${candidate.domain}\n${page.url}`;
          if (savedPages.has(key)) continue;
          savedPages.add(key);
          insertPage.run(
            campaign.id,
            candidate.domain,
            page.url,
            JSON.stringify(page),
          );
        }
      }
      if (campaign.discovery) {
        this.database
          .prepare(
            `INSERT INTO search_runs (campaign_id, data_json)
             VALUES (?, ?)
             ON CONFLICT(campaign_id) DO UPDATE SET
               data_json = excluded.data_json`,
          )
          .run(campaign.id, JSON.stringify(campaign.discovery));
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listCampaigns(): CampaignResult[] {
    return this.database
      .prepare(
        "SELECT result_json FROM campaigns ORDER BY completed_at DESC",
      )
      .all()
      .map((row) => json<CampaignResult>(String(row.result_json)));
  }

  getCampaign(id: string): CampaignResult | undefined {
    const row = this.database
      .prepare("SELECT result_json FROM campaigns WHERE id = ?")
      .get(id);
    return row
      ? json<CampaignResult>(String(row.result_json))
      : undefined;
  }

  listLeadHistoryByDomain(domain: string, limit = 10): LeadRecord[] {
    return this.database
      .prepare(
        `SELECT data_json FROM leads
         WHERE lower(domain) = lower(?)
         ORDER BY rowid DESC LIMIT ?`,
      )
      .all(domain, Math.max(1, Math.floor(limit)))
      .map((row) => json<LeadRecord>(String(row.data_json)));
  }

  saveMarketPolicyRecord(record: MarketPolicyRecord): void {
    this.database
      .prepare(
        `INSERT INTO market_policy_versions (
           market_id, version, hash, status, file_path, source,
           review_notes_json, created_at, reviewed_at, approved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(market_id, version) DO UPDATE SET
           hash = excluded.hash,
           status = excluded.status,
           file_path = excluded.file_path,
           source = excluded.source,
           review_notes_json = excluded.review_notes_json,
           reviewed_at = excluded.reviewed_at,
           approved_at = excluded.approved_at`,
      )
      .run(
        record.marketId,
        record.version,
        record.hash,
        record.status,
        record.filePath,
        record.source,
        JSON.stringify(record.reviewNotes),
        record.createdAt,
        record.reviewedAt ?? null,
        record.approvedAt ?? null,
      );
  }

  listMarketPolicyRecords(marketId?: string): MarketPolicyRecord[] {
    const rows = marketId
      ? this.database
          .prepare(
            `SELECT * FROM market_policy_versions
             WHERE market_id = ? ORDER BY created_at DESC`,
          )
          .all(marketId)
      : this.database
          .prepare(
            `SELECT * FROM market_policy_versions
             ORDER BY market_id, created_at DESC`,
          )
          .all();
    return rows.map((row) => ({
      marketId: String(row.market_id),
      version: String(row.version),
      hash: String(row.hash),
      status: String(row.status) as MarketPolicyStatus,
      filePath: String(row.file_path),
      source: String(row.source) as MarketPolicyRecord["source"],
      reviewNotes: json<string[]>(String(row.review_notes_json)),
      createdAt: String(row.created_at),
      reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
      approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    }));
  }

  getMarketPolicyRecord(
    marketId: string,
    version: string,
  ): MarketPolicyRecord | undefined {
    return this.listMarketPolicyRecords(marketId).find(
      (record) => record.version === version,
    );
  }

  getMarketPolicyRecordByStatus(
    marketId: string,
    status: MarketPolicyStatus,
  ): MarketPolicyRecord | undefined {
    return this.listMarketPolicyRecords(marketId).find(
      (record) => record.status === status,
    );
  }

  supersedeApprovedMarketPolicies(
    marketId: string,
    exceptVersion: string,
  ): void {
    const rows = this.listMarketPolicyRecords(marketId).filter(
      (record) =>
        record.status === "approved" && record.version !== exceptVersion,
    );
    for (const record of rows) {
      this.saveMarketPolicyRecord({ ...record, status: "superseded" });
    }
  }

  listLegacyCountryContextJson(): string[] {
    return this.database
      .prepare(
        `SELECT context_json FROM country_context_versions
         ORDER BY country_id, created_at`,
      )
      .all()
      .map((row) => String(row.context_json));
  }

  isMigrationApplied(migrationId: string): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT migration_id FROM app_migrations WHERE migration_id = ?",
        )
        .get(migrationId),
    );
  }

  markMigrationApplied(migrationId: string): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO app_migrations (migration_id, applied_at)
         VALUES (?, ?)`,
      )
      .run(migrationId, new Date().toISOString());
  }

  getCompanyAnalysisCache(
    key: string,
  ): CompanyAnalysisCacheEntry | undefined {
    const row = this.database
      .prepare(
        `SELECT result_json FROM company_analysis_cache WHERE cache_key = ?`,
      )
      .get(key);
    return row
      ? json<CompanyAnalysisCacheEntry>(String(row.result_json))
      : undefined;
  }

  listCompanyAnalysisHistory(
    domain: string,
    limit = 10,
  ): CompanyAnalysisCacheEntry[] {
    return this.database
      .prepare(
        `SELECT result_json FROM company_analysis_cache
         WHERE domain = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(domain.toLowerCase(), Math.max(1, Math.floor(limit)))
      .map((row) =>
        json<CompanyAnalysisCacheEntry>(String(row.result_json)),
      );
  }

  putCompanyAnalysisCache(entry: CompanyAnalysisCacheEntry): void {
    this.database
      .prepare(
        `INSERT INTO company_analysis_cache (
           cache_key, domain, candidate_fingerprint, decision_fingerprint,
           market_policy_hash, analysis_contract_version, model_provider,
           model_id, source_lead_id, result_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           result_json = excluded.result_json,
           source_lead_id = excluded.source_lead_id,
           created_at = excluded.created_at`,
      )
      .run(
        entry.key,
        entry.domain.toLowerCase(),
        entry.candidateFingerprint,
        entry.decisionFingerprint,
        entry.marketPolicyHash,
        entry.analysisContractVersion,
        entry.modelProvider,
        entry.modelId,
        entry.sourceLeadId ?? null,
        JSON.stringify(entry),
        entry.createdAt,
      );
  }

  getCompanyEvidenceIndex(
    domain: string,
    pageFingerprint: string,
  ): CompanyEvidenceIndexEntry | undefined {
    const row = this.database
      .prepare(
        `SELECT index_json FROM company_evidence_indexes
         WHERE domain = ? AND page_fingerprint = ?`,
      )
      .get(domain.toLowerCase(), pageFingerprint);
    return row
      ? json<CompanyEvidenceIndexEntry>(String(row.index_json))
      : undefined;
  }

  putCompanyEvidenceIndex(entry: CompanyEvidenceIndexEntry): void {
    this.database
      .prepare(
        `INSERT INTO company_evidence_indexes (
           index_key, domain, page_fingerprint, index_json, created_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(index_key) DO UPDATE SET
           index_json = excluded.index_json,
           created_at = excluded.created_at`,
      )
      .run(
        entry.key,
        entry.domain.toLowerCase(),
        entry.pageFingerprint,
        JSON.stringify(entry),
        entry.createdAt,
      );
  }

  getSearchCache<T>(key: string): T | undefined {
    const row = this.database
      .prepare(
        `SELECT response_json FROM search_cache
         WHERE cache_key = ? AND expires_at > ?`,
      )
      .get(key, new Date().toISOString());
    return row ? json<T>(String(row.response_json)) : undefined;
  }

  putSearchCache<T>(key: string, value: T, ttlMs: number): void {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlMs);
    this.database
      .prepare(
        `INSERT INTO search_cache
          (cache_key, response_json, created_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           response_json = excluded.response_json,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        key,
        JSON.stringify(value),
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
  }

  close(): void {
    this.database.close();
  }
}

let singleton: AppDatabase | undefined;

export function getDatabase(): AppDatabase {
  singleton ??= new AppDatabase();
  return singleton;
}
