import {html, useState} from "../../vendor/preact-htm.js";
import {Icon, SportMark, Bar, INTENSITY_TXT, sessionLine, Spinner, Sheet, Row, fmtNum} from "./common.js";
import * as S from "../store.js";
import {SPORTS, kindInfo} from "../../engine/catalog.js";
import {fmtShort, fmtDay, addDays, weekStart, DAY_SHORT, dow, diffDays, DAY_LONG} from "../../engine/dates.js";
import {recoveryFlags, sportOfActivity} from "../../engine/garmin.js";
import {computeStats} from "../../engine/stats.js";
import {computeAwards} from "../../engine/awards.js";
import {InsightsList} from "./insights.js";
import {ExcludeSheet} from "./session.js";

const weekOf = (plan, t) => Math.floor(diffDays(weekStart(t), weekStart(plan.startDate)) / 7);
const phaseAt = (plan, idx) => plan.meta.phases.find(p => idx >= p.fromWeek && idx <= p.toWeek) || plan.meta.phases[plan.meta.phases.length - 1];
const weekLoads = (plan, sessions, ws) => {
  const all = sessions.filter(s => weekStart(s.date) === ws);
  const done = all.filter(s => s.status === "done").reduce((a, s) => a + S.A.actualLoad(s), 0);
  const planned = all.filter(s => s.status === "planned").reduce((a, s) => a + s.load, 0);
  return {done, planned, target: plan.meta.weekTargets[ws] ?? done + planned, all};
};
const DEFAULT_KIND = {run: "run_easy", bike: "bike_easy", swim: "swim_endurance", strength: "strength_full", football: "football_skills", climb: "climb_easy", cardio: "cardio_easy", mobility: "mobility", walk: "walk"};
const describe = s => s.exercises && s.exercises.length ? `${s.exercises.length} Übungen: ${s.exercises.slice(0, 3).map(e => e.name.replace(/ \(.*\)/, "")).join(", ")}${s.exercises.length > 3 ? " …" : ""}` : ((s.blocks.find(b => /Haupt|Plan|Flow|Einheit/.test(b.label)) || s.blocks[0] || {}).text || "");

function SessionRow({s, onOpen, showDate}) {
  return html`<button class=${"li " + s.status} onClick=${() => onOpen(s.id)}><${Bar} s=${s} />
    <div class="grow"><div class="t">${s.title}</div><div class="s">${showDate ? fmtShort(s.date) + " · " : ""}${sessionLine(s)}${s.status === "planned" ? " · " + INTENSITY_TXT[s.intensity] : ""}</div></div>
    ${s.auto && s.status === "planned" ? html`<span class="tag warn">angepasst</span>` : null}${s.source === "garmin" && s.status === "done" ? html`<span class="tag">Garmin</span>` : null}
    ${s.status === "done" ? html`<span class="c-good"><${Icon} name="check" size=${18} /></span>` : s.status === "skipped" ? html`<span class="tiny faint">ausgelassen</span>` : null}
    <span class="chev"><${Icon} name="chevR" size=${18} /></span></button>`;
}
const Meter = ({done, planned, target, label = "Wochenbelastung"}) => {
  const pct = target > 0 ? Math.min(100, Math.round(done / target * 100)) : 0;
  return html`<div class="stack tight"><div class="row between small"><span class="muted">${label}</span><span class="bold">${Math.round(done / Math.max(target, 1) * 100)} %</span></div><div class="meter"><i style=${`width:${pct}%`}></i></div></div>`;
};

export function Empty({onWizard}) {
  return html`<div class="screen stack"><div><div class="eyebrow">Chronica Athleta</div><h1 style="margin-top:6px">Noch kein Plan</h1></div>
    <div class="card stack"><p class="muted">Erstelle einen Trainingsplan für dein Ziel, deine Sportarten und deinen Alltag. Er bleibt flexibel: Einheiten lassen sich tauschen, verschieben und auslassen.</p><button class="btn primary" onClick=${onWizard}>Plan erstellen</button></div></div>`;
}

const HRV_TXT = {BALANCED: ["ausgeglichen", ""], UNBALANCED: ["unausgeglichen", "warn"], LOW: ["niedrig", "bad"], POOR: ["schwach", "bad"]};
const LEVEL = {high: ["gut erholt", "good"], medium: ["mäßig erholt", "warn"], low: ["wenig erholt", "bad"]};
function Readiness({connected}) {
  const daily = S.state.garmin.daily, t = S.today();
  if (!daily.length) return connected ? html`<div class="note">Noch keine Garmin-Tageswerte.${S.state.syncing ? " Synchronisiere …" : " Sie werden beim Öffnen der App automatisch geladen."}</div>` : null;
  const has = x => x.sleepHours != null || x.restingHr != null || x.hrvAvg != null || x.bodyBatteryMorning != null;
  const days = daily.filter(d => d.date <= t), d = days.find(x => x.date === t && has(x)) || days.slice().reverse().find(has);
  if (!d) return null;
  const rd = S.readinessFor(d.date), rec = recoveryFlags(daily, d.date), prior = days.filter(x => x.date < d.date && x.restingHr != null).slice(-14).map(x => x.restingHr);
  const base = prior.length >= 5 ? prior.slice().sort((a, b) => a - b)[Math.floor(prior.length / 2)] : null;
  const f1 = n => String(Math.round(n * 10) / 10).replace(".", ","), hrv = d.hrvStatus && HRV_TXT[d.hrvStatus], delta = base != null && d.restingHr != null ? d.restingHr - base : null;
  const cls = {sleep: d.sleepHours == null ? "" : d.sleepHours < 6 ? "bad" : d.sleepHours < 7 ? "warn" : "", rhr: delta == null ? "" : delta >= 5 ? "bad" : delta >= 3 ? "warn" : "", bb: d.bodyBatteryMorning == null ? "" : d.bodyBatteryMorning < 30 ? "bad" : d.bodyBatteryMorning < 60 ? "warn" : ""};
  const latest = k => { const x = days.slice().reverse().find(y => y[k] != null); return x ? x : null; };
  const st = latest("steps"), vo = latest("vo2max"), n0 = x => Math.round(x).toLocaleString("de-DE");
  const stat = (k, v, sub, c) => html`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class=${"d " + (c ? "c-" + c : "")}>${sub || "\u00a0"}</div></div>`;
  return html`<div class="section"><div class="row between"><span class="label">Erholung</span>${rd ? html`<span class=${"tag " + LEVEL[rd.level][1]}>${LEVEL[rd.level][0]} · ${rd.score}</span>` : html`<span class="tiny muted">${d.date === t ? "heute" : "Stand " + fmtDay(d.date)}</span>`}</div>
    <div class="card stack" style="gap:14px"><div class="stats">
      ${stat("Schlaf", d.sleepHours != null ? f1(d.sleepHours) + " h" : "–", d.sleepScore != null ? "Score " + Math.round(d.sleepScore) : "", cls.sleep)}
      ${stat("Ruhepuls", d.restingHr != null ? Math.round(d.restingHr) : "–", delta != null ? (delta > 0 ? "+" : "") + Math.round(delta) + " zu Ø" : "bpm", cls.rhr)}
      ${stat("HRV", d.hrvAvg != null ? Math.round(d.hrvAvg) : "–", hrv ? hrv[0] : "ms", hrv ? hrv[1] : "")}
      ${stat("Battery", d.bodyBatteryMorning != null ? Math.round(d.bodyBatteryMorning) : "–", d.bodyBatteryMorning != null && d.bodyBatteryMorning < 60 ? (d.bodyBatteryMorning < 30 ? "niedrig" : "mittel") : "", cls.bb)}</div>
      ${(st || vo) && html`<div class="row wrap small muted" style="gap:6px 18px">${st && html`<span>Schritte ${st.date === t ? "heute" : st.date === addDays(t, -1) ? "gestern" : fmtDay(st.date)}: <b style="color:var(--text)">${n0(st.steps)}</b></span>`}${vo && html`<span>VO₂max: <b style="color:var(--text)">${f1(vo.vo2max)}</b>${vo.vo2maxCycling != null ? " (Rad " + f1(vo.vo2maxCycling) + ")" : ""}</span>`}</div>`}
      ${rd ? html`<p class=${"small " + (rd.level === "high" ? "muted" : rd.level === "medium" ? "c-warn" : "c-bad")}>${rd.text}${rec.flags.length ? " Auffällig: " + rec.flags.join(", ") + "." : ""}</p>` : null}</div></div>`;
}

export function Today({onOpen, onAdd, onWizard}) {
  const plan = S.activePlan(); if (!plan) return html`<${Empty} onWizard=${onWizard} />`;
  const t = S.today(), sessions = S.planSessions(), ws = weekStart(t), idx = weekOf(plan, t), ph = phaseAt(plan, Math.max(0, idx));
  const open = sessions.filter(s => s.date === t && s.status === "planned"), done = sessions.filter(s => s.date === t && s.status === "done");
  const lw = weekLoads(plan, sessions, ws), next = S.nextSession(), isToday = next && next.date === t;
  const [selDay, setSelDay] = useState(t), days = Array.from({length: 7}, (_, i) => addDays(ws, i));
  return html`<div class="screen stack gap-lg">
    <div><div class="page-head"><div><div class="eyebrow">${DAY_LONG[dow(t)]}, ${fmtDay(t)}</div><h1 style="margin-top:6px">Heute</h1></div>
      <button class="icon-btn" aria-label="Training hinzufügen" onClick=${() => onAdd(t)}><${Icon} name="plus" /></button></div>
      <p class="sub">${plan.title} · Woche ${Math.max(1, idx + 1)} · ${ph.name}${S.state.syncing ? " · Garmin wird synchronisiert …" : ""}</p></div>
    <div class="cols"><div class="col stack gap-lg">
      ${done.length > 0 && html`<div class="section"><span class="label">Heute erledigt</span><div class="list">${done.map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`)}</div></div>`}
      <div class="section"><span class="label">${next ? (isToday ? "Heute geplant" : "Nächste Einheit") : "Nächste Einheit"}</span>${next ? html`
        <div class="card hero-card"><div class="stack tight"><${SportMark} s=${next} /><h2>${next.title}</h2><div class="meta">${isToday ? "" : fmtShort(next.date) + " · "}${sessionLine(next)} · ${INTENSITY_TXT[next.intensity]}</div></div>
          ${next.auto && html`<div class="note">Angepasst: ${next.auto.reason}</div>`}
          <p class="small muted clamp2">${describe(next)}</p>
          <div class="row">${isToday ? html`<button class="btn primary grow" onClick=${() => onOpen(next.id, "log")}>Training loggen</button>` : html`<button class="btn primary grow" onClick=${async () => { await S.move(next.id, t); }}>Heute machen</button>`}<button class="btn" onClick=${() => onOpen(next.id)}>Optionen</button></div>
          ${!isToday && !done.length && html`<p class="tiny faint">Heute ist Ruhetag.</p>`}</div>
        ${open.length > 1 && html`<div class="list">${open.slice(1).map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`)}</div>`}`
        : html`<div class="card stack"><div><h2>Keine Einheit geplant</h2><p class="muted small" style="margin-top:4px">Der Plan ist durch. Füge ein Training hinzu oder erstelle einen neuen Plan.</p></div><button class="btn" onClick=${() => onAdd(t)}>Training hinzufügen</button></div>`}</div>
    </div><div class="col stack gap-lg">
      <${Readiness} connected=${!!(S.state.link && S.state.link.status === "connected")} />
      <div class="section"><span class="label">Diese Woche</span>
        <div class="card stack" style="gap:14px"><div class="weekstrip">${days.map(d => { const ss = sessions.filter(s => s.date === d);
          return html`<button class=${"wd" + (d === t ? " today" : "") + (d === selDay ? " sel" : "")} onClick=${() => setSelDay(d)}><span>${DAY_SHORT[dow(d)]}</span><span class="n">${+d.slice(8)}</span><span class="mk">${ss.slice(0, 3).map(s => html`<i class=${s.status === "done" ? "done" : ""}></i>`)}</span></button>`; })}</div>
          <${Meter} ...${lw} /></div>
        ${selDay !== t && html`<div class="list">${sessions.filter(s => s.date === selDay).map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`)}${!sessions.some(s => s.date === selDay) && html`<div class="li"><span class="muted small">Frei · ${fmtShort(selDay)}</span></div>`}</div>`}</div>
    </div></div>
  </div>`;
}

export function Plan({onOpen, onAdd, onAvail, onWizard}) {
  const plan = S.activePlan(); if (!plan) return html`<${Empty} onWizard=${onWizard} />`;
  const [far, setFar] = useState(false), [allPast, setAllPast] = useState(false), [excl, setExcl] = useState(false);
  const sessions = S.planSessions(), t = S.today(), ws = weekStart(t), idx = weekOf(plan, t), ph = phaseAt(plan, Math.max(0, Math.min(idx, plan.meta.phases[plan.meta.phases.length - 1].toWeek)));
  const lw = weekLoads(plan, sessions, ws), horizon = addDays(t, far ? 56 : 14), prelimFrom = addDays(t, 7);
  const upcoming = sessions.filter(s => s.status === "planned" && s.date >= t && s.date <= horizon).sort((a, b) => a.date.localeCompare(b.date));
  const hasMore = sessions.some(s => s.status === "planned" && s.date > addDays(t, 14));
  const pastAll = sessions.filter(s => s.status !== "planned" && s.date <= t).sort((a, b) => b.date.localeCompare(a.date)), past = allPast ? pastAll : pastAll.slice(0, 8);
  const groups = []; upcoming.forEach(s => { const g = groups[groups.length - 1]; if (g && g.date === s.date) g.list.push(s); else groups.push({date: s.date, list: [s]}); });
  const pgroups = []; past.forEach(s => { const g = pgroups[pgroups.length - 1]; if (g && g.date === s.date) g.list.push(s); else pgroups.push({date: s.date, list: [s]}); });
  const rows = (g, prelim) => html`<div class="section"><span class="label" style=${g.date === t ? "color:var(--text)" : ""}>${fmtShort(g.date)}${g.date === t ? " · heute" : ""}${prelim && g.date > prelimFrom ? " · vorläufig" : ""}</span><div class="list">${g.list.map(s => html`<${SessionRow} s=${s} onOpen=${onOpen} />`)}</div></div>`;
  return html`<div class="screen stack gap-lg">
    <div class="page-head"><div><div class="eyebrow">${plan.title}</div><h1 style="margin-top:6px">Plan</h1></div><button class="icon-btn" aria-label="Training hinzufügen" onClick=${() => onAdd(t)}><${Icon} name="plus" /></button></div>
    <div class="cols"><div class="col stack gap-lg">
      <div class="stack"><span class="label" style="margin-bottom:-4px">Kommend</span>
        ${groups.length ? groups.map(g => rows(g, true)) : html`<div class="note">Keine kommenden Einheiten geplant.</div>`}
        ${hasMore && html`<button class="btn block" onClick=${() => setFar(!far)}>${far ? "Weniger anzeigen" : "Weitere Wochen anzeigen"}</button>`}
        <p class="tiny muted">Der Plan passt sich laufend an: nach jedem Training, an deine Garmin-Aktivitäten und deine Erholung. Spätere Einheiten sind vorläufig.</p></div>
    </div><div class="col stack gap-lg">
      <div class="card stack"><div class="row between"><div><div class="bold">Diese Woche</div><div class="tiny muted">${fmtDay(ws)} – ${fmtDay(addDays(ws, 6))} · ${ph.name}</div></div><button class="btn sm" onClick=${() => onAvail(ws)}>Woche anpassen</button></div><${Meter} ...${lw} /></div>
      <div class="stack"><span class="label" style="margin-bottom:-4px">Vergangen</span>${pgroups.length ? pgroups.map(g => rows(g, false)) : html`<div class="note">Noch keine vergangenen Einheiten.</div>`}
        ${pastAll.length > 8 && html`<button class="btn block" onClick=${() => setAllPast(!allPast)}>${allPast ? "Weniger anzeigen" : `Alle ${pastAll.length} anzeigen`}</button>`}</div>
      ${excl && html`<${ExcludeSheet} onClose=${() => setExcl(false)} />`}
      <div class="section"><div class="row between"><span class="label">Dauerhafte Änderungen</span><button class="btn sm" onClick=${() => setExcl(true)}>Sportart ausschließen</button></div>${(plan.meta.rules || []).length === 0 && html`<p class="tiny muted">Keine Regeln. Schließe Sportarten für den ganzen Plan oder einen Zeitraum aus.</p>`}${(plan.meta.rules || []).length > 0 && html`<div class="list">${plan.meta.rules.map(r => html`<div class="li"><div class="grow"><div class="t">${r.label}</div><div class="s">${r.from && r.until ? "gilt " + fmtDay(r.from) + " " + r.from.slice(0, 4) + " bis " + fmtDay(r.until) + " " + r.until.slice(0, 4) : r.from ? "gilt ab " + fmtDay(r.from) + " " + r.from.slice(0, 4) : r.until ? "gilt bis " + fmtDay(r.until) + " " + r.until.slice(0, 4) : "gilt dauerhaft"}</div></div><button class="btn sm" onClick=${() => S.removePlanRule(r.id)}>Entfernen</button></div>`)}</div>`}</div>
      <details class="fold"><summary>Planübersicht<${Icon} name="chevD" size=${18} /></summary><div class="stack">
        ${plan.meta.coachSummary && html`<div class="stack tight"><span class="label">Coach</span><p class="small">${plan.meta.coachSummary}</p></div>`}
        ${plan.meta.warnings.map(w => html`<div class="note warn">${w}</div>`)}
        ${plan.meta.phases.map(p => html`<div class="stack tight"><div class="row between"><span class="bold">${p.name}</span><span class="tiny muted">Wo. ${p.fromWeek + 1}–${p.toWeek + 1}</span></div><p class="small muted">${p.focus}</p>${p.criteria && html`<ul class="tiny muted" style="margin:0;padding-left:16px">${p.criteria.map(c => html`<li>${c}</li>`)}</ul>`}</div>`)}</div></details>
    </div></div>
  </div>`;
}

function Spark({values, color = "var(--ink)", h = 34}) {
  const v = values.filter(x => x != null); if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), w = 120, pts = values.map((x, i) => x == null ? null : [i / (values.length - 1) * w, h - 4 - (max === min ? .5 : (x - min) / (max - min)) * (h - 8)]).filter(Boolean);
  return html`<svg viewBox=${`0 0 ${w} ${h}`} width="100%" height=${h} preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke=${color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points=${pts.map(p => p.join(",")).join(" ")} /></svg>`;
}

const f1 = n => String(Math.round(n * 10) / 10).replace(".", ",");
const hours = m => f1(m / 60) + " h";
const Delta = ({v, inverse}) => v == null ? null : html`<span class=${"tiny " + (v === 0 ? "muted" : (v > 0) !== !!inverse ? "c-good" : "c-warn")}>${v > 0 ? "+" : ""}${v} %</span>`;
const fmtDate = d => `${+d.slice(8)}.${+d.slice(5, 7)}.`;

export function Progress({onWizard}) {
  const plan = S.activePlan(); if (!plan) return html`<${Empty} onWizard=${onWizard} />`;
  const t = S.today(), g = S.state.garmin, all = S.state.sessions, sessions = S.planSessions();
  const st = computeStats({sessions: all, garmin: g, today: t}), awards = computeAwards({sessions: all, garmin: g, plans: S.state.plans, today: t});
  const first = weekStart(plan.startDate), cur = weekStart(t), n = Math.round(Math.min(12, Math.max(4, diffDays(cur, first) / 7 + 4)));
  const weeks = Array.from({length: n}, (_, i) => addDays(addDays(cur, 3 * 7), -(n - 1 - i) * 7)).filter(w => w >= first && w <= weekStart(plan.endDate));
  const data = weeks.map(w => ({w, ...weekLoads(plan, sessions, w)})), maxV = Math.max(1, ...data.map(d => Math.max(d.target, d.done)));
  const sportRows = Object.entries(st.bySport).sort((a, b) => b[1].minutes - a[1].minutes), tot = st.total, c = st.compare, ig = st.intensity, igSum = ig.easy + ig.moderate + ig.hard;
  const targets = Object.entries(plan.meta.targets || {}), daily = g.daily.slice(-21), gs = st.garmin, W = 320, H = 120, bw = W / Math.max(1, data.length), gains = st.strength.gains.slice(0, 5);
  const stat = (k, v, d) => html`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d || "\u00a0"}</div></div>`;
  return html`<div class="screen stack gap-lg"><div><div class="eyebrow">${plan.title}</div><h1 style="margin-top:6px">Fortschritt</h1></div>
    <div class="cols"><div class="col stack gap-lg">
      ${S.doneCount() >= 5 && html`<div class="section"><span class="label">Empfehlungen</span><${InsightsList} items=${S.getInsights()} /></div>`}
      <div class="card"><div class="stats">${stat("Einheiten", tot.count, `${tot.activeDays} ${tot.activeDays === 1 ? "aktiver Tag" : "aktive Tage"}`)}${stat("Trainingszeit", hours(tot.minutes), tot.longest ? "längste " + tot.longest + " Min" : "")}${stat("Distanz", tot.distance ? f1(tot.distance) + " km" : "–", "aus Logs und Garmin")}${stat("Serie", tot.streakDays, `${tot.streakWeeks} ${tot.streakWeeks === 1 ? "Woche" : "Wochen"} aktiv`)}</div></div>
      <div class="section"><span class="label">Letzte 4 Wochen</span><div class="list">
        <div class="li"><div class="grow"><div class="t">${c.cur.count} ${c.cur.count === 1 ? "Einheit" : "Einheiten"}</div><div class="s">${hours(c.cur.minutes)}${c.cur.distance ? " · " + f1(c.cur.distance) + " km" : ""}</div></div>${c.countDelta != null && html`<div class="center"><${Delta} v=${c.countDelta} /><div class="tiny faint">Einheiten</div></div>`}${c.minutesDelta != null && html`<div class="center"><${Delta} v=${c.minutesDelta} /><div class="tiny faint">Zeit</div></div>`}</div>
        ${st.workload.level !== "unknown" && html`<div class="li"><div class="grow"><div class="t">Wochenbelastung</div><div class="s">Letzte 7 Tage gegen Ø der letzten 4 Wochen</div></div><span class=${"tag " + (st.workload.level === "high" ? "bad" : st.workload.level === "low" ? "warn" : "good")}>${st.workload.level === "high" ? "hoch" : st.workload.level === "low" ? "niedrig" : "ausgewogen"} · ${f1(st.workload.ratio)}</span></div>`}</div>
        ${c.prev.count === 0 && html`<p class="tiny faint">Veränderungen erscheinen, sobald Vergleichswerte aus dem Vormonat vorliegen.</p>`}</div>
      <div class="section"><span class="label">Wochenbelastung</span><div class="card stack"><svg class="chart" viewBox=${`0 0 ${W} ${H + 16}`} width="100%" role="img" aria-label="Wochenbelastung: Ziel gegen erledigt">
        ${data.map((d, i) => { const x = i * bw + bw * 0.18, w = bw * 0.64, th = d.target / maxV * H, dh = d.done / maxV * H;
          return html`<g><rect x=${x} y=${H - th} width=${w} height=${th} rx="3" fill="none" stroke="var(--line)" stroke-width="1.5" /><rect x=${x} y=${H - dh} width=${w} height=${dh} rx="3" fill=${d.w === cur ? "var(--accent)" : "var(--ink)"} />
            <text x=${x + w / 2} y=${H + 12} text-anchor="middle">${d.w.slice(8)}.${d.w.slice(5, 7)}</text></g>`; })}</svg>
        <div class="legend"><span>■ erledigt</span><span>□ Wochenziel</span></div></div></div>
      <div class="section"><span class="label">Auszeichnungen</span>${awards.length ? html`<div class="awards">${awards.map(a => html`<div class="award"><span class="medal"><${Icon} name="award" size=${18} /></span><div class="bold">${a.title}</div><div class="small muted">${a.desc}</div><div class="tiny faint">${fmtDate(a.date)}</div></div>`)}</div>` : html`<div class="note">Noch keine Auszeichnungen. Die erste bekommst du nach deiner ersten abgeschlossenen Einheit.</div>`}</div>
    </div><div class="col stack gap-lg">
      ${sportRows.length > 0 && html`<div class="section"><span class="label">Verteilung</span><div class="card stack">${sportRows.map(([sp, e]) => html`<div class="stack tight"><div class="row between small"><span class="sport" style="text-transform:none;letter-spacing:0;font-size:.88rem;color:var(--text)"><i style=${`background:${SPORTS[sp].color}`}></i>${SPORTS[sp].label}</span><span class="muted">${hours(e.minutes)}${e.distance ? " · " + f1(e.distance) + " km" : ""}</span></div><div class="meter"><i style=${`width:${e.minutes / sportRows[0][1].minutes * 100}%;background:${SPORTS[sp].color}`}></i></div></div>`)}
        ${igSum > 0 && html`<hr /><div class="stack tight"><div class="row between small"><span class="muted">Intensität</span><span class="muted">${Math.round(ig.easy / igSum * 100)} % locker · ${Math.round(ig.moderate / igSum * 100)} % moderat · ${Math.round(ig.hard / igSum * 100)} % intensiv</span></div>
          <div class="meter" style="display:flex"><i style=${`width:${ig.easy / igSum * 100}%;background:var(--good);border-radius:0`}></i><i style=${`width:${ig.moderate / igSum * 100}%;background:var(--warn);border-radius:0`}></i><i style=${`width:${ig.hard / igSum * 100}%;background:var(--bad);border-radius:0`}></i></div></div>`}</div></div>`}
      ${(st.strength.sets > 0 || targets.length > 0) && html`<div class="section"><span class="label">Kraft</span><div class="list">
        <div class="li"><div class="grow"><div class="t">${st.strength.volume >= 1000 ? f1(st.strength.volume / 1000) + " t" : st.strength.volume + " kg"} bewegt</div><div class="s">${st.strength.sets} Sätze insgesamt</div></div></div>
        ${gains.map(e => html`<div class="li"><div class="grow"><div class="t">${e.name}</div><div class="s">${f1(e.from)} → ${f1(e.to)} kg in ${e.sessions} Einheiten</div></div><span class="tag good">+${Math.round((e.to - e.from) / e.from * 100)} %</span></div>`)}
        ${targets.map(([nm, x]) => html`<div class="li"><div class="grow"><div class="t">${nm}</div><div class="s">Nächstes Ziel${x.reason ? ": " + x.reason : ""}</div></div><span class="tag">${x.seconds != null ? x.seconds + " Sek." : [x.weight != null ? fmtNum(x.weight) + " kg" : "", x.reps != null ? x.reps + " Wdh." : ""].filter(Boolean).join(" × ")}</span></div>`)}</div></div>`}
      ${gs.hasData && html`<div class="section"><span class="label">Alltag und Fitness (Garmin)</span><div class="card stack"><div class="stats" style="grid-template-columns:repeat(2,1fr)">
        ${stat("Schritte Ø 7 Tage", gs.steps7 != null ? gs.steps7.toLocaleString("de-DE") : "–", gs.bestSteps ? "Bestwert " + gs.bestSteps.toLocaleString("de-DE") : "")}${stat("Schlaf Ø 7 Tage", gs.sleep7 != null ? f1(gs.sleep7) + " h" : "–")}
        ${stat("Ruhepuls Ø 7 Tage", gs.rhr7 != null ? Math.round(gs.rhr7) + " bpm" : "–", gs.rhrDelta != null ? (gs.rhrDelta > 0 ? "+" : "") + f1(gs.rhrDelta) + " zur Vorwoche" : "")}${stat("VO₂max", gs.vo2 ? f1(gs.vo2.latest) : "–", gs.vo2 && gs.vo2.series.length > 1 ? (gs.vo2.delta > 0 ? "+" : "") + f1(gs.vo2.delta) + " seit Beginn" : "")}</div>
        ${gs.vo2 && gs.vo2.series.length > 2 && html`<div><div class="tiny muted">VO₂max-Verlauf</div><${Spark} values=${gs.vo2.series.map(x => x.v)} color="var(--accent)" /></div>`}
        ${daily.length >= 3 && html`<div class="grid2"><div><div class="tiny muted">Ruhepuls</div><${Spark} values=${daily.map(d => d.restingHr)} /></div><div><div class="tiny muted">Schlaf</div><${Spark} values=${daily.map(d => d.sleepHours)} color="var(--accent)" /></div></div>`}</div></div>`}
    </div></div>
  </div>`;
}

function GarminCard() {
  const cloud = S.state.adapter && S.state.adapter.mode === "cloud";
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [key, setKey] = useState(""), [guide, setGuide] = useState(false), [diag, setDiag] = useState("");
  const g = S.state.garmin, link = S.state.link, connected = link && link.status === "connected", last = g.daily.length ? g.daily[g.daily.length - 1].date : null;
  const run = fn => async () => { setBusy(true); setMsg(""); try { await fn(); } catch (e) { setMsg("Fehler: " + e.message); } setBusy(false); };
  const connect = run(async () => { await S.garminApi.connect(key.trim()); setKey(""); await S.refreshLink(); setMsg("Key geprüft und verschlüsselt gespeichert."); });
  const sync = run(async () => { const r = await S.garminApi.sync(30); await S.reloadGarmin(); const bad = Object.entries(r.report || {}).filter(([, v]) => v.ok === 0 && v.failed > 0).map(([k, v]) => `${k} (HTTP ${v.lastStatus})`); setMsg(`${r.activities} Aktivitäten, ${r.daily} Tageswerte synchronisiert.${bad.length ? " Nicht abrufbar: " + bad.join(", ") + " – siehe Diagnose." : ""}`); });
  const runDiag = run(async () => { const r = await S.garminApi.diagnose(); setDiag(JSON.stringify(r, null, 1)); });
  const disc = run(async () => { await S.garminApi.disconnect(); await S.refreshLink(); S.toast("Garmin getrennt, Key gelöscht.", "info"); });
  const onFile = async e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return; setBusy(true); setMsg(""); try { const r = await S.importGarminFile(await f.text()); setMsg(`${r.activities} Aktivitäten, ${r.daily} Tageswerte importiert.`); } catch (err) { setMsg("Fehler: " + err.message); } setBusy(false); };
  return html`<div class="card stack"><div class="row between"><h3>Garmin Connect</h3>${connected ? html`<span class="tag good">verbunden</span>` : link && link.status === "error" ? html`<span class="tag bad">Key abgelehnt</span>` : html`<span class="tag">nicht verbunden</span>`}</div>
    ${g.activities.length || g.daily.length ? html`<p class="small muted">${g.activities.length} Aktivitäten · ${g.daily.length} Tageswerte${last ? " · bis " + fmtDay(last) : ""}${connected && link.last_sync_at ? " · Sync " + String(link.last_sync_at).slice(0, 16).replace("T", " ") : ""}</p>` : null}
    ${connected && html`<p class="tiny muted">Synchronisiert automatisch beim Öffnen der App.</p>`}
    ${connected && link.last_error && html`<p class="small c-warn">${String(link.last_error).slice(0, 120)}</p>`}${S.state.syncError && html`<p class="small c-bad">Auto-Sync: ${S.state.syncError}</p>`}
    ${!cloud && html`<p class="small muted">Die direkte Verbindung braucht ein Cloud-Konto. Im Demo-Modus nur Datei-Import.</p>`}
    ${cloud && connected && html`<div class="row"><button class="btn primary grow" disabled=${busy} onClick=${sync}>${busy ? "…" : "Jetzt synchronisieren"}</button><button class="btn danger" disabled=${busy} onClick=${disc}>Trennen</button></div>
      <button class="btn ghost sm" style="align-self:flex-start" disabled=${busy} onClick=${runDiag}>Diagnose</button>
      ${diag && html`<div class="stack tight"><pre class="diag">${diag}</pre><div class="row"><button class="btn sm" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(diag).then(() => S.toast("Kopiert.", "info")); }}>Kopieren</button><span class="tiny muted">Nur Feldnamen, keine Werte.</span></div></div>`}`}
    ${cloud && !connected && html`<div class="stack tight"><button class="btn ghost sm" style="align-self:flex-start" onClick=${() => setGuide(!guide)}>${guide ? "Anleitung ausblenden" : "Personal API Key erzeugen"}</button>
      ${guide && html`<ol class="small muted" style="margin:0 0 6px;padding-left:20px;line-height:1.65"><li>In Garmin Connect (Web) die Seite <b>Personal API Key</b> öffnen.</li><li><b>Create Key</b> wählen, Bedingungen akzeptieren.</li><li>Ablaufdauer wählen und <b>Create</b> klicken.</li><li>Der Key wird <b>nur einmal</b> angezeigt: kopieren und hier einfügen.</li></ol>`}
      <label class="field">Personal API Key<input type="password" autocomplete="off" spellcheck="false" placeholder="Key einfügen" value=${key} onInput=${e => setKey(e.target.value)} /></label>
      <button class="btn primary" disabled=${busy || key.trim().length < 10} onClick=${connect}>${busy ? "Prüfe …" : "Verbinden"}</button>
      <p class="tiny muted">Der Key wird nur serverseitig verschlüsselt gespeichert und nie angezeigt. Du kannst ihn bei Garmin jederzeit widerrufen.</p></div>`}
    <label class="field">Export-Datei importieren (garmin_data.json)<input type="file" accept="application/json,.json" disabled=${busy} onChange=${onFile} /></label>
    ${msg && html`<div class="note">${msg}</div>`}</div>`;
}

function PlanSheet({plan, onClose, onDelete}) {
  const [title, setTitle] = useState(plan.title), active = plan.status === "active";
  const sess = S.state.sessions.filter(x => x.planId === plan.id), done = sess.filter(x => x.status === "done").length;
  return html`<${Sheet} title="Trainingsplan" onClose=${onClose}><div class="stack">
    <label class="field">Name<input type="text" maxlength="80" value=${title} onInput=${e => setTitle(e.target.value)} /></label>
    <p class="small muted">${fmtDay(plan.startDate)} – ${fmtDay(plan.endDate)} · ${sess.length} Einheiten, ${done} erledigt${active ? " · aktiv" : " · archiviert"}</p>
    <button class="btn primary" disabled=${!title.trim() || title.trim() === plan.title} onClick=${async () => { await S.renamePlan(plan.id, title); S.toast("Plan umbenannt.", "info"); onClose(); }}>Namen speichern</button>
    ${!active && html`<div class="stack tight"><button class="btn" onClick=${async () => { await S.activatePlan(plan.id); S.toast("Plan aktiviert. Bereits vergangene Einheiten gelten als ausgelassen.", "info"); onClose(); }}>Als aktiven Plan verwenden</button><p class="tiny muted">Es ist immer nur ein Plan aktiv. Der bisherige wird archiviert, seine Daten bleiben erhalten.</p></div>`}
    <button class="btn danger" onClick=${() => onDelete(plan)}>Plan löschen</button></div><//>`;
}

export function Profile({onWizard}) {
  const st = S.state, plan = S.activePlan(), cloud = st.adapter && st.adapter.mode === "cloud", archived = st.plans.filter(p => p.status !== "active");
  const [confirm, setConfirm] = useState(null), [manage, setManage] = useState(null);
  return html`<div class="screen narrow stack gap-lg"><h1>Profil</h1>
    <div class="section"><span class="label">Konto</span><div class="list"><${Row} title=${cloud ? st.user.email : "Demo-Modus"} sub=${cloud ? "Daten nur für dein Konto sichtbar" : "Ohne Konto – Daten nur in diesem Browser"} />${cloud && html`<${Row} title="Abmelden" onClick=${S.auth.signOut} />`}</div>
      ${!cloud && html`<p class="small muted">Für Konten, KI-Coach und Garmin die <code>config.js</code> mit deinem Supabase-Projekt füllen (siehe README).</p>`}</div>
    <div class="section"><span class="label">Trainingspläne</span><div class="list">${st.plans.slice().sort((x, y) => (y.status === "active") - (x.status === "active") || y.startDate.localeCompare(x.startDate)).map(p => html`<${Row} title=${p.title} sub=${`${fmtDay(p.startDate)} – ${fmtDay(p.endDate)}`} right=${html`<span class=${"tag" + (p.status === "active" ? " good" : "")}>${p.status === "active" ? "aktiv" : "archiviert"}</span>`} onClick=${() => setManage(p)} />`)}
      ${!st.plans.length && html`<${Row} title="Kein Plan vorhanden" />`}<${Row} title="Neuen Plan erstellen" sub="Der aktive Plan wird archiviert, alle Pläne bleiben gespeichert" onClick=${onWizard} /></div></div>
    <div class="section"><span class="label">Garmin</span><${GarminCard} /></div>
    <div class="section"><span class="label">Coach</span><div class="card stack"><label class="check"><input type="checkbox" checked=${st.settings.autoApply !== false} onChange=${e => S.setSettings({autoApply: e.target.checked})} /><span><div class="bold">Empfehlungen automatisch übernehmen</div><div class="small muted">Ziele und Umfang passen sich nach jedem Training an.</div></span></label>
      <p class="tiny muted">${S.aiAvailable() ? "KI aktiv. Beim Auswerten werden Trainingsdaten an den KI-Anbieter gesendet." : "Ohne Cloud-Konto arbeitet der Coach regelbasiert."}</p></div></div>
    <div class="section"><span class="label">Daten</span><div class="list"><${Row} title="Alle Trainingsdaten löschen" danger=${true} onClick=${() => setConfirm({type: "data"})} />${cloud && html`<${Row} title="Konto endgültig löschen" danger=${true} onClick=${() => setConfirm({type: "account"})} />`}</div></div>
    ${manage && html`<${PlanSheet} plan=${st.plans.find(x => x.id === manage.id) || manage} onClose=${() => setManage(null)} onDelete=${p => { setManage(null); setConfirm({type: "plan", id: p.id}); }} />`}
    ${confirm && html`<${Sheet} title="Wirklich?" onClose=${() => setConfirm(null)}><div class="stack"><p class="muted">${confirm.type === "account" ? "Dein Konto und alle Daten werden unwiderruflich gelöscht." : confirm.type === "data" ? "Alle Pläne und Einheiten werden gelöscht." : "Dieser Plan und seine Einheiten werden gelöscht."}</p>
      <button class="btn primary" onClick=${async () => { const c = confirm; setConfirm(null); try { if (c.type === "account") await S.deleteAccount(); else if (c.type === "data") await S.resetData(); else await S.deletePlan(c.id); } catch (e) { S.toast(e.message, "error"); } }}>Ja, löschen</button><button class="btn" onClick=${() => setConfirm(null)}>Abbrechen</button></div><//>`}
  </div>`;
}
