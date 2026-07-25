import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CountryProfile, MarketPolicy } from "../domain.js";
import {
  registerCountryProfile,
  resolveCountry,
} from "./registry.js";
import { logger } from "../logging/logger.js";
import {
  createGeneratedMarketPolicy,
  marketPolicyDataDirectory,
} from "./policy.js";

export interface RuntimeMarketCountryInput extends CountryProfile {
  queryPatterns: string[];
  validationSignals: string[];
  exclusions: string[];
}

type PreparedRuntimeMarket = {
  profile: CountryProfile;
  marketPolicy: MarketPolicy;
};

const pendingMarkets = new Map<string, Promise<PreparedRuntimeMarket>>();


async function createRuntimeMarketCountry(
  input: RuntimeMarketCountryInput,
): Promise<PreparedRuntimeMarket> {
  const existing = resolveCountry(input.id) ?? resolveCountry(input.displayName);
  if (existing) {
    const marketPolicy = createGeneratedMarketPolicy(existing, input);
    return { profile: existing, marketPolicy };
  }

  const profile = registerCountryProfile({
    id: input.id,
    displayName: input.displayName,
    shortName: input.shortName,
    aliases: input.aliases,
    gl: input.gl,
    defaultHl: input.defaultHl,
    googleDomain: input.googleDomain,
    location: input.location,
    cities: input.cities,
    phoneCountryCode: input.phoneCountryCode,
    callingCode: input.callingCode,
    domainSuffix: input.domainSuffix,
    businessSuffixes: input.businessSuffixes,
  });
  const directory = path.join(
    marketPolicyDataDirectory(),
    "profiles",
    profile.id,
  );
  await mkdir(directory, { recursive: true });
  const profilePath = path.join(directory, "profile.json");
  const temporaryProfile = `${profilePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryProfile, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await rename(temporaryProfile, profilePath);
  const marketPolicy = createGeneratedMarketPolicy(profile, input);
  logger.info("market_policy.runtime_market.created", undefined, {
    countryId: profile.id,
    displayName: profile.displayName,
    marketPolicyVersion: marketPolicy.version,
    cityCount: profile.cities.length,
  });
  return { profile, marketPolicy };
}

export async function ensureRuntimeMarketCountry(
  input: RuntimeMarketCountryInput,
): Promise<PreparedRuntimeMarket> {
  const key = input.id.trim().toLowerCase();
  const pending = pendingMarkets.get(key);
  if (pending) return pending;
  const creation = createRuntimeMarketCountry(input);
  pendingMarkets.set(key, creation);
  try {
    return await creation;
  } finally {
    if (pendingMarkets.get(key) === creation) pendingMarkets.delete(key);
  }
}
