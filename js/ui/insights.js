import {html, useState, useEffect} from "../../vendor/preact-htm.js";
import {Sheet, Spinner} from "./common.js";
import * as S from "../store.js";

const TONE = {warn: ["Achtung", "warn"], tip: ["Tipp", ""], good: ["Gut", "good"]};
export const InsightsList = ({items}) => html`<div class="list">${items.map(i => html`<div class="li" style="align-items:flex-start"><div class="grow stack tight"><div class="row wrap" style="gap:8px"><span class=${"tag " + TONE[i.tone][1]}>${TONE[i.tone][0]}</span><span class="tiny muted">${i.area}</span></div><div class="t">${i.title}</div><div class="s">${i.text}</div></div></div>`)}</div>`;

export function InsightsSheet({onClose, onDiscuss}) {
  const items = S.getInsights(), n = S.doneCount(), [focus, setFocus] = useState(undefined);
  useEffect(() => { if (!S.aiAvailable()) { setFocus(null); return; } let off = false; S.insightsFocus(items).then(r => { if (!off) setFocus(r); }).catch(() => { if (!off) setFocus(null); }); return () => { off = true; }; }, []);
  return html`<${Sheet} title=${`Zwischenbilanz nach ${n} Einheiten`} onClose=${onClose}><div class="stack">
    <p class="muted small">Das habe ich in deinen bisherigen Einheiten und Garmin-Daten gefunden und so kannst du dich gezielt verbessern.</p>
    ${S.aiAvailable() && (focus === undefined ? html`<div class="card stack"><div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:95%"></div><div class="skeleton" style="width:60%"></div></div>`
      : focus && focus.focus ? html`<div class="card stack tight"><span class="label">Fokus für die nächsten 2 Wochen</span>${focus.headline && html`<div class="bold">${focus.headline}</div>`}<p class="small">${focus.focus}</p>${focus.steps.length > 0 && html`<ul class="small muted" style="margin:0;padding-left:18px">${focus.steps.map(x => html`<li>${x}</li>`)}</ul>`}</div>` : null)}
    <${InsightsList} items=${items} />
    <div class="stack tight"><button class="btn primary block" onClick=${onClose}>Verstanden</button>${S.aiAvailable() && html`<button class="btn block" onClick=${onDiscuss}>Mit dem Coach besprechen</button>`}</div>
    <p class="tiny faint">Regelbasierte Hinweise, keine medizinische Beratung. Du siehst sie nach jeweils 5 weiteren Einheiten und jederzeit unter Fortschritt.</p></div><//>`;
}
