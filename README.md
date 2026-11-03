# tport-cloud-mcp

MCP server for [tport.cloud](https://tport.cloud): order and manage servers, managed databases and free DNS from
Claude, Cursor or any MCP client. It runs on your machine over stdio and calls the tport.cloud API with your API key.

## Set up

1. In the console (https://app.tport.cloud) make an API key and tick only the scopes you want the assistant to have.
   A key can only do what its scopes allow; the API refuses the rest (403 naming the missing scope).
2. Add the server to your MCP client.

Claude Desktop (`claude_desktop_config.json`) or Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tport-cloud": {
      "command": "npx",
      "args": ["-y", "tport-cloud-mcp"],
      "env": { "TPORT_API_KEY": "tpct_..." }
    }
  }
}
```

Claude Code: `claude mcp add tport-cloud -e TPORT_API_KEY=tpct_... -- npx -y tport-cloud-mcp`

| Env | Meaning |
| --- | --- |
| `TPORT_API_KEY` | Your API key (`tpct_...`). Needed for everything except `list_plans`. |
| `TPORT_API_URL` | Optional, default `https://api.tport.cloud`. |

## Tools

| Tool | Does | Scope |
| --- | --- | --- |
| `list_plans` | Plans, prices, regions, images, installs, availability | none |
| `list_servers`, `get_server`, `get_order` | Your servers and shared accounts, one in detail, an order's progress | `servers:read` |
| `create_server` | Order a root server or shared account (charged from the balance) | `servers:create` |
| `resize_server` | Move to another plan of the same kind | `servers:resize` |
| `power` | Start, stop, restart | `servers:power` |
| `delete_server` | Delete (typed name to confirm; unused days credited) | `servers:delete` |
| `data_catalogue` | Database engines, add-ons, prices, sizes per region, availability | none |
| `data_list`, `data_get` | Your managed databases, one in detail (the login, once) | `databases:read` |
| `data_create`, `data_set_allow`, `data_resize`, `data_delete` | Order, allow list, resize, delete | `databases:write` |
| `databases_list`, `databases_get` | Primary + standby PostgreSQL clusters | `databases:read` |
| `databases_create`, `databases_set_allow`, `databases_delete` | Order, allow list, delete | `databases:write` |
| `domains_list` | A server's own domains and the records to set | `dns:read` |
| `domains_add`, `domains_check`, `domains_remove` | Your own domain on a small server | `dns:write` |
| `dns_list_zones`, `dns_get_zone` | Zones and records on the free nameservers | `dns:read` |
| `dns_add_zone`, `dns_delete_zone`, `dns_add_record`, `dns_delete_record` | Change zones and records | `dns:write` |
| `get_billing` | Balance and ledger | `billing:read` |

A new database's login is shown once, by the first `data_get` after setup, so your assistant sees it and it can't be
read again. Deleting asks for the item's name in `confirm`, as the console does. Errors come back as the API's own message.

## Develop

```sh
npm install
npm test              # stub API on 127.0.0.1, end to end through an MCP client
TPORT_LIVE=1 npm test # also read-only checks against the real API (add TPORT_API_KEY to list your servers)
npm run build         # build/index.js, the `tport-cloud-mcp` bin
```

MIT licence. (c) Biz59 LLC.
