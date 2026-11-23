import {html, useState, useEffect, useMemo} from "../../vendor/preact-htm.js";
import {Seg, Spinner, IconBox} from "./common.js";
import {state, createPlan, ai, aiAvailable, toast, today, addDays, EVENT_PRESETS, PICKABLE_SPORTS, SPORTS} from "../store.js";
import {generatePlan, normalizeGoal, defaultTitle} from "../../engine/planner.js";
import {DAY_SHORT, fmtDay, fmtShort} from "../../engine/dates.js";
import {kindInfo} from "../../engine/catalog.js";

const GOAL_TYPES = [
  {v: "event", icon: "🏁", t: "Auf ein Event hintrainieren", d: "Wettkampf, Lauf, Triathlon, Radtour mit festem Datum"},
  {v: "performance", icon: "📈", t: "Besser / stärker / schneller werden", d: "Leistung in deinen Sportarten steigern"},
  {v: "health", icon: "🌿", t: "Fit & gesund bleiben", d: "Regelmäßig in Bewegung, Gewicht, Energie, Wohlbefinden"},
  {v: "return", icon: "🩹", t: "Wiedereinstieg nach Pause/Verletzung", d: "Vorsichtiger, kriteriengesteuerter Aufbau"}
];
const LEVELS = [{v: "beginner", t: "Einsteiger", d: "Neu dabei oder lange Pause"}, {v: "intermediate", t: "Fortgeschritten", d: "Trainiere regelmäßig seit einiger Zeit"}, {v: "advanced", t: "Erfahren", d: "Strukturiertes Training, Wettkampferfahrung"}];
const EQUIP = [{v: "none", t: "Ohne Geräte", d: "Körpergewicht, Zuhause"}, {v: "dumbbell", t: "Kurzhanteln & Bänder", d: "Kleines Home-Setup"}, {v: "gym", t: "Fitnessstudio", d: "Geräte & Langhantel"}];
const EXAMPLES = ["Ich will im Mai einen Halbmarathon unter 2 Stunden laufen", "Zurück zum Fußball nach einer Leistenverletzung", "Fitter werden und 5 kg abnehmen, 3× pro Woche", "Olympischer Triathlon im Juni, ich schwimme noch unsicher"];

const sanitizeDraft = d => {
  const out = {}; if (!d || typeof d !== "object") return out;
  const sports = (Array.isArray(d.sports) ? d.sports : []).filter(s => PICKABLE_SPORTS.includes(s));
  if (sports.length) { out.sports = [...new Set(sports)].slice(0, 4); out.primary = out.sports.includes(d.primary) ? d.primary : out.sports[0]; }
  if (["event", "performance", "health", "return"].includes(d.goalType)) out.goalType = d.goalType;
  if (["beginner", "intermediate", "advanced"].includes(d.level)) out.level = d.level;
  if (["none", "dumbbell", "gym"].includes(d.equipment)) out.equipment = d.equipment;
  const n = (v, lo, hi) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined; };
  if (n(d.daysPerWeek, 1, 7)) out.daysPerWeek = n(d.daysPerWeek, 1, 7);
  if (n(d.minutesPerSession, 15, 180)) out.minutesPerSession = n(d.minutesPerSession, 15, 180);
  if (n(d.weeks, 2, 52)) out.weeks = n(d.weeks, 2, 52);
  if (d.event && typeof d.event === "object") {
    const e = {}; if (EVENT_PRESETS[d.event.preset]) e.preset = d.event.preset;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.event.date || "") && d.event.date > today()) e.date = d.event.date;
    if (d.event.name) e.name = String(d.event.name).slice(0, 60);
    if (e.preset || e.date) out.event = e;
  }
  if (typeof d.injury === "boolean") out.injury = d.injury;
  if (d.limitations) out.limitations = String(d.limitations).slice(0, 200);
  return out;
};

export function Wizard({onClose, first}) {
  const [g, setG] = useState({text: "", goalType: "health", sports: [], primary: null, event: {preset: "run_10k", date: "", name: ""}, weeks: 12, level: "intermediate",
    currentWeeklyMinutes: 120, daysPerWeek: 3, minutesPerSession: 45, preferredDays: [], startDate: today(), equipment: "none", injury: false, limitations: "", strengthPerWeek: undefined, followUps: []});
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [aiNote, setAiNote] = useState("");
  const [questions, setQuestions] = useState(null), [coach, setCoach] = useState(null), [preview, setPreview] = useState(null);
  const set = patch => setG(prev => ({...prev, ...patch}));
  const isEvent = g.goalType === "event";
  const steps = ["goal", "type", "sports", isEvent ? "event" : "duration", "level", "time", "equip", "fine", "preview"];
  const cur = steps[step];
  const draftGoal = () => ({...g, mode: g.goalType === "return" ? "return" : g.goalType === "health" ? "health" : "performance", event: isEvent && g.event.date ? g.event : isEvent && g.event.preset ? {...g.event, date: undefined} : undefined, title: undefined});
  const eventPreset = EVENT_PRESETS[g.event.preset];

  const analyze = async () => {
    if (!g.text.trim() || !aiAvailable()) { setStep(1); return; }
    setBusy(true);
    try {
      const d = sanitizeDraft(await ai("parse_goal", {text: g.text.slice(0, 600), today: today()}));
      const patch = {...d}; if (d.event) patch.event = {...g.event, ...d.event};
      if (d.event && !d.goalType) patch.goalType = "event";
      set(patch); setAiNote("Die KI hat deine Angaben vorausgefüllt – bitte prüfen und anpassen.");
    } catch (e) { setAiNote("KI nicht erreichbar – bitte die Felder selbst ausfüllen."); }
    setBusy(false); setStep(1);
  };
  const loadQuestions = async () => {
    setQuestions(null);
    if (aiAvailable()) { try { const q = await ai("followups", {goal: {...draftGoal(), followUps: undefined}}); setQuestions((q.questions || []).slice(0, 3).filter(x => x && x.text)); return; } catch {} }
    setQuestions([]);
  };
  useEffect(() => { if (cur === "fine" && questions === null) loadQuestions(); }, [cur]);
  useEffect(() => {
    if (cur !== "preview") return;
    let cancelled = false;
    try {
      const goal = normalizeGoal({...draftGoal(), startDate: g.startDate});
      const res = generatePlan(goal, {today: today()});
      setPreview(res);
      setCoach(null);
      if (aiAvailable()) ai("plan_summary", {goal: {...goal, followUps: g.followUps, text: g.text.slice(0, 300)}, title: res.plan.title,
        phases: res.plan.meta.phases.map(p => ({name: p.name, weeks: p.toWeek - p.fromWeek + 1})), week: res.sessions.filter(s => s.week === 1).map(s => ({kind: s.kind, min: s.durationMin}))})
        .then(c => { if (!cancelled) setCoach({title: String(c.title || "").slice(0, 70), summary: String(c.summary || "").slice(0, 700), tips: (c.tips || []).slice(0, 4).map(t => String(t).slice(0, 180))}); })
        .catch(() => { if (!cancelled) setCoach({}); });
      else setCoach({});
    } catch (e) { toast("Plan konnte nicht erstellt werden: " + e.message, "error"); }
    return () => { cancelled = true; };
  }, [cur]);

  const canNext = () => {
    if (cur === "sports") return g.sports.length > 0;
    if (cur === "event") return !!g.event.preset && (!g.event.date || g.event.date > g.startDate);
    return true;
  };
  const next = () => { if (cur === "goal") return analyze(); setStep(s => Math.min(steps.length - 1, s + 1)); };
  const toggleSport = s => { const has = g.sports.includes(s); const sports = has ? g.sports.filter(x => x !== s) : [...g.sports, s]; set({sports, primary: sports.includes(g.primary) ? g.primary : sports[0] || null}); };
  const create = async () => {
    setBusy(true);
    try {
      const followUps = g.followUps.filter(f => f.a);
      await createPlan({...normalizeGoal({...draftGoal(), startDate: g.startDate}), followUps, text: g.text.slice(0, 300)}, {title: coach && coach.title || undefined, summary: coach && coach.summary, tips: coach && coach.tips, ai: !!(coach && coach.summary)});
      toast("Plan erstellt – los geht's! 🎉", "info"); onClose();
    } catch (e) { toast(e.message, "error"); setBusy(false); }
  };
  const answer = (q, a) => {
    const list = g.followUps.filter(f => f.q !== q.text).concat([{q: q.text, a}]);
    set({followUps: list});
  };

  const body = () => {
    switch (cur) {
      case "goal": return html`<div class="stack"><div><h1>Was möchtest du erreichen?</h1><p class="muted" style="margin-top:6px">Beschreibe dein Ziel in eigenen Worten. ${aiAvailable() ? "Die KI füllt den Rest für dich vor." : "(Ohne Cloud-Konto/KI füllst du die nächsten Schritte selbst aus.)"}</p></div>
        <textarea placeholder="z. B. Ich will im Frühjahr einen Halbmarathon laufen und dabei kräftiger werden …" value=${g.text} onInput=${e => set({text: e.target.value})} maxlength="600"></textarea>
        <div class="stack" style="gap:8px">${EXAMPLES.map(x => html`<button class="chip" style="white-space:normal;text-align:left" onClick=${() => set({text: x})}>💡 ${x}</button>`)}</div></div>`;
      case "type": return html`<div class="stack"><h1>Welche Art von Ziel?</h1>${aiNote && html`<div class="banner info">${aiNote}</div>`}
        ${GOAL_TYPES.map(t => html`<button class=${"opt" + (g.goalType === t.v ? " sel" : "")} onClick=${() => set({goalType: t.v, injury: t.v === "return" ? true : g.injury})}><span style="font-size:1.8rem">${t.icon}</span><span><div class="ot">${t.t}</div><div class="muted small">${t.d}</div></span></button>`)}</div>`;
      case "sports": return html`<div class="stack"><div><h1>Welche Sportarten?</h1><p class="muted" style="margin-top:6px">Wähle eine oder mehrere. Alles ist später flexibel tauschbar.</p></div>
        <div class="grid2">${PICKABLE_SPORTS.map(s => html`<button class=${"opt" + (g.sports.includes(s) ? " sel" : "")} onClick=${() => toggleSport(s)}><span style="font-size:1.6rem">${SPORTS[s].icon}</span><span class="ot small">${SPORTS[s].label}</span></button>`)}</div>
        ${g.sports.length > 1 && html`<div class="stack" style="gap:8px"><h3>Hauptsportart</h3><${Seg} options=${g.sports.map(s => ({value: s, label: SPORTS[s].label, icon: SPORTS[s].icon}))} value=${g.primary} onChange=${v => set({primary: v})} /></div>`}</div>`;
      case "event": return html`<div class="stack"><h1>Dein Event</h1>
        <label class="field">Art<select value=${g.event.preset} onChange=${e => { const p = EVENT_PRESETS[e.target.value]; set({event: {...g.event, preset: e.target.value}, sports: p && (p.sports || (p.sport && [p.sport])) ? [...new Set([...(p.sports || [p.sport]), ...g.sports.filter(s => s === "strength")])] : g.sports, primary: p && p.sport || g.primary}); }}>${Object.entries(EVENT_PRESETS).map(([k, p]) => html`<option value=${k}>${p.label}</option>`)}</select></label>
        <label class="field">Name (optional)<input type="text" maxlength="60" placeholder="z. B. Stadtlauf Köln" value=${g.event.name} onInput=${e => set({event: {...g.event, name: e.target.value}})} /></label>
        <label class="field">Datum des Events<input type="date" min=${addDays(today(), 8)} value=${g.event.date} onChange=${e => set({event: {...g.event, date: e.target.value}})} /></label>
        <p class="small muted">Die Plandauer ergibt sich aus dem Datum. Ohne Datum planen wir ${g.weeks} Wochen.</p>
        ${!g.event.date && html`<label class="field">Wochen: ${g.weeks}<input type="range" min="4" max="30" value=${g.weeks} onInput=${e => set({weeks: +e.target.value})} /></label>`}</div>`;
      case "duration": return html`<div class="stack"><h1>Für welchen Zeitraum?</h1><p class="muted">Wie viele Wochen soll der Plan umfassen?</p>
        <${Seg} options=${[4, 8, 12, 16, 24].map(v => ({value: v, label: v + " Wo."}))} value=${g.weeks} onChange=${v => set({weeks: v})} />
        <label class="field">Individuell: ${g.weeks} Wochen (≈ ${Math.round(g.weeks / 4.3)} Monate)<input type="range" min="2" max="52" value=${g.weeks} onInput=${e => set({weeks: +e.target.value})} /></label></div>`;
      case "level": return html`<div class="stack"><h1>Dein Niveau</h1>
        ${LEVELS.map(l => html`<button class=${"opt" + (g.level === l.v ? " sel" : "")} onClick=${() => set({level: l.v})}><span><div class="ot">${l.t}</div><div class="muted small">${l.d}</div></span></button>`)}
        <label class="field">Aktuell trainierst du pro Woche etwa: ${g.currentWeeklyMinutes} Min<input type="range" min="0" max="480" step="30" value=${g.currentWeeklyMinutes} onInput=${e => set({currentWeeklyMinutes: +e.target.value})} /></label></div>`;
      case "time": return html`<div class="stack"><h1>Wann hast du Zeit?</h1>
        <label class="field">Trainingstage pro Woche: <b style="color:var(--text)">${g.daysPerWeek}</b><input type="range" min="1" max="7" value=${g.daysPerWeek} onInput=${e => set({daysPerWeek: +e.target.value})} /></label>
        <label class="field">Typische Dauer pro Einheit: <b style="color:var(--text)">${g.minutesPerSession} Min</b><input type="range" min="20" max="120" step="5" value=${g.minutesPerSession} onInput=${e => set({minutesPerSession: +e.target.value})} /></label>
        <div class="stack" style="gap:8px"><h3>Bevorzugte Tage <span class="muted small">(optional)</span></h3>
          <div class="seg">${DAY_SHORT.map((d, i) => html`<button class=${"chip" + (g.preferredDays.includes(i) ? " sel" : "")} onClick=${() => set({preferredDays: g.preferredDays.includes(i) ? g.preferredDays.filter(x => x !== i) : [...g.preferredDays, i].sort()})}>${d}</button>`)}</div>
          ${g.preferredDays.length > 0 && g.preferredDays.length < g.daysPerWeek && html`<p class="small" style="color:var(--warn)">Wähle mindestens ${g.daysPerWeek} Tage – sonst werden alle Wochentage genutzt.</p>`}</div>
        <label class="field">Startdatum<input type="date" min=${today()} value=${g.startDate} onChange=${e => set({startDate: e.target.value || today()})} /></label></div>`;
      case "equip": return html`<div class="stack"><h1>Ausstattung & Beschwerden</h1>
        ${EQUIP.map(l => html`<button class=${"opt" + (g.equipment === l.v ? " sel" : "")} onClick=${() => set({equipment: l.v})}><span><div class="ot">${l.t}</div><div class="muted small">${l.d}</div></span></button>`)}
        <label class="opt" style="cursor:pointer"><input type="checkbox" checked=${g.injury} onChange=${e => set({injury: e.target.checked})} style="width:22px;height:22px" /><span><div class="ot">Ich habe Beschwerden / eine Verletzung</div><div class="muted small">Aktiviert den vorsichtigen Modus: Steigerungen nur bei dokumentiertem Schmerzwert 0–1.</div></span></label>
        ${g.injury && html`<label class="field">Kurz beschreiben (optional)<input type="text" maxlength="200" placeholder="z. B. Adduktoren rechts, Knie …" value=${g.limitations} onInput=${e => set({limitations: e.target.value})} /></label>`}</div>`;
      case "fine": return html`<div class="stack"><div><h1>Feinschliff</h1><p class="muted" style="margin-top:6px">Noch ein paar Fragen für einen passgenauen Plan.</p></div>
        <div class="stack"><h3>Krafttraining pro Woche</h3><${Seg} options=${[{value: 0, label: "keins"}, {value: 1, label: "1×"}, {value: 2, label: "2×"}, {value: 3, label: "3×"}, {value: undefined, label: "automatisch"}]} value=${g.strengthPerWeek} onChange=${v => set({strengthPerWeek: v})} /></div>
        ${questions === null ? html`<${Spinner} text="KI stellt passende Rückfragen …" />` : questions.map(q => html`<div class="stack" style="gap:8px"><h3>${q.text}</h3>
          ${Array.isArray(q.options) && q.options.length ? html`<${Seg} options=${q.options.slice(0, 5).map(o => ({value: String(o).slice(0, 40), label: String(o).slice(0, 40)}))} value=${(g.followUps.find(f => f.q === q.text) || {}).a} onChange=${v => answer(q, v)} />`
            : html`<input type="text" maxlength="200" value=${(g.followUps.find(f => f.q === q.text) || {}).a || ""} onInput=${e => answer(q, e.target.value)} />`}</div>`)}</div>`;
      case "preview": {
        if (!preview) return html`<${Spinner} text="Plan wird berechnet …" />`;
        const p = preview.plan;
        const sample = preview.sessions.filter(s => s.week === 1).length ? preview.sessions.filter(s => s.week === 1) : preview.sessions.filter(s => s.week === 0);
        return html`<div class="stack"><div><div class="chip good">Bereit</div><h1 style="margin-top:8px">${coach && coach.title || p.title}</h1>
          <p class="muted" style="margin-top:6px">${preview.plan.startDate && fmtDay(p.startDate)} – ${fmtDay(p.endDate)} · ${preview.plan.meta.phases.reduce((a, x) => a + x.toWeek - x.fromWeek + 1, 0)} Wochen · ${preview.sessions.length} Einheiten</p></div>
          ${coach === null ? html`<div class="card flat stack"><div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:70%"></div></div>` : coach.summary && html`<div class="card flat"><div class="chip" style="margin-bottom:8px">🤖 Dein KI-Coach</div><p>${coach.summary}</p>${coach.tips && coach.tips.length ? html`<ul style="margin:8px 0 0;padding-left:18px" class="small muted">${coach.tips.map(t => html`<li>${t}</li>`)}</ul>` : ""}</div>`}
          ${p.meta.warnings.map(w => html`<div class="banner">${w}</div>`)}
          <div class="stack" style="gap:8px"><h3>Phasen</h3>${p.meta.phases.map(ph => html`<div class="card flat row"><div class="grow"><div class="bold">${ph.name}</div><div class="small muted">${ph.focus}</div></div><span class="chip">${ph.toWeek - ph.fromWeek + 1} Wo.</span></div>`)}</div>
          <div class="stack" style="gap:8px"><h3>Beispielwoche</h3>${sample.map(s => html`<div class="srow"><${IconBox} kind=${s.kind} /><div class="grow"><div class="t">${s.title}</div><div class="small muted">${fmtShort(s.date)} · ${s.durationMin} Min</div></div></div>`)}</div>
          <p class="small muted">Der Plan ist kein starres Korsett: Du kannst Einheiten jederzeit tauschen, verschieben oder auslassen – der Rest der Woche passt sich an.</p></div>`;
      }
    }
  };
  const last = step === steps.length - 1;
  return html`<div class="wiz"><div class="wiz-in">
    <div class="row between">${first ? html`<span></span>` : html`<button class="btn ghost sm" onClick=${onClose} aria-label="Abbrechen">✕ Abbrechen</button>`}<span class="small muted">Schritt ${step + 1} / ${steps.length}</span></div>
    <div class="progressbar" style="margin-top:8px"><i style=${`width:${(step + 1) / steps.length * 100}%`}></i></div>
    <div class="wiz-body">${body()}</div>
    <div class="wiz-foot">${step > 0 && html`<button class="btn" onClick=${() => setStep(s => s - 1)} disabled=${busy}>Zurück</button>`}
      ${last ? html`<button class="btn primary grow" onClick=${create} disabled=${busy || !preview || coach === null}>${busy ? "Wird erstellt …" : "Plan starten"}</button>`
        : html`<button class="btn primary grow" onClick=${next} disabled=${!canNext() || busy}>${busy ? html`<span class="spin"></span> KI liest dein Ziel …` : cur === "goal" && !g.text.trim() ? "Ohne Beschreibung weiter" : "Weiter"}</button>`}</div>
  </div></div>`;
}
