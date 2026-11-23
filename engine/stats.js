// Statistiken aus erledigten Einheiten und Garmin-Tageswerten.
import {addDays, weekStart, diffDays} from "./dates.js";
import {actualLoad} from "./adapt.js";
import {workload} from "./readiness.js";

export const minutesOf = s => Number(s.log && s.log.durationMin) || s.durationMin || 0;
export const distanceOf = s => Number(s.log && s.log.distanceKm) || 0;
export const doneOf = sessions => sessions.filter(s => s.status === "done").sort((a, b) => a.date.localeCompare(b.date));
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const round1 = v => v == null ? null : Math.round(v * 10) / 10;

export function streakDays(dates, today) {
  let d = dates.has(today) ? today : addDays(today, -1), n = 0;
  while (dates.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export function streakWeeks(dates, today) {
  const weeks = new Set([...dates].map(weekStart)); let w = weeks.has(weekStart(today)) ? weekStart(today) : addDays(weekStart(today), -7), n = 0;
  while (weeks.has(w)) { n++; w = addDays(w, -7); }
  return n;
}
const windowOf = (done, from, to) => { const l = done.filter(s => s.date >= from && s.date <= to); return {count: l.length, minutes: l.reduce((a, s) => a + minutesOf(s), 0), load: l.reduce((a, s) => a + actualLoad(s), 0), distance: round1(l.reduce((a, s) => a + distanceOf(s), 0))}; };
const pct = (cur, prev) => prev > 0 ? Math.round((cur - prev) / prev * 100) : null;

export function computeStats({sessions, garmin = {activities: [], daily: []}, today}) {
  const done = doneOf(sessions), dates = new Set(done.map(s => s.date));
  const total = {count: done.length, minutes: done.reduce((a, s) => a + minutesOf(s), 0), distance: round1(done.reduce((a, s) => a + distanceOf(s), 0)), activeDays: dates.size,
    longest: done.reduce((m, s) => Math.max(m, minutesOf(s)), 0), streakDays: streakDays(dates, today), streakWeeks: streakWeeks(dates, today)};
  const cur = windowOf(done, addDays(today, -27), today), prev = windowOf(done, addDays(today, -55), addDays(today, -28));
  const compare = {cur, prev, minutesDelta: pct(cur.minutes, prev.minutes), countDelta: pct(cur.count, prev.count)};
  const intensity = {easy: 0, moderate: 0, hard: 0}; done.forEach(s => { if (intensity[s.intensity] != null) intensity[s.intensity] += minutesOf(s); });
  const bySport = {}; done.forEach(s => { const e = bySport[s.sport] || (bySport[s.sport] = {minutes: 0, count: 0, distance: 0}); e.minutes += minutesOf(s); e.count++; e.distance += distanceOf(s); });
  // Kraft: Volumen (kg), Sätze, Übungen mit Steigerung
  let volume = 0, sets = 0; const byEx = new Map();
  done.forEach(s => (s.exercises || []).forEach((ex, i) => {
    const l = s.log && s.log.sets && s.log.sets[i]; if (!Array.isArray(l)) return; let top = null;
    l.forEach(x => { const w = parseFloat(String(x.weight ?? "").replace(",", ".")), r = parseFloat(x.reps); if (Number.isFinite(r)) sets++; if (Number.isFinite(w) && Number.isFinite(r)) { volume += w * r; top = Math.max(top ?? 0, w); } });
    if (top != null) { if (!byEx.has(ex.name)) byEx.set(ex.name, []); byEx.get(ex.name).push({date: s.date, top}); }
  }));
  const gains = [...byEx.entries()].map(([name, l]) => ({name, from: l[0].top, to: Math.max(...l.map(x => x.top)), last: l[l.length - 1].top, sessions: l.length})).filter(e => e.to > e.from).sort((a, b) => (b.to - b.from) / b.from - (a.to - a.from) / a.from);
  const strength = {volume: Math.round(volume), sets, gains};
  // Wochenreihe (Minuten) der letzten 12 Wochen
  const weekly = Array.from({length: 12}, (_, i) => { const ws = addDays(weekStart(today), -(11 - i) * 7); return {week: ws, minutes: windowOf(done, ws, addDays(ws, 6)).minutes}; });
  // Garmin
  const daily = (garmin.daily || []).filter(d => d.date <= today), last = (n, k) => daily.filter(d => d.date > addDays(today, -n) && d[k] != null).map(d => d[k]);
  const rhr7 = avg(last(7, "restingHr")), rhrPrev = avg(daily.filter(d => d.date <= addDays(today, -7) && d.date > addDays(today, -14) && d.restingHr != null).map(d => d.restingHr));
  const vo2 = daily.filter(d => d.vo2max != null).map(d => ({date: d.date, v: d.vo2max}));
  const g = {steps7: avg(last(7, "steps")) != null ? Math.round(avg(last(7, "steps"))) : null, steps30: avg(last(30, "steps")) != null ? Math.round(avg(last(30, "steps"))) : null,
    bestSteps: daily.reduce((m, d) => Math.max(m, d.steps || 0), 0) || null, sleep7: round1(avg(last(7, "sleepHours"))), rhr7: round1(rhr7), rhrDelta: rhr7 != null && rhrPrev != null ? round1(rhr7 - rhrPrev) : null,
    vo2: vo2.length ? {latest: vo2[vo2.length - 1].v, first: vo2[0].v, delta: round1(vo2[vo2.length - 1].v - vo2[0].v), series: vo2} : null, hasData: daily.length > 0};
  return {total, compare, intensity, bySport, strength, weekly, garmin: g, workload: workload(sessions, garmin.activities || [], today)};
}
