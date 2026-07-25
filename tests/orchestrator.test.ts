import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DemoAgentRuntime } from "../src/agents/demo-agent-runtime.js";
import type {
  CampaignResult,
  OrchestratorSessionStatus,
} from "../src/domain.js";
import { OrchestratorService } from "../src/orchestrator/service.js";
import { AppDatabase } from "../src/storage/database.js";

function service(): OrchestratorService {
  return new OrchestratorService(
    new AppDatabase(":memory:"),
    new DemoAgentRuntime(),
  );
}

async function waitForStatus(
  active: OrchestratorService,
  sessionId: string,
  status: OrchestratorSessionStatus,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (active.getSession(sessionId).status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`等待会话状态 ${status} 超时`);
}

test("主 Agent 创建会话并明确引导用户下一步", async () => {
  const created = await service().createSession({
    product: "PVC tarpaulin",
    country: "UAE",
    language: "English",
  });

  assert.equal(created.session.status, "drafting");
  assert.equal(created.session.strategy.schemaVersion, 2);
  assert.equal(created.session.strategy.marketPolicyRef?.marketId, "uae");
  assert.equal(created.messages.length, 1);
  assert.match(created.messages[0]?.content ?? "", /下一步：/);
  assert.equal(created.messages[0]?.nextAction, "reply_to_agent");
});

test("主 Agent 生成查询预览后才允许用户确认策略", async () => {
  const active = service();
  const created = await active.createSession({
    product: "PVC tarpaulin",
    country: "United Arab Emirates",
    language: "English",
  });

  assert.throws(
    () =>
      active.approveStrategy(
        created.session.id,
        created.session.strategyHash,
      ),
    /待确认/,
  );

  const turn = await active.chat(
    created.session.id,
    "优先寻找进口商和批发商，请按模板生成查询。",
  );
  assert.equal(turn.session.status, "awaiting_approval");
  assert.ok(turn.session.strategy.search.queries.length > 0);
  assert.match(turn.message.content, /下一步：/);

  assert.throws(
    () => active.approveStrategy(created.session.id, "stale-hash"),
    /发生变化/,
  );
  const approved = active.approveStrategy(
    created.session.id,
    turn.session.strategyHash,
  );
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedStrategyHash, approved.strategyHash);
  assert.ok(approved.approvalId);
});

test("修改策略会增加版本并使原审批流程失效", async () => {
  const active = service();
  const created = await active.createSession({
    product: "PVC tarpaulin",
    country: "Saudi Arabia",
    language: "English",
  });
  const planned = await active.chat(created.session.id, "生成第一版策略");
  const oldHash = planned.session.strategyHash;
  const updated = active.replaceStrategy(created.session.id, {
    ...planned.session.strategy,
    budget: {
      ...planned.session.strategy.budget,
      maxQueries: 99,
      maxPagesPerCompany: 99,
    },
  });

  assert.equal(updated.status, "drafting");
  assert.equal(updated.strategyVersion, planned.session.strategyVersion + 1);
  assert.notEqual(updated.strategyHash, oldHash);
  assert.equal(updated.strategy.budget.maxQueries, 99);
  assert.equal(updated.strategy.budget.maxPagesPerCompany, 99);
  assert.equal(updated.approvalId, undefined);
});

test("主 Agent 切换国家时同步 MarketPolicy、清空旧查询并重新送审", async () => {
  const active = service();
  const created = await active.createSession({
    product: "PVC tarpaulin",
    country: "UAE",
    language: "English",
  });
  const firstPlan = await active.chat(created.session.id, "生成 UAE 查询预览");
  const previousHash = firstPlan.session.strategyHash;

  const switched = await active.chat(
    created.session.id,
    "目标国家改为沙特，请使用沙特对应的 MarketPolicy 重新规划。",
  );

  assert.equal(switched.session.status, "awaiting_approval");
  assert.equal(switched.session.strategy.country, "Saudi Arabia");
  assert.equal(
    switched.session.strategy.marketPolicyRef?.marketId,
    "saudi",
  );
  assert.ok(switched.session.strategy.marketPolicyRef?.version);
  assert.notEqual(switched.session.strategyHash, previousHash);
  assert.equal(switched.session.approvedStrategyHash, undefined);
  assert.ok(switched.session.strategy.search.queries.length > 0);
  assert.ok(
    switched.session.strategy.search.queries.every(
      (query) => /Riyadh|Jeddah|Mecca/.test(query.query),
    ),
  );
});

test("数据库已有国家搜索时主 Agent 先确认重查意愿和查询数量", async () => {
  const database = new AppDatabase(":memory:");
  database.saveCampaign({
    id: "previous-saudi-search",
    product: "PVC tarpaulin",
    country: "Saudi Arabia",
    language: "English",
    mode: "demo",
    searchMode: "serper",
    startedAt: "2026-07-18T10:00:00.000Z",
    completedAt: "2026-07-18T10:05:00.000Z",
    leads: [],
  });
  const active = new OrchestratorService(database, new DemoAgentRuntime());
  const created = await active.createSession({
    product: "PVC tarpaulin",
    country: "Saudi Arabia",
    language: "English",
  });

  const needsConfirmation = await active.chat(
    created.session.id,
    "帮我搜索沙特的经销商",
  );
  assert.equal(needsConfirmation.session.status, "drafting");
  assert.equal(needsConfirmation.session.strategy.search.queries.length, 0);
  assert.match(needsConfirmation.message.content, /是否再次查询/);
  assert.match(needsConfirmation.message.content, /查询数量/);

  const confirmed = await active.chat(
    created.session.id,
    "确认再次查询，本次执行 12 条查询",
  );
  assert.equal(confirmed.session.status, "awaiting_approval");
  assert.equal(confirmed.session.strategy.budget.maxQueries, 12);
  assert.ok(confirmed.session.strategy.search.queries.length > 3);
  assert.ok(confirmed.session.strategy.search.queries.length <= 12);
  assert.ok(
    confirmed.session.strategy.customSections.some(
      (section) => section.id === "country-rerun:saudi",
    ),
  );
});

test("主 Agent 会话和完整聊天记录在数据库重载后仍可恢复", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trade-radar-session-"));
  const databasePath = path.join(directory, "sessions.db");
  const firstDatabase = new AppDatabase(databasePath);
  const firstService = new OrchestratorService(
    firstDatabase,
    new DemoAgentRuntime(),
  );
  const created = await firstService.createSession({
    product: "Architectural membrane",
    country: "UAE",
    language: "English",
  });
  await firstService.chat(
    created.session.id,
    "优先找有进口能力的分销商，并生成第一版查询。",
  );
  firstDatabase.createOrchestratorMessage({
    id: "interrupted-user-message",
    sessionId: created.session.id,
    role: "user",
    content: "这是服务重启前尚未完成的消息",
    createdAt: new Date().toISOString(),
  });
  firstDatabase.close();

  const reloadedDatabase = new AppDatabase(databasePath);
  t.after(async () => {
    reloadedDatabase.close();
    await rm(directory, { recursive: true, force: true });
  });
  const reloadedService = new OrchestratorService(
    reloadedDatabase,
    new DemoAgentRuntime(),
  );
  const sessions = reloadedService.listSessions();
  const restored = reloadedService.getSessionView(created.session.id);

  assert.equal(sessions[0]?.id, created.session.id);
  assert.equal(restored.session.input.product, "Architectural membrane");
  assert.equal(restored.messages.length, 4);
  assert.deepEqual(
    restored.messages.map((message) => message.role),
    ["assistant", "user", "assistant", "user"],
  );
  assert.match(restored.messages[1]?.content ?? "", /进口能力/);
  const resumed = await reloadedService.resumeChat(created.session.id);
  const completed = reloadedService.getSessionView(created.session.id);
  assert.equal(resumed.message.role, "assistant");
  assert.equal(completed.messages.length, 5);
  assert.deepEqual(
    completed.messages.slice(-2).map((message) => message.role),
    ["user", "assistant"],
  );
  await assert.rejects(
    () => reloadedService.resumeChat(created.session.id),
    /没有待恢复/,
  );
});

test("失败后可在对话中沿用同一 Campaign 检查点继续", async () => {
  const database = new AppDatabase(":memory:");
  const campaignIds: string[] = [];
  let attempts = 0;
  const active = new OrchestratorService(
    database,
    new DemoAgentRuntime(),
    async (strategy, _onPhase, campaignId) => {
      attempts += 1;
      assert.ok(campaignId);
      campaignIds.push(campaignId);
      const existing = database.getCampaign(campaignId);
      const campaign: CampaignResult =
        existing ?? {
          id: campaignId,
          product: strategy.product,
          country: strategy.country,
          language: strategy.language,
          mode: "demo",
          searchMode: "serper",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          leads: [],
          analysisFailures: [],
          candidateQueue: [],
        };
      database.saveCampaign(campaign);
      if (attempts === 1) throw new Error("模拟 Serper 临时故障");
      return campaign;
    },
  );
  const created = await active.createSession({
    product: "PVC tarpaulin",
    country: "UAE",
    language: "English",
  });
  const planned = await active.chat(created.session.id, "生成查询预览");
  active.approveStrategy(created.session.id, planned.session.strategyHash);
  const started = active.startExecution(created.session.id);
  await waitForStatus(active, created.session.id, "failed");

  const failed = active.getSession(created.session.id);
  assert.equal(failed.campaignId, started.campaignId);
  assert.match(failed.error ?? "", /Serper 临时故障/);

  const resumed = await active.chat(
    created.session.id,
    "配置已经修复，请继续之前的任务",
  );
  assert.notEqual(resumed.session.status, "failed");
  assert.match(resumed.message.content, /检查点.*继续|失败位置继续/);
  await waitForStatus(active, created.session.id, "awaiting_report_review");

  assert.equal(attempts, 2);
  assert.deepEqual(campaignIds, [started.campaignId, started.campaignId]);
});

test("失败后改国家会废弃旧 Campaign 并重新进入审批", async () => {
  let attempts = 0;
  const active = new OrchestratorService(
    new AppDatabase(":memory:"),
    new DemoAgentRuntime(),
    async () => {
      attempts += 1;
      throw new Error("模拟执行失败");
    },
  );
  const created = await active.createSession({
    product: "PVC tarpaulin",
    country: "UAE",
    language: "English",
  });
  const planned = await active.chat(created.session.id, "生成查询预览");
  active.approveStrategy(created.session.id, planned.session.strategyHash);
  const started = active.startExecution(created.session.id);
  await waitForStatus(active, created.session.id, "failed");
  assert.equal(active.getSession(created.session.id).campaignId, started.campaignId);

  const retargeted = await active.chat(
    created.session.id,
    "不要续跑旧任务，目标国家改为沙特并重新规划。",
  );

  assert.equal(retargeted.session.status, "awaiting_approval");
  assert.equal(retargeted.session.strategy.country, "Saudi Arabia");
  assert.equal(
    retargeted.session.strategy.marketPolicyRef?.marketId,
    "saudi",
  );
  assert.equal(retargeted.session.campaignId, undefined);
  assert.equal(retargeted.session.approvedStrategyHash, undefined);
  assert.equal(attempts, 1);
});
