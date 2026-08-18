import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();

function addV4(prefix: string, prefixLength: number): void {
  blocked.addSubnet(prefix, prefixLength, "ipv4");
}

function addV6(prefix: string, prefixLength: number): void {
  blocked.addSubnet(prefix, prefixLength, "ipv6");
}

// Union of Python ipaddress is_private / is_loopback / is_link_local /
// is_reserved / is_multicast special-purpose ranges.
addV4("0.0.0.0", 8);
addV4("10.0.0.0", 8);
addV4("100.64.0.0", 10);
addV4("127.0.0.0", 8);
addV4("169.254.0.0", 16);
addV4("172.16.0.0", 12);
addV4("192.0.0.0", 24);
addV4("192.0.2.0", 24);
addV4("192.88.99.0", 24);
addV4("192.168.0.0", 16);
addV4("198.18.0.0", 15);
addV4("198.51.100.0", 24);
addV4("203.0.113.0", 24);
addV4("224.0.0.0", 4);
addV4("240.0.0.0", 4);

addV6("::", 128);
addV6("::1", 128);
addV6("100::", 64);
addV6("2001:db8::", 32);
addV6("fc00::", 7);
addV6("fe80::", 10);
addV6("ff00::", 8);

export type LookupAll = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const defaultLookup: LookupAll = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function mappedIpv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const mapped = address.slice("::ffff:".length);
    return isIP(mapped) === 4 ? mapped : undefined;
  }
  return undefined;
}

export function assertPublicAddress(address: string): void {
  const mapped = mappedIpv4(address);
  if (mapped) {
    assertPublicAddress(mapped);
    return;
  }
  const family = isIP(address);
  if (family !== 4 && family !== 6) {
    throw new Error("不允许访问本机或私有网络地址");
  }
  if (blocked.check(address, family === 4 ? "ipv4" : "ipv6")) {
    throw new Error("不允许访问本机或私有网络地址");
  }
}

export async function assertPublicUrl(
  url: string,
  resolve: LookupAll = defaultLookup,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("网址缺少主机名");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只允许 http/https 网站");
  }
  if (parsed.username || parsed.password) {
    throw new Error("网址不能包含用户名或密码");
  }
  const hostname = parsed.hostname;
  if (!hostname) throw new Error("网址缺少主机名");
  if (isIP(hostname)) {
    assertPublicAddress(hostname);
    return;
  }
  const records = await resolve(hostname);
  if (!records.length) throw new Error("域名无法解析");
  for (const record of records) {
    assertPublicAddress(record.address);
  }
}
