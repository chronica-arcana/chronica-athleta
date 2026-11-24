import test from "node:test";
import assert from "node:assert/strict";
import {generatePlan} from "../engine/planner.js";
import {swapSession, skipSession, addSession, setAvailability, moveSession, completeSession, analyzeSession, applyAnalysis, autoSkipMissed, baseLoad, rebalance} from "../engine/adapt.js";
import {kindInfo} from "../engine/catalog.js";
import {addDays, weekStart, diffDays, dow} from "../engine/dates.js";
import {recoveryFlags, activityFlags, importSuggestions, matchActivities} from "../engine/garmin.js";

const PROFILES = {
  halbmarathon: {sports: ["run", "strength"], primary: "run", level: "intermediate", daysPerWeek: 4, minutesPerSession: 50, equipment: "dumbbell", event: {preset: "run_half", date: "2027-03-14"}, startDate: "2026-11-23"},
  einsteiger: {sports: ["run", "bike"], primary: "run", level: "beginner", daysPerWeek: 3, minutesPerSession: 35, mode: "health", weeks: 10, startDate: "2026-11-25"},
  triathlon: {sports: ["swim", "bike", "run", "strength"], primary: "run", level: "advanced", daysPerWeek: 6, minutesPerSession: 60, equipment: "gym", event: {preset: "tri_olympic", date: "2027-06-20"}, startDate: "2026-11-23"},
  wiedereinstieg: {sports: ["football", "strength", "run"], primary: "football", level: "intermediate", daysPerWeek: 4, minutesPerSession: 50, equipment: "gym", mode: "return", injury: true, weeks: 17, startDate: "2026-11-23"},
  kraft: {sports: ["strength"], primary: "strength", level: "intermediate", daysPerWeek: 3, minutesPerSession: 60, equipment: "gym", weeks: 8, startDate: "2026-11-23"}
};

for (const [name, goal] of Object.entries(PROFILES)) {
  test(`Plan „${name}“ ist strukturell gültig`, () => {
    const {plan, sessions} = generatePlan(goal, {planId: "p1"});
    assert.ok(sessions.length > 0);
    const dates = new Set();
    for (const s of sessions) {
      assert.ok(s.date >= plan.startDate && s.date <= plan.endDate, `Datum im Plan: ${s.date}`);
      assert.ok(s.blocks.length > 0, "jede Einheit hat Inhalt");
      const key = s.date; assert.ok(!dates.has(key), "max. eine Einheit pro Tag " + key); dates.add(key);
      assert.equal(s.load, baseLoad(s));
    }
    // keine zwei harten Einheiten an aufeinanderfolgenden Tagen
    const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++)
      if (diffDays(sorted[i].date, sorted[i - 1].date) === 1 && sorted[i].kind !== "event")
        assert.ok(!(kindInfo(sorted[i].kind).intensity === "hard" && kindInfo(sorted[i - 1].kind).intensity === "hard"), `hart-hart ${sorted[i - 1].date}`);
    // Wochenlast steigt zwischen Nicht-Deload-Wochen höchstens ~12 %
    const byWeek = {}; sessions.forEach(s => (byWeek[s.week] ||= []).push(s));
    const idx = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
    let prev = null;
    for (const i of idx.slice(1)) {
      const wk = byWeek[i], load = wk.reduce((a, s) => a + s.load, 0);
      const isTaperOrDeload = wk.some(s => s.ctx.deload) || wk.some(s => s.ctx.phaseKey === "taper");
      if (!isTaperOrDeload && prev && byWeek[i].length === byWeek[i - 1].length) assert.ok(load <= prev * 1.15, `Woche ${i}: ${load} vs ${prev}`);
      if (!isTaperOrDeload) prev = load;
    }
    // Wochenziele vorhanden
    Object.values(plan.meta.weekTargets).forEach(v => assert.ok(v > 0));
    if (goal.event) {
      const ev = sessions.find(s => s.kind === "event"); assert.ok(ev, "Eventeinheit"); assert.equal(ev.date, goal.event.date);
      const last = sorted[sorted.length - 1]; assert.equal(last.date, goal.event.date);
    }
  });
}

test("Wiedereinstieg: keine harten Einheiten vor Phase r4", () => {
  const {plan, sessions} = generatePlan(PROFILES.wiedereinstieg);
  const r4 = plan.meta.phases.find(p => p.key === "r4");
  for (const s of sessions) if (s.week < r4.fromWeek) assert.notEqual(kindInfo(s.kind).intensity, "hard", s.kind + " in Woche " + s.week);
});
test("Einsteiger: Lauf-/Geh-Intervalle statt Dauerlauf am Anfang, keine Intervalle", () => {
  const {sessions} = generatePlan(PROFILES.einsteiger);
  assert.ok(sessions.some(s => s.kind === "run_walkrun"));
  assert.ok(!sessions.some(s => /intervals/.test(s.kind)));
});

const TODAY = "2026-11-23";
function fresh(profile = "halbmarathon") { const g = generatePlan(PROFILES[profile], {planId: "p"}); return {plan: g.plan, sessions: g.sessions}; }
const apply = (state, res) => {
  const map = new Map(state.sessions.map(s => [s.id, s])); res.sessions.forEach(s => map.set(s.id, s)); res.removed.forEach(id => map.delete(id));
  return {plan: res.plan, sessions: [...map.values()].sort((a, b) => a.date.localeCompare(b.date))};
};
const wk = (st, ws) => st.sessions.filter(s => weekStart(s.date) === ws);

test("Kraft durch Cardio ersetzen: Einheit getauscht, Kraft-Snack später nachgeholt", () => {
  let st = fresh();
  const str = st.sessions.find(s => s.kind === "strength_full" && s.date >= TODAY);
  const res = swapSession(st.plan, st.sessions, str.id, "bike_easy", 45, TODAY);
  st = apply(st, res);
  const sw = st.sessions.find(s => s.id === str.id);
  assert.equal(sw.kind, "bike_easy"); assert.equal(sw.sport, "bike"); assert.equal(sw.locked, true);
  assert.ok(res.notes.some(n => /Geändert/.test(n)));
  const snack = st.sessions.find(s => s.addon && s.addon.kind === "strength_snack");
  assert.ok(snack, "Kraft-Snack wurde angehängt"); assert.ok(snack.exercises && snack.addon.exercises.length >= 3);
  assert.equal(st.plan.meta.debt.strength, 0);
  assert.ok(diffDays(snack.date, TODAY) <= 6);
});
test("Einheit auslassen: Schlüsseleinheiten bleiben, lockere gleichen höchstens +25 % aus", () => {
  let st = fresh();
  const ws = weekStart(TODAY), before = wk(st, ws).filter(s => s.status === "planned");
  const easy = before.find(s => s.kind === "run_easy");
  const res = skipSession(st.plan, st.sessions, easy.id, TODAY);
  st = apply(st, res);
  const after = wk(st, ws);
  assert.equal(after.find(s => s.id === easy.id).status, "skipped");
  const longB = before.find(s => s.kind === "run_long"), longA = after.find(s => s.id === longB.id);
  assert.ok(longA.durationMin >= longB.durationMin && longA.durationMin <= longB.durationMin * 1.25 + 5);
  for (const s of after.filter(x => x.status === "planned")) { const b = before.find(x => x.id === s.id); assert.ok(s.durationMin <= b.durationMin * 1.25 + 5); }
});
test("Zusätzliches langes Training: restliche Wochenlast wird gekürzt, nie unter 60 %", () => {
  let st = fresh();
  const ws = weekStart(TODAY), before = wk(st, ws);
  const res = addSession(st.plan, st.sessions, {date: TODAY, kind: "bike_long", minutes: 150, done: true, log: {durationMin: 150, rpe: 6}}, TODAY);
  st = apply(st, res);
  const after = wk(st, ws).filter(s => s.status === "planned");
  assert.ok(res.notes.some(n => /gekürzt|erreicht/.test(n)), res.notes.join("|"));
  for (const s of after) { const b = before.find(x => x.id === s.id); if (b) assert.ok(s.durationMin >= Math.min(b.durationMin, 15) && s.durationMin >= b.durationMin * 0.6 - 5, `${s.kind} ${s.durationMin} vs ${b.durationMin}`); }
  const total = wk(st, ws).filter(s => s.status !== "skipped").reduce((a, s) => a + (s.status === "done" ? 150 * 1.0 : s.load), 0);
  assert.ok(total <= st.plan.meta.weekTargets[ws] * 1.5);
});
test("Verfügbarkeit: nur 2 freie Tage → wichtigste Einheiten bleiben, auf freie Tage verteilt", () => {
  let st = fresh();
  const ws = addDays(weekStart(TODAY), 7), before = wk(st, ws);
  const res = setAvailability(st.plan, st.sessions, ws, [2, 5], TODAY);
  st = apply(st, res);
  const planned = wk(st, ws).filter(s => s.status === "planned");
  assert.equal(planned.length, 2);
  planned.forEach(s => assert.ok([2, 5].includes(dow(s.date)), s.date));
  assert.ok(planned.some(s => kindInfo(s.kind).key), "Schlüsseleinheit bleibt");
  assert.ok(wk(st, ws).filter(s => s.status === "skipped").length === before.length - 2);
});
test("Verschieben neben eine harte Einheit entschärft die zweite", () => {
  let st = fresh();
  const q = st.sessions.find(s => s.kind === "run_tempo" || s.kind === "run_intervals");
  assert.ok(q, "es gibt Qualitätseinheiten");
  // zwei Intervall-Einheiten künstlich hintereinander legen
  const other = st.sessions.find(s => s.id !== q.id && s.week === q.week && s.kind !== "event");
  let res = swapSession(st.plan, st.sessions, other.id, "run_intervals", 45, TODAY); st = apply(st, res);
  const oth = st.sessions.find(s => s.id === other.id); oth.locked = true;
  const target = addDays(st.sessions.find(s => s.id === q.id).date, 1);
  const t = st.sessions.find(s => s.id === q.id); st.sessions.find(s => s.id === q.id).kind = "run_intervals";
  res = moveSession(st.plan, st.sessions, other.id, target, "2026-11-01"); st = apply(st, res);
  const kinds = [st.sessions.find(s => s.id === q.id), st.sessions.find(s => s.id === other.id)].map(s => kindInfo(s.kind).intensity);
  assert.ok(!(kinds[0] === "hard" && kinds[1] === "hard") || res.notes.some(n => /hart/.test(n)), "entschärft oder gewarnt");
});
test("Verpasste Einheiten werden automatisch als ausgelassen markiert", () => {
  const st = fresh();
  const res = autoSkipMissed(st.plan, st.sessions, "2026-12-01");
  assert.ok(res.sessions.length >= 4); assert.ok(res.sessions.every(s => s.status === "skipped" && s.skipReason === "missed"));
});

function doLog(st, s, log) { return apply(st, completeSession(st.plan, st.sessions, s.id, log, s.date)); }
test("Auswertung Kraft: alle Sätze am oberen Ende + schmerzfrei → mehr Gewicht; bei Schmerz nicht", () => {
  let st = fresh("kraft");
  const s = st.sessions.find(x => x.kind === "strength_lower");
  const ex = s.exercises[0];
  const sets = {0: Array.from({length: ex.sets}, () => ({weight: "60", reps: String(ex.repMax)}))};
  st = doLog(st, s, {rpe: 6, pain: 0, durationMin: s.durationMin, sets});
  const done = st.sessions.find(x => x.id === s.id);
  const a = analyzeSession(st.plan, done, []);
  const r = a.exercises.find(e => e.name === ex.name);
  assert.equal(r.action, "increase_weight"); assert.ok(r.nextWeight > 60 && r.nextWeight <= 66.25);
  const hurt = analyzeSession(st.plan, {...done, log: {...done.log, pain: 3}}, []);
  assert.equal(hurt.exercises.find(e => e.name === ex.name).action, "hold"); assert.equal(hurt.zone, "yellow");
  const res = applyAnalysis(st.plan, st.sessions, s.id, a, s.date); st = apply(st, res);
  assert.equal(st.plan.meta.targets[ex.name].weight, r.nextWeight);
  const next = st.sessions.find(x => x.date > s.date && x.exercises.some(e => e.name === ex.name));
  assert.equal(next.exercises.find(e => e.name === ex.name).target.weight, r.nextWeight);
});
test("Auswertung Ausdauer: leichter als erwartet → künftige gleiche Einheiten +5 %", () => {
  let st = fresh();
  const s = st.sessions.find(x => x.kind === "run_easy" && x.date >= TODAY);
  const futureBefore = st.sessions.filter(x => x.kind === "run_easy" && x.date > addDays(weekStart(s.date), 6)).map(x => [x.id, x.durationMin]);
  st = doLog(st, s, {rpe: 2, pain: 0, durationMin: s.durationMin});
  const a = analyzeSession(st.plan, st.sessions.find(x => x.id === s.id), []);
  assert.equal(a.nextFactor, 1.05);
  st = apply(st, applyAnalysis(st.plan, st.sessions, s.id, a, s.date));
  const grown = futureBefore.filter(([id, m]) => st.sessions.find(x => x.id === id).durationMin > m);
  assert.ok(grown.length > 0);
});
test("Wiedereinstieg ohne Schmerzwert: keine Steigerung", () => {
  let st = fresh("wiedereinstieg");
  const s = st.sessions.find(x => x.kind === "strength_full");
  const ex = s.exercises[0];
  st = doLog(st, s, {rpe: 5, sets: {0: Array.from({length: ex.sets}, () => ({weight: "40", reps: String(ex.repMax)}))}});
  const a = analyzeSession(st.plan, st.sessions.find(x => x.id === s.id), []);
  assert.equal(a.exercises[0].action, "hold"); assert.equal(a.painKnown, false);
});
test("Garmin: Erholungs-Flags, Aktivitäts-Flags, Importvorschläge", () => {
  const daily = [...Array.from({length: 8}, (_, i) => ({date: `2026-11-${10 + i}`, restingHr: 50})), {date: "2026-11-23", restingHr: 57, sleepHours: 5.2, hrvStatus: "LOW", bodyBatteryMorning: 25}];
  const r = recoveryFlags(daily, "2026-11-23"); assert.equal(r.flags.length, 4);
  assert.equal(recoveryFlags(daily, "2026-11-01").flags.length, 0);
  assert.equal(activityFlags([{aerobicTE: 4.8}]).length, 1);
  const acts = [{id: "1", date: "2026-11-22", start: "07:00", type: "cycling", durationMin: 45}, {id: "2", date: "2026-11-22", type: "yoga", durationMin: 5}];
  assert.equal(importSuggestions(acts, [], "2026-11-20").length, 1);
  assert.equal(matchActivities(acts, "2026-11-22", "bike").length, 1);
});

import {normalizeExport} from "../engine/garmin.js";
test("Garmin-Exportdatei wird normalisiert und validiert", () => {
  const out = normalizeExport({activities: [{id: 5, date: "2026-11-20 07:00", start: "07:00:12", type: "Running", durationMin: "45,5", avgHr: 150}, {type: "x"}], daily: [{date: "2026-11-20", hrvStatus: "low", sleepHours: "7.5"}]});
  assert.equal(out.activities.length, 1); assert.deepEqual([out.activities[0].id, out.activities[0].date, out.activities[0].type, out.activities[0].durationMin, out.activities[0].start], ["5", "2026-11-20", "running", 45.5, "07:00"]);
  assert.deepEqual([out.daily[0].hrvStatus, out.daily[0].sleepHours], ["LOW", 7.5]);
  assert.throws(() => normalizeExport({}), /keine Aktivitäten/); assert.throws(() => normalizeExport(null));
});

import {GUIDE as _GUIDE, exerciseGuide as _eg} from "../engine/exercise-guide.js";
import {EXERCISES as _EX} from "../engine/catalog.js";
test("Jede Kraftübung hat eine vollständige Anleitung (Material, Schritte, Fehler)", () => {
  for (const e of _EX) { const g = _eg(e.name); assert.ok(g, e.name); assert.ok(g.gear.length > 5 && g.steps.length >= 3 && g.mistakes.length >= 1, e.name); }
  assert.ok(/Hüfte/.test(_GUIDE["Rumänisches Kreuzheben"].steps.join(" ")));
  assert.equal(_eg("Gibt es nicht"), null);
});
