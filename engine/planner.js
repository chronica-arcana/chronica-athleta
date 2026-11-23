// Plangenerator: Ziel (Wizard-Antworten) -> Phasen, Wochenlast, Wochenmuster, konkrete Einheiten.
// Rein regelbasiert und deterministisch. Die KI interpretiert das Ziel und kommentiert den Plan,
// die Struktur (und damit die Sicherheit) kommt immer aus dieser Engine.
import {KINDS, kindInfo, EQUIPMENT_TIERS} from "./catalog.js";
import {buildSession, round5} from "./content.js";
import {addDays, weekStart, dow, diffDays, uuid} from "./dates.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const EVENT_PRESETS = {
  run_5k:       {label: "5-km-Lauf", sport: "run", minutes: {beginner: 40, intermediate: 30, advanced: 24}},
  run_10k:      {label: "10-km-Lauf", sport: "run", minutes: {beginner: 75, intermediate: 58, advanced: 45}},
  run_half:     {label: "Halbmarathon", sport: "run", minutes: {beginner: 150, intermediate: 115, advanced: 95}},
  run_marathon: {label: "Marathon", sport: "run", minutes: {beginner: 330, intermediate: 250, advanced: 200}},
  bike_100k:    {label: "Radtour / Rennen 100 km", sport: "bike", minutes: {beginner: 300, intermediate: 220, advanced: 170}},
  swim_1500:    {label: "Schwimmen 1,5 km", sport: "swim", minutes: {beginner: 55, intermediate: 38, advanced: 26}},
  tri_sprint:   {label: "Triathlon (Sprint)", sport: "run", sports: ["swim", "bike", "run"], minutes: {beginner: 120, intermediate: 95, advanced: 75}},
  tri_olympic:  {label: "Triathlon (Olympisch)", sport: "run", sports: ["swim", "bike", "run"], minutes: {beginner: 230, intermediate: 180, advanced: 140}},
  other:        {label: "Anderes Ziel-Event", sport: null, minutes: {beginner: 90, intermediate: 90, advanced: 90}}
};

export const RETURN_PHASES = [
  {key: "r1", name: "Beruhigen & Belastbarkeit", ratio: 0.2, focus: "Alltagsbelastung stabilisieren, schmerzarm bewegen, Grundkraft ohne Sprung-/Sprintbelastung.", criteria: ["Folgetag stabil", "kein Hinken", "keine Zunahme der Beschwerden"]},
  {key: "r2", name: "Kraftbasis", ratio: 0.25, focus: "Progressive Kraft, kontrollierte einbeinige Übungen, lockeres Ausdauertraining.", criteria: ["Krafttraining gut verträglich", "lockeres Ausdauertraining stabil"]},
  {key: "r3", name: "Ausdauerkapazität", ratio: 0.25, focus: "Umfang erhöhen, erste zügige Abschnitte, Kraft weiter aufbauen.", criteria: ["RPE meist ≤7", "keine Verschlechterung am Folgetag"]},
  {key: "r4", name: "Beschleunigen & Bremsen", ratio: 0.15, focus: "Zügiges Tempo, Beschleunigen und Abbremsen, seitliche Kontrolle schrittweise.", criteria: ["zügiges Tempo schmerzfrei", "kontrolliertes Abbremsen"]},
  {key: "r5", name: "Rückkehr in den Sport", ratio: 0.15, focus: "Sportartspezifische Belastung vorbereiten. Voller Einstieg nur mit Freigabe von Arzt/Sportphysio.", criteria: ["volle Trainingswoche verträglich", "kein Rebound am Folgetag", "Freigabe durch Fachperson"]}
];
const EVENT_PHASES = [
  {key: "base", name: "Grundlage", ratio: 0.4, focus: "Aerobe Basis und Gewöhnung an die Belastung aufbauen."},
  {key: "build", name: "Aufbau", ratio: 0.4, focus: "Umfang und gezielte Intensität steigern, wöchentliche Schlüsseleinheiten."},
  {key: "peak", name: "Spezifisch", ratio: 0.12, focus: "Wettkampfnahes Training, Form schärfen."},
  {key: "taper", name: "Tapering", ratio: 0.08, focus: "Umfang reduzieren, frisch zum Event."}
];
const GENERAL_PHASES = [
  {key: "foundation", name: "Fundament", ratio: 0.25, focus: "Gewohnheit etablieren, Technik und Grundlagen, moderate Belastung."},
  {key: "build", name: "Aufbau", ratio: 0.5, focus: "Schrittweise mehr Umfang und Intensität, Kraft progressiv steigern."},
  {key: "peak", name: "Festigung", ratio: 0.25, focus: "Leistung stabilisieren und ausreizen, Fortschritte testen."}
];

export function makePhases(W, mode, hasEvent) {
  const defs = mode === "return" ? RETURN_PHASES : hasEvent ? EVENT_PHASES : GENERAL_PHASES;
  const use = defs.slice(0, Math.max(1, Math.min(defs.length, Math.floor(W / 2)))); // Phase braucht ≥2 Wochen (außer sehr kurze Pläne)
  if (hasEvent && W >= 3 && !use.some(p => p.key === "taper")) use[use.length - 1] = defs[3];
  const total = use.reduce((s, p) => s + p.ratio, 0);
  let counts = use.map(p => Math.max(1, Math.round(p.ratio / total * W)));
  let diff = W - counts.reduce((a, b) => a + b, 0);
  const grow = counts.indexOf(Math.max(...counts));
  while (diff !== 0) { const i = diff > 0 ? grow : counts.findIndex(c => c === Math.max(...counts)); counts[i] += Math.sign(diff); diff -= Math.sign(diff); }
  let from = 0;
  return use.map((p, i) => { const ph = {key: p.key, name: p.name, focus: p.focus, criteria: p.criteria, fromWeek: from, toWeek: from + counts[i] - 1}; from += counts[i]; return ph; });
}

function qualityLevel(goal, phaseKey, weekIdx, deload) {
  if (deload || phaseKey === "taper") return deload ? 0 : 1;
  const level = goal.level || "intermediate";
  if (goal.mode === "return") return phaseKey === "r4" ? 1 : phaseKey === "r5" ? 1 : 0;
  if (level === "beginner") return (phaseKey === "build" || phaseKey === "peak") ? 1 : 0;
  if (phaseKey === "foundation" || phaseKey === "base") return level === "advanced" ? 1 : (weekIdx >= 2 ? 1 : 0);
  if (goal.mode === "health") return 1;
  return 2;
}
function qualityKind(sport, q, weekIdx, phaseKey) {
  const t = {run: "run_tempo", bike: "bike_tempo"}, i = {run: "run_intervals", bike: "bike_intervals"};
  if (q >= 2 && (phaseKey === "peak" || weekIdx % 2 === 1)) return i[sport];
  return t[sport];
}

function slotsFor(sport, count, q, goal, weekIdx, phaseKey) {
  const beginnerEarly = (goal.level === "beginner" || goal.mode === "return") && weekIdx < 9 && goal.level !== "advanced";
  const easyRun = beginnerEarly && goal.mode !== "return" && weekIdx < 9 ? "run_walkrun" : "run_easy";
  const out = [];
  if (sport === "run" || sport === "bike") {
    const easy = sport === "run" ? easyRun : "bike_easy", long = sport + "_long";
    const quality = q > 0 ? qualityKind(sport, q, weekIdx, phaseKey) : null;
    const oneOff = goal.event && goal.level !== "beginner" && weekIdx % 2 === 0 ? long : easy;
    const order = count === 1 ? [oneOff] : count === 2 ? (quality ? [quality, long] : [easy, long]) : [long, quality || easy, easy, easy, easy];
    for (let i = 0; i < count; i++) out.push(order[i] || easy);
  } else if (sport === "swim") {
    const order = ["swim_endurance", "swim_technique", q >= 2 ? "swim_intervals" : "swim_technique", "swim_technique"];
    for (let i = 0; i < count; i++) out.push(order[i] || "swim_technique");
  } else if (sport === "football") {
    const order = ["football_skills", q > 0 ? "football_conditioning" : "football_skills", "football_skills"];
    for (let i = 0; i < count; i++) out.push(order[i] || "football_skills");
  } else if (sport === "cardio") {
    const order = ["cardio_easy", q >= 2 ? "cardio_intervals" : "cardio_easy", "cardio_easy"];
    for (let i = 0; i < count; i++) out.push(order[i] || "cardio_easy");
  } else if (sport === "mobility") { for (let i = 0; i < count; i++) out.push("mobility"); }
  else if (sport === "walk") { for (let i = 0; i < count; i++) out.push("walk"); }
  return out;
}

function strengthCount(goal, N) {
  if (Number.isFinite(goal.strengthPerWeek)) return clamp(goal.strengthPerWeek, 0, Math.max(0, N - (goal.sports.some(s => s !== "strength") ? 1 : 0)));
  const hasStrength = goal.sports.includes("strength");
  if (hasStrength && goal.sports.length === 1) return clamp(N, 1, 4);
  if (hasStrength && goal.primary === "strength") return clamp(Math.round(N * 0.6), 1, 4);
  if (hasStrength) return N >= 5 ? 2 : 1;
  return N >= 5 ? 2 : N >= 3 ? 1 : 0;
}
function strengthKinds(S, goal) {
  const only = goal.sports.includes("strength") && goal.sports.length === 1 || goal.primary === "strength" || goal.primary === "football";
  if (S <= 0) return [];
  if (S === 1) return ["strength_full"];
  if (S === 2) return only ? ["strength_lower", "strength_upper"] : ["strength_full", "strength_core"];
  return ["strength_lower", "strength_upper", "strength_full", "strength_core"].slice(0, S);
}

function allocate(R, sports, primary) {
  const weights = sports.map(s => s === primary ? 2 : 1), tw = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(w => R * w / tw), counts = raw.map(Math.floor);
  let left = R - counts.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i]++; left--; } });
  const pi = sports.indexOf(primary);
  if (R >= 1 && pi >= 0 && counts[pi] === 0) { const j = counts.indexOf(Math.max(...counts)); counts[j]--; counts[pi]++; }
  return sports.map((s, i) => ({sport: s, count: counts[i]})).filter(x => x.count > 0);
}

const MULT = {run_long: 1.6, bike_long: 1.7, swim_endurance: 1.1, run_intervals: 0.9, bike_intervals: 0.9, strength_core: 0.7, strength_lower: 1, football_skills: 1.3,
  football_conditioning: 1.2, team_match: 1.5, mobility: 0.7, walk: 1.2};
const CAP = {run_long: 150, bike_long: 240, swim_endurance: 75, strength_full: 70, strength_lower: 70, strength_upper: 70, strength_core: 45, mobility: 45, football_skills: 100, football_conditioning: 80};
function minutesFor(kind, typical, factor) {
  if (kind === "strength_snack") return 20;
  const m = typical * (MULT[kind] || 1) * factor;
  return round5(clamp(m, 15, CAP[kind] || 150));
}

const LIGHT = {swim_endurance: "swim_technique", swim_intervals: "swim_technique", football_conditioning: "football_skills", team_match: "football_skills", cardio_intervals: "cardio_easy"};
function lightKind(kind) { return LIGHT[kind] || kind.replace(/_(tempo|intervals|long)$/, "_easy"); }

export function compose(goal, N, weekIdx, phaseKey, deload) {
  const q = qualityLevel(goal, phaseKey, weekIdx, deload);
  const S = deload ? Math.min(strengthCount(goal, N), 1 + (goal.sports.includes("strength") ? 1 : 0)) : strengthCount(goal, N);
  const sKinds = strengthKinds(S, goal);
  const endSports = goal.sports.filter(s => s !== "strength");
  const R = N - sKinds.length;
  const items = sKinds.map(k => ({kind: k, priority: "support"}));
  if (R > 0) {
    const alloc = endSports.length ? allocate(R, endSports, goal.primary) : [{sport: "cardio", count: R}];
    alloc.forEach(({sport, count}) => slotsFor(sport, count, q, goal, weekIdx, phaseKey).forEach((kind, i) => {
      const info = kindInfo(kind);
      items.push({kind, priority: info.key ? "key" : (kind === "mobility" || (i > 0 && !info.key)) ? "optional" : "support"});
    }));
  }
  return items;
}

function costOf(items) { // items sortiert nach Datum: {kind, date}
  let cost = 0;
  const info = items.map(i => kindInfo(i.kind));
  for (let i = 0; i < items.length; i++) {
    const wd = dow(items[i].date);
    if (info[i].long) cost += (6 - wd) * 0.9;
    if (i === items.length - 1) continue;
    const gap = diffDays(items[i + 1].date, items[i].date), a = info[i], b = info[i + 1];
    if (gap === 1) {
      cost += 1;
      if (a.intensity === "hard" && b.intensity === "hard") cost += 12;
      else if ((a.intensity === "hard" && b.long) || (a.long && b.intensity === "hard")) cost += 8;
      else if (a.quality && b.quality) cost += 6;
      if (a.group === "strength" && b.quality && (b.sport === "run" || b.sport === "football")) cost += 7;
      if (a.long && b.group === "strength") cost += 5;
      if (a.quality && b.group === "strength" && b.sport === "strength") cost += 2;
    }
  }
  const gaps = []; for (let i = 0; i < items.length - 1; i++) gaps.push(diffDays(items[i + 1].date, items[i].date));
  if (gaps.length) { const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length; cost += gaps.reduce((s, g) => s + (g - avg) ** 2, 0) * 0.3; }
  return cost;
}

// Wählt aus den Kandidatentagen die beste Zuordnung (Anzahl Einheiten ≤ Tage).
export function assignDays(items, dates) {
  const n = items.length;
  if (n === 0) return [];
  const days = [...dates].sort();
  let best = null, bestCost = Infinity;
  const used = new Array(n).fill(false), pick = [];
  const choose = (start, chosen) => {
    if (chosen.length === n) { permute(chosen); return; }
    for (let i = start; i < days.length; i++) { chosen.push(days[i]); choose(i + 1, chosen); chosen.pop(); }
  };
  const permute = chosen => {
    const rec = (k, arr) => {
      if (k === n) {
        const withDates = arr.map((it, i) => ({kind: it.kind, date: chosen[i], it}));
        const c = costOf(withDates);
        if (c < bestCost) { bestCost = c; best = withDates.map(x => ({item: x.it, date: x.date})); }
        return;
      }
      for (let i = k; i < n; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; rec(k + 1, arr); [arr[k], arr[i]] = [arr[i], arr[k]]; }
    };
    rec(0, items.slice());
  };
  choose(0, []);
  return best || [];
}

// Yoga/Mobility wird automatisch als zusätzliche, optionale Einheit eingeplant, wenn es sinnvoll ist:
// Wiedereinstieg/Gesundheit, Entlastungs- und Taperwochen, mind. 2 Krafteinheiten oder 2 Schlüsseleinheiten in der Woche.
// Bevorzugt am Tag nach der anstrengendsten Einheit. Zählt nicht zu daysPerWeek.
function pickYogaSlot(goal, wf, rows, ws, candidateDows, startDate, eventDate) {
  if (goal.autoYoga === false || rows.some(r => kindInfo(r.item.kind).group === "recovery")) return null;
  const strengthN = rows.filter(r => kindInfo(r.item.kind).group === "strength").length, heavy = rows.filter(r => kindInfo(r.item.kind).key).length;
  if (!(goal.mode === "return" || goal.mode === "health" || wf.deload || wf.phaseKey === "taper" || strengthN >= 2 || heavy >= 2)) return null;
  const used = new Set(rows.map(r => r.date)), byDate = new Map(rows.map(r => [r.date, r]));
  const free = candidateDows.map(d => addDays(ws, d)).filter(d => d >= startDate && !used.has(d) && (!eventDate || d < eventDate));
  if (!free.length) return null;
  const score = d => { let sc = 0; const prev = byDate.get(addDays(d, -1)), next = byDate.get(addDays(d, 1));
    if (prev) { const i = kindInfo(prev.item.kind); sc -= (i.intensity === "hard" || i.long) ? 3 : i.group === "strength" ? 2 : 1; }
    if (next && kindInfo(next.item.kind).intensity === "hard") sc += 2; return sc; };
  free.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
  const day = free[0], prev = byDate.get(addDays(day, -1)), afterStrength = prev && kindInfo(prev.item.kind).group === "strength";
  return {date: day, minutes: wf.deload ? 30 : clamp(round5(goal.minutesPerSession * 0.5), 20, 30), flowKey: wf.deload ? "relax" : afterStrength ? "strength" : "regeneration"};
}

const PRIO = {bonus: -1, optional: 0, support: 1, key: 2}; // "bonus" (Yoga) entfällt bei Platzmangel zuerst
export function trimToFit(items, capacity) {
  const out = items.slice(), dropped = [];
  while (out.length > capacity) {
    let idx = 0;
    out.forEach((it, i) => { if (PRIO[it.priority] <= PRIO[out[idx].priority] && !(PRIO[it.priority] === PRIO[out[idx].priority] && i < idx)) idx = i; });
    dropped.push(out.splice(idx, 1)[0]);
  }
  return {kept: out, dropped};
}

function weekFactors(W, phases, goal) {
  const typicalWeekly = (goal.daysPerWeek || 3) * (goal.minutesPerSession || 45);
  const ret = goal.mode === "return", level = goal.level || "intermediate";
  const start = clamp(goal.currentWeeklyMinutes ? goal.currentWeeklyMinutes / typicalWeekly : (ret ? 0.55 : level === "beginner" ? 0.75 : 0.85), 0.5, 1);
  const growth = ret ? 1.06 : 1.07, cap = ret ? 1.0 : ({beginner: 1.1, intermediate: 1.2, advanced: 1.3})[level] || 1.2;
  const list = []; let f = start, lastBuild = start;
  for (let i = 0; i < W; i++) {
    const ph = phases.find(p => i >= p.fromWeek && i <= p.toWeek), ofPhase = i - ph.fromWeek;
    const weeksToEnd = W - 1 - i;
    let deload = false, factor;
    if (ph.key === "taper") { factor = lastBuild * (weeksToEnd === 0 ? 0.55 : 0.75); }
    else {
      deload = W >= 6 && (i + 1) % 4 === 0 && i < W - 2 && ph.key !== "peak";
      if (deload) factor = lastBuild * 0.75;
      else { if (i > 0) f = Math.min(cap, f * growth); lastBuild = f; factor = f; }
    }
    list.push({idx: i, phaseKey: ph.key, phaseName: ph.name, deload, factor});
  }
  return list;
}

export function normalizeGoal(g) {
  const goal = {mode: "performance", level: "intermediate", daysPerWeek: 3, minutesPerSession: 45, equipment: "none", ...g};
  goal.sports = (goal.sports && goal.sports.length ? goal.sports : ["run"]).filter((s, i, a) => KINDS_SPORTS.has(s) && a.indexOf(s) === i);
  if (!goal.sports.length) goal.sports = ["run"];
  if (!goal.primary || !goal.sports.includes(goal.primary)) goal.primary = goal.sports[0];
  goal.daysPerWeek = clamp(Math.round(goal.daysPerWeek), 1, 7);
  goal.minutesPerSession = clamp(Math.round(goal.minutesPerSession), 15, 180);
  return goal;
}
const KINDS_SPORTS = new Set(["run", "bike", "swim", "strength", "football", "cardio", "mobility", "walk"]);

export function defaultTitle(goal) {
  const preset = goal.event && EVENT_PRESETS[goal.event.preset];
  if (goal.event && (goal.event.name || preset)) return goal.event.name || preset.label;
  const names = {run: "Laufen", bike: "Radfahren", swim: "Schwimmen", strength: "Kraft", football: "Fußball", cardio: "Ausdauer", mobility: "Mobility", walk: "Wandern"};
  if (goal.mode === "return") return "Wiedereinstieg: " + goal.sports.map(s => names[s]).join(" + ");
  return goal.sports.map(s => names[s]).join(" + ") + (goal.mode === "health" ? " – Fit & gesund" : " – Plan");
}

export function generatePlan(rawGoal, opts = {}) {
  const goal = normalizeGoal(rawGoal);
  const today = opts.today || goal.startDate || addDays(weekStart(new Date().toISOString().slice(0, 10)), 0);
  const startDate = goal.startDate || today;
  const warnings = [];
  const preset = goal.event && EVENT_PRESETS[goal.event.preset];
  const eventDate = goal.event && goal.event.date;
  let W;
  if (eventDate) {
    W = Math.floor(diffDays(weekStart(eventDate), weekStart(startDate)) / 7) + 1;
    if (W < 2) { warnings.push("Das Event liegt sehr nah – der Plan besteht nur aus Tapering und Event."); W = 2; }
    if (W > 52) { warnings.push("Das Event liegt mehr als ein Jahr entfernt – der Plan wurde auf 52 Wochen begrenzt."); W = 52; }
  } else W = clamp(Math.round(goal.weeks || 12), 2, 52);
  if (preset && preset.label.includes("Marathon") && goal.level === "beginner" && W < 16) warnings.push("Für einen Marathon als Einsteiger sind meist mindestens 16–20 Wochen sinnvoll.");
  if (goal.mode === "return" || goal.injury) warnings.push("Wiedereinstieg/Beschwerden: Der Plan ersetzt keine Untersuchung oder Freigabe durch Arzt oder Sportphysio. Bei Schmerzen nicht steigern.");

  const hasEvent = !!eventDate;
  const phases = makePhases(W, goal.mode, hasEvent);
  const factors = weekFactors(W, phases, goal);
  const planId = opts.planId || uuid();
  const sessions = [];
  const tier = EQUIPMENT_TIERS[goal.equipment] ?? 0;
  const candidateDows = goal.preferredDays && goal.preferredDays.length >= goal.daysPerWeek ? goal.preferredDays : [0, 1, 2, 3, 4, 5, 6];
  const weekTargets = {};
  const week0 = weekStart(startDate);
  let prevLoad = null, prevCount = 0;

  for (const wf of factors) {
    const ws = addDays(week0, wf.idx * 7);
    const ph = phases.find(p => p.key === wf.phaseKey);
    const ctx = {phaseKey: wf.phaseKey, phaseName: wf.phaseName, weekIdx: wf.idx, deload: wf.deload, level: goal.level, equipment: goal.equipment, mode: goal.mode,
      injury: !!goal.injury, focusStrength: goal.primary === "strength"};
    let candidates = candidateDows.map(d => addDays(ws, d)).filter(d => d >= startDate);
    const isEventWeek = hasEvent && weekStart(eventDate) === ws;
    let items;
    if (isEventWeek) {
      candidates = candidates.filter(d => d < eventDate && diffDays(eventDate, d) >= 2);
      const N = Math.min(goal.daysPerWeek, 3, candidates.length);
      items = compose({...goal, strengthPerWeek: 0}, N, wf.idx, "taper", true).map(it => ({...it, priority: "optional"}));
      items = items.map(it => ({...it, kind: lightKind(it.kind)}));
    } else {
      items = compose(goal, goal.daysPerWeek, wf.idx, wf.phaseKey, wf.deload);
    }
    const {kept, dropped} = trimToFit(items, candidates.length);
    if (dropped.length && wf.idx === 0 && !isEventWeek) warnings.push(`Die erste Woche startet mitten in der Woche – ${dropped.length} Einheit(en) wurden weggelassen.`);
    const placed = assignDays(kept, candidates);
    // Wochenlast darf (außer Deload/Taper) höchstens ~10 % über der Vorwoche liegen: ggf. längste Einheit schrittweise um 5 Min kürzen.
    const rows = placed.map(({item, date}) => ({item, date, minutes: minutesFor(item.kind, goal.minutesPerSession, wf.factor)}));
    const yoga = pickYogaSlot(goal, wf, rows, ws, candidateDows, startDate, isEventWeek ? eventDate : null);
    if (yoga) rows.push({item: {kind: "mobility", priority: "bonus"}, date: yoga.date, minutes: yoga.minutes, flowKey: yoga.flowKey});
    const loadOf = r => Math.round(r.minutes * kindInfo(r.item.kind).loadPerMin);
    if (prevLoad != null && prevCount === placed.length && !wf.deload && wf.phaseKey !== "taper" && !isEventWeek) {
      const cap = prevLoad * 1.1;
      for (let guard = 0; guard < 40 && rows.reduce((a, r) => a + loadOf(r), 0) > cap; guard++) {
        const r = rows.filter(x => x.minutes > 15 && x.item.kind !== "strength_snack" && x.item.kind !== "mobility").sort((x, y) => y.minutes - x.minutes)[0];
        if (!r) break; r.minutes -= 5;
      }
    }
    let weekLoad = 0;
    for (const {item, date, minutes, flowKey} of rows) {
      const built = buildSession(item.kind, minutes, {...ctx, tier, flowKey});
      const info = kindInfo(item.kind);
      const load = Math.round(built.durationMin * info.loadPerMin);
      weekLoad += load;
      sessions.push({id: uuid(), planId, date, week: wf.idx, kind: item.kind, sport: info.sport, title: built.title, durationMin: built.durationMin,
        intensity: info.intensity, load, priority: item.priority, status: "planned", blocks: built.blocks, exercises: built.exercises, flow: built.flow, flowKey: built.flowKey, ctx, source: "plan", log: null});
    }
    if (isEventWeek) {
      const mins = (goal.event.minutes) || (preset && preset.minutes[goal.level]) || 90;
      const built = buildSession("event", mins, {...ctx, eventName: goal.event.name || (preset && preset.label)});
      const load = Math.round(mins * kindInfo("event").loadPerMin);
      weekLoad += load;
      sessions.push({id: uuid(), planId, date: eventDate, week: wf.idx, kind: "event", sport: "event", title: built.title, durationMin: round5(mins), intensity: "hard", load,
        priority: "key", status: "planned", blocks: built.blocks, exercises: [], ctx, source: "plan", log: null});
    }
    weekTargets[ws] = weekLoad;
    if (!wf.deload && wf.phaseKey !== "taper") { prevLoad = weekLoad; prevCount = placed.length; }
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const endDate = eventDate || addDays(week0, W * 7 - 1);
  const plan = {id: planId, title: goal.title || defaultTitle(goal), status: "active", startDate, endDate, goal,
    meta: {phases, weekTargets, targets: {}, debt: {strength: 0}, notes: [], warnings, mode: goal.mode, source: "engine", coachSummary: ""}};
  return {plan, sessions};
}
