import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import type { ContactCandidate, PageSnapshot } from "../domain.js";

type HtmlDocument = ReturnType<typeof load>;

const PAGE_HINT =
  /about|company|profile|history|product|catalog(?:ue)?|contact|who-we-are|what-we-do|solution|service|industr(?:y|ies)|capabilit|market|brand|location|branch|team|distribution|export|import/i;

const PAGE_PRIORITIES: ReadonlyArray<readonly [RegExp, number]> = [
  [/contact|location|branch/i, 100],
  [/about|company|profile|who-we-are|history/i, 95],
  [/product|catalog(?:ue)?|brand/i, 90],
  [/industr(?:y|ies)|market|solution|what-we-do/i, 80],
  [/capabilit|service|distribution|export|import/i, 75],
  [/team|management/i, 60],
];

const SKIPPED_PAGE_SUFFIXES = new Set([
  ".7z",
  ".avi",
  ".css",
  ".doc",
  ".docx",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".svg",
  ".tar",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

export const EMAIL_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export const PHONE_PATTERN =
  /(?:\+\d{1,3}[\s().-]*)?(?:\d[\s().-]*){8,14}\d/g;

const NOISE_ATTRIBUTE_PATTERN =
  /(?:^|[-_\s])(?:cookie|consent|popup|modal|newsletter|subscribe|social[-_\s](?:links?|icons?|media)|share[-_\s](?:links?|buttons?)|breadcrumb|pagination|advert(?:isement)?|back[-_\s]?to[-_\s]?top)(?:$|[-_\s])/i;

const BOILERPLATE_LINE_PATTERNS = [
  /^(?:skip to (?:main )?content|back to top)$/i,
  /^(?:follow|connect with) us(?: on)?\b/i,
  /^(?:subscribe|sign up) (?:to|for) (?:our )?(?:newsletter|updates)\b/i,
  /^(?:privacy policy|cookie policy|terms (?:of use|and conditions))$/i,
  /^(?:©|\(c\)|copyright\b).*\ball rights reserved\b/i,
  /^(?:we (?:use|value) cookies|this (?:site|website) uses cookies|by (?:using|continuing to use) (?:this|our) (?:site|website)).*$/i,
];

const BASE_NOISE_TAGS = "script, style, noscript, svg, nav, template";
const STRUCTURAL_NOISE_TAGS = "header, footer, aside, form, button, dialog";

function hostKey(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./u, "");
}

export function normalizedPageUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const filtered = [...parsed.searchParams.entries()].filter(
    ([key]) => !/^(?:utm_|fbclid|gclid|ref)/iu.test(key),
  );
  parsed.search = "";
  for (const [key, value] of filtered) parsed.searchParams.append(key, value);
  parsed.hash = "";
  if (parsed.pathname !== "/") {
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  }
  return parsed.toString();
}

export function homepageUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return normalizedPageUrl(parsed.toString());
}

function linkPriority(label: string): number {
  let best = 50;
  for (const [pattern, priority] of PAGE_PRIORITIES) {
    if (pattern.test(label) && priority > best) best = priority;
  }
  return best;
}

function visibleText(root: AnyNode, separator: string): string {
  const chunks: string[] = [];
  const walk = (node: AnyNode): void => {
    if (node.type === "text") {
      const value = node.data.replace(/[\s\u00a0]+/gu, " ").trim();
      if (value) chunks.push(value);
      return;
    }
    if (node.type === "tag" || node.type === "root") {
      for (const child of node.children) walk(child);
    }
  };
  walk(root);
  return chunks.join(separator);
}

function regexCleanLines(text: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/[\s\u00a0]+/gu, " ").trim();
    if (!line) continue;
    if (BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    const fingerprint = line.toLocaleLowerCase();
    if (fingerprint.length >= 20 && seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    lines.push(line);
  }
  return lines.join("\n");
}

function contactLines($: HtmlDocument): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of visibleText($.root()[0] as AnyNode, "\n").split(
    /\r?\n/u,
  )) {
    const line = rawLine.replace(/[\s\u00a0]+/gu, " ").trim();
    if (!line) continue;
    EMAIL_PATTERN.lastIndex = 0;
    PHONE_PATTERN.lastIndex = 0;
    if (!EMAIL_PATTERN.test(line) && !PHONE_PATTERN.test(line)) continue;
    const fingerprint = line.toLocaleLowerCase();
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    lines.push(line.slice(0, 500));
  }
  return lines;
}

export function pageTextFromHtml(
  html: string,
  enableRegexCleaning: boolean,
): string {
  return pageText(load(html), enableRegexCleaning);
}

export function pageText(
  $: HtmlDocument,
  enableRegexCleaning: boolean,
): string {
  const preservedContacts = contactLines($);
  $(BASE_NOISE_TAGS).remove();
  $(STRUCTURAL_NOISE_TAGS).remove();
  if (enableRegexCleaning) {
    $("*").each((_, element) => {
      if (!element.parent) return;
      const attributes = [
        $(element).attr("id") ?? "",
        $(element).attr("class") ?? "",
      ].join(" ");
      if (NOISE_ATTRIBUTE_PATTERN.test(attributes)) $(element).remove();
    });
  }

  const main = $("main, [role='main']").first();
  const mainText =
    main.length > 0 ? visibleText(main[0] as AnyNode, "\n") : "";
  let sourceText: string;
  if (mainText.replace(/\s+/gu, " ").trim().length >= 200) {
    sourceText = mainText;
  } else {
    const articles = $("article")
      .toArray()
      .map((article) => visibleText(article, "\n"))
      .join("\n");
    sourceText =
      articles.replace(/\s+/gu, " ").trim().length >= 200
        ? articles
        : visibleText(($("body")[0] ?? $.root()[0]) as AnyNode, "\n");
  }

  if (preservedContacts.length) {
    sourceText = [sourceText, ...preservedContacts].join("\n");
  }
  if (enableRegexCleaning) return regexCleanLines(sourceText);
  return sourceText.replace(/\s+/gu, " ").trim();
}

export function extractRelatedLinks(
  html: string,
  finalUrl: string,
): Array<readonly [number, string]> {
  const $ = load(html);
  const hostname = hostKey(new URL(finalUrl).hostname);
  const links = new Map<string, number>();
  $("a[href]").each((_, anchor) => {
    let resolved: URL;
    try {
      resolved = new URL($(anchor).attr("href") ?? "", finalUrl);
    } catch {
      return;
    }
    const linkHost = hostKey(resolved.hostname);
    const label = `${resolved.pathname} ${$(anchor).text().replace(/\s+/gu, " ").trim()}`;
    const suffix = resolved.pathname.toLowerCase().split("/").at(-1) ?? "";
    const extension = suffix.includes(".")
      ? `.${suffix.split(".").at(-1) ?? ""}`
      : "";
    if (
      linkHost !== hostname ||
      (resolved.protocol !== "http:" && resolved.protocol !== "https:") ||
      SKIPPED_PAGE_SUFFIXES.has(extension) ||
      !PAGE_HINT.test(label)
    ) {
      return;
    }
    const normalized = normalizedPageUrl(resolved.toString());
    links.set(
      normalized,
      Math.max(links.get(normalized) ?? 0, linkPriority(label)),
    );
  });
  return [...links.entries()]
    .map(([link, priority]) => [priority, link] as const)
    .sort((left, right) => right[0] - left[0] || left[1].localeCompare(right[1]));
}

export function parsePage(
  html: string,
  finalUrl: string,
  enableRegexCleaning: boolean,
): { page: PageSnapshot; links: Array<readonly [number, string]> } {
  const $ = load(html);
  const hostname = hostKey(new URL(finalUrl).hostname);
  const title =
    $("title").first().text().replace(/\s+/gu, " ").trim() || hostname;
  return {
    page: {
      url: finalUrl,
      title,
      text: pageText($, enableRegexCleaning),
    },
    links: extractRelatedLinks(html, finalUrl),
  };
}

function nearbyText(text: string, value: string): string {
  const index = text.indexOf(value);
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 80), index + value.length + 80);
}

export function extractContacts(
  pages: readonly PageSnapshot[],
): ContactCandidate[] {
  const contacts = new Map<string, ContactCandidate>();
  for (const page of pages) {
    const text = page.text;
    EMAIL_PATTERN.lastIndex = 0;
    for (const email of text.match(EMAIL_PATTERN) ?? []) {
      const value = email.toLowerCase();
      contacts.set(`email:${value}`, {
        type: "email",
        value,
        sourceUrl: page.url,
        nearbyText: nearbyText(text, email),
      });
    }
    PHONE_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(PHONE_PATTERN)) {
      const raw = match[0];
      const value = raw.replace(/\s+/gu, " ").trim();
      const contactType = nearbyText(text.toLowerCase(), raw.toLowerCase())
        .includes("whatsapp")
        ? "whatsapp"
        : "phone";
      contacts.set(`${contactType}:${value}`, {
        type: contactType,
        value,
        sourceUrl: page.url,
        nearbyText: nearbyText(text, raw),
      });
    }
  }
  return [...contacts.values()];
}
