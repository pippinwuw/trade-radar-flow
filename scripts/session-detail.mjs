import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/trade-radar.db", { readOnly: true });
const row = db
  .prepare("SELECT session_json FROM orchestrator_sessions WHERE id = ?")
  .get("170b40cb-d373-4324-a98e-52c6f7c25ada");
const s = JSON.parse(String(row.session_json));
console.log(
  JSON.stringify(
    {
      status: s.status,
      approvalId: s.approvalId,
      approvedStrategyHash: s.approvedStrategyHash,
      strategyHash: s.strategyHash,
      match: s.approvedStrategyHash === s.strategyHash,
      campaignId: s.campaignId,
      runPhase: s.runPhase,
    },
    null,
    2,
  ),
);
