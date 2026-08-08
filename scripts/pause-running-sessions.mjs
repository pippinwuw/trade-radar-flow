import { DatabaseSync } from "node:sqlite";

const PAUSE_REASON = "用户请求暂时停止执行；可从检查点续跑";

const db = new DatabaseSync("data/trade-radar.db");
const running = db
  .prepare("SELECT id, session_json FROM orchestrator_sessions WHERE status = 'running'")
  .all();

if (!running.length) {
  console.log("No running orchestrator sessions.");
} else {
  const update = db.prepare(
    "UPDATE orchestrator_sessions SET status = ?, session_json = ?, updated_at = ? WHERE id = ?",
  );
  const now = new Date().toISOString();
  for (const row of running) {
    const session = JSON.parse(String(row.session_json));
    session.status = "failed";
    session.error = PAUSE_REASON;
    session.runPhase = undefined;
    session.updatedAt = now;
    update.run("failed", JSON.stringify(session), now, row.id);
    console.log(`Paused session ${row.id} (${session.strategy?.country}) campaign=${session.campaignId}`);
  }
}

console.log("Done.");
