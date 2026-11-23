import {LocalAdapter, SupabaseAdapter} from "./adapters.js";
import {ai, bindAdapter, aiAvailable, garmin as garminApi} from "./api.js";
import {generatePlan, normalizeGoal, defaultTitle, EVENT_PRESETS} from "../engine/planner.js";
import * as A from "../engine/adapt.js";
import {recoveryFlags, activityFlags, matchActivities, importSuggestions, normalizeExport} from "../engine/garmin.js";
import {readiness} from "../engine/readiness.js";
import {computeStats} from "../engine/stats.js";
import {sanitizeChat, buildChatContext} from "../engine/chat.js";
import {applyReadiness, importGarminActivities} from "../engine/auto.js";
import {kindInfo, SPORTS, PICKABLE_SPORTS} from "../engine/catalog.js";
import {todayISO, uuid, addDays, weekStart} from "../engine/dates.js";

export const state = {phase: "loading", adapter: null, user: null, plans: [], sessions: [], garmin: {activities: [], daily: []}, link: null,
  settings: {autoApply: true}, toasts: [], busy: false, error: "", recovering: false, syncing: false, syncError: ""};
const subs = new Set();
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
export const emit = () => subs.forEach(fn => fn());
export const activePlan = () => state.plans.find(p => p.status === "active") || null;
export const planSessions = () => { const p = activePlan(); return p ? state.sessions.filter(s => s.planId === p.id) : []; };
export const today = () => todayISO();

let toastId = 1;
export function toast(text, kind = "info", ms = 4500) {
  const t = {id: toastId++, text, kind}; state.toasts = [...state.toasts, t].slice(-2); emit(); // max. 2 gleichzeitig
  setTimeout(() => dismissToast(t.id), Math.min(ms, 5000));
}
export function dismissToast(id) { state.toasts = state.toasts.filter(x => x.id !== id); emit(); }
const errText = e => (e && e.message) || String(e);

export async function boot() {
  const cfg = window.TT_CONFIG || {};
  try {
    state.adapter = cfg.supabaseUrl && cfg.supabaseAnonKey ? new SupabaseAdapter(cfg.supabaseUrl, cfg.supabaseAnonKey) : new LocalAdapter();
  } catch (e) { state.adapter = new LocalAdapter(); }
  bindAdapter(state.adapter);
  state.adapter.onAuth(async (event, user) => {
    if (event === "PASSWORD_RECOVERY") { state.recovering = true; }
    if (event === "SIGNED_IN" && user && (!state.user || state.user.id !== user.id)) { state.user = user; await loadData(); }
    if (event === "SIGNED_OUT") { state.user = null; state.plans = []; state.sessions = []; state.phase = "auth"; emit(); }
    emit();
  });
  try {
    state.user = await state.adapter.init();
    if (state.user) await loadData(); else { state.phase = "auth"; emit(); }
  } catch (e) { state.error = errText(e); state.phase = "error"; emit(); }
}

export async function loadData() {
  state.phase = "loading"; emit();
  try {
    const d = await state.adapter.loadAll();
    state.plans = d.plans; state.sessions = d.sessions; state.garmin = d.garmin; state.link = d.link; state.settings = {autoApply: true, ...d.settings};
    await housekeeping();
    state.phase = "app";
  } catch (e) { state.error = errText(e); state.phase = "error"; }
  emit();
  if (state.phase === "app") { await afterGarminData(); autoSync(); }
}

/* ---------- Anwenden eines Engine-Ergebnisses ---------- */
export async function commit(res, {silent = false} = {}) {
  const map = new Map(state.sessions.map(s => [s.id, s]));
  res.sessions.forEach(s => map.set(s.id, s)); res.removed.forEach(id => map.delete(id));
  const prevPlan = state.plans.find(p => p.id === res.plan.id);
  state.sessions = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (prevPlan) state.plans = state.plans.map(p => p.id === res.plan.id ? res.plan : p);
  emit();
  try {
    await Promise.all([res.sessions.length ? state.adapter.saveSessions(res.sessions) : null, res.removed.length ? state.adapter.deleteSessions(res.removed) : null,
      JSON.stringify(prevPlan) !== JSON.stringify(res.plan) ? state.adapter.savePlan(res.plan) : null]);
  } catch (e) { toast("Speichern fehlgeschlagen: " + errText(e), "error", 7000); }
  if (!silent) res.notes.forEach(n => toast(n, "adapt", 6500));
}
async function housekeeping() {
  const p = activePlan(); if (!p) return;
  let sessions = state.sessions.filter(s => s.planId === p.id);
  const skipped = A.autoSkipMissed(p, sessions, today());
  if (skipped.sessions.length) { await commit(skipped, {silent: true}); sessions = state.sessions.filter(s => s.planId === p.id); }
  const rb = A.rebalance(activePlan(), sessions, today());
  if (rb.sessions.length || JSON.stringify(rb.plan) !== JSON.stringify(activePlan())) await commit(rb, {silent: true});
  if (skipped.sessions.length) toast(`${skipped.sessions.length} verpasste Einheit(en) wurden als ausgelassen markiert – der Plan hat sich angepasst.`, "adapt", 7000);
}
const run = async fn => { const p = activePlan(); if (!p) return null; const res = fn(p, state.sessions.filter(s => s.planId === p.id)); await commit(res); return res; };

export const swap = (id, kind, minutes) => run((p, s) => A.swapSession(p, s, id, kind, minutes, today()));
export const skip = id => run((p, s) => A.skipSession(p, s, id, today()));
export const restore = id => run((p, s) => A.restoreSession(p, s, id, today()));
export const move = (id, date) => run((p, s) => A.moveSession(p, s, id, date, today()));
export const scale = (id, f) => run((p, s) => A.scaleSession(p, s, id, f, today()));
export const remove = id => run((p, s) => A.deleteSession(p, s, id, today()));
export const addSession = o => run((p, s) => A.addSession(p, s, o, today()));
export const availability = (ws, dows) => run((p, s) => A.setAvailability(p, s, ws, dows, today()));

/* ---------- Training abschließen, auswerten (Regeln + optional KI) ---------- */
export function garminContext(date, sport) {
  const rec = recoveryFlags(state.garmin.daily, date), acts = matchActivities(state.garmin.activities, date, sport);
  return {recovery: rec, activities: acts, flags: rec.flags.concat(activityFlags(acts, state.garmin.activities))};
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

// KI-Vorschläge dürfen nur innerhalb der Sicherheitsgrenzen der Regeln wirken.
export function mergeAI(aiOut, rule) {
  const out = structuredClone(rule); out.source = "ki"; out.limited = false;
  const str = (v, n) => String(v ?? "").slice(0, n);
  if (aiOut.summary) out.summary = str(aiOut.summary, 500);
  (rule.exercises || []).forEach((ex, i) => {
    const a = (Array.isArray(aiOut.exercises) ? aiOut.exercises : []).find(x => x && x.name === ex.name); if (!a) return;
    const o = out.exercises[i];
    if (a.reason) o.reason = str(a.reason, 280);
    if (ex.type === "time") {
      const s = num(a.next_seconds); if (s != null && ex.lastSeconds != null) { const hi = rule.hold ? ex.lastSeconds : Math.min(ex.lastSeconds + 10, 90); const v = clamp(Math.round(s), 10, hi); if (v !== Math.round(s)) out.limited = true; o.nextSeconds = v; }
      o.action = o.nextSeconds > ex.lastSeconds ? "increase_reps" : o.nextSeconds < ex.lastSeconds ? "reduce" : "hold";
    } else {
      const w = num(a.next_weight_kg), r = num(a.next_reps);
      if (w != null && ex.lastWeight != null) { const hi = rule.hold || !rule.painKnown ? ex.lastWeight : ex.lastWeight * 1.1; const v = Math.round(clamp(w, ex.lastWeight * 0.8, hi) / 1.25) * 1.25; if (Math.abs(v - w) > 0.01) out.limited = true; o.nextWeight = v; }
      if (r != null) { const cap = Math.max(o.nextReps || 0, ex.lastReps != null ? ex.lastReps + 5 : 20); const v = clamp(Math.round(r), 1, cap); if (v !== Math.round(r)) out.limited = true; o.nextReps = v; }
      if (ex.lastWeight != null && o.nextWeight != null && o.nextWeight > ex.lastWeight + 0.01) o.action = "increase_weight";
      else if (ex.lastWeight != null && o.nextWeight != null && o.nextWeight < ex.lastWeight - 0.01) o.action = "reduce";
      else if (o.nextReps != null && ex.lastReps != null && o.nextReps > ex.lastReps) o.action = "increase_reps";
      else o.action = "hold";
    }
  });
  if (aiOut.advice) out.advice = rule.hold ? `${rule.advice} ${str(aiOut.advice, 240)}` : str(aiOut.advice, 300);
  const f = num(aiOut.next_factor);
  if (f != null) { const hi = rule.hold ? 1 : 1.1, v = clamp(f, rule.reduce ? 0.7 : 0.85, hi); if (Math.abs(v - f) > 0.001) out.limited = true; out.nextFactor = Math.round(v * 100) / 100; }
  if (Array.isArray(aiOut.tips)) out.tips = (out.tips || []).concat(aiOut.tips.slice(0, 4).map(t => str(t, 200)));
  return out;
}

export async function finishSession(id, log) {
  const p = activePlan(); if (!p) return null;
  const sessions = state.sessions.filter(s => s.planId === p.id);
  let res = A.completeSession(p, sessions, id, log, today());
  await commit(res, {silent: true});
  const s = state.sessions.find(x => x.id === id);
  const g = garminContext(s.date, s.sport);
  const rule = A.analyzeSession(activePlan(), s, g.flags);
  let analysis = rule, aiError = "";
  if (aiAvailable()) {
    try {
      const out = await ai("session_feedback", {session: {kind: s.kind, title: s.title, intensity: s.intensity, plannedMin: s.durationMin, phase: s.ctx && s.ctx.phaseName, log: {...s.log, sets: undefined},
        exercises: (s.exercises || []).map((e, i) => ({name: e.name, type: e.type, sets: e.sets, repMin: e.repMin, repMax: e.repMax, done: (s.log.sets && s.log.sets[i]) || []}))},
        goal: {mode: p.goal.mode, level: p.goal.level, sports: p.goal.sports, injury: !!p.goal.injury, event: p.goal.event && p.goal.event.preset},
        garmin: {flags: g.flags, activities: g.activities.slice(0, 3)}, rule: {zone: rule.zone, hold: rule.hold, reduce: rule.reduce, exercises: rule.exercises}});
      analysis = mergeAI(out, rule);
    } catch (e) { aiError = errText(e); }
  }
  analysis = {...analysis, at: new Date().toISOString(), aiError, applied: false};
  s.analysis = analysis;
  await commit({plan: activePlan(), sessions: [s], removed: [], notes: []}, {silent: true});
  if (state.settings.autoApply !== false) await applyAnalysis(id);
  return analysis;
}
export async function applyAnalysis(id) {
  const p = activePlan(), s = state.sessions.find(x => x.id === id); if (!p || !s || !s.analysis || s.analysis.applied) return;
  const res = A.applyAnalysis(p, state.sessions.filter(x => x.planId === p.id), id, s.analysis, today());
  const upd = res.sessions.find(x => x.id === id) || structuredClone(s);
  upd.analysis = {...s.analysis, applied: true};
  if (!res.sessions.some(x => x.id === id)) res.sessions.push(upd); else res.sessions = res.sessions.map(x => x.id === id ? upd : x);
  await commit(res);
}

/* ---------- Pläne ---------- */
export async function createPlan(goal, extras = {}) {
  const g = normalizeGoal(goal);
  const {plan, sessions} = generatePlan(g, {today: today()});
  if (extras.title) plan.title = extras.title;
  if (extras.summary) plan.meta.coachSummary = extras.summary;
  if (extras.tips) plan.meta.coachTips = extras.tips;
  plan.meta.source = extras.ai ? "ki" : "engine";
  for (const old of state.plans.filter(p => p.status === "active")) { const o = {...old, status: "archived"}; state.plans = state.plans.map(p => p.id === o.id ? o : p); await state.adapter.savePlan(o); }
  state.plans = [...state.plans, plan]; state.sessions = [...state.sessions, ...sessions]; emit();
  await state.adapter.savePlan(plan); await state.adapter.saveSessions(sessions);
  await housekeeping(); emit();
  return plan;
}
export async function deletePlan(id) { await state.adapter.deletePlan(id); state.plans = state.plans.filter(p => p.id !== id); state.sessions = state.sessions.filter(s => s.planId !== id); emit(); }
export async function setSettings(patch) { state.settings = {...state.settings, ...patch}; emit(); try { await state.adapter.saveSettings(state.settings); } catch (e) { toast(errText(e), "error"); } }

/* ---------- Konto ---------- */
export const auth = {
  signIn: async (e, p) => { await state.adapter.signIn(e, p); },
  signUp: (e, p) => state.adapter.signUp(e, p),
  signOut: async () => { await state.adapter.signOut(); if (state.adapter.mode === "demo") { emit(); } },
  reset: e => state.adapter.resetPassword(e),
  updatePassword: async p => { await state.adapter.updatePassword(p); state.recovering = false; emit(); }
};
export async function deleteAccount() { await state.adapter.deleteAccount(); state.plans = []; state.sessions = []; state.user = null; state.phase = "auth"; emit(); }
export async function resetData() { await state.adapter.deleteAllData(); state.plans = []; state.sessions = []; emit(); }

/* ---------- Garmin: Auto-Sync, Übernahme der Aktivitäten, Anpassung nach Erholung ---------- */
export const readinessFor = date => readiness(state.garmin.daily, date, {activities: state.garmin.activities, sessions: state.sessions});
export const getReadiness = () => readinessFor(today());
export function nextSession() {
  const t = today(), list = planSessions().filter(s => s.status === "planned" && s.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  return list[0] || null;
}
// Garmin-Aktivitäten als Einheiten übernehmen und die heutige Einheit an die Erholung anpassen (beides idempotent)
export async function afterGarminData() {
  const p = activePlan(); if (!p) return;
  const imp = importGarminActivities(p, state.sessions.filter(s => s.planId === p.id), state.garmin.activities, today(), addDays(today(), -10));
  if (imp.count) { await commit(imp, {silent: true}); toast(imp.count === 1 ? imp.notes[0] : `${imp.count} Garmin-Aktivitäten übernommen. Die Woche passt sich an.`, "adapt", 6000); }
  const rd = getReadiness(); if (!rd) return;
  const p2 = activePlan(), res = applyReadiness(p2, state.sessions.filter(s => s.planId === p2.id), today(), rd);
  if (res.sessions.length) { await commit(res, {silent: true}); toast(res.notes[0], "adapt", 7000); }
}
let lastSyncTry = 0;
export async function autoSync({force = false} = {}) {
  const link = state.link;
  if (state.syncing || !state.adapter || state.adapter.mode !== "cloud" || !link || link.status !== "connected") return;
  const last = link.last_sync_at ? Date.parse(link.last_sync_at) : 0;
  if (!force && (Date.now() - last < 20 * 60000 || Date.now() - lastSyncTry < 5 * 60000)) return;
  lastSyncTry = Date.now(); state.syncing = true; state.syncError = ""; emit();
  try { await garminApi.sync(last ? 7 : 30); await reloadGarmin(); await afterGarminData(); }
  catch (e) { state.syncError = errText(e); }
  state.syncing = false; emit();
}

/* ---------- Coach-Chat ---------- */
export const chatContext = () => buildChatContext({plan: activePlan(), sessions: planSessions(), rd: getReadiness(), stats: computeStats({sessions: state.sessions, garmin: state.garmin, today: today()}), today: today()});
export async function askCoach(history, question) {
  const out = await ai("chat", {kontext: chatContext(), verlauf: history.slice(-8).map(m => ({rolle: m.role === "user" ? "Nutzer" : "Coach", text: String(m.text).slice(0, 600)})), frage: String(question).slice(0, 500)});
  return sanitizeChat(out);
}
// Vorgeschlagene Änderung der nächsten Einheit ausführen (erst nach Bestätigung durch den Nutzer)
export async function applyChatAction(a) {
  const next = nextSession(); if (!next) throw new Error("Es ist keine kommende Einheit geplant.");
  if (a.type === "swap") return swap(next.id, a.kind);
  if (a.type === "skip") return skip(next.id);
  if (a.type === "scale") return scale(next.id, a.factor);
  if (a.type === "move_today") return move(next.id, today());
}

/* ---------- Garmin ---------- */
export async function reloadGarmin() { const d = await state.adapter.loadAll(); state.garmin = d.garmin; state.link = d.link; emit(); } // still, ohne Ladebildschirm
export async function refreshLink() { try { state.link = await state.adapter.loadLink(); } catch { /* Status bleibt wie er war */ } emit(); }
export async function importGarminFile(text) {
  const g = normalizeExport(JSON.parse(text));
  await state.adapter.saveGarmin(g);
  const a = new Map(state.garmin.activities.map(x => [x.id, x])); g.activities.forEach(x => a.set(x.id, x));
  const d = new Map(state.garmin.daily.map(x => [x.date, x])); g.daily.forEach(x => d.set(x.date, x));
  state.garmin = {activities: [...a.values()].sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start)), daily: [...d.values()].sort((x, y) => x.date.localeCompare(y.date))};
  emit(); await afterGarminData(); return {activities: g.activities.length, daily: g.daily.length};
}
export const garminSuggestions = () => importSuggestions(state.garmin.activities, state.sessions, addDays(today(), -10));
export { garminApi, ai, aiAvailable, A, SPORTS, PICKABLE_SPORTS, kindInfo, EVENT_PRESETS, defaultTitle, normalizeGoal, todayISO, uuid, addDays, weekStart };
