import assert from "node:assert/strict";
import test from "node:test";
import { requireCountry } from "../src/market/registry.js";
import type { CompanyCandidate } from "../src/domain.js";
import { validateContactCandidates } from "../src/validation/contact-validator.js";
import { validateCompanyCountry } from "../src/validation/country-validator.js";

const candidate: CompanyCandidate = {
  id: "candidate-1",
  homepage: "https://example.ae",
  domain: "example.ae",
  searchSnippet: "Industrial distributor",
  pages: [
    {
      url: "https://example.ae/contact",
      title: "Contact",
      text: "Example Trading LLC, Dubai, United Arab Emirates. Sales +971 4 123 4567",
    },
  ],
  contactCandidates: [
    {
      type: "email",
      value: "sales@example.ae",
      sourceUrl: "https://example.ae/contact",
      nearbyText: "Contact our export sales team",
    },
    {
      type: "phone",
      value: "+971 50 123 4567",
      sourceUrl: "https://example.ae/contact",
      nearbyText: "Sales mobile",
    },
  ],
};

test("国家验证组合域名、电话、城市、地址和企业后缀信号", () => {
  const result = validateCompanyCountry(candidate, requireCountry("UAE"));

  assert.equal(result.matched, true);
  assert.equal(result.score, 100);
  assert.deepEqual(
    new Set(result.signals.map((signal) => signal.kind)),
    new Set(["domain", "phone", "city", "address", "business_suffix"]),
  );
});

test("沙特阿语国名可验证，普通英文单词不会误命中 CR 后缀", () => {
  const saudiCandidate: CompanyCandidate = {
    id: "candidate-saudi",
    homepage: "https://example.com",
    domain: "example.com",
    searchSnippet: "",
    pages: [
      {
        url: "https://example.com/contact",
        title: "Contact",
        text: "نخدم جميع مناطق المملكة العربية السعودية",
      },
      {
        url: "https://example.com/about",
        title: "About",
        text: "We create durable industrial products.",
      },
    ],
    contactCandidates: [],
  };

  const result = validateCompanyCountry(
    saudiCandidate,
    requireCountry("Saudi Arabia"),
  );

  assert.equal(result.score, 25);
  assert.deepEqual(result.signals.map((signal) => signal.kind), ["address"]);
});

test("联系人验证检查 MX、官网域名一致性与本地电话号码", async () => {
  const result = await validateContactCandidates(
    candidate,
    requireCountry("UAE"),
    async () => [{ exchange: "mail.example.ae", priority: 10 }],
  );

  assert.equal(result[0]?.syntaxValid, true);
  assert.equal(result[0]?.mxPresent, true);
  assert.equal(result[0]?.sameCompanyDomain, true);
  assert.equal(result[0]?.contextRole, "sales");
  assert.equal(result[0]?.confidence, 1);
  assert.equal(result[1]?.countryFormatValid, true);
  assert.equal(result[1]?.normalizedValue, "+971501234567");
});
