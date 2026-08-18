import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fetchHtml } from "../src/crawler/fetch-html.js";
import { MAX_REDIRECTS } from "../src/crawler/limits.js";

test("fetchHtml follows a public redirect, rejects oversize HTML, and caps hops", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://public.example/start") {
      return new Response(null, {
        status: 302,
        headers: { location: "/next" },
      });
    }
    if (url === "https://public.example/next") {
      return new Response("<html><title>ok</title></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  try {
    const page = await fetchHtml(
      "https://public.example/start",
      async () => [{ address: "93.184.216.34", family: 4 }],
    );
    assert.equal(page.html.includes("<title>ok</title>"), true);
    assert.equal(calls.length, 2);

    globalThis.fetch = (async () =>
      new Response("x".repeat(20), {
        status: 200,
        headers: {
          "content-type": "text/html",
          "content-length": "20000000",
        },
      })) as typeof fetch;
    await assert.rejects(
      () =>
        fetchHtml("https://public.example/big", async () => [
          { address: "93.184.216.34", family: 4 },
        ]),
      /体积超过抓取上限/,
    );

    let hops = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      hops += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `${String(input)}/${hops}` },
      });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        fetchHtml("https://public.example/loop", async () => [
          { address: "93.184.216.34", family: 4 },
        ]),
      new RegExp(`重定向超过 ${MAX_REDIRECTS}`),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchHtml does not talk to a loopback listener", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<html>secret</html>");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(
      () => fetchHtml(`http://127.0.0.1:${address.port}/`),
      /私有网络/,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
