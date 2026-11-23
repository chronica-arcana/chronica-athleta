import test from "node:test";
import assert from "node:assert/strict";
import {computeInsights, roundsDue, MIN_SESSIONS} from "../engine/insights.js";
import {addDays} from "../engine/dates.js";

const TODAY = "2026-11-23";
let n = 0;
const S = (daysAgo, sport, min, o = {}) => ({id: "s" + n++, planId: "p", date: addDays(TODAY, -daysAgo), status: "done", sport, kind: sport === "run" ? "run_easy" : sport === "strength" ? "strength_full" : sport === "mobility" ? "mobility" : "bike_easy", intensity: "easy", durationMin: min, load: min, log: {durationMin: min}, ...o});
const plan = {id: "p", goal: {mode: "performance", level: "intermediate", sports: ["run", "strength"]}, meta: {}};
const ids = (s, g) => computeInsights({sessions: s, garmin: g, plan, today: TODAY}).map(i => i.id);

test("Ab 5 Einheiten: Zeitpunkt für die Empfehlungen (alle 5 Einheiten, einmal pro Runde)", () => {
  assert.equal(MIN_SESSIONS, 5); assert.equal(roundsDue(4, 0), 0); assert.equal(roundsDue(5, 0), 1); assert.equal(roundsDue(5, 1), 0, "schon gesehen"); assert.equal(roundsDue(9, 1), 0); assert.equal(roundsDue(10, 1), 2); assert.equal(roundsDue(23, 3), 4);
  assert.deepEqual(computeInsights({sessions: [S(1, "run", 40), S(2, "run", 40)], plan, today: TODAY}), [], "weniger als 5 Einheiten: keine Empfehlungen");
});
test("Zu viel Tempo, Beschwerden und hohe Anstrengung werden erkannt und priorisiert", () => {
  const s = [1, 3, 5, 7, 9, 11].map((d, i) => S(d, "run", 50, {intensity: i % 2 ? "hard" : "moderate", log: {durationMin: 50, rpe: 9, pain: d === 1 ? 4 : 1}}));
  const out = computeInsights({sessions: s, plan, today: TODAY}), idList = out.map(i => i.id);
  for (const id of ["intensity_high", "rpe_high", "pain"]) assert.ok(idList.includes(id), id);
  assert.ok(out.every((i, k) => k === 0 || out[k - 1].priority >= i.priority), "hohe Priorität zuerst"); assert.ok(out.length <= 6);
  assert.match(out.find(i => i.id === "intensity_high").text, /100 %|\d+ % deiner Trainingszeit/); assert.ok(out.every(i => i.title && i.text && i.area));
});
test("Konsequent, locker und unauffällig: positive Rückmeldung statt Warnung", () => {
  const s = Array.from({length: 12}, (_, i) => S(i * 2 + 1, "run", 45, {log: {durationMin: 45, rpe: 4, pain: 0}}));
  const list = ids(s); assert.ok(list.includes("consistency_high") || list.includes("steady") || list.includes("streak")); assert.ok(!list.includes("intensity_high") && !list.includes("pain") && !list.includes("rpe_high"));
});
test("Viele ausgelassene Einheiten", () => {
  const done = [1, 2, 3, 4, 5].map(d => S(d, "run", 40)), skipped = [6, 7, 8, 9, 10, 11, 12].map(d => ({...S(d, "run", 40), status: "skipped"}));
  assert.ok(ids([...done, ...skipped]).includes("consistency_low"));
});
test("Kraft: Stillstand bei einer Übung und zu seltenes Krafttraining", () => {
  const ex = [{name: "Beinpresse", type: "weight"}], mk = (d, w) => S(d, "strength", 45, {exercises: ex, log: {durationMin: 45, sets: {0: [{weight: String(w), reps: "10"}]}}});
  const stuck = ids([mk(21, 60), mk(14, 60), mk(7, 60), S(1, "run", 40), S(3, "run", 40)]); assert.ok(stuck.includes("strength_plateau")); 
  const up = ids([mk(21, 60), mk(14, 62.5), mk(7, 65), S(1, "run", 40), S(3, "run", 40)]); assert.ok(!up.includes("strength_plateau"));
  assert.ok(ids(Array.from({length: 6}, (_, i) => S(i * 3 + 1, "run", 40))).includes("strength_rare"), "Plan hat Kraft, aber keine Krafteinheit");
});
test("Garmin: Schlaf, Ruhepuls, Schritte, VO2max", () => {
  const s = Array.from({length: 6}, (_, i) => S(i + 1, "run", 40));
  const daily = Array.from({length: 21}, (_, i) => ({date: addDays(TODAY, -(20 - i)), sleepHours: 5.6, restingHr: i < 14 ? 50 : 55, steps: 4500, vo2max: i % 7 === 0 ? 52 - i / 10 : null}));
  const out = computeInsights({sessions: s, garmin: {activities: [], daily}, plan, today: TODAY}), idList = out.map(i => i.id);
  for (const id of ["sleep", "rhr_up", "vo2_down"]) assert.ok(idList.includes(id), id);
  const sleep = out.find(i => i.id === "sleep"); assert.equal(sleep.tone, "warn"); assert.match(sleep.title, /5,6 h/);
  const good = computeInsights({sessions: s, garmin: {activities: [], daily: Array.from({length: 21}, (_, i) => ({date: addDays(TODAY, -(20 - i)), sleepHours: 7.8, steps: 11000, vo2max: i % 7 === 0 ? 50 + i / 10 : null}))}, plan, today: TODAY});
  assert.ok(good.some(i => i.id === "vo2_up" && i.tone === "good")); assert.ok(!good.some(i => i.id === "sleep" || i.id === "steps_low"));
});
test("Umfangssprung und fehlende Mobilität", () => {
  const s = [...[1, 2, 3, 4].map(d => S(8 + d, "run", 120)), ...[15, 22, 29].map(d => S(d, "run", 20)), ...Array.from({length: 7}, (_, i) => S(i + 1, "strength", 45))];
  const list = ids(s); assert.ok(list.includes("volume_jump") || list.includes("mobility"));
  assert.ok(ids([...s, S(2, "mobility", 25)]).indexOf("mobility") === -1, "Yoga vorhanden: keine Mobilitäts-Empfehlung");
});
