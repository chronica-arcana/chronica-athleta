import test from "node:test";
import assert from "node:assert/strict";
import {mergeAI} from "../js/store.js";
import {sessionToRow, rowToSession, planToRow, rowToPlan, SupabaseAdapter} from "../js/adapters.js";
import {generatePlan} from "../engine/planner.js";

const rule = {zone: "green", hold: false, reduce: false, painKnown: true, summary: "Regel", advice: "Regel-Rat", nextFactor: 1, tips: [],
  exercises: [{name: "Beinpresse", type: "weight", action: "increase_weight", lastWeight: 60, lastReps: 12, nextWeight: 62.5, nextReps: 8, reason: "Regel"},
    {name: "Plank", type: "time", action: "hold", lastSeconds: 30, nextSeconds: 30, reason: "Regel"}]};

test("KI-Vorschläge werden auf Sicherheitsgrenzen begrenzt (+10 % Gewicht, Faktor ≤ 1,1)", () => {
  const out = mergeAI({summary: "Mega", exercises: [{name: "Beinpresse", next_weight_kg: 100, next_reps: 99, reason: "stark"}, {name: "Plank", next_seconds: 300}], next_factor: 1.8, advice: "Gas geben", tips: ["a", "b", "c", "d", "e"]}, rule);
  assert.equal(out.source, "ki"); assert.equal(out.limited, true);
  assert.equal(out.exercises[0].nextWeight, 66.25); assert.equal(out.exercises[0].action, "increase_weight");
  assert.ok(out.exercises[0].nextReps <= 17);
  assert.ok(out.exercises[1].nextSeconds <= 40);
  assert.equal(out.nextFactor, 1.1); assert.equal(out.tips.length, 4);
});
test("Bei Bremse (Schmerz/hohe Belastung) darf die KI nie steigern", () => {
  const hold = {...rule, hold: true, advice: "Konsolidieren."};
  const out = mergeAI({exercises: [{name: "Beinpresse", next_weight_kg: 70}, {name: "Plank", next_seconds: 60}], next_factor: 1.1, advice: "Voll durchziehen"}, hold);
  assert.ok(out.exercises[0].nextWeight <= 60); assert.notEqual(out.exercises[0].action, "increase_weight");
  assert.ok(out.exercises[1].nextSeconds <= 30); assert.ok(out.nextFactor <= 1);
  assert.match(out.advice, /^Konsolidieren\./);
});
test("Ohne Schmerzwert (vorsichtiger Modus) keine Gewichtssteigerung durch die KI", () => {
  const out = mergeAI({exercises: [{name: "Beinpresse", next_weight_kg: 65}]}, {...rule, painKnown: false});
  assert.ok(out.exercises[0].nextWeight <= 60);
});
test("Unbekannte/ungültige KI-Daten richten keinen Schaden an", () => {
  const out = mergeAI({exercises: [{name: "Erfunden", next_weight_kg: 999}, null, {name: "Beinpresse", next_weight_kg: "abc"}], tips: "kein array", next_factor: "x"}, rule);
  assert.equal(out.exercises[0].nextWeight, 62.5); assert.equal(out.exercises.length, 2);
});

test("Session-/Plan-Mapping für die Datenbank ist verlustfrei", () => {
  const {plan, sessions} = generatePlan({sports: ["run", "strength"], primary: "run", daysPerWeek: 3, weeks: 6, equipment: "dumbbell", startDate: "2026-11-23"}, {planId: "11111111-1111-1111-1111-111111111111"});
  const s = {...sessions[0], status: "done", log: {rpe: 5, sets: {0: [{weight: "50", reps: "10"}]}}, analysis: {zone: "green"}, addon: {kind: "strength_snack", minutes: 20}};
  const row = sessionToRow(s, "user-1");
  assert.equal(row.user_id, "user-1"); assert.equal(row.plan_id, plan.id); assert.equal(row.duration_min, s.durationMin);
  assert.ok(row.data.log && row.data.analysis && row.data.blocks);
  for (const k of ["id", "date", "kind"]) assert.ok(!(k in row.data));
  assert.deepEqual(rowToSession({...row, load: String(row.load)}), s);
  assert.deepEqual(rowToPlan({id: plan.id, title: plan.title, status: plan.status, start_date: plan.startDate, end_date: plan.endDate, goal: plan.goal, meta: plan.meta}), plan);
  assert.equal(planToRow(plan, "u").user_id, "u");
});

// Fake-Supabase: zeichnet Aufrufe auf, damit Tabellennamen/Spalten/Filter geprüft werden
function fakeSb(data) {
  const log = [];
  const chain = (table, op) => { const c = {table, op, args: [], filters: []}; log.push(c);
    const p = new Proxy(c, {get(t, k) { if (k === "then") return (res) => res({data: t.op === "select" ? (data[t.table] ?? []) : null, error: null}); return (...a) => { if (["eq", "gte", "in", "not", "order", "range", "maybeSingle", "select"].includes(k)) t.filters.push([k, ...a]); else t.args.push(a); return p; }; }}); return p; };
  return {log, from: table => ({select: (...a) => { const p = chain(table, "select"); log[log.length - 1].args.push(a); return p; }, upsert: row => { const p = chain(table, "upsert"); log[log.length - 1].args.push(row); return p; }, delete: () => chain(table, "delete")}),
    rpc: name => { log.push({rpc: name}); return Promise.resolve({data: null, error: null}); }, auth: {}};
}
test("SupabaseAdapter: lädt alle Tabellen, setzt user_id beim Speichern, liest keine Token-Spalten", async () => {
  const a = Object.create(SupabaseAdapter.prototype); a.user = {id: "u1"}; a.mode = "cloud";
  const {plan, sessions} = generatePlan({sports: ["run"], primary: "run", daysPerWeek: 3, weeks: 4, startDate: "2026-11-23"});
  const sb = fakeSb({plans: [planToRow(plan)], sessions: sessions.slice(0, 2).map(s => ({...sessionToRow(s), load: s.load})), garmin_activities: [{id: "a1", date: "2026-11-20", data: {type: "running"}}], garmin_daily: [{date: "2026-11-20", data: {restingHr: 50}}], profiles: [], garmin_links: []});
  a.sb = sb;
  const d = await a.loadAll();
  assert.equal(d.plans.length, 1); assert.equal(d.sessions.length, 2); assert.equal(d.garmin.activities[0].type, "running"); assert.equal(d.garmin.daily[0].restingHr, 50);
  const link = sb.log.find(c => c.table === "garmin_links"); assert.equal(link.args[0][0], "status,last_sync_at,last_error", "Token-Spalten werden nie angefragt");
  await a.saveSessions(sessions.slice(0, 3)); const up = sb.log.filter(c => c.op === "upsert" && c.table === "sessions").pop();
  assert.equal(up.args[0].length, 3); assert.ok(up.args[0].every(r => r.user_id === "u1"));
  await a.savePlan(plan); assert.equal(sb.log.filter(c => c.op === "upsert" && c.table === "plans").pop().args[0].user_id, "u1");
  a.user = null; await assert.rejects(() => a.savePlan(plan), /Nicht angemeldet/);
});
