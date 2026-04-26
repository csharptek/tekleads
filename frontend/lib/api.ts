const BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new Error("NEXT_PUBLIC_API_URL is not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(init?.headers || {}),
      },
      // removed cache: "no-store" — use cache-busting via query param instead
      cache: "no-cache",
      keepalive: true,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : res.statusText);
      throw new Error(`${res.status}: ${msg}`);
    }
    return data as T;
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("Request timed out");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// cache-bust helper for GET requests to prevent stale Android WebView cache
function bustCache(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}_t=${Date.now()}`;
}

export const api = {
  get:    <T = any>(path: string) => call<T>(bustCache(path)),
  post:   <T = any>(path: string, body: unknown) =>
    call<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put:    <T = any>(path: string, body: unknown) =>
    call<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T = any>(path: string) =>
    call<T>(path, { method: "DELETE" }),
  del:    <T = any>(path: string, body: unknown) =>
    call<T>(path, { method: "DELETE", body: JSON.stringify(body) }),
  upload: async <T = any>(path: string, formData: FormData): Promise<T> => {
    if (!BASE) throw new Error("NEXT_PUBLIC_API_URL is not set");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        body: formData,
        cache: "no-cache",
        keepalive: true,
        signal: controller.signal,
        headers: { "Accept": "application/json" },
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : res.statusText);
        throw new Error(`${res.status}: ${msg}`);
      }
      return data as T;
    } catch (err: any) {
      if (err.name === "AbortError") throw new Error("Upload timed out");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  },
};

export const API_BASE = BASE;
