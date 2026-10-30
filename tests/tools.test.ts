// End to end through MCP: a client on an in-memory transport calls the tools, which talk to a stub API on 127.0.0.1.
// The stub records each request and answers like the real API (401 without the key, 403 naming a missing scope).
import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TportApi } from "../src/api.js";
import { makeServer } from "../src/server.js";
import { TOOLS } from "../src/tools.js";

const KEY = "tpct_test-key";
type Seen = { method: string; path: string; query: Record<string, string>; body: any; auth?: string };
let seen: Seen[] = [];
let http: HttpServer;
let client: Client;

function answer(s: Seen): [number, unknown] {
  if (s.path === "/api/catalogue") {
    return [200, { plans: [{ id: "ct-1", kind: "root" }, { id: "shared-2", kind: "shared" }, { id: "pg-1", kind: "pg" }] }];
  }
  if (s.auth !== `Bearer ${KEY}`) return [401, { detail: "Sign in first" }];
  if (s.path === "/api/billing") return [403, { detail: "This API token is missing the 'billing:read' scope" }];
  if (s.path === "/api/orders" && !s.body.plan) {
    return [422, { detail: [{ loc: ["body", "plan"], msg: "Field required" }] }];
  }
  return [200, { ok: true, echo: s.body ?? null }];
}

beforeAll(async () => {
  http = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const s: Seen = {
        method: req.method ?? "", path: url.pathname, query: Object.fromEntries(url.searchParams),
        body: raw ? JSON.parse(raw) : undefined, auth: req.headers.authorization,
      };
      seen.push(s);
      const [status, data] = answer(s);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    });
  });
  await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer(new TportApi(KEY, base + "/")).connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

afterAll(() => new Promise<void>((ok) => http.close(() => ok())));
beforeEach(() => (seen = []));

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { error: !!res.isError, text: res.content[0].text };
}

describe("tool list", () => {
  it("offers every tool the plan names, with object schemas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_plans", "list_servers", "get_server", "create_server", "resize_server", "power",
      "delete_server", "dns_list_zones", "dns_add_record", "databases_list", "databases_create"]) {
      expect(names).toContain(n);
    }
    expect(new Set(names).size).toBe(TOOLS.length);
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(tools.find((t) => t.name === "delete_server")?.annotations?.destructiveHint).toBe(true);
  });
});

describe("calls", () => {
  it("list_plans filters by kind", async () => {
    const r = await call("list_plans", { kind: "pg" });
    expect(JSON.parse(r.text).plans).toEqual([{ id: "pg-1", kind: "pg" }]);
  });

  it("sends the key as a Bearer token", async () => {
    await call("list_servers");
    expect(seen[0]).toMatchObject({ method: "GET", path: "/api/servers", auth: `Bearer ${KEY}` });
  });

  it("create_server posts an order with kind server and only the given fields", async () => {
    await call("create_server", { plan: "ct-1", region: "eu", name: "web1", ssh_keys: ["ssh-ed25519 AAA x"] });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/api/orders" });
    expect(seen[0].body).toEqual({ kind: "server", plan: "ct-1", region: "eu", name: "web1", ssh_keys: ["ssh-ed25519 AAA x"] });
  });

  it("databases_create orders kind pg", async () => {
    await call("databases_create", { plan: "pg-1", region: "us", name: "db1", allow: ["203.0.113.7/32"] });
    expect(seen[0].body).toEqual({ kind: "pg", plan: "pg-1", region: "us", name: "db1", allow: ["203.0.113.7/32"] });
  });

  it("resize, power and delete hit the item routes", async () => {
    await call("resize_server", { id: "sh-3", plan: "shared-4" });
    await call("power", { id: "srv-7", action: "restart" });
    await call("delete_server", { id: "srv-7", confirm: "web1" });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST /api/servers/sh-3/resize", "POST /api/servers/srv-7/power", "DELETE /api/servers/srv-7"]);
    expect(seen.map((s) => s.body)).toEqual([{ plan: "shared-4" }, { action: "restart" }, { confirm: "web1" }]);
  });

  it("dns tools map to zones and records", async () => {
    await call("dns_add_zone", { zone: "example.com", ip: "203.0.113.9" });
    await call("dns_add_record", { zone: "example.com", name: "www", type: "CNAME", value: "example.com." });
    await call("dns_delete_record", { zone: "example.com", name: "www", type: "CNAME" });
    await call("dns_delete_zone", { zone: "example.com", confirm: "example.com" });
    expect(seen[0]).toMatchObject({ path: "/api/dns/zones", body: { name: "example.com", ip: "203.0.113.9" } });
    expect(seen[1]).toMatchObject({ path: "/api/dns/zones/example.com/records",
      body: { name: "www", type: "CNAME", value: "example.com." } });
    expect(seen[2]).toMatchObject({ method: "DELETE", query: { name: "www", type: "CNAME" } });
    expect(seen[3]).toMatchObject({ method: "DELETE", path: "/api/dns/zones/example.com", query: { confirm: "example.com" } });
  });
});

describe("errors come back in the API's words", () => {
  it("a missing scope is a tool error naming it", async () => {
    const r = await call("get_billing");
    expect(r).toEqual({ error: true, text: "403: This API token is missing the 'billing:read' scope" });
  });

  it("validation errors name the field", async () => {
    const r = await call("create_server", { region: "eu", name: "x" });
    expect(r).toEqual({ error: true, text: "422: plan Field required" });
  });

  it("a wrong key is refused", async () => {
    const api = new TportApi("tpct_wrong", `http://127.0.0.1:${(http.address() as AddressInfo).port}`);
    await expect(api.get("/api/servers")).rejects.toThrow("401: Sign in first");
  });
});
