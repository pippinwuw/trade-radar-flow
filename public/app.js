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
  policiesPage: document.querySelector("#policiesPage"),
  policyCards: document.querySelector("#policyCards"),
  proposalList: document.querySelector("#proposalList"),
  policyMessage: document.querySelector("#policyMessage"),
  reviewMarketPolicyButton: document.querySelector(
    "#reviewMarketPolicyButton",
  ),
  refreshPoliciesButton: document.querySelector("#refreshPoliciesButton"),
  newOrchestratorButton: document.querySelector("#newOrchestratorButton"),
  orchestratorSessionSelect: document.querySelector(
    "#orchestratorSessionSelect",
  ),
  orchestratorStatus: document.querySelector("#orchestratorStatus"),
  agentMessages: document.querySelector("#agentMessages"),
  agentActivity: document.querySelector("#agentActivity"),
  agentActivityPhase: document.querySelector("#agentActivityPhase"),
  agentActivityText: document.querySelector("#agentActivityText"),
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
  strategyReportLanguage: document.querySelector("#strategyReportLanguage"),
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
  revokeStrategyApprovalButton: document.querySelector(
    "#revokeStrategyApprovalButton",
  ),
  executeStrategyButton: document.querySelector("#executeStrategyButton"),
  strategyPanel: document.querySelector("#strategyPanel"),
  marketPolicyPanel: document.querySelector("#marketPolicyPanel"),
  marketPolicyEmpty: document.querySelector("#marketPolicyEmpty"),
  marketPolicyForm: document.querySelector("#marketPolicyForm"),
  marketPolicySelect: document.querySelector("#marketPolicySelect"),
  marketPolicyMeta: document.querySelector("#marketPolicyMeta"),
  marketPolicyTabButton: document.querySelector("#marketPolicyTabButton"),
  marketPolicyPanelMessage: document.querySelector(
    "#marketPolicyPanelMessage",
  ),
  mpMarketId: document.querySelector("#mpMarketId"),
  mpDefaultLanguage: document.querySelector("#mpDefaultLanguage"),
  mpLanguages: document.querySelector("#mpLanguages"),
  mpBuyerRoleTerms: document.querySelector("#mpBuyerRoleTerms"),
  mpQueryPatterns: document.querySelector("#mpQueryPatterns"),
  mpTranslationRestrictions: document.querySelector(
    "#mpTranslationRestrictions",
  ),
  mpIdentitySignals: document.querySelector("#mpIdentitySignals"),
  mpBuyerSignals: document.querySelector("#mpBuyerSignals"),
  mpImportSignals: document.querySelector("#mpImportSignals"),
  mpFalsePositives: document.querySelector("#mpFalsePositives"),
  mpExclusions: document.querySelector("#mpExclusions"),
  mpLegalSuffixes: document.querySelector("#mpLegalSuffixes"),
  mpPreferredContacts: document.querySelector("#mpPreferredContacts"),
  mpValidationNotes: document.querySelector("#mpValidationNotes"),
  mpEtiquette: document.querySelector("#mpEtiquette"),
  mpReviewNotes: document.querySelector("#mpReviewNotes"),
  saveMarketPolicyButton: document.querySelector("#saveMarketPolicyButton"),
  reviewMarketPolicyDraftButton: document.querySelector(
    "#reviewMarketPolicyDraftButton",
  ),
  rejectMarketPolicyButton: document.querySelector(
    "#rejectMarketPolicyButton",
  ),
  approveMarketPolicyButton: document.querySelector(
    "#approveMarketPolicyButton",
  ),
  strategyPanelTabs: document.querySelectorAll("[data-strategy-panel]"),
  orchestratorProgress: document.querySelector("#orchestratorProgress"),
  orchestratorProgressTitle: document.querySelector(
    "#orchestratorProgressTitle",
  ),
  orchestratorProgressText: document.querySelector(
    "#orchestratorProgressText",
  ),
  orchestratorPipelineStages: document.querySelector(
    "#orchestratorPipelineStages",
  ),
  orchestratorRoundCard: document.querySelector("#orchestratorRoundCard"),
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
let agentActivityPollTimer;
let statusPollRequestDepth = 0;
let chatRequestPending = false;
let activeStrategyPanel = "strategy";
let sessionMarketPolicies = [];
let activeMarketPolicy = null;
let countryProfiles = [];
let lastFilledMarketPolicyKey = "";

const marketPolicyStatusLabels = {
  draft: "草稿",
  reviewed: "主 Agent 已审阅",
  approved: "已批准",
  superseded: "已替代",
};

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
  const headers = {
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };
  if (statusPollRequestDepth > 0) {
    headers["x-trade-radar-poll"] = "1";
  }
  const response = await fetch(url, {
    ...options,
    headers,
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

async function withStatusPoll(task) {
  statusPollRequestDepth += 1;
  try {
    return await task();
  } finally {
    statusPollRequestDepth -= 1;
  }
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
          "查询规划 Agent 正在加载已批准的 MarketPolicy...",
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

  const reportLanguage =
    orchestratorSession?.strategy?.output?.reportLanguage || "Chinese";
  const marketSearchLanguages = (
    activeMarketPolicy?.searchLocalization?.languages || []
  ).join(", ");
  const outreachLanguage =
    activeMarketPolicy?.contactAndOutreach?.defaultLanguage || "";

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
  const languageMetaParts = [
    `审查报告 <strong>${escapeHtml(reportLanguage)}</strong>`,
  ];
  if (marketSearchLanguages) {
    languageMetaParts.push(
      `市场搜索 <strong>${escapeHtml(marketSearchLanguages)}</strong>`,
    );
  }
  if (outreachLanguage) {
    languageMetaParts.push(
      `客户触达 <strong>${escapeHtml(outreachLanguage)}</strong>`,
    );
  }

  elements.leadDetail.innerHTML = `
    <header class="detail-header">
      <div>
        <p class="eyebrow">Agent 公司简报</p>
        <h2>${escapeHtml(lead.research.canonicalName)}</h2>
        <p>${escapeHtml(lead.outreach.headline)}</p>
        <p class="language-contract-meta">${languageMetaParts.join(" · ")}</p>
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
      <h3>触达草稿${outreachLanguage ? `（${escapeHtml(outreachLanguage)}）` : ""}</h3>
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

function lines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(values) {
  return Array.isArray(values) ? values.join("\n") : "";
}

function joinCsv(values) {
  return Array.isArray(values) ? values.join(", ") : "";
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

const agentActivityPhaseLabels = {
  idle: "空闲",
  thinking: "思考中",
  tool: "工具调用",
  responding: "生成回复",
};

function renderAgentActivity(activity) {
  if (!elements.agentActivity) return;
  const active =
    chatRequestPending && activity && activity.phase && activity.phase !== "idle";
  elements.agentActivity.classList.toggle("hidden", !active);
  if (!active) return;
  const indicator = elements.agentActivity.querySelector(
    ".agent-activity-indicator",
  );
  if (indicator) indicator.dataset.phase = activity.phase;
  elements.agentActivityPhase.textContent =
    agentActivityPhaseLabels[activity.phase] ?? activity.phase;
  elements.agentActivityText.textContent =
    activity.detail || agentActivityPhaseLabels[activity.phase] || "处理中";
}

function stopAgentActivityPolling() {
  if (agentActivityPollTimer) {
    clearInterval(agentActivityPollTimer);
    agentActivityPollTimer = undefined;
  }
  renderAgentActivity({ phase: "idle", detail: "主 Agent 空闲" });
}

function startAgentActivityPolling(sessionId) {
  stopAgentActivityPolling();
  renderAgentActivity({
    phase: "thinking",
    detail: "主 Agent 正在思考…",
  });
  const poll = async () => {
    if (!chatRequestPending || !sessionId) return;
    try {
      const activity = await withStatusPoll(() =>
        request(`/api/orchestrator/sessions/${sessionId}/activity`),
      );
      if (chatRequestPending) renderAgentActivity(activity);
    } catch {
      // Keep the last known activity text if the poll fails mid-turn.
    }
  };
  void poll();
  agentActivityPollTimer = setInterval(poll, 450);
}

function switchStrategyPanel(panelId) {
  activeStrategyPanel = panelId === "marketPolicy" ? "marketPolicy" : "strategy";
  elements.strategyPanelTabs.forEach((tab) => {
    const active = tab.dataset.strategyPanel === activeStrategyPanel;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  elements.strategyPanel.classList.toggle(
    "hidden",
    activeStrategyPanel !== "strategy",
  );
  elements.marketPolicyPanel.classList.toggle(
    "hidden",
    activeStrategyPanel !== "marketPolicy",
  );
  if (activeStrategyPanel === "marketPolicy") {
    void refreshSessionMarketPolicy({ preferPending: true, forceFill: true });
  } else if (orchestratorSession) {
    elements.strategyVersion.textContent = `v ${orchestratorSession.strategyVersion} · ${orchestratorSession.strategyHash}`;
  }
}

function policyOptionLabel(policy) {
  const status =
    marketPolicyStatusLabels[policy.status] ?? policy.status;
  return `${policy.marketId} · v${policy.version} · ${status}`;
}

function pickPreferredMarketPolicy(policies, options = {}) {
  if (!policies.length) return null;
  const ref = orchestratorSession?.strategy?.marketPolicyRef;
  if (ref) {
    const matched = policies.find(
      (policy) =>
        policy.marketId === ref.marketId &&
        (policy.version === ref.version || policy.hash === ref.hash),
    );
    if (matched && !options.preferPending) return matched;
  }
  const pending = policies.filter(
    (policy) => policy.status === "draft" || policy.status === "reviewed",
  );
  if (pending.length) {
    return pending.sort((left, right) =>
      String(right.metadata?.createdAt ?? "").localeCompare(
        String(left.metadata?.createdAt ?? ""),
      ),
    )[0];
  }
  if (ref) {
    const byRef = policies.find(
      (policy) =>
        policy.marketId === ref.marketId && policy.version === ref.version,
    );
    if (byRef) return byRef;
  }
  const country = orchestratorSession?.strategy?.country;
  const profile = countryProfiles.find(
    (item) =>
      item.displayName === country ||
      item.id === country ||
      item.aliases?.includes?.(country),
  );
  if (profile) {
    const approved = policies.find(
      (policy) =>
        policy.marketId === profile.id && policy.status === "approved",
    );
    if (approved) return approved;
  }
  return policies[0] ?? null;
}

function renderMarketPolicySelect() {
  const policies = sessionMarketPolicies;
  if (!policies.length) {
    elements.marketPolicySelect.innerHTML = "";
    return;
  }
  elements.marketPolicySelect.innerHTML = policies
    .map(
      (policy) =>
        `<option value="${escapeHtml(policy.marketId)}::${escapeHtml(policy.version)}">${escapeHtml(policyOptionLabel(policy))}</option>`,
    )
    .join("");
  if (activeMarketPolicy) {
    elements.marketPolicySelect.value = `${activeMarketPolicy.marketId}::${activeMarketPolicy.version}`;
  }
}

function fillMarketPolicyForm(policy) {
  if (!policy) return;
  elements.mpMarketId.value = policy.marketId;
  elements.mpDefaultLanguage.value =
    policy.contactAndOutreach.defaultLanguage ?? "";
  elements.mpLanguages.value = joinCsv(policy.searchLocalization.languages);
  elements.mpBuyerRoleTerms.value = joinCsv(
    policy.searchLocalization.buyerRoleTerms,
  );
  elements.mpQueryPatterns.value = joinLines(
    policy.searchLocalization.queryPatterns,
  );
  elements.mpTranslationRestrictions.value = joinLines(
    policy.searchLocalization.translationRestrictions,
  );
  elements.mpIdentitySignals.value = joinLines(
    policy.companyAnalysis.identitySignals,
  );
  elements.mpBuyerSignals.value = joinLines(
    policy.companyAnalysis.buyerSignals,
  );
  elements.mpImportSignals.value = joinLines(
    policy.companyAnalysis.importAndScaleSignals,
  );
  elements.mpFalsePositives.value = joinLines(
    policy.companyAnalysis.falsePositivePatterns,
  );
  elements.mpExclusions.value = joinLines(policy.companyAnalysis.exclusions);
  elements.mpLegalSuffixes.value = joinLines(
    policy.companyAnalysis.legalSuffixSemantics,
  );
  elements.mpPreferredContacts.value = joinCsv(
    policy.contactAndOutreach.preferredContactTerms,
  );
  elements.mpValidationNotes.value = joinLines(
    policy.contactAndOutreach.validationNotes,
  );
  elements.mpEtiquette.value = joinLines(policy.contactAndOutreach.etiquette);
  elements.mpReviewNotes.value = joinLines(policy.metadata?.reviewNotes ?? []);
  const status =
    marketPolicyStatusLabels[policy.status] ?? policy.status;
  elements.marketPolicyMeta.textContent =
    `${policy.marketId} · v${policy.version} · ${status} · hash ${policy.hash}` +
    (policy.metadata?.source ? ` · 来源 ${policy.metadata.source}` : "");
  const editable =
    policy.status === "draft" || policy.status === "reviewed";
  elements.marketPolicyForm
    .querySelectorAll("input, textarea")
    .forEach((input) => {
      if (input.id === "mpMarketId") {
        input.disabled = true;
        return;
      }
      input.disabled = !editable;
    });
  elements.marketPolicySelect.disabled = false;
  elements.saveMarketPolicyButton.classList.toggle("hidden", !editable);
  elements.reviewMarketPolicyDraftButton.classList.toggle(
    "hidden",
    policy.status !== "draft",
  );
  elements.rejectMarketPolicyButton.classList.toggle(
    "hidden",
    policy.status !== "reviewed",
  );
  elements.approveMarketPolicyButton.classList.toggle(
    "hidden",
    policy.status !== "reviewed",
  );
  if (policy.status === "approved") {
    elements.strategyVersion.textContent =
      activeStrategyPanel === "marketPolicy"
        ? `policy v${policy.version}`
        : elements.strategyVersion.textContent;
  }
}

function marketPolicyFromForm() {
  const current = activeMarketPolicy;
  if (!current) throw new Error("当前没有可保存的 MarketPolicy");
  return {
    schemaVersion: 1,
    marketId: current.marketId,
    searchLocalization: {
      languages: csv(elements.mpLanguages.value),
      buyerRoleTerms: csv(elements.mpBuyerRoleTerms.value),
      queryPatterns: lines(elements.mpQueryPatterns.value),
      translationRestrictions: lines(
        elements.mpTranslationRestrictions.value,
      ),
    },
    companyAnalysis: {
      identitySignals: lines(elements.mpIdentitySignals.value),
      legalSuffixSemantics: lines(elements.mpLegalSuffixes.value),
      buyerSignals: lines(elements.mpBuyerSignals.value),
      importAndScaleSignals: lines(elements.mpImportSignals.value),
      falsePositivePatterns: lines(elements.mpFalsePositives.value),
      exclusions: lines(elements.mpExclusions.value),
    },
    contactAndOutreach: {
      preferredContactTerms: csv(elements.mpPreferredContacts.value),
      validationNotes: lines(elements.mpValidationNotes.value),
      defaultLanguage: elements.mpDefaultLanguage.value.trim() || "English",
      etiquette: lines(elements.mpEtiquette.value),
    },
    metadata: {
      reviewNotes: lines(elements.mpReviewNotes.value),
    },
  };
}

function updateMarketPolicyTabBadge() {
  const pending = sessionMarketPolicies.some(
    (policy) => policy.status === "draft" || policy.status === "reviewed",
  );
  elements.marketPolicyTabButton.dataset.pending = pending ? "true" : "false";
}

async function refreshSessionMarketPolicy(options = {}) {
  try {
    if (!countryProfiles.length) {
      countryProfiles = await request("/api/countries");
    }
    const marketId = orchestratorSession
      ? orchestratorSession.strategy.marketPolicyRef?.marketId ??
        countryProfiles.find(
          (item) =>
            item.displayName === orchestratorSession.strategy.country ||
            item.id === orchestratorSession.strategy.country,
        )?.id
      : undefined;
    const query = marketId
      ? `?marketId=${encodeURIComponent(marketId)}`
      : "";
    let policies = marketId
      ? await request(`/api/market-policies${query}`)
      : [];
    if (!Array.isArray(policies)) policies = [];
    const pendingAll = await request("/api/market-policies");
    const allPolicies = Array.isArray(pendingAll) ? pendingAll : [];
    const extraPending = allPolicies.filter(
      (policy) =>
        (policy.status === "draft" ||
          policy.status === "reviewed" ||
          (!orchestratorSession && policy.status === "approved")) &&
        !policies.some(
          (item) =>
            item.marketId === policy.marketId &&
            item.version === policy.version,
        ),
    );
    const pendingOnly = options.preferPending
      ? allPolicies.filter(
          (policy) =>
            policy.status === "draft" || policy.status === "reviewed",
        )
      : [];
    sessionMarketPolicies = [
      ...policies,
      ...extraPending,
      ...pendingOnly.filter(
        (policy) =>
          !policies.some(
            (item) =>
              item.marketId === policy.marketId &&
              item.version === policy.version,
          ) &&
          !extraPending.some(
            (item) =>
              item.marketId === policy.marketId &&
              item.version === policy.version,
          ),
      ),
    ].sort((left, right) =>
      String(right.metadata?.createdAt ?? "").localeCompare(
        String(left.metadata?.createdAt ?? ""),
      ),
    );
    const previousKey = activeMarketPolicy
      ? `${activeMarketPolicy.marketId}::${activeMarketPolicy.version}`
      : "";
    activeMarketPolicy =
      (options.keepSelection &&
        sessionMarketPolicies.find(
          (policy) =>
            `${policy.marketId}::${policy.version}` === previousKey,
        )) ||
      pickPreferredMarketPolicy(sessionMarketPolicies, options);
    updateMarketPolicyTabBadge();
    if (!activeMarketPolicy) {
      elements.marketPolicyEmpty.classList.remove("hidden");
      elements.marketPolicyForm.classList.add("hidden");
      elements.marketPolicyEmpty.textContent = orchestratorSession
        ? "当前会话尚无 MarketPolicy。向主 Agent 指定未注册国家后，将在此生成可编辑草稿。"
        : "创建会话或切换到新国家后，这里会显示待审阅的 MarketPolicy 草稿。";
      return;
    }
    elements.marketPolicyEmpty.classList.add("hidden");
    elements.marketPolicyForm.classList.remove("hidden");
    renderMarketPolicySelect();
    const nextKey = `${activeMarketPolicy.marketId}::${activeMarketPolicy.version}::${activeMarketPolicy.hash}::${activeMarketPolicy.status}`;
    if (
      options.forceFill ||
      !options.keepSelection ||
      nextKey !== lastFilledMarketPolicyKey
    ) {
      fillMarketPolicyForm(activeMarketPolicy);
      lastFilledMarketPolicyKey = nextKey;
    }
    if (activeStrategyPanel === "marketPolicy") {
      elements.strategyVersion.textContent = `policy v${activeMarketPolicy.version} · ${activeMarketPolicy.hash}`;
    }
    if (
      options.autoSwitch &&
      (activeMarketPolicy.status === "draft" ||
        activeMarketPolicy.status === "reviewed")
    ) {
      activeStrategyPanel = "marketPolicy";
      elements.strategyPanelTabs.forEach((tab) => {
        const active = tab.dataset.strategyPanel === "marketPolicy";
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      elements.strategyPanel.classList.add("hidden");
      elements.marketPolicyPanel.classList.remove("hidden");
    }
  } catch (error) {
    elements.marketPolicyPanelMessage.textContent = error.message;
  }
}

async function selectMarketPolicyFromList() {
  const [marketId, version] = String(elements.marketPolicySelect.value).split(
    "::",
  );
  if (!marketId || !version) return;
  try {
    activeMarketPolicy = await request(
      `/api/market-policies/${encodeURIComponent(marketId)}/${encodeURIComponent(version)}`,
    );
    fillMarketPolicyForm(activeMarketPolicy);
    lastFilledMarketPolicyKey = `${activeMarketPolicy.marketId}::${activeMarketPolicy.version}::${activeMarketPolicy.hash}::${activeMarketPolicy.status}`;
    elements.marketPolicyPanelMessage.textContent = "";
    if (activeStrategyPanel === "marketPolicy") {
      elements.strategyVersion.textContent = `policy v${activeMarketPolicy.version} · ${activeMarketPolicy.hash}`;
    }
  } catch (error) {
    elements.marketPolicyPanelMessage.textContent = error.message;
  }
}

async function saveSessionMarketPolicy() {
  if (!activeMarketPolicy) return;
  elements.saveMarketPolicyButton.disabled = true;
  elements.marketPolicyPanelMessage.textContent = "正在保存 MarketPolicy...";
  try {
    activeMarketPolicy = await request(
      `/api/market-policies/${encodeURIComponent(activeMarketPolicy.marketId)}/${encodeURIComponent(activeMarketPolicy.version)}`,
      {
        method: "PATCH",
        body: JSON.stringify(marketPolicyFromForm()),
      },
    );
    elements.marketPolicyPanelMessage.textContent =
      `已保存为新草稿 v${activeMarketPolicy.version}`;
    await refreshSessionMarketPolicy({ keepSelection: false, preferPending: true });
  } catch (error) {
    elements.marketPolicyPanelMessage.textContent = error.message;
  } finally {
    elements.saveMarketPolicyButton.disabled = false;
  }
}

async function reviewSessionMarketPolicy() {
  if (!activeMarketPolicy) return;
  elements.reviewMarketPolicyDraftButton.disabled = true;
  elements.marketPolicyPanelMessage.textContent = "主 Agent 正在审阅...";
  try {
    activeMarketPolicy = await request(
      `/api/market-policies/${encodeURIComponent(activeMarketPolicy.marketId)}/${encodeURIComponent(activeMarketPolicy.version)}/review`,
      { method: "POST", body: "{}" },
    );
    elements.marketPolicyPanelMessage.textContent = "主 Agent 审阅完成，请用户批准。";
    await refreshSessionMarketPolicy({ preferPending: true });
  } catch (error) {
    elements.marketPolicyPanelMessage.textContent = error.message;
  } finally {
    elements.reviewMarketPolicyDraftButton.disabled = false;
  }
}

async function approveSessionMarketPolicy() {
  if (!activeMarketPolicy) return;
  elements.approveMarketPolicyButton.disabled = true;
  elements.marketPolicyPanelMessage.textContent = "正在批准并生效...";
  try {
    activeMarketPolicy = await request(
      `/api/market-policies/${encodeURIComponent(activeMarketPolicy.marketId)}/${encodeURIComponent(activeMarketPolicy.version)}/approve`,
      { method: "POST", body: "{}" },
    );
    elements.marketPolicyPanelMessage.textContent =
      "已批准。可让主 Agent 重新绑定该国家并预览搜索。";
    if (orchestratorSession) {
      await loadOrchestratorSession(orchestratorSession.id, { silent: true });
    }
    await refreshSessionMarketPolicy();
  } catch (error) {
    elements.marketPolicyPanelMessage.textContent = error.message;
  } finally {
    elements.approveMarketPolicyButton.disabled = false;
  }
}

async function rejectSessionMarketPolicy() {
  if (!activeMarketPolicy) return;
  elements.rejectMarketPolicyButton.disabled = true;
  elements.marketPolicyPanelMessage.textContent = "正在拒绝...";
  try {
    await request(
      `/api/market-policies/${encodeURIComponent(activeMarketPolicy.marketId)}/${encodeURIComponent(activeMarketPolicy.version)}/reject`,
      { method: "POST", body: "{}" },
    );
    elements.marketPolicyPanelMessage.textContent = "已拒绝该版本。";
    await refreshSessionMarketPolicy({ preferPending: true });
  } catch (error) {
    elements.marketPolicyPanelMessage.textContent = error.message;
  } finally {
    elements.rejectMarketPolicyButton.disabled = false;
  }
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
  if (activeStrategyPanel === "strategy") {
    elements.strategyVersion.textContent = `v ${session.strategyVersion} · ${session.strategyHash}`;
  }
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
  const reportLanguage = strategy.output?.reportLanguage || "Chinese";
  if (
    ![...elements.strategyReportLanguage.options].some(
      (option) => option.value === reportLanguage,
    )
  ) {
    const custom = document.createElement("option");
    custom.value = reportLanguage;
    custom.textContent = reportLanguage;
    elements.strategyReportLanguage.append(custom);
  }
  elements.strategyReportLanguage.value = reportLanguage;
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
  const hasQueryPreview = (session.strategy?.search?.queries?.length ?? 0) > 0;
  const canApproveStrategy = editable && hasQueryPreview;
  elements.strategyForm
    .querySelectorAll("input, textarea, select")
    .forEach((input) => {
      input.disabled = !editable;
    });
  elements.saveStrategyButton.classList.toggle("hidden", !editable);
  elements.approveStrategyButton.classList.toggle("hidden", !canApproveStrategy);
  elements.revokeStrategyApprovalButton.classList.toggle(
    "hidden",
    session.status !== "approved",
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
        <p class="eyebrow">主 Agent 综合报告 · ${escapeHtml(orchestratorSession.strategy?.output?.reportLanguage || "Chinese")}</p>
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

function companyStatusCounts(currentCampaign) {
  const companies = currentCampaign?.discovery?.companies;
  if (!Array.isArray(companies) || !companies.length) {
    return {
      total: 0,
      crawling: 0,
      analyzing: 0,
      analyzed: 0,
      crawlFailed: 0,
      countryRejected: 0,
      analysisFailed: 0,
      pending: 0,
      completed: 0,
    };
  }
  const count = (status) =>
    companies.filter((company) => company.status === status).length;
  const crawling = count("crawling");
  const analyzing = count("analyzing");
  const analyzed = count("analyzed");
  const crawlFailed = count("crawl_failed");
  const countryRejected = count("country_rejected");
  const preAnalysisRejected = count("pre_analysis_rejected");
  const analysisFailed = count("analysis_failed");
  const pending = count("pending");
  return {
    total: companies.length,
    crawling,
    analyzing,
    analyzed,
    crawlFailed,
    countryRejected,
    preAnalysisRejected,
    analysisFailed,
    pending,
    completed:
      analyzed +
      crawlFailed +
      countryRejected +
      preAnalysisRejected +
      analysisFailed,
  };
}

function companyProgressText(currentCampaign) {
  const counts = companyStatusCounts(currentCampaign);
  if (!counts.total) return "";
  return `已处理 ${counts.completed}/${counts.total} 家；抓取中 ${counts.crawling}，分析中 ${counts.analyzing}，分析成功 ${counts.analyzed}，国家不符 ${counts.countryRejected}，预筛跳过 ${counts.preAnalysisRejected}，抓取失败 ${counts.crawlFailed}，分析失败 ${counts.analysisFailed}`;
}

function currentDiscoveryRound(currentCampaign) {
  const rounds = currentCampaign?.discovery?.rounds ?? [];
  if (!rounds.length) return undefined;
  return (
    rounds.find((round) => round.status === "analyzing") ??
    rounds[rounds.length - 1]
  );
}

function pipelineStageState(runPhase, stageId) {
  const order = [
    "planning",
    "discovering",
    "analyzing",
    "deciding",
    "summarizing",
  ];
  const currentIndex = order.indexOf(runPhase);
  const stageIndex = order.indexOf(stageId);
  if (currentIndex < 0 || stageIndex < 0) return "";
  if (stageIndex < currentIndex) return "done";
  if (stageIndex === currentIndex) return "current";
  return "";
}

function renderPipelineStages(runPhase) {
  if (!elements.orchestratorPipelineStages) return;
  const stages = [
    ["planning", "准备", "加载已批准查询"],
    ["discovering", "发现", "搜索 / 抓取 / 校验"],
    ["analyzing", "分析", "公司 Agent 尽调"],
    ["deciding", "决策", "轮次饱和判断"],
    ["summarizing", "报告", "主 Agent 复盘"],
  ];
  elements.orchestratorPipelineStages.innerHTML = stages
    .map(([id, title, detail]) => {
      const state = pipelineStageState(runPhase, id);
      return `<li class="pipeline-stage ${state}"><strong>${title}</strong>${detail}</li>`;
    })
    .join("");
}

function roundPhaseLabel(phase) {
  return (
    {
      searching: "Serper 搜索中",
      crawling: "官网抓取与本地校验",
      analyzing: "公司分析中",
      completed: "本轮已完成",
    }[phase] ?? "处理中"
  );
}

function renderPipelineRoundCard(currentCampaign, runPhase) {
  if (!elements.orchestratorRoundCard) return;
  const progress = currentCampaign?.discovery?.progress;
  const maximum = orchestratorSession?.strategy?.budget?.maxQueries ?? "?";
  const currentRound = currentDiscoveryRound(currentCampaign);
  const executed = progress?.executedQueries ?? 0;
  const displayRound = currentRound
    ? currentRound.status === "analyzing"
      ? Math.max(executed + 1, (currentRound.index ?? 0) + 1)
      : executed
    : runPhase === "discovering" || runPhase === "planning"
      ? Math.min(executed + 1, Number(maximum) || executed + 1)
      : executed;
  const counts = companyStatusCounts(currentCampaign);
  const subPhase =
    runPhase === "analyzing"
      ? "analyzing"
      : runPhase === "deciding"
        ? "completed"
        : (currentRound?.phase ??
          (runPhase === "discovering" ? "searching" : undefined));
  const substeps = [
    ["searching", "搜索"],
    ["crawling", "抓取校验"],
    ["analyzing", "分析"],
    ["completed", "收尾"],
  ];
  const substepState = (id) => {
    const order = ["searching", "crawling", "analyzing", "completed"];
    if (!subPhase) return "";
    const currentIndex = order.indexOf(subPhase);
    const stageIndex = order.indexOf(id);
    if (currentIndex < 0 || stageIndex < 0) return "";
    if (stageIndex < currentIndex) return "done";
    if (stageIndex === currentIndex) return "current";
    return "";
  };
  const queryText =
    currentRound?.effectiveQuery?.query ??
    currentRound?.baseQuery?.query ??
    (runPhase === "discovering"
      ? "正在准备本轮查询…"
      : "等待进入发现轮次");
  const crawlDone =
    (currentRound?.crawlSucceeded ?? 0) + (currentRound?.crawlFailed ?? 0);
  const crawlTarget = currentRound?.newDomainCount ?? counts.total;
  elements.orchestratorRoundCard.innerHTML = `
    <strong>第 ${displayRound}/${maximum} 轮 · ${escapeHtml(roundPhaseLabel(subPhase))}</strong>
    <div class="query-line">${escapeHtml(queryText)}</div>
    <div class="pipeline-substeps">
      ${substeps
        .map(
          ([id, label]) =>
            `<span class="pipeline-substep ${substepState(id)}">${label}</span>`,
        )
        .join("")}
    </div>
    <div>
      Serper 命中 ${currentRound?.rawHitCount ?? 0}
      · 新增域名 ${currentRound?.newDomainCount ?? 0}
      · 排除/重复 ${(currentRound?.excludedHitCount ?? 0) + (currentRound?.duplicateDomainCount ?? 0)}
      · 抓取 ${crawlDone}/${crawlTarget || 0}
      · 国家拒绝 ${currentRound?.countryRejected ?? 0}
      · 分析 ${currentRound?.analysisSucceeded ?? counts.analyzed}/${(currentRound?.analysisSucceeded ?? 0) + (currentRound?.analysisFailed ?? 0) || counts.total || 0}
    </div>
  `;
}

function roundProgressHtml(currentCampaign) {
  const discovery = currentCampaign?.discovery;
  const progress = discovery?.progress;
  if (!progress && !orchestratorSession) return "";
  const currentRound = currentDiscoveryRound(currentCampaign);
  const maximum = orchestratorSession?.strategy?.budget?.maxQueries ?? "?";
  const group = currentRound
    ? progress?.groups?.[currentRound.groupId]
    : undefined;
  const counts = companyStatusCounts(currentCampaign);
  const executed = progress?.executedQueries ?? 0;
  const displayRound = currentRound?.status === "analyzing"
    ? Math.max(executed + 1, (currentRound.index ?? 0) + 1)
    : executed || (orchestratorSession?.runPhase === "discovering" ? 1 : 0);
  const stopReason = progress?.stopReason
    ? `<span>停止：${escapeHtml(stopReasonLabels[progress.stopReason] ?? progress.stopReason)}</span>`
    : "";
  return [
    `<span>轮次 ${displayRound}/${maximum}</span>`,
    `<span>子阶段 ${escapeHtml(roundPhaseLabel(currentRound?.phase ?? orchestratorSession?.runPhase))}</span>`,
    `<span>抓取中 ${counts.crawling} / 分析中 ${counts.analyzing}</span>`,
    `<span>缓存：搜索 ${currentRound?.cacheHit ? 1 : 0} / 抓取 ${currentRound?.crawlCacheHits ?? 0}</span>`,
    `<span>组内连续低新增 ${group?.consecutiveLowYieldRounds ?? 0}</span>`,
    `<span>累计 seen ${progress?.seenDomains?.length ?? 0}</span>`,
    stopReason,
  ].join("");
}

function renderExecutionProgress() {
  const running = orchestratorSession?.status === "running";
  const failed = orchestratorSession?.status === "failed";
  elements.orchestratorProgress.classList.toggle("hidden", !running && !failed);
  if (!running && !failed) return;

  const runPhase = orchestratorSession.runPhase;
  renderPipelineStages(failed ? undefined : runPhase);
  renderPipelineRoundCard(campaign, runPhase);

  if (failed) {
    elements.orchestratorProgressTitle.textContent = "任务执行失败";
    elements.orchestratorProgressText.textContent =
      orchestratorSession.error ?? "未知错误";
    elements.orchestratorRoundProgress.innerHTML = roundProgressHtml(campaign);
    return;
  }

  const phaseText = {
    planning: "正在准备已批准的查询计划",
    discovering: "正在搜索、抓取并做本地校验",
    analyzing: "正在运行公司分析 Agent",
    deciding: "正在保存本轮结果并判断是否继续",
    summarizing: "主 Agent 正在汇总报告",
  };
  const detail = companyProgressText(campaign);
  const currentRound = currentDiscoveryRound(campaign);
  const waitingFirstRound =
    runPhase === "discovering" &&
    !currentRound &&
    !(campaign?.discovery?.progress?.executedQueries > 0);
  elements.orchestratorProgressTitle.textContent = "正在执行已确认策略";
  elements.orchestratorProgressText.textContent = waitingFirstRound
    ? "发现阶段已开始：正在发起第 1 轮 Serper 查询…"
    : detail
      ? `${phaseText[runPhase] ?? "正在处理任务"}。${detail}`
      : phaseText[runPhase] ?? "正在处理任务";
  elements.orchestratorRoundProgress.innerHTML = roundProgressHtml(campaign);
}

function renderOrchestrator(options = {}) {
  if (!orchestratorSession) return;
  cacheOrchestratorSession(orchestratorSession);
  elements.orchestratorStatus.textContent = orchestratorStatusLabel(
    orchestratorSession.status,
  );
  elements.agentMessageInput.disabled =
    orchestratorSession.status === "running";
  elements.sendAgentMessageButton.disabled =
    orchestratorSession.status === "running";
  renderExecutionProgress();
  renderOrchestratorMessages();
  renderStrategy();
  if (!options.skipMarketPolicy) {
    void refreshSessionMarketPolicy({ keepSelection: true });
  }
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
    const needsPolicyApproval =
      /MarketPolicy|市场规则包|草稿/.test(error.message ?? "");
    if (needsPolicyApproval) {
      switchStrategyPanel("marketPolicy");
      await refreshSessionMarketPolicy({
        preferPending: true,
        autoSwitch: true,
      });
      elements.marketPolicyPanelMessage.textContent = error.message;
    }
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
  startAgentActivityPolling(orchestratorSession.id);
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
    stopAgentActivityPolling();
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
  startAgentActivityPolling(sessionId);
  try {
    const result = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    );
    orchestratorSession = result.session;
    orchestratorMessages.push(result.message);
    renderOrchestrator();
    await refreshSessionMarketPolicy({
      preferPending: true,
      autoSwitch: /MarketPolicy|市场规则包|等待用户批准|尚未注册/.test(
        result.message?.content ?? "",
      ),
    });
  } catch (error) {
    const recovered =
      isFetchFailure(error) &&
      (await recoverInterruptedChat(sessionId, content));
    if (!recovered) {
      window.alert(error.message);
      await loadOrchestratorSession(sessionId);
      if (/MarketPolicy|市场规则包|草稿|批准/.test(error.message ?? "")) {
        switchStrategyPanel("marketPolicy");
        await refreshSessionMarketPolicy({
          preferPending: true,
          autoSwitch: true,
        });
        elements.marketPolicyPanelMessage.textContent = error.message;
      }
    }
  } finally {
    chatRequestPending = false;
    stopAgentActivityPolling();
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
  strategy.output = {
    ...(strategy.output || {}),
    reportLanguage:
      elements.strategyReportLanguage.value.trim() || "Chinese",
  };
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

async function revokeOrchestratorStrategyApproval() {
  if (
    !window.confirm(
      "撤回后将回到“等待确认”状态，可继续修改策略并重新确认。尚未开始执行，确定撤回吗？",
    )
  ) {
    return;
  }
  try {
    orchestratorSession = await request(
      `/api/orchestrator/sessions/${orchestratorSession.id}/approve/revoke`,
      { method: "POST", body: "{}" },
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
  orchestratorPollTimer = setInterval(() => {
    void withStatusPoll(async () => {
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
        renderOrchestrator({ skipMarketPolicy: true });
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
    });
  }, 800);
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
  elements.policiesPage.classList.toggle("hidden", pageId !== "policiesPage");
  elements.pageTabs.forEach((tab) =>
    tab.classList.toggle("active", tab.dataset.pageTarget === pageId),
  );
  if (pageId === "policiesPage") loadMarketPolicyManagement();
}

function policyGroups(policy) {
  return [
    ["搜索本地化", [...policy.searchLocalization.languages, ...policy.searchLocalization.buyerRoleTerms, ...policy.searchLocalization.queryPatterns]],
    ["公司分析", [...policy.companyAnalysis.identitySignals, ...policy.companyAnalysis.buyerSignals, ...policy.companyAnalysis.importAndScaleSignals]],
    ["联系与触达", [...policy.contactAndOutreach.preferredContactTerms, ...policy.contactAndOutreach.validationNotes, ...policy.contactAndOutreach.etiquette]],
    ["排除与误判", [...policy.companyAnalysis.falsePositivePatterns, ...policy.companyAnalysis.exclusions]],
  ];
}

function renderPolicyCards(policies) {
  elements.policyCards.innerHTML = policies
    .filter((policy) => policy.status === "approved")
    .map((policy) => {
      const groups = policyGroups(policy).map(
        ([title, items]) =>
          `<div class="policy-group"><h3>${escapeHtml(title)}</h3><ul>${items.slice(0, 6).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`,
      ).join("");
      return `<article class="policy-card">
        <header class="policy-card-header">
          <div><h2>${escapeHtml(policy.marketId)}</h2><p>已批准 · ${escapeHtml(policy.metadata.source)}</p></div>
          <span class="policy-version">v ${escapeHtml(policy.version)}</span>
        </header>
        ${groups}
      </article>`;
    }).join("");
}

function renderProposals(policies) {
  const pending = policies.filter((policy) => policy.status !== "approved");
  if (!pending.length) {
    elements.proposalList.innerHTML = '<div class="empty-proposals">暂无待处理 MarketPolicy 版本。</div>';
    return;
  }
  const statusText = { draft: "草稿", reviewed: "主 Agent 已审阅", superseded: "已替代" };
  elements.proposalList.innerHTML = pending.map(
    (policy) => `<article class="proposal-item" data-market-id="${escapeHtml(policy.marketId)}" data-policy-version="${escapeHtml(policy.version)}">
      <header class="proposal-item-header"><div>
        <h3>${escapeHtml(policy.marketId)} · v ${escapeHtml(policy.version)}</h3>
        <p>${escapeHtml(policy.metadata.source)} · ${escapeHtml(statusText[policy.status] ?? policy.status)}</p>
      </div><span class="status-pill ${escapeHtml(policy.status)}">${escapeHtml(statusText[policy.status] ?? policy.status)}</span></header>
      <p class="proposal-rationale">${escapeHtml((policy.metadata.reviewNotes || []).join("；") || "等待主 Agent 审阅")}</p>
      ${policy.status === "draft"
        ? '<div class="proposal-actions"><button class="button secondary" data-policy-action="review">请求主 Agent 审阅</button></div>'
        : policy.status === "reviewed"
          ? '<div class="proposal-actions"><button class="button danger" data-policy-action="reject">拒绝</button><button class="button primary" data-policy-action="approve">用户批准并生效</button></div>'
          : ""}
    </article>`,
  ).join("");
  elements.proposalList.querySelectorAll("[data-policy-action]").forEach((button) => {
    button.addEventListener("click", () => handleMarketPolicyAction(button));
  });
}

async function loadMarketPolicyManagement() {
  elements.policyMessage.textContent = "正在读取 MarketPolicy 外部版本...";
  try {
    const policies = await request("/api/market-policies");
    renderPolicyCards(policies);
    renderProposals(policies);
    elements.policyMessage.textContent = "";
  } catch (error) {
    elements.policyMessage.textContent = error.message;
  }
}

async function handleMarketPolicyAction(button) {
  const item = button.closest("[data-market-id]");
  const marketId = item.dataset.marketId;
  const version = item.dataset.policyVersion;
  const action = button.dataset.policyAction;
  button.disabled = true;
  try {
    await request(
      `/api/market-policies/${encodeURIComponent(marketId)}/${encodeURIComponent(version)}/${action}`,
      { method: "POST", body: "{}" },
    );
    await loadMarketPolicyManagement();
  } catch (error) {
    elements.policyMessage.textContent = error.message;
    button.disabled = false;
  }
}

async function reviewPendingMarketPolicy() {
  elements.reviewMarketPolicyButton.disabled = true;
  elements.policyMessage.textContent = "正在查找待审阅 MarketPolicy...";
  try {
    const policies = await request("/api/market-policies");
    const draft = policies.find((policy) => policy.status === "draft");
    if (!draft) throw new Error("当前没有等待主 Agent 审阅的草稿");
    await request(
      `/api/market-policies/${encodeURIComponent(draft.marketId)}/${encodeURIComponent(draft.version)}/review`,
      { method: "POST", body: "{}" },
    );
    await loadMarketPolicyManagement();
  } catch (error) {
    elements.policyMessage.textContent = error.message;
  } finally {
    elements.reviewMarketPolicyButton.disabled = false;
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
elements.refreshPoliciesButton.addEventListener("click", loadMarketPolicyManagement);
elements.reviewMarketPolicyButton.addEventListener(
  "click",
  reviewPendingMarketPolicy,
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
elements.revokeStrategyApprovalButton.addEventListener(
  "click",
  revokeOrchestratorStrategyApproval,
);
elements.executeStrategyButton.addEventListener(
  "click",
  executeOrchestratorStrategy,
);
elements.strategyPanelTabs.forEach((tab) => {
  tab.addEventListener("click", () =>
    switchStrategyPanel(tab.dataset.strategyPanel),
  );
});
elements.marketPolicySelect.addEventListener(
  "change",
  selectMarketPolicyFromList,
);
elements.saveMarketPolicyButton.addEventListener(
  "click",
  saveSessionMarketPolicy,
);
elements.reviewMarketPolicyDraftButton.addEventListener(
  "click",
  reviewSessionMarketPolicy,
);
elements.approveMarketPolicyButton.addEventListener(
  "click",
  approveSessionMarketPolicy,
);
elements.rejectMarketPolicyButton.addEventListener(
  "click",
  rejectSessionMarketPolicy,
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
