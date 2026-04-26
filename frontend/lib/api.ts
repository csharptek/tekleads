const BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) throw new Error("NEXT_PUBLIC_API_URL is not set");
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
    ...init,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : res.statusText);
    throw new Error(`${res.status}: ${msg}`);
  }
  return data as T;
}

export const api = {
  get:    <T = any>(path: string) => call<T>(path),
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
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      body: formData,
      cache: "no-store",
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : res.statusText);
      throw new Error(`${res.status}: ${msg}`);
    }
    return data as T;
  },
};

export const API_BASE = BASE;
