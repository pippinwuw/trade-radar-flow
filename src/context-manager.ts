import { createHash } from "node:crypto";
import type {
  AgentUsage,
  ContextSectionTrace,
  MarketPolicy,
} from "./domain.js";

export type ContextTrust =
  | "system"
  | "approved"
  | "runtime"
  | "untrusted";
export type ContextPriority = "required" | "high" | "normal" | "optional";

export interface ContextSection {
  id: string;
  source: string;
  content: string;
  version?: string;
  trust: ContextTrust;
  priority: ContextPriority;
  allowTruncate?: boolean;
}

export interface ContextEnvelope {
  content: string;
  sections: ContextSectionTrace[];
  budget: {
    contextWindow: number;
    outputReserve: number;
    safetyMargin: number;
    estimatedInputTokens: number;
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * The providers expose actual usage after a request. Preflight intentionally
 * uses a conservative tokenizer-independent estimate so it remains available
 * for every configured model.
 */
export function estimateTokens(value: string): number {
  if (!value) return 0;
  const ascii = value.replace(/[^\x00-\x7f]/g, "").length;
  const nonAscii = value.length - ascii;
  return Math.ceil(ascii / 3.5 + nonAscii / 1.5);
}

export function compileContext(
  sections: readonly ContextSection[],
  options: {
    contextWindow: number;
    modelMaxTokens: number;
    outputReserve?: number;
    safetyRatio?: number;
  },
): ContextEnvelope {
  const safetyMargin = Math.ceil(
    options.contextWindow * (options.safetyRatio ?? 0.1),
  );
  const outputReserve = Math.min(
    options.outputReserve ?? 8_192,
    options.modelMaxTokens,
  );
  const inputBudget = Math.max(
    1,
    options.contextWindow - outputReserve - safetyMargin,
  );
  let used = 0;
  const included: string[] = [];
  const traces: ContextSectionTrace[] = [];

  for (const section of sections) {
    const estimated = estimateTokens(section.content);
    const remaining = inputBudget - used;
    let content = section.content;
    let isIncluded = true;
    let truncated = false;
    let reason: string | undefined;

    if (estimated > remaining) {
      if (section.allowTruncate && remaining > 32) {
        const ratio = remaining / estimated;
        content = section.content.slice(
          0,
          Math.max(0, Math.floor(section.content.length * ratio * 0.9)),
        );
        truncated = true;
        reason = "context_budget";
      } else if (section.priority === "optional") {
        isIncluded = false;
        content = "";
        reason = "context_budget";
      } else {
        throw new Error(
          `上下文分区 ${section.id} 超出模型窗口：需要约 ${estimated} tokens，剩余 ${Math.max(0, remaining)}`,
        );
      }
    }

    const finalTokens = isIncluded ? estimateTokens(content) : 0;
    used += finalTokens;
    if (isIncluded) {
      included.push(
        `<!-- context:${section.id} source:${section.source} trust:${section.trust}${section.version ? ` version:${section.version}` : ""} -->\n${content}`,
      );
    }
    traces.push({
      id: section.id,
      source: section.source,
      version: section.version,
      trust: section.trust,
      priority: section.priority,
      estimatedTokens: finalTokens,
      included: isIncluded,
      truncated: truncated || undefined,
      reason,
      contentHash: sha256(content),
    });
  }

  return {
    content: included.join("\n\n"),
    sections: traces,
    budget: {
      contextWindow: options.contextWindow,
      outputReserve,
      safetyMargin,
      estimatedInputTokens: used,
    },
  };
}

export function marketPolicyProjection(
  policy: MarketPolicy,
  view: "orchestrator" | "search" | "company",
): string {
  if (policy.status !== "approved") {
    throw new Error(
      `市场规则包 ${policy.marketId}@${policy.version} 尚未获用户批准`,
    );
  }
  const projection =
    view === "search"
      ? {
          marketId: policy.marketId,
          searchLocalization: policy.searchLocalization,
        }
      : view === "company"
        ? {
            marketId: policy.marketId,
            companyAnalysis: policy.companyAnalysis,
            contactAndOutreach: policy.contactAndOutreach,
          }
        : {
            marketId: policy.marketId,
            version: policy.version,
            searchLocalization: policy.searchLocalization,
            companyAnalysis: policy.companyAnalysis,
            contactAndOutreach: policy.contactAndOutreach,
            reviewNotes: policy.metadata.reviewNotes,
          };
  return JSON.stringify(projection);
}

export function readUsageFromMessages(messages: readonly unknown[]): AgentUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let cost = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const usage = (message as { usage?: unknown }).usage;
    if (!usage || typeof usage !== "object") continue;
    const value = usage as Record<string, unknown>;
    inputTokens += Number(value.input ?? 0);
    outputTokens += Number(value.output ?? 0);
    cacheReadTokens += Number(value.cacheRead ?? 0);
    cacheWriteTokens += Number(value.cacheWrite ?? 0);
    const usageCost = value.cost;
    if (usageCost && typeof usageCost === "object") {
      cost += Number((usageCost as Record<string, unknown>).total ?? 0);
    }
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens:
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    cost,
  };
}
