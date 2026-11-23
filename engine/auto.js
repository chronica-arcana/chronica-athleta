// Automatische Anpassungen auf Basis von Garmin-Daten: heutige Einheit nach Bereitschaft, Übernahme von Garmin-Aktivitäten.
import {swapSession, scaleSession, completeSession, addSession} from "./adapt.js";
import {kindInfo} from "./catalog.js";
import {sportOfActivity, importSuggestions} from "./garmin.js";

const merge = (state, res) => { const map = new Map(state.sessions.map(s => [s.id, s])); res.sessions.forEach(s => map.set(s.id, s)); res.removed.forEach(id => map.delete(id)); return {plan: res.plan, sessions: [...map.values()]}; };

// Heutige, nicht vom Nutzer festgelegte Einheit an die Trainingsbereitschaft anpassen (einmal pro Tag und Einheit).
export function applyReadiness(plan, sessions, today, rd) {
  const out = {plan, sessions: [], removed: [], notes: []};
  if (!rd || rd.level === "high") return out;
  const todays = sessions.filter(s => s.date === today && s.status === "planned" && !s.locked && s.kind !== "event" && !(s.auto && s.auto.date === today) && kindInfo(s.kind).group !== "recovery");
  let cur = {plan, sessions}; const touched = new Map();
  for (const s of todays) {
    const info = kindInfo(s.kind), hard = info.intensity !== "easy" || info.group === "strength" || info.key;
    const reason = `Erholung ${rd.level === "low" ? "niedrig" : "mäßig"} (Score ${rd.score}${rd.factors.length ? ": " + rd.factors.filter(f => f.delta < 0).map(f => f.text).slice(0, 3).join(", ") : ""})`;
    let res;
    if (rd.level === "low" && hard) {
      cur = {...cur, sessions: cur.sessions.map(x => x.id === s.id ? {...x, flowKey: "relax"} : x)};
      res = swapSession(cur.plan, cur.sessions, s.id, "mobility", 25, today);
      res.notes = [`${reason}: „${s.title}“ wurde durch Yoga/Mobility ersetzt.`];
    } else if (rd.level === "low") {
      res = scaleSession(cur.plan, cur.sessions, s.id, 0.7, today);
      res.notes = [`${reason}: „${s.title}“ um 30 % gekürzt.`];
    } else if (hard) {
      res = scaleSession(cur.plan, cur.sessions, s.id, 0.85, today);
      res.notes = [`${reason}: „${s.title}“ um 15 % gekürzt.`];
    } else continue;
    const mark = res.sessions.find(x => x.id === s.id); if (mark) mark.auto = {date: today, reason};
    cur = merge(cur, res); res.sessions.forEach(x => touched.set(x.id, x)); out.notes.push(...res.notes);
  }
  out.plan = cur.plan; out.sessions = [...touched.values()].map(x => cur.sessions.find(y => y.id === x.id) || x);
  return out;
}

// Garmin-Aktivitäten, die noch keiner Einheit zugeordnet sind, automatisch übernehmen:
// passt eine geplante Einheit (gleicher Tag und Sportart), wird sie erledigt; sonst wird eine zusätzliche Einheit angelegt.
export function importGarminActivities(plan, sessions, activities, today, sinceDate) {
  let cur = {plan, sessions}; const touched = new Map(), notes = []; let count = 0;
  for (const a of importSuggestions(activities, sessions, sinceDate).slice().reverse()) {
    const sport = sportOfActivity(a.type), log = {durationMin: Math.round(a.durationMin), avgHr: a.avgHr, distanceKm: a.distanceKm, garminActivityId: a.id, auto: true};
    const match = cur.sessions.find(s => s.status === "planned" && s.date === a.date && s.sport === sport && !(s.log && s.log.garminActivityId));
    const res = match ? completeSession(cur.plan, cur.sessions, match.id, log, today)
      : addSession(cur.plan, cur.sessions, {date: a.date, kind: DEFAULT_KIND[sport] || "cardio_easy", minutes: Math.round(a.durationMin), done: true, source: "garmin", log}, today);
    cur = merge(cur, res); res.sessions.forEach(x => touched.set(x.id, x)); count++;
    notes.push(match ? `Garmin: „${match.title}“ am ${a.date.slice(8)}.${a.date.slice(5, 7)}. als erledigt übernommen.` : `Garmin: ${a.name || a.type} (${Math.round(a.durationMin)} Min) am ${a.date.slice(8)}.${a.date.slice(5, 7)}. übernommen, die Woche passt sich an.`);
  }
  return {plan: cur.plan, sessions: [...touched.values()].map(x => cur.sessions.find(y => y.id === x.id) || x), removed: [], notes, count};
}
export const DEFAULT_KIND = {run: "run_easy", bike: "bike_easy", swim: "swim_endurance", strength: "strength_full", football: "football_skills", cardio: "cardio_easy", mobility: "mobility", walk: "walk"};
