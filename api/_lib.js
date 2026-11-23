// Gemeinsame Helfer für die serverlosen Funktionen (Dateien mit "_" am Anfang sind bei Vercel keine eigenen Endpunkte).
export const json = (res, status, body) => { res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(body)); };

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 60000) throw new Error("too large"); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export async function timedFetch(url, opts, ms = 25000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, {...opts, signal: ctl.signal}); } finally { clearTimeout(t); }
}

// Prüft das Supabase-Login-Token und liefert die Nutzer-ID (oder null)
export async function authenticate(req, env = process.env) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const r = await timedFetch(`${env.SUPABASE_URL}/auth/v1/user`, {headers: {apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}`}}, 8000);
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u.id : null;
}
