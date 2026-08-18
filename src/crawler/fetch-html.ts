import {
  BODY_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  crawlerMaxHtmlBytes,
  MAX_REDIRECTS,
  USER_AGENT,
} from "./limits.js";
import { assertPublicUrl, type LookupAll } from "./ssrf.js";

export type FetchedHtml = {
  html: string;
  finalUrl: string;
};

function charsetOf(contentType: string): string {
  const match = /charset=([^;]+)/iu.exec(contentType);
  const charset = match?.[1]?.trim().replace(/^["']|["']$/gu, "");
  return charset || "utf-8";
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const charset = charsetOf(contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error("网页体积超过抓取上限");
  }
  if (!response.body) throw new Error("网页请求失败：空响应");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("网页体积超过抓取上限");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchHtml(
  initialUrl: string,
  resolve?: LookupAll,
): Promise<FetchedHtml> {
  let current = initialUrl;
  const maxBytes = crawlerMaxHtmlBytes();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current, resolve);
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS + BODY_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("网页重定向缺少 Location");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`网页请求失败：HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel();
      throw new Error("目标地址不是 HTML 网页");
    }
    const bytes = await readLimitedBody(response, maxBytes);
    return {
      html: decodeHtml(bytes, contentType),
      finalUrl: response.url || current,
    };
  }
  throw new Error(`网页重定向超过 ${MAX_REDIRECTS} 次`);
}
