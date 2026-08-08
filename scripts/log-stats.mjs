import { readFileSync } from "node:fs";

const since = "2026-08-08T05:30:00";
const counts = {};
const hungaryRounds = [];

for (const line of readFileSync("logs/trade-radar-2026-08-08.jsonl", "utf8").split("\n")) {
  if (!line.trim()) continue;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }
  if (event.timestamp < since) continue;
  counts[event.event] = (counts[event.event] ?? 0) + 1;
  if (
    event.sessionId === "170b40cb-d373-4324-a98e-52c6f7c25ada" &&
    event.event === "discovery.round.completed"
  ) {
    hungaryRounds.push(event.data);
  }
}

console.log("Events since resume:", JSON.stringify(counts, null, 2));
console.log("\nHungary rounds since resume:", JSON.stringify(hungaryRounds, null, 2));

// Full day validation stats
let validationFailed = 0;
let repairApplied = 0;
let permanentValidationFail = 0;
for (const line of readFileSync("logs/trade-radar-2026-08-08.jsonl", "utf8").split("\n")) {
  if (!line.includes("validation_failed") && !line.includes("repair_applied")) continue;
  try {
    const event = JSON.parse(line);
    if (event.event === "agent.company_analysis.validation_failed") validationFailed++;
    if (event.event === "agent.company_analysis.repair_applied") repairApplied++;
    if (event.event === "pipeline.candidate.failed" && line.includes("validation")) permanentValidationFail++;
  } catch {}
}
console.log("\nPhase C (full day):", { validationFailed, repairApplied, permanentValidationFail });
