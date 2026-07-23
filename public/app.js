const elements = {
  modeBadge: document.querySelector("#modeBadge"),
  themeToggle: document.querySelector("#themeToggle"),
  product: document.querySelector("#product"),
  country: document.querySelector("#country"),
  language: document.querySelector("#language"),
  companyUrl: document.querySelector("#companyUrl"),
  enableRegexCleaning: document.querySelector("#enableRegexCleaning"),
  runSearchButton: document.querySelector("#runSearchButton"),
  runDemoButton: document.querySelector("#runDemoButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  runStatus: document.querySelector("#runStatus"),
  runStatusTitle: document.querySelector("#runStatusTitle"),
  runStatusText: document.querySelector("#runStatusText"),
  workspace: document.querySelector("#workspace"),
  campaignTitle: document.querySelector("#campaignTitle"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportXlsxButton: document.querySelector("#exportXlsxButton"),
  leadCount: document.querySelector("#leadCount"),
  summaryStrip: document.querySelector("#summaryStrip"),
  leadList: document.querySelector("#leadList"),
  leadDetail: document.querySelector("#leadDetail"),
  leadItemTemplate: document.querySelector("#leadItemTemplate"),
  pageTabs: document.querySelectorAll("[data-page-target]"),
  workbenchPage: document.querySelector("#workbenchPage"),
  skillsPage: document.querySelector("#skillsPage"),
  skillCards: document.querySelector("#skillCards"),
  proposalList: document.querySelector("#proposalList"),
  skillMessage: document.querySelector("#skillMessage"),
  generateSkillProposalButton: document.querySelector(
    "#generateSkillProposalButton",
  ),
  refreshSkillsButton: document.querySelector("#refreshSkillsButton"),
  newOrchestratorButton: document.querySelector("#newOrchestratorButton"),
  orchestratorSessionSelect: document.querySelector(
    "#orchestratorSessionSelect",
  ),
  orchestratorStatus: document.querySelector("#orchestratorStatus"),
  agentMessages: document.querySelector("#agentMessages"),
  agentComposer: document.querySelector("#agentComposer"),
  agentMessageInput: document.querySelector("#agentMessageInput"),
  sendAgentMessageButton: document.querySelector("#sendAgentMessageButton"),
  strategyEmpty: document.querySelector("#strategyEmpty"),
  strategyForm: document.querySelector("#strategyForm"),
  strategyVersion: document.querySelector("#strategyVersion"),
  strategyObjective: document.querySelector("#strategyObjective"),
  strategyRoles: document.querySelector("#strategyRoles"),
  strategyIndustries: document.querySelector("#strategyIndustries"),
  strategyKeywords: document.querySelector("#strategyKeywords"),
  strategyAlternatives: document.querySelector("#strategyAlternatives"),
  strategyLocalKeywords: document.querySelector("#strategyLocalKeywords"),
  strategyCities: document.querySelector("#strategyCities"),
  strategyExclusions: document.querySelector("#strategyExclusions"),
  strategyDomains: document.querySelector("#strategyDomains"),
  strategyMaxQueries: document.querySelector("#strategyMaxQueries"),
  strategyResultsPerQuery: document.querySelector(
    "#strategyResultsPerQuery",
  ),
  strategyMaxPages: document.querySelector("#strategyMaxPages"),
  strategyCountryScore: document.querySelector("#strategyCountryScore"),
  strategyLowYieldDomains: document.querySelector(
    "#strategyLowYieldDomains",
  ),
  strategyLowYieldRate: document.querySelector("#strategyLowYieldRate"),
  strategyLowYieldRounds: document.querySelector("#strategyLowYieldRounds"),
  customStrategySections: document.querySelector(
    "#customStrategySections",
  ),
  strategyBudget: document.querySelector("#strategyBudget"),
  saveStrategyButton: document.querySelector("#saveStrategyButton"),
  approveStrategyButton: document.querySelector("#approveStrategyButton"),
  executeStrategyButton: document.querySelector("#executeStrategyButton"),
  orchestratorProgress: document.querySelector("#orchestratorProgress"),
  orchestratorProgressTitle: document.querySelector(
    "#orchestratorProgressTitle",
  ),
  orchestratorProgressText: document.querySelector(
    "#orchestratorProgressText",
  ),
  orchestratorRoundProgress: document.querySelector(
    "#orchestratorRoundProgress",
  ),
  orchestratorReport: document.querySelector("#orchestratorReport"),
};

const statusLabels = {
  qualified: "建议触达",
  needs_review: "需要复核",
  rejected: "不合格",
  approved: "已批准",
};

const stopReasonLabels = {
  max_queries: "达到用户批准的查询上限",
  all_groups_saturated: "全部查询分组已连续低新增",
  plan_exhausted: "已执行完查询计划",
  failed: "执行失败",
};

let campaign;
let activeLeadId;
let loadingMessagesTimer;
let orchestratorSession;
let orchestratorSessions = [];
let orchestratorMessages = [];
let orchestratorPollTimer;
let chatRequestPending = false;

function clientLog(event, data = {}) {
  const payload = JSON.stringify({
    event,
    path: window.location.pathname,
    data,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/client-logs",
      new Blob([payload], { type: "application/json" }),
    );
    return;
  }
  void fetch("/api/client-logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

window.addEventListener("error", (event) => {
  clientLog("runtime_error", {
    message: event.message,
    source: event.filename?.split("/").at(-1),
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  clientLog("unhandled_rejection", {
    message:
      event.reason instanceof Error
        ? event.reason.message
        : String(event.reason ?? "未知错误"),
  });
});

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  localStorage.setItem("trade-radar-theme", normalized);
  elements.themeToggle.setAttribute(
    "aria-pressed",
    String(normalized === "dark"),
  );
  elements.themeToggle.textContent =
    normalized === "dark" ? "切换浅色" : "切换深色";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "#";
  } catch {
    return "#";
  }
}

async function request(url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const raw = await response.text();
  let result;
  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    clientLog("invalid_api_response", {
      method: options.method ?? "GET",
      url,
      status: response.status,
      contentType: response.headers.get("content-type"),
      responseCharacters: raw.length,
    });
    throw new Error(
      `API 返回了非 JSON 内容（HTTP ${response.status}）。请确认页面由当前项目的 http://127.0.0.1:3210 提供。`,
    );
  }
  if (!response.ok) {
    clientLog("api_request_failed", {
      method: options.method ?? "GET",
      url,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      message: result.error,
    });
    throw new Error(result.error ?? `请求失败：HTTP ${response.status}`);
  }
  return result;
}

function isFetchFailure(error) {
  return (
    error instanceof TypeError ||
    /fail(?:ed)? to fetch|fetch failed|network(?:error| request)/i.test(
      error?.message ?? "",
    )
  );
}

async function waitForService(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("/api/health", {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return true;
    } catch {
      // A development watcher can take a few seconds to restart the server.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

function inputPayload() {
  return {
    product: elements.product.value.trim(),
    country: elements.country.value.trim(),
    language: elements.language.value,
  };
}

function setLoading(loading, mode = "agent") {
  elements.runSearchButton.disabled = loading;
  elements.runDemoButton.disabled = loading;
  elements.analyzeButton.disabled = loading;
  if (loading) {
    elements.exportJsonButton.disabled = true;
    elements.exportXlsxButton.disabled = true;
  }
  elements.runStatus.classList.toggle("hidden", !loading);
  if (!loading) {
    clearInterval(loadingMessagesTimer);
    return;
  }

  elements.runStatusTitle.textContent =
    mode === "website"
      ? "正在抓取并分析公司网站"
      : mode === "search"
        ? "正在执行本地化搜索"
        : "正在运行 Agent 流水线";
  const messages =
    mode === "search"
      ? [
          "查询规划 Agent 正在加载国家 Skill...",
          "Serper 正在执行本地化 Google 搜索...",
          "Python 爬虫正在采集候选公司官网...",
          "正在执行联系人与国家信号本地验证...",
          "公司研究与资格 Agent 正在分析候选公司...",
          "触达 Agent 正在生成公司简报和模板...",
        ]
      : [
    "Python 爬虫与正则正在整理候选公司...",
    "公司研究 Agent 正在共享上下文中阅读网站与消歧联系人...",
    "资格 Agent 正在完成初审和同上下文复核...",
    "触达 Agent 正在生成公司简报并选择模板...",
  ];
  let index = 0;
  elements.runStatusText.textContent = messages[index];
  loadingMessagesTimer = setInterval(() => {
    index = Math.min(index + 1, messages.length - 1);
    elements.runStatusText.textContent = messages[index];
  }, 1300);
}

async function runAnalysis(endpoint, payload, mode = "agent") {
  setLoading(true, mode);
  try {
    campaign = await request(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    activeLeadId = campaign.leads[0]?.id;
    renderCampaign();
  } catch (error) {
    elements.runStatus.classList.remove("hidden");
    elements.runStatusTitle.textContent = "运行失败";
    elements.runStatusText.textContent = error.message;
    clearInterval(loadingMessagesTimer);
  } finally {
    elements.runSearchButton.disabled = false;
    elements.runDemoButton.disabled = false;
    elements.analyzeButton.disabled = false;
    if (campaign) elements.runStatus.classList.add("hidden");
  }
}

function exportableLeadCount() {
  return campaign?.leads.length ?? 0;
}

function exportFilename(format) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const base =
    `trade-radar-${campaign?.country ?? "campaign"}-${campaign?.product ?? "leads"}-${date}`
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[ .-]+$/g, "")
    .slice(0, 140);
  return `${base || "trade-radar-export"}.${format}`;
}

async function downloadCampaignExport(format, button) {
  if (!campaign?.id || !exportableLeadCount()) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在生成…";
  try {
    const response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaign.id)}/export.${format}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      const raw = await response.text();
      let message = raw;
      try {
        message = JSON.parse(raw).error ?? raw;
      } catch {
        // 服务端可能在下载开始前返回纯文本错误。
      }
      throw new Error(message || `导出失败：HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename(format);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    clientLog("campaign_exported", {
      campaignId: campaign.id,
      format,
      leadCount: response.headers.get("x-exported-lead-count"),
      bytes: blob.size,
    });
  } catch (error) {
    clientLog("campaign_export_failed", {
      campaignId: campaign?.id,
      format,
      message: error instanceof Error ? error.message : String(error),
    });
    window.alert(error instanceof Error ? error.message : "导出失败");
  } finally {
    button.textContent = originalText;
    button.disabled = exportableLeadCount() === 0;
  }
}

function renderCampaign() {
  elements.workspace.classList.remove("hidden");
  elements.campaignTitle.textContent = `${campaign.country} · ${campaign.product}`;
  elements.leadCount.textContent = campaign.leads.length;
  const qualified = campaign.leads.filter(
    (lead) => lead.status === "qualified" || lead.status === "approved",
  ).length;
  const review = campaign.leads.filter(
    (lead) => lead.status === "needs_review",
  ).length;
  const exportable = exportableLeadCount();
  elements.exportJsonButton.disabled = exportable === 0;
  elements.exportXlsxButton.disabled = exportable === 0;
  const exportTitle = exportable
    ? `导出 ${exportable} 条线索及证据`
    : "当前任务没有可导出的线索";
  elements.exportJsonButton.title = exportTitle;
  elements.exportXlsxButton.title = exportTitle;
  elements.summaryStrip.innerHTML =
    `<span>建议触达 <b>${qualified}</b></span>` +
    `<span>待复核 <b>${review}</b></span>` +
    `<span>模式 <b>${escapeHtml(campaign.mode)}</b></span>` +
    (campaign.discovery
      ? `<span>搜索命中 <b>${campaign.discovery.hits.length}</b></span>` +
        `<span>本次 Serper <b>${campaign.discovery.serpRequests}</b></span>` +
        `<span>缓存 <b>${campaign.discovery.cacheHits}</b></span>`
      : "");
  renderLeadList();
  renderLeadDetail();
  elements.workspace.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderLeadList() {
  elements.leadList.replaceChildren();
  for (const lead of campaign.leads) {
    const fragment = elements.leadItemTemplate.content.cloneNode(true);
    const button = fragment.querySelector(".lead-item");
    button.dataset.leadId = lead.id;
    button.classList.toggle("active", lead.id === activeLeadId);
    fragment.querySelector('[data-field="name"]').textContent =
      lead.research.canonicalName;
    const status = fragment.querySelector('[data-field="status"]');
    status.textContent = statusLabels[lead.status] ?? lead.status;
    status.classList.add(lead.status);
    fragment.querySelector('[data-field="role"]').textContent =
      `${lead.qualification.businessRole} · ${lead.candidate.domain}`;
    fragment.querySelector('[data-field="fit"]').textContent =
      lead.qualification.productFitScore;
    fragment.querySelector('[data-field="scale"]').textContent =
      lead.qualification.scaleScore;
    fragment.querySelector('[data-field="confidence"]').textContent =
      `${Math.round(lead.qualification.confidence * 100)}%`;
    button.addEventListener("click", () => {
      activeLeadId = lead.id;
      renderLeadList();
      renderLeadDetail();
    });
    elements.leadList.append(fragment);
  }
}

function renderLeadDetail() {
  const lead = campaign.leads.find((item) => item.id === activeLeadId);
  if (!lead) return;

  const evidence = lead.research.evidence
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.label)}：${escapeHtml(item.value)}</strong>` +
        `<div>“${escapeHtml(item.quote)}”</div>` +
        `<a href="${escapeHtml(safeUrl(item.sourceUrl))}" target="_blank" rel="noreferrer">${escapeHtml(item.sourceUrl)}</a></li>`,
    )
    .join("");
  const traces = lead.traces
    .map(
      (trace) =>
        `<li><strong>${escapeHtml(trace.agent)} · ${trace.durationMs}ms</strong>` +
        `<span>${trace.steps.map(escapeHtml).join(" → ")}</span></li>`,
    )
    .join("");
  const briefRows = [
    ["联系价值", lead.outreach.whyContact],
    ["产品匹配", lead.outreach.productFit],
    ["经营角色", lead.qualification.businessRole],
    ["推荐联系人", lead.outreach.recommendedContact],
    ["模板", `${lead.outreach.templateId} · ${lead.outreach.templateReason}`],
    ["风险/缺失", lead.outreach.risk],
  ]
    .map(
      ([label, value]) =>
        `<li><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></li>`,
    )
    .join("");
  const reasons = lead.qualification.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  const contactValidation = (lead.candidate.contactValidations ?? [])
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.normalizedValue ?? item.value)} · ${Math.round(item.confidence * 100)}%</strong>` +
        `<span>${item.notes.map(escapeHtml).join("；")}</span></li>`,
    )
    .join("");
  const countryValidation = lead.candidate.countryValidation;

  elements.leadDetail.innerHTML = `
    <header class="detail-header">
      <div>
        <p class="eyebrow">Agent 公司简报</p>
        <h2>${escapeHtml(lead.research.canonicalName)}</h2>
        <p>${escapeHtml(lead.outreach.headline)}</p>
      </div>
      <div class="review-actions">
        <button class="button danger" data-review="rejected">驳回</button>
        <button class="button secondary" data-review="needs_review">标记复核</button>
        <button class="button primary" data-review="approved">批准草稿</button>
      </div>
    </header>
    <div class="detail-grid">
      <div>
        <section class="panel">
          <h3>30 秒审核简报</h3>
          <ul class="brief-list">${briefRows}</ul>
        </section>
        <section class="panel">
          <h3>资格审查理由</h3>
          <ul class="evidence-list">${reasons}</ul>
        </section>
      </div>
      <div>
        <section class="panel">
          <h3>原文证据</h3>
          <ul class="evidence-list">${evidence || "<li>暂无可引用证据</li>"}</ul>
        </section>
        <section class="panel">
          <h3>Agent 运行轨迹</h3>
          <ul class="trace-list">${traces}</ul>
        </section>
        <section class="panel">
          <h3>本地验证</h3>
          <ul class="trace-list">
            ${
              countryValidation
                ? `<li><strong>国家一致性 ${countryValidation.score}%</strong><span>${countryValidation.signals.map((item) => escapeHtml(`${item.kind}: ${item.value}`)).join("；") || "公开国家信号不足"}</span></li>`
                : "<li><span>未执行国家一致性验证</span></li>"
            }
            ${contactValidation || "<li><span>未发现可验证联系方式</span></li>"}
          </ul>
        </section>
      </div>
    </div>
    <section class="draft-section">
      <h3>触达草稿</h3>
      <div class="draft-tabs">
        <button class="tab active" data-draft-tab="email">Email</button>
        <button class="tab" data-draft-tab="whatsapp">WhatsApp</button>
      </div>
      <div data-draft-panel="email">
        <input id="emailSubject" aria-label="邮件主题" />
        <textarea id="emailBody" aria-label="邮件正文"></textarea>
      </div>
      <div class="hidden" data-draft-panel="whatsapp">
        <textarea id="whatsappBody" aria-label="WhatsApp 正文"></textarea>
      </div>
      <div class="draft-actions">
        <button class="button secondary" id="copyDraftButton">复制当前草稿</button>
      </div>
    </section>
  `;

  const emailSubject = elements.leadDetail.querySelector("#emailSubject");
  const emailBody = elements.leadDetail.querySelector("#emailBody");
  const whatsappBody = elements.leadDetail.querySelector("#whatsappBody");
  emailSubject.value = lead.outreach.emailSubject;
  emailBody.value = lead.outreach.emailBody;
  whatsappBody.value = lead.outreach.whatsappBody;

  elements.leadDetail.querySelectorAll("[data-review]").forEach((button) => {
    button.addEventListener("click", () =>
      updateReview(lead, button.dataset.review),
    );
  });
  elements.leadDetail.querySelectorAll("[data-draft-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.draftTab;
      elements.leadDetail
        .querySelectorAll("[data-draft-tab]")
        .forEach((tab) =>
          tab.classList.toggle("active", tab.dataset.draftTab === selected),
        );
      elements.leadDetail
        .querySelectorAll("[data-draft-panel]")
        .forEach((panel) =>
          panel.classList.toggle(
            "hidden",
            panel.dataset.draftPanel !== selected,
          ),
        );
      elements.leadDetail.querySelector("#copyDraftButton").dataset.mode =
        selected;
    });
  });
  elements.leadDetail
    .querySelector("#copyDraftButton")
    .addEventListener("click", copyDraft);
}

async function updateReview(lead, status) {
  try {
    const updated = await request(
      `/api/campaigns/${campaign.id}/leads/${lead.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      },
    );
    const index = campaign.leads.findIndex((item) => item.id === lead.id);
    campaign.leads[index] = updated;
    renderCampaign();
  } catch (error) {
    window.alert(error.message);
  }
}

async function copyDraft(event) {
  const mode = event.currentTarget.dataset.mode ?? "email";
  const text =
    mode === "whatsapp"
      ? elements.leadDetail.querySelector("#whatsappBody").value
      : `${elements.leadDetail.querySelector("#emailSubject").value}\n\n${elements.leadDetail.querySelector("#emailBody").value}`;
  await navigator.clipboard.writeText(text);
  event.currentTarget.textContent = "已复制";
  setTimeout(() => {
    event.currentTarget.textContent = "复制当前草稿";
  }, 1200);
}

function csv(value) {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function orchestratorStatusLabel(status) {
  return (
    {
      drafting: "讨论策略",
      awaiting_approval: "等待确认",
      approved: "策略已确认",
      running: "执行中",
      awaiting_report_review: "等待报告审核",
      completed: "已完成",
      failed: "执行失败",
    }[status] ?? status
  );
}

function sessionOptionLabel(session) {
  const updated = new Date(session.updatedAt);
  const updatedLabel = Number.isNaN(updated.getTime())
    ? ""
    : updated.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  return `${session.input.product} · ${session.input.country} · ${orchestratorStatusLabel(session.status)}${updatedLabel ? ` · ${updatedLabel}` : ""}`;
}

function renderOrchestratorSessionSelect() {
  const select = elements.orchestratorSessionSelect;
  select.disabled = orchestratorSessions.length === 0;
  select.innerHTML = orchestratorSessions.length
    ? orchestratorSessions
        .map(
          (session) =>
            `<option value="${escapeHtml(session.id)}">${escapeHtml(sessionOptionLabel(session))}</option>`,
        )
        .join("")
    : '<option value="">暂无已保存会话</option>';
  if (orchestratorSession) select.value = orchestratorSession.id;
}

function cacheOrchestratorSession(session) {
  orchestratorSessions = [
    session,
    ...orchestratorSessions.filter((item) => item.id !== session.id),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  renderOrchestratorSessionSelect();
}

async function initializeOrchestratorSessions() {
  try {
    const sessions = await request("/api/orchestrator/sessions");
    orchestratorSessions = Array.isArray(sessions) ? sessions : [];
    renderOrchestratorSessionSelect();
    const savedId = localStorage.getItem("trade-radar-orchestrator");
    const target =
      orchestratorSessions.find((session) => session.id === savedId)?.id ??
      orchestratorSessions[0]?.id;
    if (target) await loadOrchestratorSession(target, { silent: true });
  } catch (error) {
    clientLog("session_history_load_failed", {
      message: error.message,
    });
  }
}

function renderOrchestratorMessages() {
  if (!orchestratorMessages.length) {
    elements.agentMessages.innerHTML =
      '<div class="empty-chat">暂无对话。</div>';
    return;
  }
  const pendingRecovery =
    !chatRequestPending &&
    orchestratorSession?.status !== "running" &&
    orchestratorMessages.at(-1)?.role === "user";
  const failedExecutionRecovery =
    !chatRequestPending &&
    orchestratorSession?.status === "failed" &&
    Boolean(orchestratorSession.campaignId);
  elements.agentMessages.innerHTML =
    orchestratorMessages
    .map(
      (message) =>
        `<div class="agent-message ${escapeHtml(message.role)}">` +
        `<small>${message.role === "assistant" ? "主 Agent" : "你"}</small>` +
        `${escapeHtml(message.content)}</div>`,
    )
    .join("") +
    (pendingRecovery
      ? '<div class="chat-recovery"><span>检测到一条因连接中断而未完成的消息。</span><button class="button secondary" id="resumePendingChatButton">继续处理</button></div>'
      : "") +
    (failedExecutionRecovery
      ? '<div class="chat-recovery"><span>原 Campaign 检查点已保留，可以继续未完成的查询和公司分析。</span><button class="button primary" id="resumeFailedExecutionButton">从检查点继续</button></div>'
      : "");
  elements.agentMessages
    .querySelector("#resumePendingChatButton")
    ?.addEventListener("click", resumePendingChat);
  elements.agentMessages
    .querySelector("#resumeFailedExecutionButton")
    ?.addEventListener("click", resumeFailedExecution);
  elements.agentMessages.scrollTop = elements.agentMessages.scrollHeight;
}

function renderStrategy() {
  const session = orchestratorSession;
  if (!session) {
    elements.strategyEmpty.classList.remove("hidden");
    elements.strategyForm.classList.add("hidden");
    return;
  }
  const strategy = session.strategy;
  elements.strategyEmpty.classList.add("hidden");
  elements.strategyForm.classList.remove("hidden");
  elements.strategyVersion.textContent = `v ${session.strategyVersion} · ${session.strategyHash}`;
  elements.strategyObjective.value = strategy.objective;
  elements.strategyRoles.value = strategy.targetCustomer.businessRoles.join(", ");
  elements.strategyIndustries.value =
    strategy.targetCustomer.industries.join(", ");
  elements.strategyKeywords.value = strategy.search.requiredKeywords.join(", ");
  elements.strategyAlternatives.value =
    strategy.search.alternativeKeywords.join(", ");
  elements.strategyLocalKeywords.value =
    strategy.search.localLanguageKeywords.join(", ");
  elements.strategyCities.value = strategy.search.cities.join(", ");
  elements.strategyExclusions.value = strategy.exclusions.terms.join(", ");
  elements.strategyDomains.value = strategy.exclusions.domains.join(", ");
  elements.strategyMaxQueries.value = strategy.budget.maxQueries;
  elements.strategyResultsPerQuery.value = strategy.budget.resultsPerQuery;
  elements.strategyMaxPages.value = strategy.budget.maxPagesPerCompany;
  elements.strategyCountryScore.value =
    strategy.validation.minimumCountryScore;
  elements.strategyLowYieldDomains.value =
    strategy.budget.lowYieldNewDomains ?? 2;
  elements.strategyLowYieldRate.value = strategy.budget.lowYieldRate ?? 0.02;
  elements.strategyLowYieldRounds.value =
    strategy.budget.consecutiveLowYieldRounds ?? 3;
  elements.customStrategySections.innerHTML = strategy.customSections
    .map(
      (section) =>
        `<article class="custom-strategy-section"><strong>${escapeHtml(section.title)} · ${escapeHtml(section.source)}</strong>` +
        `<p>${escapeHtml(section.content)}</p></article>`,
    )
    .join("");
  const maximumHits =
    strategy.budget.maxQueries * strategy.budget.resultsPerQuery;
  const maximumSerperRequests =
    strategy.budget.maxQueries *
    Math.max(1, Math.ceil(strategy.budget.resultsPerQuery / 10));
  const estimatedModelCalls = 2 + maximumHits;
  elements.strategyBudget.textContent =
    `预算上限：${strategy.budget.maxQueries} 轮查询；含排除词翻页时 Serper 最多 ${maximumSerperRequests} 次 HTTP 请求，最多 ${maximumHits} 个搜索结果，` +
    `官网去重后全部抓取，每站最多 ${strategy.budget.maxPagesPerCompany} 个业务页面，` +
    `最坏约 ${estimatedModelCalls} 次模型调用（实际按去重官网数计算）。` +
    ` 查询将逐轮执行；同组连续 ${strategy.budget.consecutiveLowYieldRounds ?? 3} 轮新增域名不超过 ${strategy.budget.lowYieldNewDomains ?? 2} 或新增率不超过 ${Math.round((strategy.budget.lowYieldRate ?? 0.02) * 100)}% 时停止该组。` +
    ` 当前已预览 ${strategy.search.queries.length} 条查询。`;

  const editable = ["drafting", "awaiting_approval"].includes(session.status);
  elements.strategyForm
    .querySelectorAll("input, textarea")
    .forEach((input) => {
      input.disabled = !editable;
    });
  elements.saveStrategyButton.classList.toggle("hidden", !editable);
  elements.approveStrategyButton.classList.toggle(
    "hidden",
    session.status !== "awaiting_approval",
  );
  elements.executeStrategyButton.classList.toggle(
    "hidden",
    session.status !== "approved",
  );
}

function renderOrchestratorReport() {
  const report = orchestratorSession?.report;
  if (!report) {
    elements.orchestratorReport.classList.add("hidden");
    return;
  }
  const list = (items) =>
    items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  elements.orchestratorReport.classList.remove("hidden");
  elements.orchestratorReport.innerHTML = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">主 Agent 综合报告</p>
        <h2>任务结论与下一步</h2>
      </div>
      ${
        orchestratorSession.status === "awaiting_report_review"
          ? '<button class="button primary" id="confirmOrchestratorReportButton">确认并归档报告</button>'
          : '<span class="status-pill approved">已归档</span>'
      }
    </div>
    <p>${escapeHtml(report.executiveSummary)}</p>
    <div class="orchestrator-report-grid">
      <div><strong>${report.qualificationSummary.qualified}</strong><p>建议触达</p></div>
      <div><strong>${report.qualificationSummary.needsReview}</strong><p>需要复核</p></div>
      <div><strong>${report.searchSummary.hits}</strong><p>搜索命中</p></div>
      <div><strong>${report.searchSummary.executedQueries ?? report.searchSummary.queries}/${report.searchSummary.plannedQueries ?? report.searchSummary.queries}</strong><p>实际/计划查询</p></div>
      <div><strong>${report.searchSummary.deduplicatedCompanies ?? 0}</strong><p>去重企业</p></div>
      <div><strong>${report.searchSummary.analyzed ?? 0}</strong><p>分析成功</p></div>
      <div><strong>${report.searchSummary.countryRejected ?? 0}</strong><p>国家不符</p></div>
      <div><strong>${report.searchSummary.crawlErrors ?? 0}</strong><p>抓取失败</p></div>
      <div><strong>${report.searchSummary.analysisErrors ?? 0}</strong><p>分析失败</p></div>
    </div>
    <p class="report-stop-reason">停止原因：${escapeHtml(stopReasonLabels[report.searchSummary.stopReason] ?? report.searchSummary.stopReason ?? "未记录")}</p>
    <div class="detail-grid">
      <section class="panel"><h3>优势与推荐</h3><ul>${list(report.strengths)}</ul></section>
      <section class="panel"><h3>风险与缺口</h3><ul>${list(report.risks)}</ul></section>
    </div>
    <section class="panel"><h3>建议下一步</h3><ol>${list(report.nextSteps)}</ol></section>
  `;
  elements.orchestratorReport
    .querySelector("#confirmOrchestratorReportButton")
    ?.addEventListener("click", confirmOrchestratorReport);
}

function companyProgressText(currentCampaign) {
  const companies = currentCampaign?.discovery?.companies;
  if (!Array.isArray(companies) || !companies.length) return "";
  const count = (status) =>
    companies.filter((company) => company.status === status).length;
  const crawling = count("crawling");
  const analyzing = count("analyzing");
  const analyzed = count("analyzed");
  const crawlFailed = count("crawl_failed");
  const countryRejected = count("country_rejected");
  const analysisFailed = count("analysis_failed");
  const completed =
    analyzed + crawlFailed + countryRejected + analysisFailed;
  return `已处理 ${completed}/${companies.length} 家；抓取中 ${crawling}，分析中 ${analyzing}，分析成功 ${analyzed}，国家不符 ${countryRejected}，抓取失败 ${crawlFailed}，分析失败 ${analysisFailed}`;
}

function roundProgressHtml(currentCampaign) {
  const discovery = currentCampaign?.discovery;
  const progress = discovery?.progress;
  if (!progress) return "";
  const rounds = discovery.rounds ?? [];
  const currentRound = rounds[rounds.length - 1];
  const maximum = orchestratorSession?.strategy?.budget?.maxQueries ?? "?";
  const group = currentRound
    ? progress.groups?.[currentRound.groupId]
    : undefined;
  const stopReason = progress.stopReason
    ? `<span>停止：${escapeHtml(stopReasonLabels[progress.stopReason] ?? progress.stopReason)}</span>`
    : "";
  return [
    `<span>第 ${progress.executedQueries}/${maximum} 轮</span>`,
    `<span>本轮新增域名 ${currentRound?.newDomainCount ?? 0}</span>`,
    `<span>缓存：搜索 ${currentRound?.cacheHit ? 1 : 0} / 抓取 ${currentRound?.crawlCacheHits ?? 0}</span>`,
    `<span>组内连续低新增 ${group?.consecutiveLowYieldRounds ?? 0}</span>`,
    `<span>累计 seen ${progress.seenDomains?.length ?? 0}</span>`,
    stopReason,
  ].join("");
}

function renderOrchestrator() {
  if (!orchestratorSession) return;
  cacheOrchestratorSession(orchestratorSession);
  elements.orchestratorStatus.textContent = orchestratorStatusLabel(
    orchestratorSession.status,
  );
  elements.agentMessageInput.disabled =
    orchestratorSession.status === "running";
  elements.sendAgentMessageButton.disabled =
    orchestratorSession.status === "running";
  elements.orchestratorProgress.classList.toggle(
    "hidden",
    orchestratorSession.status !== "running",
  );
  if (orchestratorSession.status === "running") {
    const phaseText = {
      planning: "准备已批准的查询计划",
      discovering: "Serper 搜索、Python 抓取与本地验证",
      analyzing: "公司研究、资格复核和触达子 Agent",
      deciding: "保存本轮结果并判断下一查询",
      summarizing: "主 Agent 正在分析各子 Agent 报告",
    };
    const detail = companyProgressText(campaign);
    elements.orchestratorProgressText.textContent = detail
      ? `${phaseText[orchestratorSession.runPhase] ?? "正在处理任务"}。${detail}`
      : phaseText[orchestratorSession.runPhase] ?? "正在处理任务";
    elements.orchestratorRoundProgress.innerHTML = roundProgressHtml(campaign);
  }
  if (orchestratorSession.status === "failed") {
    elements.orchestratorProgress.classList.remove("hidden");
    elements.orchestratorProgressTitle.textContent = "任务执行失败";
    elements.orchestratorProgressText.textContent = orchestratorSession.error;
    elements.orchestratorRoundProgress.innerHTML = roundProgressHtml(campaign);
  } else {
    elements.orchestratorProgressTitle.textContent = "正在执行已确认策略";
  }
  renderOrchestratorMessages();
  renderStrategy();
  renderOrchestratorReport();
}

async function createOrchestratorSession() {
  elements.newOrchestratorButton.disabled = true;
  try {
    const result = await request("/api/orchestrator/sessions", {
      method: "POST",
      body: JSON.stringify(inputPayload()),
    });
    orchestratorSession = result.session;
    orchestratorMessages = result.messages;
    localStorage.setItem("trade-radar-orchestrator", orchestratorSession.id);
    clearInterval(orchestratorPollTimer);
    campaign = undefined;
    activeLeadId = undefined;
    elements.workspace.classList.add("hidden");
    renderOrchestrator();
  } catch (error) {
    window.alert(error.message);
  } finally {
    elements.newOrchestratorButton.disabled = false;
  }
}

async function loadOrchestratorSession(id, options = {}) {
  clearInterval(orchestratorPollTimer);
  try {
    const result = await request(`/api/orchestrator/sessions/${id}`);
    orchestratorSession = result.session;
    orchestratorMessages = result.messages;
    localStorage.setItem("trade-radar-orchestrator", orchestratorSession.id);
    campaign = undefined;
    activeLeadId = undefined;
    elements.workspace.classList.add("hidden");
    renderOrchestrator();
    if (orchestratorSession.status === "running") startOrchestratorPolling();
    if (orchestratorSession.campaignId) {
      try {
        campaign = await request(
          `/api/campaigns/${orchestratorSession.campaignId}`,
        );
        activeLeadId = campaign.leads[0]?.id;
        renderCampaign();
      } catch (error) {
        if (orchestratorSession.status !== "running") throw error;
      }
    }
  } catch (error) {
    orchestratorSessions = orchestratorSessions.filter(
      (session) => session.id !== id,
    );
    renderOrchestratorSessionSelect();
    if (localStorage.getItem("trade-radar-orchestrator") === id) {
      localStorage.removeItem("trade-radar-orchestrator");
    }
    if (!options.silent) window.alert(error.message);
  }
}

async function recoverInterruptedChat(sessionId, content) {
  elements.sendAgentMessageButton.textContent = "等待服务恢复…";
  if (!(await waitForService())) return false;
  try {
    const view = await request(`/api/orchestrator/sessions/${sessionId}`);
    orchestratorSession = view.session;
    orchestratorMessages = view.messages;
    const lastMessage = orchestratorMessages.at(-1);
    if (lastMessage?.role === "user" && lastMessage.content === content) {
      elements.sendAgentMessageButton.textContent = "恢复主 Agent 处理…";
      await request(
        `/api/orchestrator/sessions/${sessionId}/messages/resume`,
        { method: "POST", body: "{}" },
      );
    }
    await loadOrchestratorSession(sessionId, { silent: true });
    clientLog("chat_recovered", {
      sessionId,
      resumedPendingMessage: lastMessage?.role === "user",
    });
    return true;
  } catch (error) {
    clientLog("chat_recovery_failed", {
      sessionId,
      message: error.message,
    });
    return false;
  }
}

async function resumePendingChat(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "正在恢复…";
  chatRequestPending = true;
  try {
    await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/messages/resume`,
      { method: "POST", body: "{}" },
    );
    await loadOrchestratorSession(orchestratorSession.id);
  } catch (error) {
    window.alert(error.message);
    await loadOrchestratorSession(orchestratorSession.id, { silent: true });
  } finally {
    chatRequestPending = false;
    renderOrchestratorMessages();
  }
}

async function resumeFailedExecution(event) {
  const button = event.currentTarget;
  const sessionId = orchestratorSession.id;
  button.disabled = true;
  button.textContent = "正在恢复任务…";
  chatRequestPending = true;
  try {
    await request(
      `/api/orchestrator/sessions/${sessionId}/execute/resume`,
      { method: "POST", body: "{}" },
    );
    await loadOrchestratorSession(sessionId);
  } catch (error) {
    window.alert(error.message);
    await loadOrchestratorSession(sessionId, { silent: true });
  } finally {
    chatRequestPending = false;
    renderOrchestratorMessages();
  }
}

async function sendOrchestratorMessage(event) {
  event.preventDefault();
  if (!orchestratorSession) {
    await createOrchestratorSession();
    return;
  }
  const content = elements.agentMessageInput.value.trim();
  if (!content) return;
  const sessionId = orchestratorSession.id;
  chatRequestPending = true;
  elements.sendAgentMessageButton.disabled = true;
  elements.orchestratorSessionSelect.disabled = true;
  elements.agentMessageInput.value = "";
  orchestratorMessages.push({
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  });
  renderOrchestratorMessages();
  try {
    const result = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    );
    orchestratorSession = result.session;
    orchestratorMessages.push(result.message);
    renderOrchestrator();
  } catch (error) {
    const recovered =
      isFetchFailure(error) &&
      (await recoverInterruptedChat(sessionId, content));
    if (!recovered) {
      window.alert(error.message);
      await loadOrchestratorSession(sessionId);
    }
  } finally {
    chatRequestPending = false;
    elements.sendAgentMessageButton.textContent = "发送给主 Agent";
    elements.sendAgentMessageButton.disabled = false;
    renderOrchestratorSessionSelect();
    renderOrchestratorMessages();
  }
}

function strategyFromForm() {
  const strategy = structuredClone(orchestratorSession.strategy);
  strategy.objective = elements.strategyObjective.value.trim();
  strategy.targetCustomer.businessRoles = csv(elements.strategyRoles.value);
  strategy.targetCustomer.industries = csv(
    elements.strategyIndustries.value,
  );
  strategy.search.requiredKeywords = csv(elements.strategyKeywords.value);
  strategy.search.alternativeKeywords = csv(
    elements.strategyAlternatives.value,
  );
  strategy.search.localLanguageKeywords = csv(
    elements.strategyLocalKeywords.value,
  );
  strategy.search.cities = csv(elements.strategyCities.value);
  strategy.exclusions.terms = csv(elements.strategyExclusions.value);
  strategy.exclusions.domains = csv(elements.strategyDomains.value);
  strategy.budget.maxQueries = Number(elements.strategyMaxQueries.value);
  strategy.budget.resultsPerQuery = Number(
    elements.strategyResultsPerQuery.value,
  );
  strategy.budget.maxPagesPerCompany = Number(
    elements.strategyMaxPages.value,
  );
  strategy.budget.lowYieldNewDomains = Number(
    elements.strategyLowYieldDomains.value,
  );
  strategy.budget.lowYieldRate = Number(elements.strategyLowYieldRate.value);
  strategy.budget.consecutiveLowYieldRounds = Number(
    elements.strategyLowYieldRounds.value,
  );
  strategy.validation.minimumCountryScore = Number(
    elements.strategyCountryScore.value,
  );
  return strategy;
}

async function saveOrchestratorStrategy() {
  try {
    orchestratorSession = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/strategy`,
      {
        method: "PUT",
        body: JSON.stringify({ strategy: strategyFromForm() }),
      },
    );
    renderOrchestrator();
    elements.agentMessageInput.focus();
  } catch (error) {
    window.alert(error.message);
  }
}

async function approveOrchestratorStrategy() {
  try {
    orchestratorSession = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          strategyHash: orchestratorSession.strategyHash,
        }),
      },
    );
    await loadOrchestratorSession(orchestratorSession.id);
  } catch (error) {
    window.alert(error.message);
  }
}

async function executeOrchestratorStrategy() {
  try {
    orchestratorSession = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/execute`,
      { method: "POST", body: "{}" },
    );
    renderOrchestrator();
    startOrchestratorPolling();
  } catch (error) {
    window.alert(error.message);
  }
}

function startOrchestratorPolling() {
  clearInterval(orchestratorPollTimer);
  orchestratorPollTimer = setInterval(async () => {
    if (!orchestratorSession) return;
    try {
      const result = await request(
        `/api/orchestrator/sessions/${orchestratorSession.id}`,
      );
      orchestratorSession = result.session;
      orchestratorMessages = result.messages;
      if (orchestratorSession.campaignId) {
        try {
          campaign = await request(
            `/api/campaigns/${orchestratorSession.campaignId}`,
          );
        } catch {
          campaign = undefined;
        }
      }
      renderOrchestrator();
      if (orchestratorSession.status !== "running") {
        clearInterval(orchestratorPollTimer);
        if (orchestratorSession.campaignId) {
          campaign = await request(
            `/api/campaigns/${orchestratorSession.campaignId}`,
          );
          activeLeadId = campaign.leads[0]?.id;
          renderCampaign();
        }
      }
    } catch {
      clearInterval(orchestratorPollTimer);
    }
  }, 1500);
}

async function confirmOrchestratorReport() {
  try {
    orchestratorSession = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/report/confirm`,
      { method: "POST", body: "{}" },
    );
    await loadOrchestratorSession(orchestratorSession.id);
  } catch (error) {
    window.alert(error.message);
  }
}

function switchPage(pageId) {
  elements.workbenchPage.classList.toggle("hidden", pageId !== "workbenchPage");
  elements.skillsPage.classList.toggle("hidden", pageId !== "skillsPage");
  elements.pageTabs.forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.pageTarget === pageId),
  );
  if (pageId === "skillsPage") loadSkillManagement();
}

function renderSkillCards(skills) {
  elements.skillCards.innerHTML = skills
    .map((skill) => {
      const groups = [
        ["搜索配置", skill.keyInformation.searchConfiguration],
        ["查询策略", skill.keyInformation.queryPatterns],
        ["验证信号", skill.keyInformation.validationSignals],
        ["排除规则", skill.keyInformation.exclusions],
      ]
        .map(
          ([title, items]) =>
            `<div class="skill-group"><h3>${escapeHtml(title)}</h3><ul>${items
              .slice(0, 6)
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul></div>`,
        )
        .join("");
      return `<article class="skill-card">
        <header class="skill-card-header">
          <div>
            <h2>${skill.name === "uae" ? "阿联酋" : "沙特阿拉伯"}</h2>
            <p>${escapeHtml(skill.description)}</p>
          </div>
          <span class="skill-version">v ${escapeHtml(skill.version)}</span>
        </header>
        ${groups}
      </article>`;
    })
    .join("");
}

function renderProposals(proposals) {
  if (!proposals.length) {
    elements.proposalList.innerHTML =
      '<div class="empty-proposals">暂无 Skill 更新提案。完成任务后可让 AI 生成一项改进建议。</div>';
    return;
  }
  const statusText = {
    pending: "待审批",
    approved: "已批准",
    rejected: "已拒绝",
  };
  elements.proposalList.innerHTML = proposals
    .map(
      (proposal) => `<article class="proposal-item" data-proposal-id="${escapeHtml(proposal.id)}">
        <header class="proposal-item-header">
          <div>
            <h3>${escapeHtml(proposal.title)}</h3>
            <p>${proposal.countryId === "uae" ? "阿联酋" : proposal.countryId === "saudi" ? "沙特" : escapeHtml(proposal.countryId)} · ${escapeHtml(proposal.section)}</p>
          </div>
          <span class="status-pill ${escapeHtml(proposal.status)}">${statusText[proposal.status] ?? proposal.status}</span>
        </header>
        <p class="proposal-rationale">${escapeHtml(proposal.rationale)}</p>
        <textarea class="proposal-editor" ${proposal.status !== "pending" ? "disabled" : ""}>${escapeHtml(proposal.proposedContent)}</textarea>
        ${
          proposal.status === "pending"
            ? `<div class="proposal-actions">
                <button class="button secondary" data-proposal-action="save">保存修正</button>
                <button class="button danger" data-proposal-action="reject">拒绝</button>
                <button class="button primary" data-proposal-action="approve">批准并生效</button>
              </div>`
            : ""
        }
      </article>`,
    )
    .join("");

  elements.proposalList
    .querySelectorAll("[data-proposal-action]")
    .forEach((button) => {
      button.addEventListener("click", () => handleProposalAction(button));
    });
}

async function loadSkillManagement() {
  elements.skillMessage.textContent = "正在读取运行时 Skill...";
  try {
    const [skills, proposals] = await Promise.all([
      request("/api/skills"),
      request("/api/skill-proposals"),
    ]);
    renderSkillCards(skills);
    renderProposals(proposals);
    elements.skillMessage.textContent = "";
  } catch (error) {
    elements.skillMessage.textContent = error.message;
  }
}

async function handleProposalAction(button) {
  const item = button.closest("[data-proposal-id]");
  const id = item.dataset.proposalId;
  const action = button.dataset.proposalAction;
  const proposedContent = item.querySelector(".proposal-editor").value;
  button.disabled = true;
  try {
    if (action === "save") {
      await request(`/api/skill-proposals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ proposedContent }),
      });
    } else {
      await request(`/api/skill-proposals/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ proposedContent }),
      });
      await request(`/api/skill-proposals/${id}/${action}`, {
        method: "POST",
        body: "{}",
      });
    }
    await loadSkillManagement();
  } catch (error) {
    elements.skillMessage.textContent = error.message;
    button.disabled = false;
  }
}

async function generateSkillProposal() {
  elements.generateSkillProposalButton.disabled = true;
  elements.skillMessage.textContent = "AI 正在汇总任务并生成一项 Skill 提案...";
  try {
    let campaignId = campaign?.id;
    if (!campaignId) {
      const campaigns = await request("/api/campaigns");
      campaignId = campaigns[0]?.id;
    }
    if (!campaignId) throw new Error("请先完成一次获客任务");
    await request("/api/skill-proposals/generate", {
      method: "POST",
      body: JSON.stringify({ campaignId }),
    });
    await loadSkillManagement();
  } catch (error) {
    elements.skillMessage.textContent = error.message;
  } finally {
    elements.generateSkillProposalButton.disabled = false;
  }
}

elements.runSearchButton.addEventListener("click", () =>
  runAnalysis(
    "/api/campaigns/search",
    {
      ...inputPayload(),
      maxQueries: 3,
      resultsPerQuery: 100,
    },
    "search",
  ),
);

elements.runDemoButton.addEventListener("click", () =>
  runAnalysis("/api/campaigns/demo", inputPayload()),
);

elements.analyzeButton.addEventListener("click", () => {
  const url = elements.companyUrl.value.trim();
  if (!url) {
    elements.companyUrl.focus();
    return;
  }
  runAnalysis(
    "/api/campaigns/analyze",
    {
      ...inputPayload(),
      url,
      enableRegexCleaning: elements.enableRegexCleaning.checked,
    },
    "website",
  );
});

elements.exportJsonButton.addEventListener("click", () =>
  downloadCampaignExport("json", elements.exportJsonButton),
);
elements.exportXlsxButton.addEventListener("click", () =>
  downloadCampaignExport("xlsx", elements.exportXlsxButton),
);

elements.pageTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchPage(tab.dataset.pageTarget));
});
elements.refreshSkillsButton.addEventListener("click", loadSkillManagement);
elements.generateSkillProposalButton.addEventListener(
  "click",
  generateSkillProposal,
);
elements.newOrchestratorButton.addEventListener(
  "click",
  createOrchestratorSession,
);
elements.orchestratorSessionSelect.addEventListener("change", (event) => {
  const sessionId = event.target.value;
  if (sessionId && sessionId !== orchestratorSession?.id) {
    void loadOrchestratorSession(sessionId);
  }
});
elements.agentComposer.addEventListener("submit", sendOrchestratorMessage);
elements.saveStrategyButton.addEventListener(
  "click",
  saveOrchestratorStrategy,
);
elements.approveStrategyButton.addEventListener(
  "click",
  approveOrchestratorStrategy,
);
elements.executeStrategyButton.addEventListener(
  "click",
  executeOrchestratorStrategy,
);

elements.themeToggle.addEventListener("click", () => {
  applyTheme(
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
});

applyTheme(document.documentElement.dataset.theme);

void initializeOrchestratorSessions();

request("/api/health")
  .then((health) => {
    const live = health.agentMode === "live";
    elements.modeBadge.textContent = live
      ? "Production Agent"
      : "离线规则引擎 · 无 API 消耗";
    elements.modeBadge.classList.toggle("live", live);
  })
  .catch(() => {
    elements.modeBadge.textContent = "服务未连接";
  });
