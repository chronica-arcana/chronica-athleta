// Trainingsbereitschaft und Belastungsverhältnis, berechnet aus Garmin-Tageswerten und dem bisherigen Training.
// (Garmins eigene "Training Readiness"/"Recovery Time" stehen nicht in der Personal-API-Endpunktliste – darum eigene Berechnung.)
import {sportOfActivity} from "./garmin.js";
import {actualLoad} from "./adapt.js";
import {addDays} from "./dates.js";

const median = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const LPM = {run: 1.3, bike: 1.1, swim: 1.4, strength: 1.3, football: 1.6, cardio: 1.2, mobility: 0.5, walk: 0.6};

// Belastung einer Garmin-Aktivität (gleiche Einheit wie die Plan-Last: Minuten × Faktor), Trainingseffekt erhöht sie
export function activityLoad(a) {
  const sport = sportOfActivity(a.type) || "cardio";
  let l = (a.durationMin || 0) * (LPM[sport] || 1.1);
  if (a.aerobicTE >= 4) l *= 1.35; else if (a.aerobicTE >= 3) l *= 1.15;
  return Math.round(l);
}
// Gesamtbelastung eines Tages: erledigte Einheiten + Garmin-Aktivitäten, die noch keiner Einheit zugeordnet sind (keine Doppelzählung)
export function dayLoad(date, sessions, activities) {
  const done = sessions.filter(s => s.status === "done" && s.date === date);
  const linked = new Set(done.map(s => s.log && s.log.garminActivityId).filter(Boolean).map(String));
  return done.reduce((a, s) => a + actualLoad(s), 0) + (activities || []).filter(a => a.date === date && !linked.has(String(a.id))).reduce((a, x) => a + activityLoad(x), 0);
}
// Akut (7 Tage) gegen chronisch (Ø der letzten 28 Tage je Woche)
export function workload(sessions, activities, date) {
  let acute = 0, chronic = 0;
  for (let i = 0; i < 28; i++) { const l = dayLoad(addDays(date, -i), sessions, activities); chronic += l; if (i < 7) acute += l; }
  const weekly = chronic / 4;
  if (weekly < 60) return {ratio: null, acute, weekly, level: "unknown"};
  const ratio = Math.round(acute / weekly * 100) / 100;
  return {ratio, acute, weekly, level: ratio > 1.5 ? "high" : ratio < 0.6 ? "low" : "ok"};
}

const HRV = {BALANCED: [8, "HRV ausgeglichen"], UNBALANCED: [-8, "HRV unausgeglichen"], LOW: [-18, "HRV niedrig"], POOR: [-25, "HRV schwach"]};
export function readiness(daily, date, {activities = [], sessions = []} = {}) {
  const d = (daily || []).find(x => x.date === date);
  if (!d || (d.sleepHours == null && d.restingHr == null && !d.hrvStatus && d.bodyBatteryMorning == null)) return null;
  let score = 70; const factors = [], add = (delta, text) => { score += delta; factors.push({delta, text}); };
  if (d.sleepHours != null) { if (d.sleepHours < 5.5) add(-25, "sehr wenig Schlaf"); else if (d.sleepHours < 6.5) add(-12, "wenig Schlaf"); else if (d.sleepHours >= 7.5) add(5, "guter Schlaf"); }
  const h = d.hrvStatus && HRV[String(d.hrvStatus).toUpperCase()]; if (h) add(h[0], h[1]);
  const prior = daily.filter(x => x.date < date && x.restingHr != null).slice(-14).map(x => x.restingHr), base = prior.length >= 5 ? median(prior) : null;
  if (base != null && d.restingHr != null) { const dl = d.restingHr - base; if (dl >= 7) add(-20, "Ruhepuls deutlich erhöht"); else if (dl >= 4) add(-10, "Ruhepuls erhöht"); else if (dl <= -2) add(3, "Ruhepuls niedrig"); }
  if (d.bodyBatteryMorning != null) { if (d.bodyBatteryMorning < 25) add(-20, "Body Battery sehr niedrig"); else if (d.bodyBatteryMorning < 40) add(-10, "Body Battery niedrig"); else if (d.bodyBatteryMorning >= 70) add(8, "Body Battery hoch"); }
  const y = daily.find(x => x.date === addDays(date, -1)); if (y && y.steps != null) { if (y.steps >= 20000) add(-8, "sehr viele Schritte gestern"); else if (y.steps >= 15000) add(-4, "viele Schritte gestern"); }
  const yl = dayLoad(addDays(date, -1), sessions, activities), w = workload(sessions, activities, addDays(date, -1));
  if (w.weekly >= 60 && yl > 1.8 * (w.weekly / 7) && yl > 90) add(-10, "hohe Belastung gestern");
  if (w.level === "high") add(-8, "hohe Wochenbelastung");
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 65 ? "high" : score >= 45 ? "medium" : "low";
  const recommendation = level === "high" ? "train" : level === "medium" ? "easy" : "rest";
  const text = level === "high" ? "Gut erholt: Training wie geplant." : level === "medium" ? "Mäßig erholt: Umfang etwas reduzieren, keine zusätzliche Intensität." : "Wenig erholt: heute Ruhetag oder Yoga/Mobility statt Training.";
  return {score, level, recommendation, text, factors, workload: w, steps: d.steps ?? null, vo2max: d.vo2max ?? null};
}
