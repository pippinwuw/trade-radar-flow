import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const db = new DatabaseSync("data/trade-radar.db", { readOnly: true });

const campaignIds = [
  ["e770fe2e-0bcb-436e-ba33-7770fbe82d54", "Hungary"],
  ["5e823f26-696e-49a9-b1c9-9b6e175756f9", "Czech Republic"],
  ["bd2b5d98-921b-4813-850f-bfdf96e78918", "Romania"],
  ["922d59bb-53e1-469d-b0c3-8a83f0826b30", "Poland"],
  ["0d185447-957d-430a-92eb-055af26d6400", "Ukraine"],
];

function analyzeCampaign(id, label) {
  const row = db.prepare("SELECT result_json FROM campaigns WHERE id = ?").get(id);
  if (!row) return null;
  const campaign = JSON.parse(String(row.result_json));
  const companyStatus = {};
  for (const company of campaign.discovery?.companies ?? []) {
    companyStatus[company.status] = (companyStatus[company.status] ?? 0) + 1;
  }
  const skipped = campaign.discovery?.skipped ?? [];
  const skipReasons = {};
  for (const item of skipped) {
    const key = item.reason.split("：")[0]?.slice(0, 40) ?? item.reason;
    skipReasons[key] = (skipReasons[key] ?? 0) + 1;
  }
  const snippetGate = skipped.filter((s) => s.reason.includes("搜索摘要预筛")).length;
  const postCrawlGate = skipped.filter((s) => s.reason.includes("抓取后预筛")).length;
  const leads = campaign.leads ?? [];
  const byStatus = {
    qualified: leads.filter((l) => l.status === "qualified" || l.status === "approved").length,
    needsReview: leads.filter((l) => l.status === "needs_review").length,
    rejected: leads.filter((l) => l.status === "rejected").length,
  };
  const sessionRow = db
    .prepare("SELECT session_json FROM orchestrator_sessions")
    .all()
    .map((r) => JSON.parse(String(r.session_json)))
    .find((s) => s.campaignId === id);
  return {
    country: label,
    executedQueries: campaign.discovery?.progress?.executedQueries ?? 0,
    plannedQueries: campaign.discovery?.plan?.queries?.length ?? 0,
    seenDomains: campaign.discovery?.progress?.seenDomains?.length ?? 0,
    companyStatus,
    skippedTotal: skipped.length,
    snippetGateSkipped: snippetGate,
    postCrawlGateSkipped: postCrawlGate,
    topSkipReasons: Object.fromEntries(
      Object.entries(skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 6),
    ),
    leads: leads.length,
    ...byStatus,
    rejectRatePct: leads.length
      ? Math.round((byStatus.rejected / leads.length) * 100)
      : null,
    preAnalysisGate: sessionRow?.strategy?.validation?.preAnalysisGate ?? null,
    exclusionTerms: sessionRow?.strategy?.exclusions?.terms?.length ?? 0,
  };
}

console.log("=== CAMPAIGN GATE & QUERY EFFECTIVENESS ===\n");
for (const [id, label] of campaignIds) {
  const result = analyzeCampaign(id, label);
  if (result) console.log(JSON.stringify(result, null, 2), "\n---");
}

// Parse log file for gate events since resume (~05:30 UTC)
const logPath = "logs/trade-radar-2026-08-08.jsonl";
let snippetEvents = 0;
let preAnalysisEvents = 0;
let discoveryRoundsAfterResume = 0;
let serperStarted = 0;
let serperFailed = 0;
const since = "2026-08-08T05:30:00";

for (const line of readFileSync(logPath, "utf8").split("\n")) {
  if (!line.includes(since) && line < `"timestamp":"${since}`) continue;
  if (!line.includes('"timestamp"')) continue;
  try {
    const event = JSON.parse(line);
    if (event.timestamp < since) continue;
    if (event.event === "discovery.round.candidate.snippet_gate_rejected") snippetEvents++;
    if (event.event === "discovery.round.candidate.pre_analysis_rejected") preAnalysisEvents++;
    if (event.event === "discovery.candidate.snippet_gate_rejected") snippetEvents++;
    if (event.event === "discovery.candidate.pre_analysis_rejected") preAnalysisEvents++;
    if (event.event === "discovery.round.started") discoveryRoundsAfterResume++;
    if (event.event === "search.serper.started") serperStarted++;
    if (event.event === "search.serper.network_failed") serperFailed++;
  } catch {
    // ignore
  }
}

console.log(
  JSON.stringify(
    {
      logWindowSince: since,
      discoveryRoundsAfterResume,
      serperStarted,
      serperFailed,
      snippetGateLogEvents: snippetEvents,
      preAnalysisGateLogEvents: preAnalysisEvents,
    },
    null,
    2,
  ),
);
