import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicAddress, assertPublicUrl } from "../src/crawler/ssrf.js";

test("assertPublicAddress blocks loopback, private, and mapped IPv4", () => {
  assert.throws(() => assertPublicAddress("127.0.0.1"), /私有网络/);
  assert.throws(() => assertPublicAddress("10.0.0.4"), /私有网络/);
  assert.throws(() => assertPublicAddress("192.168.1.1"), /私有网络/);
  assert.throws(() => assertPublicAddress("169.254.1.1"), /私有网络/);
  assert.throws(() => assertPublicAddress("::1"), /私有网络/);
  assert.throws(() => assertPublicAddress("::ffff:127.0.0.1"), /私有网络/);
  assert.doesNotThrow(() => assertPublicAddress("8.8.8.8"));
  assert.doesNotThrow(() => assertPublicAddress("1.1.1.1"));
});

test("assertPublicUrl rejects credentials, non-http, and private DNS", async () => {
  await assert.rejects(
    () => assertPublicUrl("file:///etc/passwd"),
    /只允许 http\/https/,
  );
  await assert.rejects(
    () => assertPublicUrl("https://user:pass@example.com/"),
    /用户名或密码/,
  );
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1/"), /私有网络/);
  await assert.rejects(
    () =>
      assertPublicUrl("https://internal.example/", async () => [
        { address: "10.1.2.3", family: 4 },
      ]),
    /私有网络/,
  );
  await assert.doesNotReject(() =>
    assertPublicUrl("https://example.com/", async () => [
      { address: "93.184.216.34", family: 4 },
    ]),
  );
});
