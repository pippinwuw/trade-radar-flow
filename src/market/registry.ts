import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  CountryProfile,
  SupportedCountryId,
} from "../domain.js";
import { marketPolicyDataDirectory } from "./policy.js";

const profiles = new Map<SupportedCountryId, CountryProfile>();

const aliasIndex = new Map<string, CountryProfile>();
function indexProfile(profile: CountryProfile): void {
  aliasIndex.set(profile.id, profile);
  aliasIndex.set(profile.displayName.toLowerCase(), profile);
  aliasIndex.set(profile.shortName.toLowerCase(), profile);
  for (const alias of profile.aliases) {
    aliasIndex.set(alias.trim().toLowerCase(), profile);
  }
}

export function registerCountryProfile(profile: CountryProfile): CountryProfile {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(profile.id)) {
    throw new Error("国家 ID 必须是 2-40 位小写字母、数字或连字符");
  }
  if (!/^[a-z]{2}$/.test(profile.gl)) {
    throw new Error("Serper gl 必须是两位小写国家代码");
  }
  if (!/^[A-Z]{2}$/.test(profile.phoneCountryCode)) {
    throw new Error("电话国家代码必须是两位大写 ISO 代码");
  }
  if (
    !profile.displayName.trim() ||
    !profile.shortName.trim() ||
    !profile.location.trim() ||
    !profile.googleDomain.trim() ||
    !profile.cities.some((city) => city.trim())
  ) {
    throw new Error("国家配置缺少名称、位置、Google 域名或主要城市");
  }
  if (!/^\+[0-9]{1,4}$/.test(profile.callingCode)) {
    throw new Error("国际电话区号格式无效");
  }
  if (!/^\.[a-z0-9.-]+$/i.test(profile.domainSuffix)) {
    throw new Error("国家域名后缀格式无效");
  }
  const normalized: CountryProfile = {
    ...profile,
    displayName: profile.displayName.trim(),
    shortName: profile.shortName.trim(),
    aliases: [...new Set([
      profile.id,
      profile.displayName,
      profile.shortName,
      ...profile.aliases,
    ].map((value) => value.trim()).filter(Boolean))],
    countryNameAliases: [
      ...new Set(
        (profile.countryNameAliases ?? [profile.displayName, profile.shortName])
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
    cities: [...new Set(profile.cities.map((value) => value.trim()).filter(Boolean))],
    businessSuffixes: [
      ...new Set(
        profile.businessSuffixes.map((value) => value.trim()).filter(Boolean),
      ),
    ],
  };
  profiles.set(normalized.id, normalized);
  indexProfile(normalized);
  return normalized;
}

function loadProfilesFrom(directory: string, strict = false): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = path.join(directory, entry.name, "profile.json");
    if (!existsSync(profilePath)) continue;
    try {
      const profile = JSON.parse(
        readFileSync(profilePath, "utf8"),
      ) as CountryProfile;
      registerCountryProfile(profile);
    } catch (error) {
      if (strict) {
        throw new Error(
          `外部 CountryProfile 无效：${profilePath}`,
          { cause: error },
        );
      }
      // Invalid generated profiles are ignored; pipeline will report unsupported country.
    }
  }
}

loadProfilesFrom(path.join(process.cwd(), "market-policies"), true);
loadProfilesFrom(
  path.join(marketPolicyDataDirectory(), "profiles"),
);
// Read-only compatibility for profiles created before MarketPolicy migration.
loadProfilesFrom(
  path.join(process.cwd(), "data", "generated-market-skills"),
);

export function listCountryProfiles(): CountryProfile[] {
  return [...profiles.values()];
}

export function getCountryProfile(id: SupportedCountryId): CountryProfile {
  const profile = profiles.get(id);
  if (!profile) throw new Error(`缺少国家配置：${id}`);
  return profile;
}

export function resolveCountry(input: string): CountryProfile | undefined {
  return aliasIndex.get(input.trim().toLowerCase());
}

export function requireCountry(input: string): CountryProfile {
  const country = resolveCountry(input);
  if (!country) {
    throw new Error(
      `国家“${input}”尚未注册；请先生成该国家的 MarketPolicy 草稿`,
    );
  }
  return country;
}
