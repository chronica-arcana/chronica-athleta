import test from "node:test";
import assert from "node:assert/strict";
import {computeStats, streakDays, streakWeeks} from "../engine/stats.js";
import {computeAwards} from "../engine/awards.js";
import {addDays} from "../engine/dates.js";

const TODAY = "2026-11-23";
let n = 0;
const S = (date, sport, min, extra = {}) => ({id: "s" + (n++), date, status: "done", sport, kind: sport === "run" ? "run_easy" : sport === "bike" ? "bike_easy" : sport === "strength" ? "strength_full" : "mobility", intensity: "easy", durationMin: min, load: min, log: {durationMin: min}, ...extra});
const days = (k, sport = "run", min = 40) => Array.from({length: k}, (_, i) => S(addDays(TODAY, -(k - 1 - i)), sport, min));

test("Serien: Tage und Wochen, auch wenn heute noch nichts war", () => {
  const set = new Set([addDays(TODAY, -1), addDays(TODAY, -2), addDays(TODAY, -3), addDays(TODAY, -5)]);
  assert.equal(streakDays(set, TODAY), 3, "heute zählt noch nicht als Unterbrechung"); assert.equal(streakDays(new Set([TODAY, addDays(TODAY, -1)]), TODAY), 2); assert.equal(streakDays(new Set(), TODAY), 0);
  assert.equal(streakWeeks(new Set([TODAY, addDays(TODAY, -7), addDays(TODAY, -14), addDays(TODAY, -28)]), TODAY), 3);
});
test("Statistik: Summen, Vergleich zum Vormonat, Intensität, Sportarten, Wochenreihe", () => {
  const sessions = [...days(10), S(addDays(TODAY, -40), "run", 60, {intensity: "hard", log: {durationMin: 60, distanceKm: 12}}), S(addDays(TODAY, -3), "bike", 90, {intensity: "moderate", log: {durationMin: 90, distanceKm: 40}}), {...S(TODAY, "run", 30), status: "planned"}];
  const st = computeStats({sessions, today: TODAY});
  assert.equal(st.total.count, 12); assert.equal(st.total.minutes, 10 * 40 + 60 + 90); assert.equal(st.total.distance, 52); assert.equal(st.total.streakDays, 10); assert.equal(st.total.activeDays, 11, "Rad und Lauf am selben Tag zählen als ein aktiver Tag");
  assert.equal(st.compare.cur.count, 11); assert.equal(st.compare.prev.count, 1); assert.equal(st.compare.minutesDelta, Math.round((490 - 60) / 60 * 100));
  assert.deepEqual(st.intensity, {easy: 400, moderate: 90, hard: 60}); assert.equal(st.bySport.run.count, 11); assert.equal(st.bySport.bike.distance, 40);
  assert.equal(st.weekly.length, 12); assert.ok(st.weekly.at(-1).minutes > 0);
  assert.equal(computeStats({sessions: [], today: TODAY}).total.count, 0);
});
test("Statistik Kraft: Volumen, Sätze und Übungen mit Steigerung", () => {
  const ex = [{name: "Beinpresse", type: "weight"}], mk = (date, w) => S(date, "strength", 45, {exercises: ex, log: {durationMin: 45, sets: {0: [{weight: String(w), reps: "10"}, {weight: String(w), reps: "10"}]}}});
  const st = computeStats({sessions: [mk(addDays(TODAY, -14), 60), mk(addDays(TODAY, -7), 65), mk(TODAY, 70)], today: TODAY});
  assert.equal(st.strength.volume, (60 + 65 + 70) * 20); assert.equal(st.strength.sets, 6);
  assert.deepEqual(st.strength.gains.map(g => [g.name, g.from, g.to]), [["Beinpresse", 60, 70]]);
});
test("Statistik Garmin: Schritte, Schlaf, Ruhepuls-Trend, VO2max", () => {
  const daily = Array.from({length: 20}, (_, i) => ({date: addDays(TODAY, -(19 - i)), steps: 8000 + i * 100, sleepHours: 7, restingHr: i < 10 ? 54 : 51, vo2max: i % 5 === 0 ? 50 + i / 10 : null}));
  const g = computeStats({sessions: [], garmin: {activities: [], daily}, today: TODAY}).garmin;
  assert.equal(g.hasData, true); assert.equal(g.steps7, Math.round((8000 + 13 * 100 + 8000 + 19 * 100) / 2)); assert.equal(g.bestSteps, 9900); assert.equal(g.sleep7, 7);
  assert.equal(g.rhr7, 51); assert.equal(g.rhrDelta, -1.7, "Ø letzte 7 Tage (51) gegen die Woche davor (54/51 gemischt)"); assert.equal(g.vo2.first, 50); assert.equal(g.vo2.latest, 51.5); assert.equal(g.vo2.delta, 1.5);
  assert.equal(computeStats({sessions: [], today: TODAY}).garmin.hasData, false);
});

test("Auszeichnungen: nur erreichte, mit Datum, absteigend sortiert", () => {
  assert.deepEqual(computeAwards({sessions: [], today: TODAY}), [], "ohne Training keine Auszeichnung");
  const a = computeAwards({sessions: days(12), today: TODAY}), ids = a.map(x => x.id);
  for (const id of ["count1", "count10", "streak3", "streak7"]) assert.ok(ids.includes(id), id);
  for (const id of ["count25", "streak14", "time100", "variety3"]) assert.ok(!ids.includes(id), "noch nicht erreicht: " + id);
  assert.equal(a.find(x => x.id === "count10").date, addDays(TODAY, -(12 - 10)), "Datum der 10. Einheit"); assert.equal(a.find(x => x.id === "count1").date, addDays(TODAY, -11));
  assert.ok(a.every((x, i) => i === 0 || a[i - 1].date >= x.date)); assert.ok(a.every(x => x.title && x.desc && x.group));
  assert.ok(ids.includes("wstreak4") === false && computeAwards({sessions: [...days(1), ...days(1).map(s => ({...s, id: "w1", date: addDays(TODAY, -7)})), {...days(1)[0], id: "w2", date: addDays(TODAY, -14)}, {...days(1)[0], id: "w3", date: addDays(TODAY, -21)}], today: TODAY}).some(x => x.id === "wstreak4"));
});
test("Auszeichnungen: Zeit, Distanz (Garmin), Vielfalt, Kraft, Alltag, Schlaf, VO2max, Wochenziel", () => {
  const ex = [{name: "Kniebeuge", type: "weight"}], str = (date, w) => S(date, "strength", 45, {exercises: ex, log: {durationMin: 45, sets: {0: [{weight: String(w), reps: "10"}]}}});
  const sessions = [S("2026-10-01", "run", 600), S("2026-10-02", "bike", 30), S("2026-10-03", "mobility", 30), str("2026-10-04", 80), str("2026-10-11", 100)];
  const garmin = {activities: [{id: "g", date: "2026-10-05", type: "running", distanceKm: 10.4, durationMin: 55}, {id: "h", date: "2026-10-06", type: "cycling", distanceKm: 61, durationMin: 120}],
    daily: [...Array.from({length: 8}, (_, i) => ({date: addDays("2026-10-10", i), sleepHours: 7.4, steps: i === 3 ? 21000 : 9000, vo2max: 50 + (i === 7 ? 2 : 0)}))]};
  const target = {"2026-09-21": 50, "2026-09-28": 700, "2026-10-05": 500}, plans = [{startDate: "2026-09-28", endDate: "2026-12-31", meta: {weekTargets: target}}]; // Woche vor Planstart zählt nicht
  const ids = new Map(computeAwards({sessions, garmin, plans, today: TODAY}).map(x => [x.id, x]));
  assert.equal(ids.get("time10").date, "2026-10-01"); assert.equal(ids.get("dist_run_10").date, "2026-10-05"); assert.ok(!ids.has("dist_run_21.1")); assert.equal(ids.get("dist_bike_50").date, "2026-10-06");
  assert.equal(ids.get("variety3").date, "2026-10-03"); assert.equal(ids.get("yoga5"), undefined); assert.equal(ids.get("stronger").date, "2026-10-11");
  assert.equal(ids.get("steps10k").date, "2026-10-13"); assert.equal(ids.get("steps20k").date, "2026-10-13"); assert.equal(ids.get("sleep7").date, "2026-10-16"); assert.equal(ids.get("vo2pb").date, "2026-10-17", "neuer Bestwert nach genug Messwerten");
  assert.equal(ids.get("weekgoal1").date, "2026-10-04", "Woche vom 28.9. erreicht"); assert.ok(!ids.has("weekgoal4"));
});

import {readiness as _rd} from "../engine/readiness.js";
test("Stress am Vortag senkt die Bereitschaft", () => {
  const mk = st => [{date: "2026-11-22", stressAvg: st, steps: 5000}, {date: "2026-11-23", sleepHours: 7.5, restingHr: 50, hrvStatus: "BALANCED"}];
  const hi = _rd(mk(65), "2026-11-23"), lo = _rd(mk(20), "2026-11-23");
  assert.ok(hi.score < lo.score); assert.ok(hi.factors.some(f => /Stress/.test(f.text))); assert.equal(hi.stress, 65);
});
