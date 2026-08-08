import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  }
  return value;
}

function policyHash(policy) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(policy)))
    .digest("hex");
}

const roots = [
  path.join("market-policies"),
  path.join("data", "market-policies", "approved"),
];

const db = new DatabaseSync("data/trade-radar.db");
const update = db.prepare(
  "UPDATE market_policy_versions SET hash = ? WHERE market_id = ? AND version = ?",
);

for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "schema") continue;
    const activePath = path.join(root, entry.name, "active.json");
    if (!existsSync(activePath)) continue;
    const active = JSON.parse(readFileSync(activePath, "utf8"));
    const policyPath = path.join(
      root,
      entry.name,
      "versions",
      active.version,
      "policy.json",
    );
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    const hash = policyHash(policy);
    update.run(hash, active.marketId, active.version);
    console.log(
      `synced ${active.marketId}@${active.version} -> ${hash.slice(0, 16)}...`,
    );
  }
}
