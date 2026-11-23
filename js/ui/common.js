import {html, useState} from "../../vendor/preact-htm.js";
import {SPORTS, kindInfo} from "../../engine/catalog.js";
import {fmtShort} from "../../engine/dates.js";

export const sportOf = s => SPORTS[(s && s.sport) || "cardio"] || SPORTS.cardio;
export const IconBox = ({sport, kind, size}) => {
  const sp = SPORTS[sport || (kind && kindInfo(kind).sport)] || SPORTS.cardio;
  return html`<div class="icon-box" style=${`background:color-mix(in srgb,${sp.color} 18%,transparent);${size ? `width:${size}px;height:${size}px` : ""}`}>${kind ? kindInfo(kind).icon : sp.icon}</div>`;
};
export const INTENSITY = {easy: ["locker", "good"], moderate: ["moderat", "warn"], hard: ["hart", "bad"]};
export const IntensityChip = ({v}) => { const [t, c] = INTENSITY[v] || INTENSITY.easy; return html`<span class=${"chip " + c}>${t}</span>`; };

export function Sheet({title, onClose, children}) {
  return html`<div class="sheet-wrap" role="dialog" aria-modal="true" aria-label=${title || "Dialog"}>
    <div class="sheet-bg" onClick=${onClose}></div>
    <div class="sheet"><div class="grab"></div>
      ${title && html`<div class="row between" style="margin-bottom:12px"><h2>${title}</h2><button class="btn ghost sm" onClick=${onClose} aria-label="Schließen">✕</button></div>`}
      ${children}</div></div>`;
}
import {dismissToast} from "../store.js";
export const Toasts = ({items}) => html`<div class="toasts" aria-live="polite">${items.map(t => html`<div class=${"toast " + t.kind} key=${t.id} onClick=${() => dismissToast(t.id)}>${t.text}</div>`)}</div>`;
export const Spinner = ({text}) => html`<div class="row" style="justify-content:center;padding:24px"><span class="spin"></span>${text && html`<span class="muted">${text}</span>`}</div>`;
export const Seg = ({options, value, onChange, multi}) => html`<div class="seg">${options.map(o => {
  const sel = multi ? (value || []).includes(o.value) : value === o.value;
  return html`<button class=${"chip" + (sel ? " sel" : "")} key=${o.value} onClick=${() => onChange(o.value)}>${o.icon && html`<span>${o.icon}</span>`}${o.label}</button>`;
})}</div>`;
export const sessionLine = s => `${fmtShort(s.date)} · ${s.durationMin} Min${s.addon ? ` + ${s.addon.minutes} Kraft` : ""}`;
export function useField(init) { const [v, setV] = useState(init); return [v, e => setV(e && e.target ? e.target.value : e), setV]; }
export const statusChip = s => s.status === "done" ? html`<span class="chip good">✓ erledigt</span>` : s.status === "skipped" ? html`<span class="chip">ausgelassen</span>` : null;
export const fmtNum = n => String(Math.round(n * 100) / 100).replace(".", ",");
