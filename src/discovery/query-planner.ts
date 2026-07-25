import type { AgentRuntime, CampaignAgentContext } from "../agents/agent-runtime.js";
import { requireCountry } from "../market/registry.js";
import type { CampaignInput, CampaignStrategy } from "../domain.js";
import {
  getApprovedMarketPolicy,
  getMarketPolicy,
} from "../market/policy.js";

export async function buildCampaignAgentContext(
  input: CampaignInput,
  strategy?: CampaignStrategy,
): Promise<CampaignAgentContext> {
  const country = requireCountry(input.country);
  const marketPolicy = strategy?.marketPolicyRef
    ? getMarketPolicy(
        strategy.marketPolicyRef.marketId,
        strategy.marketPolicyRef.version,
      )
    : getApprovedMarketPolicy(country.id);
  if (
    marketPolicy.status !== "approved" ||
    marketPolicy.marketId !== country.id
  ) {
    throw new Error(
      `策略国家 ${country.id} 未绑定已批准的市场规则包`,
    );
  }
  return {
    input: {
      ...input,
      country: country.displayName,
    },
    strategy,
    country,
    marketPolicy,
  };
}

export async function planCampaignSearch(
  input: CampaignInput,
  runtime: AgentRuntime,
): Promise<{
  context: CampaignAgentContext;
  plan: Awaited<ReturnType<AgentRuntime["planSearch"]>>;
}> {
  const context = await buildCampaignAgentContext(input);
  const plan = await runtime.planSearch(
    context.input,
    context.country,
    context.marketPolicy,
    context,
  );
  return { context, plan };
}
