import {html, useState, useMemo, useEffect} from "../../vendor/preact-htm.js";
import {IconBox, IntensityChip, statusChip, Spinner, Seg, fmtNum, Sheet} from "./common.js";
import * as S from "../store.js";
import {SPORTS, kindInfo} from "../../engine/catalog.js";
import {fmtShort, fmtDay, addDays, weekStart, DAY_SHORT, dow, diffDays, DAY_LONG} from "../../engine/dates.js";
import {recoveryFlags, sportOfActivity} from "../../engine/garmin.js";

const weekOf = (plan, t) => Math.floor(diffDays(weekStart(t), weekStart(plan.startDate)) / 7);
const phaseAt = (plan, idx) => plan.meta.phases.find(p => idx >= p.fromWeek && idx <= p.toWeek) || plan.meta.phases[plan.meta.phases.length - 1];
const weekLoads = (plan, sessions, ws) => {
  const all = sessions.filter(s => weekStart(s.date) === ws);
  const done = all.filter(s => s.status === "done").reduce((a, s) => a + S.A.actualLoad(s), 0);
  const planned = all.filter(s => s.status === "planned").reduce((a, s) => a + s.load, 0);
  return {done, planned, target: plan.meta.weekTargets[ws] ?? done + planned, all};
};
const DEFAULT_KIND = {run: "run_easy", bike: "bike_easy", swim: "swim_endurance", strength: "strength_full", football: "football_skills", cardio: "cardio_easy", mobility: "mobility", walk: "walk"};

function SessionRow({s, onOpen, showDate}) {
  return html`<button class=${"srow " + s.status} onClick=${() => onOpen(s.id)} style="width:100%;text-align:left"><${IconBox} kind=${s.kind} />
    <div class="grow"><div class="t">${s.title}</div><div class="small muted">${showDate ? fmtShort(s.date) + " · " : ""}${s.durationMin} Min${s.addon ? ` + ${s.addon.minutes} Kraft` : ""}</div></div>
    ${s.status === "done" ? html`<span class="chip good">✓</span>` : s.status === "skipped" ? html`<span class="chip">–</span>` : html`<${IntensityChip} v=${s.intensity} />`}</button>`;
}
function LoadBar({done, planned, target}) {
  const max = Math.max(target * 1.2, done + planned, 1);
  return html`<div class="stack" style="gap:6px"><div class="bar"><i style=${`width:${Math.min(100, done / max * 100)}%`}></i><span class="tick" style=${`left:${Math.min(100, target / max * 100)}%`}></span></div>
    <div class="row between tiny muted"><span>Erledigt ${Math.round(done)}</span><span>Wochenziel ${Math.round(target)}</span></div></div>`;
}

export function Empty({onWizard}) {
  return html`<div class="screen stack"><div class="card hero stack"><div style="font-size:2.4rem">🚀</div><h1>Los geht's!</h1><p class="muted">Erstelle deinen ersten Trainingsplan – für dein Ziel, deine Sportarten und deinen Alltag.</p><button class="btn primary" onClick=${onWizard}>Plan erstellen</button></div></div>`;
}

export function Today({onOpen, onAdd, onWizard}) {
  const plan = S.activePlan(); if (!plan) return html`<${Empty} onWizard=${onWizard} />`;
  const t = S.today(), sessions = S.planSessions(), ws = weekStart(t), idx = weekOf(plan, t), ph = phaseAt(plan, Math.max(0, idx));
  const todays = sessions.filter(s => s.date === t), openToday = todays.filter(s => s.status === "planned"), doneToday = todays.filter(s => s.status === "done");
  const lw = weekLoads(plan, sessions, ws), upcoming = sessions.filter(s => s.date > t && s.status === "planned").slice(0, 3);
  const rec = recoveryFlags(S.state.garmin.daily, t), hasG = S.state.garmin.daily.length > 0;
  const sugg = S.garminSuggestions().slice(0, 2);
  const [selDay, setSelDay] = useState(t);
  const days = Array.from({length: 7}, (_, i) => addDays(ws, i));
  const hero = openToday[0];
  const importAct = async a => { const sport = sportOfActivity(a.type);
    await S.addSession({date: a.date, kind: DEFAULT_KIND[sport] || "cardio_easy", minutes: Math.round(a.durationMin), done: true, source: "garmin", log: {durationMin: Math.round(a.durationMin), avgHr: a.avgHr, distanceKm: a.distanceKm, garminActivityId: a.id}}); };
  const hello = new Date().getHours() < 12 ? "Guten Morgen" : new Date().getHours() < 18 ? "Hallo" : "Guten Abend";
  return html`<div class="screen stack">
    <div><p class="muted small">${DAY_LONG[dow(t)]}, ${fmtDay(t)}</p><h1>${hello} 👋</h1></div>
    <div class="row wrap"><span class="chip">📋 ${plan.title}</span><span class="chip">Woche ${Math.max(1, idx + 1)} · ${ph.name}</span>
      ${hasG && html`<span class=${"chip " + (rec.flags.length >= 2 ? "bad" : rec.flags.length ? "warn" : "good")}>⌚ ${rec.data ? (rec.flags.length ? rec.flags.length + " Erholungs-Hinweis(e)" : "Erholung gut") : "Garmin verbunden"}</span>`}</div>
    ${rec.flags.length > 0 && html`<div class="banner small">⌚ ${rec.flags.join(" · ")}. Gehe es heute eher locker an – der Coach bremst Steigerungen automatisch.</div>`}
    ${hero ? html`<div class="card hero stack"><div class="row"><div class="icon-box" style="background:rgba(255,255,255,.22)">${kindInfo(hero.kind).icon}</div><div class="grow"><div class="small muted">Heute geplant</div><h2>${hero.title}</h2></div></div>
        <div class="row wrap"><span class="chip">${hero.durationMin} Min${hero.addon ? " + " + hero.addon.minutes + " Kraft" : ""}</span><span class="chip">${(hero.intensity === "easy" ? "locker" : hero.intensity === "moderate" ? "moderat" : "hart")}</span>${hero.exercises && hero.exercises.length ? html`<span class="chip">${hero.exercises.length} Übungen</span>` : null}</div>
        <p style="color:rgba(255,255,255,.92)" class="small">${(hero.blocks.find(b => /Haupt|Plan|Flow|Einheit/.test(b.label)) || hero.blocks[0] || {}).text || ""}</p>
        <div class="row wrap"><button class="btn primary grow" onClick=${() => onOpen(hero.id, "log")}>✓ Erledigt – loggen</button><button class="btn" onClick=${() => onOpen(hero.id)}>Details</button></div>
        <div class="grid2"><button class="btn sm" onClick=${() => onOpen(hero.id, "swap")}>🔄 Etwas anderes</button><button class="btn sm" onClick=${() => onOpen(hero.id, "move")}>📅 Verschieben</button></div></div>`
      : doneToday.length ? html`<div class="card stack"><div class="chip good">✓ Heute erledigt</div>${doneToday.map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`)}<p class="small muted">Stark! Der Coach hat die Woche neu ausgerichtet.</p></div>`
      : html`<div class="card stack"><div class="row"><span style="font-size:2rem">😴</span><div class="grow"><h2>Ruhetag</h2><p class="muted small">Heute ist nichts geplant. Erholung gehört zum Training.</p></div></div><button class="btn" onClick=${() => onAdd(t)}>Trotzdem trainieren</button></div>`}
    ${sugg.map(a => html`<div class="card flat row"><span style="font-size:1.4rem">⌚</span><div class="grow"><div class="bold small">Neu von Garmin: ${a.name || a.type}</div><div class="tiny muted">${fmtShort(a.date)} · ${Math.round(a.durationMin)} Min${a.avgHr ? " · Ø " + a.avgHr + " bpm" : ""}</div></div><button class="btn sm primary" onClick=${() => importAct(a)}>Übernehmen</button></div>`)}
    <div class="card stack"><div class="row between"><h3>Diese Woche</h3><span class="tiny muted">${ph.name}</span></div>
      <div class="weekstrip">${days.map(d => { const ss = sessions.filter(s => s.date === d); const done = ss.length && ss.every(s => s.status !== "planned" && s.status === "done");
        return html`<button class=${"day" + (d === t ? " today" : "") + (d === selDay ? " sel" : "") + (done ? " done" : "")} onClick=${() => setSelDay(d)}><span>${DAY_SHORT[dow(d)]}</span><span class="n">${+d.slice(8)}</span><span class="mk">${ss.length ? (done ? "✓" : ss.some(s => s.status === "skipped") && !ss.some(s => s.status === "planned") ? "–" : ss.map(s => kindInfo(s.kind).icon).slice(0, 1).join("")) : "·"}</span></button>`; })}</div>
      <div class="stack" style="gap:8px">${sessions.filter(s => s.date === selDay).map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`)}${!sessions.some(s => s.date === selDay) && html`<p class="small muted center">Frei – ${fmtShort(selDay)}</p>`}</div>
      <${LoadBar} ...${lw} /></div>
    ${upcoming.length > 0 && html`<div class="stack" style="gap:8px"><h3>Als Nächstes</h3>${upcoming.map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} showDate=${true} />`)}</div>`}
    <button class="fab" aria-label="Training hinzufügen" onClick=${() => onAdd(t)}>＋</button></div>`;
}

export function Plan({onOpen, onAdd, onAvail, onWizard}) {
  const plan = S.activePlan(); if (!plan) return html`<${Empty} onWizard=${onWizard} />`;
  const [off, setOff] = useState(0);
  const sessions = S.planSessions(), t = S.today(), ws = addDays(weekStart(t), off * 7), idx = weekOf(plan, ws), ph = phaseAt(plan, Math.max(0, Math.min(idx, plan.meta.phases[plan.meta.phases.length - 1].toWeek)));
  const lw = weekLoads(plan, sessions, ws), days = Array.from({length: 7}, (_, i) => addDays(ws, i));
  const inPlan = idx >= 0 && ws <= plan.endDate;
  return html`<div class="screen stack">
    <div><p class="muted small">${plan.title}</p><h1>Plan</h1></div>
    <div class="card stack"><div class="row between"><button class="btn sm" onClick=${() => setOff(off - 1)} aria-label="Vorherige Woche">‹</button><div class="center"><div class="bold">${off === 0 ? "Diese Woche" : `Woche ${idx + 1}`}</div><div class="tiny muted">${fmtDay(ws)} – ${fmtDay(addDays(ws, 6))}</div></div><button class="btn sm" onClick=${() => setOff(off + 1)} aria-label="Nächste Woche">›</button></div>
      ${inPlan && html`<div class="row wrap"><span class="chip">${ph.name}</span>${sessions.some(s => weekStart(s.date) === ws && s.ctx && s.ctx.deload) && html`<span class="chip good">Entlastungswoche</span>`}</div><p class="small muted">${ph.focus}</p><${LoadBar} ...${lw} />`}</div>
    <div class="row"><button class="btn grow" onClick=${() => onAvail(ws)}>🗓️ Woche anpassen</button><button class="btn grow" onClick=${() => onAdd(days.find(d => d >= t) || days[0])}>＋ Training</button></div>
    <div class="stack" style="gap:8px">${days.map(d => { const ss = sessions.filter(s => s.date === d); return html`<div class="stack" style="gap:6px"><div class="row between"><span class=${"bold small" + (d === t ? "" : " muted")} style=${d === t ? "color:var(--accent)" : ""}>${fmtShort(d)}${d === t ? " · heute" : ""}</span></div>
      ${ss.length ? ss.map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`) : html`<div class="srow" style="opacity:.55"><div class="icon-box" style="background:var(--surface2)">😴</div><div class="small muted">Ruhetag</div></div>`}</div>`; })}</div>
    <div class="stack"><h3>Gesamtplan</h3>${plan.meta.coachSummary && html`<div class="card flat"><span class="chip" style="margin-bottom:8px">🤖 Coach</span><p class="small">${plan.meta.coachSummary}</p></div>`}
      ${plan.meta.warnings.map(w => html`<div class="banner small">${w}</div>`)}
      ${plan.meta.phases.map(p => html`<div class="card flat row"><div class="grow"><div class="bold">${p.name}</div><div class="small muted">${p.focus}</div>${p.criteria && html`<ul class="tiny muted" style="margin:6px 0 0;padding-left:16px">${p.criteria.map(c => html`<li>${c}</li>`)}</ul>`}</div><span class="chip">Wo. ${p.fromWeek + 1}–${p.toWeek + 1}</span></div>`)}</div>
    <button class="fab" aria-label="Training hinzufügen" onClick=${() => onAdd(S.today())}>＋</button></div>`;
}

function Spark({values, color = "var(--accent)", h = 36}) {
  const v = values.filter(x => x != null); if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), w = 120, pts = values.map((x, i) => x == null ? null : [i / (values.length - 1) * w, h - 4 - (max === min ? .5 : (x - min) / (max - min)) * (h - 8)]).filter(Boolean);
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" height=${h} preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke=${color} stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points=${pts.map(p => p.join(",")).join(" ")} /></svg>`;
}

export function Progress({onWizard}) {
  const plan = S.activePlan(); if (!plan) return html`<${Empty} onWizard=${onWizard} />`;
  const sessions = S.planSessions(), t = S.today(), done = sessions.filter(s => s.status === "done");
  const minutes = done.reduce((a, s) => a + (Number(s.log && s.log.durationMin) || s.durationMin), 0);
  const first = weekStart(plan.startDate), cur = weekStart(t);
  const n = Math.min(14, Math.max(4, diffDays(cur, first) / 7 + 4));
  const weeks = Array.from({length: Math.round(n)}, (_, i) => addDays(addDays(cur, 3 * 7), -(Math.round(n) - 1 - i) * 7)).filter(w => w >= first && w <= weekStart(plan.endDate));
  const data = weeks.map(w => ({w, ...weekLoads(plan, sessions, w)}));
  const maxV = Math.max(1, ...data.map(d => Math.max(d.target, d.done)));
  const bySport = {}; done.forEach(s => { bySport[s.sport] = (bySport[s.sport] || 0) + (Number(s.log && s.log.durationMin) || s.durationMin); });
  const sportRows = Object.entries(bySport).sort((a, b) => b[1] - a[1]);
  const streak = (() => { let c = 0, w = cur; if (!done.some(s => weekStart(s.date) === w)) w = addDays(w, -7); while (done.some(s => weekStart(s.date) === w)) { c++; w = addDays(w, -7); } return c; })();
  const targets = Object.entries(plan.meta.targets || {});
  const daily = S.state.garmin.daily.slice(-21);
  const compl = sessions.filter(s => s.date < t || s.status === "done").length;
  const W = 320, H = 130, bw = W / Math.max(1, data.length);
  return html`<div class="screen stack"><div><p class="muted small">${plan.title}</p><h1>Fortschritt</h1></div>
    <div class="grid2"><div class="card"><div class="tiny muted">Erledigt</div><h1>${done.length}</h1><div class="tiny muted">von ${compl} fälligen</div></div>
      <div class="card"><div class="tiny muted">Trainingszeit</div><h1>${Math.round(minutes / 60 * 10) / 10}<span class="small"> h</span></h1><div class="tiny muted">${streak} Wo. in Folge aktiv</div></div></div>
    <div class="card stack"><h3>Wochenbelastung</h3><svg class="chart" viewBox=${`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label="Wochenbelastung: Ziel gegen erledigt">
      ${data.map((d, i) => { const x = i * bw + bw * 0.15, w = bw * 0.7, th = d.target / maxV * H, dh = d.done / maxV * H, cw = d.w === cur;
        return html`<g><rect x=${x} y=${H - th} width=${w} height=${th} rx="4" fill="none" stroke="var(--line)" stroke-width="2" />
          <rect x=${x} y=${H - dh} width=${w} height=${dh} rx="4" fill=${cw ? "var(--accent2)" : "var(--accent)"} />
          <text x=${x + w / 2} y=${H + 13} text-anchor="middle">${d.w.slice(8)}.${d.w.slice(5, 7)}</text></g>`; })}</svg>
      <div class="legend"><span><span class="dot" style="background:var(--accent)"></span> erledigt</span><span><span class="dot" style="border:2px solid var(--line)"></span> Wochenziel</span></div></div>
    ${sportRows.length > 0 && html`<div class="card stack"><h3>Nach Sportart</h3>${sportRows.map(([sp, m]) => html`<div class="stack" style="gap:4px"><div class="row between small"><span>${SPORTS[sp].icon} ${SPORTS[sp].label}</span><span class="muted">${m} Min</span></div><div class="progressbar"><i style=${`width:${m / sportRows[0][1] * 100}%;background:${SPORTS[sp].color}`}></i></div></div>`)}</div>`}
    ${targets.length > 0 && html`<div class="card stack"><h3>Kraft-Ziele (automatisch)</h3>${targets.map(([n, x]) => html`<div class="rec"><div class="grow"><div class="bold small">${n}</div><div class="tiny muted">${x.reason || ""}</div></div><span class="chip">🎯 ${x.seconds != null ? x.seconds + " Sek." : [x.weight != null ? fmtNum(x.weight) + " kg" : "", x.reps != null ? x.reps + " Wdh." : ""].filter(Boolean).join(" × ")}</span></div>`)}</div>`}
    ${daily.length >= 3 && html`<div class="card stack"><h3>⌚ Erholung (Garmin)</h3><div class="grid2"><div><div class="tiny muted">Ruhepuls</div><${Spark} values=${daily.map(d => d.restingHr)} color="var(--bad)" /></div><div><div class="tiny muted">Schlaf (h)</div><${Spark} values=${daily.map(d => d.sleepHours)} color="var(--accent2)" /></div></div></div>`}
  </div>`;
}

function GarminCard() {
  const cloud = S.state.adapter && S.state.adapter.mode === "cloud";
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [key, setKey] = useState(""), [guide, setGuide] = useState(false);
  const g = S.state.garmin, link = S.state.link, connected = link && link.status === "connected", last = g.daily.length ? g.daily[g.daily.length - 1].date : null;
  const run = fn => async () => { setBusy(true); setMsg(""); try { await fn(); } catch (e) { setMsg("⚠ " + e.message); } setBusy(false); };
  const connect = run(async () => { await S.garminApi.connect(key.trim()); setKey(""); await S.refreshLink(); setMsg("✓ Key geprüft und verschlüsselt gespeichert."); });
  const sync = run(async () => { const r = await S.garminApi.sync(30); await S.reloadGarmin(); const bad = Object.entries(r.report || {}).filter(([, v]) => v.ok === 0 && v.failed > 0).map(([k, v]) => `${k} (HTTP ${v.lastStatus})`); setMsg(`✓ ${r.activities} Aktivitäten, ${r.daily} Tageswerte synchronisiert.${bad.length ? " Nicht abrufbar: " + bad.join(", ") + " – siehe Diagnose." : ""}`); });
  const [diag, setDiag] = useState("");
  const runDiag = run(async () => { const r = await S.garminApi.diagnose(); setDiag(JSON.stringify(r, null, 1)); });
  const disc = run(async () => { await S.garminApi.disconnect(); await S.refreshLink(); S.toast("Garmin getrennt, Key gelöscht.", "info"); });
  const onFile = async e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return; setBusy(true); setMsg(""); try { const r = await S.importGarminFile(await f.text()); setMsg(`✓ ${r.activities} Aktivitäten, ${r.daily} Tageswerte importiert.`); } catch (err) { setMsg("⚠ " + err.message); } setBusy(false); };
  return html`<div class="card stack"><div class="row"><span style="font-size:1.6rem">⌚</span><div class="grow"><h3>Garmin Connect</h3><div class="small muted">Aktivitäten, Schlaf, HRV, Ruhepuls & Body Battery bremsen oder erlauben Steigerungen.</div></div></div>
    ${g.activities.length || g.daily.length ? html`<div class="row wrap"><span class="chip good">${g.activities.length} Aktivitäten</span><span class="chip">${g.daily.length} Tageswerte</span>${last && html`<span class="chip">bis ${last}</span>`}</div>` : null}
    ${!cloud && html`<div class="banner small">Die direkte Verbindung (Personal API) braucht ein Cloud-Konto. Im Demo-Modus nur Datei-Import.</div>`}
    ${cloud && connected && html`<div class="row wrap"><span class="chip good">Key gespeichert</span>${link.last_sync_at && html`<span class="chip">Sync: ${String(link.last_sync_at).slice(0, 16).replace("T", " ")}</span>`}${link.last_error && html`<span class="chip warn">${String(link.last_error).slice(0, 60)}</span>`}</div>
      <div class="row"><button class="btn primary grow" disabled=${busy} onClick=${sync}>${busy ? "…" : "Jetzt synchronisieren"}</button><button class="btn danger" disabled=${busy} onClick=${disc}>Trennen</button></div>
      <button class="btn sm ghost" disabled=${busy} onClick=${runDiag}>Diagnose (Struktur der Garmin-Antworten)</button>
      ${diag && html`<div class="stack" style="gap:6px"><pre class="tiny" style="margin:0;max-height:260px;overflow:auto;background:var(--surface2);padding:10px;border-radius:12px;white-space:pre-wrap;word-break:break-word">${diag}</pre><button class="btn sm" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(diag).then(() => S.toast("Kopiert.", "info")); }}>Kopieren</button><p class="tiny muted">Enthält nur Feldnamen und Typen, keine persönlichen Werte.</p></div>`}`}
    ${cloud && link && link.status === "error" && html`<div class="banner small">Der gespeicherte Key wurde von Garmin abgelehnt. Erzeuge einen neuen Key und füge ihn unten ein.</div>`}
    ${cloud && !connected && html`<div class="stack"><button class="btn sm" onClick=${() => setGuide(!guide)}>${guide ? "Anleitung ausblenden" : "So bekommst du deinen Personal API Key"}</button>
      ${guide && html`<ol class="small muted" style="margin:0;padding-left:20px;line-height:1.6"><li>In Garmin Connect (Web) anmelden und die Seite <b>Personal API Key</b> öffnen.</li><li><b>Create Key</b> wählen, Bedingungen lesen und akzeptieren.</li><li>Ablaufdauer wählen und <b>Create</b> klicken.</li><li>Der Key wird <b>nur einmal</b> angezeigt: kopieren und hier einfügen.</li></ol>`}
      <label class="field">Personal API Key<input type="password" autocomplete="off" spellcheck="false" placeholder="Key hier einfügen" value=${key} onInput=${e => setKey(e.target.value)} /></label>
      <button class="btn primary" disabled=${busy || key.trim().length < 10} onClick=${connect}>${busy ? "Prüfe …" : "Verbinden"}</button>
      <p class="tiny muted">Der Key wird nur serverseitig verschlüsselt gespeichert und nie angezeigt oder weitergegeben. Du kannst ihn bei Garmin jederzeit widerrufen.</p></div>`}
    <label class="field">Export-Datei importieren (garmin_data.json)<input type="file" accept="application/json,.json" disabled=${busy} onChange=${onFile} /></label>
    ${msg && html`<div class="banner info small">${msg}</div>`}</div>`;
}

export function Profile({onWizard}) {
  const st = S.state, plan = S.activePlan(), cloud = st.adapter && st.adapter.mode === "cloud", archived = st.plans.filter(p => p.status !== "active");
  const [confirm, setConfirm] = useState(null);
  const exp = async () => { const d = await S.exportData(); const blob = new Blob([JSON.stringify(d, null, 1)], {type: "application/json"}); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `training-export-${S.today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  return html`<div class="screen stack"><h1>Profil</h1>
    <div class="card stack"><div class="row"><div class="icon-box" style="background:var(--grad);color:#fff">${(st.user && st.user.email || "?").slice(0, 1).toUpperCase()}</div><div class="grow"><div class="bold">${cloud ? st.user.email : "Demo-Modus"}</div><div class="small muted">${cloud ? "Daten nur für dein Konto sichtbar" : "Ohne Konto – Daten nur in diesem Browser"}</div></div></div>
      ${cloud && html`<button class="btn" onClick=${S.auth.signOut}>Abmelden</button>`}
      ${!cloud && html`<div class="banner small">Für Konten, Cloud-Sync, KI-Coach und Garmin die <b>config.js</b> mit deinem Supabase-Projekt füllen (siehe README).</div>`}</div>
    <div class="card stack"><h3>Trainingsplan</h3>${plan ? html`<div class="rec"><div class="grow"><div class="bold">${plan.title}</div><div class="tiny muted">${fmtDay(plan.startDate)} – ${fmtDay(plan.endDate)}</div></div><span class="chip good">aktiv</span></div>` : html`<p class="muted small">Kein aktiver Plan.</p>`}
      <button class="btn primary" onClick=${onWizard}>＋ Neuen Plan erstellen</button><p class="tiny muted">Ein neuer Plan archiviert den aktuellen (Daten bleiben erhalten).</p>
      ${archived.map(p => html`<div class="rec"><div class="grow"><div class="bold small">${p.title}</div><div class="tiny muted">archiviert</div></div><button class="btn sm danger" onClick=${() => setConfirm({type: "plan", id: p.id})}>Löschen</button></div>`)}</div>
    <${GarminCard} />
    <div class="card stack"><h3>KI-Coach</h3><label class="opt" style="cursor:pointer"><input type="checkbox" style="width:22px;height:22px" checked=${st.settings.autoApply !== false} onChange=${e => S.setSettings({autoApply: e.target.checked})} /><span><div class="ot">Empfehlungen automatisch übernehmen</div><div class="small muted">Ziele und Umfang passen sich nach jedem Training von selbst an.</div></span></label>
      <p class="tiny muted">${S.aiAvailable() ? "KI aktiv (kostenloses Modell über deinen Server). Beim Auswerten werden Trainingsdaten an den KI-Anbieter gesendet." : "Ohne Cloud-Konto arbeitet der Coach regelbasiert."}</p></div>
    <div class="card stack"><h3>Daten & Konto</h3><button class="btn" onClick=${exp}>⬇ Alle Daten exportieren (JSON)</button><button class="btn danger" onClick=${() => setConfirm({type: "data"})}>Alle Trainingsdaten löschen</button>
      ${cloud && html`<button class="btn danger" onClick=${() => setConfirm({type: "account"})}>Konto endgültig löschen</button>`}
      <a class="btn ghost" href="./legacy/index.html">Alte Fußball-Reha-Version öffnen</a></div>
    ${confirm && html`<${Sheet} title="Wirklich?" onClose=${() => setConfirm(null)}><div class="stack"><p class="muted">${confirm.type === "account" ? "Dein Konto und alle Daten werden unwiderruflich gelöscht." : confirm.type === "data" ? "Alle Pläne und Einheiten werden gelöscht." : "Dieser Plan und seine Einheiten werden gelöscht."}</p>
      <button class="btn danger" onClick=${async () => { const c = confirm; setConfirm(null); try { if (c.type === "account") await S.deleteAccount(); else if (c.type === "data") await S.resetData(); else await S.deletePlan(c.id); } catch (e) { S.toast(e.message, "error"); } }}>Ja, löschen</button><button class="btn" onClick=${() => setConfirm(null)}>Abbrechen</button></div><//>`}
  </div>`;
}
