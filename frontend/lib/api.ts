const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text() || res.statusText);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const get = (path: string) => api(path);
export const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body) });
export const del = (path: string) => api(path, { method: 'DELETE' });
