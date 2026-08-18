const POLL_HEADER = "x-trade-radar-poll";

function headerValue(
  headers:
    | { get?(name: string): string | undefined }
    | Record<string, unknown>
    | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return typeof value === "string" ? value : undefined;
  }
  const direct = (headers as Record<string, unknown>)[name];
  if (typeof direct === "string") return direct;
  const matched = Object.entries(headers as Record<string, unknown>).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return typeof matched?.[1] === "string" ? matched[1] : undefined;
}

export function isStatusPollHttpRequest(
  method: string,
  requestPath: string,
  headers?:
    | { get?(name: string): string | undefined }
    | Record<string, unknown>,
): boolean {
  if (method.toUpperCase() !== "GET") return false;
  if (requestPath === "/api/health") return true;
  if (/^\/api\/orchestrator\/sessions\/[^/]+\/activity$/u.test(requestPath)) {
    return true;
  }
  return headerValue(headers, POLL_HEADER) === "1";
}

export function shouldLogHttpRequest(
  method: string,
  requestPath: string,
  headers?:
    | { get?(name: string): string | undefined }
    | Record<string, unknown>,
  statusCode?: number,
): boolean {
  if (!requestPath.startsWith("/api/")) return false;
  if (statusCode !== undefined && statusCode >= 400) return true;
  return !isStatusPollHttpRequest(method, requestPath, headers);
}
