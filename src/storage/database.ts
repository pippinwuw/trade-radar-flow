import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CampaignResult,
  CampaignStrategy,
  OrchestratorMessage,
  OrchestratorSession,
  SkillProposal,
  SkillProposalStatus,
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
    `);
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

  createSkillProposal(proposal: SkillProposal): void {
    this.database
      .prepare(
        `INSERT INTO skill_proposals (
          id, country_id, section, title, proposed_content, rationale,
          evidence_json, status, created_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.countryId,
        proposal.section,
        proposal.title,
        proposal.proposedContent,
        proposal.rationale,
        JSON.stringify(proposal.evidence),
        proposal.status,
        proposal.createdAt,
        proposal.reviewedAt ?? null,
      );
  }

  listSkillProposals(): SkillProposal[] {
    return this.database
      .prepare(
        `SELECT * FROM skill_proposals
         ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`,
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        countryId: String(row.country_id) as SkillProposal["countryId"],
        section: String(row.section),
        title: String(row.title),
        proposedContent: String(row.proposed_content),
        rationale: String(row.rationale),
        evidence: json<string[]>(String(row.evidence_json)),
        status: String(row.status) as SkillProposalStatus,
        createdAt: String(row.created_at),
        reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
      }));
  }

  getSkillProposal(id: string): SkillProposal | undefined {
    return this.listSkillProposals().find((proposal) => proposal.id === id);
  }

  updateSkillProposal(
    id: string,
    patch: {
      proposedContent?: string;
      status?: SkillProposalStatus;
      reviewedAt?: string;
    },
  ): SkillProposal | undefined {
    const current = this.getSkillProposal(id);
    if (!current) return undefined;
    const next = {
      ...current,
      ...patch,
    };
    this.database
      .prepare(
        `UPDATE skill_proposals
         SET proposed_content = ?, status = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .run(
        next.proposedContent,
        next.status,
        next.reviewedAt ?? null,
        id,
      );
    return next;
  }

  saveSkillVersion(
    countryId: string,
    version: string,
    content: string,
    proposalId?: string,
  ): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO skill_versions
          (country_id, version, content, created_at, proposal_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        countryId,
        version,
        content,
        new Date().toISOString(),
        proposalId ?? null,
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
