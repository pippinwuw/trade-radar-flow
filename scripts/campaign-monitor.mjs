import { DatabaseSync } from "node:sqlite";

const QUEUE = [
  {
    sessionId: "170b40cb-d373-4324-a98e-52c6f7c25ada",
    country: "Hungary",
    note: "orphan running; server auto-resumes on start",
  },
  {
    sessionId: "2b88ba9b-f815-4ccd-a054-3a9fc5af728a",
    country: "Czech Republic",
  },
  {
    sessionId: "cb6c958c-0bac-4897-ae9f-4c8afd38af27",
    country: "Romania",
  },
  {
    sessionId: "b9b1220a-64ef-401e-9a5f-8c379e73abb3",
    country: "Poland",
  },
  {
    sessionId: "46ec43c5-a9d2-4216-a7be-5e0d6153ddc6",
    country: "Ukraine",
  },
];

const PORT = Number(process.env.PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const INTERVAL_MS = Number(process.env.CAMPAIGN_MONITOR_INTERVAL_MS ?? 15 * 60 * 1000);

function readSession(db, sessionId) {
  const row = db
    .prepare("SELECT status, session_json FROM orchestrator_sessions WHERE id = ?")
    .get(sessionId);
  if (!row) return undefined;
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
  return {
    sessionId,
    status: String(row.status),
    country: session.strategy?.country,
    error: session.error,
    executedQueries: progress?.executedQueries ?? 0,
    plannedQueries: campaign?.discovery?.plan?.queries?.length ?? 0,
    stopReason: progress?.stopReason,
    leadCount: campaign?.leads?.length ?? 0,
    runPhase: session.runPhase,
    updatedAt: session.updatedAt,
  };
}

function isComplete(snapshot) {
  if (!snapshot) return true;
  if (snapshot.status === "awaiting_report_review" || snapshot.status === "completed") {
    return true;
  }
  if (snapshot.status === "running") return false;
  if (snapshot.status === "failed") return false;
  if (
    snapshot.plannedQueries > 0 &&
    snapshot.executedQueries >= snapshot.plannedQueries &&
    snapshot.stopReason &&
    snapshot.stopReason !== "failed"
  ) {
    return true;
  }
  return false;
}

async function healthCheck() {
  const healthResponse = await fetch(`${BASE}/api/health`);
  if (!healthResponse.ok) throw new Error(`health ${healthResponse.status}`);
  const health = await healthResponse.json();
  const sessionsResponse = await fetch(`${BASE}/api/orchestrator/sessions`);
  if (!sessionsResponse.ok) {
    throw new Error(`sessions ${sessionsResponse.status}`);
  }
  const sessions = await sessionsResponse.json();
  return { health, runningSessions: sessions.filter((s) => s.status === "running").length };
}

async function resumeSession(sessionId) {
  const response = await fetch(
    `${BASE}/api/orchestrator/sessions/${sessionId}/execute/resume`,
    { method: "POST" },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`resume ${sessionId} failed: ${response.status} ${body}`);
  }
  return JSON.parse(body);
}

async function tick(db, queueIndex) {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] === health check ===`);
  try {
    const health = await healthCheck();
    console.log("server:", JSON.stringify(health));
  } catch (error) {
    console.error("server health FAILED:", error instanceof Error ? error.message : error);
    return queueIndex;
  }

  const running = db
    .prepare(
      `SELECT id FROM orchestrator_sessions WHERE status = 'running' ORDER BY updated_at DESC LIMIT 1`,
    )
    .get();
  if (running) {
    const snapshot = readSession(db, String(running.id));
    console.log("active job:", JSON.stringify(snapshot, null, 2));
    return queueIndex;
  }

  while (queueIndex < QUEUE.length) {
    const item = QUEUE[queueIndex];
    const snapshot = readSession(db, item.sessionId);
    console.log("queue item:", JSON.stringify({ ...item, snapshot }, null, 2));
    if (isComplete(snapshot)) {
      console.log(`skip complete: ${item.country}`);
      queueIndex += 1;
      continue;
    }
    if (snapshot?.status === "failed") {
      console.log(`resuming failed session: ${item.country} (${item.sessionId})`);
      try {
        const resumed = await resumeSession(item.sessionId);
        console.log("resumed:", JSON.stringify({
          id: resumed.id,
          status: resumed.status,
          country: resumed.strategy?.country,
          campaignId: resumed.campaignId,
        }));
      } catch (error) {
        console.error("resume error:", error instanceof Error ? error.message : error);
      }
      return queueIndex;
    }
    if (snapshot?.status === "running") {
      return queueIndex;
    }
    queueIndex += 1;
  }

  console.log("all queued campaigns processed or complete");
  return queueIndex;
}

const db = new DatabaseSync("data/trade-radar.db", { readOnly: true });
let queueIndex = 0;

console.log(`Campaign monitor started. Interval=${INTERVAL_MS}ms`);
console.log("Queue:", QUEUE.map((item) => item.country).join(" -> "));

await tick(db, queueIndex);
setInterval(async () => {
  try {
    queueIndex = await tick(db, queueIndex);
  } catch (error) {
    console.error("monitor tick error:", error instanceof Error ? error.message : error);
  }
}, INTERVAL_MS);
