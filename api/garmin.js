// Vercel-Funktion: Garmin Connect Personal API (offiziell). Jeder Nutzer trägt seinen EIGENEN Personal-API-Key ein
// (Garmin Connect Web → Personal API Key). Der Key wird mit AES-256-GCM verschlüsselt gespeichert (Server-Schlüssel
// GARMIN_ENC_KEY) und nur serverseitig genutzt: nie an den Browser zurückgegeben, nie geloggt.
//
// Aktionen (POST JSON, Header Authorization: Bearer <Supabase-JWT>):
//   connect {apiKey}  prüft den Key gegen den Token-Endpunkt und speichert ihn verschlüsselt
//   status            Verbindungsstatus
//   disconnect        löscht den gespeicherten Key
//   sync {days}       Token holen, Aktivitäten/Schlaf/HRV/Ruhepuls/Body Battery abrufen und speichern
//   diagnose          zeigt die Struktur (nur Feldnamen) der Garmin-Antworten – zur Fehlersuche, ohne persönliche Werte
// Umgebungsvariablen: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GARMIN_ENC_KEY (32 Byte, base64)
import crypto from "node:crypto";
import {json, readBody, timedFetch, authenticate} from "./_lib.js";
import {mapActivity, mapSleep, mapHrv, mapRestingHr, mapBodyBattery, mapSteps, mapStress, mapVo2, asList, mergeDaily, shapeOf} from "./_garmin-map.js";

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
    async upsertRows(table, rows, conflict) {
      for (let i = 0; i < rows.length; i += 200) {
        const r = await timedFetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {method: "POST", headers: {...h, "content-type": "application/json", prefer: "resolution=merge-duplicates"}, body: JSON.stringify(rows.slice(i, i + 200))}, 15000);
        if (!r.ok) throw new ApiError(502, "Speichern der Garmin-Daten fehlgeschlagen.");
      }
    },
    async remove(uid) { await timedFetch(`${url}?user_id=eq.${encodeURIComponent(uid)}`, {method: "DELETE", headers: h}, 8000); }
  };
}

/* ---------- Garmin ---------- */
// Tauscht den Personal-API-Key gegen ein Access-Token. Liefert die Rohantwort {status, contentType, text, json};
// Key und Token verlassen den Server nie.
export async function exchangeToken(apiKey, env = process.env) {
  let r;
  try { r = await timedFetch(env.GARMIN_TOKEN_URL || TOKEN_URL, {method: "POST", headers: {authorization: `ApiKey ${apiKey}`}}, 15000); }
  catch { throw new ApiError(502, "Garmin ist nicht erreichbar. Bitte später erneut versuchen."); }
  if (r.status === 401 || r.status === 403) throw new ApiError(401, "Der Key wurde von Garmin abgelehnt (ungültig, abgelaufen oder widerrufen).");
  if (r.status === 429) throw new ApiError(429, "Garmin-Limit erreicht, bitte später erneut versuchen.");
  if (!r.ok) throw new ApiError(502, `Garmin hat den Key-Austausch abgelehnt (HTTP ${r.status}).`);
  let text = ""; try { text = await r.text(); } catch {}
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return {status: r.status, contentType: (r.headers && r.headers.get && r.headers.get("content-type")) || "", text, json: parsed};
}

// Access-Token aus der Antwort lesen: Format laut Doku nicht beschrieben -> tolerant (JSON mit access_token/accessToken/token,
// verschachtelt, JWT irgendwo, oder reiner Text).
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
export function extractAccessToken(res) {
  const fromObj = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 3) return null;
    for (const k of ["access_token", "accessToken", "token", "id_token", "jwt", "bearer", "bearerToken", "accessTokenValue"]) if (typeof o[k] === "string" && o[k].length > 15) return o[k];
    for (const [k, v] of Object.entries(o)) if (typeof v === "string" && (JWT.test(v) || (/token/i.test(k) && v.length > 20 && !/refresh/i.test(k)))) return v;
    for (const v of Object.values(o)) { const t = fromObj(v, depth + 1); if (t) return t; }
    return null;
  };
  if (res.json && typeof res.json === "object") return fromObj(res.json, 0);
  if (typeof res.json === "string" && res.json.length > 15) return res.json;
  const t = String(res.text || "").trim().replace(/^"|"$/g, "").replace(/^Bearer\s+/i, "");
  return t.length > 15 && !/\s/.test(t) ? t : null;
}
const describeResponse = res => res.json && typeof res.json === "object"
  ? `JSON, Felder: ${Object.keys(res.json).slice(0, 12).join(", ") || "(leer)"}`
  : `${res.text ? "kein JSON, " + res.text.length + " Zeichen" : "leere Antwort"}`;
const accessToken = res => { const t = extractAccessToken(res); if (!t) throw new ApiError(502, `Unerwartete Antwort des Garmin-Token-Endpunkts (HTTP ${res.status}, ${String(res.contentType).split(";")[0] || "ohne Content-Type"}, ${describeResponse(res)}). Bitte im Profil die Diagnose ausführen.`); return t; };

const apiBase = env => (env.GARMIN_API_BASE || "https://personal.connectapi.garmin.com").replace(/\/$/, "");

async function gget(env, token, path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  try {
    const r = await timedFetch(`${apiBase(env)}${path}${qs ? "?" + qs : ""}`, {headers: {authorization: `Bearer ${token}`, accept: "application/json"}}, 12000);
    let data = null; try { data = await r.json(); } catch {}
    return {status: r.status, ok: r.ok, data};
  } catch { return {status: 0, ok: false, data: null}; }
}
async function pool(items, size, fn) { const out = []; let i = 0; await Promise.all(Array.from({length: size}, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
const isoDay = d => d.toISOString().slice(0, 10);

// Pfade laut Swagger-Übersicht der Personal API; Parameter/Feldnamen siehe _garmin-map.js (noch nicht gegen echten Account bestätigt)
const ENDPOINTS = {
  activities: (from, to) => ["/activitylist-service/activities/search/activities", {startDate: from, endDate: to, start: 0, limit: 200}],
  hrv: (from, to) => [`/hrv-service/hrv/daily/${from}/${to}`, {}],
  bodyBattery: (from, to) => ["/wellness-service/wellness/bodyBattery/reports/daily", {startDate: from, endDate: to}],
  steps: (from, to) => [`/usersummary-service/stats/steps/daily/${from}/${to}`, {}],
  stress: (from, to) => [`/usersummary-service/stats/stress/daily/${from}/${to}`, {}],
  vo2max: (from, to) => [`/metrics-service/metrics/maxmet/daily/${from}/${to}`, {}],
  sleep: date => ["/sleep-service/sleep/dailySleep", {date}],
  heartRate: date => ["/wellness-service/wellness/dailyHeartRate", {date}]
};

export async function fetchPersonalData(token, from, to, env = process.env) {
  const f = isoDay(from), t = isoDay(to), report = {}, note = (name, r, n) => { const e = report[name] || (report[name] = {ok: 0, failed: 0, items: 0, lastStatus: null}); r.ok ? e.ok++ : e.failed++; e.items += n || 0; e.lastStatus = r.status; };
  const days = []; for (let d = new Date(from); isoDay(d) <= t; d = new Date(d.getTime() + 864e5)) days.push(isoDay(d));
  const [acts, hrv, bb, stp, vo2, str] = await Promise.all([["activities", f, t], ["hrv", f, t], ["bodyBattery", f, t], ["steps", f, t], ["vo2max", f, t], ["stress", f, t]].map(async ([name, a, b]) => { const r = await gget(env, token, ...ENDPOINTS[name](a, b)); return {name, r}; }));
  const activities = asList(acts.r.data).map(mapActivity).filter(Boolean); note("activities", acts.r, activities.length);
  const hrvParts = asList(hrv.r.data).map(mapHrv).filter(Boolean); note("hrv", hrv.r, hrvParts.length);
  const bbParts = asList(bb.r.data).map(mapBodyBattery).filter(Boolean); note("bodyBattery", bb.r, bbParts.length);
  const stepParts = asList(stp.r.data).map(mapSteps).filter(Boolean); note("steps", stp.r, stepParts.length);
  const vo2Parts = asList(vo2.r.data).map(mapVo2).filter(Boolean); note("vo2max", vo2.r, vo2Parts.length);
  const stressParts = asList(str.r.data).map(mapStress).filter(Boolean); note("stress", str.r, stressParts.length);
  const perDay = await pool(days, 5, async date => {
    const [s, h] = await Promise.all([gget(env, token, ...ENDPOINTS.sleep(date)), gget(env, token, ...ENDPOINTS.heartRate(date))]);
    const sp = s.ok ? mapSleep(s.data, date) : null, hp = h.ok ? mapRestingHr(h.data, date) : null;
    note("sleep", s, sp ? 1 : 0); note("heartRate", h, hp ? 1 : 0);
    return [sp, hp];
  });
  const rs = [acts.r, hrv.r, bb.r, stp.r, vo2.r, str.r];
  if (rs.every(r => r.status === 401 || r.status === 403)) throw new ApiError(401, "Garmin hat den Zugriff verweigert – Key abgelaufen oder widerrufen?");
  return {activities, daily: mergeDaily([hrvParts, bbParts, stepParts, vo2Parts, stressParts, ...perDay]), report};
}

// Fehlersuche: Struktur (nur Feldnamen) der echten Antworten
export async function diagnose(token, env = process.env) {
  const to = new Date(), from = new Date(Date.now() - 14 * 864e5), f = isoDay(from), t = isoDay(to), y = isoDay(new Date(Date.now() - 864e5)), out = {};
  const calls = {activities: ENDPOINTS.activities(f, t), hrv: ENDPOINTS.hrv(f, t), bodyBattery: ENDPOINTS.bodyBattery(f, t), steps: ENDPOINTS.steps(f, t), vo2max: ENDPOINTS.vo2max(f, t), stress: ENDPOINTS.stress(f, t), sleep: ENDPOINTS.sleep(y), heartRate: ENDPOINTS.heartRate(y),
    // nur Diagnose: enthält dailysummaries Bereitschafts-/Erholungswerte (Training Readiness, Recovery Time)?
    dailySummaries: ["/usersummary-service/v2/dailysummaries", {startDate: y, endDate: y}, 6], userSummaryDaily: ["/usersummary-service/usersummary/daily", {calendarDate: y}]};
  await Promise.all(Object.entries(calls).map(async ([name, [path, params, depth]]) => { const r = await gget(env, token, path, params); out[name] = {path, params, status: r.status, shape: shapeOf(r.data, depth || 3)}; }));
  return out;
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
    const minGap = env.GARMIN_MIN_SYNC_SECONDS !== undefined ? Number(env.GARMIN_MIN_SYNC_SECONDS) : 120;
    if (row.last_sync_at && Date.now() - Date.parse(row.last_sync_at) < minGap * 1000) throw new ApiError(429, "Bitte kurz warten – es wurde gerade synchronisiert.");
    const token = await freshToken(uid, row, store, env);
    const days = Math.max(1, Math.min(45, parseInt(body.days, 10) || 14));
    let data;
    try { data = await fetchPersonalData(token, new Date(Date.now() - days * 864e5), new Date(), env); }
    catch (e) { if (e.status === 401) await store.save(uid, {status: "error", last_error: "Zugriff verweigert (Key abgelaufen oder widerrufen)"}); throw e; }
    if (data.activities.length) await store.upsertRows("garmin_activities", data.activities.map(({id, date, ...rest}) => ({user_id: uid, id, date, data: rest})), "user_id,id");
    if (data.daily.length) await store.upsertRows("garmin_daily", data.daily.map(({date, ...rest}) => ({user_id: uid, date, data: rest})), "user_id,date");
    const failed = Object.entries(data.report).filter(([, v]) => v.ok === 0 && v.failed > 0).map(([k, v]) => `${k} (HTTP ${v.lastStatus})`);
    await store.save(uid, {last_sync_at: new Date().toISOString(), last_error: failed.length ? `Nicht abrufbar: ${failed.join(", ")}`.slice(0, 200) : null});
    return {activities: data.activities.length, daily: data.daily.length, report: data.report};
  },
  async diagnose(uid, body, env) {
    const store = db(env), row = await store.get(uid);
    if (!row || row.status !== "connected" || !row.token_cipher) throw new ApiError(409, "Garmin ist nicht verbunden.");
    const {apiKey} = JSON.parse(decrypt(row.token_cipher, env));
    const res = await exchangeToken(apiKey, env);  // 401 -> Fehlermeldung "Key abgelehnt"
    const out = {tokenResponse: {status: res.status, contentType: String(res.contentType).split(";")[0], shape: res.json !== null ? shapeOf(res.json) : (res.text ? `text (${res.text.length} Zeichen)` : "leer"), tokenFound: !!extractAccessToken(res)}};
    const token = extractAccessToken(res);
    out.endpoints = token ? await diagnose(token, env) : null;
    return out;
  }
};

async function freshToken(uid, row, store, env) {
  const {apiKey} = JSON.parse(decrypt(row.token_cipher, env));
  try { return accessToken(await exchangeToken(apiKey, env)); }
  catch (e) { if (e.status === 401) await store.save(uid, {status: "error", last_error: "Key abgelehnt oder abgelaufen"}); throw e; }
}

export default async function handler(req, res, env = process.env) {
  res.setHeader("x-content-type-options", "nosniff");
  try {
    if (req.method === "GET") return json(res, 200, {ok: true, function: "garmin", encKey: Buffer.from(env.GARMIN_ENC_KEY || "", "base64").length === 32, supabaseServiceKey: !!env.SUPABASE_SERVICE_ROLE_KEY, dataFetchImplemented: true});
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
