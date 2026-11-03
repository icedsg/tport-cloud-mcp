// The MCP tools: one per API call. Each names the key scope it needs; the API enforces it (403 names the missing one).
import type { TportApi } from "./api.js";

type Args = Record<string, any>;
type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[] };

export interface Tool {
  name: string;
  description: string;
  inputSchema: Schema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  run: (api: TportApi, args: Args) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });
const obj = (properties: Record<string, unknown>, required: string[] = []): Schema =>
  ({ type: "object", properties, ...(required.length ? { required } : {}) });
const id = (v: unknown) => encodeURIComponent(String(v ?? ""));
const READ = { readOnlyHint: true };
const DESTROY = { destructiveHint: true };

const SERVER_ID = str("Server id from list_servers: srv-<n> (root server) or sh-<n> (shared account)");
const CLUSTER_ID = str("Cluster id from databases_list: pg-<n>");
const DATA_ID = str("Database id from data_list: db-<n>");
const DATA_PRICE = int("Monthly price in cents from data_catalogue, without add-ons, e.g. 800");
const REGION = str("Region id from list_plans, e.g. eu (Germany), us (US Central), uk, us-east, us-west, sg");

// Only what was given goes in the body, so the API's own defaults apply to the rest.
function pick(args: Args, keys: string[]): Args {
  return Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
}

export const TOOLS: Tool[] = [
  {
    name: "list_plans",
    description: "What can be ordered: plans with monthly price (cents), vCPU, RAM, disk; regions; images; installs " +
      "(python, node, postgresql...); which plan is available in which region. Managed databases by engine are in " +
      "data_catalogue. No key needed.",
    inputSchema: obj({ kind: str("Only plans of this kind: shared, root or pg") }),
    annotations: READ,
    run: async (api, a) => {
      const cat = (await api.get("/api/catalogue")) as { plans?: { kind: string }[] };
      return a.kind && cat.plans ? { ...cat, plans: cat.plans.filter((p) => p.kind === a.kind) } : cat;
    },
  },
  {
    name: "list_servers",
    description: "Your servers and shared accounts with status, plan, region and IP. Scope servers:read.",
    inputSchema: obj({}),
    annotations: READ,
    run: (api) => api.get("/api/servers"),
  },
  {
    name: "get_server",
    description: "One server or shared account in detail: status, IP, plan, price, paid until, recent events. " +
      "Scope servers:read.",
    inputSchema: obj({ id: SERVER_ID }, ["id"]),
    annotations: READ,
    run: (api, a) => api.get(`/api/servers/${id(a.id)}`),
  },
  {
    name: "create_server",
    description: "Order a server (kind server = own root server) or a shared account (kind shared). The first 30 " +
      "days are charged from the account balance; setup takes a few minutes (watch it with get_order or " +
      "get_server). Ubuntu 24.04 only. A root server without ssh_keys answers a one-time root password once. " +
      "Scope servers:create.",
    inputSchema: obj({
      kind: { type: "string", enum: ["server", "shared"], description: "server (default) or shared" },
      plan: str("Plan id from list_plans"),
      region: REGION,
      name: str("Server name: lower-case letters, digits and dashes"),
      ssh_keys: strs("Public SSH keys to install"),
      installs: strs("Software to set up, from list_plans installs, optionally with a version: python, node:22, postgresql:18"),
      access_mode: { type: "string", enum: ["root", "noroot"], description: "root (default) or noroot: your key on " +
        "your own user, no sudo, root login off. noroot needs user and confirm_no_root" },
      user: str("noroot only: the login user name"),
      confirm_no_root: str("noroot only: type the server name again to confirm you will have no root access"),
    }, ["plan", "region", "name"]),
    run: (api, a) => api.post("/api/orders", {
      kind: a.kind ?? "server",
      ...pick(a, ["plan", "region", "name", "ssh_keys", "installs", "access_mode", "user", "confirm_no_root"]),
    }),
  },
  {
    name: "get_order",
    description: "An order's progress (queued, creating, ready, failed) with its item id. Not for data_create, " +
      "which has no order: use data_list. Scope servers:read.",
    inputSchema: obj({ order_id: int("Order id returned by create_server or databases_create") }, ["order_id"]),
    annotations: READ,
    run: (api, a) => api.get(`/api/orders/${id(a.order_id)}`),
  },
  {
    name: "resize_server",
    description: "Move a server or shared account to another plan of the same kind. Bigger: the difference for the " +
      "days already paid is charged from the balance now. Smaller: the unused difference goes back, and only when " +
      "the data fits in 80% of the new disk. Then the new price applies. Scope servers:resize.",
    inputSchema: obj({ id: SERVER_ID, plan: str("The new plan id from list_plans") }, ["id", "plan"]),
    run: (api, a) => api.post(`/api/servers/${id(a.id)}/resize`, { plan: a.plan }),
  },
  {
    name: "power",
    description: "Start, stop or restart a server. Scope servers:power.",
    inputSchema: obj({
      id: SERVER_ID,
      action: { type: "string", enum: ["start", "stop", "restart"] },
    }, ["id", "action"]),
    run: (api, a) => api.post(`/api/servers/${id(a.id)}/power`, { action: a.action }),
  },
  {
    name: "delete_server",
    description: "Delete a server or shared account and everything on it; unused days go back to the balance. " +
      "Cannot be undone. Scope servers:delete.",
    inputSchema: obj({ id: SERVER_ID, confirm: str("The server's name, typed to confirm") }, ["id", "confirm"]),
    annotations: DESTROY,
    run: (api, a) => api.request("DELETE", `/api/servers/${id(a.id)}`, { body: { confirm: a.confirm } }),
  },
  {
    name: "databases_list",
    description: "Your primary + standby PostgreSQL clusters with status, plan and region. Databases of every engine are in " +
      "data_list. Scope databases:read.",
    inputSchema: obj({}),
    annotations: READ,
    run: (api) => api.get("/api/clusters"),
  },
  {
    name: "databases_get",
    description: "One PostgreSQL cluster: status, connection details, pooler, standby, allow list. " +
      "Scope databases:read.",
    inputSchema: obj({ id: CLUSTER_ID }, ["id"]),
    annotations: READ,
    run: (api, a) => api.get(`/api/clusters/${id(a.id)}`),
  },
  {
    name: "databases_create",
    description: "Order a primary + standby PostgreSQL cluster (plan kind pg from list_plans). For one database of " +
      "any engine use data_create. The first 30 days are charged from the balance. Scope databases:write.",
    inputSchema: obj({
      plan: str("pg plan id from list_plans"),
      region: REGION,
      name: str("Cluster name: lower-case letters, digits and dashes"),
      version: str("PostgreSQL major version (default: the newest offered)"),
      allow: strs("IP addresses or CIDRs allowed to connect, e.g. 203.0.113.7/32"),
    }, ["plan", "region", "name"]),
    run: (api, a) => api.post("/api/orders", { kind: "pg", ...pick(a, ["plan", "region", "name", "version", "allow"]) }),
  },
  {
    name: "databases_set_allow",
    description: "Replace a cluster's allow list (who may connect). An empty list closes it. Scope databases:write.",
    inputSchema: obj({ id: CLUSTER_ID, allow: strs("IP addresses or CIDRs") }, ["id", "allow"]),
    run: (api, a) => api.put(`/api/clusters/${id(a.id)}/allow`, { allow: a.allow }),
  },
  {
    name: "databases_delete",
    description: "Delete a PostgreSQL cluster and its data; unused days go back to the balance. " +
      "Cannot be undone. Scope databases:write.",
    inputSchema: obj({ id: CLUSTER_ID, confirm: str("The cluster's name, typed to confirm") }, ["id", "confirm"]),
    annotations: DESTROY,
    run: (api, a) => api.request("DELETE", `/api/clusters/${id(a.id)}`, { body: { confirm: a.confirm } }),
  },
  {
    name: "data_catalogue",
    description: "Managed databases that can be ordered: PostgreSQL, MariaDB, CouchDB, SQLite, FAISS, Chroma, Qdrant, " +
      "Weaviate, Milvus. For each engine its add-ons and prices, what each price buys per region (vCPU, RAM, disk) " +
      "and whether it can be ordered there now. No key needed.",
    inputSchema: obj({ engine: str("Only this engine, by its id, e.g. pgsql, mariadb, qdrant") }),
    annotations: READ,
    run: async (api, a) => {
      const cat = (await api.get("/api/data/catalogue")) as { engines?: { id: string }[] };
      return a.engine && cat.engines ? { ...cat, engines: cat.engines.filter((e) => e.id === a.engine) } : cat;
    },
  },
  {
    name: "data_list",
    description: "Your managed databases with engine, status, size, region, address and allow list, never the login. " +
      "Use it to watch a new database until its status is running. Scope databases:read.",
    inputSchema: obj({}),
    annotations: READ,
    run: (api) => api.get("/api/data/services"),
  },
  {
    // Not marked read-only: the first read after setup hands over the login and removes it from the API.
    name: "data_get",
    description: "One managed database in detail with recent events. The first call after setup also answers its login " +
      "in credentials, once: it can't be read again, so give it to the user right away. Scope databases:read.",
    inputSchema: obj({ id: DATA_ID }, ["id"]),
    run: (api, a) => api.get(`/api/data/services/${id(a.id)}`),
  },
  {
    name: "data_create",
    description: "Order a managed database. The first 30 days, add-ons included, are charged from the balance; setup " +
      "takes a few minutes (watch it with data_list). Nothing can connect until an IP is on its allow list. " +
      "Scope databases:write.",
    inputSchema: obj({
      engine: str("Engine id from data_catalogue, e.g. pgsql"),
      price_cents: DATA_PRICE,
      region: str("Region id from data_catalogue: eu (Germany), us or in (India)"),
      name: str("Database name: 2-31 characters, lower-case letters, digits and single dashes, starting with a letter"),
      addons: strs("Add-on ids for this engine from data_catalogue, e.g. pgvector, postgis, spatialite"),
      allow: strs("IP addresses or CIDRs allowed to connect, e.g. 203.0.113.7/32"),
    }, ["engine", "price_cents", "region", "name"]),
    run: (api, a) => api.post("/api/data/services", pick(a, ["engine", "price_cents", "region", "name", "addons", "allow"])),
  },
  {
    name: "data_set_allow",
    description: "Replace a managed database's allow list (who may connect). An empty list closes it. " +
      "Scope databases:write.",
    inputSchema: obj({ id: DATA_ID, allow: strs("IP addresses or CIDRs") }, ["id", "allow"]),
    run: (api, a) => api.put(`/api/data/services/${id(a.id)}/allow`, { allow: a.allow }),
  },
  {
    name: "data_resize",
    description: "Move a running database to another price for its engine and region. Bigger: the difference for the " +
      "days already paid is charged from the balance now. Smaller: the unused difference goes back, and only when the " +
      "data fits in 80% of the new disk. Some steps can't be done in place and answer 409; pick a smaller step. " +
      "Scope databases:write.",
    inputSchema: obj({ id: DATA_ID, price_cents: DATA_PRICE }, ["id", "price_cents"]),
    run: (api, a) => api.post(`/api/data/services/${id(a.id)}/resize`, { price_cents: a.price_cents }),
  },
  {
    name: "data_delete",
    description: "Delete a managed database and its data; unused days go back to the balance. Cannot be undone. " +
      "Scope databases:write.",
    inputSchema: obj({ id: DATA_ID, confirm: str("The database's name, typed to confirm") }, ["id", "confirm"]),
    annotations: DESTROY,
    run: (api, a) => api.request("DELETE", `/api/data/services/${id(a.id)}`, { body: { confirm: a.confirm } }),
  },
  {
    name: "domains_list",
    description: "A server's own domains: each one's status and the two records to set. A server with its own address " +
      "(own_address true) needs only an A record at your DNS. Scope dns:read.",
    inputSchema: obj({ server_id: SERVER_ID }, ["server_id"]),
    annotations: READ,
    run: (api, a) => api.get(`/api/servers/${id(a.server_id)}/domains`),
  },
  {
    name: "domains_add",
    description: "Add your own domain to a small server. Set the A and TXT records in the answer; we check them, turn on " +
      "HTTPS and route the domain to the server. Scope dns:write.",
    inputSchema: obj({ server_id: SERVER_ID, domain: str("Domain, e.g. shop.example.com") }, ["server_id", "domain"]),
    run: (api, a) => api.post(`/api/servers/${id(a.server_id)}/domains`, { domain: a.domain }),
  },
  {
    name: "domains_check",
    description: "Check a domain's records again now, or restart one that stopped trying. Scope dns:write.",
    inputSchema: obj({ server_id: SERVER_ID, domain_id: int("Domain id from domains_list") }, ["server_id", "domain_id"]),
    run: (api, a) => api.post(`/api/servers/${id(a.server_id)}/domains/${id(a.domain_id)}/check`, {}),
  },
  {
    name: "domains_remove",
    description: "Take a domain off a server. Scope dns:write.",
    inputSchema: obj({ server_id: SERVER_ID, domain_id: int("Domain id from domains_list") }, ["server_id", "domain_id"]),
    annotations: DESTROY,
    run: (api, a) => api.del(`/api/servers/${id(a.server_id)}/domains/${id(a.domain_id)}`),
  },
  {
    name: "dns_list_zones",
    description: "Your DNS zones on the free tport.cloud nameservers, the nameservers to set at your registrar and " +
      "the record types offered. Scope dns:read.",
    inputSchema: obj({}),
    annotations: READ,
    run: (api) => api.get("/api/dns"),
  },
  {
    name: "dns_get_zone",
    description: "All records of one zone. Scope dns:read.",
    inputSchema: obj({ zone: str("Domain, e.g. example.com") }, ["zone"]),
    annotations: READ,
    run: (api, a) => api.get(`/api/dns/zones/${id(a.zone)}`),
  },
  {
    name: "dns_add_zone",
    description: "Host a domain on the free tport.cloud nameservers, optionally with an apex A/AAAA record. " +
      "Scope dns:write.",
    inputSchema: obj({ zone: str("Domain, e.g. example.com"), ip: str("Optional IPv4/IPv6 for the apex record") },
      ["zone"]),
    run: (api, a) => api.post("/api/dns/zones", { name: a.zone, ...pick(a, ["ip"]) }),
  },
  {
    name: "dns_delete_zone",
    description: "Delete a zone and all its records. Scope dns:write.",
    inputSchema: obj({ zone: str("Domain"), confirm: str("The domain again, typed to confirm") }, ["zone", "confirm"]),
    annotations: DESTROY,
    run: (api, a) => api.del(`/api/dns/zones/${id(a.zone)}`, { confirm: a.confirm }),
  },
  {
    name: "dns_add_record",
    description: "Add a record (A, AAAA, CNAME, MX, TXT, SRV, CAA, NS...), or edit one by passing the old value in " +
      "replace. Scope dns:write.",
    inputSchema: obj({
      zone: str("Domain"),
      name: str("Record name: @ for the apex, or a label like www"),
      type: str("Record type, e.g. A, CNAME, MX, TXT"),
      value: str("Record value, e.g. an IP, a host name or the TXT text"),
      ttl: int("TTL in seconds"),
      priority: int("MX and SRV priority"),
      weight: int("SRV weight"),
      port: int("SRV port"),
      flags: int("CAA flags (default 0)"),
      tag: str("CAA tag: issue, issuewild or iodef"),
      replace: str("Edit: the current value of the record this one replaces"),
    }, ["zone", "type", "value"]),
    run: (api, a) => api.post(`/api/dns/zones/${id(a.zone)}/records`,
      pick(a, ["name", "type", "value", "ttl", "priority", "weight", "port", "flags", "tag", "replace"])),
  },
  {
    name: "dns_delete_record",
    description: "Delete records by name and type, or just the one with this value. Scope dns:write.",
    inputSchema: obj({
      zone: str("Domain"),
      name: str("Record name (@ for the apex)"),
      type: str("Record type"),
      content: str("Only the record with this value (otherwise every record of that name and type)"),
    }, ["zone", "name", "type"]),
    annotations: DESTROY,
    run: (api, a) => api.del(`/api/dns/zones/${id(a.zone)}/records`,
      { name: a.name, type: a.type, content: a.content }),
  },
  {
    name: "get_billing",
    description: "Account balance, monthly spend and recent ledger lines. Scope billing:read.",
    inputSchema: obj({}),
    annotations: READ,
    run: (api) => api.get("/api/billing"),
  },
];
