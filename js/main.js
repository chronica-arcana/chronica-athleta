import {html, render, useState, useEffect, useReducer} from "../vendor/preact-htm.js";
import * as S from "./store.js";
import {Toasts, Spinner, Icon} from "./ui/common.js";
import {AuthScreen, RecoveryScreen} from "./ui/auth.js";
import {Wizard} from "./ui/wizard.js";
import {Today, Plan, Progress, Profile} from "./ui/views.js";
import {Chat} from "./ui/chat.js";
import {SessionSheet, LogSheet, SwapSheet, MoveSheet, AddSheet, AvailabilitySheet} from "./ui/session.js";

const TABS = [["today", "home", "Heute"], ["plan", "calendar", "Plan"], ["progress", "chart", "Fortschritt"], ["coach", "chat", "Coach"], ["profile", "user", "Profil"]];

function App() {
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => { const off = S.subscribe(force); force(); return off; }, []);
  const [tab, setTab] = useState("today"), [sheet, setSheet] = useState(null), [wizard, setWizard] = useState(false), [wizardSeen, setWizardSeen] = useState(false);
  const st = S.state;
  const open = (id, sub) => { if (sub === "log") setSheet({type: "log", id}); else if (sub === "swap") setSheet({type: "swap", id}); else if (sub === "move") setSheet({type: "move", id}); else setSheet({type: "session", id}); };
  const close = () => setSheet(null);
  if (st.recovering) return html`<${RecoveryScreen} onDone=${force} /><${Toasts} items=${st.toasts} />`;
  if (st.phase === "loading") return html`<div class="screen"><${Spinner} text="Lade …" /></div>`;
  if (st.phase === "error") return html`<div class="auth"><h1>Fehler</h1><div class="note warn">${st.error}</div><button class="btn primary" onClick=${() => location.reload()}>Neu laden</button></div>`;
  if (st.phase === "auth") return html`<${AuthScreen} /><${Toasts} items=${st.toasts} />`;
  const needsPlan = !S.activePlan();
  const showWizard = wizard || (needsPlan && !wizardSeen);
  const closeWizard = () => { setWizard(false); setWizardSeen(true); setTab("today"); };
  const sess = sheet && st.sessions.find(s => s.id === sheet.id);
  return html`<div class="shell">
    ${st.adapter.mode === "demo" && html`<div class="note tiny center" style="border-radius:0">Demo-Modus: Daten nur lokal. Für Konten, KI und Garmin Supabase und Vercel einrichten (README).</div>`}
    ${tab === "today" && html`<${Today} onOpen=${open} onAdd=${d => setSheet({type: "add", date: d})} onWizard=${() => setWizard(true)} />`}
    ${tab === "plan" && html`<${Plan} onOpen=${open} onAdd=${d => setSheet({type: "add", date: d})} onAvail=${ws => setSheet({type: "avail", ws})} onWizard=${() => setWizard(true)} />`}
    ${tab === "progress" && html`<${Progress} onWizard=${() => setWizard(true)} />`}
    ${tab === "coach" && html`<${Chat} />`}
    ${tab === "profile" && html`<${Profile} onWizard=${() => setWizard(true)} />`}
    <nav class="tabbar" aria-label="Hauptnavigation"><div class="tabbar-inner"><div class="brand"><small>Chronica</small>Athleta</div>${TABS.map(([k, ic, lb]) => html`<button class=${"tab" + (tab === k ? " active" : "")} aria-current=${tab === k ? "page" : null} onClick=${() => setTab(k)}><${Icon} name=${ic} size=${22} />${lb}</button>`)}</div></nav>
    ${sheet && sheet.type === "session" && sess && html`<${SessionSheet} id=${sheet.id} onClose=${close} />`}
    ${sheet && sheet.type === "log" && sess && html`<${LogSheet} session=${sess} onClose=${close} />`}
    ${sheet && sheet.type === "swap" && sess && html`<${SwapSheet} session=${sess} onClose=${close} />`}
    ${sheet && sheet.type === "move" && sess && html`<${MoveSheet} session=${sess} onClose=${close} />`}
    ${sheet && sheet.type === "add" && html`<${AddSheet} date=${sheet.date} onClose=${close} />`}
    ${sheet && sheet.type === "avail" && html`<${AvailabilitySheet} ws=${sheet.ws} onClose=${close} />`}
    ${showWizard && html`<${Wizard} first=${needsPlan} onClose=${closeWizard} />`}
    <${Toasts} items=${st.toasts} /></div>`;
}

render(html`<${App} />`, document.getElementById("app"));
S.boot();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") S.autoSync(); }); // beim Zurückkehren in die App erneut synchronisieren (max. alle 20 Min)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
