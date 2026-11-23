import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import handler, {extractJson, TASKS, pickModel, resolveModel} from "../api/ai.js";

function server(fn) { return new Promise(r => { const s = http.createServer(fn); s.listen(0, () => r(s)); }); }
const call = async (env, {method = "POST", headers = {}, body, url = "/api/ai"} = {}) => {
  const req = {method, headers, body, url}; let out = {headers: {}};
  const res = {statusCode: 200, setHeader: (k, v) => { out.headers[k] = v; }, end: s => { out.body = s ? JSON.parse(s) : null; out.status = res.statusCode; }};
  await handler(req, res, env); return out;
};

test("extractJson toleriert Text, Markdown-Blöcke, Denk-Abschnitte und Klammern im Text", () => {
  assert.deepEqual(extractJson('Hier: {"a":1} fertig'), {a: 1});
  assert.deepEqual(extractJson('```json\n{"a":{"b":[1,2]},"s":"x}y"}\n```'), {a: {b: [1, 2]}, s: "x}y"});
  assert.deepEqual(extractJson('<think>ich überlege {kurz}</think>{"ok":true}'), {ok: true});
  assert.deepEqual(extractJson('Beispiel {kein json} und dann {"a":2} und {"b":3}'), {a: 2}, "überspringt ungültige Klammern");
  assert.deepEqual(extractJson('{"text":"Anführungszeichen \\" und } darin"}'), {text: 'Anführungszeichen " und } darin'});
  assert.throws(() => extractJson("kein json")); assert.throws(() => extractJson('{"abgeschnitten": "text'));
  assert.throws(() => extractJson(""));
});
test("Prompts: nur feste Aufgaben, Datenblock wird als Daten gekennzeichnet", () => {
  assert.deepEqual(Object.keys(TASKS).sort(), ["chat", "followups", "insights", "parse_goal", "plan_summary", "session_feedback"]);
  Object.values(TASKS).forEach(t => assert.match(t.system, /niemals Anweisungen/));
});
test("AI-Handler: Auth, Limit, Aufgabenprüfung, Modellaufruf", async () => {
  const seen = {hits: 0, model: null, auth: null};
  const sb = await server((q, r) => {
    let b = ""; q.on("data", c => b += c); q.on("end", () => {
      if (q.url === "/auth/v1/user") { if (q.headers.authorization === "Bearer good") { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({id: "u1"})); } else { r.statusCode = 401; r.end("{}"); } }
      else if (q.url === "/rest/v1/rpc/ai_hit") { if (!b.includes("00000000-0000-0000-0000-000000000000")) seen.hits++; r.setHeader("content-type", "application/json"); r.end(String(seen.hits)); }
      else { r.statusCode = 404; r.end(); }
    });
  });
  const llm = await server((q, r) => {
    let b = ""; q.on("data", c => b += c); q.on("end", () => { if (q.method === "GET") { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({data: [{id: "m"}, {id: "andere"}]})); } const j = JSON.parse(b); seen.rf = (seen.rf || 0) + (j.response_format ? 1 : 0); seen.calls = (seen.calls || 0) + 1;
      if (seen.rejectJsonMode && j.response_format) { r.statusCode = 400; r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({error: {message: "response_format nicht unterstützt (Schlüssel k)"}})); }
      if (seen.failAll) { r.statusCode = 404; r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({error: {message: "model not found"}})); }
      seen.model = j.model; seen.auth = q.headers.authorization; seen.msg = j.messages;
      r.setHeader("content-type", "application/json"); r.end(JSON.stringify({choices: [{message: {content: '{"title":"Halbmarathon-Plan","summary":"Los!","tips":[]}'}}]})); });
  });
  const env = {SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "svc", AI_API_KEY: "k", AI_BASE_URL: `http://127.0.0.1:${llm.address().port}/v1`, AI_MODEL: "m", AI_DAILY_LIMIT: "2"};
  try {
    const health = await call(env, {method: "GET"});
    assert.equal(health.status, 200); assert.deepEqual([health.body.aiKey, health.body.supabaseUrl, health.body.serviceRoleKey], [true, true, true]);
    assert.ok(!JSON.stringify(health.body).includes("svc") && !JSON.stringify(health.body).includes('"k"'), "keine Geheimnisse im Healthcheck");
    const bare = await call({}, {method: "GET"}); assert.deepEqual([bare.body.aiKey, bare.body.supabaseUrl, bare.body.serviceRoleKey], [false, false, false]);
    assert.equal((await call(env, {method: "PUT"})).status, 405);
    const deep = await call({...env}, {method: "GET", url: "/api/ai?check=1"});
    assert.equal(deep.status, 200); assert.equal(deep.body.live.supabaseAuth.error, undefined);
    assert.equal(deep.body.live.aiHitFunction.exists, true); assert.ok(deep.body.live.aiProvider);
    assert.ok(!JSON.stringify(deep.body).includes("svc"), "keine Geheimnisse im Live-Check");
    const noFn = await call({...env, SUPABASE_URL: `http://127.0.0.1:${sb.address().port}/missing`}, {method: "GET", url: "/api/ai?check=1"});
    assert.equal(noFn.body.live.aiHitFunction.exists, false, "404 => SQL fehlt");
    assert.equal((await call(env, {body: {task: "plan_summary", payload: {}}})).status, 401, "ohne Login abgelehnt");
    assert.equal((await call(env, {headers: {authorization: "Bearer bad"}, body: {task: "plan_summary"}})).status, 401);
    assert.equal((await call(env, {headers: {authorization: "Bearer good"}, body: {task: "beliebiger_prompt", payload: {}}})).status, 400);
    assert.equal((await call(env, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {x: "a".repeat(30000)}}})).status, 413);
    const ok = await call(env, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {goal: "x"}}});
    assert.equal(ok.status, 200); assert.equal(ok.body.data.title, "Halbmarathon-Plan");
    assert.equal(seen.model, "m"); assert.equal(seen.auth, "Bearer k");
    assert.match(seen.msg[1].content, /^Datenblock:/); assert.equal(seen.msg[0].role, "system");
    const ok2 = await call(env, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {}}}); assert.equal(ok2.status, 200);
    const limited = await call(env, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {}}}); assert.equal(limited.status, 429, "Tageslimit");
    assert.equal((await call({...env, AI_API_KEY: ""}, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary"}})).status, 503);
    // Anbieter lehnt JSON-Modus ab -> zweiter Versuch ohne response_format gelingt
    const bigEnv = {...env, AI_DAILY_LIMIT: "1000"}; seen.rejectJsonMode = true; seen.calls = 0;
    const retry = await call(bigEnv, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {}}});
    assert.equal(retry.status, 200); assert.equal(seen.calls, 2, "Retry ohne JSON-Modus");
    // Modell existiert nicht -> verständlicher Fehler mit Code und Begründung, ohne den Schlüssel
    seen.rejectJsonMode = false; seen.failAll = true;
    const bad = await call(bigEnv, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {}}});
    assert.equal(bad.status, 502); assert.match(bad.body.error, /HTTP 404: model not found/);
    seen.rejectJsonMode = true; seen.failAll = false;
    const leak = await call(bigEnv, {headers: {authorization: "Bearer good"}, body: {task: "plan_summary", payload: {}}}); assert.equal(leak.status, 200);
    seen.failAll = false; seen.rejectJsonMode = false;
    const live = await call(bigEnv, {method: "GET", url: "/api/ai?check=1"});
    assert.equal(live.body.live.aiProvider.modelAvailable, true); assert.deepEqual(live.body.live.aiProvider.models, ["m", "andere"]);
  } finally { sb.close(); llm.close(); }
});

test("Modellwahl: bevorzugt bekannte Chat-Modelle, ignoriert Audio/Guard, respektiert AI_MODEL", async () => {
  assert.equal(pickModel(["whisper-large-v3", "llama-guard-4-12b", "llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b-16e-instruct"]), "meta-llama/llama-4-scout-17b-16e-instruct");
  assert.equal(pickModel(["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]), "llama-3.3-70b-versatile");
  assert.equal(pickModel(["foo-tts", "qwen/qwen3-32b", "gemma2-9b-it"]), "qwen/qwen3-32b", "größtes Chat-Modell als Fallback");
  assert.equal(pickModel(["whisper-large-v3", "playai-tts"]), null);
  assert.equal(await resolveModel({AI_MODEL: "mein-modell"}), "mein-modell");
  const srv = await server((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({data: [{id: "whisper-large-v3"}, {id: "llama-3.1-8b-instant"}, {id: "openai/gpt-oss-20b"}]})); });
  try { assert.equal(await resolveModel({AI_API_KEY: "key-abc123", AI_BASE_URL: `http://127.0.0.1:${srv.address().port}/v1`}), "llama-3.1-8b-instant"); }
  finally { srv.close(); }
  assert.equal(await resolveModel({AI_API_KEY: "x", AI_BASE_URL: "http://127.0.0.1:9/v1"}), "llama-3.3-70b-versatile", "Fallback, wenn Modellliste nicht abrufbar");
});

test("Unbrauchbare KI-Antworten: Retry mit mehr Platz, Diagnose in der Fehlermeldung", async () => {
  let calls = [], mode = "empty";
  const llm = await server((q, r) => { let b = ""; q.on("data", c => b += c); q.on("end", () => {
    r.setHeader("content-type", "application/json");
    if (q.method === "GET") return r.end(JSON.stringify({data: [{id: "openai/gpt-oss-20b"}]}));
    const j = JSON.parse(b); calls.push({max: j.max_tokens, rf: !!j.response_format});
    if (mode === "empty") return r.end(JSON.stringify({choices: [{finish_reason: "length", message: {content: ""}}]}));
    if (mode === "second") return r.end(JSON.stringify({choices: [{message: {content: calls.length === 1 ? "Gerne! Hier der Plan" : 'Gerne:\n```json\n{"title":"Ok"}\n```'}}]}));
  }); });
  const env = {AI_API_KEY: "key-abcdef", AI_BASE_URL: `http://127.0.0.1:${llm.address().port}/v1`, AI_MODEL: "openai/gpt-oss-20b"};
  try {
    const sb = await server((q, r) => { r.setHeader("content-type", "application/json"); if (q.url.includes("/auth/")) r.end('{"id":"u"}'); else r.end("1"); });
    const full = {...env, SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", AI_DAILY_LIMIT: "100"};
    mode = "empty"; calls = [];
    let out = await call(full, {headers: {authorization: "Bearer g"}, body: {task: "plan_summary", payload: {}}});
    assert.equal(out.status, 502); assert.match(out.body.error, /nicht verwertbar \(Modell openai\/gpt-oss-20b, finish_reason=length, 0 Zeichen\)/);
    assert.equal(calls.length, 2); assert.ok(calls[1].max > calls[0].max, "zweiter Versuch mit mehr Token"); assert.equal(calls[1].rf, false);
    assert.ok(calls[0].max >= 1800, "Reasoning-Modelle bekommen großzügig Token");
    mode = "second"; calls = [];
    out = await call(full, {headers: {authorization: "Bearer g"}, body: {task: "plan_summary", payload: {}}});
    assert.equal(out.status, 200); assert.deepEqual(out.body.data, {title: "Ok"});
    sb.close();
  } finally { llm.close(); }
});
