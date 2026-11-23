import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import handler, {encrypt, decrypt, TOKEN_URL} from "../api/garmin.js";

const server = fn => new Promise(r => { const s = http.createServer(fn); s.listen(0, () => r(s)); });
const call = async (env, {method = "POST", headers = {authorization: "Bearer good"}, body = {}} = {}) => {
  const out = {}, res = {statusCode: 200, setHeader() {}, end: s => { out.body = JSON.parse(s); out.status = res.statusCode; }};
  await handler({method, headers, body}, res, env); return out;
};
const KEY = crypto.randomBytes(32).toString("base64"), USER_KEY = "pk_live_ABCDEF1234567890SECRET";

async function setup() {
  const rows = new Map(), log = {tokenCalls: [], saved: []};
  const garmin = await server((q, r) => { log.tokenCalls.push({url: q.url, auth: q.headers.authorization, method: q.method});
    if (q.headers.authorization === `ApiKey ${USER_KEY}`) { r.setHeader("content-type", "application/json"); return r.end('{"access_token":"TOKEN-SECRET","expires_in":3600}'); }
    r.statusCode = q.headers.authorization === "ApiKey expired" ? 403 : 401; r.end("{}"); });
  const sb = await server((q, r) => { let b = ""; q.on("data", c => b += c); q.on("end", () => {
    r.setHeader("content-type", "application/json");
    if (q.url === "/auth/v1/user") { if (q.headers.authorization === "Bearer good") return r.end('{"id":"u1"}'); r.statusCode = 401; return r.end("{}"); }
    if (q.url.startsWith("/rest/v1/garmin_links")) {
      if (q.method === "GET") { const uid = decodeURIComponent(q.url.match(/user_id=eq\.([^&]+)/)[1]); return r.end(JSON.stringify(rows.has(uid) ? [rows.get(uid)] : [])); }
      if (q.method === "POST") { const row = JSON.parse(b); log.saved.push(row); rows.set(row.user_id, {...(rows.get(row.user_id) || {}), ...row}); return r.end("[]"); }
      if (q.method === "DELETE") { rows.delete(decodeURIComponent(q.url.match(/user_id=eq\.([^&]+)/)[1])); return r.end("[]"); }
    }
    r.statusCode = 404; r.end("{}"); }); });
  const env = {SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "svc", GARMIN_ENC_KEY: KEY, GARMIN_TOKEN_URL: `http://127.0.0.1:${garmin.address().port}/token`};
  return {env, rows, log, close: () => { garmin.close(); sb.close(); }};
}

test("Verschlüsselung: Roundtrip, Manipulation und falscher Schlüssel werden erkannt", () => {
  const env = {GARMIN_ENC_KEY: KEY}, blob = encrypt("geheim", env);
  assert.ok(!blob.includes("geheim")); assert.equal(decrypt(blob, env), "geheim");
  assert.notEqual(encrypt("geheim", env), blob, "zufälliger IV");
  assert.throws(() => decrypt(blob.slice(0, -4) + "AAAA", env), /unlesbar/);
  assert.throws(() => decrypt(blob, {GARMIN_ENC_KEY: crypto.randomBytes(32).toString("base64")}), /unlesbar/);
  assert.throws(() => encrypt("x", {GARMIN_ENC_KEY: "zu-kurz"}), /nicht konfiguriert/);
});
test("Token-URL entspricht der Garmin-Doku", () => assert.equal(TOKEN_URL, "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token"));

test("Garmin-Funktion: Login-Pflicht, Key-Prüfung, verschlüsselte Ablage, nie Key/Token in Antworten", async () => {
  const s = await setup();
  try {
    const health = await call(s.env, {method: "GET", headers: {}});
    assert.deepEqual([health.body.encKey, health.body.supabaseServiceKey], [true, true]); assert.ok(!JSON.stringify(health.body).includes(KEY));
    assert.equal((await call(s.env, {method: "PUT"})).status, 405);
    assert.equal((await call(s.env, {headers: {}, body: {action: "status"}})).status, 401);
    assert.equal((await call(s.env, {headers: {authorization: "Bearer bad"}, body: {action: "status"}})).status, 401);
    assert.equal((await call(s.env, {body: {action: "boese"}})).status, 400);
    assert.equal((await call(s.env, {body: {action: "connect", apiKey: "kurz"}})).status, 400);
    assert.equal((await call(s.env, {body: {action: "connect", apiKey: "mit leerzeichen drin"}})).status, 400);
    assert.equal((await call({...s.env, GARMIN_ENC_KEY: ""}, {body: {action: "connect", apiKey: USER_KEY}})).status, 503);
    assert.equal(s.log.saved.length, 0, "bei Konfigurationsfehler/ungültigem Key wird nichts gespeichert");

    const bad = await call(s.env, {body: {action: "connect", apiKey: "falscher-key-1234567890"}});
    assert.equal(bad.status, 401); assert.match(bad.body.error, /abgelehnt/); assert.equal(s.log.saved.length, 0);
    assert.equal((await call(s.env, {body: {action: "connect", apiKey: "expired"+"x".repeat(10)}})).status, 401);

    const ok = await call(s.env, {body: {action: "connect", apiKey: USER_KEY}});
    assert.deepEqual([ok.status, ok.body], [200, {status: "connected"}]);
    assert.equal(s.log.tokenCalls.at(-1).method, "POST"); assert.equal(s.log.tokenCalls.at(-1).auth, `ApiKey ${USER_KEY}`);
    const stored = s.rows.get("u1");
    assert.equal(stored.status, "connected"); assert.ok(!JSON.stringify(stored).includes(USER_KEY), "Key nie im Klartext in der Datenbank");
    assert.equal(JSON.parse(decrypt(stored.token_cipher, s.env)).apiKey, USER_KEY);
    assert.ok(!JSON.stringify(ok.body).includes(USER_KEY) && !JSON.stringify(ok.body).includes("TOKEN-SECRET"));

    const st = await call(s.env, {body: {action: "status"}});
    assert.equal(st.body.status, "connected"); assert.ok(!JSON.stringify(st.body).includes("cipher"));

    // Sync: Token-Austausch klappt, Datenabruf ist (bewusst) noch nicht implementiert -> klare Meldung, kein Absturz, kein Leak
    const sync = await call(s.env, {body: {action: "sync", days: 7}});
    assert.equal(sync.status, 501); assert.match(sync.body.error, /noch nicht eingebaut/); assert.ok(!JSON.stringify(sync.body).includes("TOKEN-SECRET"));

    // Key bei Garmin widerrufen: Sync markiert Fehlerstatus
    s.rows.set("u1", {...stored, token_cipher: encrypt(JSON.stringify({apiKey: "expired-key-123456"}), s.env)});
    const rev = await call(s.env, {body: {action: "sync"}});
    assert.equal(rev.status, 401); assert.equal(s.rows.get("u1").status, "error");
    assert.equal((await call(s.env, {body: {action: "sync"}})).status, 409, "bei Fehlerstatus kein weiterer Versuch");

    assert.deepEqual((await call(s.env, {body: {action: "disconnect"}})).body, {ok: true});
    assert.equal(s.rows.has("u1"), false);
    assert.equal((await call(s.env, {body: {action: "status"}})).body.status, "none");
    assert.equal((await call(s.env, {body: {action: "sync"}})).status, 409);
  } finally { s.close(); }
});
