import {html, useState, useMemo} from "../../vendor/preact-htm.js";
import {Sheet, Seg, IconBox, IntensityChip, statusChip, Spinner, fmtNum} from "./common.js";
import * as S from "../store.js";
import {SPORTS, KINDS, kindInfo, kindsOfSport, PICKABLE_SPORTS} from "../../engine/catalog.js";
import {fmtShort, fmtDay, addDays, DAY_SHORT, dow, weekStart} from "../../engine/dates.js";

const ACTION = {increase_weight: ["⬆", "Mehr Gewicht", "good"], increase_reps: ["➕", "Mehr Wiederholungen", "good"], hold: ["⏸", "Halten", "warn"], reduce: ["⬇", "Reduzieren", "bad"]};
const targetText = ex => ex.type === "time" ? (ex.nextSeconds != null ? `${ex.nextSeconds} Sek.` : "–") : [ex.nextWeight != null ? `${fmtNum(ex.nextWeight)} kg` : "", ex.nextReps != null ? `${ex.nextReps} Wdh.` : ""].filter(Boolean).join(" × ") || "–";

export function AnalysisCard({a, sessionId}) {
  if (!a) return null;
  const apply = () => S.applyAnalysis(sessionId);
  return html`<div class=${"card flat stack zone-" + a.zone}>
    <div class="row between"><span class="chip">${a.source === "ki" ? "🤖 KI-Coach" : "📏 Regel-Coach"}</span>${a.applied ? html`<span class="chip good">✓ im Plan übernommen</span>` : null}</div>
    <h3>${a.summary}</h3>
    ${a.aiError && html`<div class="banner small">KI nicht erreichbar – Regel-Empfehlung wird gezeigt. <span class="muted">${a.aiError}</span></div>`}
    ${a.limited && html`<div class="banner info small">Einzelne KI-Vorschläge wurden durch Sicherheitsregeln begrenzt (max. +10 % Gewicht, keine Steigerung bei Schmerz/hoher Belastung).</div>`}
    ${(a.exercises || []).map(ex => { const [ic, lb, cl] = ACTION[ex.action] || ACTION.hold; return html`<div class="rec"><div class="grow"><div class="bold">${ex.name}</div><div class="small muted">${ex.reason}</div></div>
      <div style="text-align:right"><span class=${"chip " + cl}>${ic} ${lb}</span><div class="small bold" style="margin-top:4px">Nächstes Mal: ${targetText(ex)}</div></div></div>`; })}
    <div><div class="bold small">Nächste Einheiten</div><p class="small muted">${a.advice}</p></div>
    ${a.tips && a.tips.length ? html`<ul class="small muted" style="margin:0;padding-left:18px">${a.tips.map(t => html`<li>${t}</li>`)}</ul>` : null}
    ${!a.applied && html`<button class="btn primary" onClick=${apply}>Anpassung in den Plan übernehmen</button>`}
    <p class="tiny muted">Keine medizinische Beratung oder Freigabe – bei Schmerzen nicht steigern.</p></div>`;
}

export function LogSheet({session, onClose}) {
  const s = session, info = kindInfo(s.kind), plan = S.activePlan();
  const g = S.garminContext(s.date, s.sport), act = g.activities[0];
  const caution = plan && (plan.meta.mode === "return" || (plan.goal && plan.goal.injury));
  const prev = s.log || {};
  const [dur, setDur] = useState(prev.durationMin ?? s.durationMin), [dist, setDist] = useState(prev.distanceKm ?? ""), [hr, setHr] = useState(prev.avgHr ?? "");
  const [rpe, setRpe] = useState(prev.rpe ?? null), [pain, setPain] = useState(prev.pain ?? (caution ? null : 0)), [notes, setNotes] = useState(prev.notes || "");
  const [sets, setSets] = useState(() => prev.sets || {}), [busy, setBusy] = useState(false), [result, setResult] = useState(null);
  const [garminId, setGarminId] = useState(prev.garminActivityId || null), [addonDone, setAddonDone] = useState(!!prev.addonDone);
  const setVal = (i, j, k, v) => setSets(p => { const arr = (p[i] || []).slice(); arr[j] = {...(arr[j] || {}), [k]: v}; return {...p, [i]: arr}; });
  const useGarmin = () => { setDur(Math.round(act.durationMin || dur)); if (act.distanceKm) setDist(act.distanceKm); if (act.avgHr) setHr(act.avgHr); setGarminId(act.id); S.toast("Garmin-Daten übernommen.", "info"); };
  const submit = async () => {
    setBusy(true);
    const clean = {}; Object.entries(sets).forEach(([i, arr]) => { clean[i] = arr.filter(x => x && (x.reps || x.seconds)); });
    const log = {durationMin: Number(dur) || s.durationMin, distanceKm: dist === "" ? null : Number(dist), avgHr: hr === "" ? null : Number(hr), rpe, pain, notes: notes.trim(), sets: clean, garminActivityId: garminId, addonDone: !!(s.addon && addonDone)};
    try { setResult(await S.finishSession(s.id, log)); } catch (e) { S.toast(e.message, "error"); }
    setBusy(false);
  };
  const exRows = (s.exercises || []).map((ex, i) => { const n = ex.sets, t = ex.target; return html`<div class="ex stack" style="gap:6px" key=${i}>
    <div class="row between"><div class="bold">${ex.name}</div><span class="chip">${ex.sets} × ${ex.repMin}${ex.repMax !== ex.repMin ? "–" + ex.repMax : ""}${ex.type === "time" ? " Sek." : ""}</span></div>
    ${t && html`<div class="target">🎯 Ziel: ${ex.type === "time" ? (t.seconds != null ? t.seconds + " Sek." : "") : [t.weight != null ? fmtNum(t.weight) + " kg" : "", t.reps != null ? t.reps + " Wdh." : ""].filter(Boolean).join(" × ")}</div>`}
    ${Array.from({length: n}, (_, j) => { const cur = (sets[i] || [])[j] || {};
      return ex.type === "time" ? html`<div class="setgrid" key=${j}><span class="n">${j + 1}</span><input type="number" inputmode="numeric" placeholder=${t && t.seconds ? "Ziel " + t.seconds : "Sek."} value=${cur.seconds ?? ""} onInput=${e => setVal(i, j, "seconds", e.target.value)} /><span class="muted small">Sekunden</span></div>`
        : html`<div class="setgrid" key=${j}><span class="n">${j + 1}</span>${ex.type === "weight" ? html`<input type="text" inputmode="decimal" placeholder=${t && t.weight != null ? "Ziel " + fmtNum(t.weight) + " kg" : "kg"} value=${cur.weight ?? ""} onInput=${e => setVal(i, j, "weight", e.target.value)} />` : html`<span class="muted small">Körpergewicht</span>`}<input type="number" inputmode="numeric" placeholder=${t && t.reps != null ? "Ziel " + t.reps : "Wdh."} value=${cur.reps ?? ""} onInput=${e => setVal(i, j, "reps", e.target.value)} /></div>`; })}</div>`; });
  return html`<${Sheet} title=${result ? "Auswertung" : "Training loggen"} onClose=${onClose}>
    ${result && html`<div class="stack"><${AnalysisCard} a=${S.state.sessions.find(x => x.id === s.id)?.analysis || result} sessionId=${s.id} /><button class="btn primary block" onClick=${onClose}>Fertig</button></div>`}
    ${!result && html`<div class="stack">
      <div class="row"><${IconBox} kind=${s.kind} /><div class="grow"><div class="bold">${s.title}</div><div class="small muted">${fmtShort(s.date)} · geplant ${s.durationMin} Min</div></div></div>
      ${act && html`<div class="banner info row between"><span class="small">⌚ Garmin: ${act.name || act.type}, ${Math.round(act.durationMin)} Min${act.avgHr ? ", Ø " + act.avgHr + " bpm" : ""}</span><button class="btn sm" onClick=${useGarmin}>Übernehmen</button></div>`}
      <div class="grid2"><label class="field">Dauer (Min)<input type="number" inputmode="numeric" value=${dur} onInput=${e => setDur(e.target.value)} /></label>
        ${s.sport !== "strength" && html`<label class="field">Distanz (km)<input type="text" inputmode="decimal" value=${dist} onInput=${e => setDist(e.target.value.replace(",", "."))} /></label>`}</div>
      ${s.sport !== "strength" && html`<label class="field">Ø Puls (optional)<input type="number" inputmode="numeric" value=${hr} onInput=${e => setHr(e.target.value)} /></label>`}
      ${exRows}
      ${s.addon && html`<label class="opt" style="cursor:pointer"><input type="checkbox" style="width:22px;height:22px" checked=${addonDone} onChange=${e => setAddonDone(e.target.checked)} /><span class="ot">Kraft-Snack (${s.addon.minutes} Min) gemacht</span></label>`}
      <div class="stack" style="gap:8px"><h3>Anstrengung (RPE)</h3><div class="rpe">${Array.from({length: 10}, (_, i) => html`<button class=${rpe === i + 1 ? "sel" : ""} onClick=${() => setRpe(i + 1)}>${i + 1}</button>`)}</div><p class="tiny muted">1 = sehr leicht · 5 = moderat · 8 = sehr anstrengend · 10 = maximal</p></div>
      <div class="stack" style="gap:8px"><h3>Schmerz / Beschwerden ${caution ? "" : html`<span class="muted small">(optional)</span>`}</h3><div class="rpe" style="grid-template-columns:repeat(11,1fr)">${Array.from({length: 11}, (_, i) => html`<button class=${pain === i ? "sel" : ""} onClick=${() => setPain(i)}>${i}</button>`)}</div><p class="tiny muted">0 = beschwerdefrei. Ohne Wert gibt es im vorsichtigen Modus keine Steigerung.</p></div>
      <label class="field">Notizen<input type="text" maxlength="300" placeholder="Gefühl, Beschwerden, Wetter …" value=${notes} onInput=${e => setNotes(e.target.value)} /></label>
      <button class="btn primary block" onClick=${submit} disabled=${busy}>${busy ? html`<span class="spin"></span> Wird ausgewertet …` : "Abschließen & Empfehlung"}</button></div>`}
  <//>`;
}

export function SwapSheet({session, onClose}) {
  const [sport, setSport] = useState(session.sport === "event" ? "run" : session.sport), [kind, setKind] = useState(null), [min, setMin] = useState(null);
  const kinds = kindsOfSport(sport);
  const chosen = kind && kinds.includes(kind) ? kind : kinds[0];
  const info = kindInfo(chosen), eq = Math.max(15, Math.round(session.load / info.loadPerMin / 5) * 5);
  const minutes = min ?? Math.min(eq, Math.round(session.durationMin * 1.3 / 5) * 5);
  const go = async () => { await S.swap(session.id, chosen, minutes); onClose(); };
  return html`<${Sheet} title="Etwas anderes machen" onClose=${onClose}><div class="stack">
    <p class="muted small">Heute lieber etwas anderes als „${session.title}“? Wähle – der Rest der Woche passt sich an. Ausgefallene Kraft wird später als kurzer Snack nachgeholt.</p>
    <${Seg} options=${PICKABLE_SPORTS.map(s => ({value: s, label: SPORTS[s].label, icon: SPORTS[s].icon}))} value=${sport} onChange=${v => { setSport(v); setKind(null); setMin(null); }} />
    <div class="stack" style="gap:8px">${kinds.map(k => html`<button class=${"opt" + (chosen === k ? " sel" : "")} onClick=${() => { setKind(k); setMin(null); }}><span style="font-size:1.5rem">${KINDS[k].icon}</span><span class="grow"><div class="ot">${KINDS[k].label}</div></span><${IntensityChip} v=${KINDS[k].intensity} /></button>`)}</div>
    <label class="field">Dauer: <b style="color:var(--text)">${minutes} Min</b> <span class="small">(≈ gleiche Belastung: ${eq} Min)</span><input type="range" min="15" max="180" step="5" value=${minutes} onInput=${e => setMin(+e.target.value)} /></label>
    <button class="btn primary block" onClick=${go}>Tauschen</button></div><//>`;
}
export function MoveSheet({session, onClose}) {
  const t = S.today(), days = Array.from({length: 21}, (_, i) => addDays(t, i));
  return html`<${Sheet} title="Verschieben auf …" onClose=${onClose}><div class="stack"><div class="grid2">${days.map(d => html`<button class=${"opt" + (d === session.date ? " sel" : "")} onClick=${async () => { await S.move(session.id, d); onClose(); }}><span class="ot small">${fmtShort(d)}</span></button>`)}</div></div><//>`;
}
export function AddSheet({date, onClose}) {
  const [sport, setSport] = useState("run"), [kind, setKind] = useState(null), [d, setD] = useState(date || S.today()), [min, setMin] = useState(40), [done, setDone] = useState(false);
  const kinds = kindsOfSport(sport), chosen = kind && kinds.includes(kind) ? kind : kinds[0];
  const go = async () => { await S.addSession({date: d, kind: chosen, minutes: min, done, log: done ? {durationMin: min} : null}); onClose(); };
  return html`<${Sheet} title="Training hinzufügen" onClose=${onClose}><div class="stack">
    <p class="muted small">Etwas Spontanes gemacht oder vor? Trag es ein – der Plan gleicht die Wochenbelastung automatisch aus.</p>
    <${Seg} options=${PICKABLE_SPORTS.map(s => ({value: s, label: SPORTS[s].label, icon: SPORTS[s].icon}))} value=${sport} onChange=${v => { setSport(v); setKind(null); }} />
    <div class="stack" style="gap:8px">${kinds.map(k => html`<button class=${"opt" + (chosen === k ? " sel" : "")} onClick=${() => setKind(k)}><span style="font-size:1.5rem">${KINDS[k].icon}</span><span class="grow ot">${KINDS[k].label}</span><${IntensityChip} v=${KINDS[k].intensity} /></button>`)}</div>
    <div class="grid2"><label class="field">Datum<input type="date" value=${d} onChange=${e => setD(e.target.value)} /></label><label class="field">Dauer (Min)<input type="number" inputmode="numeric" min="5" max="400" value=${min} onInput=${e => setMin(+e.target.value)} /></label></div>
    <label class="opt" style="cursor:pointer"><input type="checkbox" style="width:22px;height:22px" checked=${done} onChange=${e => setDone(e.target.checked)} /><span class="ot">Schon erledigt</span></label>
    <button class="btn primary block" onClick=${go}>Hinzufügen</button></div><//>`;
}
export function AvailabilitySheet({ws, onClose}) {
  const t = S.today(), sess = S.planSessions().filter(s => weekStart(s.date) === ws && s.status === "planned" && s.date >= t);
  const [sel, setSel] = useState(() => { const set = new Set(sess.map(s => dow(s.date))); return [...set]; });
  const days = DAY_SHORT.map((d, i) => ({i, d, date: addDays(ws, i), past: addDays(ws, i) < t}));
  const go = async () => { await S.availability(ws, sel); onClose(); };
  return html`<${Sheet} title="Diese Woche anpassen" onClose=${onClose}><div class="stack">
    <p class="muted small">An welchen Tagen kannst du trainieren? ${sess.length} Einheit(en) sind noch offen. Wichtige Einheiten (lang, intensiv) bleiben, weniger wichtige entfallen bei Platzmangel.</p>
    <div class="weekstrip">${days.map(d => html`<button class=${"day" + (sel.includes(d.i) ? " sel" : "")} disabled=${d.past} style=${d.past ? "opacity:.35" : ""} onClick=${() => setSel(p => p.includes(d.i) ? p.filter(x => x !== d.i) : [...p, d.i])}><span>${d.d}</span><span class="n">${+d.date.slice(8)}</span><span class="mk">${sel.includes(d.i) ? "✓" : ""}</span></button>`)}</div>
    <button class="btn primary block" onClick=${go} disabled=${sel.length === 0}>Woche neu verteilen</button></div><//>`;
}

export function SessionSheet({id, onClose}) {
  const s = S.state.sessions.find(x => x.id === id); if (!s) return null;
  const [sub, setSub] = useState(null);
  const info = kindInfo(s.kind), isDone = s.status === "done", skipped = s.status === "skipped", past = s.date < S.today();
  if (sub === "log") return html`<${LogSheet} session=${s} onClose=${() => { setSub(null); }} />`;
  if (sub === "swap") return html`<${SwapSheet} session=${s} onClose=${onClose} />`;
  if (sub === "move") return html`<${MoveSheet} session=${s} onClose=${onClose} />`;
  const act = (fn) => async () => { await fn(); onClose(); };
  return html`<${Sheet} onClose=${onClose}><div class="stack">
    <div class="row"><${IconBox} kind=${s.kind} /><div class="grow"><h2>${s.title}</h2><div class="small muted">${fmtShort(s.date)} · ${s.durationMin} Min${s.addon ? ` + ${s.addon.minutes} Min Kraft` : ""}</div></div></div>
    <div class="row wrap"><${IntensityChip} v=${s.intensity} />${statusChip(s)}${s.origKind && s.origKind !== s.kind && html`<span class="chip">getauscht (war: ${kindInfo(s.origKind).label})</span>`}${s.locked && !isDone ? html`<span class="chip">🔒 von dir festgelegt</span>` : null}</div>
    ${(s.blocks || []).map(b => html`<div class="block"><b>${b.label}</b>${b.text}</div>`)}
    ${(s.exercises || []).length > 0 && html`<div class="stack" style="gap:8px"><h3>Übungen</h3>${s.exercises.map(e => html`<div class="ex"><div class="row between"><div class="bold">${e.name}</div><span class="chip">${e.sets} × ${e.repMin}${e.repMax !== e.repMin ? "–" + e.repMax : ""}${e.type === "time" ? " Sek." : ""}</span></div><div class="small muted">${e.cue}</div>${e.target && html`<div class="target">🎯 Ziel: ${e.type === "time" ? (e.target.seconds != null ? e.target.seconds + " Sek." : "") : [e.target.weight != null ? fmtNum(e.target.weight) + " kg" : "", e.target.reps != null ? e.target.reps + " Wdh." : ""].filter(Boolean).join(" × ")}</div>`}</div>`)}</div>`}
    ${s.addon && s.addon.exercises && html`<div class="stack" style="gap:8px"><h3>Kraft-Snack (${s.addon.minutes} Min)</h3>${s.addon.exercises.map(e => html`<div class="ex"><div class="bold">${e.name}</div><div class="small muted">${e.sets} × ${e.repMin}–${e.repMax} · ${e.cue}</div></div>`)}</div>`}
    ${isDone && s.analysis && html`<${AnalysisCard} a=${s.analysis} sessionId=${s.id} />`}
    <div class="stack" style="gap:8px">
      ${!skipped && html`<button class="btn primary block" onClick=${() => setSub("log")}>${isDone ? "Log ansehen / ändern" : "✓ Erledigt – loggen"}</button>`}
      ${!isDone && !skipped && html`<div class="grid2"><button class="btn" onClick=${() => setSub("swap")}>🔄 Anderes Training</button><button class="btn" onClick=${() => setSub("move")}>📅 Verschieben</button>
        <button class="btn" onClick=${act(() => S.scale(s.id, 0.75))}>➖ Kürzer</button><button class="btn" onClick=${act(() => S.scale(s.id, 1.25))}>➕ Länger</button></div>
        <button class="btn danger block" onClick=${act(() => S.skip(s.id))}>Heute auslassen / Ruhetag</button>`}
      ${skipped && html`<button class="btn block" onClick=${act(() => S.restore(s.id))}>↩ Wieder einplanen</button>`}
      ${s.source === "adhoc" || s.source === "garmin" ? html`<button class="btn ghost danger block" onClick=${act(() => S.remove(s.id))}>Eintrag löschen</button>` : null}</div></div><//>`;
}
