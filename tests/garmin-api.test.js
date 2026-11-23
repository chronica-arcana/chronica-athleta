import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import handler, {encrypt, decrypt, TOKEN_URL} from "../api/garmin.js";
import {extractAccessToken} from "../api/garmin.js";
import {mapActivity, mapSleep, mapHrv, mapRestingHr, mapBodyBattery, mergeDaily, shapeOf, asList} from "../api/_garmin-map.js";

const server = fn => new Promise(r => { const s = http.createServer(fn); s.listen(0, () => r(s)); });
const call = async (env, {method = "POST", headers = {authorization: "Bearer good"}, body = {}} = {}) => {
  const out = {}, res = {statusCode: 200, setHeader() {}, end: s => { out.body = JSON.parse(s); out.status = res.statusCode; }};
  await handler({method, headers, body}, res, env); return out;
};
const TOKEN = "TOKEN-SECRET-0123456789ABCDEF";
const KEY = crypto.randomBytes(32).toString("base64"), USER_KEY = "pk_live_ABCDEF1234567890SECRET";

async function setup() {
  const rows = new Map(), log = {tokenCalls: [], saved: [], dataCalls: [], upserts: {garmin_activities: [], garmin_daily: []}};
  const flags = {failSleep: false, denyData: false, tokenFormat: "snake"}, yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const garmin = await server((q, r) => { const u = new URL(q.url, "http://x"), p = u.pathname; log.tokenCalls.push({url: q.url, auth: q.headers.authorization, method: q.method}); r.setHeader("content-type", "application/json");
    if (p === "/token") {
      if (q.headers.authorization === `ApiKey ${USER_KEY}`) { const f = flags.tokenFormat; if (f === "camel") return r.end(JSON.stringify({accessToken: TOKEN})); if (f === "nested") return r.end(JSON.stringify({data: {tokenValue: TOKEN, expires: 1}})); if (f === "text") { r.setHeader("content-type", "text/plain"); return r.end(TOKEN); } if (f === "unknown") return r.end(JSON.stringify({foo: "bar", n: 1})); return r.end(JSON.stringify({access_token: TOKEN, expires_in: 86400})); }
      r.statusCode = q.headers.authorization === "ApiKey expired" ? 403 : 401; return r.end("{}");
    }
    log.dataCalls.push({path: p, query: Object.fromEntries(u.searchParams), auth: q.headers.authorization});
    if (flags.denyData || q.headers.authorization !== `Bearer ${TOKEN}`) { r.statusCode = 401; return r.end("{}"); }
    if (p === "/activitylist-service/activities/search/activities") return r.end(JSON.stringify([{activityId: 11, activityName: "Morgenlauf-GEHEIM", startTimeLocal: `${yesterday} 07:30:00`, activityType: {typeKey: "running"}, duration: 2700, distance: 8000, averageHR: 150, aerobicTrainingEffect: 3.1, activityTrainingLoad: 120}, {kaputt: true}]));
    if (p.startsWith("/hrv-service/hrv/daily/")) return r.end(JSON.stringify({hrvSummaries: [{calendarDate: yesterday, lastNightAvg: 55, status: "balanced"}]}));
    if (p === "/wellness-service/wellness/bodyBattery/reports/daily") return r.end(JSON.stringify([{date: yesterday, bodyBatteryValuesArray: [[1, 40], [2, 80], [3, 70], [4, 30], [5, 20], [6, 10]]}]));
    if (p === "/sleep-service/sleep/dailySleep") { if (flags.failSleep) { r.statusCode = 404; return r.end("{}"); } return r.end(JSON.stringify({dailySleepDTO: {calendarDate: u.searchParams.get("date"), sleepTimeSeconds: 27000, sleepScores: {overall: {value: 80}}}})); }
    if (p === "/wellness-service/wellness/dailyHeartRate") return r.end(JSON.stringify({calendarDate: u.searchParams.get("date"), restingHeartRate: 51}));
    r.statusCode = 404; r.end("{}"); });
  const sb = await server((q, r) => { let b = ""; q.on("data", c => b += c); q.on("end", () => {
    r.setHeader("content-type", "application/json");
    if (q.url === "/auth/v1/user") { if (q.headers.authorization === "Bearer good") return r.end('{"id":"u1"}'); r.statusCode = 401; return r.end("{}"); }
    const tbl = (q.url.match(/^\/rest\/v1\/(garmin_activities|garmin_daily)/) || [])[1];
    if (tbl && q.method === "POST") { log.upserts[tbl].push(...JSON.parse(b)); return r.end("[]"); }
    if (q.url.startsWith("/rest/v1/garmin_links")) {
      if (q.method === "GET") { const uid = decodeURIComponent(q.url.match(/user_id=eq\.([^&]+)/)[1]); return r.end(JSON.stringify(rows.has(uid) ? [rows.get(uid)] : [])); }
      if (q.method === "POST") { const row = JSON.parse(b); log.saved.push(row); rows.set(row.user_id, {...(rows.get(row.user_id) || {}), ...row}); return r.end("[]"); }
      if (q.method === "DELETE") { rows.delete(decodeURIComponent(q.url.match(/user_id=eq\.([^&]+)/)[1])); return r.end("[]"); }
    }
    r.statusCode = 404; r.end("{}"); }); });
  const env = {SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "svc", GARMIN_ENC_KEY: KEY, GARMIN_TOKEN_URL: `http://127.0.0.1:${garmin.address().port}/token`, GARMIN_API_BASE: `http://127.0.0.1:${garmin.address().port}`, GARMIN_MIN_SYNC_SECONDS: "0"};
  return {env, rows, log, flags, yesterday, close: () => { garmin.close(); sb.close(); }};
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

    // Sync: Token holen, Daten abrufen, mappen, in die Datenbank schreiben
    const sync = await call(s.env, {body: {action: "sync", days: 3}});
    assert.equal(sync.status, 200); assert.equal(sync.body.activities, 1, "ungültige Aktivität wird verworfen");
    assert.equal(sync.body.daily, 4, "4 Tage mit Schlaf+Puls"); assert.ok(!JSON.stringify(sync.body).includes("TOKEN-SECRET"));
    assert.ok(s.log.dataCalls.every(c => c.auth === `Bearer ${TOKEN}`), "Daten nur mit Access-Token, nie mit dem API-Key");
    const act = s.log.upserts.garmin_activities[0];
    assert.deepEqual([act.user_id, act.id, act.date, act.data.type, act.data.durationMin, act.data.distanceKm, act.data.avgHr, act.data.aerobicTE, act.data.trainingLoad], ["u1", "11", s.yesterday, "running", 45, 8, 150, 3.1, 120]);
    const dy = s.log.upserts.garmin_daily.find(d => d.date === s.yesterday);
    assert.deepEqual([dy.user_id, dy.data.sleepHours, dy.data.sleepScore, dy.data.restingHr, dy.data.hrvAvg, dy.data.hrvStatus, dy.data.bodyBatteryMorning], ["u1", 7.5, 80, 51, 55, "BALANCED", 80]);
    assert.ok(s.log.upserts.garmin_daily.every(d => d.user_id === "u1") && s.log.upserts.garmin_activities.every(a => a.user_id === "u1"));
    assert.equal(s.rows.get("u1").last_error, null); assert.ok(s.rows.get("u1").last_sync_at);
    assert.deepEqual(sync.body.report.sleep, {ok: 4, failed: 0, items: 4, lastStatus: 200});

    // Teilausfall: ein Endpunkt liefert 404 -> Sync klappt trotzdem, Hinweis im Status
    s.flags.failSleep = true;
    const part = await call(s.env, {body: {action: "sync", days: 2}});
    assert.equal(part.status, 200); assert.equal(part.body.report.sleep.ok, 0); assert.match(s.rows.get("u1").last_error, /sleep \(HTTP 404\)/); s.flags.failSleep = false;

    // Diagnose: nur Struktur, keine persönlichen Werte
    const dg = await call(s.env, {body: {action: "diagnose"}});
    assert.equal(dg.status, 200); assert.deepEqual(Object.keys(dg.body.endpoints).sort(), ["activities", "bodyBattery", "heartRate", "hrv", "sleep"]);
    assert.equal(dg.body.endpoints.activities.shape[0].activityName, "string");
    const dgs = JSON.stringify(dg.body); assert.ok(!dgs.includes("GEHEIM") && !dgs.includes("TOKEN-SECRET") && !dgs.includes("07:30"), "keine Werte in der Diagnose");

    // Drosselung (Standard 120 s)
    const slow = {...s.env}; delete slow.GARMIN_MIN_SYNC_SECONDS;
    assert.equal((await call(slow, {body: {action: "sync"}})).status, 429);

    // Token gültig, aber Daten verweigert (z. B. Key inzwischen gelöscht) -> Fehlerstatus
    s.flags.denyData = true; const den = await call(s.env, {body: {action: "sync"}});
    assert.equal(den.status, 401); assert.equal(s.rows.get("u1").status, "error"); s.flags.denyData = false; s.rows.get("u1").status = "connected";

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

test("Mapper liest tolerant (alternative Feldnamen) und verwirft unbrauchbare Einträge", () => {
  assert.equal(mapActivity({}), null); assert.equal(mapActivity({activityId: 1}), null, "ohne Datum unbrauchbar");
  const a = mapActivity({summaryId: "x9", startTimeGMT: "2026-11-20 06:00:00", activityType: "CYCLING", durationInSeconds: 3600, distanceInMeters: 25000, averageHeartRate: 130.4});
  assert.deepEqual([a.id, a.date, a.type, a.durationMin, a.distanceKm, a.avgHr], ["x9", "2026-11-20", "cycling", 60, 25, 130]);
  assert.equal(mapSleep({}, "2026-11-20"), null);
  assert.deepEqual(mapSleep({sleepTimeSeconds: 21600}, "2026-11-20"), {date: "2026-11-20", sleepHours: 6, sleepScore: null});
  assert.deepEqual(mapHrv({calendarDate: "2026-11-20", hrvSummary: {lastNightAvg: 48, status: "low"}}), {date: "2026-11-20", hrvAvg: 48, hrvStatus: "LOW"});
  assert.equal(mapHrv({calendarDate: "2026-11-20"}), null);
  assert.equal(mapRestingHr({}, "d"), null); assert.equal(mapRestingHr({restingHeartRate: 49}, "2026-11-20").restingHr, 49);
  assert.equal(mapBodyBattery({date: "2026-11-20", bodyBatteryValuesArray: [[1, null], [2, 35], [3, 90]]}).bodyBatteryMorning, 35, "Morgenwert aus dem ersten Drittel");
  assert.deepEqual(asList({hrvSummaries: [1, 2]}), [1, 2]); assert.deepEqual(asList(null), []);
  assert.deepEqual(mergeDaily([[{date: "2026-11-20", restingHr: 50}], [{date: "2026-11-20", sleepHours: 7, hrvAvg: null}], null, [{date: "2026-11-19", sleepHours: 5}]]).map(d => [d.date, d.restingHr, d.sleepHours, "hrvAvg" in d]), [["2026-11-19", undefined, 5, false], ["2026-11-20", 50, 7, false]]);
  assert.deepEqual(shapeOf({a: "text", b: [{c: 1, d: null}], e: {f: true}}), {a: "string", b: [{c: "number", d: "null"}], e: {f: "boolean"}});
});

test("Access-Token wird aus verschiedenen Antwortformaten gelesen", () => {
  const T = TOKEN, J = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
  const get = (json, text = "") => extractAccessToken({json, text});
  assert.equal(get({access_token: T}), T); assert.equal(get({accessToken: T}), T); assert.equal(get({token: T}), T);
  assert.equal(get({data: {result: {tokenValue: T}}}), T, "verschachtelt");
  assert.equal(get({irgendwas: J}), J, "JWT unter beliebigem Namen");
  assert.equal(get({refresh_token: "r".repeat(40), access_token: T}), T, "Refresh-Token wird nicht verwechselt");
  assert.equal(get(null, T), T, "reiner Text"); assert.equal(get(null, `"${T}"`), T, "Text in Anführungszeichen"); assert.equal(get(null, `Bearer ${T}`), T);
  assert.equal(get(T), T, "JSON-String");
  assert.equal(get({foo: "bar", n: 1}), null); assert.equal(get(null, ""), null); assert.equal(get(null, "Fehler aufgetreten bitte später"), null); assert.equal(get({token: "kurz"}), null);
});

test("Garmin-Sync mit verschiedenen Token-Formaten und bei unbekanntem Format mit Diagnose statt Raten", async () => {
  const s = await setup();
  try {
    assert.equal((await call(s.env, {body: {action: "connect", apiKey: USER_KEY}})).status, 200);
    for (const fmt of ["camel", "nested", "text"]) {
      s.flags.tokenFormat = fmt; const r = await call(s.env, {body: {action: "sync", days: 1}});
      assert.equal(r.status, 200, `Format ${fmt}`); assert.equal(r.body.activities, 1);
    }
    s.flags.tokenFormat = "unknown";
    const bad = await call(s.env, {body: {action: "sync", days: 1}});
    assert.equal(bad.status, 502); assert.match(bad.body.error, /Unerwartete Antwort des Garmin-Token-Endpunkts \(HTTP 200, .*Felder: foo, n\)/);
    assert.ok(!JSON.stringify(bad.body).includes("bar"), "keine Werte in der Fehlermeldung");
    const dg = await call(s.env, {body: {action: "diagnose"}});
    assert.equal(dg.status, 200); assert.equal(dg.body.endpoints, null); assert.equal(dg.body.tokenResponse.tokenFound, false);
    assert.deepEqual(dg.body.tokenResponse.shape, {foo: "string", n: "number"}); assert.ok(!JSON.stringify(dg.body).includes("bar"));
    s.flags.tokenFormat = "snake";
    const ok = await call(s.env, {body: {action: "diagnose"}});
    assert.equal(ok.body.tokenResponse.tokenFound, true); assert.ok(ok.body.endpoints.activities); assert.ok(!JSON.stringify(ok.body).includes(TOKEN));
  } finally { s.close(); }
});

test("Mapper gegen die echte Struktur aus der Garmin-Diagnose (Feldnamen wie von Garmin geliefert)", () => {
  // Schlaf liegt auf oberster Ebene (kein dailySleepDTO), HRV in hrvSummaries, Ruhepuls in dailyHeartRate
  const sleep = {id: 1, calendarDate: "2026-11-22", sleepTimeSeconds: 26100, napTimeSeconds: 0, sleepScores: {overall: {value: 81, qualifierKey: "GOOD"}}, avgHeartRate: 49};
  assert.deepEqual(mapSleep(sleep, "2026-11-22"), {date: "2026-11-22", sleepHours: 7.25, sleepScore: 81});
  assert.equal(mapSleep({calendarDate: "2026-11-23", sleepTimeSeconds: 0, sleepScores: null}, "2026-11-23"), null, "keine Messung -> kein 0-Stunden-Schlaf");
  const hrv = {hrvSummaries: [{calendarDate: "2026-11-22", weeklyAvg: 50, lastNightAvg: 47, status: "UNBALANCED", baseline: {}}], userProfilePk: 1};
  assert.deepEqual(asList(hrv).map(mapHrv), [{date: "2026-11-22", hrvAvg: 47, hrvStatus: "UNBALANCED"}]);
  assert.equal(mapRestingHr({calendarDate: "2026-11-22", restingHeartRate: 52, heartRateValues: [[1, 60]]}, "x").restingHr, 52);
  const act = mapActivity({activityId: 123456789, activityName: "Krafttraining", startTimeLocal: "2026-11-22 18:05:11", startTimeGMT: "2026-11-22 17:05:11", activityType: {typeId: 13, typeKey: "strength_training", parentTypeId: 29},
    distance: 0, duration: 3012.5, calories: 320, averageHR: 112, maxHR: 148, aerobicTrainingEffect: 2.3, anaerobicTrainingEffect: 0.4});
  assert.deepEqual([act.id, act.date, act.start, act.type, act.durationMin, act.avgHr, act.aerobicTE, act.trainingLoad], ["123456789", "2026-11-22", "18:05", "strength_training", 50.2, 112, 2.3, null]);
  // Body Battery: beide denkbaren Eintragsformate
  assert.equal(mapBodyBattery({date: "2026-11-22", bodyBatteryValuesArray: [[1, "MEASURED", 62, 1.0], [2, "MEASURED", 88, 1.0], [3, "MEASURED", 70, 1.0], [4, "MEASURED", 20, 1.0], [5, "MEASURED", 15, 1.0], [6, "MEASURED", 10, 1.0]]}).bodyBatteryMorning, 88);
  assert.equal(mapBodyBattery({date: "2026-11-22", bodyBatteryValuesArray: [[1, 41], [2, 77], [3, 60], [4, 30], [5, 20], [6, 10]]}).bodyBatteryMorning, 77);
  assert.equal(mapBodyBattery({date: "2026-11-22", bodyBatteryValuesArray: [[1, "MEASURED", null]]}), null);
  // Diagnose zeigt Tupel-Listen mit allen Elementtypen
  assert.deepEqual(shapeOf({v: [[1700000000000, "MEASURED", 55, 1]]}), {v: [["number", "string", "number", "number"]]});
});
