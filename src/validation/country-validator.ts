import type {
  CompanyCandidate,
  CountryProfile,
  CountryValidation,
} from "../domain.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  if (!term.trim()) return false;
  if (/[^\x00-\x7f]/u.test(term)) {
    return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
  }
  return new RegExp(
    `(?:^|[^A-Za-z0-9])${escapeRegExp(term)}(?=$|[^A-Za-z0-9])`,
    "i",
  ).test(text);
}

export function validateCompanyCountry(
  candidate: CompanyCandidate,
  country: CountryProfile,
): CountryValidation {
  const signals: CountryValidation["signals"] = [];
  const pageText = candidate.pages
    .map((page) => `${page.url}\n${page.text}`)
    .join("\n");
  const domain = candidate.domain.toLowerCase();

  if (domain.endsWith(country.domainSuffix)) {
    signals.push({
      kind: "domain",
      value: `${country.domainSuffix} 国家域名`,
      sourceUrl: candidate.homepage,
    });
  }

  for (const contact of candidate.contactCandidates) {
    if (
      contact.type !== "email" &&
      contact.value.replace(/\s+/g, "").startsWith(country.callingCode)
    ) {
      signals.push({
        kind: "phone",
        value: `${country.callingCode} 国家码`,
        sourceUrl: contact.sourceUrl,
      });
      break;
    }
  }

  for (const city of country.cities) {
    if (containsTerm(pageText, city)) {
      signals.push({
        kind: "city",
        value: city,
        sourceUrl: candidate.pages.find((page) =>
          containsTerm(page.text, city),
        )?.url,
      });
      break;
    }
  }

  const countryName = (
    country.countryNameAliases ?? [country.displayName, country.shortName]
  ).find((name) => containsTerm(pageText, name));
  if (countryName) {
    signals.push({
      kind: "address",
      value: countryName,
      sourceUrl: candidate.pages.find((page) =>
        containsTerm(page.text, countryName),
      )?.url,
    });
  }

  for (const suffix of country.businessSuffixes) {
    if (containsTerm(pageText, suffix)) {
      signals.push({
        kind: "business_suffix",
        value: suffix,
        sourceUrl: candidate.pages.find((page) =>
          containsTerm(page.text, suffix),
        )?.url,
      });
      break;
    }
  }

  const weights: Record<CountryValidation["signals"][number]["kind"], number> =
    {
      domain: 25,
      phone: 25,
      address: 25,
      city: 20,
      business_suffix: 15,
    };
  const score = Math.min(
    100,
    signals.reduce((sum, signal) => sum + weights[signal.kind], 0),
  );
  return {
    countryId: country.id,
    score,
    matched: score >= 35,
    signals,
    warnings:
      score >= 35
        ? []
        : [`官网公开信息不足以确认属于 ${country.displayName}`],
  };
}
