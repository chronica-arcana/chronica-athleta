import {html, useState} from "../../vendor/preact-htm.js";
import {Sheet, Seg, Icon, SportMark, INTENSITY_TXT, Option, Row, fmtNum} from "./common.js";
import * as S from "../store.js";
import {SPORTS, KINDS, kindInfo, kindsOfSport, PICKABLE_SPORTS} from "../../engine/catalog.js";
import {fmtShort, addDays, DAY_SHORT, dow, weekStart} from "../../engine/dates.js";

const ACTION = {increase_weight: ["Mehr Gewicht", "good"], increase_reps: ["Mehr Wiederholungen", "good"], hold: ["Halten", "warn"], reduce: ["Reduzieren", "bad"]};
const targetText = ex => ex.type === "time" ? (ex.nextSeconds != null ? `${ex.nextSeconds} Sek.` : "–") : [ex.nextWeight != null ? `${fmtNum(ex.nextWeight)} kg` : "", ex.nextReps != null ? `${ex.nextReps} Wdh.` : ""].filter(Boolean).join(" × ") || "–";
const tgtLabel = t => t.seconds != null ? t.seconds + " Sek." : [t.weight != null ? fmtNum(t.weight) + " kg" : "", t.reps != null ? t.reps + " Wdh." : ""].filter(Boolean).join(" × ");
const sportOptions = () => PICKABLE_SPORTS.map(s => ({value: s, label: SPORTS[s].label}));

export function AnalysisCard({a, sessionId}) {
  if (!a) return null;
  return html`<div class=${"stack zone " + a.zone}>
    <div class="row between"><span class="label">${a.source === "ki" ? "KI-Coach" : "Coach"}</span>${a.applied ? html`<span class="tag good">im Plan übernommen</span>` : null}</div>
    <h3 style="font-size:1.05rem;line-height:1.4">${a.summary}</h3>
    ${a.aiError && html`<div class="note">KI nicht erreichbar, es wird die Regel-Empfehlung gezeigt. <span class="faint">${a.aiError}</span></div>`}
    ${a.limited && html`<div class="note">Einzelne KI-Vorschläge wurden durch Sicherheitsregeln begrenzt (max. +10 % Gewicht, keine Steigerung bei Schmerz oder hoher Belastung).</div>`}
    ${(a.exercises || []).length > 0 && html`<div>${a.exercises.map(ex => { const [lb, cl] = ACTION[ex.action] || ACTION.hold; return html`<div class="rec"><div class="grow"><div class="bold">${ex.name}</div><div class="small muted">${ex.reason}</div></div>
      <div style="text-align:right;flex:none"><span class=${"tag " + cl}>${lb}</span><div class="small bold" style="margin-top:6px">${targetText(ex)}</div></div></div>`; })}</div>`}
    <div class="stack tight"><span class="label">Nächste Einheiten</span><p class="small">${a.advice}</p></div>
    ${a.tips && a.tips.length ? html`<ul class="small muted" style="margin:0;padding-left:18px">${a.tips.map(t => html`<li>${t}</li>`)}</ul>` : null}
    ${!a.applied && html`<button class="btn primary" onClick=${() => S.applyAnalysis(sessionId)}>In den Plan übernehmen</button>`}
    <p class="tiny faint">Keine medizinische Beratung oder Freigabe. Bei Schmerzen nicht steigern.</p></div>`;
}

export function LogSheet({session, onClose}) {
  const s = session, plan = S.activePlan(), g = S.garminContext(s.date, s.sport), act = g.activities[0];
  const caution = plan && (plan.meta.mode === "return" || (plan.goal && plan.goal.injury)), prev = s.log || {};
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
  const exRows = (s.exercises || []).map((ex, i) => { const t = ex.target; return html`<div class="ex stack tight" key=${i}>
    <div class="row between"><div class="bold">${ex.name}</div><span class="tag">${ex.sets} × ${ex.repMin}${ex.repMax !== ex.repMin ? "–" + ex.repMax : ""}${ex.type === "time" ? " Sek." : ""}</span></div>
    ${t && html`<div class="target">Ziel: ${tgtLabel(t)}</div>`}
    ${Array.from({length: ex.sets}, (_, j) => { const cur = (sets[i] || [])[j] || {};
      return ex.type === "time" ? html`<div class="setgrid" key=${j}><span class="n">${j + 1}</span><input type="number" inputmode="numeric" placeholder=${t && t.seconds ? "Ziel " + t.seconds : "Sek."} value=${cur.seconds ?? ""} onInput=${e => setVal(i, j, "seconds", e.target.value)} /><span class="muted small">Sekunden</span></div>`
        : html`<div class="setgrid" key=${j}><span class="n">${j + 1}</span>${ex.type === "weight" ? html`<input type="text" inputmode="decimal" placeholder=${t && t.weight != null ? "Ziel " + fmtNum(t.weight) + " kg" : "kg"} value=${cur.weight ?? ""} onInput=${e => setVal(i, j, "weight", e.target.value)} />` : html`<span class="muted small">Körpergewicht</span>`}<input type="number" inputmode="numeric" placeholder=${t && t.reps != null ? "Ziel " + t.reps : "Wdh."} value=${cur.reps ?? ""} onInput=${e => setVal(i, j, "reps", e.target.value)} /></div>`; })}</div>`; });
  return html`<${Sheet} title=${result ? "Auswertung" : "Training loggen"} onClose=${onClose}>
    ${result && html`<div class="stack"><${AnalysisCard} a=${S.state.sessions.find(x => x.id === s.id)?.analysis || result} sessionId=${s.id} /><button class="btn primary block" onClick=${onClose}>Fertig</button></div>`}
    ${!result && html`<div class="stack">
      <div><${SportMark} s=${s} /><div class="bold" style="font-size:1.1rem;margin-top:4px">${s.title}</div><div class="small muted">${fmtShort(s.date)} · geplant ${s.durationMin} Min</div></div>
      ${act && html`<div class="note row between"><span>Garmin: ${act.name || act.type}, ${Math.round(act.durationMin)} Min${act.avgHr ? ", Ø " + act.avgHr + " bpm" : ""}</span><button class="btn sm" onClick=${useGarmin}>Übernehmen</button></div>`}
      <div class="grid2"><label class="field">Dauer (Min)<input type="number" inputmode="numeric" value=${dur} onInput=${e => setDur(e.target.value)} /></label>
        ${s.sport !== "strength" && html`<label class="field">Distanz (km)<input type="text" inputmode="decimal" value=${dist} onInput=${e => setDist(e.target.value.replace(",", "."))} /></label>`}</div>
      ${s.sport !== "strength" && html`<label class="field">Ø Puls (optional)<input type="number" inputmode="numeric" value=${hr} onInput=${e => setHr(e.target.value)} /></label>`}
      ${exRows.length > 0 && html`<div class="stack tight"><span class="label">Übungen</span><div>${exRows}</div></div>`}
      ${s.addon && html`<label class="check"><input type="checkbox" checked=${addonDone} onChange=${e => setAddonDone(e.target.checked)} /><span>Kraft-Snack (${s.addon.minutes} Min) gemacht</span></label>`}
      <div class="stack tight"><span class="label">Anstrengung (RPE)</span><div class="rpe">${Array.from({length: 10}, (_, i) => html`<button class=${rpe === i + 1 ? "sel" : ""} onClick=${() => setRpe(i + 1)}>${i + 1}</button>`)}</div><p class="tiny muted">1 sehr leicht · 5 moderat · 8 sehr anstrengend · 10 maximal</p></div>
      <div class="stack tight"><span class="label">Schmerz / Beschwerden${caution ? "" : " (optional)"}</span><div class="rpe" style="grid-template-columns:repeat(11,1fr)">${Array.from({length: 11}, (_, i) => html`<button class=${pain === i ? "sel" : ""} onClick=${() => setPain(i)}>${i}</button>`)}</div><p class="tiny muted">0 = beschwerdefrei. Ohne Wert gibt es im vorsichtigen Modus keine Steigerung.</p></div>
      <label class="field">Notizen<input type="text" maxlength="300" placeholder="Gefühl, Beschwerden, Wetter" value=${notes} onInput=${e => setNotes(e.target.value)} /></label>
      <button class="btn primary block" onClick=${submit} disabled=${busy}>${busy ? html`<span class="spin"></span> Wird ausgewertet` : "Abschließen & Empfehlung"}</button></div>`}
  <//>`;
}

export function SwapSheet({session, onClose}) {
  const [sport, setSport] = useState(session.sport === "event" ? "run" : session.sport), [kind, setKind] = useState(null), [min, setMin] = useState(null);
  const kinds = kindsOfSport(sport), chosen = kind && kinds.includes(kind) ? kind : kinds[0], info = kindInfo(chosen);
  const eq = Math.max(15, Math.round(session.load / info.loadPerMin / 5) * 5), minutes = min ?? Math.min(eq, Math.round(session.durationMin * 1.3 / 5) * 5);
  return html`<${Sheet} title="Etwas anderes machen" onClose=${onClose}><div class="stack">
    <p class="muted small">Statt „${session.title}“. Der Rest der Woche passt sich an; ausgefallene Kraft wird später als kurzer Snack nachgeholt.</p>
    <${Seg} options=${sportOptions()} value=${sport} onChange=${v => { setSport(v); setKind(null); setMin(null); }} />
    <div class="choices">${kinds.map(k => html`<${Option} sel=${chosen === k} onClick=${() => { setKind(k); setMin(null); }}><div class="ot">${KINDS[k].label}</div><div class="tiny muted">${INTENSITY_TXT[KINDS[k].intensity]}</div><//>`)}</div>
    <label class="field"><span>Dauer: <b style="color:var(--text)">${minutes} Min</b> · gleiche Belastung ≈ ${eq} Min</span><input type="range" min="15" max="180" step="5" value=${minutes} onInput=${e => setMin(+e.target.value)} /></label>
    <button class="btn primary block" onClick=${async () => { await S.swap(session.id, chosen, minutes); onClose(); }}>Tauschen</button></div><//>`;
}
export function MoveSheet({session, onClose}) {
  const t = S.today(), days = Array.from({length: 21}, (_, i) => addDays(t, i));
  return html`<${Sheet} title="Verschieben auf" onClose=${onClose}><div class="grid2">${days.map(d => html`<${Option} compact=${true} sel=${d === session.date} onClick=${async () => { await S.move(session.id, d); onClose(); }}>${fmtShort(d)}<//>`)}</div><//>`;
}
export function AddSheet({date, onClose}) {
  const [sport, setSport] = useState("run"), [kind, setKind] = useState(null), [d, setD] = useState(date || S.today()), [min, setMin] = useState(40), [done, setDone] = useState(false);
  const kinds = kindsOfSport(sport), chosen = kind && kinds.includes(kind) ? kind : kinds[0];
  return html`<${Sheet} title="Training hinzufügen" onClose=${onClose}><div class="stack">
    <p class="muted small">Etwas Spontanes gemacht oder vor? Der Plan gleicht die Wochenbelastung automatisch aus.</p>
    <${Seg} options=${sportOptions()} value=${sport} onChange=${v => { setSport(v); setKind(null); }} />
    <div class="choices">${kinds.map(k => html`<${Option} sel=${chosen === k} onClick=${() => setKind(k)}><div class="ot">${KINDS[k].label}</div><div class="tiny muted">${INTENSITY_TXT[KINDS[k].intensity]}</div><//>`)}</div>
    <div class="grid2"><label class="field">Datum<input type="date" value=${d} onChange=${e => setD(e.target.value)} /></label><label class="field">Dauer (Min)<input type="number" inputmode="numeric" min="5" max="400" value=${min} onInput=${e => setMin(+e.target.value)} /></label></div>
    <label class="check"><input type="checkbox" checked=${done} onChange=${e => setDone(e.target.checked)} /><span>Schon erledigt</span></label>
    <button class="btn primary block" onClick=${async () => { await S.addSession({date: d, kind: chosen, minutes: min, done, log: done ? {durationMin: min} : null}); onClose(); }}>Hinzufügen</button></div><//>`;
}
export function AvailabilitySheet({ws, onClose}) {
  const t = S.today(), sess = S.planSessions().filter(s => weekStart(s.date) === ws && s.status === "planned" && s.date >= t);
  const [sel, setSel] = useState(() => [...new Set(sess.map(s => dow(s.date)))]);
  const days = DAY_SHORT.map((d, i) => ({i, d, date: addDays(ws, i), past: addDays(ws, i) < t}));
  return html`<${Sheet} title="Woche anpassen" onClose=${onClose}><div class="stack">
    <p class="muted small">An welchen Tagen kannst du trainieren? ${sess.length} Einheit(en) sind noch offen. Wichtige Einheiten bleiben, weniger wichtige entfallen bei Platzmangel.</p>
    <div class="weekstrip">${days.map(d => html`<button class=${"wd" + (sel.includes(d.i) ? " sel" : "")} disabled=${d.past} style=${d.past ? "opacity:.35" : ""} onClick=${() => setSel(p => p.includes(d.i) ? p.filter(x => x !== d.i) : [...p, d.i])}><span>${d.d}</span><span class="n" style=${sel.includes(d.i) ? "background:var(--ink);color:var(--on-ink)" : ""}>${+d.date.slice(8)}</span></button>`)}</div>
    <button class="btn primary block" disabled=${sel.length === 0} onClick=${async () => { await S.availability(ws, sel); onClose(); }}>Woche neu verteilen</button></div><//>`;
}

export function SessionSheet({id, onClose}) {
  const s = S.state.sessions.find(x => x.id === id); if (!s) return null;
  const [sub, setSub] = useState(null);
  const isDone = s.status === "done", skipped = s.status === "skipped";
  if (sub === "log") return html`<${LogSheet} session=${s} onClose=${() => setSub(null)} />`;
  if (sub === "swap") return html`<${SwapSheet} session=${s} onClose=${onClose} />`;
  if (sub === "move") return html`<${MoveSheet} session=${s} onClose=${onClose} />`;
  const act = fn => async () => { await fn(); onClose(); };
  return html`<${Sheet} onClose=${onClose}><div class="stack">
    <div><${SportMark} s=${s} /><h2 style="margin-top:6px">${s.title}</h2>
      <div class="meta" style="margin-top:4px">${fmtShort(s.date)} · ${s.durationMin} Min${s.addon ? ` + ${s.addon.minutes} Min Kraft` : ""} · ${INTENSITY_TXT[s.intensity]}${isDone ? " · erledigt" : skipped ? " · ausgelassen" : ""}</div>
      ${(s.origKind && s.origKind !== s.kind) || (s.locked && !isDone) ? html`<div class="tiny faint" style="margin-top:4px">${s.origKind && s.origKind !== s.kind ? "Getauscht, ursprünglich: " + kindInfo(s.origKind).label + ". " : ""}${s.locked && !isDone ? "Von dir festgelegt." : ""}</div>` : null}</div>
    ${s.auto && html`<div class="note">Angepasst: ${s.auto.reason}</div>`}
    ${(s.blocks || []).map(b => html`<div class="block"><b>${b.label}</b><span>${b.text}</span></div>`)}
    ${(s.flow || []).length > 0 && html`<div class="stack tight"><span class="label">Ablauf</span><div>${s.flow.map(p => html`<div class="ex"><div class="row between"><div class="bold">${p.name}</div><span class="tag">${p.label}</span></div><div class="small muted">${p.cue}</div></div>`)}</div></div>`}
    ${(s.exercises || []).length > 0 && html`<div class="stack tight"><span class="label">Übungen</span><div>${s.exercises.map(e => html`<div class="ex"><div class="row between"><div class="bold">${e.name}</div><span class="tag">${e.sets} × ${e.repMin}${e.repMax !== e.repMin ? "–" + e.repMax : ""}${e.type === "time" ? " Sek." : ""}</span></div><div class="small muted">${e.cue}</div>${e.target && html`<div class="target">Ziel: ${tgtLabel(e.target)}</div>`}</div>`)}</div></div>`}
    ${s.addon && s.addon.exercises && html`<div class="stack tight"><span class="label">Kraft-Snack · ${s.addon.minutes} Min</span><div>${s.addon.exercises.map(e => html`<div class="ex"><div class="bold">${e.name}</div><div class="small muted">${e.sets} × ${e.repMin}–${e.repMax} · ${e.cue}</div></div>`)}</div></div>`}
    ${isDone && s.analysis && html`<${AnalysisCard} a=${s.analysis} sessionId=${s.id} />`}
    ${!skipped && html`<button class="btn primary block" onClick=${() => setSub("log")}>${isDone ? "Log ansehen oder ändern" : "Training loggen"}</button>`}
    ${!isDone && !skipped && html`<div class="list"><${Row} title="Etwas anderes machen" onClick=${() => setSub("swap")} /><${Row} title="Verschieben" onClick=${() => setSub("move")} />
      <${Row} title="Kürzer" sub="Dauer um 25 % verringern" onClick=${act(() => S.scale(s.id, 0.75))} /><${Row} title="Länger" sub="Dauer um 25 % erhöhen" onClick=${act(() => S.scale(s.id, 1.25))} />
      <${Row} title="Auslassen" danger=${true} onClick=${act(() => S.skip(s.id))} /></div>`}
    ${skipped && html`<button class="btn block" onClick=${act(() => S.restore(s.id))}>Wieder einplanen</button>`}
    ${s.source === "adhoc" || s.source === "garmin" ? html`<button class="btn ghost danger" style="align-self:flex-start" onClick=${act(() => S.remove(s.id))}>Eintrag löschen</button>` : null}</div><//>`;
}
