import test from "node:test";
import assert from "node:assert/strict";
import {generatePlan} from "../engine/planner.js";
import {FLOWS, buildFlow, pickFlow} from "../engine/yoga.js";
import {readiness, workload, activityLoad, dayLoad} from "../engine/readiness.js";
import {applyReadiness, importGarminActivities} from "../engine/auto.js";
import {setAvailability} from "../engine/adapt.js";
import {kindInfo} from "../engine/catalog.js";
import {addDays, weekStart} from "../engine/dates.js";

const TODAY = "2026-11-24"; // Dienstag
const goal = {sports: ["run", "strength"], primary: "run", level: "intermediate", daysPerWeek: 4, minutesPerSession: 50, equipment: "dumbbell", event: {preset: "run_half", date: "2027-03-14"}, startDate: "2026-11-23"};
const fresh = (g = goal) => generatePlan(g, {planId: "p"});
const apply = (st, res) => { const m = new Map(st.sessions.map(s => [s.id, s])); res.sessions.forEach(s => m.set(s.id, s)); res.removed.forEach(id => m.delete(id)); return {plan: res.plan, sessions: [...m.values()].sort((a, b) => a.date.localeCompare(b.date))}; };
const day = (date, o) => ({date, restingHr: 50, sleepHours: 7.6, hrvStatus: "BALANCED", bodyBatteryMorning: 80, ...o});
const history = n => Array.from({length: n}, (_, i) => day(addDays(TODAY, -(n - i)), {}));

test("Yoga-Abläufe: Dauer wird auf die geplante Minutenzahl skaliert, Auswahl nach Kontext", () => {
  for (const key of Object.keys(FLOWS)) {
    const flow = buildFlow(key, 25), total = flow.reduce((a, p) => a + p.seconds, 0) / 60;
    assert.ok(Math.abs(total - 25) <= 2.5, `${key}: ${total} Min`); assert.ok(flow.every(p => p.name && p.cue && p.seconds >= 20 && /^\d+:\d\d$/.test(p.label)));
  }
  assert.equal(pickFlow({after: "strength"}), "strength"); assert.equal(pickFlow({deload: true}), "relax"); assert.equal(pickFlow({}), "regeneration"); assert.equal(pickFlow({flowKey: "morning"}), "morning");
});

test("Plan enthält Yoga mit Ablauf, wenn sinnvoll (Entlastungswoche, Gesundheit) – und nicht ständig", () => {
  const {sessions} = fresh();
  const yoga = sessions.filter(s => s.kind === "mobility");
  assert.ok(yoga.length > 0 && yoga.length < sessions.filter(s => s.week >= 0).length / 3, "gelegentlich, nicht jede Woche");
  assert.ok(yoga.every(s => s.flow && s.flow.length >= 5 && s.title.startsWith("Yoga:") && s.priority === "bonus"));
  const deloadWeeks = new Set(sessions.filter(s => s.ctx.deload).map(s => s.week));
  for (const w of deloadWeeks) if (w >= 1) assert.ok(sessions.some(s => s.week === w && s.kind === "mobility"), `Entlastungswoche ${w} hat Yoga`);
  const health = fresh({sports: ["run"], primary: "run", level: "beginner", daysPerWeek: 3, minutesPerSession: 35, mode: "health", weeks: 6, startDate: "2026-11-25"}).sessions;
  assert.ok(new Set(health.filter(s => s.kind === "mobility").map(s => s.week)).size >= 4, "Gesundheitsziel: fast jede Woche");
  const off = fresh({...goal, autoYoga: false}).sessions; assert.ok(!off.some(s => s.kind === "mobility"));
  // Yoga liegt nie am Eventtag und nie an einem Tag mit anderer Einheit
  const dates = sessions.map(s => s.date); assert.equal(new Set(dates).size, dates.length);
});
test("Bei Platzmangel (Woche anpassen) entfällt Yoga zuerst", () => {
  let st = fresh(); const ws = weekStart(addDays(TODAY, 21)), wk = st.sessions.filter(s => weekStart(s.date) === ws);
  assert.ok(wk.some(s => s.kind === "mobility"), "Testwoche enthält Yoga");
  const res = setAvailability(st.plan, st.sessions, ws, [1, 3, 5, 6], TODAY); st = apply(st, res);
  const kept = st.sessions.filter(s => weekStart(s.date) === ws && s.status === "planned");
  assert.equal(kept.length, 4); assert.ok(!kept.some(s => s.kind === "mobility"), "Yoga wurde zuerst gestrichen");
});

test("Bereitschaft: gut/mäßig/schlecht, Schritte, fehlende Daten", () => {
  const good = readiness([...history(10), day(TODAY, {})], TODAY); assert.equal(good.level, "high"); assert.equal(good.recommendation, "train"); assert.ok(good.score >= 65);
  const bad = readiness([...history(10), day(TODAY, {sleepHours: 5.1, hrvStatus: "LOW", restingHr: 59, bodyBatteryMorning: 22})], TODAY);
  assert.equal(bad.level, "low"); assert.equal(bad.recommendation, "rest"); assert.ok(bad.factors.some(f => /Schlaf/.test(f.text)) && bad.factors.some(f => /Ruhepuls/.test(f.text)));
  const mid = readiness([...history(10), day(TODAY, {sleepHours: 6.1, hrvStatus: "UNBALANCED"})], TODAY); assert.equal(mid.level, "medium"); assert.equal(mid.recommendation, "easy");
  const steps = readiness([...history(9).slice(0, 8), day(addDays(TODAY, -1), {steps: 24000}), day(TODAY, {})], TODAY); assert.ok(steps.factors.some(f => /Schritte/.test(f.text)));
  assert.equal(readiness(history(5), TODAY), null, "keine Daten für heute"); assert.equal(readiness([{date: TODAY}], TODAY), null);
  assert.equal(good.vo2max, null); assert.equal(readiness([...history(6), day(TODAY, {vo2max: 52})], TODAY).vo2max, 52);
});
test("Belastung: Garmin-Aktivitäten zählen, ohne mit erledigten Einheiten doppelt gezählt zu werden", () => {
  const acts = [{id: "g1", date: addDays(TODAY, -1), type: "cycling", durationMin: 120, aerobicTE: 3.5}];
  assert.ok(activityLoad(acts[0]) > 120 * 1.1 && activityLoad(acts[0]) < 120 * 1.1 * 1.2);
  assert.equal(dayLoad(addDays(TODAY, -1), [], acts), activityLoad(acts[0]));
  const done = {status: "done", date: addDays(TODAY, -1), kind: "bike_easy", durationMin: 120, load: 108, log: {durationMin: 120, garminActivityId: "g1"}};
  assert.equal(dayLoad(addDays(TODAY, -1), [done], acts), Math.round(120 * kindInfo("bike_easy").loadPerMin), "verknüpft: nur einmal");
  const many = Array.from({length: 28}, (_, i) => ({id: "a" + i, date: addDays(TODAY, -i), type: "running", durationMin: i < 7 ? 90 : 30}));
  const w = workload([], many, TODAY); assert.equal(w.level, "high"); assert.ok(w.ratio > 1.5);
  assert.equal(workload([], [], TODAY).level, "unknown");
});

test("Anpassung nach Bereitschaft: niedrig -> Yoga statt Training, mäßig -> 15 % kürzer, hoch -> unverändert, einmal pro Tag", () => {
  const st = fresh(), todayHard = st.sessions.find(s => s.date >= TODAY && s.status === "planned" && s.kind === "strength_full");
  const res0 = applyReadiness(st.plan, st.sessions, todayHard.date, {level: "high", score: 80, factors: []}); assert.equal(res0.sessions.length, 0);
  const low = {level: "low", score: 31, factors: [{delta: -25, text: "sehr wenig Schlaf"}, {delta: -18, text: "HRV niedrig"}]};
  const res = applyReadiness(st.plan, st.sessions, todayHard.date, low), after = apply(st, res), s = after.sessions.find(x => x.id === todayHard.id);
  assert.equal(s.kind, "mobility"); assert.ok(s.flow.length >= 5); assert.equal(s.flowKey, "relax"); assert.ok(s.auto && /Erholung niedrig/.test(s.auto.reason));
  assert.ok(res.notes.some(n => /Yoga\/Mobility ersetzt/.test(n))); assert.equal(after.plan.meta.debt.strength, 0, "Kraft wurde bereits als Snack nachgeholt oder verworfen");
  assert.equal(applyReadiness(after.plan, after.sessions, todayHard.date, low).sessions.length, 0, "idempotent");
  // Yoga heute -> automatisch geplantes Yoga der nächsten zwei Tage entfällt
  const withYoga = fresh({sports: ["run", "strength"], primary: "run", level: "beginner", daysPerWeek: 3, minutesPerSession: 35, mode: "health", weeks: 6, startDate: "2026-11-24"});
  const mon = withYoga.sessions.find(x => x.status === "planned" && x.kind === "strength_full"), nextYoga = withYoga.sessions.find(x => x.kind === "mobility" && x.date > mon.date && x.date <= addDays(mon.date, 2));
  if (nextYoga) { const r = apply(withYoga, applyReadiness(withYoga.plan, withYoga.sessions, mon.date, low)); assert.equal(r.sessions.find(x => x.id === nextYoga.id).status, "skipped"); assert.equal(r.sessions.find(x => x.id === mon.id).kind, "mobility"); }
  // mäßig: Ausdauereinheit wird gekürzt
  const run = st.sessions.find(x => x.date >= TODAY && x.status === "planned" && x.kind === "run_tempo" || x.kind === "run_long" && x.status === "planned" && x.date >= TODAY);
  const mid = apply(st, applyReadiness(st.plan, st.sessions, run.date, {level: "medium", score: 52, factors: [{delta: -12, text: "wenig Schlaf"}]})).sessions.find(x => x.id === run.id);
  assert.ok(mid.durationMin < run.durationMin && mid.durationMin >= run.durationMin * 0.8 - 5, `${run.durationMin} -> ${mid.durationMin}`); assert.ok(mid.auto);
  // vom Nutzer festgelegte Einheiten bleiben unberührt
  const locked = {...st, sessions: st.sessions.map(x => x.id === todayHard.id ? {...x, locked: true} : x)};
  assert.equal(applyReadiness(locked.plan, locked.sessions, todayHard.date, low).sessions.filter(x => x.id === todayHard.id).length, 0);
});

test("Garmin-Aktivitäten werden automatisch übernommen (geplante Einheit erledigt oder zusätzliche Einheit), ohne Doppelungen", () => {
  let st = fresh();
  const planned = st.sessions.find(s => s.date >= TODAY && s.status === "planned" && s.sport === "run");
  const acts = [{id: "g1", date: planned.date, start: "07:00", type: "running", name: "Morgenlauf", durationMin: 41, distanceKm: 7.2, avgHr: 149},
    {id: "g2", date: TODAY, start: "18:00", type: "cycling", name: "Radtour", durationMin: 150, avgHr: 128, aerobicTE: 3.2}];
  const res = importGarminActivities(st.plan, st.sessions, acts, planned.date > TODAY ? planned.date : TODAY, addDays(TODAY, -10));
  assert.equal(res.count, 2); st = apply(st, res);
  const linked = st.sessions.find(s => s.id === planned.id);
  assert.equal(linked.status, "done"); assert.equal(linked.log.garminActivityId, "g1"); assert.equal(linked.log.durationMin, 41); assert.equal(linked.log.distanceKm, 7.2);
  const extra = st.sessions.find(s => s.log && s.log.garminActivityId === "g2"); assert.ok(extra); assert.equal(extra.title, "Radtour", "Titel aus Garmin"); assert.equal(extra.source, "garmin"); assert.equal(extra.sport, "bike"); assert.equal(extra.status, "done");
  assert.ok(res.notes.length === 2 && res.notes.some(n => /als erledigt übernommen/.test(n)) && res.notes.some(n => /passt sich an/.test(n)));
  const again = importGarminActivities(st.plan, st.sessions, acts, TODAY, addDays(TODAY, -10)); assert.equal(again.count, 0, "zweiter Import übernimmt nichts doppelt");
  // lange Radtour erhöht die Wochenbelastung -> restliche Einheiten der Woche werden gekürzt (Rebalancing)
  const ws = weekStart(extra.date), restBefore = fresh().sessions.filter(s => weekStart(s.date) === ws && s.date > extra.date && s.status === "planned").reduce((a, s) => a + s.durationMin, 0);
  const restAfter = st.sessions.filter(s => weekStart(s.date) === ws && s.date > extra.date && s.status === "planned").reduce((a, s) => a + s.durationMin, 0);
  assert.ok(restAfter <= restBefore, `${restBefore} -> ${restAfter}`);
});

test("Nachträglich eingetragene Aktivität vor dem Planstart erzeugt kein Wochenziel", () => {
  const st = fresh(), before = addDays(weekStart(st.plan.startDate), -3); // Woche vor dem Plan
  const res = importGarminActivities(st.plan, st.sessions, [{id: "x", date: before, start: "08:00", type: "cycling", name: "Tour", durationMin: 120}], TODAY, addDays(before, -1));
  assert.equal(res.count, 1); assert.equal(res.plan.meta.weekTargets[weekStart(before)], undefined, "kein Ziel für eine Woche außerhalb des Plans");
});

import {typicalActivity, sportsByUsage} from "../engine/garmin.js";
test("Typische Garmin-Aktivität je Sportart (Median) und Sortierung nach Nutzung", () => {
  const acts = [...[40, 50, 60, 45, 55].map((m, i) => ({id: "r" + i, date: addDays(TODAY, -(i * 3 + 1)), start: "07:00", type: "running", durationMin: m, distanceKm: m / 6, avgHr: 150})),
    {id: "b1", date: addDays(TODAY, -2), start: "09:00", type: "cycling", durationMin: 120, distanceKm: 40, avgHr: 130}, {id: "old", date: addDays(TODAY, -200), start: "07:00", type: "swimming", durationMin: 30}, {id: "kurz", date: addDays(TODAY, -1), start: "07:00", type: "cycling", durationMin: 4}];
  const run = typicalActivity(acts, "run", TODAY); assert.equal(run.count, 5); assert.equal(run.minutes, 50); assert.equal(run.avgHr, 150); assert.equal(run.distanceKm, 8.3);
  assert.equal(typicalActivity(acts, "bike", TODAY).minutes, 120, "zu kurze Aktivitäten (<10 Min) zählen nicht"); assert.equal(typicalActivity(acts, "swim", TODAY), null, "älter als 90 Tage");
  assert.equal(typicalActivity([], "run", TODAY), null);
  assert.deepEqual(sportsByUsage(acts, ["swim", "bike", "run", "strength"], TODAY).slice(0, 2), ["run", "bike"], "meistgenutzte zuerst");
  assert.deepEqual(sportsByUsage([], ["swim", "run"], TODAY), ["swim", "run"], "ohne Daten bleibt die Reihenfolge");
});
