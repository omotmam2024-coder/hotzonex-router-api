/**
 * MikroTik client — dual-protocol:
 *   port 8728 / 8729 → RouterOS binary API (node-routeros, all RouterOS versions)
 *   port 80  / 443   → RouterOS REST API (RouterOS 7.1+, plain HTTP/HTTPS)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RouterOSAPI } = require("node-routeros");

export interface RouterConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ConnectionTestResult {
  success: boolean;
  identity: string;
  routerOS: string;
  servers: string[];
  profiles: string[];
}

export interface ActiveUser {
  id: string;
  username: string;
  ip: string;
  uptime: string;
  bytesIn: number;
  bytesOut: number;
  server: string;
}

export interface RouterStatus {
  online: boolean;
  cpu: number;
  freeMemoryMb: number;
  totalMemoryMb: number;
  uptime: string;
  version: string;
  activeUsers: number;
}

// ─── Binary API (port 8728 / 8729) ─────────────────────────────────────────

function isBinaryPort(port: number) {
  return port === 8728 || port === 8729;
}

/**
 * Open ONE connection, run `fn` against it, then always close. Connecting +
 * logging in is the slow part over a long-haul link, so callers that need
 * several commands should run them all inside a single withBinary() instead of
 * reconnecting per command.
 */
async function withBinary<T>(
  cfg: RouterConfig,
  fn: (client: { write: (words: string[]) => Promise<unknown> }) => Promise<T>,
): Promise<T> {
  const api = new RouterOSAPI({
    host: cfg.host,
    user: cfg.username,
    password: cfg.password,
    port: cfg.port,
    tls: cfg.port === 8729,
    timeout: 10,
    keepalive: false,
  });
  const client = await api.connect();
  try {
    return await fn(client as { write: (words: string[]) => Promise<unknown> });
  } finally {
    try { api.close(); } catch { /* ignore */ }
  }
}

async function binaryWrite(
  cfg: RouterConfig,
  words: string[],
): Promise<Record<string, string>[]> {
  return withBinary(cfg, (client) => client.write(words)) as Promise<
    Record<string, string>[]
  >;
}

// ─── REST API (port 80 / 443) ───────────────────────────────────────────────

function restBase(cfg: RouterConfig) {
  const scheme = cfg.port === 443 ? "https" : "http";
  // REST API always on standard HTTP ports (80/443), ignore cfg.port for path
  const portPart = (cfg.port === 80 || cfg.port === 443) ? "" : `:${cfg.port}`;
  return `${scheme}://${cfg.host}${portPart}/rest`;
}

function restAuth(cfg: RouterConfig) {
  return "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
}

async function restFetch<T>(
  cfg: RouterConfig,
  method: string,
  path: string,
  body?: object,
): Promise<T> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${restBase(cfg)}${path}`, {
      method,
      headers: {
        Authorization: restAuth(cfg),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`RouterOS REST ${res.status}: ${text}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : ({} as T);
  } finally {
    clearTimeout(tid);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function testConnection(cfg: RouterConfig): Promise<ConnectionTestResult> {
  if (isBinaryPort(cfg.port)) {
    // All four reads share ONE connection/login.
    return withBinary(cfg, async (client) => {
      const run = (w: string[]) => client.write(w) as Promise<Record<string, string>[]>;
      const [id] = await run(["/system/identity/print"]);
      const [res] = await run(["/system/resource/print"]);
      const hs = await run(["/ip/hotspot/print"]);
      const pr = await run(["/ip/hotspot/user/profile/print"]);
      return {
        success: true,
        identity: id?.["name"] ?? "Unknown",
        routerOS: res?.["version"] ?? "Unknown",
        servers: hs.map((h) => h["name"]).filter(Boolean),
        profiles: pr.map((p) => p["name"]).filter(Boolean),
      };
    });
  } else {
    const id = await restFetch<{ name: string }>(cfg, "GET", "/system/identity");
    const res = await restFetch<{ version: string }>(cfg, "GET", "/system/resource");
    const hs = await restFetch<{ name: string }[]>(cfg, "GET", "/ip/hotspot");
    const pr = await restFetch<{ name: string }[]>(cfg, "GET", "/ip/hotspot/user/profile");
    return {
      success: true,
      identity: id.name,
      routerOS: res.version,
      servers: Array.isArray(hs) ? hs.map((h) => h.name) : [],
      profiles: Array.isArray(pr) ? pr.map((p) => p.name) : [],
    };
  }
}

export async function createHotspotUser(
  cfg: RouterConfig,
  name: string,
  password: string,
  profile: string,
  server?: string,
): Promise<void> {
  if (isBinaryPort(cfg.port)) {
    const words = [
      "/ip/hotspot/user/add",
      `=name=${name}`,
      `=password=${password}`,
      `=profile=${profile}`,
    ];
    if (server) words.push(`=server=${server}`);
    await binaryWrite(cfg, words);
  } else {
    const body: Record<string, string> = { name, password, profile };
    if (server) body["server"] = server;
    await restFetch(cfg, "PUT", "/ip/hotspot/user", body);
  }
}

/**
 * Create many hotspot users over ONE connection (binary) instead of
 * reconnecting per voucher — critical for bulk batches of 50/100/500.
 * Returns a per-item success/error result so partial failures are reported.
 */
export async function createHotspotUsers(
  cfg: RouterConfig,
  items: { name: string; password: string; profile: string }[],
  server?: string,
): Promise<{ name: string; success: boolean; error?: string }[]> {
  const results: { name: string; success: boolean; error?: string }[] = [];

  if (isBinaryPort(cfg.port)) {
    await withBinary(cfg, async (client) => {
      for (const it of items) {
        try {
          const words = [
            "/ip/hotspot/user/add",
            `=name=${it.name}`,
            `=password=${it.password}`,
            `=profile=${it.profile}`,
          ];
          if (server) words.push(`=server=${server}`);
          await client.write(words);
          results.push({ name: it.name, success: true });
        } catch (err) {
          results.push({
            name: it.name,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
  } else {
    for (const it of items) {
      try {
        const body: Record<string, string> = {
          name: it.name,
          password: it.password,
          profile: it.profile,
        };
        if (server) body["server"] = server;
        await restFetch(cfg, "PUT", "/ip/hotspot/user", body);
        results.push({ name: it.name, success: true });
      } catch (err) {
        results.push({
          name: it.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return results;
}

export async function getActiveUsers(
  cfg: RouterConfig,
  server?: string,
): Promise<ActiveUser[]> {
  let rows: Record<string, string>[];
  if (isBinaryPort(cfg.port)) {
    rows = await binaryWrite(cfg, ["/ip/hotspot/active/print"]);
  } else {
    rows = await restFetch<Record<string, string>[]>(cfg, "GET", "/ip/hotspot/active");
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((u) => !server || u["server"] === server)
    .map((u) => ({
      id: u[".id"] ?? "",
      username: u["user"] ?? u["name"] ?? "",
      ip: u["address"] ?? "",
      uptime: u["uptime"] ?? "0s",
      bytesIn: parseInt(u["bytes-in"] ?? "0", 10),
      bytesOut: parseInt(u["bytes-out"] ?? "0", 10),
      server: u["server"] ?? "",
    }));
}

export async function disconnectUser(cfg: RouterConfig, activeId: string): Promise<void> {
  if (isBinaryPort(cfg.port)) {
    await binaryWrite(cfg, ["/ip/hotspot/active/remove", `=.id=${activeId}`]);
  } else {
    await restFetch(cfg, "DELETE", `/ip/hotspot/active/${encodeURIComponent(activeId)}`);
  }
}

async function findHotspotUserId(
  cfg: RouterConfig,
  username: string,
): Promise<string> {
  let rows: Record<string, string>[];
  if (isBinaryPort(cfg.port)) {
    rows = await binaryWrite(cfg, ["/ip/hotspot/user/print", `?name=${username}`]);
  } else {
    rows = await restFetch<Record<string, string>[]>(
      cfg, "GET", `/ip/hotspot/user?name=${encodeURIComponent(username)}`,
    );
  }
  if (!rows.length) throw new Error(`Hotspot user "${username}" not found`);
  return rows[0][".id"] ?? rows[0]["id"] ?? "";
}

export async function disableHotspotUser(cfg: RouterConfig, username: string): Promise<void> {
  const id = await findHotspotUserId(cfg, username);
  if (isBinaryPort(cfg.port)) {
    await binaryWrite(cfg, ["/ip/hotspot/user/set", `=.id=${id}`, "=disabled=yes"]);
  } else {
    await restFetch(cfg, "PATCH", `/ip/hotspot/user/${encodeURIComponent(id)}`, {
      disabled: "true",
    });
  }
}

export async function enableHotspotUser(cfg: RouterConfig, username: string): Promise<void> {
  const id = await findHotspotUserId(cfg, username);
  if (isBinaryPort(cfg.port)) {
    await binaryWrite(cfg, ["/ip/hotspot/user/set", `=.id=${id}`, "=disabled=no"]);
  } else {
    await restFetch(cfg, "PATCH", `/ip/hotspot/user/${encodeURIComponent(id)}`, {
      disabled: "false",
    });
  }
}

export async function getRouterStatus(
  cfg: RouterConfig,
  server?: string,
): Promise<RouterStatus> {
  if (isBinaryPort(cfg.port)) {
    // resource + active users on one connection.
    return withBinary(cfg, async (client) => {
      const run = (w: string[]) => client.write(w) as Promise<Record<string, string>[]>;
      const [res] = await run(["/system/resource/print"]);
      const rows = await run(["/ip/hotspot/active/print"]);
      const active = (Array.isArray(rows) ? rows : []).filter(
        (u) => !server || u["server"] === server,
      );
      return {
        online: true,
        cpu: parseInt(res?.["cpu-load"] ?? "0", 10),
        freeMemoryMb: Math.round(parseInt(res?.["free-memory"] ?? "0", 10) / 1024 / 1024),
        totalMemoryMb: Math.round(parseInt(res?.["total-memory"] ?? "0", 10) / 1024 / 1024),
        uptime: res?.["uptime"] ?? "0s",
        version: res?.["version"] ?? "",
        activeUsers: active.length,
      };
    });
  } else {
    const res = await restFetch<Record<string, string>>(cfg, "GET", "/system/resource");
    const active = await getActiveUsers(cfg, server);
    return {
      online: true,
      cpu: parseInt(res["cpu-load"] ?? "0", 10),
      freeMemoryMb: Math.round(parseInt(res["free-memory"] ?? "0", 10) / 1024 / 1024),
      totalMemoryMb: Math.round(parseInt(res["total-memory"] ?? "0", 10) / 1024 / 1024),
      uptime: res["uptime"] ?? "0s",
      version: res["version"] ?? "",
      activeUsers: active.length,
    };
  }
}
