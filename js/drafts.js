// Entwürfe: Eingaben beim Loggen werden laufend lokal gespeichert, falls das Fenster versehentlich geschlossen wird.
const PREFIX = "tt2_draft_", MAX_AGE = 14 * 864e5;
export const loadDraft = id => { try { const d = JSON.parse(localStorage.getItem(PREFIX + id)); return d && typeof d === "object" ? d : null; } catch { return null; } };
export const saveDraft = (id, data) => { try { localStorage.setItem(PREFIX + id, JSON.stringify({...data, _t: Date.now()})); } catch {} };
export const clearDraft = id => { try { localStorage.removeItem(PREFIX + id); } catch {} };
export function pruneDrafts() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) { const d = JSON.parse(localStorage.getItem(k) || "null"); if (!d || Date.now() - (d._t || 0) > MAX_AGE) localStorage.removeItem(k); } } catch {}
}
export const hasContent = d => !!d && (d.rpe != null || d.pain != null || (d.notes && d.notes.length) || Object.values(d.sets || {}).some(a => (a || []).some(x => x && (x.reps || x.weight || x.seconds))));
