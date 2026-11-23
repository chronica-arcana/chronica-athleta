// Coach-Chat: Kontext für die KI (kompakt, ohne unnötige persönliche Daten) und Prüfung der KI-Antwort.
// Die KI darf Änderungen nur VORSCHLAGEN; ausgeführt wird nur, was hier als gültige Aktion durchkommt und der Nutzer bestätigt.
import {KINDS} from "./catalog.js";

export const CHAT_KINDS = Object.keys(KINDS).filter(k => !["event", "custom", "strength_snack", "run_walkrun"].includes(k));
export const CHAT_ACTIONS = ["swap", "skip", "scale", "move_today"];

export function sanitizeChat(data) {
  const reply = String((data && data.reply) ?? "").trim().slice(0, 1800);
  const actions = [];
  for (const a of Array.isArray(data && data.actions) ? data.actions : []) {
    if (!a || !CHAT_ACTIONS.includes(a.type) || actions.length >= 2) continue;
    const out = {type: a.type, label: String(a.label || "").trim().slice(0, 48)};
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
    erholung: rd ? {score: rd.score, stufe: rd.level, hinweise: rd.factors.map(f => f.text), schritte: rd.steps, vo2max: rd.vo2max} : null,
    belastung: stats && stats.workload && stats.workload.ratio != null ? {verhaeltnis7zu28: stats.workload.ratio, stufe: stats.workload.level} : null,
    kraftziele: plan ? Object.entries(plan.meta.targets || {}).slice(0, 6).map(([n, t]) => ({uebung: n, gewichtKg: t.weight, wiederholungen: t.reps, sekunden: t.seconds})) : []};
}
