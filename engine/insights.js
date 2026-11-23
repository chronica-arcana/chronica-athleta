// Gezielte Verbesserungsempfehlungen auf Basis der bisherigen Einheiten und Garmin-Daten (ab 5 erledigten Einheiten).
// Regelbasiert und nachvollziehbar: jede Empfehlung nennt die Zahlen, auf denen sie beruht.
import {computeStats, doneOf, minutesOf} from "./stats.js";
import {hasPainWords} from "./adapt.js";
import {kindInfo} from "./catalog.js";
import {addDays, weekStart} from "./dates.js";

export const MIN_SESSIONS = 5;
const EXPECTED_RPE = {easy: 4, moderate: 6, hard: 8};
const pct = x => Math.round(x * 100);
const f1 = n => String(Math.round(n * 10) / 10).replace(".", ",");
const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

export const roundsDue = (doneCount, seenRound = 0) => { const r = Math.floor(doneCount / 5); return doneCount >= MIN_SESSIONS && r > (seenRound || 0) ? r : 0; };

export function computeInsights({sessions, garmin = {activities: [], daily: []}, plan = null, today}) {
  const done = doneOf(sessions); if (done.length < MIN_SESSIONS) return [];
  const st = computeStats({sessions, garmin, today}), out = [], add = (id, area, tone, priority, title, text) => out.push({id, area, tone, priority, title, text});
  const goal = (plan && plan.goal) || {}, recent = done.filter(s => s.date >= addDays(today, -28)), base = recent.length >= 3 ? recent : done;

  // Intensitätsverteilung
  const mins = {easy: 0, moderate: 0, hard: 0}; base.forEach(s => { if (mins[s.intensity] != null) mins[s.intensity] += minutesOf(s); });
  const tot = mins.easy + mins.moderate + mins.hard;
  if (tot >= 120) {
    const high = (mins.moderate + mins.hard) / tot;
    if (high > 0.4) add("intensity_high", "Intensität", "warn", 3, "Zu viel Tempo", `${pct(high)} % deiner Trainingszeit war moderat oder intensiv. Etwa 80 % locker bringt meist mehr Fortschritt bei weniger Ermüdung. Gehe die lockeren Einheiten bewusst langsamer an (Gespräch muss möglich sein).`);
    else if (mins.hard / tot < 0.05 && done.length >= 8 && goal.mode === "performance" && goal.level !== "beginner") add("intensity_low", "Intensität", "tip", 2, "Kaum intensive Reize", `Nur ${pct(mins.hard / tot)} % deiner Zeit war intensiv. Für mehr Leistung lohnt sich pro Woche eine gezielte Tempo- oder Intervalleinheit.`);
  }
  // Regelmäßigkeit (geplante Einheiten bis gestern)
  const due = (sessions || []).filter(s => (!plan || s.planId === plan.id) && s.date < today && (s.status === "done" || s.status === "skipped")), dn = due.filter(s => s.status === "done").length;
  if (due.length >= 5) {
    const r = dn / due.length;
    if (r < 0.6) add("consistency_low", "Regelmäßigkeit", "warn", 3, "Viele Einheiten ausgelassen", `Du hast ${dn} von ${due.length} Einheiten gemacht (${pct(r)} %). Plane lieber weniger Tage pro Woche, aber verlässlich: ein kleinerer Plan, den du einhältst, bringt mehr als ein voller, der oft ausfällt.`);
    else if (r >= 0.9) add("consistency_high", "Regelmäßigkeit", "good", 1, "Sehr zuverlässig", `${dn} von ${due.length} Einheiten umgesetzt (${pct(r)} %). Das ist die wichtigste Grundlage für Fortschritt.`);
  }
  // Anstrengung gegenüber Erwartung
  const rated = done.filter(s => num(s.log && s.log.rpe) != null && EXPECTED_RPE[s.intensity] != null).slice(-6);
  if (rated.length >= 4) {
    const d = rated.reduce((a, s) => a + (num(s.log.rpe) - EXPECTED_RPE[s.intensity]), 0) / rated.length;
    if (d >= 1.5) add("rpe_high", "Belastung", "warn", 3, "Einheiten fühlen sich härter an als geplant", `Deine Anstrengung (RPE) liegt im Schnitt ${f1(d)} Punkte über dem Erwartbaren. Prüfe Schlaf und Alltagsstress, mach eine Entlastungswoche oder nimm 10 % Umfang heraus, bevor du steigerst.`);
    else if (d <= -1.5) add("rpe_low", "Belastung", "tip", 2, "Du hast Luft nach oben", `Deine Anstrengung liegt im Schnitt ${f1(-d)} Punkte unter dem Erwartbaren. Du kannst lockere Einheiten etwas verlängern oder eine zusätzliche Tempo-Einheit einbauen, jeweils nur eine Variable auf einmal.`);
  }
  // Beschwerden
  const last6 = done.slice(-6), hurt = last6.filter(s => (num(s.log && s.log.pain) ?? 0) >= 3 || hasPainWords(s.log && s.log.notes));
  if (hurt.length) add("pain", "Beschwerden", "warn", 3, `Beschwerden bei ${hurt.length} von ${last6.length} Einheiten`, "Steigere in solchen Phasen nichts. Wenn Schmerzen anhalten oder zunehmen, lass sie von Arzt oder Sportphysio abklären. Der Coach hält Belastungen zurück, solange Schmerz dokumentiert ist.");
  // Kraft: Stillstand und Häufigkeit
  const byEx = new Map(); done.forEach(s => (s.exercises || []).forEach((ex, i) => { const l = s.log && s.log.sets && s.log.sets[i]; if (!Array.isArray(l)) return; const top = Math.max(0, ...l.map(x => num(x.weight) ?? 0)); if (top > 0) { if (!byEx.has(ex.name)) byEx.set(ex.name, []); byEx.get(ex.name).push(top); } }));
  const stuck = [...byEx.entries()].filter(([, l]) => l.length >= 3 && Math.max(...l.slice(-3)) <= l[l.length - 3]).map(([n]) => n);
  if (stuck.length) add("strength_plateau", "Kraft", "tip", 2, `Stillstand: ${stuck.slice(0, 2).join(", ")}${stuck.length > 2 ? " u. a." : ""}`, "Seit drei Einheiten gleiches Gewicht. Probiere gezielt 1–2 Wiederholungen mehr, langsames Absenken (3 Sekunden) oder eine Entlastungswoche. Auch Schlaf und Eiweißzufuhr bremsen oft den Kraftzuwachs.");
  const sportsPlan = goal.sports || [], strength4w = recent.filter(s => s.sport === "strength").length;
  if (sportsPlan.includes("strength") && recent.length >= 4 && strength4w < 4 && goal.mode !== "return") add("strength_rare", "Kraft", "tip", 2, "Kraft kommt zu kurz", `In den letzten 4 Wochen nur ${strength4w} Krafteinheit${strength4w === 1 ? "" : "en"}. Zwei pro Woche sind ein guter Richtwert für Stabilität und Verletzungsvorbeugung.`);
  // Umfang: Sprung zur Vorwoche
  const w = st.weekly, prevWeek = w[w.length - 2] && w[w.length - 2].minutes, baseWeeks = w.slice(-5, -2).map(x => x.minutes).filter(x => x > 0);
  if (prevWeek && baseWeeks.length >= 2) { const b = baseWeeks.reduce((a, x) => a + x, 0) / baseWeeks.length; if (prevWeek > b * 1.3 && prevWeek - b >= 45) add("volume_jump", "Umfang", "warn", 2, "Umfang schnell gestiegen", `Letzte Woche ${Math.round(prevWeek)} Min gegenüber Ø ${Math.round(b)} Min in den Wochen davor (+${pct(prevWeek / b - 1)} %). Mehr als etwa 10–15 % Steigerung pro Woche erhöht das Verletzungsrisiko; plane die nächste Woche etwas ruhiger.`); }
  // Garmin: Schlaf, Ruhepuls, Alltag, VO2max
  const g = st.garmin;
  if (g.sleep7 != null && g.sleep7 < 7) add("sleep", "Erholung", g.sleep7 < 6 ? "warn" : "tip", g.sleep7 < 6 ? 3 : 2, `Schlaf: Ø ${f1(g.sleep7)} h`, "Schlaf ist der größte Hebel für Erholung und Leistung. Peile 7–9 Stunden an, feste Zeiten und kein intensives Training spät abends helfen.");
  if (g.rhrDelta != null && g.rhrDelta >= 3) add("rhr_up", "Erholung", "warn", 2, "Ruhepuls steigt", `Dein Ruhepuls liegt ${f1(g.rhrDelta)} Schläge über der Vorwoche. Das deutet auf Ermüdung, Stress oder beginnende Infekte hin. Gönne dir ein bis zwei lockere Tage.`);
  if (g.steps7 != null && g.steps7 < 6000) add("steps_low", "Alltag", "tip", 1, `Alltagsbewegung niedrig (Ø ${g.steps7.toLocaleString("de-DE")} Schritte)`, "Zusätzliche Spaziergänge an Ruhetagen fördern die Erholung und die Grundlagenausdauer, ohne zu belasten.");
  if (g.vo2 && g.vo2.series.length >= 3) { if (g.vo2.delta > 0) add("vo2_up", "Fitness", "good", 1, `VO₂max +${f1(g.vo2.delta)}`, `Deine VO₂max stieg von ${f1(g.vo2.first)} auf ${f1(g.vo2.latest)}. Dein Training wirkt.`); else if (g.vo2.delta < 0) add("vo2_down", "Fitness", "tip", 2, `VO₂max ${f1(g.vo2.delta)}`, `Die VO₂max sank von ${f1(g.vo2.first)} auf ${f1(g.vo2.latest)}. Mehr lockere Grundlage plus eine Intervalleinheit pro Woche hilft, sie wieder zu steigern; auch Schlaf und Ruhepuls prüfen.`); }
  // Mobilität
  const heavy = recent.filter(s => kindInfo(s.kind).group === "strength" || kindInfo(s.kind).key).length, yoga = recent.filter(s => s.sport === "mobility").length;
  if (heavy >= 6 && yoga === 0) add("mobility", "Mobilität", "tip", 1, "Mobilität einplanen", "Bei viel Kraft und Schlüsseleinheiten ohne Yoga/Mobility: ein kurzer Flow (20–30 Min) nach der anstrengendsten Einheit unterstützt die Regeneration.");
  // Serie positiv
  if (st.total.streakWeeks >= 3) add("streak", "Regelmäßigkeit", "good", 1, `${st.total.streakWeeks} Wochen in Folge aktiv`, "Konstanz schlägt Intensität. Halte dieses Muster, auch wenn einzelne Wochen kleiner ausfallen.");

  if (!out.length) add("steady", "Gesamt", "tip", 1, "Gute Basis: jetzt gezielt steigern", "Es gibt keine Auffälligkeiten. Steigere pro Woche nur eine Variable (Umfang, Intensität oder Gewicht) und halte Ruhetage ein.");
  const order = {warn: 0, tip: 1, good: 2};
  return out.sort((a, b) => b.priority - a.priority || order[a.tone] - order[b.tone]).slice(0, 6);
}
