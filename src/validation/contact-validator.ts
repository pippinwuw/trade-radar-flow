import { resolveMx } from "node:dns/promises";
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { getDomain } from "tldts";
import type {
  CompanyCandidate,
  ContactCandidate,
  ContactValidation,
  CountryProfile,
} from "../domain.js";

type ResolveMx = typeof resolveMx;

function contextRole(candidate: ContactCandidate): ContactValidation["contextRole"] {
  const value = `${candidate.value} ${candidate.nearbyText ?? ""}`.toLowerCase();
  if (/sales|trade|commercial|export|wholesale/.test(value)) return "sales";
  if (/help|support|service/.test(value)) return "support";
  if (/info|contact|office|general/.test(value)) return "general";
  return "unknown";
}

function confidence(parts: Array<[boolean | undefined, number]>): number {
  return Math.min(
    1,
    parts.reduce((sum, [matched, weight]) => sum + (matched ? weight : 0), 0),
  );
}

export async function validateContactCandidates(
  candidate: CompanyCandidate,
  country: CountryProfile,
  resolveMxFn: ResolveMx = resolveMx,
): Promise<ContactValidation[]> {
  const companyDomain = getDomain(candidate.domain) ?? candidate.domain;
  const mxCache = new Map<string, boolean>();
  const results: ContactValidation[] = [];

  for (const contact of candidate.contactCandidates) {
    const role = contextRole(contact);
    if (contact.type === "email") {
      const match = contact.value.match(
        /^([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})$/i,
      );
      const emailDomain = match?.[2]?.toLowerCase();
      const syntaxValid = Boolean(emailDomain);
      let mxPresent = false;
      if (emailDomain) {
        const cached = mxCache.get(emailDomain);
        if (cached !== undefined) {
          mxPresent = cached;
        } else {
          try {
            mxPresent = (await resolveMxFn(emailDomain)).length > 0;
          } catch {
            mxPresent = false;
          }
          mxCache.set(emailDomain, mxPresent);
        }
      }
      const sameCompanyDomain = emailDomain
        ? (getDomain(emailDomain) ?? emailDomain) === companyDomain
        : false;
      const score = confidence([
        [syntaxValid, 0.25],
        [mxPresent, 0.25],
        [sameCompanyDomain, 0.35],
        [role === "sales", 0.15],
      ]);
      const notes = [
        syntaxValid ? "邮箱格式有效" : "邮箱格式无效",
        mxPresent ? "域名存在 MX 记录" : "未发现 MX 记录",
        sameCompanyDomain ? "邮箱域名与官网一致" : "邮箱域名与官网不一致",
        "本地验证不代表邮箱一定可投递",
      ];
      results.push({
        value: contact.value,
        syntaxValid,
        mxPresent,
        sameCompanyDomain,
        contextRole: role,
        confidence: score,
        notes,
      });
      continue;
    }

    const phone = parsePhoneNumberFromString(
      contact.value,
      country.phoneCountryCode as CountryCode,
    );
    const countryFormatValid =
      Boolean(phone?.isValid()) && phone?.country === country.phoneCountryCode;
    const normalizedValue = phone?.number;
    results.push({
      value: contact.value,
      syntaxValid: Boolean(phone),
      countryFormatValid,
      normalizedValue,
      contextRole: role,
      confidence: confidence([
        [Boolean(phone), 0.25],
        [countryFormatValid, 0.55],
        [role === "sales" || contact.type === "whatsapp", 0.2],
      ]),
      notes: [
        countryFormatValid
          ? `号码符合 ${country.shortName} 格式`
          : `号码与 ${country.shortName} 格式不一致`,
      ],
    });
  }
  return results;
}
