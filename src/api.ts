// Thin client for the tport.cloud API. Every call sends the API key as a Bearer token; the API checks the key's
// scopes and answers 403 naming the missing one, so this client never second-guesses permissions.

export const DEFAULT_API_URL = "https://api.tport.cloud";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined>;

export class TportApi {
  constructor(private key: string, private base: string = DEFAULT_API_URL) {
    this.base = base.replace(/\/+$/, "");
  }

  async request(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<unknown> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "tport-cloud-mcp" };
    if (this.key) headers.Authorization = `Bearer ${this.key}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (a proxy error page): keep the text
    }
    if (!res.ok) throw new ApiError(res.status, errorText(res.status, data));
    return data;
  }

  get = (path: string, query?: Query) => this.request("GET", path, { query });
  post = (path: string, body: unknown = {}) => this.request("POST", path, { body });
  put = (path: string, body: unknown) => this.request("PUT", path, { body });
  del = (path: string, query?: Query) => this.request("DELETE", path, { query });
}

// FastAPI sends {"detail": "..."} (or a list of validation errors); show the API's own words.
function errorText(status: number, data: unknown): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return `${status}: ${detail}`;
  if (Array.isArray(detail)) {
    return `${status}: ` + detail.map((d) => `${(d.loc ?? []).slice(1).join(".")} ${d.msg ?? ""}`.trim()).join("; ");
  }
  if (status === 401) return "401: the API key was refused (check TPORT_API_KEY; make one at https://app.tport.cloud)";
  return `${status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data)}`;
}
