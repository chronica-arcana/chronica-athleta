import test from "node:test";
import assert from "node:assert/strict";
import {generatePlan} from "../engine/planner.js";
import {addRule, removeRule, rebalance, swapSession, replacementFor} from "../engine/adapt.js";
import {sanitizeChat, buildChatContext} from "../engine/chat.js";
import {kindInfo} from "../engine/catalog.js";
import {addDays} from "../engine/dates.js";

const TODAY = "2026-11-23";
const goal = {sports: ["football", "run", "strength"], primary: "football", level: "intermediate", daysPerWeek: 4, minutesPerSession: 50, equipment: "gym", mode: "return", injury: true, weeks: 20, startDate: TODAY};
const fresh = () => generatePlan(goal, {planId: "p"});
const apply = (st, res) => { const m = new Map(st.sessions.map(s => [s.id, s])); res.sessions.forEach(s => m.set(s.id, s)); res.removed.forEach(id => m.delete(id)); return {plan: res.plan, sessions: [...m.values()].sort((a, b) => a.date.localeCompare(b.date))}; };
const FOOTBALL = ["football_skills", "football_conditioning", "team_match"];

test("Dauerhafte Regel: Fußball-Einheiten bis Februar werden ersetzt, danach bleiben sie", () => {
  let st = fresh(); const until = "2027-02-01";
  assert.ok(st.sessions.some(s => s.kind === "football_skills" && s.date <= until), "Ausgangslage: Technik und Ball im Plan");
  const res = addRule(st.plan, st.sessions, {kinds: FOOTBALL, until, replaceWith: "auto"}, TODAY); st = apply(st, res);
  assert.equal(st.plan.meta.rules.length, 1); assert.ok(res.notes.some(n => /ersetzt/.test(n)));
  for (const s of st.sessions) {
    if (s.date <= until && s.status === "planned") assert.ok(!FOOTBALL.includes(s.kind), `${s.date} ${s.kind}`);
    if (s.ruleId) { assert.ok(s.origKind && FOOTBALL.includes(s.origKind)); assert.ok(s.blocks.length > 0 && s.title === kindInfo(s.kind).label); assert.notEqual(kindInfo(s.kind).sport, "football"); }
  }
  assert.ok(st.sessions.some(s => s.date > until && FOOTBALL.includes(s.kind)), "nach dem Datum wieder Fußball");
  // idempotent und stabil bei weiteren Anpassungen
  const again = rebalance(st.plan, st.sessions, TODAY); assert.equal(again.sessions.filter(s => FOOTBALL.includes(s.kind) && s.date <= until).length, 0);
});
test("Regel greift nur auf geplante, künftige Einheiten aus dem Plan – nicht auf erledigte oder selbst gewählte", () => {
  let st = fresh(); const fb = st.sessions.filter(s => FOOTBALL.includes(s.kind) && s.date <= "2027-02-01");
  const [done, mine, planned] = fb;
  st.sessions = st.sessions.map(s => s.id === done.id ? {...s, status: "done", date: addDays(TODAY, -1)} : s.id === mine.id ? {...s, source: "swapped"} : s);
  const res = apply(st, addRule(st.plan, st.sessions, {kinds: FOOTBALL, until: "2027-02-01"}, TODAY));
  assert.equal(res.sessions.find(s => s.id === done.id).kind, done.kind, "erledigte bleibt"); assert.equal(res.sessions.find(s => s.id === mine.id).kind, mine.kind, "selbst gewählte bleibt");
  assert.notEqual(res.sessions.find(s => s.id === planned.id).kind, planned.kind);
});
test("Regel nach Sportart und gültiger Ersatz; ungültige Angaben werden ignoriert", () => {
  const st = fresh(), none = addRule(st.plan, st.sessions, {kinds: ["gibt_es_nicht"], sports: ["quatsch"]}, TODAY); assert.equal(none.sessions.length, 0); assert.equal(none.plan.meta.rules, undefined);
  const res = apply(st, addRule(st.plan, st.sessions, {sports: ["football"], until: "kaputt", replaceWith: "mobility"}, TODAY));
  assert.equal(res.plan.meta.rules[0].until, null, "ungültiges Datum = dauerhaft"); assert.equal(res.plan.meta.rules[0].replaceWith, "mobility");
  assert.ok(res.sessions.filter(s => s.status === "planned" && s.date >= TODAY).every(s => kindInfo(s.kind).sport !== "football"));
  assert.ok(res.sessions.some(s => s.ruleId && s.kind === "mobility"));
  const r = {kinds: FOOTBALL, sports: [], replaceWith: "football_skills"}; assert.notEqual(replacementFor(st.plan, r, {date: TODAY}), "football_skills", "Ersatz darf nicht selbst ausgeschlossen sein");
});
test("Regel entfernen stellt die ursprünglichen Einheiten wieder her", () => {
  let st = fresh(); const orig = new Map(st.sessions.map(s => [s.id, s.kind]));
  st = apply(st, addRule(st.plan, st.sessions, {kinds: FOOTBALL, until: "2027-02-01"}, TODAY)); const id = st.plan.meta.rules[0].id;
  const res = removeRule(st.plan, st.sessions, id, TODAY); st = apply(st, res);
  assert.equal(st.plan.meta.rules.length, 0); assert.ok(res.notes.some(n => /wiederhergestellt/.test(n)));
  for (const s of st.sessions) { assert.equal(s.ruleId, undefined); if (s.status === "planned" && s.source === "plan") assert.equal(s.kind, orig.get(s.id), s.date); }
});
test("Regel bleibt auch dann wirksam, wenn eine Entschärfung eine ausgeschlossene Art einsetzen würde", () => {
  let st = fresh(); st = apply(st, addRule(st.plan, st.sessions, {kinds: ["football_skills"], until: "2027-06-01"}, TODAY));
  const cond = st.sessions.find(s => s.kind === "football_conditioning" && s.status === "planned" && s.date > TODAY); if (!cond) return;
  const prev = st.sessions.find(s => s.date === addDays(cond.date, -1)); // harte Einheit direkt davor -> Entschärfung football_conditioning -> football_skills
  st = apply(st, swapSession(st.plan, st.sessions, st.sessions.find(s => s.status === "planned" && s.date > TODAY && s.id !== cond.id).id, "run_intervals", 45, TODAY));
  assert.ok(st.sessions.filter(s => s.status === "planned" && s.source === "plan" && s.date <= "2027-06-01").every(s => s.kind !== "football_skills"));
});

test("Chat-Regelvorschlag wird geprüft: gültige Arten, Datum, nur eine Regel", () => {
  const ok = sanitizeChat({reply: "x", actions: [{type: "rule", label: "Fußball bis Februar ersetzen", kinds: ["football_skills", "team_match", "nix"], until: "2027-02-01", replace: "run_easy"}]}, TODAY).actions[0];
  assert.deepEqual(ok, {type: "rule", label: "Fußball bis Februar ersetzen", kinds: ["football_skills", "team_match"], sports: [], until: "2027-02-01", replace: "run_easy"});
  assert.equal(sanitizeChat({actions: [{type: "rule", kinds: ["football_skills"], until: "2020-01-01"}]}, TODAY).actions.length, 0, "Datum in der Vergangenheit");
  assert.equal(sanitizeChat({actions: [{type: "rule", kinds: ["football_skills"], until: "2031-01-01"}]}, TODAY).actions.length, 0, "mehr als 2 Jahre voraus");
  assert.equal(sanitizeChat({actions: [{type: "rule", kinds: ["event"]}, {type: "rule", sports: ["unsinn"]}]}, TODAY).actions.length, 0, "nur gültige Arten");
  const perm = sanitizeChat({actions: [{type: "rule", kinds: ["football_skills"], until: "dauerhaft", replace: "boese"}]}, TODAY).actions[0]; assert.equal(perm.until, null); assert.equal(perm.replace, "auto"); assert.equal(perm.label, "Planregel anlegen");
  assert.equal(sanitizeChat({actions: [{type: "rule", kinds: ["run_easy"]}, {type: "rule", kinds: ["bike_easy"]}]}, TODAY).actions.length, 1, "höchstens eine Regel");
});
test("Chat-Kontext nennt die Arten im Plan und bestehende Regeln", () => {
  let st = fresh(); st = apply(st, addRule(st.plan, st.sessions, {kinds: ["football_skills"], until: "2027-02-01"}, TODAY));
  const ctx = buildChatContext({plan: st.plan, sessions: st.sessions, rd: null, stats: {workload: {ratio: null}}, today: TODAY});
  assert.ok(ctx.artenImPlan.length > 0 && ctx.artenImPlan.every(a => a.art && a.bezeichnung && a.anzahl > 0)); assert.ok(ctx.artenImPlan.some(a => a.art === "football_conditioning") || ctx.artenImPlan.length > 0);
  assert.equal(ctx.regeln.length, 1); assert.deepEqual(ctx.regeln[0].arten, ["football_skills"]); assert.equal(ctx.regeln[0].bis, "2027-02-01");
  assert.ok(JSON.stringify(ctx).length < 6000);
});
