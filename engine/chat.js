// Coach-Chat: Kontext für die KI (kompakt, ohne unnötige persönliche Daten) und Prüfung der KI-Antwort.
// Die KI darf Änderungen nur VORSCHLAGEN; ausgeführt wird nur, was hier als gültige Aktion durchkommt und der Nutzer bestätigt.
import {KINDS, PICKABLE_SPORTS} from "./catalog.js";
import {addDays} from "./dates.js";

export const CHAT_KINDS = Object.keys(KINDS).filter(k => !["event", "custom", "strength_snack", "run_walkrun"].includes(k));
export const CHAT_ACTIONS = ["swap", "skip", "scale", "move_today", "rule"];

export function sanitizeChat(data, today = new Date().toISOString().slice(0, 10)) {
  const reply = String((data && data.reply) ?? "").trim().slice(0, 1800);
  const actions = [];
  for (const a of Array.isArray(data && data.actions) ? data.actions : []) {
    if (!a || !CHAT_ACTIONS.includes(a.type) || actions.length >= 2) continue;
    const label = String(a.label || "").trim();
    if (a.type === "rule") { // dauerhafte Planregel: Arten/Sportarten müssen gültig sein, Datum nicht in der Vergangenheit und höchstens 2 Jahre voraus
      const kinds = (Array.isArray(a.kinds) ? a.kinds : []).filter(k => CHAT_KINDS.includes(k)).slice(0, 5), sports = (Array.isArray(a.sports) ? a.sports : []).filter(s => PICKABLE_SPORTS.includes(s)).slice(0, 2);
      if ((!kinds.length && !sports.length) || actions.some(x => x.type === "rule")) continue;
      let until = null, from = null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(a.from || "")) { if (a.from > addDays(today, 730)) continue; from = a.from > today ? a.from : null; }
      if (/^\d{4}-\d{2}-\d{2}$/.test(a.until || "")) { if (a.until < today || a.until > addDays(today, 730)) continue; until = a.until; }
      actions.push({type: "rule", label: label.slice(0, 70) || "Planregel anlegen", kinds, sports, from, until, replace: CHAT_KINDS.includes(a.replace) ? a.replace : "auto"});
      continue;
    }
    const out = {type: a.type, label: label.slice(0, 48)};
    if (a.type === "swap") { if (!CHAT_KINDS.includes(a.kind)) continue; out.kind = a.kind; }
    if (a.type === "scale") { const f = Number(a.factor); if (!Number.isFinite(f)) continue; out.factor = Math.min(1.25, Math.max(0.6, Math.round(f * 100) / 100)); }
    if (!out.label) out.label = {swap: "Einheit tauschen", skip: "Einheit auslassen", scale: "Dauer anpassen", move_today: "Heute machen"}[a.type];
    actions.push(out);
  }
  return {reply, actions};
}

export function buildChatContext({plan, sessions, rd, stats, today}) {
  const planned = sessions.filter(s => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4)
    .map(s => ({datum: s.date, titel: s.title, art: s.kind, minuten: s.durationMin, intensitaet: s.intensity, angepasst: s.auto ? s.auto.reason : undefined}));
  const done = sessions.filter(s => s.status === "done").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
    .map(s => ({datum: s.date, titel: s.title, minuten: Number(s.log && s.log.durationMin) || s.durationMin, rpe: s.log && s.log.rpe != null ? s.log.rpe : null, schmerz: s.log && s.log.pain != null ? s.log.pain : null, quelle: s.source === "garmin" ? "Garmin" : "manuell"}));
  const g = plan && plan.goal || {};
  return {heute: today,
    plan: plan ? {titel: plan.title, modus: g.mode, niveau: g.level, sportarten: g.sports, event: g.event && g.event.preset, eventdatum: g.event && g.event.date, tageProWoche: g.daysPerWeek, beschwerden: !!g.injury, phasen: (plan.meta.phases || []).map(p => p.name)} : null,
    naechsteEinheiten: planned, letzteEinheiten: done,
    erholung: rd ? {score: rd.score, stufe: rd.level, hinweise: rd.factors.map(f => f.text), schritte: rd.steps, stressGestern: rd.stress, vo2max: rd.vo2max} : null,
    belastung: stats && stats.workload && stats.workload.ratio != null ? {verhaeltnis7zu28: stats.workload.ratio, stufe: stats.workload.level} : null,
    artenImPlan: (() => { const m = new Map(); sessions.filter(x => x.status === "planned" && x.date >= today).forEach(x => { const e = m.get(x.kind) || {art: x.kind, bezeichnung: (KINDS[x.kind] || {}).label || x.kind, anzahl: 0, bis: x.date}; e.anzahl++; e.bis = x.date; m.set(x.kind, e); }); return [...m.values()].slice(0, 10); })(),
    regeln: plan ? (plan.meta.rules || []).map(r => ({arten: r.kinds, sportarten: r.sports, bis: r.until, ersatz: r.replaceWith})) : [],
    kraftziele: plan ? Object.entries(plan.meta.targets || {}).slice(0, 6).map(([n, t]) => ({uebung: n, gewichtKg: t.weight, wiederholungen: t.reps, sekunden: t.seconds})) : []};
}
