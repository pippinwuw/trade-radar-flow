import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/trade-radar.db", { readOnly: true });

const sessions = db
  .prepare(
    `SELECT id, status, session_json, updated_at
     FROM orchestrator_sessions
     ORDER BY updated_at DESC`,
  )
  .all();

for (const row of sessions) {
  const session = JSON.parse(String(row.session_json));
  let campaign = null;
  if (session.campaignId) {
    const campaignRow = db
      .prepare("SELECT result_json FROM campaigns WHERE id = ?")
      .get(session.campaignId);
    if (campaignRow) {
      campaign = JSON.parse(String(campaignRow.result_json));
    }
  }
  const progress = campaign?.discovery?.progress;
  const planned = campaign?.discovery?.plan?.queries?.length ?? 0;
  const executed = progress?.executedQueries ?? 0;
  const statusCounts = {};
  for (const company of campaign?.discovery?.companies ?? []) {
    statusCounts[company.status] = (statusCounts[company.status] ?? 0) + 1;
  }
  const incomplete =
    row.status === "running" ||
    row.status === "failed" ||
    (planned > 0 && executed < planned) ||
    (campaign?.candidateQueue?.length ?? 0) > 0 ||
    Object.keys(statusCounts).some((status) =>
      ["pending", "crawling", "analyzing"].includes(status),
    );

  console.log(
    JSON.stringify(
      {
        sessionId: row.id,
        sessionStatus: row.status,
        incomplete,
        country: session.strategy?.country,
        campaignId: session.campaignId,
        error: session.error,
        updatedAt: row.updated_at,
        executedQueries: executed,
        plannedQueries: planned,
        stopReason: progress?.stopReason,
        leadCount: campaign?.leads?.length ?? 0,
        companyStatusCounts: statusCounts,
        pendingQueue: campaign?.candidateQueue?.length ?? 0,
        analysisFailures: campaign?.analysisFailures?.length ?? 0,
        completedAt: campaign?.completedAt,
      },
      null,
      2,
    ),
  );
  console.log("---");
}
