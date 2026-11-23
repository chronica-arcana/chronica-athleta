// Vercel-Funktion: Garmin Connect Personal API (offiziell). Jeder Nutzer trägt seinen EIGENEN Personal-API-Key ein
// (Garmin Connect Web → Personal API Key). Der Key wird mit AES-256-GCM verschlüsselt gespeichert (Server-Schlüssel
// GARMIN_ENC_KEY) und nur serverseitig genutzt: nie an den Browser zurückgegeben, nie geloggt.
//
// Aktionen (POST JSON, Header Authorization: Bearer <Supabase-JWT>):
//   connect {apiKey}  prüft den Key gegen den Token-Endpunkt und speichert ihn verschlüsselt
//   status            Verbindungsstatus
//   disconnect        löscht den gespeicherten Key
//   sync {days}       Token holen (dokumentiert); Datenabruf: siehe fetchPersonalData (Endpunkte noch offen)
// Umgebungsvariablen: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GARMIN_ENC_KEY (32 Byte, base64)
import crypto from "node:crypto";
import {json, readBody, timedFetch, authenticate} from "./_lib.js";

// Laut Garmin-Doku (Personal API): API-Key wird gegen ein Access-Token getauscht.
export const TOKEN_URL = "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* ---------- Verschlüsselung ---------- */
function encKey(env) {
  const k = Buffer.from(env.GARMIN_ENC_KEY || "", "base64");
  if (k.length !== 32) throw new ApiError(503, "Server nicht konfiguriert (GARMIN_ENC_KEY: 32 Byte, base64).");
  return k;
}
export function encrypt(plain, env = process.env) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", encKey(env), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}
export function decrypt(blob, env = process.env) {
  const [v, iv, tag, ct] = String(blob || "").split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new ApiError(409, "Gespeicherter Key ist unlesbar – bitte neu verbinden.");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(env), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  try { return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8"); }
  catch { throw new ApiError(409, "Gespeicherter Key ist unlesbar – bitte neu verbinden."); }
}

/* ---------- Supabase (Service-Key, immer mit user_id-Filter) ---------- */
function db(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError(503, "Server nicht konfiguriert (Supabase).");
  const h = {apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`};
  const url = `${env.SUPABASE_URL}/rest/v1/garmin_links`;
  return {
    async get(uid) { const r = await timedFetch(`${url}?user_id=eq.${encodeURIComponent(uid)}&select=*`, {headers: h}, 8000); if (!r.ok) throw new ApiError(502, "Datenbank nicht erreichbar."); const rows = await r.json(); return rows[0] || null; },
    async save(uid, fields) {
      const r = await timedFetch(`${url}?on_conflict=user_id`, {method: "POST", headers: {...h, "content-type": "application/json", prefer: "resolution=merge-duplicates"}, body: JSON.stringify({user_id: uid, updated_at: new Date().toISOString(), ...fields})}, 8000);
      if (!r.ok) throw new ApiError(502, "Speichern fehlgeschlagen.");
    },
    async remove(uid) { await timedFetch(`${url}?user_id=eq.${encodeURIComponent(uid)}`, {method: "DELETE", headers: h}, 8000); }
  };
}

/* ---------- Garmin ---------- */
// Tauscht den Personal-API-Key gegen ein Access-Token. Liefert nie Key oder Token nach außen.
export async function exchangeToken(apiKey, env = process.env) {
  let r;
  try { r = await timedFetch(env.GARMIN_TOKEN_URL || TOKEN_URL, {method: "POST", headers: {authorization: `ApiKey ${apiKey}`}}, 15000); }
  catch { throw new ApiError(502, "Garmin ist nicht erreichbar. Bitte später erneut versuchen."); }
  if (r.status === 401 || r.status === 403) throw new ApiError(401, "Der Key wurde von Garmin abgelehnt (ungültig, abgelaufen oder widerrufen).");
  if (r.status === 429) throw new ApiError(429, "Garmin-Limit erreicht, bitte später erneut versuchen.");
  if (!r.ok) throw new ApiError(502, `Garmin hat den Key-Austausch abgelehnt (HTTP ${r.status}).`);
  let body = null; try { body = await r.json(); } catch {}
  return body; // Format laut Doku noch nicht bekannt: wird in fetchPersonalData ausgewertet
}

// Datenabruf: Die Endpunkte der Personal API stehen nicht in dem mir vorliegenden Doku-Ausschnitt (nur der Token-Austausch).
// Hier wird bewusst nichts geraten. Sobald Pfade und Antwortformate vorliegen, wird diese Funktion implementiert
// und liefert {activities: [...], daily: [...]} im Format von engine/garmin.js (normalizeExport).
export async function fetchPersonalData(/* token, from, to */) {
  throw new ApiError(501, "Der Datenabruf der Personal API ist noch nicht eingebaut. Der Key ist gespeichert und gültig; bis dahin bitte den Datei-Import nutzen.");
}

/* ---------- Aktionen ---------- */
const ACTIONS = {
  async connect(uid, body, env) {
    const key = String(body.apiKey || "").trim();
    if (key.length < 10 || key.length > 600 || /\s/.test(key)) throw new ApiError(400, "Bitte den Personal API Key aus Garmin Connect einfügen (ohne Leerzeichen).");
    encKey(env); // Konfiguration früh prüfen, bevor etwas gespeichert wird
    await exchangeToken(key, env);
    await db(env).save(uid, {status: "connected", token_cipher: encrypt(JSON.stringify({apiKey: key, savedAt: new Date().toISOString()}), env), mfa_cipher: null, last_error: null});
    return {status: "connected"};
  },
  async status(uid, body, env) {
    const row = await db(env).get(uid);
    return {status: row ? row.status : "none", last_sync_at: row ? row.last_sync_at : null, last_error: row ? row.last_error : null};
  },
  async disconnect(uid, body, env) { await db(env).remove(uid); return {ok: true}; },
  async sync(uid, body, env) {
    const store = db(env), row = await store.get(uid);
    if (!row || row.status !== "connected" || !row.token_cipher) throw new ApiError(409, "Garmin ist nicht verbunden.");
    const {apiKey} = JSON.parse(decrypt(row.token_cipher, env));
    let token;
    try { token = await exchangeToken(apiKey, env); }
    catch (e) { if (e.status === 401) await store.save(uid, {status: "error", last_error: "Key abgelehnt oder abgelaufen"}); throw e; }
    const days = Math.max(1, Math.min(45, parseInt(body.days, 10) || 14));
    const to = new Date(), from = new Date(Date.now() - days * 864e5);
    const data = await fetchPersonalData(token, from, to);
    return {activities: (data.activities || []).length, daily: (data.daily || []).length};
  }
};

export default async function handler(req, res, env = process.env) {
  res.setHeader("x-content-type-options", "nosniff");
  try {
    if (req.method === "GET") return json(res, 200, {ok: true, function: "garmin", encKey: Buffer.from(env.GARMIN_ENC_KEY || "", "base64").length === 32, supabaseServiceKey: !!env.SUPABASE_SERVICE_ROLE_KEY, dataFetchImplemented: false});
    if (req.method !== "POST") return json(res, 405, {error: "Nur POST."});
    let body; try { body = await readBody(req); } catch { return json(res, 400, {error: "Ungültige Anfrage."}); }
    const action = body && body.action;
    if (!action || !Object.prototype.hasOwnProperty.call(ACTIONS, action)) return json(res, 400, {error: "Unbekannte Aktion."});
    let uid; try { uid = await authenticate(req, env); } catch { return json(res, 503, {error: "Anmeldeprüfung nicht erreichbar."}); }
    if (!uid) return json(res, 401, {error: "Bitte anmelden."});
    return json(res, 200, await ACTIONS[action](uid, body, env));
  } catch (e) {
    if (e instanceof ApiError) return json(res, e.status, {error: e.message});
    return json(res, 500, {error: "Interner Fehler."}); // nie Details/Key nach außen
  }
}
