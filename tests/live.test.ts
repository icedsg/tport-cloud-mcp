// Read-only checks against the real API, only with TPORT_LIVE=1 (TPORT_API_URL to point at another one). With
// TPORT_API_KEY set it also lists that account's servers; nothing is ever created.
// The catalogue takes about 5 s (it checks host room per plan and region), hence the long timeout.
import { describe, expect, it } from "vitest";
import { ApiError, DEFAULT_API_URL, TportApi } from "../src/api.js";
import { TOOLS } from "../src/tools.js";

const live = process.env.TPORT_LIVE === "1";
const base = process.env.TPORT_API_URL || DEFAULT_API_URL;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe.skipIf(!live)(`live API ${base}`, { timeout: 30_000 }, () => {
  it("list_plans reads the public catalogue", async () => {
    const cat = (await tool("list_plans").run(new TportApi("", base), { kind: "shared" })) as {
      plans: { kind: string; price_cents: number }[]; regions: unknown[];
    };
    expect(cat.plans.length).toBeGreaterThan(0);
    expect(cat.plans.every((p) => p.kind === "shared" && p.price_cents > 0)).toBe(true);
    expect(cat.regions.length).toBeGreaterThan(0);
  });

  it("a made-up key is refused with 401", async () => {
    const err = await tool("list_servers").run(new TportApi("tpct_not-a-real-key", base), {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it.skipIf(!process.env.TPORT_API_KEY)("list_servers with a real key", async () => {
    const out = (await tool("list_servers").run(new TportApi(process.env.TPORT_API_KEY!, base), {})) as {
      servers: unknown[];
    };
    expect(Array.isArray(out.servers)).toBe(true);
  });
});
