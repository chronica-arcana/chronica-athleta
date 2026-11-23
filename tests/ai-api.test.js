import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import handler, {extractJson, TASKS} from "../api/ai.js";

function server(fn) { return new Promise(r => { const s = http.createServer(fn); s.listen(0, () => r(s)); }); }
const call = async (env, {method = "POST", headers = {}, body, url = "/api/ai"} = {}) => {
  const req = {method, headers, body, url}; let out = {headers: {}};
  const res = {statusCode: 200, setHeader: (k, v) => { out.headers[k] = v; }, end: s => { out.body = s ? JSON.parse(s) : null; out.status = res.statusCode; }};
  await handler(req, res, env); return out;
};

test("extractJson toleriert Text um das JSON", () => {
  assert.deepEqual(extractJson('Hier: {"a":1} fertig'), {a: 1});
  assert.throws(() => extractJson("kein json"));
});
test("Prompts: nur feste Aufgaben, Datenblock wird als Daten gekennzeichnet", () => {
  assert.deepEqual(Object.keys(TASKS).sort(), ["followups", "parse_goal", "plan_summary", "session_feedback"]);
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
    let b = ""; q.on("data", c => b += c); q.on("end", () => { if (q.method === "GET") { r.setHeader("content-type", "application/json"); return r.end("{}"); } const j = JSON.parse(b); seen.model = j.model; seen.auth = q.headers.authorization; seen.msg = j.messages;
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
  } finally { sb.close(); llm.close(); }
});
