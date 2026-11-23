// Auszeichnungen: es werden nur erreichte zurückgegeben (mit Datum), nie gesperrte.
import {addDays, weekStart} from "./dates.js";
import {doneOf, minutesOf} from "./stats.js";
import {sportOfActivity} from "./garmin.js";
import {actualLoad} from "./adapt.js";

const nth = (items, n) => items.length >= n ? items[n - 1].date : null;

export function computeAwards({sessions, garmin = {activities: [], daily: []}, plans = [], today}) {
  const out = [], add = (id, group, title, desc, date) => { if (date) out.push({id, group, title, desc, date}); };
  const done = doneOf(sessions);
  [[1, "Erste Einheit", "Die erste Einheit abgeschlossen."], [10, "10 Einheiten", "10 Einheiten abgeschlossen."], [25, "25 Einheiten", "25 Einheiten abgeschlossen."], [50, "50 Einheiten", "50 Einheiten abgeschlossen."], [100, "100 Einheiten", "100 Einheiten abgeschlossen."]]
    .forEach(([n, t, d]) => add("count" + n, "Einheiten", t, d, nth(done, n)));
  // Trainingszeit
  let acc = 0; const reached = {}; done.forEach(s => { acc += minutesOf(s); [[600, "10"], [3000, "50"], [6000, "100"]].forEach(([m, h]) => { if (acc >= m && !reached[h]) reached[h] = s.date; }); });
  Object.entries(reached).forEach(([h, date]) => add("time" + h, "Zeit", `${h} Stunden Training`, `Insgesamt ${h} Stunden trainiert.`, date));
  // Serien (aufeinanderfolgende Tage / Wochen)
  const days = [...new Set(done.map(s => s.date))].sort(); let run = 0, prev = null; const dayHit = {};
  days.forEach(d => { run = prev && addDays(prev, 1) === d ? run + 1 : 1; prev = d; [[3, "3 Tage in Folge"], [7, "7 Tage in Folge"], [14, "14 Tage in Folge"]].forEach(([n, t]) => { if (run >= n && !dayHit[n]) dayHit[n] = [t, d]; }); });
  Object.entries(dayHit).forEach(([n, [t, d]]) => add("streak" + n, "Serien", t, `${n} Tage hintereinander aktiv.`, d));
  const weeks = [...new Set(done.map(s => weekStart(s.date)))].sort(); let wr = 0, wprev = null; const wkHit = {};
  weeks.forEach(w => { wr = wprev && addDays(wprev, 7) === w ? wr + 1 : 1; wprev = w; [[4, "4 Wochen am Stück"], [8, "8 Wochen am Stück"], [12, "12 Wochen am Stück"]].forEach(([n, t]) => { if (wr >= n && !wkHit[n]) wkHit[n] = [t, addDays(w, 6)]; }); });
  Object.entries(wkHit).forEach(([n, [t, d]]) => add("wstreak" + n, "Serien", t, `${n} Wochen hintereinander mindestens eine Einheit.`, d));
  // Distanzen in einer einzelnen Aktivität (Einheiten und Garmin)
  const dist = []; done.forEach(s => { if (s.log && s.log.distanceKm) dist.push({sport: s.sport, km: Number(s.log.distanceKm), date: s.date}); });
  (garmin.activities || []).forEach(a => { if (a.distanceKm) dist.push({sport: sportOfActivity(a.type), km: a.distanceKm, date: a.date}); });
  const best = (sport, km) => dist.filter(x => x.sport === sport && x.km >= km).sort((a, b) => a.date.localeCompare(b.date))[0];
  [["run", 5, "5 km Lauf"], ["run", 10, "10 km Lauf"], ["run", 21.1, "Halbmarathon-Distanz"], ["run", 42.2, "Marathon-Distanz"], ["bike", 50, "50 km Rad"], ["bike", 100, "100 km Rad"], ["swim", 1, "1 km Schwimmen"]]
    .forEach(([sp, km, t]) => { const b = best(sp, km); if (b) add(`dist_${sp}_${km}`, "Distanz", t, `${String(km).replace(".", ",")} km in einer Einheit.`, b.date); });
  // Vielfalt
  const seen = []; const sportDates = new Map(); done.forEach(s => { if (!sportDates.has(s.sport)) sportDates.set(s.sport, s.date); });
  const firstDates = [...sportDates.values()].sort(); add("variety3", "Vielfalt", "3 Sportarten", "Drei verschiedene Sportarten trainiert.", firstDates[2]); add("variety5", "Vielfalt", "5 Sportarten", "Fünf verschiedene Sportarten trainiert.", firstDates[4]);
  const yoga = done.filter(s => s.sport === "mobility"); add("yoga5", "Vielfalt", "5 Yoga-Einheiten", "Fünf Yoga- oder Mobility-Einheiten gemacht.", nth(yoga, 5));
  // Kraft: Steigerung und Volumen
  const topByEx = new Map(); let gainDate = null, vol = 0, volDate = null;
  done.forEach(s => (s.exercises || []).forEach((ex, i) => { const l = s.log && s.log.sets && s.log.sets[i]; if (!Array.isArray(l)) return; let top = null;
    l.forEach(x => { const w = parseFloat(String(x.weight ?? "").replace(",", ".")), r = parseFloat(x.reps); if (Number.isFinite(w) && Number.isFinite(r)) { top = Math.max(top ?? 0, w); vol += w * r; } });
    if (vol >= 10000 && !volDate) volDate = s.date;
    if (top != null) { const p = topByEx.get(ex.name); if (p != null && top > p && !gainDate) gainDate = s.date; topByEx.set(ex.name, Math.max(p ?? 0, top)); } }));
  add("stronger", "Kraft", "Stärker geworden", "Bei einer Übung mehr Gewicht als zuvor bewältigt.", gainDate); add("tons10", "Kraft", "10 Tonnen bewegt", "Insgesamt 10.000 kg Trainingsvolumen.", volDate);
  // Wochenziel erreicht (Plan)
  const target = {}; plans.forEach(p => Object.entries((p.meta && p.meta.weekTargets) || {}).forEach(([w, v]) => { if ((!p.startDate || w >= weekStart(p.startDate)) && (!p.endDate || w <= p.endDate)) target[w] = v; })); const byWeek = new Map(); done.forEach(s => byWeek.set(weekStart(s.date), (byWeek.get(weekStart(s.date)) || 0) + actualLoad(s)));
  const hit = [...byWeek.entries()].filter(([w, l]) => w < weekStart(today) && target[w] > 0 && l >= target[w] * 0.95).map(([w]) => addDays(w, 6)).sort();
  add("weekgoal1", "Plan", "Wochenziel erreicht", "Die geplante Wochenbelastung erreicht.", hit[0]); add("weekgoal4", "Plan", "4 Wochenziele erreicht", "Vier Wochen mit erreichtem Wochenziel.", hit[3]);
  // Garmin: Schritte, Schlaf, VO2max
  const daily = (garmin.daily || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  add("steps10k", "Alltag", "10.000 Schritte", "Einen Tag mit mindestens 10.000 Schritten.", (daily.find(d => d.steps >= 10000) || {}).date);
  add("steps20k", "Alltag", "20.000 Schritte", "Einen Tag mit mindestens 20.000 Schritten.", (daily.find(d => d.steps >= 20000) || {}).date);
  let sr = 0, sprev = null, sleepDate = null; daily.forEach(d => { if (d.sleepHours >= 7) { sr = sprev && addDays(sprev, 1) === d.date ? sr + 1 : 1; sprev = d.date; if (sr >= 7 && !sleepDate) sleepDate = d.date; } else { sr = 0; sprev = null; } });
  add("sleep7", "Erholung", "7 gute Nächte", "Sieben Nächte hintereinander mit mindestens 7 Stunden Schlaf.", sleepDate);
  let best2 = null, vo2Date = null, n2 = 0; daily.forEach(d => { if (d.vo2max != null) { n2++; if (best2 != null && d.vo2max > best2 && n2 >= 5) vo2Date = d.date; best2 = Math.max(best2 ?? 0, d.vo2max); } });
  add("vo2pb", "Fitness", "VO₂max-Bestwert", "Ein neuer persönlicher Bestwert bei der VO₂max.", vo2Date);
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}
