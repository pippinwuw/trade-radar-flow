import type { AgentRuntime, CampaignAgentContext } from "../agent-runtime.js";
import { requireCountry } from "../countries/registry.js";
import type { CampaignInput, CampaignStrategy } from "../domain.js";
import { getMarketSkillRegistry } from "../agent-skills/registry.js";

export async function buildCampaignAgentContext(
  input: CampaignInput,
  strategy?: CampaignStrategy,
): Promise<CampaignAgentContext> {
  const country = requireCountry(input.country);
  const registry = await getMarketSkillRegistry();
  const skill = registry.getSummary(country.id);
  return {
    input: {
      ...input,
      country: country.displayName,
    },
    strategy,
    country,
    skill,
    skillInvocation: registry.invocation(
      country.id,
      `当前产品：${input.product}\n首选语言：${input.language}`,
    ),
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
    context.skill,
    context.skillInvocation,
    context,
  );
  return { context, plan };
}
