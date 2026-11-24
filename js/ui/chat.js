import {html, useState, useEffect, useRef} from "../../vendor/preact-htm.js";
import {Icon, Spinner} from "./common.js";
import * as S from "../store.js";
import {KINDS, SPORTS} from "../../engine/catalog.js";
import {fmtDay} from "../../engine/dates.js";

const SUGGESTIONS = ["Was soll ich heute trainieren?", "Wie viel Pause brauche ich nach einer harten Einheit?", "Ist mein Plan gerade zu anspruchsvoll?", "Wie kann ich meine VO₂max verbessern?"];
const ruleText = a => `Ersetzt ${a.kinds && a.kinds.length ? a.kinds.map(k => KINDS[k] ? KINDS[k].label : k).join(", ") : (a.sports || []).map(s => SPORTS[s].label + "-Einheiten").join(", ")} ${a.from ? "ab " + fmtDay(a.from) + " " + a.from.slice(0, 4) + " " : ""}${a.until ? "bis " + fmtDay(a.until) + " " + a.until.slice(0, 4) : "dauerhaft"} durch ${a.replace === "auto" ? "passende Alternativen aus deinem Plan" : KINDS[a.replace].label}.`;
const keyFor = uid => "tt2_chat_" + uid;
const load = uid => { try { const v = JSON.parse(localStorage.getItem(keyFor(uid))); return Array.isArray(v) ? v : []; } catch { return []; } };
const store = (uid, msgs) => { try { localStorage.setItem(keyFor(uid), JSON.stringify(msgs.slice(-40))); } catch {} };
let seq = 1;

export function Chat() {
  const enabled = S.aiAvailable(), uid = (S.state.user && S.state.user.id) || "demo";
  const [msgs, setMsgs] = useState(() => load(uid)), [text, setText] = useState(""), [busy, setBusy] = useState(false), endRef = useRef(null);
  useEffect(() => { if (S.state.chatPrefill && enabled) { const q = S.state.chatPrefill; S.state.chatPrefill = null; send(q); } }, []);
  useEffect(() => { store(uid, msgs); if (endRef.current) endRef.current.scrollIntoView({block: "end"}); }, [msgs, busy]);
  const send = async (q, base = msgs) => {
    q = String(q || "").trim(); if (!q || busy) return;
    const mine = {id: "u" + seq++ + Date.now(), role: "user", text: q}, next = [...base, mine];
    setMsgs(next); setText(""); setBusy(true);
    try { const r = await S.askCoach(base, q); setMsgs([...next, {id: "c" + seq++ + Date.now(), role: "coach", text: r.reply || "Dazu habe ich gerade keine Antwort.", actions: r.actions, applied: {}}]); }
    catch (e) { setMsgs([...next, {id: "c" + seq++ + Date.now(), role: "coach", error: true, text: `Der Coach ist gerade nicht erreichbar (${e.message}).`, retry: q}]); }
    setBusy(false);
  };
  const apply = async (m, i) => {
    try { await S.applyChatAction(m.actions[i]); setMsgs(list => list.map(x => x.id === m.id ? {...x, applied: {...x.applied, [i]: true}} : x)); }
    catch (e) { S.toast(e.message, "error"); }
  };
  const onKey = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } };
  return html`<div class="screen narrow stack gap-lg">
    <div class="page-head"><div><div class="eyebrow">Chronica Athleta</div><h1 style="margin-top:6px">Coach</h1></div>${msgs.length > 0 && html`<button class="btn sm" onClick=${() => { setMsgs([]); }}>Neuer Chat</button>`}</div>
    ${!enabled ? html`<div class="note">Der Coach-Chat braucht ein Cloud-Konto mit KI (siehe Einrichtung). Im Demo-Modus nicht verfügbar.</div>` : html`
      <div class="chat">
        ${msgs.length === 0 && html`<div class="stack"><p class="muted">Frag mich zu deinem Training, deiner Erholung oder deinem Plan. Ich kenne deine nächsten Einheiten, deine letzten Trainings und deine Garmin-Werte.</p>
          <div class="choices">${SUGGESTIONS.map(s => html`<button class="opt compact" onClick=${() => send(s)}><span class="grow">${s}</span><${Icon} name="chevR" size=${16} /></button>`)}</div></div>`}
        ${msgs.map(m => html`<div class=${"msg " + m.role} key=${m.id}><div class=${"bubble " + m.role + (m.error ? " err" : "")}>${m.text.split(/\n\n+/).map(p => html`<p>${p}</p>`)}</div>
          ${m.actions && m.actions.length > 0 && html`<div class="stack tight">${m.actions.map((a, i) => html`<div class="stack tight">${m.applied && m.applied[i] ? html`<span class="tag good" style="align-self:flex-start">${a.label} · übernommen</span>` : html`<button class="btn sm" style="align-self:flex-start" onClick=${() => apply(m, i)}>${a.label}</button>`}${a.type === "rule" && !(m.applied && m.applied[i]) && html`<span class="tiny muted">${ruleText(a)}</span>`}</div>`)}</div>`}
          ${m.retry && html`<button class="btn sm" onClick=${() => { const i = msgs.findIndex(x => x.id === m.id), base = msgs.slice(0, msgs[i - 1] && msgs[i - 1].role === "user" ? i - 1 : i); send(m.retry, base); }}>Erneut versuchen</button>`}</div>`)}
        ${busy && html`<div class="msg coach"><div class="bubble coach"><${Spinner} /></div></div>`}
        <div ref=${endRef}></div>
      </div>
      <div class="chat-input"><textarea rows="1" placeholder="Frage stellen" value=${text} maxlength="500" onInput=${e => setText(e.target.value)} onKeyDown=${onKey} disabled=${busy}></textarea>
        <button class="btn primary" aria-label="Senden" onClick=${() => send(text)} disabled=${busy || !text.trim()}><${Icon} name="send" size=${18} /></button></div>
      <p class="tiny faint center">Allgemeine Trainingsempfehlungen, keine medizinische Beratung. Bei Schmerzen bitte Arzt oder Sportphysio fragen.</p>`}
  </div>`;
}
