#!/usr/bin/env node
// tport.cloud MCP server over stdio: `npx tport-cloud-mcp` with TPORT_API_KEY set (TPORT_API_URL to point elsewhere).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_API_URL, TportApi } from "./api.js";
import { makeServer } from "./server.js";

if (!process.env.TPORT_API_KEY) {
  console.error("tport-cloud-mcp: set TPORT_API_KEY (make a key with the scopes you want at https://app.tport.cloud)");
}
const api = new TportApi(process.env.TPORT_API_KEY ?? "", process.env.TPORT_API_URL || DEFAULT_API_URL);
await makeServer(api).connect(new StdioServerTransport());
