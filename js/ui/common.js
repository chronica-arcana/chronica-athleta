import {html, useState} from "../../vendor/preact-htm.js";
import {SPORTS, kindInfo} from "../../engine/catalog.js";
import {dismissToast} from "../store.js";

// Schlichte Linien-Icons (24er Raster, Strichstärke einheitlich) – ersetzen alle Emojis in der Oberfläche
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>', chevL: '<path d="m15 6-6 6 6 6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  skip: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'
};
export const Icon = ({name, size = 20, stroke = 1.7}) => html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{__html: PATHS[name] || ""}} />`;

export const spInfo = s => SPORTS[(s && s.sport) || (s && s.kind && kindInfo(s.kind).sport) || "cardio"] || SPORTS.cardio;
export const SportMark = ({s, sport}) => { const sp = SPORTS[sport] || spInfo(s); return html`<span class="sport"><i style=${`background:${sp.color}`}></i>${sp.label}</span>`; };
export const INTENSITY_TXT = {easy: "locker", moderate: "moderat", hard: "intensiv"};
export const Bar = ({s}) => html`<span class="bar" style=${`background:${spInfo(s).color}`}></span>`;

export function Sheet({title, onClose, children}) {
  return html`<div class="sheet-wrap" role="dialog" aria-modal="true" aria-label=${title || "Dialog"}>
    <div class="sheet-bg" onClick=${onClose}></div>
    <div class="sheet"><div class="grab"></div>
      ${title && html`<div class="row between" style="margin-bottom:16px"><h2>${title}</h2><button class="icon-btn" onClick=${onClose} aria-label="Schließen"><${Icon} name="x" size=${18} /></button></div>`}
      ${children}</div></div>`;
}
export const Toasts = ({items}) => html`<div class="toasts" aria-live="polite">${items.map(t => html`<div class=${"toast " + t.kind} key=${t.id} onClick=${() => dismissToast(t.id)}>${t.text}</div>`)}</div>`;
export const Spinner = ({text}) => html`<div class="row" style="justify-content:center;padding:28px"><span class="spin"></span>${text && html`<span class="muted small">${text}</span>`}</div>`;
export const Seg = ({options, value, onChange, multi}) => html`<div class="seg">${options.map(o => {
  const sel = multi ? (value || []).includes(o.value) : value === o.value;
  return html`<button class=${"chip" + (sel ? " sel" : "")} key=${String(o.value)} onClick=${() => onChange(o.value)}>${o.label}</button>`;
})}</div>`;
export const Option = ({sel, onClick, children, compact}) => html`<button class=${"opt" + (compact ? " compact" : "") + (sel ? " sel" : "")} onClick=${onClick}><span class="grow">${children}</span><span class="mark"><${Icon} name="check" size=${13} stroke=${2.4} /></span></button>`;
export const Row = ({title, sub, right, onClick, href, danger, children}) => {
  const inner = html`<div class="grow"><div class=${"t" + (danger ? " c-bad" : "")}>${title}</div>${sub && html`<div class="s">${sub}</div>`}${children}</div>${right}${onClick || href ? html`<span class="chev"><${Icon} name="chevR" size=${18} /></span>` : null}`;
  return href ? html`<a class="li" href=${href}>${inner}</a>` : onClick ? html`<button class="li" onClick=${onClick}>${inner}</button>` : html`<div class="li">${inner}</div>`;
};
export const sessionLine = s => `${s.durationMin} Min${s.addon ? ` + ${s.addon.minutes} Kraft` : ""}`;
export function useField(init) { const [v, setV] = useState(init); return [v, e => setV(e && e.target ? e.target.value : e), setV]; }
export const fmtNum = n => String(Math.round(n * 100) / 100).replace(".", ",");
