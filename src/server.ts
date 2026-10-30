// The MCP server: lists TOOLS and runs them against the API; API errors come back as tool errors in the API's words.
import { readFileSync } from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { TportApi } from "./api.js";
import { TOOLS } from "./tools.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as { version: string };

export function makeServer(api: TportApi): Server {
  const server = new Server({ name: "tport-cloud-mcp", version: pkg.version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool ${req.params.name}` }] };
    try {
      const out = await tool.run(api, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
    }
  });
  return server;
}
