// Flexible Plananpassung. Alle Funktionen sind rein: sie bekommen (plan, sessions, …) und liefern
//   { plan, sessions: [geänderte/neue Einheiten], removed: [ids], notes: [Texte für den Nutzer] }
// Der Aufrufer speichert das Ergebnis. Kernidee: Der Plan ist kein starres Gerüst, sondern ein Wochenlast-Ziel,
// auf das sich die restlichen Einheiten der Woche nach jeder Änderung (tauschen, verschieben, auslassen,
// zusätzlich trainieren, nicht verfügbar) automatisch neu einstellen.
import {kindInfo, DOWNGRADE, KINDS, SPORTS} from "./catalog.js";
import {buildSession, round5} from "./content.js";
import {assignDays, trimToFit} from "./planner.js";
import {addDays, weekStart, diffDays, uuid, dow} from "./dates.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ADDON_LPM = 1.3;

export const baseLoad = s => Math.round(s.durationMin * kindInfo(s.kind).loadPerMin + (s.addon ? s.addon.minutes * ADDON_LPM : 0));
export function actualLoad(s) {
  const dur = (s.log && Number(s.log.durationMin)) || s.durationMin;
  return Math.round(dur * kindInfo(s.kind).loadPerMin + (s.addon && s.log && s.log.addonDone ? s.addon.minutes * ADDON_LPM : 0));
}
export const weekIndexOf = (plan, date) => Math.floor(diffDays(weekStart(date), weekStart(plan.startDate)) / 7);

function work(plan, sessions) {
  const w = {P: structuredClone(plan), S: new Map(sessions.map(s => [s.id, structuredClone(s)])), changed: new Set(), removed: new Set(), notes: []};
  w.touch = id => w.changed.add(id);
  w.list = () => [...w.S.values()];
  w.note = t => { if (!w.notes.includes(t)) w.notes.push(t); };
  return w;
}
const finish = w => ({plan: w.P, sessions: [...w.changed].map(id => w.S.get(id)).filter(Boolean), removed: [...w.removed], notes: w.notes});
const ctxFor = (w, s) => ({...s.ctx, tier: undefined, equipment: s.ctx && s.ctx.equipment, addon: s.addon});

function rebuild(w, s, minutes) {
  const info = kindInfo(s.kind);
  const built = buildSession(s.kind, minutes, {...s.ctx, addon: s.addon, flowKey: s.flowKey});
  s.durationMin = built.durationMin; s.blocks = built.blocks; s.flow = built.flow; s.flowKey = built.flowKey;
  if (s.kind === "mobility") s.title = built.title;
  const targets = w.P.meta.targets || {};
  s.exercises = built.exercises.map(e => ({...e, target: targets[e.name] || undefined}));
  if (s.addon) s.addon.exercises = buildSession("strength_snack", s.addon.minutes, s.ctx).exercises;
  s.sport = info.sport; s.intensity = info.intensity;
  s.load = baseLoad(s);
  w.touch(s.id);
}
function ensureBase(s) { if (s.baseMinutes == null) s.baseMinutes = s.durationMin; }

/* ---------- Hilfsmaßnahmen ---------- */
export function autoSkipMissed(plan, sessions, today) {
  const w = work(plan, sessions);
  for (const s of w.list()) if (s.status === "planned" && s.date < today) {
    s.status = "skipped"; s.skipReason = "missed"; w.touch(s.id);
    if (kindInfo(s.kind).group === "strength" && !s.debtCounted) { s.debtCounted = true; w.P.meta.debt.strength = Math.min(1, (w.P.meta.debt.strength || 0) + 1); }
  }
  return finish(w);
}

function enforceSpacing(w, today) {
  const list = w.list().filter(s => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const doneYesterday = w.list().filter(s => s.status === "done");
  for (let i = 0; i < list.length; i++) {
    const cur = list[i], curInfo = kindInfo(cur.kind);
    if (curInfo.intensity !== "hard" || cur.kind === "event") continue;
    const prev = [...list.slice(0, i), ...doneYesterday].filter(p => diffDays(cur.date, p.date) === 1 && p.id !== cur.id && kindInfo(p.kind).intensity === "hard");
    if (!prev.length) continue;
    const down = DOWNGRADE[cur.kind];
    if (down && !cur.locked) { const was = cur.title; cur.kind = down; ensureBase(cur); cur.title = KINDS[down].label; rebuild(w, cur, cur.durationMin); w.note(`„${was}“ am ${cur.date.slice(8)}.${cur.date.slice(5, 7)}. wurde entschärft, weil am Tag davor schon eine harte Einheit liegt.`); }
    else w.note("Zwei harte Einheiten liegen direkt hintereinander – plane einen Ruhetag oder nimm eine davon lockerer.");
  }
}

function placeDebt(w, today) {
  const debt = w.P.meta.debt || (w.P.meta.debt = {strength: 0});
  if (debt.strength <= 0) return;
  debt.strength = Math.min(1, debt.strength);
  const list = w.list().filter(s => s.status === "planned" && s.date >= today && s.date <= addDays(today, 6) && !s.addon && kindInfo(s.kind).group === "cardio" && kindInfo(s.kind).intensity === "easy" && s.kind !== "event")
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextHard = date => w.list().some(x => x.status === "planned" && diffDays(x.date, date) === 1 && (kindInfo(x.kind).quality || kindInfo(x.kind).long));
  const pick = list.find(s => !nextHard(s.date)) || null;
  if (!pick) { debt.strength = 0; w.note("Die ausgelassene Krafteinheit wird nicht nachgeholt – diese Woche passt nichts sinnvoll dazu. Nächste Woche geht es normal weiter."); return; }
  pick.addon = {kind: "strength_snack", minutes: 20};
  ensureBase(pick);
  rebuild(w, pick, pick.durationMin);
  debt.strength = 0;
  w.note(`Kraft nachgeholt: am ${pick.date.slice(8)}.${pick.date.slice(5, 7)}. kommt ein 20-Minuten-Kraft-Snack nach „${pick.title}“.`);
}

function scaleWeek(w, ws, today) {
  const target = w.P.meta.weekTargets[ws];
  const all = w.list().filter(s => weekStart(s.date) === ws);
  const rem = all.filter(s => s.status === "planned" && s.date >= today);
  if (!rem.length) return;
  if (target == null) { w.P.meta.weekTargets[ws] = all.filter(s => s.status !== "skipped").reduce((a, s) => a + (s.status === "done" ? actualLoad(s) : baseLoad(s)), 0); return; }
  const done = all.filter(s => s.status === "done").reduce((a, s) => a + actualLoad(s), 0);
  const need = target - done;
  const fixed = rem.filter(s => s.locked || s.kind === "event"), adj = rem.filter(s => !fixed.includes(s));
  const fixedLoad = fixed.reduce((a, s) => a + baseLoad(s), 0);
  adj.forEach(ensureBase);
  const lb = s => Math.round(s.baseMinutes * kindInfo(s.kind).loadPerMin + (s.addon ? s.addon.minutes * ADDON_LPM : 0));
  const sumBase = adj.reduce((a, s) => a + lb(s), 0);
  const allowed = Math.max(0, need * 1.05 - fixedLoad);
  const factor = new Map(adj.map(s => [s.id, 1]));
  if (sumBase > allowed * 1.12 + 5 && sumBase > 0) {
    const nonKey = adj.filter(s => !kindInfo(s.kind).key), key = adj.filter(s => kindInfo(s.kind).key);
    const sNK = nonKey.reduce((a, s) => a + lb(s), 0), sK = key.reduce((a, s) => a + lb(s), 0);
    const fN = sNK ? clamp((allowed - sK) / sNK, 0.6, 1) : 1;
    const fK = sK ? clamp((allowed - sNK * fN) / sK, 0.75, 1) : 1;
    nonKey.forEach(s => factor.set(s.id, fN)); key.forEach(s => factor.set(s.id, fK));
    w.note(need <= 0 ? "Wochenziel bereits erreicht – restliche Einheiten dieser Woche werden kürzer/lockerer." : "Diese Woche hast du schon viel gemacht – restliche Einheiten wurden gekürzt.");
  } else if (sumBase < allowed * 0.85 && sumBase > 0) {
    const easy = adj.filter(s => kindInfo(s.kind).intensity === "easy" && !kindInfo(s.kind).key || kindInfo(s.kind).long);
    const sE = easy.reduce((a, s) => a + lb(s), 0), budget = (allowed - sumBase) * 0.5;
    if (sE > 0 && budget > 10) {
      const f = clamp(1 + budget / sE, 1, 1.25);
      easy.forEach(s => factor.set(s.id, f));
      if (f > 1.03) w.note("Verpasste Belastung wurde teilweise auf lockere Einheiten dieser Woche verteilt (max. +25 %) – kein Nachholen im Härtetempo.");
    }
  }
  for (const s of adj) {
    const f = factor.get(s.id), want = round5(clamp(s.baseMinutes * f, 15, 300));
    if (want !== s.durationMin) rebuild(w, s, want);
  }
}

/* ---------- Dauerhafte Regeln ("diese Art Einheit nicht, bis Datum X") ---------- */
const matchRule = (r, kind, date) => ((r.kinds || []).includes(kind) || (r.sports || []).includes(kindInfo(kind).sport)) && (!r.until || date <= r.until) && (!r.from || date >= r.from);
const AUTO_REPLACE = {climb: "climb_easy", run: "run_easy", bike: "bike_easy", swim: "swim_technique", cardio: "cardio_easy", walk: "walk", mobility: "mobility", strength: "strength_core"};
export function replacementFor(plan, r, s) {
  const excluded = new Set([...(r.sports || []), ...(r.kinds || []).map(k => kindInfo(k).sport)]), cand = [];
  if (r.replaceWith && r.replaceWith !== "auto") cand.push(r.replaceWith);
  ((plan.goal && plan.goal.sports) || []).filter(sp => !excluded.has(sp) && AUTO_REPLACE[sp]).forEach(sp => cand.push(AUTO_REPLACE[sp]));
  cand.push("cardio_easy", "mobility");
  return cand.find(k => KINDS[k] && !matchRule(r, k, s.date));
}
function enforceRules(w, today) {
  const rules = (w.P.meta.rules || []).filter(r => !r.until || r.until >= today);
  if (!rules.length) return;
  const counts = new Map();
  for (const s of w.list()) {
    if (s.status !== "planned" || s.date < today || s.source !== "plan" || s.kind === "event") continue; // vom Nutzer gewählte Einheiten bleiben unberührt
    const r = rules.find(x => matchRule(x, s.kind, s.date)); if (!r) continue;
    if (kindInfo(s.kind).sport === "mobility" && s.priority === "bonus") { // ausgeschlossene Zusatz-Einheiten (Yoga) entfallen, statt ersetzt zu werden
      s.status = "skipped"; s.ruleId = r.id; s.origKind = s.kind; w.touch(s.id); counts.set(r.id, (counts.get(r.id) || 0) + 1); continue;
    }
    const to = replacementFor(w.P, r, s); if (!to) continue;
    if (!s.origKind) s.origKind = s.kind;
    s.kind = to; s.ruleId = r.id; s.title = KINDS[to].label; s.locked = false; ensureBase(s);
    if (kindInfo(to).key) s.priority = "key"; else if (s.priority === "key") s.priority = "support";
    s.addon = undefined; rebuild(w, s, s.durationMin); counts.set(r.id, (counts.get(r.id) || 0) + 1);
  }
  for (const [id, n] of counts) { const r = rules.find(x => x.id === id); w.note(`${n} künftige Einheit${n === 1 ? "" : "en"} wegen der Regel „${r.label}“ ersetzt.`); }
}
export function addRule(plan, sessions, rule, today) {
  const w = work(plan, sessions), kinds = (rule.kinds || []).filter(k => KINDS[k]), sports = (rule.sports || []).filter(sp => SPORTS_OK.has(sp));
  if (!kinds.length && !sports.length) return finish(w);
  const until = /^\d{4}-\d{2}-\d{2}$/.test(rule.until || "") ? rule.until : null, from = /^\d{4}-\d{2}-\d{2}$/.test(rule.from || "") && (!until || rule.from <= until) ? rule.from : null;
  const fd = d => d.slice(8) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
  const names = kinds.length ? kinds.map(k => KINDS[k].label).join(", ") : sports.map(sp => SPORTS[sp] ? SPORTS[sp].label : sp).join(", ");
  const r = {id: uuid(), kinds, sports, from, until, replaceWith: rule.replaceWith && KINDS[rule.replaceWith] ? rule.replaceWith : "auto", label: (rule.label || `${names} ${from && until ? "vom " + fd(from) + " bis " + fd(until) : from ? "ab " + fd(from) : until ? "bis " + fd(until) : "dauerhaft nicht"}`).slice(0, 90), createdAt: new Date().toISOString()};
  w.P.meta.rules = [...(w.P.meta.rules || []), r];
  rebalance(null, null, today, {_w: w});
  if (!w.notes.some(n => /ersetzt/.test(n))) w.note("Regel gespeichert. Aktuell sind keine Einheiten betroffen; sie gilt auch für künftige Anpassungen.");
  return finish(w);
}
export function removeRule(plan, sessions, ruleId, today) {
  const w = work(plan, sessions); let n = 0;
  w.P.meta.rules = (w.P.meta.rules || []).filter(r => r.id !== ruleId);
  for (const s of w.list()) if (s.ruleId === ruleId) {
    if (s.status === "skipped" && s.origKind && KINDS[s.origKind]) { s.status = "planned"; n++; }
    else if (s.status === "planned" && s.origKind && KINDS[s.origKind]) { s.kind = s.origKind; s.title = KINDS[s.kind].label; ensureBase(s); rebuild(w, s, s.durationMin); n++; }
    s.ruleId = undefined; s.origKind = undefined; w.touch(s.id);
  }
  w.note(n ? `Regel entfernt, ${n} Einheit${n === 1 ? "" : "en"} wiederhergestellt.` : "Regel entfernt.");
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
const SPORTS_OK = new Set(["run", "bike", "swim", "strength", "football", "climb", "cardio", "mobility", "walk"]);

export function rebalance(plan, sessions, today, opts = {}) {
  const w = opts._w || work(plan, sessions);
  enforceRules(w, today);
  enforceSpacing(w, today);
  placeDebt(w, today);
  const weeks = [...new Set(w.list().filter(s => s.status === "planned" && s.date >= today).map(s => weekStart(s.date)))].sort();
  weeks.forEach(ws => scaleWeek(w, ws, today));
  enforceRules(w, today); // Entschärfung/Verschiebung darf keine ausgeschlossene Art wieder einsetzen
  return opts._w ? w : finish(w);
}

/* ---------- Aktionen ---------- */
export function swapSession(plan, sessions, id, newKind, minutes, today) {
  const w = work(plan, sessions), s = w.S.get(id); if (!s) return finish(w);
  const from = kindInfo(s.kind), to = kindInfo(newKind);
  if (!s.origKind) s.origKind = s.kind;
  if (from.group === "strength" && to.group !== "strength" && !s.debtCounted) { s.debtCounted = true; w.P.meta.debt.strength = Math.min(1, (w.P.meta.debt.strength || 0) + 1); }
  const eq = round5(clamp(s.load / to.loadPerMin, s.durationMin * 0.6, s.durationMin * 1.3));
  s.kind = newKind; s.title = to.label; s.sport = to.sport; s.locked = true; s.source = "swapped";
  if (from.key && !to.key) s.priority = "support";
  if (to.key && s.priority !== "key") s.priority = "support";
  s.addon = undefined;
  s.baseMinutes = round5(minutes || Math.max(20, eq));
  rebuild(w, s, s.baseMinutes);
  w.note(`Geändert: „${from.label}“ → „${to.label}“ (${s.durationMin} Min, ähnliche Belastung).`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
export function skipSession(plan, sessions, id, today, reason = "user") {
  const w = work(plan, sessions), s = w.S.get(id); if (!s) return finish(w);
  s.status = "skipped"; s.skipReason = reason; w.touch(id);
  if (kindInfo(s.kind).group === "strength" && !s.debtCounted) { s.debtCounted = true; w.P.meta.debt.strength = Math.min(1, (w.P.meta.debt.strength || 0) + 1); }
  w.note(`„${s.title}“ ausgelassen – der Rest der Woche passt sich an.`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
export function restoreSession(plan, sessions, id, today) {
  const w = work(plan, sessions), s = w.S.get(id); if (!s) return finish(w);
  s.status = "planned"; s.skipReason = undefined; w.touch(id);
  if (s.debtCounted) { s.debtCounted = false; w.P.meta.debt.strength = Math.max(0, (w.P.meta.debt.strength || 0) - 1); }
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
export function moveSession(plan, sessions, id, newDate, today) {
  const w = work(plan, sessions), s = w.S.get(id); if (!s) return finish(w);
  const old = s.date; s.date = newDate; s.week = weekIndexOf(w.P, newDate); w.touch(id);
  if (weekStart(old) !== weekStart(newDate)) { s.locked = true; ensureBase(s); }
  w.note(`„${s.title}“ verschoben auf ${newDate.slice(8)}.${newDate.slice(5, 7)}.`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
export function scaleSession(plan, sessions, id, factor, today) {
  const w = work(plan, sessions), s = w.S.get(id); if (!s) return finish(w);
  s.baseMinutes = round5(clamp(s.durationMin * factor, 15, 300)); s.locked = true;
  rebuild(w, s, s.baseMinutes);
  w.note(`„${s.title}“ jetzt ${s.durationMin} Min.`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
export function addSession(plan, sessions, {date, kind, minutes, done = false, log = null, source = "adhoc"}, today) {
  const w = work(plan, sessions), info = kindInfo(kind);
  const last = sessions.length ? sessions[sessions.length - 1] : null;
  const base = sessions.filter(s => weekStart(s.date) === weekStart(date))[0] || last;
  const ctx = base ? {...base.ctx} : {phaseKey: "build", weekIdx: 0, level: (plan.goal && plan.goal.level) || "intermediate", equipment: plan.goal && plan.goal.equipment, mode: plan.meta.mode};
  const m = round5(minutes || 40);
  const built = buildSession(kind, m, ctx);
  const s = {id: uuid(), planId: plan.id, date, week: weekIndexOf(plan, date), kind, sport: info.sport, title: built.title, durationMin: built.durationMin, intensity: info.intensity,
    load: Math.round(built.durationMin * info.loadPerMin), priority: "optional", status: done ? "done" : "planned", blocks: built.blocks,
    exercises: built.exercises.map(e => ({...e, target: (plan.meta.targets || {})[e.name]})), flow: built.flow, flowKey: built.flowKey, ctx, source, log: done ? (log || {durationMin: built.durationMin}) : null, locked: true, baseMinutes: built.durationMin};
  w.S.set(s.id, s); w.touch(s.id);
  const ws = weekStart(date);
  // Nur Wochen innerhalb des Plans bekommen ein Wochenziel (sonst erfüllt eine einzelne Aktivität ihr eigenes Ziel trivial)
  if (w.P.meta.weekTargets[ws] == null && ws >= weekStart(plan.startDate) && date <= plan.endDate) w.P.meta.weekTargets[ws] = s.load;
  w.note(done ? `„${s.title}“ als erledigt eingetragen.` : `„${s.title}“ hinzugefügt.`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
export function deleteSession(plan, sessions, id, today) {
  const w = work(plan, sessions); const s = w.S.get(id); if (!s) return finish(w);
  w.S.delete(id); w.changed.delete(id); w.removed.add(id);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}

// Woche mit eingeschränkter Verfügbarkeit neu verteilen: availableDows = Wochentage (0=Mo) an denen trainiert werden kann.
export function setAvailability(plan, sessions, ws, availableDows, today) {
  const w = work(plan, sessions);
  const dates = availableDows.map(d => addDays(ws, d)).filter(d => d >= today);
  const rem = w.list().filter(s => weekStart(s.date) === ws && s.status === "planned" && s.date >= today && s.kind !== "event");
  const event = w.list().find(s => weekStart(s.date) === ws && s.kind === "event");
  const usable = dates.filter(d => !event || d < event.date);
  const items = rem.map(s => ({kind: s.kind, priority: s.priority, s}));
  const {kept, dropped} = trimToFit(items, usable.length);
  const placed = assignDays(kept, usable);
  placed.forEach(({item, date}) => { if (item.s.date !== date) { item.s.date = date; item.s.week = weekIndexOf(w.P, date); w.touch(item.s.id); } });
  dropped.forEach(it => {
    it.s.status = "skipped"; it.s.skipReason = "availability"; w.touch(it.s.id);
    if (kindInfo(it.s.kind).group === "strength" && !it.s.debtCounted) { it.s.debtCounted = true; w.P.meta.debt.strength = Math.min(1, (w.P.meta.debt.strength || 0) + 1); }
  });
  w.note(dropped.length ? `Woche neu verteilt: ${kept.length} Einheit(en) auf deine freien Tage, ${dropped.length} weniger wichtige entfallen.` : `Woche neu auf deine freien Tage verteilt.`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}

/* ---------- Abschluss & Progression ---------- */
export function hasPainWords(text) {
  const t = String(text || "").toLowerCase().replace(/\b(kein|keine|keinen|keiner|keinem|ohne|nicht)\s+\w+/g, " ");
  return ["schmerz", "beschwer", "ziehen", "verletz", "schwell", "humpel", "steif", "problem", "stechen"].some(x => t.includes(x));
}
const roundTo = (n, step) => Math.round(n / step) * step;
const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const EXPECTED_RPE = {easy: 4, moderate: 6, hard: 8};

function exerciseSets(s, i) { const l = s.log && s.log.sets && s.log.sets[i]; return Array.isArray(l) ? l.filter(x => x && (num(x.reps) != null || num(x.seconds) != null)) : []; }

// Auswertung einer erledigten Einheit. garminFlags: Texte aus engine/garmin.js (leer, wenn keine Garmin-Daten).
export function analyzeSession(plan, s, garminFlags = []) {
  const log = s.log || {};
  const rpe = num(log.rpe), pain = num(log.pain), painWords = hasPainWords(log.notes);
  const exp = EXPECTED_RPE[s.intensity] ?? 6, caution = plan.meta.mode === "return" || (plan.goal && plan.goal.injury);
  const painKnown = pain != null || !caution;
  const reasons = [];
  const severe = pain != null && pain >= 4, mild = (pain != null && pain >= 2) || painWords;
  const rpeHigh = rpe != null && rpe >= Math.max(8, exp + 2), rpeVeryHigh = rpe != null && rpe >= 9;
  if (severe) reasons.push(`Schmerz ${pain}/10`); else if (mild) reasons.push(pain != null && pain >= 2 ? `Schmerz ${pain}/10` : "Beschwerden in den Notizen");
  if (rpeHigh) reasons.push(`RPE ${rpe}`);
  if (garminFlags.length >= 2) reasons.push("Garmin-Erholung auffällig: " + garminFlags.join(", "));
  const reduce = severe || rpeVeryHigh, hold = reduce || mild || rpeHigh || garminFlags.length >= 2;
  const zone = reduce ? "red" : hold ? "yellow" : "green";
  const tips = [];
  if (!painKnown) tips.push("Schmerzwert (0–10) eintragen – ohne ihn wird im Wiedereinstieg nicht gesteigert.");
  if (rpe == null) tips.push("RPE eintragen, damit die Belastung eingeordnet werden kann.");

  const exercises = [];
  (s.exercises || []).forEach((ex, i) => {
    const sets = exerciseSets(s, i); if (!sets.length) return;
    const res = {name: ex.name, type: ex.type, action: "hold", reason: ""};
    if (ex.type === "time") {
      const secs = sets.map(x => num(x.seconds)).filter(v => v != null), minS = Math.min(...secs);
      const allMax = sets.length >= ex.sets && secs.every(v => v >= ex.repMax);
      res.lastSeconds = minS;
      if (reduce) { res.action = "reduce"; res.nextSeconds = Math.max(10, minS - 5); res.reason = "Belastung zurücknehmen."; }
      else if (!hold && painKnown && allMax) { res.action = "increase_reps"; res.nextSeconds = Math.min(90, minS + 5); res.reason = `Alle Sätze ≥ ${ex.repMax} Sek. → +5 Sek.`; }
      else { res.nextSeconds = minS; res.reason = hold ? "Halten – " + reasons.join("; ") : "Dauer halten, bis alle Sätze das Ziel erreichen."; }
      exercises.push(res); return;
    }
    const ws = sets.map(x => num(x.weight)).filter(v => v != null), top = ws.length ? Math.max(...ws) : null;
    const atTop = sets.filter(x => top == null || num(x.weight) == null || num(x.weight) >= top * 0.98), reps = atTop.map(x => num(x.reps)).filter(v => v != null);
    const minReps = reps.length ? Math.min(...reps) : null;
    res.lastWeight = top; res.lastReps = minReps;
    const allTop = sets.length >= ex.sets && sets.every(x => num(x.reps) != null && num(x.reps) >= ex.repMax);
    const inRange = sets.every(x => num(x.reps) != null && num(x.reps) >= ex.repMin);
    if (top == null) { // Körpergewicht
      res.nextReps = hold ? (minReps ?? ex.repMin) : Math.min(ex.repMax + 5, (minReps ?? ex.repMin) + (inRange ? 1 : 0));
      res.action = !hold && res.nextReps > (minReps ?? 0) ? "increase_reps" : "hold";
      res.reason = hold ? "Halten – " + reasons.join("; ") : "Wiederholungen schrittweise steigern; später schwerere Variante wählen.";
    } else if (reduce) { res.action = "reduce"; res.nextWeight = roundTo(top * 0.9, 1.25); res.nextReps = ex.repMin; res.reason = "Gewicht ~10 % senken: " + (reasons.join("; ") || "Belastung zu hoch"); }
    else if (hold || !painKnown) { res.nextWeight = top; res.nextReps = clamp(minReps ?? ex.repMin, ex.repMin, ex.repMax); res.reason = hold ? "Gewicht halten – " + reasons.join("; ") : "Gewicht halten – Schmerzwert fehlt."; }
    else if (allTop) {
      const step = Math.max(1.25, roundTo(top * (plan.meta.phaseSmall ? 0.025 : 0.05), 1.25));
      res.action = "increase_weight"; res.nextWeight = top + step; res.nextReps = ex.repMin;
      res.reason = `Alle ${ex.sets} Sätze mit ${ex.repMax} Wdh. → +${String(step).replace(".", ",")} kg, zurück auf ${ex.repMin} Wdh.`;
    } else if (inRange) { res.action = "increase_reps"; res.nextWeight = top; res.nextReps = Math.min(ex.repMax, (minReps ?? ex.repMin) + 1); res.reason = `Gewicht beibehalten, Ziel ${res.nextReps} Wdh. in allen Sätzen.`; }
    else {
      const low = sets.some(x => num(x.reps) != null && num(x.reps) < ex.repMin - 2);
      res.nextWeight = low ? roundTo(top * 0.95, 1.25) : top; res.nextReps = ex.repMin; res.action = low ? "reduce" : "hold";
      res.reason = low ? "Wiederholungen deutlich unter Ziel → Gewicht ~5 % senken." : `Unter ${ex.repMin} Wdh. → Gewicht halten, sauber ausführen.`;
    }
    exercises.push(res);
  });

  // Ausdauer/Allgemein: Dauer & RPE gegen Erwartung
  const planned = s.durationMin, did = num(log.durationMin) || planned, ratio = did / planned;
  let nextFactor = 1, advice;
  if (reduce) { nextFactor = 0.85; advice = "Nächste Einheiten ~15 % kürzer/leichter, keine neue hohe Intensität."; }
  else if (hold) { nextFactor = 1; advice = "Konsolidieren: Umfang halten, keine Steigerung."; }
  else if (painKnown && rpe != null && rpe <= exp - 1 && ratio >= 0.9 && kindInfo(s.kind).group !== "strength" && kindInfo(s.kind).group !== "recovery") { nextFactor = 1.05; advice = "Fühlte sich leichter an als geplant: gleiche Einheiten ab jetzt ca. 5 % länger."; }
  else advice = "Weiter wie geplant – nur eine Variable (Umfang ODER Intensität) auf einmal steigern.";
  const summary = reduce ? "Hohe Belastung bzw. Beschwerden – entlasten." : hold ? "Gut durchgezogen – jetzt konsolidieren statt steigern." : painKnown ? "Gut verträglich – Progression freigegeben." : "Dokumentiert – für Steigerungen fehlt der Schmerzwert.";
  return {source: "regel", zone, hold, reduce, painKnown, summary, exercises, nextFactor, advice, tips, reasons, ratio: Math.round(ratio * 100) / 100};
}

// Ergebnis der Auswertung in den Plan übernehmen: Zielwerte je Übung + Umfangsfaktor für künftige Einheiten gleicher Art
export function applyAnalysis(plan, sessions, sessionId, analysis, today) {
  const w = work(plan, sessions), done = w.S.get(sessionId); if (!done) return finish(w);
  const ws0 = weekStart(done.date);
  w.P.meta.targets = w.P.meta.targets || {}; w.P.meta.progress = w.P.meta.progress || {};
  analysis.exercises.forEach(ex => {
    const t = {reason: ex.reason, date: done.date};
    if (ex.type === "time") { if (ex.nextSeconds == null) return; t.seconds = ex.nextSeconds; }
    else { if (ex.nextWeight != null) t.weight = ex.nextWeight; if (ex.nextReps != null) t.reps = ex.nextReps; if (t.weight == null && t.reps == null) return; }
    w.P.meta.targets[ex.name] = t;
  });
  const f = clamp(analysis.nextFactor || 1, 0.7, 1.1), touchedWeeks = new Set();
  const cumulative = clamp((w.P.meta.progress[done.kind] || 1) * f, 0.7, 1.15), realF = cumulative / (w.P.meta.progress[done.kind] || 1);
  w.P.meta.progress[done.kind] = cumulative;
  for (const s of w.list()) {
    if (s.status !== "planned" || s.date <= done.date) continue;
    // Zielwerte auf künftige Kraft-Einheiten
    if (s.exercises && s.exercises.length) { s.exercises = s.exercises.map(e => ({...e, target: w.P.meta.targets[e.name] || e.target})); w.touch(s.id); }
    if (s.kind === done.kind && Math.abs(realF - 1) > 0.001 && !s.locked && weekStart(s.date) !== ws0) {
      ensureBase(s); s.baseMinutes = round5(s.baseMinutes * realF); rebuild(w, s, s.baseMinutes); touchedWeeks.add(weekStart(s.date));
    }
  }
  touchedWeeks.forEach(ws => { w.P.meta.weekTargets[ws] = w.list().filter(s => weekStart(s.date) === ws && s.status !== "skipped").reduce((a, s) => a + (s.status === "done" ? actualLoad(s) : baseLoad(s)), 0); });
  if (Math.abs(realF - 1) > 0.01) w.note(`Künftige „${kindInfo(done.kind).label}“-Einheiten ${realF > 1 ? "um" : "um"} ${Math.round(Math.abs(realF - 1) * 100)} % ${realF > 1 ? "länger" : "kürzer"}.`);
  rebalance(null, null, today, {_w: w});
  return finish(w);
}

export function completeSession(plan, sessions, id, log, today) {
  const w = work(plan, sessions), s = w.S.get(id); if (!s) return finish(w);
  s.status = "done"; s.log = {...(s.log || {}), ...log, completedAt: new Date().toISOString()}; w.touch(id);
  if (s.debtCounted) { s.debtCounted = false; w.P.meta.debt.strength = Math.max(0, (w.P.meta.debt.strength || 0) - 1); }
  rebalance(null, null, today, {_w: w});
  return finish(w);
}
